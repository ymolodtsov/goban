#!/usr/bin/env node
// Headless Goban simulator — runs N games, prints aggregate stats.
// Usage: node sim.mjs [numGames=50]

// ── Constants & shapes ──────────────────────────────────────────────
const BOARD_SIZE = 9, WIN_SCORE = 20;
const EMPTY = 0, BLACK = 1, WHITE = 2, LOCKED_BLACK = 3, LOCKED_WHITE = 4;
const AI_TEMPERATURE = 1.2;

const SHAPE_DEFS = {
  I: [[0,0],[0,1],[0,2],[0,3]],
  O: [[0,0],[0,1],[1,0],[1,1]],
  T: [[0,0],[0,1],[0,2],[1,1]],
  S: [[0,0],[0,1],[1,1],[1,2]],
  Z: [[0,1],[0,2],[1,0],[1,1]],
  L: [[0,0],[1,0],[2,0],[2,1]],
  J: [[0,0],[0,1],[1,0],[2,0]],
};

function normalize(cells) {
  const minR = Math.min(...cells.map(c => c[0]));
  const minC = Math.min(...cells.map(c => c[1]));
  const s = cells.map(([r,c]) => [r-minR, c-minC]);
  s.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  return s;
}

function getRotations(cells) {
  const rots = new Set();
  let c = cells.map(([r,col]) => [r,col]);
  for (let i = 0; i < 4; i++) {
    rots.add(JSON.stringify(normalize(c)));
    rots.add(JSON.stringify(normalize(c.map(([r,col]) => [r,-col]))));
    c = c.map(([r,col]) => [col,-r]);
  }
  return [...rots].map(s => JSON.parse(s));
}

const ALL_SHAPES = Object.entries(SHAPE_DEFS).map(([name, cells]) => ({
  name, cells, size: cells.length, rotations: getRotations(cells),
}));

const randomShape = () => ALL_SHAPES[Math.floor(Math.random() * ALL_SHAPES.length)];
const createBoard = () => Array.from({length: BOARD_SIZE}, () => Array(BOARD_SIZE).fill(EMPTY));

// ── Core logic ──────────────────────────────────────────────────────
function findCompletedShape(board, player, shape) {
  const pCells = [];
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c] === player) pCells.push([r,c]);
  if (pCells.length < shape.size) return null;
  const set = new Set(pCells.map(([r,c]) => `${r},${c}`));
  for (const rot of shape.rotations)
    for (const [pr,pc] of pCells) {
      const bR = pr - rot[0][0], bC = pc - rot[0][1];
      const placed = rot.map(([dr,dc]) => [bR+dr, bC+dc]);
      if (placed.every(([r,c]) => r>=0 && r<BOARD_SIZE && c>=0 && c<BOARD_SIZE && set.has(`${r},${c}`)))
        return placed;
    }
  return null;
}

function canShapeFit(board, player, shape) {
  for (const rot of shape.rotations)
    for (let bR = -shape.size; bR < BOARD_SIZE+1; bR++)
      for (let bC = -shape.size; bC < BOARD_SIZE+1; bC++) {
        const placed = rot.map(([dr,dc]) => [bR+dr, bC+dc]);
        if (placed.every(([r,c]) => r>=0 && r<BOARD_SIZE && c>=0 && c<BOARD_SIZE && (board[r][c]===EMPTY || board[r][c]===player)))
          return true;
      }
  return false;
}

function canAnyShapeFit(board, player) { return ALL_SHAPES.some(s => canShapeFit(board, player, s)); }

function pickFeasibleShape(board, player) {
  const f = ALL_SHAPES.filter(s => canShapeFit(board, player, s));
  return f.length ? f[Math.floor(Math.random() * f.length)] : null;
}

function findPlacements(board, player, shape) {
  const locked = player === BLACK ? LOCKED_BLACK : LOCKED_WHITE;
  const results = [];
  for (const rot of shape.rotations)
    for (let bR = 0; bR < BOARD_SIZE; bR++)
      for (let bC = 0; bC < BOARD_SIZE; bC++) {
        const cells = rot.map(([dr,dc]) => [bR+dr, bC+dc]);
        if (!cells.every(([r,c]) => r>=0 && r<BOARD_SIZE && c>=0 && c<BOARD_SIZE)) continue;
        let filled = 0, blocked = false;
        const emptyCells = [];
        for (const [r,c] of cells) {
          const v = board[r][c];
          if (v === player || v === locked) filled++;
          else if (v === EMPTY) emptyCells.push([r,c]);
          else { blocked = true; break; }
        }
        if (!blocked) results.push({ cells, filled, emptyCells, total: shape.size });
      }
  return results;
}

