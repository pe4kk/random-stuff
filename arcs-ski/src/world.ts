import * as THREE from 'three';
import { Building, HeightField, MaskField, Piste } from './data';
import { mergeStatic } from './merge';

export const DIFF_COLOR: Record<string, number> = {
  novice: 0x22a34a, easy: 0x1f6fe0, intermediate: 0xd8262c, advanced: 0x111111, expert: 0x111111, freeride: 0xf08a1c,
};
export const DIFF_LABEL: Record<string, string> = {
  novice: 'verte', easy: 'bleue', intermediate: 'rouge', advanced: 'noire', expert: 'noire', freeride: 'itinéraire',
};
const HALF_W: Record<string, number> = { novice: 15, easy: 15, intermediate: 14, advanced: 12, expert: 10 };

// ----------------------------------------------------------------- bâtiments
export function makeBuildings(list: Building[], hf: HeightField): THREE.Group {
  const wallsP: number[] = [], wallsUV: number[] = [], wallsC: number[] = [];
  const roofsP: number[] = [];
  const balP: number[] = [], balC: number[] = [];
  const box = (cx: number, cy: number, cz: number, ux: number, uz: number, len: number, dep: number, hgt: number, col: THREE.Color) => {
    // boîte orientée selon le mur (u = direction du mur, n = normale extérieure)
    const nx = uz, nz = -ux;
    const corners: number[][] = [];
    for (const [a, b, c] of [[-1, 0, 0], [1, 0, 0], [1, 1, 0], [-1, 1, 0], [-1, 0, 1], [1, 0, 1], [1, 1, 1], [-1, 1, 1]])
      corners.push([cx + ux * a * len / 2 + nx * b * dep, cy + c * hgt, cz + uz * a * len / 2 + nz * b * dep]);
    const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [1, 5, 6, 2], [0, 3, 7, 4]];
    for (const f of faces) {
      for (const k of [f[0], f[1], f[2], f[0], f[2], f[3]]) { balP.push(...corners[k]); balC.push(col.r, col.g, col.b); }
    }
  };
  const slabCol = new THREE.Color(0xe9edf3), railCol = new THREE.Color(0x4a3426);
  const palette = [new THREE.Color(0x9a6e4c), new THREE.Color(0x7d5a3e), new THREE.Color(0xcfc4b0), new THREE.Color(0xa8977f), new THREE.Color(0x8a6446)];
  const fascia = new THREE.Color(0x5a3e2a);
  list.forEach((b, bi) => {
    let pts = b.pts.slice();
    // orientation anti-horaire vue du dessus (x, z) -> normales vers l'extérieur
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; area += a[0] * c[1] - c[0] * a[1]; }
    if (area < 0) pts = pts.reverse();
    let minG = Infinity;
    for (const p of pts) minG = Math.min(minG, hf.height(p[0], p[1]));
    const base = Math.min(minG, b.base) - 1.5;
    const top = Math.max(minG + 3, b.base + b.h);
    const col = palette[bi % palette.length];
    // direction de l'aval au centre du bâtiment
    let cxm = 0, czm = 0; for (const p of pts) { cxm += p[0]; czm += p[1]; } cxm /= pts.length; czm /= pts.length;
    const gx = hf.height(cxm - 10, czm) - hf.height(cxm + 10, czm), gz = hf.height(cxm, czm - 10) - hf.height(cxm, czm + 10);
    const gl = Math.hypot(gx, gz) || 1;
    const downX = gx / gl, downZ = gz / gl;
    let u = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const A = [a[0], base, a[1]], B = [c[0], base, c[1]], Ct = [c[0], top, c[1]], D = [a[0], top, a[1]];
      wallsP.push(...A, ...D, ...B, ...B, ...D, ...Ct);
      const h0 = 0, h1 = top - base;
      wallsUV.push(u, h0, u, h1, u + len, h0, u + len, h0, u, h1, u + len, h1);
      for (let k = 0; k < 6; k++) wallsC.push(col.r, col.g, col.b);
      u += len;
      // balcons en volume sur les grandes façades
      const ux0 = (c[0] - a[0]) / len, uz0 = (c[1] - a[1]) / len;
      const fx = uz0, fz = -ux0;                       // normale extérieure de la façade
      const facing = fz > 0.25 || (fx * downX + fz * downZ) > 0.35;   // sud ou aval
      if (len > 6 && top - minG > 7 && facing) {
        const ux = ux0, uz = uz0;
        const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
        // même origine que les rangées de fenêtres (base + 1 m, étages de 2,9 m)
        const k0 = Math.ceil((minG + 1.2 - (base + 1.1)) / 2.9);
        for (let y = base + 1.1 + Math.max(1, k0) * 2.9; y < top - 1.5; y += 2.9) {
          box(mx, y, mz, ux, uz, len - 1.2, 1.3, 0.16, slabCol);
          const nx = uz, nz = -ux;
          box(mx + nx * 1.25, y + 0.16, mz + nz * 1.25, ux, uz, len - 1.2, 0.06, 0.95, railCol);
        }
      }
    }
    // toit monopente façon Arc 1600 : point haut côté amont, grand débord, neige épaisse
    let dmin = Infinity, dmax = -Infinity;
    for (const p of pts) { const d = -(p[0] * downX + p[1] * downZ); dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
    const rise = Math.min(0.24, 6 / Math.max(1, dmax - dmin));
    const roofY = (x: number, z: number) => top + 0.35 + rise * (-(x * downX + z * downZ) - dmin);
    const over = pts.map(p => { const dx = p[0] - cxm, dz = p[1] - czm, l = Math.hypot(dx, dz) || 1; return [p[0] + dx / l * 1.1, p[1] + dz / l * 1.1] as [number, number]; });
    const contour = over.map(p => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const t of tris) {
      for (const k of [t[0], t[2], t[1]]) roofsP.push(over[k][0], roofY(over[k][0], over[k][1]), over[k][1]);
    }
    // tranche de neige au bord du débord, et pignons en bois sous la pente
    for (let i = 0; i < pts.length; i++) {
      const a = over[i], c = over[(i + 1) % pts.length];
      const ya = roofY(a[0], a[1]), yc = roofY(c[0], c[1]);
      roofsP.push(a[0], ya - 0.45, a[1], c[0], yc, c[1], c[0], yc - 0.45, c[1]);
      roofsP.push(a[0], ya - 0.45, a[1], a[0], ya, a[1], c[0], yc, c[1]);
      const wa = pts[i], wc = pts[(i + 1) % pts.length];
      const ra = roofY(wa[0], wa[1]) - 0.3, rc = roofY(wc[0], wc[1]) - 0.3;
      for (const q of [[wa[0], top, wa[1]], [wc[0], top, wc[1]], [wc[0], rc, wc[1]], [wa[0], top, wa[1]], [wc[0], rc, wc[1]], [wa[0], ra, wa[1]]]) { balP.push(...q); balC.push(fascia.r, fascia.g, fascia.b); }
    }
  });
  const gw = new THREE.BufferGeometry();
  gw.setAttribute('position', new THREE.Float32BufferAttribute(wallsP, 3));
  gw.setAttribute('uv', new THREE.Float32BufferAttribute(wallsUV, 2));
  gw.setAttribute('color', new THREE.Float32BufferAttribute(wallsC, 3));
  gw.computeVertexNormals();
  const wm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  wm.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWall;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvWall = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWall;\nfloat gWin;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 w = vec2(fract(vWall.x / 3.1), fract((vWall.y - 1.0) / 2.9));
  float fl = floor((vWall.y - 1.0) / 2.9);
  float win = step(0.22, w.x) * step(w.x, 0.78) * step(0.28, w.y) * step(w.y, 0.86) * step(0.0, fl);
  gWin = win;
  // bardage bois vertical, cadres clairs, soubassement en pierre
  float slat = 0.92 + 0.08 * step(0.5, fract(vWall.x / 0.16));
  vec3 wall = diffuseColor.rgb * slat;
  float frame = step(0.17, w.x) * step(w.x, 0.83) * step(0.22, w.y) * step(w.y, 0.92) * step(0.0, fl) * (1.0 - win);
  float mull = (1.0 - step(0.035, abs(w.x - 0.5))) * win;
  vec3 glass = mix(vec3(0.16, 0.2, 0.26), vec3(0.55, 0.65, 0.78), smoothstep(0.25, 0.9, w.y) * 0.8);   // reflet du ciel
  vec3 col = mix(wall, vec3(0.86, 0.84, 0.8), frame);
  col = mix(col, glass, win * (1.0 - mull));
  col = mix(col, vec3(0.86, 0.84, 0.8), mull);
  float stone = 1.0 - step(2.6, vWall.y);
  col = mix(col, vec3(0.5, 0.48, 0.45) * (0.85 + 0.15 * fract(sin(floor(vWall.x / 0.6) * 12.3 + floor(vWall.y / 0.4) * 7.1) * 431.7)), stone);
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.25, gWin);');
  };
  const walls = new THREE.Mesh(gw, wm);
  walls.castShadow = true; walls.receiveShadow = true;
  const gr = new THREE.BufferGeometry();
  gr.setAttribute('position', new THREE.Float32BufferAttribute(roofsP, 3));
  gr.computeVertexNormals();
  const roofs = new THREE.Mesh(gr, new THREE.MeshStandardMaterial({ color: 0xf4f6fb, roughness: 0.85 }));
  roofs.castShadow = true; roofs.receiveShadow = true;
  const g = new THREE.Group();
  g.add(walls, roofs);
  if (balP.length) {
    const gb = new THREE.BufferGeometry();
    gb.setAttribute('position', new THREE.Float32BufferAttribute(balP, 3));
    gb.setAttribute('color', new THREE.Float32BufferAttribute(balC, 3));
    gb.computeVertexNormals();
    const bm = new THREE.Mesh(gb, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
    bm.castShadow = true; bm.receiveShadow = true;
    g.add(bm);
  }
  return g;
}

