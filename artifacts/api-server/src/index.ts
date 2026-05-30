import app from "./app";
import { logger } from "./lib/logger";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";

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

interface PlayerSlot {
  ws: WebSocket | null;
  sessionId: string;
  userId: string;
  rank: number;
}

interface Room {
  code: string;
  players: [PlayerSlot | null, PlayerSlot | null];
  settings: Record<string, unknown> | null;
  isRanked: boolean;
  status: "waiting" | "playing" | "suspended" | "finished";
  lastState: unknown;
  suspendTimer: NodeJS.Timeout | null;
}

interface QueueEntry {
  ws: WebSocket;
  sessionId: string;
  userId: string;
  rank: number;
  job: string;
  ts: number;
  searchTimer: NodeJS.Timeout | null;
}

const rooms = new Map<string, Room>();
const queue: QueueEntry[] = [];
// userId -> last opponents (most recent first), for anti-boosting
const recentOpponents = new Map<string, string[]>();
const RECONNECT_GRACE_MS = 60000; // 1 minute to reconnect before forfeit

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++)
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
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    if (!a || a.ws.readyState !== WebSocket.OPEN) continue;
    const aWin = rankWindow(now - a.ts);
    for (let j = i + 1; j < queue.length; j++) {
      const b = queue[j];
      if (!b || b.ws.readyState !== WebSocket.OPEN) continue;
      const bWin = rankWindow(now - b.ts);
      const window = Math.min(aWin, bWin);
      if (Math.abs(a.rank - b.rank) <= window) {
        startRankedMatch(a, b);
        queue.splice(j, 1);
        queue.splice(i, 1);
        return tryMatch();
      }
    }
  }
}

function startRankedMatch(a: QueueEntry, b: QueueEntry) {
  if (a.searchTimer) clearInterval(a.searchTimer);
  if (b.searchTimer) clearInterval(b.searchTimer);
  const code = generateRoomCode();
  // Same userId rematched within last 2 games => no RP movement.
  const isRanked = !playedRecently(a.userId, b.userId);
  recordOpponents(a.userId, b.userId);
  const hostFirst = Math.random() < 0.5;
  const settings = {
    p1job: a.job,
    p2job: b.job,
    stage: "plains",
    difficulty: "1",
    seed: Math.floor(Math.random() * 0x7fffffff),
    p1First: hostFirst,
    ranked: isRanked,
  };
  rooms.set(code, {
    code,
    players: [
      { ws: a.ws, sessionId: a.sessionId, userId: a.userId, rank: a.rank },
      { ws: b.ws, sessionId: b.sessionId, userId: b.userId, rank: b.rank },
    ],
    settings,
    isRanked,
    status: "playing",
    lastState: null,
    suspendTimer: null,
  });
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
  });
  safeSend(b.ws, {
    type: "gameStart",
    playerIndex: 1,
    settings,
    sessionId: b.sessionId,
    roomCode: code,
    ranked: isRanked,
    opponentRank: a.rank,
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

function finishRanked(room: Room, winnerIndex: number) {
  if (room.status === "finished") return;
  room.status = "finished";
  const w = room.players[winnerIndex];
  const l = room.players[winnerIndex === 0 ? 1 : 0];
  if (!w || !l) return;
  if (room.isRanked) {
    const wDelta = computeRp(w.rank, l.rank, true);
    const lDelta = computeRp(l.rank, w.rank, false);
    safeSend(w.ws, { type: "rankResult", won: true, rpDelta: wDelta, ranked: true });
    safeSend(l.ws, { type: "rankResult", won: false, rpDelta: lDelta, ranked: true });
  } else {
    safeSend(w.ws, { type: "rankResult", won: true, rpDelta: 0, ranked: false });
    safeSend(l.ws, { type: "rankResult", won: false, rpDelta: 0, ranked: false });
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

// Keepalive: ping every 25 s so proxies/load balancers don't kill idle sockets.
const pingInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.ping();
  });
}, 25000);
wss.on("close", () => clearInterval(pingInterval));

wss.on("connection", (ws: WebSocket) => {
  let playerIndex = -1;
  let myRoomCode = "";

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;

      if (msg.type === "create") {
        const code = generateRoomCode();
        const sessionId = randomUUID();
        rooms.set(code, {
          code,
          players: [
            {
              ws,
              sessionId,
              userId: String(msg.userId || "anon"),
              rank: Number(msg.rank || 1),
            },
            null,
          ],
          settings: msg.settings as Record<string, unknown>,
          isRanked: false,
          status: "waiting",
          lastState: null,
          suspendTimer: null,
        });
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
        });
        safeSend(ws, {
          type: "gameStart",
          playerIndex: 1,
          settings: room.settings,
          sessionId,
          roomCode: code,
          ranked: false,
        });
        logger.info({ code }, "Room started");
      } else if (msg.type === "findRanked") {
        const entry: QueueEntry = {
          ws,
          sessionId: randomUUID(),
          userId: String(msg.userId || "anon"),
          rank: Number(msg.rank || 1),
          job: String(msg.job || "king"),
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
        queue.push(entry);
        safeSend(ws, { type: "searching" });
        entry.searchTimer = setInterval(tryMatch, 2000);
        tryMatch();
      } else if (msg.type === "cancelRanked") {
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
      } else if (
        ["stateSync", "turnEnd", "chat"].includes(String(msg.type))
      ) {
        const room = rooms.get(myRoomCode);
        if (!room) return;
        if (msg.type === "stateSync") room.lastState = msg.state;
        const otherIdx = playerIndex === 0 ? 1 : 0;
        safeSend(room.players[otherIdx]?.ws ?? null, msg);
      } else if (msg.type === "gameEnd") {
        // Sender reports they won (won:true) or lost.
        const room = rooms.get(myRoomCode);
        if (!room) return;
        const won = msg.won === true;
        const winnerIndex = won ? playerIndex : playerIndex === 0 ? 1 : 0;
        finishRanked(room, winnerIndex);
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
