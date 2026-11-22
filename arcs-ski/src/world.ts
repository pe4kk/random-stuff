import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Building, HeightField, Lift, MaskField, Piste } from './data';

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

// ----------------------------------------------------------------- remontées
export interface LiftRuntime {
  lift: Lift;
  top: THREE.Vector3; bottom: THREE.Vector3; topDir: THREE.Vector3;
  update(t: number): void;
}

function chairGeometry(type: string): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (type === 'drag_lift' || type === 'platter' || type === 't-bar') {
    const bar = new THREE.CylinderGeometry(0.02, 0.02, 2.2, 5); bar.translate(0, -1.1, 0); parts.push(bar);
    const plate = new THREE.CylinderGeometry(0.14, 0.14, 0.04, 10); plate.translate(0, -2.2, 0); parts.push(plate);
  } else if (type === 'gondola' || type === 'cable_car') {
    const arm = new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6); arm.translate(0, -0.8, 0); parts.push(arm);
    const cab = new THREE.BoxGeometry(1.8, 2.0, 1.6); cab.translate(0, -2.6, 0); parts.push(cab);
  } else {
    const hang = new THREE.CylinderGeometry(0.035, 0.035, 2.3, 6); hang.translate(0, -1.15, 0); parts.push(hang);
    const seat = new THREE.BoxGeometry(2.3, 0.1, 0.55); seat.translate(0, -2.35, 0.08); parts.push(seat);
    const back = new THREE.BoxGeometry(2.3, 0.55, 0.08); back.translate(0, -2.05, -0.2); parts.push(back);
    const bar = new THREE.BoxGeometry(2.3, 0.05, 0.05); bar.translate(0, -1.75, 0.5); parts.push(bar);
    const side = new THREE.BoxGeometry(0.05, 0.6, 0.05);
    const s1 = side.clone(); s1.translate(-1.15, -2.05, -0.2); parts.push(s1);
    const s2 = side.clone(); s2.translate(1.15, -2.05, -0.2); parts.push(s2);
  }
  return mergeGeometries(parts.map(p => p.toNonIndexed()));
}

