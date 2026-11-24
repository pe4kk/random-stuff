#!/usr/bin/env python3
"""Prépare les données du jeu Godot à partir de celles du jeu web (arcs-ski/public/data)
et du relief Copernicus GLO-30 pour les massifs lointains.

Sorties (data/) :
  core_h.f32   2048² hauteurs (m), 2 m/maille, 4 096 m de côté (IGN RGE ALTI)
  mid_h.f32    1024², 16 m/maille, 16 384 m (IGN)
  far_h.f32    2048², 40 m/maille, 81 920 m (Copernicus 30 m, reprojeté en Lambert 93)
  core_mask.png  R piste, G forêt, B Mont-Blanc, A bâtiments
  mid_forest.png
  groom.f32    1024² × 2 : distance signée à l'axe de piste (m), validité
  trees.f32    n × 3 : x, z, hauteur (m), repère local
  features.json  (copie)
Repère local : X = est, Z = sud, origine au centre (Lambert 93 996300, 6506100).
"""
import json, sys, os, shutil
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, '..', 'arcs-ski', 'public', 'data')
OUT = os.path.join(ROOT, 'data')
DEM_DIR = sys.argv[1] if len(sys.argv) > 1 else None

def u16(name):
    im = np.array(Image.open(os.path.join(WEB, name)).convert('RGB')).astype(np.uint32)
    return (im[:, :, 0] << 8) | im[:, :, 1]

feat = json.load(open(os.path.join(WEB, 'features.json')))
m = feat['meta']
core = (u16('core_h.png') / m['hScale'] + m['hOff']).astype(np.float32)
mid = (u16('mid_h.png') / 10 + 400).astype(np.float32)
core.tofile(os.path.join(OUT, 'core_h.f32'))
mid.tofile(os.path.join(OUT, 'mid_h.f32'))
print('core', core.shape, core.min(), core.max(), ' mid', mid.shape)

# --- massifs lointains : Copernicus 30 m reprojeté (sinon l'ancien 80 m)
N, HALF = 2048, 40960.0
if DEM_DIR:
    import rasterio
    from rasterio.warp import reproject, Resampling
    from rasterio.transform import from_origin
    dst = np.full((N, N), np.nan, np.float32)
    cell = 2 * HALF / N
    tr = from_origin(m['cx'] - HALF, m['cy'] + HALF, cell, cell)   # ligne 0 = nord (z = -HALF)
    for f in sorted(os.listdir(DEM_DIR)):
        if not f.endswith('.tif'): continue
        with rasterio.open(os.path.join(DEM_DIR, f)) as src:
            tmp = np.full((N, N), np.nan, np.float32)
            reproject(rasterio.band(src, 1), tmp, src_nodata=src.nodata, dst_transform=tr, dst_crs='EPSG:2154',
                      dst_nodata=np.nan, resampling=Resampling.cubic)
            ok = ~np.isnan(tmp); dst[ok] = tmp[ok]
    old = (u16('far_h.png') / 10).astype(np.float32)
    old = np.array(Image.fromarray(old).resize((N, N), Image.BICUBIC))
    holes = np.isnan(dst)
    dst[holes] = old[holes]
    far = dst
    print('far Copernicus, trous comblés :', int(holes.sum()))
else:
    far = np.array(Image.fromarray((u16('far_h.png') / 10).astype(np.float32)).resize((N, N), Image.BICUBIC))
far.astype(np.float32).tofile(os.path.join(OUT, 'far_h.f32'))
print('far', far.shape, far.min(), far.max())

# --- arbres
n = m['nTrees']
t = u16('trees.png').reshape(-1)[: n * 3].reshape(n, 3).astype(np.float32)
trees = np.stack([t[:, 0] / 16 - m['coreHalf'], t[:, 1] / 16 - m['coreHalf'], t[:, 2] / 100], 1).astype(np.float32)
trees.tofile(os.path.join(OUT, 'trees.f32'))
print('arbres', n)

# --- bandes de dameuse : distance signée à l'axe (lignes OSM adoucies)
G, R = 1024, 42.0
half = m['coreHalf']; cell = 2 * half / G
best = np.full((G, G), 1e9, np.float32); out = np.zeros((G, G, 2), np.float32)
xs = -half + (np.arange(G) + 0.5) * cell
for p in feat['pistes']:
    if p.get('area') or p['diff'] == 'freeride' or len(p['pts']) < 2: continue
    pts = np.array(p['pts'], float)
    for _ in range(3):
        a, b = pts[:-1], pts[1:]
        pts = np.vstack([pts[:1], np.stack([a * .75 + b * .25, a * .25 + b * .75], 1).reshape(-1, 2), pts[-1:]])
    for k in range(len(pts) - 1):
        (ax, az), (bx, bz) = pts[k], pts[k + 1]
        ex, ez = bx - ax, bz - az; L2 = ex * ex + ez * ez
        if L2 < 1e-6: continue
        L = np.sqrt(L2)
        i0 = max(0, int((min(ax, bx) - R + half) / cell)); i1 = min(G - 1, int((max(ax, bx) + R + half) / cell) + 1)
        j0 = max(0, int((min(az, bz) - R + half) / cell)); j1 = min(G - 1, int((max(az, bz) + R + half) / cell) + 1)
        X, Z = np.meshgrid(xs[i0:i1 + 1], xs[j0:j1 + 1])
        tt = np.clip(((X - ax) * ex + (Z - az) * ez) / L2, 0, 1)
        d = np.hypot(ax + ex * tt - X, az + ez * tt - Z)
        sub = best[j0:j1 + 1, i0:i1 + 1]
        upd = (d < R) & (d < sub)
        sub[upd] = d[upd]
        o = out[j0:j1 + 1, i0:i1 + 1]
        o[..., 0][upd] = (((X - ax) * ez - (Z - az) * ex) / L)[upd]
        o[..., 1][upd] = 1
out.tofile(os.path.join(OUT, 'groom.f32'))

for f in ('core_mask.png', 'mid_forest.png', 'features.json'):
    shutil.copy(os.path.join(WEB, f), os.path.join(OUT, f))
print('ok')
