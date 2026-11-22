"""Prépare les données du jeu à partir des fichiers bruts IGN + OSM.

Entrées (dossier RAW, téléchargées par tools/fetch_data.sh) :
  core_mnt.bil / core_mns.bil  : MNT et MNS RGE ALTI 2 m, 4096 m de côté (2048 px)
  mid_mnt.bil                  : MNT 8 m, 16 384 m de côté (2048 px)
  far_mnt.bil / far_srtm.bil   : MNT ~80 m, 81 920 m de côté (1024 px), trous comblés par SRTM
  mid_ortho.jpg                : orthophoto de la zone moyenne (masque forêt)
  features.json                : objets OSM (pistes, remontées, bâtiments)

Sorties (public/data) : binaires compacts + features locales.

Repère local : origine au centre (CX, CY) en Lambert 93, X = est, Z = sud, Y = altitude (m).
"""
import json, sys, os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from pyproj import Transformer

RAW = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)

CX, CY = 996300, 6506100
CORE_N, CORE_HALF = 2048, 2048.0
CELL = 2 * CORE_HALF / CORE_N  # 2 m
H_OFF, H_SCALE = 800.0, 20.0   # uint16 = (h - 800) * 20  -> 5 cm

tr = Transformer.from_crs(4326, 2154, always_xy=True)


