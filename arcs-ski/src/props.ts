import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HeightField, MaskField, Piste } from './data';
import { Forest } from './trees';
import { mergeStatic } from './merge';

function colored(g: THREE.BufferGeometry, c: number) {
  const ng = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c);
  const n = ng.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (ng.attributes.uv) ng.deleteAttribute('uv');
  return ng;
}

// ----------------------------------------------------------- enneigeurs
export function makeSnowGuns(pistes: Piste[], hf: HeightField, mask: MaskField, forest: Forest): THREE.Group {
  const g = new THREE.Group();
  // perche (lance) inclinée vers la piste
  const lanceParts: THREE.BufferGeometry[] = [];
  const base = new THREE.BoxGeometry(0.5, 0.9, 0.5); base.translate(0, 0.45, 0); lanceParts.push(colored(base, 0x6b7076));
  const pole = new THREE.CylinderGeometry(0.07, 0.09, 7.5, 8); pole.translate(0, 3.75, 0); pole.rotateX(0.42); lanceParts.push(colored(pole, 0xb8bec6));
  const head = new THREE.CylinderGeometry(0.16, 0.12, 0.6, 8); head.translate(0, 7.5, 0); head.rotateX(0.42); lanceParts.push(colored(head, 0x2f7d4a));
  const lance = mergeGeometries(lanceParts);
  // canon ventilateur sur pied
  const fanParts: THREE.BufferGeometry[] = [];
  const stand = new THREE.CylinderGeometry(0.12, 0.15, 2.6, 8); stand.translate(0, 1.3, 0); fanParts.push(colored(stand, 0x6b7076));
  const drum = new THREE.CylinderGeometry(0.75, 0.6, 1.5, 16); drum.rotateX(Math.PI / 2 - 0.3); drum.translate(0, 3.0, 0.2); fanParts.push(colored(drum, 0xf2b705));
  const ring = new THREE.TorusGeometry(0.62, 0.08, 6, 18); ring.rotateX(-0.3); ring.translate(0, 3.25, 0.95); fanParts.push(colored(ring, 0x2b2f36));
  const fan = mergeGeometries(fanParts);

  const L: THREE.Matrix4[] = [], F: THREE.Matrix4[] = [];
  let s = 31;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (const p of pistes) {
    if (p.area || !p.name || p.diff === 'freeride') continue;
    const main = p.name === 'Mont-Blanc';
    if (!main && rnd() > 0.45) continue;
    const step = main ? 55 : 80;
    let acc = rnd() * step;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i], b = p.pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      while (acc < len) {
        const x0 = a[0] + dx * acc, z0 = a[1] + dz * acc;
        const side = 1;
        const px = x0 - dz * 17 * side, pz = z0 + dx * 17 * side;
        acc += step;
        if (!hf.inside(px, pz, 10) || mask.sample(px, pz, 0) > 0.7 || mask.sample(px, pz, 3) > 0.1) continue;
        if (forest.nearest(px, pz, 2).d < 1.5) continue;
        const m = new THREE.Matrix4();
        // orientation : vers le centre de la piste
        const yaw = Math.atan2(x0 - px, z0 - pz);
        m.compose(new THREE.Vector3(px, hf.height(px, pz) - 0.3, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
        (rnd() < 0.7 ? L : F).push(m);
        forest.addObstacle(px, pz, 0.5, 3);
      }
      acc -= len;
    }
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 });
  for (const [geo, list] of [[lance, L], [fan, F]] as const) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true; im.receiveShadow = true;
    g.add(im);
  }
  return g;
}

