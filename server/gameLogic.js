// ============================================================
// WAR BATTLEGROUND — shared game logic (board graph + rules)
// Used identically by the client (for instant UI feedback) and
// the server (as the single source of truth / anti-cheat check).
// ============================================================

function buildBoard() {
  const nodes = {
    1:{x:120,y:150},2:{x:210,y:150},3:{x:300,y:150},4:{x:390,y:150},5:{x:480,y:150},
    6:{x:120,y:240},7:{x:210,y:240},8:{x:300,y:240},9:{x:390,y:240},10:{x:480,y:240},
    11:{x:120,y:330},12:{x:210,y:330},13:{x:300,y:330},14:{x:390,y:330},15:{x:480,y:330},
    16:{x:120,y:420},17:{x:210,y:420},18:{x:300,y:420},19:{x:390,y:420},20:{x:480,y:420},
    21:{x:120,y:510},22:{x:210,y:510},23:{x:300,y:510},24:{x:390,y:510},25:{x:480,y:510},
    29:{x:360,y:90},30:{x:300,y:90},31:{x:240,y:90},35:{x:210,y:60},36:{x:300,y:60},37:{x:390,y:60},38:{x:180,y:30},39:{x:300,y:30},40:{x:420,y:30},
    41:{x:300,y:540},42:{x:300,y:570},43:{x:300,y:600},44:{x:360,y:540},46:{x:240,y:540},47:{x:210,y:570},48:{x:390,y:570},49:{x:420,y:600},50:{x:180,y:600},
  };

  const edgeSet = new Set();
  const addEdge = (a, b) => { edgeSet.add(`${a}|${b}`); edgeSet.add(`${b}|${a}`); }; // bidirectional
  const addDirected = (a, b) => { edgeSet.add(`${a}|${b}`); }; // one-way "vector" (top -> bottom flow)

  // main grid: horizontal + vertical rows/cols, bidirectional
  for (let r = 0; r < 5; r++) { const row = [1,2,3,4,5].map(c => c + r*5); for (let i=0;i<4;i++) addEdge(row[i], row[i+1]); }
  for (let c = 0; c < 5; c++) { const col = [1,6,11,16,21].map(r => r + c); for (let i=0;i<4;i++) addEdge(col[i], col[i+1]); }

  // corner-to-corner + inner-diamond diagonals, subdivided through their true intermediate nodes, directional top->bottom
  addDirected(1,7); addDirected(7,13); addDirected(13,19); addDirected(19,25);
  addDirected(3,7); addDirected(7,11);
  addDirected(5,9); addDirected(9,13); addDirected(13,17); addDirected(17,21);
  addDirected(11,17); addDirected(17,23);
  addDirected(3,9); addDirected(9,15);
  addDirected(15,19); addDirected(19,23);

  // top funnel: 3 widening rows (apex fan -> row90 -> row60 -> row30 base), directional base->apex on diagonals
  addEdge(31,30); addEdge(29,30);            // row90 rung
  addEdge(35,36); addEdge(36,37);            // row60 rung
  addEdge(38,39); addEdge(39,40);            // base rung
  addDirected(31,3); addDirected(29,3); addEdge(30,3); // apex fan (side spokes directional, center vertical bidirectional)
  addDirected(35,31); addDirected(37,29); addEdge(36,30); // row60->row90
  addDirected(38,35); addDirected(40,37); addEdge(39,36); // base->row60

  // bottom funnel mirror: subdivided through 42/47/48/43, directional apex->base on diagonals
  addEdge(46,41); addEdge(41,44);            // row540 rung
  addEdge(47,42); addEdge(42,48);            // row570 rung
  addEdge(50,43); addEdge(43,49);            // base rung
  addDirected(23,46); addDirected(23,44); addEdge(23,41); // apex fan
  addDirected(46,47); addDirected(44,48); addEdge(41,42); // row540->row570
  addDirected(47,50); addDirected(48,49); addEdge(42,43); // row570->base

  return { nodes, edgeSet };
}

