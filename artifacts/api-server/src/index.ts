import app from "./app";
import { logger } from "./lib/logger";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { ekPlayersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

interface MatchStats {
  totalDamageDealt?: number;
  abilityUseCount?: number;
  skillUsed?: boolean;
  tookDamage?: boolean;
  wasNearDeath?: boolean;
  reachedEnemyTerritory?: boolean;
  turnCount?: number;
  winStreak?: number;
}

interface BonusEntry {
  label: string;
  rp: number;
}

interface PlayerSlot {
  ws: WebSocket | null;
  sessionId: string;
  userId: string;
  rank: number;
  playerName?: string;
  profileIcon?: string;
}

interface Room {
  code: string;
  players: [PlayerSlot | null, PlayerSlot | null];
  settings: Record<string, unknown> | null;
  isRanked: boolean;
  status: "waiting" | "playing" | "suspended" | "finished";
  lastState: unknown;
  suspendTimer: NodeJS.Timeout | null;
  pendingGameEnd: Map<number, { won: boolean; matchStats: MatchStats }>;
  pendingGameEndTimer: NodeJS.Timeout | null;
  resolvedWinnerIndex: number;
}

interface QueueEntry {
  ws: WebSocket;
  sessionId: string;
  userId: string;
  rank: number;
  job: string;
  playerName: string;
  profileIcon: string;
  favorites: string[];
  friends: string[]; // DB-verified friend IDs (both directions); used for rank-bypass matching
  ts: number;
  searchTimer: NodeJS.Timeout | null;
}

const rooms = new Map<string, Room>();
const queue: QueueEntry[] = [];
// userId -> last opponents (most recent first), for anti-boosting
const recentOpponents = new Map<string, string[]>();
// Sockets that sent cancelRanked while a friend-fetch was still in flight.
// Checked inside the async IIFE before queue.push to prevent stale enqueue.
const cancelledFriendFetch = new Set<WebSocket>();
const RECONNECT_GRACE_MS = 120000; // 2 minutes to reconnect before forfeit

function generateRoomCode(): string {
  const chars = "0123456789";
  let code = "";
  for (let i = 0; i < 5; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateRoomCode() : code;
}

function safeSend(ws: WebSocket | null, data: object) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function recordOpponents(a: string, b: string) {
  for (const [self, foe] of [
    [a, b],
    [b, a],
  ]) {
    const list = recentOpponents.get(self) || [];
    list.unshift(foe);
    recentOpponents.set(self, list.slice(0, 2));
  }
}

function playedRecently(a: string, b: string): boolean {
  return (recentOpponents.get(a) || []).includes(b);
}

// Progressive rank window: 0-10s => 1, 10-20s => 2, 20-30s => 3, capped at 5.
function rankWindow(waitedMs: number): number {
  if (waitedMs < 10000) return 1;
  if (waitedMs < 20000) return 2;
  if (waitedMs < 30000) return 3;
  if (waitedMs < 40000) return 4;
  return 5;
}

function tryMatch() {
  const now = Date.now();
  // Pass 1: friend-priority — if either player has the other in their DB-verified friends list,
  // skip rank-diff check entirely (rank-bypass). recentOpponents check still applies.
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    if (!a || a.ws.readyState !== WebSocket.OPEN) continue;
    for (let j = i + 1; j < queue.length; j++) {
      const b = queue[j];
      if (!b || b.ws.readyState !== WebSocket.OPEN) continue;
      const isFriendPair = (a.friends || []).includes(b.userId) || (b.friends || []).includes(a.userId);
      if (isFriendPair) {
        startRankedMatch(a, b);
        queue.splice(j, 1);
        queue.splice(i, 1);
        return tryMatch();
      }
    }
  }
  // Pass 2: favorite-priority — client-sent favorites list, allow rankWindow+2
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    if (!a || a.ws.readyState !== WebSocket.OPEN) continue;
    const aWin = rankWindow(now - a.ts);
    for (let j = i + 1; j < queue.length; j++) {
      const b = queue[j];
      if (!b || b.ws.readyState !== WebSocket.OPEN) continue;
      const bWin = rankWindow(now - b.ts);
      const win = Math.min(aWin, bWin);
      const isFavPair = (a.favorites || []).includes(b.userId) || (b.favorites || []).includes(a.userId);
      if (isFavPair && Math.abs(a.rank - b.rank) <= win + 2) {
        startRankedMatch(a, b);
        queue.splice(j, 1);
        queue.splice(i, 1);
        return tryMatch();
      }
    }
  }
  // Pass 3: normal rank-window matching
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    if (!a || a.ws.readyState !== WebSocket.OPEN) continue;
    const aWin = rankWindow(now - a.ts);
    for (let j = i + 1; j < queue.length; j++) {
      const b = queue[j];
      if (!b || b.ws.readyState !== WebSocket.OPEN) continue;
      const bWin = rankWindow(now - b.ts);
      const win = Math.min(aWin, bWin);
      if (Math.abs(a.rank - b.rank) <= win) {
        startRankedMatch(a, b);
        queue.splice(j, 1);
        queue.splice(i, 1);
        return tryMatch();
      }
    }
  }
}