export { makeLifts } from './lifts';
export type { LiftRuntime } from './lifts';

// ------------------------------------------------------------- jalons de piste
export function makePistePoles(pistes: Piste[], hf: HeightField, mask: MaskField): THREE.Group {
  const g = new THREE.Group();
  const P: { x: number; z: number; col: number; band: boolean }[] = [];
  for (const p of pistes) {
    if (p.area || !(p.diff in HALF_W)) continue;
    const hw = HALF_W[p.diff];
    const col = DIFF_COLOR[p.diff];
    let acc = 0;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i], b = p.pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      for (let s = (40 - acc) % 40; s < len; s += 40) {
        const x = a[0] + dx * s, z = a[1] + dz * s;
        for (const side of [-1, 1]) {
          const px = x + dz * hw * side * -1, pz = z + dx * hw * side;
          if (!hf.inside(px, pz, 5)) continue;
          if (mask.sample(px, pz, 0) > 0.8 || mask.sample(px, pz, 3) > 0.2) continue;
          P.push({ x: px, z: pz, col, band: side === 1 });
        }
      }
      acc = (acc + len) % 40;
    }
  }
  const pole = new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6); pole.translate(0, 0.85, 0);
  const band = new THREE.CylinderGeometry(0.034, 0.034, 0.3, 6); band.translate(0, 1.55, 0);
  const pm = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ roughness: 0.5 }), P.length);
  const bm = new THREE.InstancedMesh(band, new THREE.MeshStandardMaterial({ color: 0xff7a00, emissive: 0x401800, roughness: 0.4 }), P.length);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  let nb = 0;
  P.forEach((q, i) => {
    m4.makeTranslation(q.x, hf.height(q.x, q.z) - 0.2, q.z);
    pm.setMatrixAt(i, m4); pm.setColorAt(i, c.setHex(q.col));
    if (q.band) bm.setMatrixAt(nb++, m4);
  });
  bm.count = nb;
  pm.castShadow = true;
  g.add(pm, bm);
  return g;
}

