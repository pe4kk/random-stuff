#!/usr/bin/env python3
"""Plan des pistes (2048², 2 m/px) : relief ombré, courbes de niveau, forêt (arbres réels), pistes, remontées, lieux."""
import json, numpy as np, os
from PIL import Image, ImageDraw, ImageFont
D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
f = json.load(open(os.path.join(D, 'features.json')))
H = np.fromfile(os.path.join(D, 'core_h.f32'), np.float32).reshape(2048, 2048)
S, half = 2048, 2048.0
dx = np.zeros_like(H); dz = np.zeros_like(H)
dx[:, 1:-1] = (H[:, :-2] - H[:, 2:]) / 4; dz[1:-1, :] = (H[:-2, :] - H[2:, :]) / 4
l = np.sqrt(dx * dx + 1 + dz * dz)
sh = np.clip(0.35 + ((dx * -0.6 + 0.75 + dz * -0.55) / l) * 0.75, 0, 1)
img = np.stack([160 + 95 * sh, 175 + 80 * sh, 200 + 55 * sh], -1)
# forêt : densité des arbres réels
tr = np.fromfile(os.path.join(D, 'trees.f32'), np.float32).reshape(-1, 3)
dens = np.zeros((S, S))
for x, z, h in tr:
    px, pz = (x + half) / 2, (z + half) / 2; rad = max(1.2, (1.2 + h * 0.22) / 2)
    i0, i1 = int(px - rad), int(px + rad) + 1; j0, j1 = int(pz - rad), int(pz + rad) + 1
    if i0 < 0 or j0 < 0 or i1 >= S or j1 >= S: continue
    yy, xx = np.mgrid[j0:j1, i0:i1]
    q = ((xx + .5 - px) ** 2 + (yy + .5 - pz) ** 2) / rad ** 2
    dens[j0:j1, i0:i1] += np.clip(1 - q, 0, 1) * 0.9
t = np.clip(dens * 1.6, 0, 1)[..., None]
img = img * (1 - t) + np.stack([30 + 40 * sh, 62 + 50 * sh, 45 + 35 * sh], -1) * t
# courbes de niveau tous les 50 m
c = np.floor(H / 50)
edge = (c != np.roll(c, 1, 0)) | (c != np.roll(c, 1, 1))
major = (np.floor(H / 200) != np.roll(np.floor(H / 200), 1, 0)) | (np.floor(H / 200) != np.roll(np.floor(H / 200), 1, 1))
img[edge] *= 0.86; img[major] *= 0.84
im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
d = ImageDraw.Draw(im)
P = lambda p: ((p[0] + half) / 2, (p[1] + half) / 2)
COL = {'novice': (34, 163, 74), 'easy': (31, 111, 224), 'intermediate': (216, 38, 44), 'advanced': (17, 17, 17), 'expert': (17, 17, 17), 'freeride': (240, 138, 28)}
for b in f['buildings']:
    if len(b['pts']) >= 3: d.polygon([P(p) for p in b['pts']], fill=(150, 110, 90))
for p in f['pistes']:
    if p.get('area') or len(p['pts']) < 2: continue
    c = COL.get(p['diff'], (120, 120, 120))
    d.line([P(q) for q in p['pts']], fill=(255, 255, 255), width=9, joint='curve')
    d.line([P(q) for q in p['pts']], fill=c, width=5, joint='curve')
for li in f['lifts']:
    d.line([P(q) for q in li['pts']], fill=(20, 20, 20), width=3)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except Exception: font = ImageFont.load_default()
seen = set()
for p in sorted(f['pistes'], key=lambda p: -len(p['pts'])):
    if p.get('area') or not p['name'] or p['name'] in seen or len(p['pts']) < 4: continue
    seen.add(p['name'])
    x, y = P(p['pts'][len(p['pts']) // 2])
    d.text((x + 8, y - 12), p['name'], font=font, fill=COL.get(p['diff'], (60, 60, 60)), stroke_width=3, stroke_fill=(255, 255, 255))
for pl in f.get('places', []):
    x, y = P(pl['p'])
    if 0 < x < S and 0 < y < S: d.text((x, y), pl['name'], font=font, fill=(30, 30, 30), stroke_width=3, stroke_fill=(255, 255, 255))
im.save(os.path.join(D, 'map.png'))
print('ok')