const { nodes: NODES, edgeSet: EDGES } = buildBoard();
const NODE_IDS = Object.keys(NODES).map(Number);
const COORD_TO_ID = {};
for (const id of NODE_IDS) { const { x, y } = NODES[id]; COORD_TO_ID[`${x}_${y}`] = id; }

function hasEdge(a, b) { return EDGES.has(`${a}|${b}`); }

function initialBoard() {
  const board = {};
  for (const id of NODE_IDS) {
    const { x, y } = NODES[id];
    if (x === 300 && y === 330) { board[id] = null; continue; } // true center (node 13) is empty
    if (y < 330) board[id] = "A";
    else if (y > 330) board[id] = "B";
    else board[id] = x < 300 ? "A" : "B"; // y === 330 row: left two = A, right two = B
  }
  return board;
}

function getJumpTarget(fromId, midId) {
  const f = NODES[fromId], m = NODES[midId];
  const tx = 2 * m.x - f.x, ty = 2 * m.y - f.y;
  const toId = COORD_TO_ID[`${tx}_${ty}`];
  if (toId === undefined) return null;
  if (!hasEdge(midId, toId)) return null;
  return toId;
}

function neighborsOf(id) {
  const out = [];
  for (const other of NODE_IDS) if (hasEdge(id, other)) out.push(other);
  return out;
}
const NEIGHBOR_CACHE = {};
NODE_IDS.forEach(id => { NEIGHBOR_CACHE[id] = neighborsOf(id); });

function getCapturesFor(board, id, player) {
  const opp = player === "A" ? "B" : "A";
  const caps = [];
  for (const mid of NEIGHBOR_CACHE[id]) {
    if (board[mid] === opp) {
      const to = getJumpTarget(id, mid);
      if (to && board[to] === null) caps.push({ to, captured: mid });
    }
  }
  return caps;
}

function getMovesFor(board, id) {
  return NEIGHBOR_CACHE[id].filter(n => board[n] === null);
}

function anyCaptureAvailable(board, player) {
  for (const id of NODE_IDS) {
    if (board[id] === player && getCapturesFor(board, id, player).length) return true;
  }
  return false;
}

function playerHasAnyMove(board, player) {
  for (const id of NODE_IDS) {
    if (board[id] !== player) continue;
    if (getCapturesFor(board, id, player).length) return true;
    if (getMovesFor(board, id).length) return true;
  }
  return false;
}

function countPieces(board) {
  let a = 0, b = 0;
  for (const id of NODE_IDS) { if (board[id] === "A") a++; else if (board[id] === "B") b++; }
  return { a, b };
}

// Validates and applies a single step (move or one jump) for `player`.
// `forcedPiece` (if set) means the player is mid chain-jump and MUST move that piece.
// Returns { ok, board, nextTurn, forcedPiece, winner, error }
function applyStep(board, player, fromId, toId, forcedPiece) {
  if (!NODES[fromId] || !NODES[toId]) return { ok: false, error: "invalid node" };
  if (board[fromId] !== player) return { ok: false, error: "not your piece" };
  if (forcedPiece && fromId !== forcedPiece) return { ok: false, error: "must continue chain jump with the same piece" };

  const captureRequired = anyCaptureAvailable(board, player);
  const caps = getCapturesFor(board, fromId, player);
  const capMatch = caps.find(c => c.to === toId);

  let newBoard = { ...board };
  let isCapture = false;

  if (capMatch) {
    isCapture = true;
    newBoard[toId] = newBoard[fromId];
    newBoard[fromId] = null;
    newBoard[capMatch.captured] = null;
  } else {
    if (forcedPiece) return { ok: false, error: "must capture again" };
    if (captureRequired) return { ok: false, error: "capture is mandatory this turn" };
    const moves = getMovesFor(board, fromId);
    if (!moves.includes(toId)) return { ok: false, error: "illegal move" };
    newBoard[toId] = newBoard[fromId];
    newBoard[fromId] = null;
  }

  let capturedId = null;
  if (isCapture) {
    capturedId = capMatch.captured;
    const further = getCapturesFor(newBoard, toId, player);
    if (further.length > 0) {
      return { ok: true, board: newBoard, nextTurn: player, forcedPiece: toId, winner: null, captured: capturedId, from: fromId, to: toId };
    }
  }

  const nextTurn = player === "A" ? "B" : "A";
  const { a, b } = countPieces(newBoard);
  let winner = null;
  if (a === 0) winner = "B";
  else if (b === 0) winner = "A";
  else if (!playerHasAnyMove(newBoard, nextTurn)) {
    winner = a === b ? "Draw" : (a > b ? "A" : "B");
  }

  return { ok: true, board: newBoard, nextTurn, forcedPiece: null, winner, captured: capturedId, from: fromId, to: toId };
}

