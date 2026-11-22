import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HeightField, MaskField, Piste } from './data';
import { Forest } from './trees';

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
  const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
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
      if (slope < 0.16) continue;
      const pr = Math.min(1, (slope - 0.16) * 2.2) * 0.35;
      if (rnd() > pr) continue;
      if (mask.sample(px, pz, 0) > 0.15 || mask.sample(px, pz, 3) > 0.05 || mask.sample(px, pz, 1) > 0.6) continue;
      const size = 0.5 + Math.pow(rnd(), 2.2) * 3.2 * (0.6 + slope);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, rnd() * 6.28, (rnd() - 0.5) * 0.4));
      m.compose(new THREE.Vector3(px, hf.height(px, pz) - size * 0.35, pz), q, new THREE.Vector3(size, size, size));
      lists[Math.floor(rnd() * 3)].push(m);
      if (size > 1.0) forest.addObstacle(px, pz, size * 0.9, size * 0.8);
    }
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  lists.forEach((list, i) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geos[i], mat, list.length);
    list.forEach((m, k) => im.setMatrixAt(k, m));
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  });
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
  const cars = [car, car.clone()];
  cars.forEach(c => g.add(c));
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
        // décalage latéral au croisement
        c.translateX(i === 0 ? 0 : 0);
      });
    },
  };
}