// ----------------------------------------------------------- rochers
function rockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 2).toNonIndexed();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const disp = new Map<string, number>();
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < pos.count; i++) {
    const k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (!disp.has(k)) disp.set(k, 0.75 + rnd() * 0.45);
    const d = disp.get(k)!;
    pos.setXYZ(i, pos.getX(i) * d * 1.2, pos.getY(i) * d * 0.7, pos.getZ(i) * d);
  }
  g.computeVertexNormals();
  // neige sur le dessus
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let f = 0; f < pos.count; f += 3) {
    const ny = (nor.getY(f) + nor.getY(f + 1) + nor.getY(f + 2)) / 3;
    const snowy = ny > 0.55;
    const v = 0.3 + rnd() * 0.12;
    for (let k = 0; k < 3; k++) {
      const i = f + k;
      if (snowy) { col[i * 3] = 0.93; col[i * 3 + 1] = 0.95; col[i * 3 + 2] = 1.0; }
      else { col[i * 3] = v; col[i * 3 + 1] = v * 0.97; col[i * 3 + 2] = v * 0.93; }
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function makeRocks(hf: HeightField, mask: MaskField, forest: Forest): THREE.Group {
  const g = new THREE.Group();
  const geos = [rockGeometry(3), rockGeometry(17), rockGeometry(101)];
  const lists: THREE.Matrix4[][] = [[], [], []];
  let s = 77;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const n = { x: 0, y: 1, z: 0 };
  const step = 7;
  for (let z = -hf.half + 20; z < hf.half - 20; z += step) {
    for (let x = -hf.half + 20; x < hf.half - 20; x += step) {
      const px = x + (rnd() - 0.5) * step, pz = z + (rnd() - 0.5) * step;
      hf.normal(px, pz, n, 3);
      const slope = 1 - n.y;
      if (slope < 0.22) continue;
      const pr = Math.min(1, (slope - 0.22) * 2.5) * 0.4;
      if (rnd() > pr) continue;
      if (mask.sample(px, pz, 0) > 0.15 || mask.sample(px, pz, 3) > 0.05 || mask.sample(px, pz, 1) > 0.6) continue;
      const size = 0.5 + Math.pow(rnd(), 2.2) * 3.2 * (0.6 + slope);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, n.y, n.z))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28));
      m.compose(new THREE.Vector3(px, hf.height(px, pz) - size * 0.5, pz), q, new THREE.Vector3(size, size * (0.6 + rnd() * 0.5), size));
      lists[Math.floor(rnd() * 3)].push(m);
      if (size > 1.0) forest.addObstacle(px, pz, size * 0.9, size * 0.8);
    }
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  // découpage en tronçons de 256 m pour l'élimination hors champ et la distance d'affichage
  const CH = 256, nc = Math.ceil(2 * hf.half / CH);
  const chunks: { mesh: THREE.InstancedMesh; x: number; z: number }[] = [];
  const pos = new THREE.Vector3();
  lists.forEach((list, gi) => {
    const buckets = new Map<number, THREE.Matrix4[]>();
    for (const m of list) {
      pos.setFromMatrixPosition(m);
      const k = Math.floor((pos.z + hf.half) / CH) * nc + Math.floor((pos.x + hf.half) / CH);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(m);
    }
    for (const [k, ms] of buckets) {
      const im = new THREE.InstancedMesh(geos[gi], mat, ms.length);
      ms.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      g.add(im);
      chunks.push({ mesh: im, x: -hf.half + ((k % nc) + 0.5) * CH, z: -hf.half + (Math.floor(k / nc) + 0.5) * CH });
    }
  });
  (g as any).updateRocks = (cam: THREE.Vector3, far: number) => {
    for (const c of chunks) {
      const d = Math.hypot(c.x - cam.x, c.z - cam.z) - CH * 0.7;
      c.mesh.visible = d < far;
      c.mesh.castShadow = d < 200;
    }
  };
  return g;
}

// ----------------------------------------------------------- funiculaire
export interface Funicular { group: THREE.Group; update(t: number): void }