function potentialMap(board, player, shape) {
  const scores = Array.from({length: BOARD_SIZE}, () => Array(BOARD_SIZE).fill(0));
  for (const p of findPlacements(board, player, shape)) {
    const w = (0.2 + p.filled) * (0.2 + p.filled);
    for (const [r,c] of p.emptyCells) scores[r][c] += w;
  }
  return scores;
}

function softmaxSample(items, temp) {
  if (!items.length) return null;
  const maxS = Math.max(...items.map(x => x.score));
  const exps = items.map(x => Math.exp((x.score - maxS) / temp));
  const sum = exps.reduce((a,b) => a+b, 0);
  let rand = Math.random() * sum;
  for (let i = 0; i < items.length; i++) { rand -= exps[i]; if (rand <= 0) return items[i]; }
  return items[items.length-1];
}

function aiMove(board, aiShape, oppShape) {
  const empty = [];
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c] === EMPTY) empty.push([r,c]);
  if (!empty.length) return null;
  // Immediate win
  for (const [r,c] of empty) { const b = board.map(row=>[...row]); b[r][c] = WHITE; if (findCompletedShape(b,WHITE,aiShape)) return [r,c]; }
  // Block opponent
  for (const [r,c] of empty) { const b = board.map(row=>[...row]); b[r][c] = BLACK; if (findCompletedShape(b,BLACK,oppShape)) return [r,c]; }
  const offMap = potentialMap(board, WHITE, aiShape);
  const defMap = potentialMap(board, BLACK, oppShape);
  const ctr = (BOARD_SIZE-1)/2;
  const scored = empty.map(([r,c]) => ({
    move: [r,c],
    score: offMap[r][c]*1.1 + defMap[r][c]*0.9 + (1-(Math.abs(r-ctr)+Math.abs(c-ctr))/BOARD_SIZE)*0.3,
  }));
  const pick = softmaxSample(scored, AI_TEMPERATURE);
  return pick ? pick.move : empty[0];
}

// ── Completion resolution (chain completions) ───────────────────────
function resolveCompletions(board, player, shape, locked) {
  let totalScore = 0, currentShape = shape;
  const lockedType = player === BLACK ? LOCKED_BLACK : LOCKED_WHITE;
  while (currentShape) {
    const match = findCompletedShape(board, player, currentShape);
    if (!match) break;
    totalScore += currentShape.size;
    match.forEach(([r,c]) => { board[r][c] = lockedType; locked.add(`${r},${c}`); });
    currentShape = pickFeasibleShape(board, player);
  }
  if (totalScore === 0 && currentShape && !canShapeFit(board, player, currentShape))
    currentShape = pickFeasibleShape(board, player);
  return { score: totalScore, shape: currentShape };
}

// ── Simulate one game (AI vs AI, mirrored logic) ───────────────────
function aiMoveAsBlack(board, myShape, oppShape) {
  const empty = [];
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c] === EMPTY) empty.push([r,c]);
  if (!empty.length) return null;
  for (const [r,c] of empty) { const b = board.map(row=>[...row]); b[r][c] = BLACK; if (findCompletedShape(b,BLACK,myShape)) return [r,c]; }
  for (const [r,c] of empty) { const b = board.map(row=>[...row]); b[r][c] = WHITE; if (findCompletedShape(b,WHITE,oppShape)) return [r,c]; }
  const offMap = potentialMap(board, BLACK, myShape);
  const defMap = potentialMap(board, WHITE, oppShape);
  const ctr = (BOARD_SIZE-1)/2;
  const scored = empty.map(([r,c]) => ({
    move: [r,c],
    score: offMap[r][c]*1.1 + defMap[r][c]*0.9 + (1-(Math.abs(r-ctr)+Math.abs(c-ctr))/BOARD_SIZE)*0.3,
  }));
  const pick = softmaxSample(scored, AI_TEMPERATURE);
  return pick ? pick.move : empty[0];
}

