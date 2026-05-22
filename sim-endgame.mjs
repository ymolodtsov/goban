#!/usr/bin/env node
// Analyze endgame behavior — how often do games reach 20 vs end by board conditions?
// Also track: how many moves after the last shape completion, and what scores look like.

const BOARD_SIZE = 9, WIN_SCORE = 20;
const EMPTY = 0, BLACK = 1, WHITE = 2, LOCKED_BLACK = 3, LOCKED_WHITE = 4;
const AI_TEMPERATURE = 1.2;

const SHAPE_DEFS = {
  I: [[0,0],[0,1],[0,2],[0,3]], O: [[0,0],[0,1],[1,0],[1,1]],
  T: [[0,0],[0,1],[0,2],[1,1]], S: [[0,0],[0,1],[1,1],[1,2]],
  Z: [[0,1],[0,2],[1,0],[1,1]], L: [[0,0],[1,0],[2,0],[2,1]],
  J: [[0,0],[0,1],[1,0],[2,0]],
};

function normalize(cells) {
  const minR = Math.min(...cells.map(c=>c[0])), minC = Math.min(...cells.map(c=>c[1]));
  const s = cells.map(([r,c])=>[r-minR,c-minC]); s.sort((a,b)=>a[0]-b[0]||a[1]-b[1]); return s;
}
function getRotations(cells) {
  const rots = new Set(); let c = cells.map(([r,col])=>[r,col]);
  for (let i=0;i<4;i++) { rots.add(JSON.stringify(normalize(c))); rots.add(JSON.stringify(normalize(c.map(([r,col])=>[r,-col])))); c=c.map(([r,col])=>[col,-r]); }
  return [...rots].map(s=>JSON.parse(s));
}
const ALL_SHAPES = Object.entries(SHAPE_DEFS).map(([name,cells])=>({name,cells,size:cells.length,rotations:getRotations(cells)}));
const randomShape = ()=>ALL_SHAPES[Math.floor(Math.random()*ALL_SHAPES.length)];
const createBoard = ()=>Array.from({length:BOARD_SIZE},()=>Array(BOARD_SIZE).fill(EMPTY));

function findCompletedShape(board,player,shape) {
  const pCells=[]; for(let r=0;r<BOARD_SIZE;r++) for(let c=0;c<BOARD_SIZE;c++) if(board[r][c]===player) pCells.push([r,c]);
  if(pCells.length<shape.size) return null;
  const set=new Set(pCells.map(([r,c])=>`${r},${c}`));
  for(const rot of shape.rotations) for(const[pr,pc] of pCells) {
    const bR=pr-rot[0][0],bC=pc-rot[0][1]; const placed=rot.map(([dr,dc])=>[bR+dr,bC+dc]);
    if(placed.every(([r,c])=>r>=0&&r<BOARD_SIZE&&c>=0&&c<BOARD_SIZE&&set.has(`${r},${c}`))) return placed;
  }
  return null;
}
function canShapeFit(board,player,shape) {
  for(const rot of shape.rotations) for(let bR=-shape.size;bR<BOARD_SIZE+1;bR++) for(let bC=-shape.size;bC<BOARD_SIZE+1;bC++) {
    const placed=rot.map(([dr,dc])=>[bR+dr,bC+dc]);
    if(placed.every(([r,c])=>r>=0&&r<BOARD_SIZE&&c>=0&&c<BOARD_SIZE&&(board[r][c]===EMPTY||board[r][c]===player))) return true;
  }
  return false;
}
function canAnyShapeFit(board,player) { return ALL_SHAPES.some(s=>canShapeFit(board,player,s)); }
function pickFeasibleShape(board,player) {
  const f=ALL_SHAPES.filter(s=>canShapeFit(board,player,s));
  return f.length?f[Math.floor(Math.random()*f.length)]:null;
}
function findPlacements(board,player,shape) {
  const locked=player===BLACK?LOCKED_BLACK:LOCKED_WHITE; const results=[];
  for(const rot of shape.rotations) for(let bR=0;bR<BOARD_SIZE;bR++) for(let bC=0;bC<BOARD_SIZE;bC++) {
    const cells=rot.map(([dr,dc])=>[bR+dr,bC+dc]);
    if(!cells.every(([r,c])=>r>=0&&r<BOARD_SIZE&&c>=0&&c<BOARD_SIZE)) continue;
    let filled=0,blocked=false; const emptyCells=[];
    for(const[r,c] of cells) { const v=board[r][c]; if(v===player||v===locked)filled++; else if(v===EMPTY)emptyCells.push([r,c]); else{blocked=true;break;} }
    if(!blocked) results.push({cells,filled,emptyCells,total:shape.size});
  }
  return results;
}
function potentialMap(board,player,shape) {
  const scores=Array.from({length:BOARD_SIZE},()=>Array(BOARD_SIZE).fill(0));
  for(const p of findPlacements(board,player,shape)) { const w=(0.2+p.filled)*(0.2+p.filled); for(const[r,c] of p.emptyCells) scores[r][c]+=w; }
  return scores;
}
function softmaxSample(items,temp) {
  if(!items.length) return null; const maxS=Math.max(...items.map(x=>x.score));
  const exps=items.map(x=>Math.exp((x.score-maxS)/temp)); const sum=exps.reduce((a,b)=>a+b,0);
  let rand=Math.random()*sum; for(let i=0;i<items.length;i++){rand-=exps[i];if(rand<=0)return items[i];} return items[items.length-1];
}
function aiMove(board,myShape,oppShape,player=WHITE) {
  const opp=player===WHITE?BLACK:WHITE;
  const empty=[]; for(let r=0;r<BOARD_SIZE;r++) for(let c=0;c<BOARD_SIZE;c++) if(board[r][c]===EMPTY) empty.push([r,c]);
  if(!empty.length) return null;
  for(const[r,c] of empty){const b=board.map(row=>[...row]);b[r][c]=player;if(findCompletedShape(b,player,myShape))return[r,c];}
  for(const[r,c] of empty){const b=board.map(row=>[...row]);b[r][c]=opp;if(findCompletedShape(b,opp,oppShape))return[r,c];}
  const offMap=potentialMap(board,player,myShape); const defMap=potentialMap(board,opp,oppShape);
  const ctr=(BOARD_SIZE-1)/2;
  const scored=empty.map(([r,c])=>({move:[r,c],score:offMap[r][c]*1.1+defMap[r][c]*0.9+(1-(Math.abs(r-ctr)+Math.abs(c-ctr))/BOARD_SIZE)*0.3}));
  const pick=softmaxSample(scored,AI_TEMPERATURE); return pick?pick.move:empty[0];
}

