import { useState, useCallback, useEffect, useRef, useMemo } from "react";

// --- SOUND ENGINE (Web Audio API, no external files) ---
const audioCtx = typeof AudioContext !== "undefined" ? new AudioContext() : null;

function playTone(freq, duration, type = "sine", volume = 0.15, decay = true) {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  if (decay) gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + duration);
}

function playNoise(duration, volume = 0.08) {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * duration, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.15));
  const src = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 800;
  filter.Q.value = 1.5;
  src.buffer = buf;
  gain.gain.value = volume;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();
}

const Sounds = {
  stonePlace() {
    // Short woody "chpok" — bandpassed noise burst + low thud
    playNoise(0.08, 0.18);
    playTone(160, 0.1, "sine", 0.12);
  },
  shapeComplete() {
    // Quick ascending chime
    [523, 659, 784].forEach((f, i) => setTimeout(() => playTone(f, 0.25, "triangle", 0.12), i * 70));
  },
  win() {
    // Triumphant ascending chord
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.6, "triangle", 0.10), i * 100));
  },
  lose() {
    // Descending tones
    [392, 330, 262].forEach((f, i) => setTimeout(() => playTone(f, 0.45, "sine", 0.10), i * 140));
  },
};

function useLayout() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const mobile = width < 480;
  // On mobile, board fills entire width. On desktop, cap at 40px cells.
  const maxBoardW = mobile ? width : width - 32;
  const cellSize = Math.min(40, Math.floor(maxBoardW / 10));
  return { mobile, cellSize };
}

// --- TETROMINO DEFINITIONS ---
const SHAPE_DEFS = {
  I: { name: "I", cells: [[0,0],[0,1],[0,2],[0,3]] },
  O: { name: "O", cells: [[0,0],[0,1],[1,0],[1,1]] },
  T: { name: "T", cells: [[0,0],[0,1],[0,2],[1,1]] },
  S: { name: "S", cells: [[0,0],[0,1],[1,1],[1,2]] },
  Z: { name: "Z", cells: [[0,1],[0,2],[1,0],[1,1]] },
  L: { name: "L", cells: [[0,0],[1,0],[2,0],[2,1]] },
  J: { name: "J", cells: [[0,0],[0,1],[1,0],[2,0]] },
};

function getRotations(cells) {
  const rots = new Set();
  let c = cells.map(([r, col]) => [r, col]);
  for (let i = 0; i < 4; i++) {
    rots.add(JSON.stringify(normalize(c)));
    rots.add(JSON.stringify(normalize(c.map(([r, col]) => [r, -col]))));
    c = c.map(([r, col]) => [col, -r]);
  }
  return [...rots].map((s) => JSON.parse(s));
}

function normalize(cells) {
  const minR = Math.min(...cells.map((c) => c[0]));
  const minC = Math.min(...cells.map((c) => c[1]));
  const shifted = cells.map(([r, c]) => [r - minR, c - minC]);
  shifted.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return shifted;
}

const ALL_SHAPES = Object.values(SHAPE_DEFS).map((s) => ({
  ...s,
  size: s.cells.length,
  rotations: getRotations(s.cells),
}));

function randomShape() {
  return ALL_SHAPES[Math.floor(Math.random() * ALL_SHAPES.length)];
}

// --- BOARD LOGIC ---
const BOARD_SIZE = 9;
const WIN_SCORE = 20;
const EMPTY = 0, BLACK = 1, WHITE = 2, LOCKED_BLACK = 3, LOCKED_WHITE = 4;

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
}

function findCompletedShape(board, player, shape) {
  const playerCells = [];
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c] === player) playerCells.push([r, c]);
  if (playerCells.length < shape.size) return null;
  const cellSet = new Set(playerCells.map(([r, c]) => `${r},${c}`));
  for (const rot of shape.rotations) {
    for (const [pr, pc] of playerCells) {
      const baseR = pr - rot[0][0], baseC = pc - rot[0][1];
      const placed = rot.map(([dr, dc]) => [baseR + dr, baseC + dc]);
      if (placed.every(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && cellSet.has(`${r},${c}`)))
        return placed;
    }
  }
  return null;
}

// --- FEASIBILITY ---
function canShapeFit(board, player, shape) {
  for (const rot of shape.rotations)
    for (let bR = -shape.size; bR < BOARD_SIZE + 1; bR++)
      for (let bC = -shape.size; bC < BOARD_SIZE + 1; bC++) {
        const placed = rot.map(([dr, dc]) => [bR + dr, bC + dc]);
        if (placed.every(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && (board[r][c] === EMPTY || board[r][c] === player)))
          return true;
      }
  return false;
}

// --- AI ---
const AI_TEMPERATURE = 1.2;

function findPlacements(board, player, shape) {
  const results = [];
  for (const rot of shape.rotations) {
    for (let bR = 0; bR <= BOARD_SIZE - 1; bR++) {
      for (let bC = 0; bC <= BOARD_SIZE - 1; bC++) {
        const cells = rot.map(([dr, dc]) => [bR + dr, bC + dc]);
        if (!cells.every(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE))
          continue;
        let filled = 0, blocked = false;
        const emptyCells = [];
        for (const [r, c] of cells) {
          const v = board[r][c];
          // Only active (unlocked) stones count as progress — locked stones are occupied
          if (v === player) filled++;
          else if (v === EMPTY) emptyCells.push([r, c]);
          else { blocked = true; break; }
        }
        if (!blocked) results.push({ cells, filled, emptyCells, total: shape.size });
      }
    }
  }
  return results;
}