function playGame() {
  const board = createBoard();
  let pShape = randomShape(), aShape = randomShape();
  let pScore = 0, aScore = 0, moves = 0;
  const locked = new Set();
  const shapeLog = { black: [], white: [] };

  while (moves < 200) {
    // BLACK (AI #1) turn
    if (!pShape || !canShapeFit(board, BLACK, pShape)) {
      pShape = pickFeasibleShape(board, BLACK);
      if (!pShape) { if (!canAnyShapeFit(board, WHITE)) break; }
    }
    if (pShape) {
      const pMove = aiMoveAsBlack(board, pShape, aShape || randomShape());
      if (!pMove) break;
      board[pMove[0]][pMove[1]] = BLACK;
      moves++;
      const pRes = resolveCompletions(board, BLACK, pShape, locked);
      pScore += pRes.score;
      if (pRes.score > 0) shapeLog.black.push(pShape.name);
      pShape = pRes.shape;
      if (pScore >= WIN_SCORE) return { winner: "black", pScore, aScore, moves, shapeLog };
    }
    if (!board.some(row => row.some(cell => cell === EMPTY))) break;

    // WHITE (AI #2) turn
    if (!aShape || !canShapeFit(board, WHITE, aShape)) {
      aShape = pickFeasibleShape(board, WHITE);
      if (!aShape) { if (!canAnyShapeFit(board, BLACK)) break; continue; }
    }
    const aMove = aiMove(board, aShape, pShape || randomShape());
    if (!aMove) break;
    board[aMove[0]][aMove[1]] = WHITE;
    moves++;
    const aRes = resolveCompletions(board, WHITE, aShape, locked);
    aScore += aRes.score;
    if (aRes.score > 0) shapeLog.white.push(aShape.name);
    aShape = aRes.shape;
    if (aScore >= WIN_SCORE) return { winner: "white", pScore, aScore, moves, shapeLog };
    if (!aShape && !canAnyShapeFit(board, BLACK)) break;

    if (!board.some(row => row.some(cell => cell === EMPTY))) break;
  }

  const winner = pScore > aScore ? "black" : aScore > pScore ? "white" : "draw";
  return { winner, pScore, aScore, moves, shapeLog };
}

// ── Main ────────────────────────────────────────────────────────────
const N = parseInt(process.argv[2]) || 50;
const results = [];
for (let i = 0; i < N; i++) results.push(playGame());

const bWins = results.filter(r => r.winner === "black").length;
const wWins = results.filter(r => r.winner === "white").length;
const draws = results.filter(r => r.winner === "draw").length;

const avg = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0) / arr.length;
const wShapes = results.flatMap(r => r.shapeLog.white);
const bShapes = results.flatMap(r => r.shapeLog.black);
const shapeCounts = arr => {
  const m = {};
  arr.forEach(s => m[s] = (m[s]||0)+1);
  return Object.entries(m).sort((a,b) => b[1]-a[1]).map(([n,c]) => `${n}:${c}`).join(" ");
};

console.log(`\n=== Goban AI vs AI: ${N} games ===`);
console.log(`Black (first) wins: ${bWins} (${(bWins/N*100).toFixed(0)}%)  |  White (second) wins: ${wWins} (${(wWins/N*100).toFixed(0)}%)  |  Draws: ${draws}`);
console.log(`Avg moves/game:    ${avg(results, r => r.moves).toFixed(1)}`);
console.log(`Avg Black score:   ${avg(results, r => r.pScore).toFixed(1)}`);
console.log(`Avg White score:   ${avg(results, r => r.aScore).toFixed(1)}`);
console.log(`Black shapes completed: ${bShapes.length} total — ${shapeCounts(bShapes)}`);
console.log(`White shapes completed: ${wShapes.length} total — ${shapeCounts(wShapes)}`);

// Score distribution
const wBuckets = [0,0,0,0,0]; // 0-4, 5-9, 10-14, 15-19, 20+
const bBuckets = [0,0,0,0,0];
for (const r of results) {
  wBuckets[Math.min(Math.floor(r.aScore/5), 4)]++;
  bBuckets[Math.min(Math.floor(r.pScore/5), 4)]++;
}
console.log(`\nScore distribution (0-4 | 5-9 | 10-14 | 15-19 | 20+):`);
console.log(`  Black: ${bBuckets.join("  |  ")}`);
console.log(`  White: ${wBuckets.join("  |  ")}`);

// Win margins
const bWinMargins = results.filter(r=>r.winner==="black").map(r=>r.pScore-r.aScore);
const wWinMargins = results.filter(r=>r.winner==="white").map(r=>r.aScore-r.pScore);
if (bWinMargins.length) console.log(`\nBlack win margin: avg ${(bWinMargins.reduce((a,b)=>a+b,0)/bWinMargins.length).toFixed(1)}  min ${Math.min(...bWinMargins)}  max ${Math.max(...bWinMargins)}`);
if (wWinMargins.length) console.log(`White win margin: avg ${(wWinMargins.reduce((a,b)=>a+b,0)/wWinMargins.length).toFixed(1)}  min ${Math.min(...wWinMargins)}  max ${Math.max(...wWinMargins)}`);

// First-move advantage: how often does first mover reach 20 first?
const firstTo20 = results.filter(r => r.pScore >= WIN_SCORE).length;
console.log(`\nBlack hit 20 first: ${firstTo20}/${N}  (first-move advantage indicator)`);
console.log();