// NO auto-reroll version of resolveCompletions
function resolveCompletions(board,player,shape,locked) {
  let totalScore=0,currentShape=shape; const allFlash=new Set();
  const lockedType=player===BLACK?LOCKED_BLACK:LOCKED_WHITE;
  while(currentShape) {
    const match=findCompletedShape(board,player,currentShape);
    if(!match) break;
    totalScore+=currentShape.size;
    match.forEach(([r,c])=>{board[r][c]=lockedType;locked.add(`${r},${c}`);allFlash.add(`${r},${c}`);});
    currentShape=pickFeasibleShape(board,player);
  }
  // NO auto-reroll if shape doesn't fit — just keep the impossible shape
  return {score:totalScore,shape:currentShape,flash:allFlash};
}

function playGame() {
  const board=createBoard();
  let bShape=randomShape(),wShape=randomShape();
  let bScore=0,wScore=0,moves=0;
  const locked=new Set();
  let lastCompletionMove=0;
  let endReason="";
  let bShapeFeasible=true, wShapeFeasible=true;
  // Track moves where a player was stuck (shape impossible, just placing stones)
  let bStuckMoves=0, wStuckMoves=0;

  while(moves<200) {
    // BLACK turn
    const bCanFit = bShape && canShapeFit(board, BLACK, bShape);
    if (!bCanFit && bShape) bStuckMoves++;

    const bMove = bCanFit
      ? aiMove(board, bShape, wShape||randomShape(), BLACK)
      : (() => { // just pick random empty cell when stuck
          const empty=[];
          for(let r=0;r<BOARD_SIZE;r++) for(let c=0;c<BOARD_SIZE;c++) if(board[r][c]===EMPTY) empty.push([r,c]);
          return empty.length ? empty[Math.floor(Math.random()*empty.length)] : null;
        })();

    if(!bMove) { endReason="board_full"; break; }
    board[bMove[0]][bMove[1]]=BLACK; moves++;

    if (bCanFit) {
      const res=resolveCompletions(board,BLACK,bShape,locked);
      bScore+=res.score;
      if(res.score>0) lastCompletionMove=moves;
      bShape=res.shape;
    }
    if(bScore>=WIN_SCORE) { endReason="black_20"; return {winner:"black",bScore,wScore,moves,endReason,lastCompletionMove,bStuckMoves,wStuckMoves}; }
    if(!board.some(row=>row.some(c=>c===EMPTY))) { endReason="board_full"; break; }

    // WHITE turn
    const wCanFit = wShape && canShapeFit(board, WHITE, wShape);
    if (!wCanFit && wShape) wStuckMoves++;

    const wMove = wCanFit
      ? aiMove(board, wShape, bShape||randomShape(), WHITE)
      : (() => {
          const empty=[];
          for(let r=0;r<BOARD_SIZE;r++) for(let c=0;c<BOARD_SIZE;c++) if(board[r][c]===EMPTY) empty.push([r,c]);
          return empty.length ? empty[Math.floor(Math.random()*empty.length)] : null;
        })();

    if(!wMove) { endReason="board_full"; break; }
    board[wMove[0]][wMove[1]]=WHITE; moves++;

    if (wCanFit) {
      const res=resolveCompletions(board,WHITE,wShape,locked);
      wScore+=res.score;
      if(res.score>0) lastCompletionMove=moves;
      wShape=res.shape;
    }
    if(wScore>=WIN_SCORE) { endReason="white_20"; return {winner:"white",bScore,wScore,moves,endReason,lastCompletionMove,bStuckMoves,wStuckMoves}; }
    if(!board.some(row=>row.some(c=>c===EMPTY))) { endReason="board_full"; break; }
  }

  const winner=bScore>wScore?"black":wScore>bScore?"white":"draw";
  if(!endReason) endReason="max_moves";
  return {winner,bScore,wScore,moves,endReason,lastCompletionMove,bStuckMoves,wStuckMoves};
}