// ------------------------------------------------------------ panneaux de piste
function signTexture(name: string, diff: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#' + DIFF_COLOR[diff].toString(16).padStart(6, '0');
  x.fillRect(0, 0, 512, 256);
  x.strokeStyle = '#fff'; x.lineWidth = 14; x.strokeRect(10, 10, 492, 236);
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  let size = 92;
  x.font = `800 ${size}px system-ui, sans-serif`;
  while (x.measureText(name.toUpperCase()).width > 450 && size > 30) { size -= 4; x.font = `800 ${size}px system-ui, sans-serif`; }
  x.fillText(name.toUpperCase(), 256, 132);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function makeSigns(pistes: Piste[], hf: HeightField): THREE.Group {
  const g = new THREE.Group();
  const seen = new Set<string>();
  // premier tronçon (point le plus haut) de chaque piste nommée
  const byName = new Map<string, Piste[]>();
  for (const p of pistes) { if (!p.name || p.area || !(p.diff in DIFF_COLOR)) continue; if (!byName.has(p.name)) byName.set(p.name, []); byName.get(p.name)!.push(p); }
  const post = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6); post.translate(0, 1.2, 0);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.5, roughness: 0.5 });
  for (const [name, list] of byName) {
    if (seen.has(name)) continue; seen.add(name);
    let best: [number, number] | null = null, bestH = -Infinity, dir: [number, number] = [1, 0];
    for (const p of list) {
      const a = p.pts[0];
      if (!hf.inside(a[0], a[1], 10)) continue;
      const h = hf.height(a[0], a[1]);
      if (h > bestH) { bestH = h; best = a; const b = p.pts[Math.min(1, p.pts.length - 1)]; dir = [b[0] - a[0], b[1] - a[1]]; }
    }
    if (!best) continue;
    const l = Math.hypot(dir[0], dir[1]) || 1;
    const sx = best[0] - dir[1] / l * 12, sz = best[1] + dir[0] / l * 12;
    const y = hf.height(sx, sz) - 0.2;
    const s = new THREE.Group();
    const pm = new THREE.Mesh(post, postMat); pm.castShadow = true; s.add(pm);
    const pmat = new THREE.MeshStandardMaterial({ map: signTexture(name, list[0].diff), roughness: 0.5 });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), pmat);
    panel.position.set(0, 2.2, 0.02); panel.castShadow = true; s.add(panel);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), pmat);
    back.position.set(0, 2.2, -0.02); back.rotation.y = Math.PI; s.add(back);
    s.position.set(sx, y, sz);
    s.rotation.y = Math.atan2(-dir[0], -dir[1]);
    g.add(s);
  }
  mergeStatic(g);
  return g;
}