function potentialMap(board, player, shape) {
  const scores = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
  const placements = findPlacements(board, player, shape);
  for (const p of placements) {
    // (0.2 + filled)² gives non-zero weight even with 0 stones placed,
    // so the AI picks strategically when starting a new shape.
    const weight = (0.2 + p.filled) * (0.2 + p.filled);
    for (const [r, c] of p.emptyCells) scores[r][c] += weight;
  }
  return scores;
}

function softmaxSample(items, temperature) {
  if (items.length === 0) return null;
  const maxS = Math.max(...items.map((x) => x.score));
  const exps = items.map((x) => Math.exp((x.score - maxS) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  let rand = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    rand -= exps[i];
    if (rand <= 0) return items[i];
  }
  return items[items.length - 1];
}

function aiMove(board, aiShape, playerShape, blocked = false) {
  const empty = [];
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c] === EMPTY) empty.push([r, c]);
  if (!empty.length) return null;

  // Skip offense win-check when blocked — no placement can complete the shape
  if (!blocked) {
    for (const [r, c] of empty) {
      const b = board.map((row) => [...row]);
      b[r][c] = WHITE;
      if (findCompletedShape(b, WHITE, aiShape)) return [r, c];
    }
  }

  for (const [r, c] of empty) {
    const b = board.map((row) => [...row]);
    b[r][c] = BLACK;
    if (findCompletedShape(b, BLACK, playerShape)) return [r, c];
  }

  const offenseMap = potentialMap(board, WHITE, aiShape);
  const defenseMap = potentialMap(board, BLACK, playerShape);

  // When blocked, scoring is impossible — shift weight entirely to defense
  const offW = blocked ? 0 : 1.1;
  const defW = blocked ? 1.3 : 0.9;
  const scored = empty.map(([r, c]) => {
    const offense = offenseMap[r][c];
    const defense = defenseMap[r][c];
    const ctr = (BOARD_SIZE - 1) / 2;
    const centerBonus = (1 - (Math.abs(r - ctr) + Math.abs(c - ctr)) / BOARD_SIZE) * 0.3;
    return { move: [r, c], score: offense * offW + defense * defW + centerBonus };
  });

  const pick = softmaxSample(scored, AI_TEMPERATURE);
  return pick ? pick.move : empty[0];
}

// --- STONE SVG COMPONENT (realistic) ---
function Stone({ cx, cy, radius, isBlack, isLocked, isFlash, isLast, gameOver }) {
  const id = `s${isBlack ? "b" : "w"}-${Math.round(cx)}-${Math.round(cy)}`;
  const showLocked = isLocked && !gameOver;
  return (
    <g style={{
      animation: isFlash ? "flashPulse 0.7s ease" : isLast ? "stonePop 0.3s cubic-bezier(0.34,1.56,0.64,1)" : "none",
      opacity: showLocked ? 0.55 : 1,
      transition: "opacity 0.4s",
    }}>
      {/* Soft shadow */}
      <ellipse cx={cx + 1} cy={cy + 2.5} rx={radius * 0.92} ry={radius * 0.7} fill="rgba(0,0,0,0.18)" />
      {/* Stone body */}
      <defs>
        {isBlack ? (
          <radialGradient id={id} cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#4a4a4a" />
            <stop offset="60%" stopColor="#1a1a1a" />
            <stop offset="100%" stopColor="#0a0a0a" />
          </radialGradient>
        ) : (
          <radialGradient id={id} cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="50%" stopColor="#f0ece4" />
            <stop offset="100%" stopColor="#d8d2c4" />
          </radialGradient>
        )}
      </defs>
      <circle cx={cx} cy={cy} r={radius} fill={`url(#${id})`} />
      {/* Top highlight */}
      <ellipse cx={cx - radius * 0.22} cy={cy - radius * 0.28} rx={radius * 0.35} ry={radius * 0.22}
        fill={isBlack ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.65)"} />
    </g>
  );
}