// --- Run ---
const N=parseInt(process.argv[2])||200;
const results=[];
for(let i=0;i<N;i++) results.push(playGame());

const byReason={};
results.forEach(r => { byReason[r.endReason]=(byReason[r.endReason]||0)+1; });

const avg=(arr,fn)=>arr.reduce((s,x)=>s+fn(x),0)/arr.length;

console.log(`\n=== Endgame Analysis: ${N} games (AI vs AI, no auto-reroll) ===\n`);
console.log(`End reasons:`);
Object.entries(byReason).sort((a,b)=>b[1]-a[1]).forEach(([r,c])=>console.log(`  ${r}: ${c} (${(c/N*100).toFixed(0)}%)`));

console.log(`\nAvg moves/game:  ${avg(results,r=>r.moves).toFixed(1)} / 81`);
console.log(`Avg scores:      Black ${avg(results,r=>r.bScore).toFixed(1)}  White ${avg(results,r=>r.wScore).toFixed(1)}`);

// How many moves after the last completion?
const tailMoves = results.map(r => r.moves - r.lastCompletionMove);
console.log(`\nMoves after last shape completion (the "boring tail"):`);
console.log(`  avg: ${avg(results,r=>r.moves-r.lastCompletionMove).toFixed(1)}`);
console.log(`  max: ${Math.max(...tailMoves)}`);
const longTails = tailMoves.filter(t => t > 10).length;
console.log(`  games with 10+ tail moves: ${longTails} (${(longTails/N*100).toFixed(0)}%)`);
const veryLongTails = tailMoves.filter(t => t > 20).length;
console.log(`  games with 20+ tail moves: ${veryLongTails} (${(veryLongTails/N*100).toFixed(0)}%)`);

// Stuck moves
console.log(`\nStuck moves (player had impossible shape, placed randomly):`);
console.log(`  Black avg: ${avg(results,r=>r.bStuckMoves).toFixed(1)}  max: ${Math.max(...results.map(r=>r.bStuckMoves))}`);
console.log(`  White avg: ${avg(results,r=>r.wStuckMoves).toFixed(1)}  max: ${Math.max(...results.map(r=>r.wStuckMoves))}`);
const anyStuck = results.filter(r => r.bStuckMoves > 0 || r.wStuckMoves > 0).length;
console.log(`  Games with any stuck turns: ${anyStuck} (${(anyStuck/N*100).toFixed(0)}%)`);

// Board-full games score distribution
const boardFullGames = results.filter(r => r.endReason === "board_full");
if (boardFullGames.length) {
  console.log(`\nBoard-full games (${boardFullGames.length}):`);
  console.log(`  Avg scores: Black ${avg(boardFullGames,r=>r.bScore).toFixed(1)}  White ${avg(boardFullGames,r=>r.wScore).toFixed(1)}`);
  const closeGames = boardFullGames.filter(r => Math.abs(r.bScore - r.wScore) <= 4).length;
  console.log(`  Close games (margin ≤ 4): ${closeGames} (${(closeGames/boardFullGames.length*100).toFixed(0)}%)`);
}
console.log();