// ------------------------------------------------------- bâtiments de la vallée (Bourg-Saint-Maurice…)
export function makeFarBuildings(list: { pts: [number, number][]; h: number }[], height: (x: number, z: number) => number): THREE.Mesh {
  const P: number[] = [], C: number[] = [];
  const walls = [new THREE.Color(0xc9bfae), new THREE.Color(0xb5a892), new THREE.Color(0xd8d0c2), new THREE.Color(0x8a7058)];
  const roofSnow = new THREE.Color(0xe8ecf2), roofSlate = new THREE.Color(0x4a4d52);
  list.forEach((b, i) => {
    let pts = b.pts;
    let area = 0;
    for (let k = 0; k < pts.length; k++) { const a = pts[k], c = pts[(k + 1) % pts.length]; area += a[0] * c[1] - c[0] * a[1]; }
    if (Math.abs(area) < 20) return;
    if (area < 0) pts = pts.slice().reverse();
    let g = Infinity; for (const p of pts) g = Math.min(g, height(p[0], p[1]));
    const base = g - 2, top = g + b.h;
    const wc = walls[i % walls.length];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], c = pts[(k + 1) % pts.length];
      P.push(a[0], base, a[1], a[0], top, a[1], c[0], base, c[1], c[0], base, c[1], a[0], top, a[1], c[0], top, c[1]);
      for (let j = 0; j < 6; j++) C.push(wc.r, wc.g, wc.b);
    }
    const rc = top > 1150 || (i % 3 === 0) ? roofSnow : roofSlate;
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), []);
    for (const t of tris) for (const k of [t[0], t[2], t[1]]) { P.push(pts[k][0], top + 0.3, pts[k][1]); C.push(rc.r, rc.g, rc.b); }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  m.receiveShadow = false; m.castShadow = false;
  return m;
}