export function makeLifts(lifts: Lift[], hf: HeightField, scene: THREE.Object3D): LiftRuntime[] {
  const out: LiftRuntime[] = [];
  const metal = new THREE.MeshStandardMaterial({ color: 0x8c9198, roughness: 0.5, metalness: 0.6 });
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.3 });
  const stationMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.6, metalness: 0.2 });
  const cableMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
  for (const lift of lifts) {
    const pts = lift.pts.filter(p => hf.inside(p[0], p[1], 5));
    if (pts.length < 2) continue;
    const drag = ['drag_lift', 'platter', 't-bar'].includes(lift.type);
    const towerH = drag ? 6 : lift.type === 'gondola' ? 14 : 10;
    const gap = drag ? 0.0 : 2.6;
    // pylônes = nœuds OSM ; on lisse en ligne quasi droite entre extrémités
    const tops: THREE.Vector3[] = pts.map(p => new THREE.Vector3(p[0], hf.height(p[0], p[1]) + towerH, p[1]));
    const g = new THREE.Group();
    const towerGeo = new THREE.CylinderGeometry(0.28, 0.4, 1, 8);
    const armGeo = new THREE.BoxGeometry(gap * 2 + 1.2, 0.3, 0.4);
    for (let i = 1; i < tops.length - 1; i++) {
      const t = tops[i];
      const ground = hf.height(t.x, t.z) - 1;
      const m = new THREE.Mesh(towerGeo, metal);
      m.scale.set(1, t.y - ground, 1); m.position.set(t.x, (t.y + ground) / 2, t.z);
      m.castShadow = true; g.add(m);
      const dir = tops[i + 1].clone().sub(tops[i - 1]); dir.y = 0; dir.normalize();
      const arm = new THREE.Mesh(armGeo, metal);
      arm.position.set(t.x, t.y + 0.2, t.z); arm.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
      arm.castShadow = true; g.add(arm);
    }
    // gares
    for (const k of [0, tops.length - 1]) {
      const t = tops[k];
      const other = tops[k === 0 ? 1 : tops.length - 2];
      const dir = other.clone().sub(t); dir.y = 0; dir.normalize();
      const ground = hf.height(t.x, t.z);
      const st = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(drag ? 3 : 7, drag ? 3 : 4, drag ? 3 : 12), stationMat);
      body.position.y = drag ? 1.5 : 2; body.castShadow = true; body.receiveShadow = true; st.add(body);
      if (!drag) {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, 13), new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.8 }));
        roof.position.y = towerH - 0.5; roof.castShadow = true; st.add(roof);
        for (const sx of [-3, 3]) for (const sz of [-5.5, 5.5]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, towerH - 0.5, 0.4), metal);
          post.position.set(sx, (towerH - 0.5) / 2, sz); st.add(post);
        }
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.3, 24), metal);
        wheel.position.y = towerH; st.add(wheel);
      }
      st.position.set(t.x, ground - 0.3, t.z);
      st.rotation.y = Math.atan2(dir.x, dir.z);
      g.add(st);
    }
    // câbles : montée (+gap) et descente (-gap)
    const cablePts: number[] = [];
    const sideOf = (i: number) => {
      const a = tops[Math.max(0, i - 1)], b = tops[Math.min(tops.length - 1, i + 1)];
      const d = b.clone().sub(a); d.y = 0; d.normalize();
      return new THREE.Vector3(d.z, 0, -d.x);
    };
    const lineUp: THREE.Vector3[] = [], lineDown: THREE.Vector3[] = [];
    for (let i = 0; i < tops.length - 1; i++) {
      const a = tops[i], b = tops[i + 1];
      const sa = sideOf(i), sb = sideOf(i + 1);
      const len = a.distanceTo(b);
      const N = Math.max(2, Math.ceil(len / 8));
      for (let k = 0; k < N; k++) {
        const f = k / N;
        const sag = Math.sin(f * Math.PI) * len * 0.012;
        const p = a.clone().lerp(b, f); p.y -= sag;
        const s = sa.clone().lerp(sb, f).normalize();
        lineUp.push(p.clone().addScaledVector(s, -gap));
        lineDown.push(p.clone().addScaledVector(s, gap));
      }
    }
    lineUp.push(tops[tops.length - 1].clone().addScaledVector(sideOf(tops.length - 1), -gap));
    lineDown.push(tops[tops.length - 1].clone().addScaledVector(sideOf(tops.length - 1), gap));
    for (const L of [lineUp, lineDown]) for (let i = 0; i < L.length - 1; i++) cablePts.push(L[i].x, L[i].y, L[i].z, L[i + 1].x, L[i + 1].y, L[i + 1].z);
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
    g.add(new THREE.LineSegments(cg, cableMat));

    // sièges qui défilent
    const loop = [...lineUp, ...lineDown.slice().reverse()];
    const cum: number[] = [0];
    for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1] + loop[i].distanceTo(loop[i - 1]));
    const total = cum[cum.length - 1];
    const spacing = drag ? 14 : lift.type === 'gondola' ? 40 : 24;
    const n = Math.floor(total / spacing);
    const chairs = new THREE.InstancedMesh(chairGeometry(lift.type), chairMat, n);
    chairs.castShadow = true;
    chairs.frustumCulled = false;
    g.add(chairs);
    const speed = drag ? 3 : lift.type === 'gondola' ? 5 : 2.6;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    let seg = 0;
    const sample = (s: number, outP: THREE.Vector3): number => {
      s = ((s % total) + total) % total;
      if (cum[seg] > s || cum[seg + 1] < s) {
        let lo = 0, hi = cum.length - 1;
        while (hi - lo > 1) { const mI = (lo + hi) >> 1; if (cum[mI] <= s) lo = mI; else hi = mI; }
        seg = lo;
      }
      const f = (s - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]);
      outP.copy(loop[seg]).lerp(loop[seg + 1], f);
      const d = loop[seg + 1].clone().sub(loop[seg]);
      return Math.atan2(d.x, d.z);
    };
    const bottom = new THREE.Vector3(pts[0][0], hf.height(pts[0][0], pts[0][1]), pts[0][1]);
    const tp = pts[pts.length - 1];
    const top = new THREE.Vector3(tp[0], hf.height(tp[0], tp[1]), tp[1]);
    const prev = pts[pts.length - 2];
    const topDir = new THREE.Vector3(tp[0] - prev[0], 0, tp[1] - prev[1]).normalize();
    scene.add(g);
    out.push({
      lift, top, bottom, topDir,
      update(t: number) {
        for (let i = 0; i < n; i++) {
          const yaw = sample(t * speed + i * spacing, p);
          q.setFromAxisAngle(up, yaw);
          m4.compose(p, q, one);
          chairs.setMatrixAt(i, m4);
        }
        chairs.instanceMatrix.needsUpdate = true;
      },
    });
  }
  return out;
}

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
