import { useState, useCallback, useEffect, useRef } from "react";

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
function canAnyShapeFit(board, player) { return ALL_SHAPES.some((s) => canShapeFit(board, player, s)); }
function pickFeasibleShape(board, player) {
  const f = ALL_SHAPES.filter((s) => canShapeFit(board, player, s));
  return f.length === 0 ? null : f[Math.floor(Math.random() * f.length)];
}

// --- AI ---
function aiMove(board, aiShape, playerShape) {
  const empty = [];
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c] === EMPTY) empty.push([r, c]);
  if (!empty.length) return null;
  for (const [r, c] of empty) { const b = board.map((row) => [...row]); b[r][c] = WHITE; if (findCompletedShape(b, WHITE, aiShape)) return [r, c]; }
  for (const [r, c] of empty) { const b = board.map((row) => [...row]); b[r][c] = BLACK; if (findCompletedShape(b, BLACK, playerShape)) return [r, c]; }
  const whites = [];
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) if (board[r][c] === WHITE) whites.push([r, c]);
  if (whites.length > 0) {
    let best = null, bestS = -1;
    for (const [r, c] of empty) {
      let s = 0;
      for (const [wr, wc] of whites) { const d = Math.abs(r - wr) + Math.abs(c - wc); if (d <= 2) s += 3 - d; }
      s += Math.random() * 0.5;
      if (s > bestS) { bestS = s; best = [r, c]; }
    }
    if (best) return best;
  }
  const ctr = Math.floor(BOARD_SIZE / 2);
  empty.sort((a, b) => (Math.abs(a[0]-ctr)+Math.abs(a[1]-ctr)) - (Math.abs(b[0]-ctr)+Math.abs(b[1]-ctr)) + (Math.random()-0.5)*3);
  return empty[0];
}

// --- STONE SVG COMPONENT (realistic) ---
function Stone({ cx, cy, radius, isBlack, isLocked, isFlash, isLast }) {
  const id = `s${Math.round(cx)}-${Math.round(cy)}`;
  const isActive = !isLocked;
  return (
    <g style={{ animation: isFlash ? "flashPulse 0.7s ease" : isLast ? "stonePop 0.3s cubic-bezier(0.34,1.56,0.64,1)" : "none" }}>
      {/* Active stone — bright golden ring */}
      {isActive && (
        <circle cx={cx} cy={cy} r={radius + 3.5}
          fill="none" stroke="rgba(230,190,60,0.85)" strokeWidth={2.5}
          style={{ animation: "activeGlow 2s ease-in-out infinite" }} />
      )}
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
function ShapePreview({ shape, label, score, isActive, stoneType }) {
  if (!shape) return <div style={{ width: 140, textAlign: "center" }}><span style={{ fontSize: 14, color: "#6b5e4e", fontFamily: "var(--font)" }}>No shapes left</span></div>;
  const cells = shape.cells;
  const maxR = Math.max(...cells.map((c) => c[0])) + 1;
  const maxC = Math.max(...cells.map((c) => c[1])) + 1;
  const sz = 20, pad = 6;
  const w = maxC * sz + pad * 2, h = maxR * sz + pad * 2;
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      transition: "all 0.4s cubic-bezier(0.4,0,0.2,1)",
      transform: isActive ? "scale(1)" : "scale(0.92)", opacity: isActive ? 1 : 0.45,
    }}>
      <span style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5a4e3e" }}>{label}</span>
      <div style={{
        background: isActive ? "rgba(207,164,70,0.12)" : "rgba(207,164,70,0.04)",
        borderRadius: 10, padding: "12px 16px",
        border: isActive ? "2px solid rgba(207,164,70,0.5)" : "2px solid rgba(207,164,70,0.1)",
        transition: "all 0.4s cubic-bezier(0.4,0,0.2,1)",
      }}>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          {cells.map(([r, c], i) => {
            const cx = pad + c * sz + sz / 2, cy = pad + r * sz + sz / 2, rad = sz / 2 - 2;
            return <Stone key={i} cx={cx} cy={cy} radius={rad} isBlack={stoneType === "black"} isLocked={true} isFlash={false} isLast={false} />;
          })}
        </svg>
      </div>
      <span style={{ fontFamily: "var(--font)", fontSize: 15, fontWeight: 700, color: "#2a2318" }}>
        {shape.name}-piece · {shape.size}pts
      </span>
    </div>
  );
}

