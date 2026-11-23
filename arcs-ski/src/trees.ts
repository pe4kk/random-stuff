import * as THREE from 'three';
import { HeightField, MaskField } from './data';

/** Conifère low-poly enneigé, hauteur 1, faces plates. round = silhouette plus ronde (pin cembro). */
function conifer(tiers: number, seg: number, seed: number, round = false): THREE.BufferGeometry {
  const P: number[] = [], C: number[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const green = new THREE.Color(round ? 0x2a4430 : 0x1f3a2b), green2 = new THREE.Color(round ? 0x34503a : 0x274634);
  const dark = new THREE.Color(0x1c3026), snow = new THREE.Color(0xf4f7fc), snowShade = new THREE.Color(0xd5e0ef), bark = new THREE.Color(0x3b2a20);
  const tri = (a: number[], b: number[], c: number[], col: THREE.Color) => {
    P.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) C.push(col.r, col.g, col.b);
  };
  const tr = 0.026, th = 0.25;
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2, a1 = ((i + 1) / 5) * Math.PI * 2;
    const p0 = [Math.cos(a0) * tr, 0, Math.sin(a0) * tr], p1 = [Math.cos(a1) * tr, 0, Math.sin(a1) * tr];
    const q0 = [p0[0] * 0.6, th, p0[2] * 0.6], q1 = [p1[0] * 0.6, th, p1[2] * 0.6];
    tri(p0, q0, p1, bark); tri(p1, q0, q1, bark);
  }
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1 || 1);
    const yb = 0.12 + f * 0.7;
    const prof = round ? Math.sqrt(Math.max(0, 1 - Math.pow(f * 1.15 - 0.35, 2) / 0.65)) * 0.3 + 0.05 : 0.34 * (1 - f) + 0.05;
    const r = prof * (0.9 + rnd() * 0.2);
    const h = (round ? 0.2 : 0.24) - f * 0.06;
    const apex = [0, Math.min(1, yb + h), 0];
    const rot = rnd() * Math.PI;
    const ring: number[][] = [], inner: number[][] = [];
    for (let i = 0; i < seg; i++) {
      const a = rot + (i / seg) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
      const tip = i % 2 === 0;
      const rr = r * (tip ? 1 : 0.62) * (0.88 + rnd() * 0.24);
      const droop = (tip ? 0.05 : 0.01) * (1 - f * 0.6);
      ring.push([Math.cos(a) * rr, yb - droop, Math.sin(a) * rr]);
      inner.push([Math.cos(a) * rr * 0.5, yb + h * 0.42, Math.sin(a) * rr * 0.5]);
    }
    const under = [0, yb + 0.04, 0];
    for (let i = 0; i < seg; i++) {
      const a = ring[i], b = ring[(i + 1) % seg];
      const ia = inner[i], ib = inner[(i + 1) % seg];
      const col = rnd() < 0.5 ? green : green2;
      // pan inférieur (aiguilles), pan supérieur (souvent couvert de neige)
      tri(ia, b, a, col);
      tri(ia, ib, b, col);
      const snowy = rnd() < 0.5 + 0.35 * f;
      tri(apex, ib, ia, snowy ? snow : col);
      if (rnd() < 0.35) tri(ia, b, a, snowShade); // paquets de neige sur les branches
      tri(a, b, under, dark);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  // normales « feuillage » : moitié face, moitié ellipsoïde autour du tronc -> volume doux, pas de dessous noirs
  const N = new Float32Array(P.length);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3(), rn = new THREE.Vector3();
  for (let t = 0; t < P.length; t += 9) {
    e1.set(P[t + 3] - P[t], P[t + 4] - P[t + 1], P[t + 5] - P[t + 2]);
    e2.set(P[t + 6] - P[t], P[t + 7] - P[t + 1], P[t + 8] - P[t + 2]);
    fn.crossVectors(e1, e2).normalize();
    for (let v = 0; v < 3; v++) {
      const x = P[t + v * 3], y = P[t + v * 3 + 1], z = P[t + v * 3 + 2];
      const trunk = y < 0.26 && Math.hypot(x, z) < 0.03;
      rn.set(x / 0.3, (y - 0.42) / 0.9 + 0.35, z / 0.3).normalize();
      const k = trunk ? 0.0 : 0.6;
      const n = fn.clone().multiplyScalar(1 - k).addScaledVector(rn, k).normalize();
      N[t + v * 3] = n.x; N[t + v * 3 + 1] = n.y; N[t + v * 3 + 2] = n.z;
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return g;
}

/** Arbres + obstacles (rochers, pylônes…) avec détection de collision. */
export class Forest {
  group = new THREE.Group();
  xs: Float32Array; zs: Float32Array; hs: Float32Array; rs: Float32Array;
  count = 0;
  private grid = new Map<number, number[]>();
  private readonly gcell = 8;
  private chunks: { hi: THREE.InstancedMesh; mid: THREE.InstancedMesh; lo: THREE.InstancedMesh; cx: number; cz: number }[] = [];
  readonly chunkSize = 256;
  private half: number;
  private extra: { x: number; z: number; r: number; h: number }[] = [];

  constructor(raw: Uint16Array, hf: HeightField, mask: MaskField) {
    this.half = hf.half;
    const n0 = raw.length / 3;
    const X: number[] = [], Z: number[] = [], H: number[] = [];
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n0; i++) {
      const x = raw[i * 3] / 16 - hf.half, z = raw[i * 3 + 1] / 16 - hf.half, h = raw[i * 3 + 2] / 100;
      X.push(x); Z.push(z); H.push(Math.min(h, 30));
      if (h > 7 && rnd() < 0.8) {
        const a = rnd() * Math.PI * 2, d = 2.6 + rnd() * 2.2;
        const x2 = x + Math.cos(a) * d, z2 = z + Math.sin(a) * d;
        if (mask.sample(x2, z2, 1) > 0.6 && mask.sample(x2, z2, 0) < 0.2 && mask.sample(x2, z2, 3) < 0.1) {
          X.push(x2); Z.push(z2); H.push(h * (0.35 + rnd() * 0.4));
        }
      }
    }
    this.count = X.length;
    this.xs = Float32Array.from(X); this.zs = Float32Array.from(Z); this.hs = Float32Array.from(H);
    this.rs = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.rs[i] = 0.35 + Math.min(0.6, this.hs[i] * 0.03);
      this.index(i, this.xs[i], this.zs[i]);
    }

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: 0x060a08 });
    mat.color.setScalar(1.3);
    const geoHi = [conifer(11, 13, 11), conifer(12, 12, 29), conifer(8, 13, 53, true)];
    const geoMid = [conifer(6, 8, 5), conifer(6, 8, 17), conifer(5, 8, 41, true)];
    const geoLo = [conifer(3, 5, 7), conifer(3, 5, 7), conifer(3, 6, 9, true)];
    const nc = (hf.half * 2) / this.chunkSize;
    // par tronçon et par espèce
    const buckets: number[][][] = Array.from({ length: nc * nc }, () => [[], [], []]);
    for (let i = 0; i < this.count; i++) {
      const cx = Math.min(nc - 1, Math.max(0, Math.floor((this.xs[i] + hf.half) / this.chunkSize)));
      const cz = Math.min(nc - 1, Math.max(0, Math.floor((this.zs[i] + hf.half) / this.chunkSize)));
      const y = hf.height(this.xs[i], this.zs[i]);
      // pins cembro surtout en altitude
      const pinChance = Math.min(0.6, Math.max(0, (y - 1850) / 400));
      const sp = ((i * 2654435761) >>> 0) % 1000 / 1000 < pinChance ? 2 : (i % 2);
      buckets[cz * nc + cx][sp].push(i);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    buckets.forEach((species, bi) => {
      const cx = bi % nc, cz = Math.floor(bi / nc);
      species.forEach((ids, spi) => {
        if (!ids.length) return;
        const hi = new THREE.InstancedMesh(geoHi[spi], mat, ids.length);
        const mid = new THREE.InstancedMesh(geoMid[spi], mat, ids.length);
        const lo = new THREE.InstancedMesh(geoLo[spi], mat, ids.length);
        ids.forEach((id, k) => {
          const h = this.hs[id];
          const w = h * (spi === 2 ? 0.62 : 0.5) * (1 + ((id * 7919) % 100) / 100 * 0.35);
          p.set(this.xs[id], hf.height(this.xs[id], this.zs[id]) - 0.5, this.zs[id]);
          q.setFromAxisAngle(up, (id * 2.399) % (Math.PI * 2));
          s.set(w, h, w);
          m4.compose(p, q, s);
          hi.setMatrixAt(k, m4); mid.setMatrixAt(k, m4); lo.setMatrixAt(k, m4);
          const v = 0.82 + ((id * 104729) % 100) / 100 * 0.32;
          col.setRGB(v, v * (0.95 + ((id * 13) % 10) / 90), v * 0.98);
          hi.setColorAt(k, col); mid.setColorAt(k, col); lo.setColorAt(k, col);
        });
        hi.castShadow = true; hi.receiveShadow = true;
        mid.castShadow = true; mid.receiveShadow = true;
        lo.castShadow = false; lo.receiveShadow = false;
        for (const m of [hi, mid, lo]) { m.computeBoundingSphere(); m.visible = false; this.group.add(m); }
        this.chunks.push({ hi, mid, lo, cx, cz });
      });
    });
  }

  private key(i: number, j: number) { return (i + 4096) * 8192 + (j + 4096); }
  private index(id: number, x: number, z: number) {
    const k = this.key(Math.floor(x / this.gcell), Math.floor(z / this.gcell));
    let a = this.grid.get(k);
    if (!a) this.grid.set(k, (a = []));
    a.push(id);
  }

  /** obstacle supplémentaire (rocher, pylône, enneigeur…) */
  addObstacle(x: number, z: number, r: number, h: number) {
    const id = this.count + this.extra.length;
    this.extra.push({ x, z, r, h });
    this.index(id, x, z);
  }
  ox(id: number) { return id < this.count ? this.xs[id] : this.extra[id - this.count].x; }
  oz(id: number) { return id < this.count ? this.zs[id] : this.extra[id - this.count].z; }
  or(id: number) { return id < this.count ? this.rs[id] : this.extra[id - this.count].r; }
  oh(id: number) { return id < this.count ? this.hs[id] : this.extra[id - this.count].h; }

  /** retire les arbres trop proches d'une ligne (piste de funiculaire…) */
  update(cam: THREE.Vector3, farDist = 2000, hiDist = 330) {
    for (const c of this.chunks) {
      const x = -this.half + (c.cx + 0.5) * this.chunkSize, z = -this.half + (c.cz + 0.5) * this.chunkSize;
      const d = Math.max(0, Math.hypot(x - cam.x, z - cam.z) - this.chunkSize * 0.7);
      c.hi.visible = d < hiDist * 0.55;
      c.mid.visible = !c.hi.visible && d < hiDist * 1.25;
      c.lo.visible = !c.hi.visible && !c.mid.visible && d < farDist;
    }
  }

  /** obstacle le plus "pénétré" autour d'un point : indice, distance, rayon */
  nearest(x: number, z: number, r: number): { i: number; d: number; rad: number } {
    const g = this.gcell;
    let best = -1, bd = r, brad = 0, bscore = Infinity;
    const i0 = Math.floor((x - r - 3) / g), i1 = Math.floor((x + r + 3) / g);
    const j0 = Math.floor((z - r - 3) / g), j1 = Math.floor((z + r + 3) / g);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.grid.get(this.key(i, j));
      if (!a) continue;
      for (const id of a) {
        const d = Math.hypot(this.ox(id) - x, this.oz(id) - z);
        const rad = this.or(id);
        const score = d - rad;
        if (score < bscore) { bscore = score; best = id; bd = d; brad = rad; }
      }
    }
    return { i: best, d: bd, rad: brad };
  }
}
