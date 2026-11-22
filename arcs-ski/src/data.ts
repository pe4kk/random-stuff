// Chargement des données préparées par tools/build_data.py
export interface Piste { id: string; name: string; diff: string; area: boolean; pts: [number, number][] }
export interface Lift { id: string; name: string; type: string; pts: [number, number][] }
export interface Building { pts: [number, number][]; h: number; base: number }
export interface Meta {
  cx: number; cy: number; coreN: number; coreHalf: number; hOff: number; hScale: number;
  midN: number; midHalf: number; farN: number; farHalf: number; nTrees: number;
}
export interface Place { name: string; kind: string; p: [number, number] }
export interface Features {
  pistes: Piste[]; lifts: Lift[]; buildings: Building[]; meta: Meta;
  funiculars: { name: string; pts: [number, number][] }[];
  places: Place[]; pois: Place[]; roads: { kind: string; pts: [number, number][] }[];
}

export interface GameData {
  features: Features;
  core: Float32Array;       // 2048² hauteurs (m)
  mid: Float32Array;        // 1024²
  far: Float32Array;        // 1024²
  mask: ImageData;          // R piste, G forêt, B Mont-Blanc, A bâtiments
  maskImage: HTMLImageElement;
  midForest: HTMLImageElement;
  trees: Uint16Array;       // x,z (1/16 m), h (cm)
}

const BASE = './data/';

/** PNG RVB -> entiers 16 bits (R = octet fort, V = octet faible), sans conversion de couleur */
async function fetchU16(name: string, count: number | null, onProgress: (n: number) => void): Promise<Uint16Array> {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  const blob = await res.blob();
  onProgress(blob.size);
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' } as CanvasRenderingContext2DSettings)!;
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const n = count ?? bmp.width * bmp.height;
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) out[i] = (px[i * 4] << 8) | px[i * 4 + 1];
  bmp.close();
  return out;
}

function loadImage(name: string): Promise<HTMLImageElement> {
  return new Promise((ok, ko) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => ko(new Error(name));
    im.src = BASE + name;
  });
}

export async function loadAll(progress: (frac: number, label: string) => void): Promise<GameData> {
  const TOTAL = 4300000 + 1500000 * 2 + 300000 + 2900000;
  let got = 0;
  const tick = (label: string) => (n: number) => { got += n; progress(Math.min(0.98, got / TOTAL), label); };

  const features = await fetch(BASE + 'features.json').then(r => r.json() as Promise<Features>);
  const m = features.meta;
  const [cu, mu, fu, trees, maskImage, midForest] = await Promise.all([
    fetchU16('core_h.png', null, tick('Relief IGN 2 m')),
    fetchU16('mid_h.png', null, tick('Vallée')),
    fetchU16('far_h.png', null, tick('Massifs lointains')),
    fetchU16('trees.png', m.nTrees * 3, tick('Forêts')),
    loadImage('core_mask.png').then(im => { tick('Pistes')(2600000); return im; }),
    loadImage('mid_forest.png'),
  ]);
  const core = new Float32Array(cu.length);
  for (let i = 0; i < cu.length; i++) core[i] = cu[i] / m.hScale + m.hOff;
  const mid = new Float32Array(mu.length);
  for (let i = 0; i < mu.length; i++) mid[i] = mu[i] / 10 + 400;
  const far = new Float32Array(fu.length);
  for (let i = 0; i < fu.length; i++) far[i] = fu[i] / 10;

  const cv = document.createElement('canvas');
  cv.width = maskImage.width; cv.height = maskImage.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(maskImage, 0, 0);
  const mask = ctx.getImageData(0, 0, cv.width, cv.height);

  return { features, core, mid, far, mask, maskImage, midForest, trees };
}

/** Champ de hauteur régulier centré sur l'origine, lignes = Z croissant (sud). */
export class HeightField {
  constructor(public data: Float32Array, public n: number, public half: number) {}
  get cell() { return (2 * this.half) / this.n; }

  /** valeur au nœud (i colonne, j ligne), bornée */
  at(i: number, j: number): number {
    const n = this.n;
    i = i < 0 ? 0 : i >= n ? n - 1 : i;
    j = j < 0 ? 0 : j >= n ? n - 1 : j;
    return this.data[j * n + i];
  }

  /** hauteur interpolée selon la même triangulation que le maillage du terrain */
  height(x: number, z: number): number {
    const c = this.cell;
    const fx = (x + this.half) / c - 0.5;
    const fz = (z + this.half) / c - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const h00 = this.at(i, j), h10 = this.at(i + 1, j), h01 = this.at(i, j + 1), h11 = this.at(i + 1, j + 1);
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  /** normale lissée (différences centrées), écrite dans out [x,y,z] */
  normal(x: number, z: number, out: { x: number; y: number; z: number }, step = 1.5) {
    const hl = this.height(x - step, z), hr = this.height(x + step, z);
    const hd = this.height(x, z - step), hu = this.height(x, z + step);
    let nx = hl - hr, ny = 2 * step, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  inside(x: number, z: number, margin = 0) {
    return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin;
  }
}

/** lecture du masque RGBA (bilinéaire simple) */
export class MaskField {
  constructor(public img: ImageData, public half: number) {}
  sample(x: number, z: number, ch: number): number {
    const n = this.img.width;
    const fx = ((x + this.half) / (2 * this.half)) * n - 0.5;
    const fz = ((z + this.half) / (2 * this.half)) * n - 0.5;
    const i = Math.max(0, Math.min(n - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(n - 2, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
    const d = this.img.data;
    const p = (a: number, b: number) => d[(b * n + a) * 4 + ch];
    return ((p(i, j) * (1 - u) + p(i + 1, j) * u) * (1 - v) + (p(i, j + 1) * (1 - u) + p(i + 1, j + 1) * u) * v) / 255;
  }
}
