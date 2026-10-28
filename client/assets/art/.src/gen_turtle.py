# -*- coding: utf-8 -*-
"""PetBattle art - water turtle (juvenile), idle x4, SIDE VIEW, lying flat.
64x64 canvas, bottom-center pivot at (32,62), light from top-left.
Natural turtle silhouette (not anthropomorphic).
Deterministic.
"""
import json, os, math
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont

W = H = 64
OUT = r"D:\github-mine\petbattle\client\assets\art\pets\turtle\water"
os.makedirs(OUT, exist_ok=True)

P = {
    'outline':    (38, 34, 28, 255),
    'shell_lite': (156, 172, 96, 255),
    'shell':      (124, 142, 74, 255),
    'shell_dark': (92, 106, 56, 255),
    'shell_edge': (66, 76, 42, 255),
    'seam':       (104, 120, 64, 255),
    'plastron':   (222, 218, 178, 255),
    'skin':       (146, 158, 110, 255),
    'skin_lite':  (180, 190, 142, 255),
    'skin_dark':  (104, 116, 80, 255),
    'water':      (108, 206, 228, 255),
    'water_lite': (198, 246, 252, 255),
    'water_dark': (52, 146, 176, 255),
    'eye':        (26, 32, 28, 255),
    'eye_hi':     (240, 250, 240, 255),
}


def shade_ellipse(img, cx, cy, rx, ry, c_lite, c_mid, c_dark, lx=-0.40, ly=-0.50):
    px = img.load()
    for y in range(cy - ry, cy + ry + 1):
        for x in range(cx - rx, cx + rx + 1):
            nx = (x - cx) / rx
            ny = (y - cy) / ry
            if nx * nx + ny * ny <= 1.0:
                dist = math.hypot(nx - lx, ny - ly)
                px[x, y] = c_lite if dist < 0.70 else (c_mid if dist < 1.20 else c_dark)