def save_u16_png(values, path, width=None):
    """Entiers 16 bits -> PNG RVB sans perte (R = octet fort, V = octet faible)."""
    v = np.asarray(values, dtype=np.uint16).ravel()
    if width is None:
        width = int(round(np.sqrt(v.size)))
    rows = -(-v.size // width)
    pad = np.zeros(rows * width, np.uint16); pad[:v.size] = v
    pad = pad.reshape(rows, width)
    rgb = np.zeros((rows, width, 3), np.uint8)
    rgb[..., 0] = pad >> 8; rgb[..., 1] = pad & 255
    Image.fromarray(rgb, 'RGB').save(path, optimize=True)


def to_local(lon, lat):
    x, y = tr.transform(lon, lat)
    return [round(x - CX, 2), round(-(y - CY), 2)]


def to_px(lx, lz):
    """local -> coordonnées pixel (col, row) dans la grille core"""
    return ((lx + CORE_HALF) / CELL - 0.5, (lz + CORE_HALF) / CELL - 0.5)


def load(name, n):
    return np.fromfile(os.path.join(RAW, name), '<f4').reshape(n, n).astype(np.float64)


mnt = load('core_mnt.bil', CORE_N)
mns = load('core_mns.bil', CORE_N)
canopy = np.clip(mns - mnt, 0, 45)

# ---------------------------------------------------------------- features OSM
feats = json.load(open(os.path.join(RAW, 'features.json')))
pistes, lifts, buildings, funiculars, places, pois, roads = [], [], [], [], [], [], []
for f in feats:
    t = f['tags']
    pts = [to_local(*c) for c in f['coords']]
    inside = any(abs(p[0]) < CORE_HALF + 200 and abs(p[1]) < CORE_HALF + 200 for p in pts)
    if f.get('node'):
        p0 = pts[0]
        if abs(p0[0]) > CORE_HALF + 2500 or abs(p0[1]) > CORE_HALF + 2500:
            continue
        if 'place' in t and t.get('name'):
            places.append({'name': t['name'], 'kind': t['place'], 'p': p0})
        elif t.get('name') or t.get('man_made') == 'snow_cannon' or t.get('tourism') == 'viewpoint':
            kind = t.get('amenity') or t.get('tourism') or t.get('man_made')
            if abs(p0[0]) < CORE_HALF and abs(p0[1]) < CORE_HALF:
                pois.append({'name': t.get('name', ''), 'kind': kind, 'p': p0})
        continue
    if not inside:
        continue
    if t.get('railway') == 'funicular':
        funiculars.append({'name': t.get('name', ''), 'pts': pts})
    elif t.get('highway') in ('primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service') and t.get('tunnel') != 'yes' and 'piste:type' not in t:
        roads.append({'kind': t['highway'], 'pts': pts})
    elif t.get('piste:type') == 'downhill':
        pistes.append({'id': f['id'], 'name': t.get('name') or t.get('piste:name') or '',
                       'diff': t.get('piste:difficulty', 'easy'),
                       'area': t.get('area') == 'yes', 'pts': pts})
    elif t.get('aerialway') in ('chair_lift', 'drag_lift', 'gondola', 'platter', 't-bar', 'cable_car', 'mixed_lift'):
        lifts.append({'id': f['id'], 'name': t.get('name', ''), 'type': t['aerialway'], 'pts': pts})
    elif 'building' in t and all(abs(p[0]) < CORE_HALF and abs(p[1]) < CORE_HALF for p in pts):
        buildings.append({'pts': pts, 'levels': t.get('building:levels')})

far_buildings = []
for f in feats:
    t = f['tags']
    if f.get('node') or 'building' not in t:
        continue
    pts = [to_local(*c) for c in f['coords']]
    if all(abs(p[0]) < CORE_HALF - 5 and abs(p[1]) < CORE_HALF - 5 for p in pts):
        continue
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        continue
    try:
        lv = float(t.get('building:levels', 0))
    except ValueError:
        lv = 0
    far_buildings.append({'pts': [[round(x, 1), round(z, 1)] for x, z in pts], 'h': round(lv * 3 if lv else 7.5, 1)})

# --------------------------------------------------------------- masque pistes
SS = 1  # rasterisation à la résolution core
mask_img = Image.new('L', (CORE_N, CORE_N), 0)
dr = ImageDraw.Draw(mask_img)
mb_img = Image.new('L', (CORE_N, CORE_N), 0)
dmb = ImageDraw.Draw(mb_img)
WIDTH = {'novice': 30, 'easy': 30, 'intermediate': 28, 'advanced': 24, 'expert': 20, 'freeride': 0}
for p in pistes:
    px = [to_px(*q) for q in p['pts']]
    if p['area']:
        if len(px) >= 3:
            dr.polygon(px, fill=255)
            if p['name'] == 'Mont-Blanc':
                dmb.polygon(px, fill=255)
    else:
        w = WIDTH.get(p['diff'], 26)
        if w == 0:
            continue
        wpx = int(w / CELL)
        dr.line(px, fill=255, width=wpx, joint='curve')
        for q in px:
            dr.ellipse([q[0] - wpx / 2, q[1] - wpx / 2, q[0] + wpx / 2, q[1] + wpx / 2], fill=255)
        if p['name'] == 'Mont-Blanc':
            dmb.line(px, fill=255, width=wpx, joint='curve')

piste = np.asarray(mask_img, np.float64) / 255.0
# les pistes réelles sont aussi visibles dans le MNS : couloirs sans arbres
piste = ndimage.gaussian_filter(piste, 3)
piste = np.clip(piste * 1.6, 0, 1)
piste[canopy > 6] *= 0.15  # pas de piste au milieu d'une vraie forêt
piste = ndimage.gaussian_filter(piste, 1.5)

# ----------------------------------------------------------- bâtiments (raster)
bimg = Image.new('L', (CORE_N, CORE_N), 0)
db = ImageDraw.Draw(bimg)
for b in buildings:
    px = [to_px(*q) for q in b['pts']]
    if len(px) >= 3:
        db.polygon(px, fill=255)
for fu in funiculars:
    px = [to_px(*q) for q in fu['pts']]
    db.line(px, fill=128, width=int(9 / CELL))
fmask = np.asarray(bimg) == 128
bimg_arr = np.asarray(bimg).copy(); bimg_arr[fmask] = 0
bmask = bimg_arr > 0
bmask_d = ndimage.binary_dilation(bmask, iterations=3)

# hauteur des bâtiments = médiane MNS-MNT dans l'emprise
def poly_height(b):
    xs = [to_px(*q) for q in b['pts']]
    c0 = int(max(0, min(p[0] for p in xs))); c1 = int(min(CORE_N - 1, max(p[0] for p in xs)) + 1)
    r0 = int(max(0, min(p[1] for p in xs))); r1 = int(min(CORE_N - 1, max(p[1] for p in xs)) + 1)
    if c1 <= c0 or r1 <= r0:
        return None
    im = Image.new('L', (c1 - c0 + 1, r1 - r0 + 1), 0)
    ImageDraw.Draw(im).polygon([(p[0] - c0, p[1] - r0) for p in xs], fill=1)
    cs = canopy[r0:r1 + 1, c0:c1 + 1]
    m = (np.asarray(im) > 0)[:cs.shape[0], :cs.shape[1]]
    sub_c = cs[m]
    sub_g = mnt[r0:r1 + 1, c0:c1 + 1][m]
    if sub_c.size == 0:
        return None
    h = float(np.percentile(sub_c, 70))
    if b.get('levels'):
        try:
            h = max(h, float(b['levels']) * 3.0)
        except ValueError:
            pass
    return max(3.0, min(h, 45.0)), float(sub_g.min())

bout = []
for b in buildings:
    r = poly_height(b)
    if r is None:
        continue
    pts = b['pts']
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        continue
    bout.append({'pts': pts, 'h': round(r[0], 1), 'base': round(r[1], 1)})

# ----------------------------------------------------------------- terrain neige
# couverture neigeuse : lisse les micro-reliefs, plus fort sur les pistes damées
snow = ndimage.gaussian_filter(mnt, 1.2)
groom = ndimage.gaussian_filter(mnt, 5.0)
h = snow * (1 - piste) + groom * piste
h += 0.6  # épaisseur de neige
h -= piste * 0.4  # piste damée en léger contrebas : bord visible
# sous les bâtiments : terrain d'origine (évite les bâtiments flottants)
wb = np.clip(ndimage.gaussian_filter(bmask_d.astype(np.float64), 2.5) * 1.5, 0, 1)
h = h * (1 - wb) + (ndimage.gaussian_filter(mnt, 1.5) + 0.3) * wb

core_u16 = np.clip((h - H_OFF) * H_SCALE, 0, 65535).astype('<u2')
save_u16_png(core_u16, os.path.join(OUT, 'core_h.png'))

# --------------------------------------------------------------------- arbres
can_s = ndimage.gaussian_filter(canopy, 0.8)
mx = ndimage.maximum_filter(can_s, size=3)
tops = (can_s == mx) & (can_s > 3.0) & (~bmask_d) & (piste < 0.35) & (~ndimage.binary_dilation(fmask, iterations=1))
rows, cols = np.nonzero(tops)
rng = np.random.default_rng(42)
tx = (cols + 0.5) * CELL - CORE_HALF + rng.uniform(-0.8, 0.8, cols.size)
tz = (rows + 0.5) * CELL - CORE_HALF + rng.uniform(-0.8, 0.8, rows.size)
th = can_s[rows, cols]
print('arbres', tx.size)
arr = np.zeros((tx.size, 3), '<u2')
arr[:, 0] = np.clip((tx + CORE_HALF) * 16, 0, 65535)
arr[:, 1] = np.clip((tz + CORE_HALF) * 16, 0, 65535)
arr[:, 2] = np.clip(th * 100, 0, 65535)
save_u16_png(arr, os.path.join(OUT, 'trees.png'), width=1024)
n_trees = int(tx.size)

# ------------------------------------------------------- texture masque (RGBA)
forest = ndimage.gaussian_filter((canopy > 2.5).astype(np.float64), 1.5)
rgba = np.zeros((CORE_N, CORE_N, 4), np.uint8)
rgba[..., 0] = np.clip(piste * 255, 0, 255)
rgba[..., 1] = np.clip(forest * 255, 0, 255)
rgba[..., 2] = np.clip(ndimage.gaussian_filter(np.asarray(mb_img, np.float64), 2) , 0, 255)
rgba[..., 3] = np.clip(ndimage.gaussian_filter(ndimage.binary_dilation(bmask, iterations=1).astype(np.float64), 0.8) * 255, 0, 255).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, 'core_mask.png'), optimize=True)

