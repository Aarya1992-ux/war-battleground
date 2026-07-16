import { WebSocketServer } from "ws";
import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initialBoard, applyStep } from "./gameLogic.js";
import apiRouter from "./api.js";

dotenv.config();

const PORT = process.env.PORT || 8080;

// rooms: { code: { players: { A: ws|null, B: ws|null }, board, turn, forcedPiece, winner, lastMove, seq } }
const rooms = {};

function genCode() {
  let code;
  do { code = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (rooms[code]);
  return code;
}

function broadcast(room) {
  const payload = JSON.stringify({
    type: "state",
    board: room.board,
    turn: room.turn,
    forcedPiece: room.forcedPiece,
    winner: room.winner,
    lastMove: room.lastMove ? { ...room.lastMove, _seq: room.seq } : null,
  });
  for (const side of ["A", "B"]) {
    const ws = room.players[side];
    if (ws && ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

const app = express();
app.use(cors());
app.get("/", (req, res) => res.send("War Battleground server is running.\n"));
app.use("/api", apiRouter);
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.roomCode = null;
  ws.side = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "create") {
      const code = genCode();
      rooms[code] = {
        players: { A: ws, B: null },
        board: initialBoard(),
        turn: "A",
        forcedPiece: null,
        winner: null,
        lastMove: null,
        seq: 0,
      };
      ws.roomCode = code;
      ws.side = "A";
      send(ws, { type: "joined", roomCode: code, side: "A" });
      broadcast(rooms[code]);
      return;
    }

    if (msg.type === "join") {
      const code = (msg.roomCode || "").toUpperCase();
      const room = rooms[code];
      if (!room) { send(ws, { type: "error", error: "Room not found" }); return; }
      if (room.players.B) { send(ws, { type: "error", error: "Room already full" }); return; }
      room.players.B = ws;
      ws.roomCode = code;
      ws.side = "B";
      send(ws, { type: "joined", roomCode: code, side: "B" });
      broadcast(room);
      return;
    }

    if (msg.type === "move") {
      const room = rooms[ws.roomCode];
      if (!room || room.winner) return;
      if (ws.side !== room.turn) { send(ws, { type: "error", error: "Not your turn" }); return; }

      const result = applyStep(room.board, ws.side, msg.from, msg.to, room.forcedPiece);
      if (!result.ok) { send(ws, { type: "error", error: result.error }); return; }

      room.board = result.board;
      room.turn = result.nextTurn;
      room.forcedPiece = result.forcedPiece;
      room.winner = result.winner;
      room.lastMove = { from: result.from, to: result.to, captured: result.captured };
      room.seq += 1;
      broadcast(room);
      return;
    }

    if (msg.type === "reset") {
      const room = rooms[ws.roomCode];
      if (!room) return;
      room.board = initialBoard();
      room.turn = "A";
      room.forcedPiece = null;
      room.winner = null;
      room.lastMove = null;
      room.seq += 1;
      broadcast(room);
      return;
    }
  });

  ws.on("close", () => {
    const room = rooms[ws.roomCode];
    if (!room) return;
    if (room.players.A === ws) room.players.A = null;
    if (room.players.B === ws) room.players.B = null;
    // clean up empty rooms
    if (!room.players.A && !room.players.B) delete rooms[ws.roomCode];
  });
});

server.listen(PORT, () => {
  console.log(`War Battleground server listening on port ${PORT}`);
});