// --- SHAPE PREVIEW ---
function ShapePreview({ shape, label, score, isActive, stoneType, compact, blocked }) {
  if (!shape) return <div style={{ width: compact ? 100 : 140, textAlign: "center" }}><span style={{ fontSize: compact ? 12 : 14, color: "#6b5e4e", fontFamily: "var(--font)" }}>No shapes left</span></div>;
  const cells = shape.cells;
  const maxR = Math.max(...cells.map((c) => c[0])) + 1;
  const maxC = Math.max(...cells.map((c) => c[1])) + 1;
  const sz = compact ? 15 : 20, pad = compact ? 4 : 6;
  const maxRows = 4; // tallest shape (I-piece vertical)
  const maxCols = 4; // widest shape (I-piece horizontal)
  const fixedW = maxCols * sz + pad * 2;
  const fixedH = maxRows * sz + pad * 2;
  // Center the shape within the fixed-size SVG
  const offsetX = (fixedW - (maxC * sz)) / 2;
  const offsetY = (fixedH - (maxR * sz)) / 2;
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: compact ? 3 : 6,
      transition: "all 0.4s cubic-bezier(0.4,0,0.2,1)",
      transform: "scale(1)",
    }}>
      <span style={{ fontFamily: "var(--font)", fontSize: compact ? 10 : 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5a4e3e" }}>{label}</span>
      <div style={{
        position: "relative",
        background: blocked ? "rgba(120,110,100,0.08)" : isActive ? "rgba(207,164,70,0.18)" : "rgba(207,164,70,0.10)",
        borderRadius: compact ? 8 : 10, padding: compact ? "6px 10px" : "12px 16px",
        border: blocked ? "2px solid rgba(120,110,100,0.15)" : isActive ? "2px solid rgba(207,164,70,0.5)" : "2px solid rgba(207,164,70,0.2)",
        transition: "all 0.4s cubic-bezier(0.4,0,0.2,1)",
      }}>
        <svg width={fixedW} height={fixedH} viewBox={`0 0 ${fixedW} ${fixedH}`}
          style={{ opacity: blocked ? 0.3 : 1, transition: "opacity 0.4s" }}>
          {cells.map(([r, c], i) => {
            const cx = offsetX + c * sz + sz / 2, cy = offsetY + r * sz + sz / 2, rad = sz / 2 - 2;
            return <Stone key={i} cx={cx} cy={cy} radius={rad} isBlack={stoneType === "black"} isLocked={true} isFlash={false} isLast={false} />;
          })}
        </svg>
        {blocked && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{
              fontFamily: "var(--font)", fontSize: compact ? 11 : 13, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.1em",
              color: "#8a7e6e",
            }}>Blocked</span>
          </div>
        )}
      </div>
    </div>
  );
}

// --- SCORE BAR ---
function ScoreBar({ score, maxScore, isBlack, label, compact }) {
  const pct = Math.min((score / maxScore) * 100, 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: compact ? 2 : 5, minWidth: compact ? 80 : 120 }}>
      <span style={{ fontFamily: "var(--font)", fontSize: compact ? 10 : 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5a4e3e" }}>{label}</span>
      <div style={{ fontSize: compact ? 28 : 38, fontWeight: 700, fontFamily: "var(--font-display)", color: "#2a2318", lineHeight: 1 }}>{score}</div>
      <div style={{ width: compact ? 60 : 90, height: compact ? 4 : 5, borderRadius: 3, background: "rgba(61,53,41,0.12)", overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 3, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
          width: `${pct}%`,
          background: isBlack
            ? "linear-gradient(90deg, #3d3529, #5a4f3e)"
            : "linear-gradient(90deg, #c4bfb4, #9a9284)",
        }} />
      </div>
    </div>
  );
}