# ------------------------------------------------------------- terrain moyen / lointain
mid = load('mid_mnt.bil', 2048)
mid = ndimage.zoom(ndimage.gaussian_filter(mid, 1.0), 0.5, order=1)  # 1024 px -> 16 m
save_u16_png(np.clip((mid - H_OFF + 400) * 10, 0, 65535), os.path.join(OUT, 'mid_h.png'))  # (h-400)*10

far = load('far_mnt.bil', 1024)
srtm = load('far_srtm.bil', 1024)
far = np.where(far < -100, srtm, far)
far = ndimage.gaussian_filter(far, 0.7)
save_u16_png(np.clip(far * 10, 0, 65535), os.path.join(OUT, 'far_h.png'))  # h*10

# masque forêt moyen (orthophoto d'été : vert sombre = forêt)
if os.path.exists(os.path.join(RAW, 'mid_ortho.jpg')):
    o = np.asarray(Image.open(os.path.join(RAW, 'mid_ortho.jpg')).convert('RGB').resize((1024, 1024), Image.BILINEAR), np.float64)
    r, g, bch = o[..., 0], o[..., 1], o[..., 2]
    lum = (r + g + bch) / 3
    fm = ((lum < 75) & (g >= r * 0.95)).astype(np.float64)
    fm = ndimage.gaussian_filter(fm, 1.0)
    Image.fromarray(np.clip(fm * 255, 0, 255).astype(np.uint8), 'L').save(os.path.join(OUT, 'mid_forest.png'), optimize=True)

# ------------------------------------------------------------------- features
json.dump({'pistes': pistes, 'lifts': lifts, 'buildings': bout, 'funiculars': funiculars, 'places': places, 'pois': pois, 'roads': roads, 'farBuildings': far_buildings,
           'meta': {'cx': CX, 'cy': CY, 'coreN': CORE_N, 'coreHalf': CORE_HALF, 'hOff': H_OFF, 'hScale': H_SCALE,
                    'midN': 1024, 'midHalf': 8192, 'farN': 1024, 'farHalf': 40960, 'nTrees': n_trees}},
          open(os.path.join(OUT, 'features.json'), 'w'), separators=(',', ':'))
print('pistes', len(pistes), 'remontées', len(lifts), 'bâtiments', len(bout))
