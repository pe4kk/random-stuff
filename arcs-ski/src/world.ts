import * as THREE from 'three';
import { Building, HeightField, MaskField, Piste } from './data';

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
  const palette = [new THREE.Color(0x6b4a33), new THREE.Color(0x4f3727), new THREE.Color(0xb7ab98), new THREE.Color(0x8a7a66), new THREE.Color(0x5c4030)];
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
    }
    const contour = pts.map(p => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const t of tris) {
      for (const k of [t[0], t[2], t[1]]) roofsP.push(pts[k][0], top + 0.35, pts[k][1]);
    }
    // bandeau de neige sur l'acrotère
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      roofsP.push(a[0], top - 0.1, a[1], c[0], top + 0.35, c[1], c[0], top - 0.1, c[1]);
      roofsP.push(a[0], top - 0.1, a[1], a[0], top + 0.35, a[1], c[0], top + 0.35, c[1]);
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
  float lit = step(0.82, fract(sin(dot(floor(vec2(vWall.x / 3.1, fl)), vec2(12.9898, 78.233))) * 43758.5453));
  vec3 glass = mix(vec3(0.08, 0.1, 0.13), vec3(0.95, 0.75, 0.45), lit * 0.6);
  // balcons : bande sombre sous chaque étage
  float balc = step(0.0, fl) * step(w.y, 0.12);
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
  diffuseColor.rgb *= 1.0 - 0.35 * balc;
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
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshStandardMaterial({ map: signTexture(name, list[0].diff), roughness: 0.5, side: THREE.DoubleSide }));
    panel.position.y = 2.2; panel.castShadow = true; s.add(panel);
    s.position.set(sx, y, sz);
    s.rotation.y = Math.atan2(-dir[0], -dir[1]);
    g.add(s);
  }
  return g;
}