// --- MAIN ---
export default function GobanGame() {
  const [board, setBoard] = useState(createBoard);
  const [playerShape, setPlayerShape] = useState(() => randomShape());
  const [aiShapeState, setAiShape] = useState(() => randomShape());
  const [playerScore, setPlayerScore] = useState(0);
  const [aiScore, setAiScore] = useState(0);
  const [turn, setTurn] = useState(BLACK);
  const [gameOver, setGameOver] = useState(null); // null | "player" | "ai" | "draw"
  const [endReason, setEndReason] = useState(null); // null | "score" | "board_full" | "both_blocked"
  const [lastPlaced, setLastPlaced] = useState(null);
  const [lockedCells, setLockedCells] = useState(new Set());
  const [flashCells, setFlashCells] = useState(new Set());
  const [moveCount, setMoveCount] = useState(0);
  const [aiThinking, setAiThinking] = useState(false);
  const [scorePop, setScorePop] = useState(null); // {x, y, pts, key}
  const [splash, setSplash] = useState(null); // {cells: [[r,c],...], key, isBlack}
  const [hideOverlay, setHideOverlay] = useState(false);
  const [muted, setMuted] = useState(false);
  const popKeyRef = useRef(0);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const snd = useCallback((fn) => { if (!mutedRef.current) fn(); }, []);

  // Pre-compute all chain completion steps. Mutates board and locked in place.
  // Returns array of steps, each with a board/locked snapshot for progressive rendering.
  const computeChain = useCallback((board, player, shape, locked) => {
    const steps = [];
    let currentShape = shape;
    const isBlack = player === BLACK;
    const lockedType = isBlack ? LOCKED_BLACK : LOCKED_WHITE;
    while (currentShape) {
      const match = findCompletedShape(board, player, currentShape);
      if (!match) break;
      const flash = new Set();
      match.forEach(([mr, mc]) => { board[mr][mc] = lockedType; locked.add(`${mr},${mc}`); flash.add(`${mr},${mc}`); });
      popKeyRef.current++;
      const nextShape = randomShape();
      steps.push({
        pts: currentShape.size, match, flash, isBlack,
        splashKey: popKeyRef.current, newShape: nextShape,
        boardSnap: board.map(r => [...r]),
        lockedSnap: new Set(locked),
      });
      currentShape = nextShape;
    }
    return steps;
  }, []);

  // Apply visuals for one completion step (flash, splash, score pop, sound)
  const showCompletion = useCallback((step, r, c, playerStr) => {
    setBoard(step.boardSnap);
    setLockedCells(step.lockedSnap);
    setFlashCells(step.flash);
    popKeyRef.current++;
    setSplash({ cells: step.match, key: popKeyRef.current, isBlack: step.isBlack });
    setScorePop({ x: r, y: c, pts: step.pts, key: popKeyRef.current, player: playerStr });
    setTimeout(() => setScorePop(null), 1200);
    setTimeout(() => setSplash(null), 1000);
    snd(Sounds.shapeComplete);
  }, [snd]);

  // End-of-turn: check win/board-full/both-blocked, then pass turn.
  const endTurn = useCallback((player, boardState, pScore, aScore, pShape, aShape) => {
    const isPlayer = player === BLACK;
    const activeScore = isPlayer ? pScore : aScore;
    if (activeScore >= WIN_SCORE) {
      snd(isPlayer ? Sounds.win : Sounds.lose);
      setEndReason("score"); setGameOver(isPlayer ? "player" : "ai");
      if (!isPlayer) setAiThinking(false);
      return;
    }
    const hasEmpty = boardState.some(row => row.some(cell => cell === EMPTY));
    if (!hasEmpty) {
      const w = pScore > aScore ? "player" : aScore > pScore ? "ai" : "draw";
      snd(w === "player" ? Sounds.win : Sounds.lose);
      setEndReason("board_full"); setGameOver(w);
      if (!isPlayer) setAiThinking(false);
      return;
    }
    const pBlocked = !canShapeFit(boardState, BLACK, pShape);
    const aBlocked = !canShapeFit(boardState, WHITE, aShape);
    if (pBlocked && aBlocked) {
      const w = pScore > aScore ? "player" : aScore > pScore ? "ai" : "draw";
      snd(w === "player" ? Sounds.win : Sounds.lose);
      setEndReason("both_blocked"); setGameOver(w);
      if (!isPlayer) setAiThinking(false);
      return;
    }
    if (isPlayer) { setTurn(WHITE); setAiThinking(true); }
    else { setTurn(BLACK); setAiThinking(false); }
  }, [snd]);

  // Chain animation queue — plays subsequent chain completions with delays
  const [chainQueue, setChainQueue] = useState(null);

  useEffect(() => {
    if (!chainQueue) return;
    const { player, steps, step, r, c } = chainQueue;
    const timeout = setTimeout(() => {
      setFlashCells(new Set());
      if (step >= steps.length) {
        // All chain steps done — finalize turn
        setChainQueue(null);
        const { fPS, fAS, fPSh, fASh, fBoard } = chainQueue;
        endTurn(player, fBoard, fPS, fAS, fPSh, fASh);
        return;
      }
      // Apply next chain step
      const s = steps[step];
      const isBlack = player === BLACK;
      showCompletion(s, r, c, isBlack ? "black" : "white");
      if (isBlack) { setPlayerScore(prev => prev + s.pts); setPlayerShape(s.newShape); }
      else { setAiScore(prev => prev + s.pts); setAiShape(s.newShape); }
      setChainQueue(prev => ({ ...prev, step: step + 1 }));
    }, 800);
    return () => clearTimeout(timeout);
  }, [chainQueue, showCompletion, endTurn]);

  // Start a chain queue after applying the first step (shared by player + AI).
  // pScore/aScore should already include step 0's points.
  const startChain = useCallback((player, steps, r, c, pScore, aScore, pShape, aShape) => {
    const remainingScore = steps.slice(1).reduce((sum, s) => sum + s.pts, 0);
    const last = steps[steps.length - 1];
    setChainQueue({
      player, steps, step: 1, r, c,
      fPS: player === BLACK ? pScore + remainingScore : pScore,
      fAS: player === WHITE ? aScore + remainingScore : aScore,
      fPSh: player === BLACK ? last.newShape : pShape,
      fASh: player === WHITE ? last.newShape : aShape,
      fBoard: last.boardSnap,
    });
  }, []);

  const handleCellClick = useCallback((r, c) => {
    if (gameOver || turn !== BLACK || board[r][c] !== EMPTY || chainQueue) return;
    snd(Sounds.stonePlace);
    const newBoard = board.map((row) => [...row]);
    newBoard[r][c] = BLACK;
    setLastPlaced(`${r},${c}`);
    setMoveCount((m) => m + 1);

    const blocked = !canShapeFit(board, BLACK, playerShape);
    if (blocked) {
      setBoard(newBoard);
      endTurn(BLACK, newBoard, playerScore, aiScore, playerShape, aiShapeState);
      return;
    }

    const newLocked = new Set(lockedCells);
    const steps = computeChain(newBoard, BLACK, playerShape, newLocked);
    if (steps.length === 0) {
      setBoard(newBoard);
      endTurn(BLACK, newBoard, playerScore, aiScore, playerShape, aiShapeState);
      return;
    }

    // Apply first completion immediately
    const s0 = steps[0];
    showCompletion(s0, r, c, "black");
    setPlayerScore(playerScore + s0.pts);
    setPlayerShape(s0.newShape);

    if (steps.length > 1) {
      // Chain! Queue remaining steps — turn finalized when queue drains
      startChain(BLACK, steps, r, c, playerScore + s0.pts, aiScore, s0.newShape, aiShapeState);
    } else {
      // Single completion — finalize turn now
      setTimeout(() => setFlashCells(new Set()), 700);
      endTurn(BLACK, s0.boardSnap, playerScore + s0.pts, aiScore, s0.newShape, aiShapeState);
    }
  }, [board, turn, gameOver, playerShape, aiShapeState, playerScore, aiScore, lockedCells, chainQueue, computeChain, showCompletion, startChain, endTurn, snd]);

  // AI move is split into two phases:
  // Phase 1 (aiPending === null): decide move, place stone, render it
  // Phase 2 (aiPending !== null): after stone lands, resolve completions + end-of-turn
  const [aiPending, setAiPending] = useState(null);

  useEffect(() => {
    if (turn !== WHITE || gameOver || !aiThinking || aiPending || chainQueue) return;
    const timeout = setTimeout(() => {
      const currentAiShape = aiShapeState;
      const blocked = !canShapeFit(board, WHITE, currentAiShape);
      const move = aiMove(board, currentAiShape, playerShape, blocked);
      if (!move) { const w = playerScore > aiScore ? "player" : aiScore > playerScore ? "ai" : "draw"; snd(w === "player" ? Sounds.win : Sounds.lose); setEndReason("board_full"); setGameOver(w); setAiThinking(false); return; }
      const [r, c] = move;
      const newBoard = board.map((row) => [...row]);
      newBoard[r][c] = WHITE;
      snd(Sounds.stonePlace);
      setBoard(newBoard);
      setLastPlaced(`${r},${c}`);
      setMoveCount((m) => m + 1);
      setAiPending({ board: newBoard, r, c, shape: currentAiShape, blocked });
    }, 600);
    return () => clearTimeout(timeout);
  }, [turn, gameOver, aiThinking, aiPending, chainQueue, board, aiShapeState, playerShape, playerScore, aiScore, snd]);

  useEffect(() => {
    if (!aiPending) return;
    const timeout = setTimeout(() => {
      const { board: newBoard, r, c, shape: currentAiShape, blocked } = aiPending;
      setAiPending(null);

      if (blocked) {
        endTurn(WHITE, newBoard, playerScore, aiScore, playerShape, currentAiShape);
        return;
      }

      const newLocked = new Set(lockedCells);
      const steps = computeChain(newBoard, WHITE, currentAiShape, newLocked);
      if (steps.length === 0) {
        endTurn(WHITE, newBoard, playerScore, aiScore, playerShape, currentAiShape);
        return;
      }

      // Apply first completion
      const s0 = steps[0];
      showCompletion(s0, r, c, "white");
      setAiScore(aiScore + s0.pts);
      setAiShape(s0.newShape);

      if (steps.length > 1) {
        startChain(WHITE, steps, r, c, playerScore, aiScore + s0.pts, playerShape, s0.newShape);
      } else {
        setTimeout(() => setFlashCells(new Set()), 700);
        endTurn(WHITE, s0.boardSnap, playerScore, aiScore + s0.pts, playerShape, s0.newShape);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [aiPending, aiScore, playerScore, playerShape, lockedCells, computeChain, showCompletion, startChain, endTurn, snd]);

  const resetGame = () => {
    setBoard(createBoard()); setPlayerShape(randomShape()); setAiShape(randomShape());
    setPlayerScore(0); setAiScore(0); setTurn(BLACK); setGameOver(null);
    setLastPlaced(null); setLockedCells(new Set()); setFlashCells(new Set());
    setMoveCount(0); setAiThinking(false); setAiPending(null); setChainQueue(null); setScorePop(null); setSplash(null); setHideOverlay(false); setEndReason(null);
  };

  const { mobile, cellSize } = useLayout();
  const padding = cellSize;
  const boardPx = (BOARD_SIZE - 1) * cellSize + padding * 2;
  const starPoints = [[2,2],[2,6],[6,2],[6,6],[4,4]];
  const playerBlocked = playerShape && !gameOver && !canShapeFit(board, BLACK, playerShape);
  const aiBlocked = aiShapeState && !gameOver && !canShapeFit(board, WHITE, aiShapeState);

  return (
    <div style={{
      "--font": "'Crimson Pro', 'Georgia', serif",
      "--font-display": "'Crimson Pro', 'Georgia', serif",
      minHeight: "100vh",
      background: "linear-gradient(180deg, #f7f3eb 0%, #ede6d8 100%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: mobile ? "12px 0 20px" : "28px 16px 40px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@300;400;500;600;700&display=swap');

        @keyframes activeGlow {
          0%, 100% { opacity: 0.75; }
          50% { opacity: 1; }
        }
        @keyframes stonePop {
          0% { transform: scale(0) rotate(-8deg); opacity: 0; }
          50% { transform: scale(1.12) rotate(2deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes flashPulse {
          0% { filter: brightness(1) drop-shadow(0 0 0 transparent); }
          40% { filter: brightness(1.6) drop-shadow(0 0 8px rgba(207,164,70,0.6)); }
          100% { filter: brightness(1) drop-shadow(0 0 0 transparent); }
        }
        @keyframes floatUp {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-40px) scale(1.3); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes gameOverIn {
          0% { opacity: 0; transform: scale(0.8); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes overlayFade {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes resultSlideUp {
          0% { opacity: 0; transform: translate(-50%, -40%) scale(0.85); }
          60% { opacity: 1; transform: translate(-50%, -52%) scale(1.03); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes resultScoreIn {
          0% { opacity: 0; transform: translate(-50%, 0) scale(0.8); }
          100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
        @keyframes splashRing {
          0% { transform: scale(0); opacity: 0.9; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes splashGlow {
          0% { opacity: 0; transform: scale(0.5); }
          25% { opacity: 0.7; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.3); }
        }
        @keyframes splashLine {
          0% { stroke-dashoffset: 1; opacity: 0.8; }
          40% { stroke-dashoffset: 0; opacity: 0.9; }
          100% { stroke-dashoffset: 0; opacity: 0; }
        }
      `}</style>

      {/* Mute button */}
      <button onClick={() => setMuted(m => !m)} style={{
        position: "fixed", right: 12, top: mobile ? 14 : 20, zIndex: 10,
        background: "none", border: "none", cursor: "pointer", padding: 4, opacity: 0.45,
        transition: "opacity 0.2s",
      }}
        onMouseEnter={e => e.currentTarget.style.opacity = "0.8"}
        onMouseLeave={e => e.currentTarget.style.opacity = "0.45"}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        <svg width={mobile ? 18 : 22} height={mobile ? 18 : 22} viewBox="0 0 24 24" fill="none" stroke="#5a4e3e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          {muted ? (
            <><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
          ) : (
            <><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></>
          )}
        </svg>
      </button>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: mobile ? 8 : 24, animation: "fadeIn 0.6s ease" }}>
        <h1 style={{
          fontFamily: "var(--font-display)", fontSize: mobile ? 28 : 42, fontWeight: 300, letterSpacing: "0.22em",
          textTransform: "uppercase", margin: 0, color: "#2a2318",
        }}>Goban</h1>
        {!mobile && <p style={{
          fontFamily: "var(--font)", fontSize: 15, color: "#5a4e3e", margin: "6px 0 0",
          letterSpacing: "0.04em", fontWeight: 400,
        }}>Build shapes on the board · First to {WIN_SCORE}</p>}
      </div>

      {/* Scores + Shape targets — compact row on mobile */}
      {mobile ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, width: "100%", justifyContent: "center" }}>
          <ShapePreview shape={playerShape} label="You" score={playerScore} isActive={turn === BLACK && !gameOver} stoneType="black" compact blocked={playerBlocked} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "#2a2318", lineHeight: 1 }}>
              {playerScore}<span style={{ color: "#9a9284", fontWeight: 400, fontSize: 14 }}> – </span>{aiScore}
            </div>
            <div style={{ width: 40, height: 3, borderRadius: 2, background: "rgba(61,53,41,0.12)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(((playerScore + aiScore) / (WIN_SCORE * 2)) * 100, 100)}%`, background: "#3d3529", transition: "width 0.6s" }} />
            </div>
          </div>
          <ShapePreview shape={aiShapeState} label="AI" score={aiScore} isActive={turn === WHITE && !gameOver} stoneType="white" compact blocked={aiBlocked} />
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 40, marginBottom: 20, alignItems: "center" }}>
            <ScoreBar score={playerScore} maxScore={WIN_SCORE} isBlack={true} label="You · Black" />
            <div style={{ width: 1, height: 48, background: "rgba(61,53,41,0.1)" }} />
            <ScoreBar score={aiScore} maxScore={WIN_SCORE} isBlack={false} label="AI · White" />
          </div>
          <div style={{ display: "flex", gap: 32, marginBottom: 14, alignItems: "flex-start" }}>
            <ShapePreview shape={playerShape} label="Your target" score={playerScore} isActive={turn === BLACK && !gameOver} stoneType="black" blocked={playerBlocked} />
            <ShapePreview shape={aiShapeState} label="AI target" score={aiScore} isActive={turn === WHITE && !gameOver} stoneType="white" blocked={aiBlocked} />
          </div>
        </>
      )}

      {/* Status — turn indicator only, game over is shown on the board overlay */}
      <div style={{ height: mobile ? 28 : 36, display: "flex", alignItems: "center", marginBottom: mobile ? 4 : 12 }}>
        {!gameOver && (
          <div style={{
            fontFamily: "var(--font)", fontSize: mobile ? 14 : 17, color: turn === BLACK ? "#2a2318" : "#6b5e4e",
            fontWeight: 600, letterSpacing: "0.02em",
            animation: turn === WHITE ? "pulse 1.2s ease infinite" : "none",
            transition: "color 0.3s",
          }}>
            {turn === BLACK ? "Your turn" : "Thinking…"}
          </div>
        )}
        {gameOver && <div style={{ height: mobile ? 28 : 36 }} />}
      </div>

      {/* Board */}
      <div onClick={gameOver ? () => setHideOverlay(h => !h) : undefined} style={{ position: "relative", borderRadius: mobile ? 0 : 8, overflow: "hidden", flexShrink: 0,
        boxShadow: mobile ? "none" : "0 2px 4px rgba(0,0,0,0.06), 0 12px 40px rgba(61,53,41,0.12), inset 0 1px 0 rgba(255,255,255,0.3)",
        width: mobile ? "100%" : "auto",
        cursor: gameOver ? "pointer" : "default",
      }}>
        {/* Wood texture bg */}
        <svg width={mobile ? "100%" : boardPx} height={mobile ? "auto" : boardPx} viewBox={`0 0 ${boardPx} ${boardPx}`}
          style={{ display: "block", cursor: turn === BLACK && !gameOver ? "crosshair" : "default", aspectRatio: "1 / 1" }}>
          {/* Board background with wood grain */}
          <defs>
            <linearGradient id="woodGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#deb957" />
              <stop offset="30%" stopColor="#d4a843" />
              <stop offset="60%" stopColor="#c99b38" />
              <stop offset="100%" stopColor="#c08e30" />
            </linearGradient>
            <pattern id="grain" width={boardPx / 2} height={boardPx / 2} patternUnits="userSpaceOnUse">
              <rect width={boardPx / 2} height={boardPx / 2} fill="url(#woodGrad)" />
              {[...Array(12)].map((_, i) => {
                const tileH = boardPx / 2;
                const spacing = tileH / 12;
                return <line key={i} x1={0} y1={i * spacing + spacing * 0.15} x2={boardPx / 2} y2={i * spacing + spacing * 0.4}
                  stroke="rgba(120,80,20,0.06)" strokeWidth={1.2} />;
              })}
            </pattern>
            <filter id="boardShadow">
              <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="rgba(0,0,0,0.1)" />
            </filter>
          </defs>
          <rect width={boardPx} height={boardPx} fill="url(#grain)" />

          {/* Grid */}
          {Array.from({ length: BOARD_SIZE }).map((_, i) => (
            <g key={i}>
              <line x1={padding} y1={padding + i * cellSize}
                x2={padding + (BOARD_SIZE - 1) * cellSize} y2={padding + i * cellSize}
                stroke="rgba(40,28,10,0.45)" strokeWidth={i === 0 || i === BOARD_SIZE - 1 ? 1.2 : 0.7} />
              <line x1={padding + i * cellSize} y1={padding}
                x2={padding + i * cellSize} y2={padding + (BOARD_SIZE - 1) * cellSize}
                stroke="rgba(40,28,10,0.45)" strokeWidth={i === 0 || i === BOARD_SIZE - 1 ? 1.2 : 0.7} />
            </g>
          ))}

          {/* Star points */}
          {starPoints.map(([r, c], i) => (
            <circle key={i} cx={padding + c * cellSize} cy={padding + r * cellSize} r={3.5}
              fill="rgba(40,28,10,0.5)" />
          ))}

          {/* Stones */}
          {board.map((row, r) =>
            row.map((cell, c) => {
              if (cell === EMPTY) return null;
              const cx = padding + c * cellSize, cy = padding + r * cellSize;
              const isBlack = cell === BLACK || cell === LOCKED_BLACK;
              const isLocked = cell === LOCKED_BLACK || cell === LOCKED_WHITE;
              const radius = cellSize / 2 - 3;
              return <Stone key={`${r}-${c}`} cx={cx} cy={cy} radius={radius}
                isBlack={isBlack} isLocked={isLocked} gameOver={gameOver}
                isFlash={flashCells.has(`${r},${c}`)}
                isLast={lastPlaced === `${r},${c}`} />;
            })
          )}

          {/* Shape completion splash */}
          {splash && (() => {
            const pts = splash.cells.map(([r, c]) => [padding + c * cellSize, padding + r * cellSize]);
            const cx0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
            const cy0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
            const color = splash.isBlack ? "rgba(207,164,70," : "rgba(180,170,150,";
            // Build outline path connecting stones in order
            const sorted = [...pts].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
            const pathD = sorted.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ") + " Z";
            const pathLen = sorted.reduce((sum, p, i) => {
              if (i === 0) return 0;
              const prev = sorted[i - 1];
              return sum + Math.sqrt((p[0] - prev[0]) ** 2 + (p[1] - prev[1]) ** 2);
            }, 0) + Math.sqrt((sorted[0][0] - sorted[sorted.length-1][0]) ** 2 + (sorted[0][1] - sorted[sorted.length-1][1]) ** 2);
            return (
              <g key={splash.key} style={{ pointerEvents: "none" }}>
                {/* Expanding rings from each stone */}
                {pts.map(([x, y], i) => (
                  <g key={i}>
                    <circle cx={x} cy={y} r={cellSize * 0.9}
                      fill="none" stroke={`${color}0.7)`} strokeWidth={3}
                      style={{ transformOrigin: `${x}px ${y}px`, animation: `splashRing 0.8s ${i * 0.06}s ease-out forwards` }} />
                    <circle cx={x} cy={y} r={cellSize * 1.1}
                      fill="none" stroke={`${color}0.35)`} strokeWidth={2}
                      style={{ transformOrigin: `${x}px ${y}px`, animation: `splashRing 0.8s ${i * 0.06 + 0.1}s ease-out forwards` }} />
                  </g>
                ))}
                {/* Golden glow at center of shape */}
                <circle cx={cx0} cy={cy0} r={cellSize * 1.2}
                  fill={`${color}0.3)`}
                  style={{ transformOrigin: `${cx0}px ${cy0}px`, animation: "splashGlow 0.9s ease-out forwards", filter: "blur(10px)" }} />
                {/* Connecting outline that draws in */}
                <path d={pathD} fill="none"
                  stroke={`${color}0.6)`} strokeWidth={2.5} strokeLinejoin="round"
                  strokeDasharray={pathLen} strokeDashoffset={pathLen}
                  style={{ animation: `splashLine 0.9s ease-out forwards` }} />
              </g>
            );
          })()}

          {/* Score pop-up */}
          {scorePop && (
            <text
              x={padding + scorePop.y * cellSize}
              y={padding + scorePop.x * cellSize - 10}
              textAnchor="middle"
              fontFamily="var(--font-display)"
              fontSize="22" fontWeight="700"
              fill={scorePop.player === "black" ? "#3d3529" : "#8a7e6e"}
              style={{ animation: "floatUp 1.2s ease forwards", pointerEvents: "none" }}
              key={scorePop.key}
            >+{scorePop.pts}</text>
          )}

          {/* Hover ghosts + click targets */}
          {!gameOver && turn === BLACK && board.map((row, r) =>
            row.map((cell, c) => {
              if (cell !== EMPTY) return null;
              const cx = padding + c * cellSize, cy = padding + r * cellSize;
              return (
                <g key={`h-${r}-${c}`}>
                  <circle id={`hv-${r}-${c}`} cx={cx} cy={cy} r={cellSize / 2 - 3}
                    fill="rgba(30,26,20,0.25)" opacity={0}
                    style={{ pointerEvents: "none", transition: "opacity 0.15s" }} />
                  <rect x={cx - cellSize / 2} y={cy - cellSize / 2} width={cellSize} height={cellSize}
                    fill="transparent" style={{ cursor: "crosshair" }}
                    onClick={() => handleCellClick(r, c)}
                    onMouseEnter={() => { const el = document.getElementById(`hv-${r}-${c}`); if (el) el.style.opacity = "1"; }}
                    onMouseLeave={() => { const el = document.getElementById(`hv-${r}-${c}`); if (el) el.style.opacity = "0"; }}
                  />
                </g>
              );
            })
          )}
        </svg>

        {/* Game over overlay */}
        {gameOver && !hideOverlay && (
          <div style={{
            position: "absolute", inset: 0,
            background: "radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.1) 100%)",
            animation: "overlayFade 0.6s ease-out forwards",
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <div style={{
              position: "absolute", left: "50%", top: "50%",
              animation: "resultSlideUp 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards",
              textAlign: "center", pointerEvents: "none",
            }}>
              <div style={{
                fontFamily: "var(--font-display)",
                fontSize: mobile ? 44 : 56,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: gameOver === "player" ? "#b7e4c7" : "#f7f3eb",
                textShadow: "0 2px 16px rgba(0,0,0,0.5), 0 0 40px rgba(0,0,0,0.3)",
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}>
                {gameOver === "player" ? "You Win" : gameOver === "ai" ? "AI Wins" : "Draw"}
              </div>
              <div style={{
                fontFamily: "var(--font)", fontSize: mobile ? 20 : 24, fontWeight: 500,
                color: "#f7f3eb", textShadow: "0 2px 12px rgba(0,0,0,0.5)",
                marginTop: 8,
              }}>
                {playerScore} – {aiScore}
              </div>
              {endReason === "both_blocked" && (
                <div style={{
                  fontFamily: "var(--font)", fontSize: mobile ? 15 : 18, fontWeight: 600,
                  color: "#f7f3eb", textShadow: "0 2px 12px rgba(0,0,0,0.5)",
                  marginTop: 8, letterSpacing: "0.08em", textTransform: "uppercase",
                }}>
                  Deadlock
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* New game */}
      <button onClick={resetGame} style={{
        marginTop: mobile ? 10 : 24, padding: mobile ? "8px 24px" : "12px 36px",
        fontFamily: "var(--font)", fontSize: mobile ? 13 : 15, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase",
        border: "2px solid rgba(61,53,41,0.3)", borderRadius: 6,
        background: "rgba(255,252,245,0.6)",
        color: "#2a2318", cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
      }}
        onMouseEnter={(e) => { e.target.style.background = "#2a2318"; e.target.style.color = "#f7f3eb"; e.target.style.borderColor = "#2a2318"; }}
        onMouseLeave={(e) => { e.target.style.background = "rgba(255,252,245,0.6)"; e.target.style.color = "#2a2318"; e.target.style.borderColor = "rgba(61,53,41,0.3)"; }}
      >New Game</button>

      {/* Rules */}
      <p style={{
        fontFamily: "var(--font)", fontSize: mobile ? 12 : 14, color: "#5a4e3e", maxWidth: 380,
        textAlign: "center", lineHeight: 1.7, marginTop: mobile ? 10 : 18, fontWeight: 400,
        padding: mobile ? "0 20px" : 0,
      }}>
        Place stones to form your target shape in any rotation. Completed shapes lock and score points.
        Block your opponent to slow them down.
      </p>
    </div>
  );
}