function makeRoom(code: string, partial: Partial<Room>): Room {
  return {
    code,
    players: [null, null],
    settings: null,
    isRanked: false,
    status: "waiting",
    lastState: null,
    suspendTimer: null,
    pendingGameEnd: new Map(),
    pendingGameEndTimer: null,
    resolvedWinnerIndex: -1,
    ...partial,
  };
}

function startRankedMatch(a: QueueEntry, b: QueueEntry) {
  if (a.searchTimer) clearInterval(a.searchTimer);
  if (b.searchTimer) clearInterval(b.searchTimer);
  const code = generateRoomCode();
  // Same userId rematched within last 2 games => no RP movement.
  const isRanked = !playedRecently(a.userId, b.userId);
  recordOpponents(a.userId, b.userId);
  const hostFirst = Math.random() < 0.5;
  const ALL_RANKED_STAGES = ["plains","forest","desert","demon","castle","bigriver","mountain","graveyard","nighttown","skyfort","chaos","dungeon","underwater","lavaland","misty_lake","colosseum","factory","volcano_summit"];
  const randomStage = ALL_RANKED_STAGES[Math.floor(Math.random() * ALL_RANKED_STAGES.length)];
  const settings = {
    p1job: a.job,
    p2job: b.job,
    stage: randomStage,
    difficulty: "1",
    seed: Math.floor(Math.random() * 0x7fffffff),
    p1First: hostFirst,
    ranked: isRanked,
  };
  rooms.set(code, makeRoom(code, {
    players: [
      { ws: a.ws, sessionId: a.sessionId, userId: a.userId, rank: a.rank, playerName: a.playerName, profileIcon: a.profileIcon },
      { ws: b.ws, sessionId: b.sessionId, userId: b.userId, rank: b.rank, playerName: b.playerName, profileIcon: b.profileIcon },
    ],
    settings,
    isRanked,
    status: "playing",
  }));
  attachRoom(a.ws, code, 0);
  attachRoom(b.ws, code, 1);
  safeSend(a.ws, {
    type: "gameStart",
    playerIndex: 0,
    settings,
    sessionId: a.sessionId,
    roomCode: code,
    ranked: isRanked,
    opponentRank: b.rank,
    opponentName: b.playerName || "プレイヤー",
    opponentIcon: b.profileIcon || "🎮",
    opponentUserId: b.userId,
  });
  safeSend(b.ws, {
    type: "gameStart",
    playerIndex: 1,
    settings,
    sessionId: b.sessionId,
    roomCode: code,
    ranked: isRanked,
    opponentRank: a.rank,
    opponentName: a.playerName || "プレイヤー",
    opponentIcon: a.profileIcon || "🎮",
    opponentUserId: a.userId,
  });
  logger.info({ code, isRanked }, "Ranked match started");
}

// Track which room/index a socket currently belongs to.
const socketRoom = new WeakMap<WebSocket, { code: string; index: number }>();
function attachRoom(ws: WebSocket, code: string, index: number) {
  socketRoom.set(ws, { code, index });
}

// RP computation per spec.
function computeRp(myRank: number, oppRank: number, won: boolean): number {
  const D = oppRank - myRank;
  if (won) {
    if (D === 0) return 10;
    if (D > 0) return 10 + D * 2;
    return Math.max(1, 10 - Math.abs(D) * 2);
  }
  // loss
  if (myRank >= 1 && myRank <= 5) return 0;
  if (myRank >= 6 && myRank <= 10) return -5;
  return -10;
}