def waterise_leg(d, d_img, cx, cy, rx, ry, wet=True, far=False):
    """Near legs dissolve into water along a wavy line; far legs read as depth."""
    base = P['skin_dark'] if far else P['skin']
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=base)
    if far:
        return
    # wavy water line: zigzag polygon, water below
    y0 = cy + 2
    pts = [(cx - rx + 1, y0)]
    step = max(1, (rx * 2 - 2) // 3)
    for i in range(3):
        xa = cx - rx + 1 + i * step
        pts.append((xa + step // 2, y0 - 1))
        pts.append((xa + step, y0))
    pts += [(cx + rx - 1, cy + ry), (cx - rx + 1, cy + ry)]
    d.polygon(pts, fill=P['water'])
    d.line([(cx - rx + 2, cy + 2), (cx - 1, cy + 2)], fill=P['water_lite'])
    # drips
    for dx in (-rx + 2, 0, rx - 2):
        d.line([cx + dx, cy + ry, cx + dx, cy + ry + 1], fill=P['water'])
        d.point((cx + dx, cy + ry + 2), fill=P['water_lite'])
    _ = wet


def draw_body(head_dy=0, blink=False, drop_dy=0):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    dy = head_dy

    # ---- tail (back-left, pokes past the shell) ----
    d.polygon([(9, 47), (3, 46), (6, 51)], fill=P['skin_dark'])

    # ---- far-side legs (behind the shell, darker) ----
    waterise_leg(d, img, 24, 49, 4, 2, far=True)
    waterise_leg(d, img, 47, 49, 4, 2, far=True)

    # ---- shell skirt / rim ----
    d.ellipse([7, 41, 53, 53], fill=P['shell_edge'])
    d.ellipse([8, 42, 52, 52], fill=P['shell_dark'])

    # ---- carapace dome ----
    shade_ellipse(img, 30, 34, 20, 13, P['shell_lite'], P['shell'], P['shell_dark'])

    # ---- scutes: short brick seams, low contrast (plates, not a grid) ----
    seam = P['seam']
    d.line([16, 31, 44, 31], fill=seam)                       # main seam
    for x in (23, 36):                                        # ticks above
        d.line([x, 25, x, 30], fill=seam)
    for x in (20, 31, 41):                                    # ticks below
        d.line([x, 32, x, 37], fill=seam)
    # carapace / skirt separation
    d.arc([9, 32, 51, 52], 25, 155, fill=seam, width=1)
    # rim light along the top-left of the dome
    d.arc([11, 22, 49, 46], 175, 330, fill=P['shell_lite'], width=2)

    # ---- plastron strip near the ground ----
    d.ellipse([13, 46, 47, 52], fill=P['plastron'])

    # ---- near-side legs ----
    waterise_leg(d, img, 17, 54, 6, 4)
    waterise_leg(d, img, 43, 54, 6, 4)

    # ---- neck + head, reaching forward and low ----
    d.polygon([(43, 38 + dy), (49, 40 + dy), (49, 48 + dy), (43, 46 + dy)],
              fill=P['skin'])
    d.ellipse([46, 37 + dy, 60, 49 + dy], fill=P['skin'])
    d.arc([47, 38 + dy, 59, 48 + dy], 170, 330, fill=P['skin_lite'], width=2)
    d.arc([47, 38 + dy, 59, 48 + dy], 20, 150, fill=P['skin_dark'], width=1)

    # eye
    if blink:
        d.line([52, 42 + dy, 53, 42 + dy], fill=P['eye'])
    else:
        d.rectangle([52, 41 + dy, 53, 42 + dy], fill=P['eye'])
        d.point((52, 41 + dy), fill=P['eye_hi'])
    # nostril + mouth
    d.point((58, 42 + dy), fill=P['eye'])
    d.line([55, 46 + dy, 58, 46 + dy], fill=P['skin_dark'])

    # ---- water droplets on the shell rim ----
    for (x, y) in [(14, 44), (44, 42)]:
        yy = y + drop_dy
        d.point((x + 1, yy), fill=P['water'])
        d.rectangle([x, yy + 1, x + 1, yy + 2], fill=P['water'])
        d.point((x, yy + 1), fill=P['water_lite'])

    return img


def add_outline(img):
    alpha = img.getchannel('A')
    grown = alpha.filter(ImageFilter.MaxFilter(3))
    ring = ImageChops.subtract(grown, alpha)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.paste(Image.new('RGBA', (W, H), P['outline']), (0, 0), ring)
    out.alpha_composite(img)
    return out


SPEC = [
    dict(head_dy=0, blink=False, drop_dy=0),
    dict(head_dy=-1, blink=False, drop_dy=-1),
    dict(head_dy=-1, blink=False, drop_dy=-1),
    dict(head_dy=0, blink=True, drop_dy=0),
]
frames = [add_outline(draw_body(**s)) for s in SPEC]

for i, f in enumerate(frames):
    f.save(os.path.join(OUT, f'pet_turtle_water_idle_{i:02d}.png'))

sheet = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
for i, f in enumerate(frames):
    sheet.paste(f, (i * W, 0))
sheet.save(os.path.join(OUT, 'pet_turtle_water_idle.png'))

meta = {
    "image": "pet_turtle_water_idle.png",
    "species": "turtle", "element": "water", "stage": "juvenile", "action": "idle",
    "pose": "side, lying flat", "frameSize": [W, H],
    "pivot": [0.5, 0.96875], "groundLineY": 62, "fps": 8, "loop": True,
    "frames": [{"index": i, "rect": [i * W, 0, W, H], "duration": 125} for i in range(len(frames))],
}
with open(os.path.join(OUT, 'pet_turtle_water_idle.json'), 'w', encoding='utf-8') as fh:
    json.dump(meta, fh, ensure_ascii=False, indent=2)

# ---- preview ----
SCALE = 4
pad, gap, label_h = 12, 14, 20
cols = len(frames)
cell = W * SCALE
pw = pad * 2 + cols * cell + (cols - 1) * gap
lighth = cell + label_h + 10
ph = pad * 2 + cell + label_h + lighth
preview = Image.new('RGBA', (pw, ph), (27, 16, 48, 255))
d = ImageDraw.Draw(preview)
try:
    font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 13)
except Exception:
    font = ImageFont.load_default()

for i, f in enumerate(frames):
    x = pad + i * (cell + gap); y = pad
    d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(38, 24, 66, 255))
    d.line([x, y + 62 * SCALE, x + cell - 1, y + 62 * SCALE], fill=(70, 46, 110, 255))
    preview.alpha_composite(f.resize((cell, cell), Image.NEAREST), (x, y))
    d.text((x + 2, y + cell + 3), f"F{i} @4x", font=font, fill=(198, 188, 218, 255))

ly = pad + cell + label_h + 8
preview.alpha_composite(Image.new('RGBA', (pw, lighth), (206, 198, 186, 255)), (0, ly))
for i, f in enumerate(frames):
    x = pad + i * (cell + gap)
    preview.alpha_composite(f.resize((cell, cell), Image.NEAREST), (x, ly))
    d.text((x + 2, ly + cell + 2), f"F{i} on light", font=font, fill=(70, 60, 80, 255))

# actual-size rows (1x and 2x) on the battle background tone
sc_y = ly + lighth + 6
bands = Image.new('RGBA', (pw, 64 * 2 + 46), (44, 30, 74, 255))
preview2 = Image.new('RGBA', (pw, ph + 64 * 2 + 52), (27, 16, 48, 255))
preview2.alpha_composite(preview, (0, 0))
preview2.alpha_composite(bands, (0, sc_y))
d2 = ImageDraw.Draw(preview2)
d2.text((pad, sc_y + 2), "1x actual size (64x64) - readability check", font=font, fill=(198, 188, 218, 255))
xx = pad
for i, f in enumerate(frames):
    preview2.alpha_composite(f, (xx, sc_y + 18))
    xx += W + 8
d2.text((pad + 4 * (W + 8) + 10, sc_y + 2), "2x", font=font, fill=(198, 188, 218, 255))
for i, f in enumerate(frames):
    preview2.alpha_composite(f.resize((W * 2, H * 2), Image.NEAREST),
                             (pad + 4 * (W + 8) + 10 + i * (W * 2 + 8), sc_y + 18))
preview = preview2

preview.save(os.path.join(OUT, 'preview_turtle_water_juvenile.png'))
print("done")
for fn in sorted(os.listdir(OUT)):
    print(f"  {fn}  {os.path.getsize(os.path.join(OUT, fn))} bytes")
