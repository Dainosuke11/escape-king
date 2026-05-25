import app from "./app";
import { logger } from "./lib/logger";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

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

interface Room {
  players: [WebSocket | null, WebSocket | null];
  settings: Record<string, unknown> | null;
}

const rooms = new Map<string, Room>();

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

wss.on("connection", (ws: WebSocket) => {
  let playerIndex = -1;
  let myRoomCode = "";

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;

      if (msg.type === "create") {
        const code = generateRoomCode();
        rooms.set(code, {
          players: [ws, null],
          settings: msg.settings as Record<string, unknown>,
        });
        playerIndex = 0;
        myRoomCode = code;
        safeSend(ws, { type: "roomCreated", roomCode: code });
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
        room.players[1] = ws;
        playerIndex = 1;
        myRoomCode = code;
        // Update settings with guest's job selection
        if (room.settings && msg.guestJob) {
          (room.settings as Record<string, unknown>)["p2job"] = msg.guestJob;
        }
        safeSend(room.players[0], {
          type: "gameStart",
          playerIndex: 0,
          settings: room.settings,
        });
        safeSend(ws, {
          type: "gameStart",
          playerIndex: 1,
          settings: room.settings,
        });
        logger.info({ code }, "Room started");
      } else if (
        ["stateSync", "turnEnd", "chat", "opponentLeft"].includes(
          String(msg.type),
        )
      ) {
        const room = rooms.get(myRoomCode);
        if (!room) return;
        const otherIdx = playerIndex === 0 ? 1 : 0;
        safeSend(room.players[otherIdx], msg);
      }
    } catch (e) {
      logger.error({ e }, "WebSocket message error");
    }
  });

  ws.on("close", () => {
    const room = rooms.get(myRoomCode);
    if (room) {
      const otherIdx = playerIndex === 0 ? 1 : 0;
      safeSend(room.players[otherIdx], { type: "opponentLeft" });
      rooms.delete(myRoomCode);
      logger.info({ myRoomCode }, "Room deleted due to disconnect");
    }
  });
});

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening (HTTP + WebSocket)");
});