// Bonuses awarded to the winner based on match performance.
function computeWinnerBonuses(stats: MatchStats): BonusEntry[] {
  const bonuses: BonusEntry[] = [];
  const s = stats || {};

  // No-damage and near-death comeback are mutually exclusive.
  if (!s.tookDamage) {
    bonuses.push({ label: "🛡️ ノーダメージ勝利", rp: 3 });
  } else if (s.wasNearDeath) {
    bonuses.push({ label: "💥 逆転勝ち", rp: 2 });
  }
  if ((s.totalDamageDealt ?? 0) >= 20) {
    bonuses.push({ label: "⚔️ 大ダメージ", rp: 2 });
  }
  if ((s.turnCount ?? 999) <= 8) {
    bonuses.push({ label: "⚡ 早期決着", rp: 2 });
  }
  if ((s.abilityUseCount ?? 999) <= 1) {
    bonuses.push({ label: "🎯 アビリティ節約", rp: 1 });
  }
  if (!s.skillUsed) {
    bonuses.push({ label: "🔒 スキル温存", rp: 1 });
  }
  const streak = s.winStreak ?? 0;
  if (streak >= 5) {
    bonuses.push({ label: `🔥 ${streak}連勝`, rp: 3 });
  } else if (streak >= 3) {
    bonuses.push({ label: `🔥 ${streak}連勝`, rp: 2 });
  } else if (streak >= 2) {
    bonuses.push({ label: `🔥 ${streak}連勝`, rp: 1 });
  }

  // Cap total bonus at +8.
  let total = bonuses.reduce((a, b) => a + b.rp, 0);
  if (total > 8) {
    let excess = total - 8;
    for (let i = bonuses.length - 1; i >= 0 && excess > 0; i--) {
      const cut = Math.min(bonuses[i]!.rp, excess);
      bonuses[i]!.rp -= cut;
      excess -= cut;
    }
  }
  return bonuses.filter((b) => b.rp > 0);
}

// RP adjustments awarded to the loser (reduce the RP loss).
function computeLossAdjustments(
  stats: MatchStats,
  opponentTurnCount?: number
): BonusEntry[] {
  const bonuses: BonusEntry[] = [];
  const s = stats || {};
  // 接戦ボーナス: close match — game lasted 15+ turns.
  const tc = s.turnCount ?? opponentTurnCount ?? 0;
  if (tc >= 15) {
    bonuses.push({ label: "🤝 接戦ボーナス", rp: 2 });
  }
  // 敵陣突破ボーナス: loser reached enemy territory at some point.
  if (s.reachedEnemyTerritory) {
    bonuses.push({ label: "🏃 敵陣突破", rp: 2 });
  }
  return bonuses;
}

