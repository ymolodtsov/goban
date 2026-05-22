#!/usr/bin/env node
/**
 * Generate a 400x400 SVG demo image matching the in-app goban exactly.
 * Uses the same gradients, grain pattern, stone styles, and shadows.
 */
import { writeFileSync } from "fs";

const SIZE = 400;
const BOARD = 9;
const CELL = 40;
const PAD = CELL; // padding = one cell
const boardPx = (BOARD - 1) * CELL + PAD * 2; // 8*40 + 80 = 400
const tileSize = boardPx / 2;

// Board state: 0=empty, 1=black, 2=white, 3=locked black, 4=locked white
const B = 1, W = 2, LB = 3, LW = 4;
const board = [
  [LB, LB, LB, 0,  0,  W,  0,  0,  0 ],
  [0,  LB, 0,  0,  LW, LW, 0,  0,  0 ],
  [0,  B,  0,  LW, LW, 0,  0,  0,  W ],
  [LB, 0,  B,  0,  0,  0,  W,  LW, LW],
  [LB, 0,  0,  0,  0,  0,  0,  LW, LW],
  [LB, LB, 0,  0,  B,  0,  0,  0,  0 ],
  [0,  LW, LW, 0,  B,  B,  0,  0,  LB],
  [0,  0,  LW, LW, 0,  B,  0,  LB, LB],
  [0,  0,  0,  0,  W,  W,  W,  W,  LB],
];

const starPoints = [[2,2],[2,6],[6,2],[6,6],[4,4]];
const radius = CELL / 2 - 3;

let gradientDefs = "";
let stonesSvg = "";
let stoneId = 0;

for (let r = 0; r < BOARD; r++) {
  for (let c = 0; c < BOARD; c++) {
    const v = board[r][c];
    if (v === 0) continue;
    const cx = PAD + c * CELL;
    const cy = PAD + r * CELL;
    const isBlack = v === B || v === LB;
    const isLocked = v === LB || v === LW;
    const id = `sg${stoneId++}`;
    const opacity = isLocked ? 0.55 : 1;

    if (isBlack) {
      gradientDefs += `<radialGradient id="${id}" cx="35%" cy="30%" r="65%">
        <stop offset="0%" stop-color="#4a4a4a"/>
        <stop offset="60%" stop-color="#1a1a1a"/>
        <stop offset="100%" stop-color="#0a0a0a"/>
      </radialGradient>\n`;
    } else {
      gradientDefs += `<radialGradient id="${id}" cx="35%" cy="30%" r="65%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="50%" stop-color="#f0ece4"/>
        <stop offset="100%" stop-color="#d8d2c4"/>
      </radialGradient>\n`;
    }

    const hlFill = isBlack ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.65)";
    stonesSvg += `<g opacity="${opacity}">
      <ellipse cx="${cx + 1}" cy="${cy + 2.5}" rx="${radius * 0.92}" ry="${radius * 0.7}" fill="rgba(0,0,0,0.18)"/>
      <circle cx="${cx}" cy="${cy}" r="${radius}" fill="url(#${id})"/>
      <ellipse cx="${cx - radius * 0.22}" cy="${cy - radius * 0.28}" rx="${radius * 0.35}" ry="${radius * 0.22}" fill="${hlFill}"/>
    </g>\n`;
  }
}

// Grid lines
let gridSvg = "";
for (let i = 0; i < BOARD; i++) {
  const sw = (i === 0 || i === BOARD - 1) ? 1.2 : 0.7;
  const pos = PAD + i * CELL;
  const start = PAD;
  const end = PAD + (BOARD - 1) * CELL;
  gridSvg += `<line x1="${start}" y1="${pos}" x2="${end}" y2="${pos}" stroke="rgba(40,28,10,0.45)" stroke-width="${sw}"/>\n`;
  gridSvg += `<line x1="${pos}" y1="${start}" x2="${pos}" y2="${end}" stroke="rgba(40,28,10,0.45)" stroke-width="${sw}"/>\n`;
}

// Star points
let starsSvg = "";
for (const [r, c] of starPoints) {
  starsSvg += `<circle cx="${PAD + c * CELL}" cy="${PAD + r * CELL}" r="3.5" fill="rgba(40,28,10,0.5)"/>\n`;
}

// Grain lines for pattern tile
let grainLines = "";
const spacing = tileSize / 12;
for (let i = 0; i < 12; i++) {
  const y1 = i * spacing + spacing * 0.15;
  const y2 = i * spacing + spacing * 0.4;
  grainLines += `<line x1="0" y1="${y1.toFixed(1)}" x2="${tileSize}" y2="${y2.toFixed(1)}" stroke="rgba(120,80,20,0.06)" stroke-width="1.2"/>\n`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${boardPx} ${boardPx}">
  <defs>
    <linearGradient id="woodGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#deb957"/>
      <stop offset="30%" stop-color="#d4a843"/>
      <stop offset="60%" stop-color="#c99b38"/>
      <stop offset="100%" stop-color="#c08e30"/>
    </linearGradient>
    <pattern id="grain" width="${tileSize}" height="${tileSize}" patternUnits="userSpaceOnUse">
      <rect width="${tileSize}" height="${tileSize}" fill="url(#woodGrad)"/>
      ${grainLines}
    </pattern>
    ${gradientDefs}
  </defs>
  <rect width="${boardPx}" height="${boardPx}" fill="url(#grain)"/>
  ${gridSvg}
  ${starsSvg}
  ${stonesSvg}
</svg>`;

writeFileSync("public/demo.svg", svg);
console.log("Saved public/demo.svg (400x400)");