export function makeFunicular(lines: { name: string; pts: [number, number][] }[], hf: HeightField): Funicular | null {
  const line = lines.slice().sort((a, b) => b.pts.length - a.pts.length)[0];
  if (!line) return null;
  const g = new THREE.Group();
  // rééchantillonnage tous les 3 m
  const P: THREE.Vector3[] = [];
  for (let i = 0; i < line.pts.length - 1; i++) {
    const a = line.pts[i], b = line.pts[i + 1];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(d / 3));
    for (let k = 0; k < n; k++) {
      const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n;
      P.push(new THREE.Vector3(x, hf.inside(x, z, 2) ? hf.height(x, z) : NaN, z));
    }
  }
  const inside = P.filter(p => !isNaN(p.y));
  if (inside.length < 3) return null;
  // voie : ballast + 2 rails, uniquement dans la zone détaillée
  const ballast: number[] = [], rails: number[] = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    if (isNaN(a.y) || isNaN(b.y)) continue;
    const d = b.clone().sub(a); d.y = 0; d.normalize();
    const sx = d.z, sz = -d.x;
    const w = 2.2;
    ballast.push(a.x - sx * w, a.y + 0.1, a.z - sz * w, b.x - sx * w, b.y + 0.1, b.z - sz * w, a.x + sx * w, a.y + 0.1, a.z + sz * w);
    ballast.push(a.x + sx * w, a.y + 0.1, a.z + sz * w, b.x - sx * w, b.y + 0.1, b.z - sz * w, b.x + sx * w, b.y + 0.1, b.z + sz * w);
    for (const o of [-0.75, 0.75]) rails.push(a.x + sx * o, a.y + 0.3, a.z + sz * o, b.x + sx * o, b.y + 0.3, b.z + sz * o);
  }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(ballast, 3)); bg.computeVertexNormals();
  const bm = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
  bm.receiveShadow = true; g.add(bm);
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rails, 3));
  g.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x2a2a2a })));
  // rames : caisse rouge et blanche, en escalier
  const car = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.2, 26), new THREE.MeshStandardMaterial({ color: 0xc8232c, roughness: 0.4, metalness: 0.2 }));
  body.position.y = 2.1; body.castShadow = true; car.add(body);
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.85, 1.0, 25.6), new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.1, metalness: 0.7 }));
  band.position.y = 2.6; car.add(band);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.25, 25), new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.8 }));
  roof.position.y = 3.8; car.add(roof);
  car.userData.dynamic = true;
  const cars = [car, car.clone()];
  cars.forEach(c => g.add(c));
  // gare d'arrivée (extrémité haute dans la zone détaillée)
  {
    const ins = P.map((q, i) => ({ q, i })).filter(o => !isNaN(o.q.y));
    const hiEnd = ins.reduce((a, b) => (b.q.y > a.q.y ? b : a));
    const nb = P[Math.max(0, Math.min(P.length - 1, hiEnd.i + (hiEnd.i > 0 && !isNaN(P[hiEnd.i - 1].y) ? -6 : 6)))];
    const st = new THREE.Group();
    const wallM = new THREE.MeshStandardMaterial({ color: 0x8d6a4f, roughness: 0.8 });
    const body2 = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 34), wallM); body2.position.y = 2.5; body2.castShadow = true; body2.receiveShadow = true; st.add(body2);
    const glassM = new THREE.MeshStandardMaterial({ color: 0x1d2a38, roughness: 0.15, metalness: 0.6 });
    const band2 = new THREE.Mesh(new THREE.BoxGeometry(14.1, 2.2, 30), glassM); band2.position.y = 4.5; st.add(band2);
    const roof2 = new THREE.Mesh(new THREE.BoxGeometry(16, 0.8, 36), new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.8 })); roof2.position.y = 7.4; roof2.castShadow = true; st.add(roof2);
    const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
    const x = c.getContext('2d')!; x.fillStyle = '#7a1f2b'; x.fillRect(0, 0, 1024, 160); x.fillStyle = '#fff'; x.font = '800 84px system-ui, sans-serif'; x.textAlign = 'center'; x.fillText("FUNICULAIRE · ARC 1600", 512, 112);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    for (const side of [-1, 1]) {
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.9), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.6 }));
      sg.position.set(side * 7.06, 8.6, 0); sg.rotation.y = side * Math.PI / 2; st.add(sg);
    }
    st.position.copy(hiEnd.q); st.position.y -= 1.5;
    st.lookAt(nb.x, st.position.y, nb.z);
    g.add(st);
  }
  const cum: number[] = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
  const total = cum[cum.length - 1];
  const at = (s: number, out: THREE.Vector3) => {
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const f = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
    out.copy(P[lo]).lerp(P[hi], f);
    return { a: P[lo], b: P[hi] };
  };
  mergeStatic(g);
  const p = new THREE.Vector3(), p2 = new THREE.Vector3();
  return {
    group: g,
    update(t: number) {
      // aller-retour en 7 minutes avec arrêts en gare
      const period = 420;
      const ph = (t % period) / period;
      const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const u = Math.min(1, Math.max(0, (tri - 0.08) / 0.84));
      const e = u * u * (3 - 2 * u);
      [e, 1 - e].forEach((f, i) => {
        const s = 15 + f * (total - 30);
        at(s, p); at(Math.min(total, s + 5), p2);
        const c = cars[i];
        if (isNaN(p.y) || isNaN(p2.y) || !hf.inside(p.x, p.z, 10)) { c.visible = false; return; }
        c.visible = true;
        c.position.copy(p);
        c.lookAt(p2.x, p2.y, p2.z);
        // évitement à mi-parcours : les rames se croisent sur deux voies
        const mid = Math.max(0, 1 - Math.abs(f - 0.5) / 0.12);
        c.translateX((i === 0 ? -1 : 1) * 2.0 * mid * mid * (3 - 2 * mid));
      });
    },
  };
}