function finishRanked(
  room: Room,
  winnerIndex: number,
  winnerStats?: MatchStats,
  loserStats?: MatchStats
) {
  if (room.status === "finished") return;
  room.status = "finished";
  const w = room.players[winnerIndex];
  const l = room.players[winnerIndex === 0 ? 1 : 0];
  if (!w || !l) return;

  if (room.pendingGameEndTimer) {
    clearTimeout(room.pendingGameEndTimer);
    room.pendingGameEndTimer = null;
  }

  if (room.isRanked) {
    const baseWDelta = computeRp(w.rank, l.rank, true);
    const baseLDelta = computeRp(l.rank, w.rank, false);

    const wBonuses = computeWinnerBonuses(winnerStats || {});
    const lAdjustments = computeLossAdjustments(
      loserStats || {},
      winnerStats?.turnCount
    );

    const wBonusTotal = wBonuses.reduce((a, b) => a + b.rp, 0);
    const lAdjTotal = lAdjustments.reduce((a, b) => a + b.rp, 0);

    const wDelta = baseWDelta + wBonusTotal;
    const lDelta = baseLDelta + lAdjTotal;

    // Authoritatively increment wins/losses in DB (fire-and-forget)
    if (w.userId && w.userId !== "anon") {
      db.update(ekPlayersTable)
        .set({ wins: sql`${ekPlayersTable.wins} + 1` })
        .where(eq(ekPlayersTable.userId, w.userId))
        .catch((e) => logger.warn({ err: e }, "Failed to increment wins"));
    }
    if (l.userId && l.userId !== "anon") {
      db.update(ekPlayersTable)
        .set({ losses: sql`${ekPlayersTable.losses} + 1` })
        .where(eq(ekPlayersTable.userId, l.userId))
        .catch((e) => logger.warn({ err: e }, "Failed to increment losses"));
    }

    safeSend(w.ws, {
      type: "rankResult",
      won: true,
      rpDelta: wDelta,
      baseRpDelta: baseWDelta,
      bonuses: wBonuses,
      ranked: true,
    });
    safeSend(l.ws, {
      type: "rankResult",
      won: false,
      rpDelta: lDelta,
      baseRpDelta: baseLDelta,
      bonuses: lAdjustments,
      ranked: true,
    });
  } else {
    safeSend(w.ws, { type: "rankResult", won: true, rpDelta: 0, bonuses: [], ranked: false });
    safeSend(l.ws, { type: "rankResult", won: false, rpDelta: 0, bonuses: [], ranked: false });
  }
  // Terminal cleanup: clear any pending grace timer and drop the room shortly
  // after results are delivered, so finished rooms are not retained forever.
  if (room.suspendTimer) {
    clearTimeout(room.suspendTimer);
    room.suspendTimer = null;
  }
  setTimeout(() => {
    rooms.delete(room.code);
  }, 5000);
}

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = request.url || "";
  if (url === "/ws" || url === "/api/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Keepalive: track liveness with WS-level ping frames (handles proxy keepalive).
// Any client that does not reply with a pong within the interval is terminated.
const wsAlive = new WeakMap<WebSocket, boolean>();

const pingInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (wsAlive.get(client) === false) {
      // No pong received since last ping — connection is dead.
      logger.warn("WebSocket client timed out, terminating");
      client.terminate();
      return;
    }
    wsAlive.set(client, false);
    client.ping();
  });
}, 15000);

wss.on("close", () => {
  clearInterval(pingInterval);
});