// --- SCORE BAR ---
function ScoreBar({ score, maxScore, isBlack, label }) {
  const pct = Math.min((score / maxScore) * 100, 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 120 }}>
      <span style={{ fontFamily: "var(--font)", fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5a4e3e" }}>{label}</span>
      <div style={{ fontSize: 38, fontWeight: 700, fontFamily: "var(--font-display)", color: "#2a2318", lineHeight: 1 }}>{score}</div>
      <div style={{ width: 90, height: 5, borderRadius: 3, background: "rgba(61,53,41,0.12)", overflow: "hidden" }}>
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
  const [gameOver, setGameOver] = useState(null);
  const [lastPlaced, setLastPlaced] = useState(null);
  const [lockedCells, setLockedCells] = useState(new Set());
  const [flashCells, setFlashCells] = useState(new Set());
  const [moveCount, setMoveCount] = useState(0);
  const [aiThinking, setAiThinking] = useState(false);
  const [scorePop, setScorePop] = useState(null); // {x, y, pts, key}
  const popKeyRef = useRef(0);

  const handleCellClick = useCallback((r, c) => {
    if (gameOver || turn !== BLACK || board[r][c] !== EMPTY) return;
    const newBoard = board.map((row) => [...row]);
    newBoard[r][c] = BLACK;
    setLastPlaced(`${r},${c}`);
    setMoveCount((m) => m + 1);

    const match = findCompletedShape(newBoard, BLACK, playerShape);
    let newPlayerScore = playerScore;
    let newLocked = new Set(lockedCells);
    let newFlash = new Set();
    if (match) {
      newPlayerScore = playerScore + playerShape.size;
      match.forEach(([mr, mc]) => { newBoard[mr][mc] = LOCKED_BLACK; newLocked.add(`${mr},${mc}`); newFlash.add(`${mr},${mc}`); });
      popKeyRef.current++;
      setScorePop({ x: r, y: c, pts: playerShape.size, key: popKeyRef.current, player: "black" });
      setTimeout(() => setScorePop(null), 1200);
    }
    setBoard(newBoard);
    setPlayerScore(newPlayerScore);
    setLockedCells(newLocked);
    setFlashCells(newFlash);

    if (newPlayerScore >= WIN_SCORE) { setGameOver("player"); return; }
    let nextPlayerShape = match ? null : playerShape;
    if (match || !canShapeFit(newBoard, BLACK, playerShape)) { nextPlayerShape = pickFeasibleShape(newBoard, BLACK); setPlayerShape(nextPlayerShape); }
    if (newFlash.size > 0) setTimeout(() => setFlashCells(new Set()), 700);
    const hasEmpty = newBoard.some((row) => row.some((cell) => cell === EMPTY));
    if (!hasEmpty) { setGameOver(newPlayerScore > aiScore ? "player" : aiScore > newPlayerScore ? "ai" : "draw"); return; }
    if (!nextPlayerShape && !canAnyShapeFit(newBoard, WHITE)) { setGameOver(newPlayerScore > aiScore ? "player" : aiScore > newPlayerScore ? "ai" : "draw"); return; }
    setTurn(WHITE);
    setAiThinking(true);
  }, [board, turn, gameOver, playerShape, playerScore, aiScore, lockedCells]);

  useEffect(() => {
    if (turn !== WHITE || gameOver || !aiThinking) return;
    const timeout = setTimeout(() => {
      let currentAiShape = aiShapeState;
      if (!canShapeFit(board, WHITE, currentAiShape)) {
        currentAiShape = pickFeasibleShape(board, WHITE);
        if (!currentAiShape) {
          if (!canAnyShapeFit(board, BLACK)) setGameOver(playerScore > aiScore ? "player" : aiScore > playerScore ? "ai" : "draw");
          else setTurn(BLACK);
          setAiThinking(false); return;
        }
        setAiShape(currentAiShape);
      }
      const move = aiMove(board, currentAiShape, playerShape);
      if (!move) { setGameOver(playerScore > aiScore ? "player" : aiScore > playerScore ? "ai" : "draw"); setAiThinking(false); return; }
      const [r, c] = move;
      const newBoard = board.map((row) => [...row]);
      newBoard[r][c] = WHITE;
      setLastPlaced(`${r},${c}`);
      setMoveCount((m) => m + 1);
      const match = findCompletedShape(newBoard, WHITE, currentAiShape);
      let newAiScore = aiScore;
      let newLocked = new Set(lockedCells);
      let newFlash = new Set();
      if (match) {
        newAiScore = aiScore + currentAiShape.size;
        match.forEach(([mr, mc]) => { newBoard[mr][mc] = LOCKED_WHITE; newLocked.add(`${mr},${mc}`); newFlash.add(`${mr},${mc}`); });
        popKeyRef.current++;
        setScorePop({ x: r, y: c, pts: currentAiShape.size, key: popKeyRef.current, player: "white" });
        setTimeout(() => setScorePop(null), 1200);
      }
      setBoard(newBoard); setAiScore(newAiScore); setLockedCells(newLocked); setFlashCells(newFlash);
      if (newAiScore >= WIN_SCORE) { setGameOver("ai"); setAiThinking(false); return; }
      if (match || !canShapeFit(newBoard, WHITE, currentAiShape)) {
        const next = pickFeasibleShape(newBoard, WHITE);
        if (next) setAiShape(next);
        if (!next && !canAnyShapeFit(newBoard, BLACK)) { setGameOver(newAiScore > playerScore ? "ai" : playerScore > newAiScore ? "player" : "draw"); setAiThinking(false); return; }
      }
      if (newFlash.size > 0) setTimeout(() => setFlashCells(new Set()), 700);
      const hasEmpty = newBoard.some((row) => row.some((cell) => cell === EMPTY));
      if (!hasEmpty) { setGameOver(newAiScore > playerScore ? "ai" : playerScore > newAiScore ? "player" : "draw"); setAiThinking(false); return; }
      setTurn(BLACK); setAiThinking(false);
    }, 600);
    return () => clearTimeout(timeout);
  }, [turn, aiThinking]);

  const resetGame = () => {
    setBoard(createBoard()); setPlayerShape(randomShape()); setAiShape(randomShape());
    setPlayerScore(0); setAiScore(0); setTurn(BLACK); setGameOver(null);
    setLastPlaced(null); setLockedCells(new Set()); setFlashCells(new Set());
    setMoveCount(0); setAiThinking(false); setScorePop(null);
  };

  const cellSize = 40;
  const padding = cellSize;
  const boardPx = (BOARD_SIZE - 1) * cellSize + padding * 2;
  const starPoints = [[2,2],[2,6],[6,2],[6,6],[4,4]];

  return (
    <div style={{
      "--font": "'Crimson Pro', 'Georgia', serif",
      "--font-display": "'Crimson Pro', 'Georgia', serif",
      minHeight: "100vh",
      background: "linear-gradient(180deg, #f7f3eb 0%, #ede6d8 100%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "28px 16px 40px",
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
      `}</style>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 24, animation: "fadeIn 0.6s ease" }}>
        <h1 style={{
          fontFamily: "var(--font-display)", fontSize: 42, fontWeight: 300, letterSpacing: "0.22em",
          textTransform: "uppercase", margin: 0, color: "#2a2318",
        }}>Goban</h1>
        <p style={{
          fontFamily: "var(--font)", fontSize: 15, color: "#5a4e3e", margin: "6px 0 0",
          letterSpacing: "0.04em", fontWeight: 400,
        }}>Build shapes on the board · First to {WIN_SCORE}</p>
      </div>

      {/* Scores */}
      <div style={{ display: "flex", gap: 40, marginBottom: 20, alignItems: "center" }}>
        <ScoreBar score={playerScore} maxScore={WIN_SCORE} isBlack={true} label="You · Black" />
        <div style={{
          width: 1, height: 48, background: "rgba(61,53,41,0.1)",
        }} />
        <ScoreBar score={aiScore} maxScore={WIN_SCORE} isBlack={false} label="AI · White" />
      </div>

      {/* Shape targets */}
      <div style={{ display: "flex", gap: 32, marginBottom: 14, alignItems: "flex-start" }}>
        <ShapePreview shape={playerShape} label="Your target" score={playerScore} isActive={turn === BLACK && !gameOver} stoneType="black" />
        <ShapePreview shape={aiShapeState} label="AI target" score={aiScore} isActive={turn === WHITE && !gameOver} stoneType="white" />
      </div>

      {/* Status */}
      <div style={{ height: 36, display: "flex", alignItems: "center", marginBottom: 12 }}>
        {!gameOver && (
          <div style={{
            fontFamily: "var(--font)", fontSize: 17, color: turn === BLACK ? "#2a2318" : "#6b5e4e",
            fontWeight: 600, letterSpacing: "0.02em",
            animation: turn === WHITE ? "pulse 1.2s ease infinite" : "none",
            transition: "color 0.3s",
          }}>
            {turn === BLACK ? "Your turn" : "Thinking…"}
          </div>
        )}
        {gameOver && (
          <div style={{ textAlign: "center", animation: "gameOverIn 0.5s cubic-bezier(0.34,1.56,0.64,1)" }}>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, letterSpacing: "0.04em",
              color: gameOver === "player" ? "#2d6a4f" : gameOver === "ai" ? "#9b2226" : "#5a4e3e",
            }}>
              {gameOver === "player" ? "You win" : gameOver === "ai" ? "AI wins" : "Draw"}
            </div>
            <div style={{ fontFamily: "var(--font)", fontSize: 14, color: "#5a4e3e", marginTop: 3, fontWeight: 500 }}>
              {playerScore >= WIN_SCORE || aiScore >= WIN_SCORE
                ? `${playerScore} – ${aiScore}`
                : `Board locked · ${playerScore} – ${aiScore}`}
            </div>
          </div>
        )}
      </div>

      {/* Board */}
      <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", flexShrink: 0,
        boxShadow: "0 2px 4px rgba(0,0,0,0.06), 0 12px 40px rgba(61,53,41,0.12), inset 0 1px 0 rgba(255,255,255,0.3)",
      }}>
        {/* Wood texture bg */}
        <svg width={boardPx} height={boardPx} viewBox={`0 0 ${boardPx} ${boardPx}`}
          style={{ display: "block", cursor: turn === BLACK && !gameOver ? "crosshair" : "default" }}>
          {/* Board background with wood grain */}
          <defs>
            <linearGradient id="woodGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#deb957" />
              <stop offset="30%" stopColor="#d4a843" />
              <stop offset="60%" stopColor="#c99b38" />
              <stop offset="100%" stopColor="#c08e30" />
            </linearGradient>
            <pattern id="grain" width="200" height="200" patternUnits="userSpaceOnUse">
              <rect width="200" height="200" fill="url(#woodGrad)" />
              {[...Array(12)].map((_, i) => (
                <line key={i} x1={0} y1={i * 17 + 3} x2={200} y2={i * 17 + 8}
                  stroke="rgba(120,80,20,0.06)" strokeWidth={1 + Math.random()} />
              ))}
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
                isBlack={isBlack} isLocked={isLocked}
                isFlash={flashCells.has(`${r},${c}`)}
                isLast={lastPlaced === `${r},${c}`} />;
            })
          )}

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
      </div>

      {/* New game */}
      <button onClick={resetGame} style={{
        marginTop: 24, padding: "12px 36px",
        fontFamily: "var(--font)", fontSize: 15, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase",
        border: "2px solid rgba(61,53,41,0.3)", borderRadius: 6,
        background: "rgba(255,252,245,0.6)",
        color: "#2a2318", cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
      }}
        onMouseEnter={(e) => { e.target.style.background = "#2a2318"; e.target.style.color = "#f7f3eb"; e.target.style.borderColor = "#2a2318"; }}
        onMouseLeave={(e) => { e.target.style.background = "rgba(255,252,245,0.6)"; e.target.style.color = "#2a2318"; e.target.style.borderColor = "rgba(61,53,41,0.3)"; }}
      >New Game</button>

      {/* Rules */}
      <p style={{
        fontFamily: "var(--font)", fontSize: 14, color: "#5a4e3e", maxWidth: 380,
        textAlign: "center", lineHeight: 1.7, marginTop: 18, fontWeight: 400,
      }}>
        Place stones to form your target shape in any rotation. Completed shapes lock and score points.
        Block your opponent to slow them down.
      </p>
    </div>
  );
}