// ----------------------------------------------------------- vie au pied des pistes
function standingGeometry(): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, c: number) => { g.translate(x, y, z); P.push(colored(g, c)); };
  add(new THREE.CylinderGeometry(0.19, 0.16, 0.55, 8), 0, 1.25, 0, 0xffffff);          // veste (teintée)
  add(new THREE.SphereGeometry(0.19, 8, 6).scale(1.1, 0.45, 0.8), 0, 1.52, 0, 0xffffff);
  add(new THREE.SphereGeometry(0.11, 8, 6), 0, 1.72, 0, 0xd9a383);                       // visage
  add(new THREE.SphereGeometry(0.125, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), 0, 1.74, 0, 0x2a2a2a); // bonnet / casque
  for (const x of [-0.1, 0.1]) {
    add(new THREE.CylinderGeometry(0.075, 0.07, 0.85, 6), x, 0.55, 0, 0x2a2d35);         // jambes
    add(new THREE.BoxGeometry(0.13, 0.16, 0.3), x, 0.1, 0.03, 0x1e1e1e);                  // chaussures
    add(new THREE.CylinderGeometry(0.05, 0.045, 0.55, 6), x * 2.4, 1.2, 0, 0xffffff);    // bras
  }
  return mergeGeometries(P);
}

function skisStandGeometry(): THREE.BufferGeometry {
  // paire de skis plantés dans la neige
  const P: THREE.BufferGeometry[] = [];
  for (const x of [-0.06, 0.06]) { const g = new THREE.BoxGeometry(0.09, 1.7, 0.02); g.translate(x, 0.75, 0); P.push(colored(g, 0xffffff)); }
  return mergeGeometries(P);
}