wss.on("connection", (ws: WebSocket) => {
  // Mark alive on connect; updated on each pong reply.
  wsAlive.set(ws, true);
  ws.on("pong", () => { wsAlive.set(ws, true); });

  let playerIndex = -1;
  let myRoomCode = "";

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;

      if (msg.type === "create") {
        const code = generateRoomCode();
        const sessionId = randomUUID();
        rooms.set(code, makeRoom(code, {
          players: [
            {
              ws,
              sessionId,
              userId: String(msg.userId || "anon"),
              rank: Number(msg.rank || 1),
              playerName: String(msg.playerName || "プレイヤー"),
            },
            null,
          ],
          settings: msg.settings as Record<string, unknown>,
          status: "waiting",
        }));
        playerIndex = 0;
        myRoomCode = code;
        attachRoom(ws, code, 0);
        safeSend(ws, { type: "roomCreated", roomCode: code, sessionId });
        logger.info({ code }, "Room created");
      } else if (msg.type === "join") {
        const code = String(msg.roomCode || "").toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          safeSend(ws, { type: "error", message: "ルームが見つかりません" });
          return;
        }
        if (room.players[1]) {
          safeSend(ws, { type: "error", message: "ルームが満員です" });
          return;
        }
        const sessionId = randomUUID();
        room.players[1] = {
          ws,
          sessionId,
          userId: String(msg.userId || "anon"),
          rank: Number(msg.rank || 1),
          playerName: String(msg.playerName || "プレイヤー"),
        };
        room.status = "playing";
        playerIndex = 1;
        myRoomCode = code;
        attachRoom(ws, code, 1);
        if (room.settings && msg.guestJob) {
          (room.settings as Record<string, unknown>)["p2job"] = msg.guestJob;
        }
        safeSend(room.players[0]?.ws ?? null, {
          type: "gameStart",
          playerIndex: 0,
          settings: room.settings,
          sessionId: room.players[0]?.sessionId,
          roomCode: code,
          ranked: false,
          opponentRank: room.players[1]?.rank ?? 1,
          opponentName: room.players[1]?.playerName ?? "プレイヤー",
        });
        safeSend(ws, {
          type: "gameStart",
          playerIndex: 1,
          settings: room.settings,
          sessionId,
          roomCode: code,
          ranked: false,
          opponentRank: room.players[0]?.rank ?? 1,
          opponentName: room.players[0]?.playerName ?? "プレイヤー",
        });
        logger.info({ code }, "Room started");
      } else if (msg.type === "findRanked") {
        // Use async IIFE so we can await the DB friend fetch before the entry
        // becomes match-eligible. A 800 ms timeout prevents DB latency from
        // blocking queue entry; on timeout/error friends defaults to [].
        (async () => {
          const _uid = String(msg.userId || "anon");
          let _friends: string[] = [];
          try {
            const _res = await Promise.race([
              db.execute(sql`
                SELECT DISTINCT friend_user_id AS fid FROM ek_friends WHERE user_id = ${_uid}
                UNION
                SELECT DISTINCT user_id AS fid FROM ek_friends WHERE friend_user_id = ${_uid}
              `),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("friend-fetch timeout")), 800)
              ),
            ]);
            _friends = (_res.rows as Array<{ fid: string }>).map((r) => String(r.fid));
          } catch {
            // timeout or DB error → friends = [], falls back to normal matching
          }
          const entry: QueueEntry = {
            ws,
            sessionId: randomUUID(),
            userId: _uid,
            rank: Number(msg.rank || 1),
            job: String(msg.job || "king"),
            playerName: String(msg.playerName || "プレイヤー"),
            profileIcon: typeof msg.profileIcon === "string" ? String(msg.profileIcon).slice(0, 8) : "🎮",
            favorites: Array.isArray(msg.favorites) ? (msg.favorites as unknown[]).map(String).slice(0, 100) : [],
            friends: _friends,
            ts: Date.now(),
            searchTimer: null,
          };
          // Avoid duplicate queue entries for the same socket; clear its timer.
          const existing = queue.findIndex((q) => q.ws === ws);
          if (existing >= 0) {
            if (queue[existing]?.searchTimer)
              clearInterval(queue[existing]!.searchTimer!);
            queue.splice(existing, 1);
          }
          // Only enqueue if socket is still open and player hasn't cancelled during fetch
          if (ws.readyState !== WebSocket.OPEN || cancelledFriendFetch.delete(ws)) return;
          queue.push(entry);
          safeSend(ws, { type: "searching" });
          entry.searchTimer = setInterval(tryMatch, 2000);
          tryMatch();
        })().catch(console.error);
      } else if (msg.type === "cancelRanked") {
        // Mark as cancelled so any in-flight friend-fetch async IIFE won't enqueue
        cancelledFriendFetch.add(ws);
        const idx = queue.findIndex((q) => q.ws === ws);
        if (idx >= 0) {
          if (queue[idx]?.searchTimer) clearInterval(queue[idx]!.searchTimer!);
          queue.splice(idx, 1);
        }
      } else if (msg.type === "resume") {
        // Reconnection: rebind to suspended room by sessionId.
        const sessionId = String(msg.sessionId || "");
        let found: Room | null = null;
        let idx = -1;
        for (const room of rooms.values()) {
          // Only suspended rooms are eligible for reconnect.
          if (room.status !== "suspended") continue;
          for (let k = 0; k < 2; k++) {
            if (room.players[k]?.sessionId === sessionId) {
              found = room;
              idx = k;
            }
          }
        }
        if (found && idx >= 0) {
          found.players[idx]!.ws = ws;
          playerIndex = idx;
          myRoomCode = found.code;
          attachRoom(ws, found.code, idx);
          if (found.suspendTimer) {
            clearTimeout(found.suspendTimer);
            found.suspendTimer = null;
          }
          found.status = "playing";
          safeSend(ws, { type: "resumed", playerIndex: idx });
          // Ask the other player to resend the latest state for full sync.
          const other = found.players[idx === 0 ? 1 : 0];
          safeSend(other?.ws ?? null, { type: "peerReconnected" });
          // If we already cached a state, send it immediately too.
          if (found.lastState) {
            safeSend(ws, { type: "stateSync", state: found.lastState });
          }
          logger.info({ code: found.code }, "Player resumed");
        } else {
          safeSend(ws, { type: "resumeFailed" });
        }
      } else if (msg.type === "clientPing") {
        // Echo the client's timestamp straight back — client computes RTT = now - clientTs.
        safeSend(ws, { type: "clientPong", clientTs: msg.clientTs });
      } else if (
        ["stateSync", "turnEnd", "chat", "emote"].includes(String(msg.type))
      ) {
        const room = rooms.get(myRoomCode);
        if (!room) return;
        if (msg.type === "stateSync") room.lastState = msg.state;
        const otherIdx = playerIndex === 0 ? 1 : 0;
        safeSend(room.players[otherIdx]?.ws ?? null, msg);
      } else if (msg.type === "gameEnd") {
        const room = rooms.get(myRoomCode);
        if (!room || room.status === "finished") return;

        const won = msg.won === true;
        const matchStats = (msg.matchStats as MatchStats) || {};

        // Store this player's report.
        room.pendingGameEnd.set(playerIndex, { won, matchStats });

        // First report determines the winner index.
        if (room.resolvedWinnerIndex === -1) {
          room.resolvedWinnerIndex = won
            ? playerIndex
            : playerIndex === 0
            ? 1
            : 0;
        }
        const winnerIndex = room.resolvedWinnerIndex;

        if (room.pendingGameEnd.size >= 2) {
          // Both players reported — finalize immediately.
          if (room.pendingGameEndTimer) {
            clearTimeout(room.pendingGameEndTimer);
            room.pendingGameEndTimer = null;
          }
          const wStats = room.pendingGameEnd.get(winnerIndex)?.matchStats;
          const lStats = room.pendingGameEnd.get(winnerIndex === 0 ? 1 : 0)?.matchStats;
          finishRanked(room, winnerIndex, wStats, lStats);
        } else if (!room.pendingGameEndTimer) {
          // Wait up to 3s for the second player's report.
          room.pendingGameEndTimer = setTimeout(() => {
            if (room.status === "finished") return;
            const wStats = room.pendingGameEnd.get(winnerIndex)?.matchStats;
            const lStats = room.pendingGameEnd.get(winnerIndex === 0 ? 1 : 0)?.matchStats;
            finishRanked(room, winnerIndex, wStats, lStats);
          }, 3000);
        }
      } else if (msg.type === "leave") {
        const room = rooms.get(myRoomCode);
        if (room) {
          const otherIdx = playerIndex === 0 ? 1 : 0;
          safeSend(room.players[otherIdx]?.ws ?? null, { type: "opponentLeft" });
          rooms.delete(myRoomCode);
        }
      }
    } catch (e) {
      logger.error({ e }, "WebSocket message error");
    }
  });

  ws.on("close", () => {
    // Remove from matchmaking queue if waiting.
    cancelledFriendFetch.delete(ws); // clean up any pending fetch cancellation flag
    const qIdx = queue.findIndex((q) => q.ws === ws);
    if (qIdx >= 0) {
      if (queue[qIdx]?.searchTimer) clearInterval(queue[qIdx]!.searchTimer!);
      queue.splice(qIdx, 1);
    }

    const room = rooms.get(myRoomCode);
    if (!room) return;

    if (room.status === "waiting") {
      // No opponent yet; just drop the room.
      rooms.delete(myRoomCode);
      return;
    }

    if (room.status === "finished") return;

    // Mark suspended and start a grace timer for reconnection.
    room.status = "suspended";
    const otherIdx = playerIndex === 0 ? 1 : 0;
    safeSend(room.players[otherIdx]?.ws ?? null, {
      type: "opponentSuspended",
      graceMs: RECONNECT_GRACE_MS,
    });
    logger.info({ code: room.code }, "Player disconnected, room suspended");

    room.suspendTimer = setTimeout(() => {
      if (room.status !== "suspended") return;
      // Grace expired: remaining player wins by forfeit.
      const remaining = room.players[otherIdx];
      if (remaining?.ws) {
        finishRanked(room, otherIdx);
        safeSend(remaining.ws, { type: "opponentLeft", forfeit: true });
      }
      rooms.delete(room.code);
      logger.info({ code: room.code }, "Room closed after grace expired");
    }, RECONNECT_GRACE_MS);
  });
});

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening (HTTP + WebSocket)");
});
