#!/usr/bin/env python3
"""Generate a 400x400 demo image of the Goban game with tetromino figures."""
from PIL import Image, ImageDraw, ImageFilter
import math

SIZE = 400
BOARD = 9
PAD = 44  # padding from edge to first line
CELL = (SIZE - 2 * PAD) / (BOARD - 1)  # ~39px

img = Image.new("RGB", (SIZE, SIZE))
draw = ImageDraw.Draw(img)

# Wood gradient background
for y in range(SIZE):
    for x in range(SIZE):
        # Diagonal gradient matching the app
        t = (x + y) / (2 * SIZE)
        r = int(222 - t * 30)
        g = int(185 - t * 40)
        b = int(87 - t * 40)
        img.putpixel((x, y), (r, g, b))

# Subtle grain lines (horizontal, slightly angled)
for i in range(24):
    y0 = int(i * SIZE / 24 + 3)
    y1 = int(i * SIZE / 24 + 6)
    for x in range(SIZE):
        yy = y0 + int(2 * math.sin(x / 80))
        if 0 <= yy < SIZE:
            pr, pg, pb = img.getpixel((x, yy))
            img.putpixel((x, yy), (max(0, pr - 4), max(0, pg - 3), max(0, pb - 2)))

# Grid lines
for i in range(BOARD):
    lw = 2 if i == 0 or i == BOARD - 1 else 1
    x = int(PAD + i * CELL)
    y = int(PAD + i * CELL)
    x0 = int(PAD)
    x1 = int(PAD + (BOARD - 1) * CELL)
    draw.line([(x, x0), (x, x1)], fill=(40, 28, 10, 115), width=lw)
    draw.line([(x0, y), (x1, y)], fill=(40, 28, 10, 115), width=lw)

# Star points
star_pts = [(2, 2), (2, 6), (6, 2), (6, 6), (4, 4)]
for r, c in star_pts:
    cx = int(PAD + c * CELL)
    cy = int(PAD + r * CELL)
    draw.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=(40, 28, 10))

def draw_stone(img, draw, row, col, is_black, is_locked=False):
    cx = int(PAD + col * CELL)
    cy = int(PAD + row * CELL)
    radius = int(CELL / 2 - 2)

    # Shadow
    shadow_img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_img)
    sd.ellipse([cx - radius + 1, cy - radius + 3, cx + radius + 1, cy + radius + 3],
               fill=(0, 0, 0, 40))
    img.paste(Image.alpha_composite(Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), shadow_img).convert("RGB"),
              mask=shadow_img.split()[3])

    # Stone body with radial gradient
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            dist = math.sqrt(dx * dx + dy * dy)
            if dist > radius:
                continue
            px, py = cx + dx, cy + dy
            if px < 0 or px >= SIZE or py < 0 or py >= SIZE:
                continue

            # Offset gradient center to top-left for 3D effect
            gdx = dx + radius * 0.25
            gdy = dy + radius * 0.30
            t = min(1.0, math.sqrt(gdx * gdx + gdy * gdy) / (radius * 1.3))

            if is_black:
                r = int(74 - t * 64)
                g = int(74 - t * 64)
                b = int(74 - t * 64)
            else:
                r = int(255 - t * 55)
                g = int(255 - t * 60)
                b = int(255 - t * 65)

            if is_locked:
                # Slightly dimmed for locked stones
                r = int(r * 0.7)
                g = int(g * 0.7)
                b = int(b * 0.7)

            img.putpixel((px, py), (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b))))

    # Highlight
    hx = cx - int(radius * 0.22)
    hy = cy - int(radius * 0.28)
    hr = int(radius * 0.25)
    for dy in range(-hr, hr + 1):
        for dx in range(-hr - 2, hr + 2 + 1):
            dist = math.sqrt((dx / (hr + 2)) ** 2 + (dy / hr) ** 2)
            if dist > 1:
                continue
            px, py = hx + dx, hy + dy
            if 0 <= px < SIZE and 0 <= py < SIZE:
                pr, pg, pb = img.getpixel((px, py))
                alpha = int((1 - dist) * (20 if is_black else 120))
                img.putpixel((px, py), (min(255, pr + alpha), min(255, pg + alpha), min(255, pb + alpha)))

# Define the board state — a rich mid-game with clear tetromino shapes
# B = black, W = white, LB = locked black, LW = locked white
EMPTY, B, W, LB, LW = 0, 1, 2, 3, 4

board = [
    [LB, LB, LB, 0,  0,  0,  W,  0,  0 ],  # row 0: T-piece black (locked) top
    [0,  LB, 0,  0,  0,  LW, LW, 0,  W ],  # row 1: T stem + S-piece white start
    [0,  B,  0,  0,  LW, LW, 0,  0,  0 ],  # row 2: S-piece white end
    [LB, 0,  B,  0,  0,  W,  0,  LW, LW],  # row 3: L-piece black start + O white
    [LB, 0,  0,  B,  0,  0,  0,  LW, LW],  # row 4: L continues
    [LB, LB, 0,  0,  0,  0,  B,  0,  0 ],  # row 5: L end
    [0,  LW, LW, 0,  0,  B,  B,  0,  0 ],  # row 6: Z-piece white
    [0,  0,  LW, LW, 0,  B,  0,  0,  0 ],  # row 7: Z end
    [0,  0,  0,  0,  W,  W,  W,  W,  0 ],  # row 8: I-piece white in progress
]

# Draw all stones (locked first for layering, then active)
for row in range(BOARD):
    for col in range(BOARD):
        v = board[row][col]
        if v == LB:
            draw_stone(img, draw, row, col, is_black=True, is_locked=True)
        elif v == LW:
            draw_stone(img, draw, row, col, is_black=False, is_locked=True)

for row in range(BOARD):
    for col in range(BOARD):
        v = board[row][col]
        if v == B:
            draw_stone(img, draw, row, col, is_black=True, is_locked=False)
        elif v == W:
            draw_stone(img, draw, row, col, is_black=False, is_locked=False)

img.save("public/demo.png", "PNG")
print("Saved public/demo.png (400x400)")