export const lifeTime = { value: 0 };
function swayMaterial(mat: THREE.MeshStandardMaterial, amp: number, freq: number) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLifeT = lifeTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uLifeT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = float(gl_InstanceID) * 1.7;
      #else
        float ph = position.x * 3.0;
      #endif
      transformed.x += sin(uLifeT * ${freq.toFixed(2)} + ph) * ${amp.toFixed(3)} * max(position.y, 0.0);
      transformed.z += cos(uLifeT * ${(freq * 0.7).toFixed(2)} + ph * 1.3) * ${(amp * 0.6).toFixed(3)} * max(position.y, 0.0);`);
  };
  mat.customProgramCacheKey = () => 'sway' + amp + freq;
  return mat;
}

export function makeVillageLife(hf: HeightField, mask: MaskField, spots: THREE.Vector3[], groomerAt: THREE.Vector3 | null, groomerDir: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  let s = 555;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const COLS = [0x1f6fe0, 0x2e9d57, 0xf2b705, 0xff6f3c, 0x7b3fe4, 0x0fb5c9, 0xe63978, 0x333a44, 0xf5f5f5, 0xa4161a, 0x6a994e];
  const people: THREE.Matrix4[] = [], pc: number[] = [], skis: THREE.Matrix4[] = [], sc: number[] = [];
  for (const spot of spots) {
    const groups = 5 + Math.floor(rnd() * 5);
    for (let k = 0; k < groups; k++) {
      const a = rnd() * 6.28, r = 12 + rnd() * 30;
      const gx = spot.x + Math.cos(a) * r, gz = spot.z + Math.sin(a) * r;
      if (!hf.inside(gx, gz, 10) || mask.sample(gx, gz, 3) > 0.3) continue;
      const n = 1 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const x = gx + (rnd() - 0.5) * 3, z = gz + (rnd() - 0.5) * 3;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, hf.height(x, z) - 0.05, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(gx - x, gz - z) + (rnd() - 0.5)), new THREE.Vector3(1, 0.92 + rnd() * 0.15, 1));
        people.push(m); pc.push(COLS[Math.floor(rnd() * COLS.length)]);
        if (rnd() < 0.5) {
          const sx = x + 0.8, sz = z + (rnd() - 0.5);
          skis.push(new THREE.Matrix4().compose(new THREE.Vector3(sx, hf.height(sx, sz) - 0.3, sz), new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.2, rnd() * 6, (rnd() - 0.5) * 0.2)), new THREE.Vector3(1, 1, 1)));
          sc.push(COLS[Math.floor(rnd() * COLS.length)]);
        }
      }
    }
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 });
  const pmat = swayMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 }), 0.025, 1.3);
  const c = new THREE.Color();
  if (people.length) {
    const im = new THREE.InstancedMesh(standingGeometry(), pmat, people.length);
    people.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, c.setHex(pc[i])); });
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); g.add(im);
  }
  if (skis.length) {
    const im = new THREE.InstancedMesh(skisStandGeometry(), mat, skis.length);
    skis.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, c.setHex(sc[i])); });
    im.castShadow = true; im.computeBoundingSphere(); g.add(im);
  }
  // dameuse garée
  if (groomerAt) {
    const d = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xc8232c, roughness: 0.45, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 4.6), red); body.position.y = 1.5; d.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 1.8), red); cab.position.set(0, 2.7, 0.9); d.add(cab);
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.8, 1.85), glass); win.position.set(0, 2.85, 0.9); d.add(win);
    for (const x of [-1.6, 1.6]) { const tr = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 5.0), dark); tr.position.set(x, 0.55, 0); d.add(tr); }
    const blade = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.2, 0.3), new THREE.MeshStandardMaterial({ color: 0xd0d4da, metalness: 0.6, roughness: 0.4 })); blade.position.set(0, 0.8, 3.0); d.add(blade);
    const tiller = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.6, 1.2), dark); tiller.position.set(0, 0.5, -3.2); d.add(tiller);
    const light = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.15, 0.2), new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0x804000 })); light.position.set(0, 3.45, 0.9); d.add(light);
    d.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    d.position.set(groomerAt.x, hf.height(groomerAt.x, groomerAt.z) - 0.1, groomerAt.z);
    d.rotation.y = Math.atan2(groomerDir.x, groomerDir.z);
    g.add(d);
  }
  // drapeaux au front de neige
  for (const spot of spots.slice(0, 1)) {
    for (let k = 0; k < 4; k++) {
      const x = spot.x + 18 + k * 3.5, z = spot.z - 12;
      if (!hf.inside(x, z, 5)) continue;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 7, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6 }));
      mast.position.set(x, hf.height(x, z) + 3.5, z); mast.castShadow = true; g.add(mast);
      const fg = new THREE.PlaneGeometry(1.4, 0.9, 8, 2); fg.translate(0.7, 0, 0);
      const fp = fg.attributes.position as THREE.BufferAttribute;
      const fm = new THREE.MeshStandardMaterial({ color: [0x1f3a93, 0xffffff, 0xd8262c, 0x2e9d57][k], side: THREE.DoubleSide, roughness: 0.8 });
      fm.onBeforeCompile = (sh) => {
        sh.uniforms.uLifeT = lifeTime;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uLifeT;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
          transformed.z += sin(position.x * 4.0 - uLifeT * 6.0 + ${k}.0) * 0.12 * position.x;`);
      };
      fm.customProgramCacheKey = () => 'flag' + k;
      void fp;
      const flag = new THREE.Mesh(fg, fm);
      flag.userData.dynamic = true;
      flag.position.set(x, hf.height(x, z) + 6.4, z); g.add(flag);
    }
  }
  mergeStatic(g);
  return g;
}