// ---------- Simple AI ----------
// Explores complete moves (including forced chain-jump sequences) and scores
// the resulting position by material difference, with a light 1-ply lookahead
// for the opponent's best immediate reply, to avoid obviously blundering pieces.
function collectFullMoves(board, player, fromId, forced) {
  const results = [];
  const ids = forced ? [forced] : NODE_IDS.filter(id => board[id] === player);
  const captureReq = forced ? true : anyCaptureAvailable(board, player);

  for (const id of ids) {
    const caps = getCapturesFor(board, id, player);
    if (captureReq || caps.length) {
      for (const c of caps) {
        const r = applyStep(board, player, id, c.to, forced || null);
        if (!r.ok) continue;
        if (r.forcedPiece) {
          const deeper = collectFullMoves(r.board, player, null, r.forcedPiece);
          for (const d of deeper) results.push({ path: [{ from: id, to: c.to, captured: r.captured }, ...d.path], finalBoard: d.finalBoard, nextTurn: d.nextTurn, winner: d.winner });
        } else {
          results.push({ path: [{ from: id, to: c.to, captured: r.captured }], finalBoard: r.board, nextTurn: r.nextTurn, winner: r.winner });
        }
      }
    }
    if (!captureReq && !forced) {
      for (const to of getMovesFor(board, id)) {
        const r = applyStep(board, player, id, to, null);
        if (r.ok) results.push({ path: [{ from: id, to, captured: null }], finalBoard: r.board, nextTurn: r.nextTurn, winner: r.winner });
      }
    }
  }
  return results;
}

function scorePosition(board, aiPlayer) {
  const opp = aiPlayer === "A" ? "B" : "A";
  const { a, b } = countPieces(board);
  const mine = aiPlayer === "A" ? a : b;
  const theirs = aiPlayer === "A" ? b : a;
  let best = 0;
  const oppMoves = collectFullMoves(board, opp, null, null);
  for (const m of oppMoves) {
    const captures = m.path.filter(s => s.captured).length;
    if (captures > best) best = captures;
  }
  return (mine - theirs) * 10 - best * 4;
}

function getAIMove(board, aiPlayer, difficulty = "medium") {
  const moves = collectFullMoves(board, aiPlayer, null, null);
  if (moves.length === 0) return null;
  if (difficulty === "easy") {
    // mostly random, but still takes free captures most of the time
    const captureMoves = moves.filter(m => m.path.some(s => s.captured));
    const pool = captureMoves.length && Math.random() < 0.6 ? captureMoves : moves;
    return pool[Math.floor(Math.random() * pool.length)].path;
  }
  const randomness = difficulty === "hard" ? 0.5 : 2.5;
  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    const score = scorePosition(m.finalBoard, aiPlayer) + Math.random() * randomness;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best.path;
}

export {
  NODES, NODE_IDS, EDGES, hasEdge,
  initialBoard, getJumpTarget, getCapturesFor, getMovesFor,
  anyCaptureAvailable, playerHasAnyMove, countPieces, applyStep,
  getAIMove,
};
