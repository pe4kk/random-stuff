import * as THREE from 'three';
import { HeightField, MaskField } from './data';

/** Épicéa low-poly enneigé, hauteur 1, construit à la main (faces plates). */
function spruceGeometry(tiers: number, seg: number, seed: number): THREE.BufferGeometry {
  const P: number[] = [], C: number[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const green = new THREE.Color(0x1d3324), dark = new THREE.Color(0x0e1c14), snow = new THREE.Color(0xf2f5fa), bark = new THREE.Color(0x3b2a20);
  const tri = (a: number[], b: number[], c: number[], col: THREE.Color) => {
    P.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) C.push(col.r, col.g, col.b);
  };
  // tronc
  const tr = 0.028, th = 0.22;
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2, a1 = ((i + 1) / 5) * Math.PI * 2;
    const p0 = [Math.cos(a0) * tr, 0, Math.sin(a0) * tr], p1 = [Math.cos(a1) * tr, 0, Math.sin(a1) * tr];
    const q0 = [p0[0], th, p0[2]], q1 = [p1[0], th, p1[2]];
    tri(p0, q0, p1, bark); tri(p1, q0, q1, bark);
  }
  // étages de branches
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1 || 1);
    const yb = 0.14 + f * 0.66;                    // base de l'étage
    const r = 0.36 * (1 - f) + 0.07;               // rayon
    const h = 0.3 - f * 0.08;                      // hauteur du cône
    const apex = [0, Math.min(1, yb + h), 0];
    const rot = rnd() * Math.PI;
    const ring: number[][] = [];
    for (let i = 0; i < seg; i++) {
      const a = rot + (i / seg) * Math.PI * 2;
      const rr = r * (i % 2 === 0 ? 1 : 0.72) * (0.9 + rnd() * 0.2);
      const droop = (i % 2 === 0 ? 0.04 : 0.0) * (1 - f);
      ring.push([Math.cos(a) * rr, yb - droop, Math.sin(a) * rr]);
    }
    const under = [0, yb + 0.05, 0];
    for (let i = 0; i < seg; i++) {
      const a = ring[i], b = ring[(i + 1) % seg];
      // face extérieure : neige sur les pans les plus plats, en haut des branches
      const snowy = rnd() < 0.55 + 0.3 * f;
      const mid = [(a[0] + b[0]) / 2 * 0.55, (a[1] + b[1]) / 2 * 0.5 + apex[1] * 0.5, (a[2] + b[2]) / 2 * 0.55];
      tri(apex, b, mid, snowy ? snow : green);
      tri(mid, b, a, green);
      tri(apex, mid, a, snowy && rnd() < 0.7 ? snow : green);
      tri(a, b, under, dark);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  return g;
}

export class Forest {
  group = new THREE.Group();
  /** x, z, rayon du tronc, hauteur */
  xs: Float32Array; zs: Float32Array; hs: Float32Array;
  count = 0;
  private grid = new Map<number, number[]>();
  private readonly gcell = 8;
  private chunks: { hi: THREE.InstancedMesh; lo: THREE.InstancedMesh; cx: number; cz: number }[] = [];
  readonly chunkSize = 256;

  constructor(raw: Uint16Array, hf: HeightField, mask: MaskField) {
    const n0 = raw.length / 3;
    const X: number[] = [], Z: number[] = [], H: number[] = [];
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n0; i++) {
      const x = raw[i * 3] / 16 - hf.half, z = raw[i * 3 + 1] / 16 - hf.half, h = raw[i * 3 + 2] / 100;
      X.push(x); Z.push(z); H.push(Math.min(h, 32));
      // densification : jeunes arbres autour des grands, en vraie forêt seulement
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

    for (let i = 0; i < this.count; i++) {
      const k = this.key(Math.floor(this.xs[i] / this.gcell), Math.floor(this.zs[i] / this.gcell));
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(i);
    }

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
    const geoHi = [spruceGeometry(6, 9, 11), spruceGeometry(7, 8, 29)];
    const geoLo = spruceGeometry(3, 5, 7);
    const nc = (hf.half * 2) / this.chunkSize;
    const buckets: number[][] = Array.from({ length: nc * nc }, () => []);
    for (let i = 0; i < this.count; i++) {
      const cx = Math.min(nc - 1, Math.max(0, Math.floor((this.xs[i] + hf.half) / this.chunkSize)));
      const cz = Math.min(nc - 1, Math.max(0, Math.floor((this.zs[i] + hf.half) / this.chunkSize)));
      buckets[cz * nc + cx].push(i);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    buckets.forEach((ids, bi) => {
      if (!ids.length) return;
      const cx = bi % nc, cz = Math.floor(bi / nc);
      const variant = (cx + cz) % 2;
      const hi = new THREE.InstancedMesh(geoHi[variant], mat, ids.length);
      const lo = new THREE.InstancedMesh(geoLo, mat, ids.length);
      ids.forEach((id, k) => {
        const h = this.hs[id];
        const w = h * (0.52 + ((id * 7919) % 100) / 100 * 0.22);
        p.set(this.xs[id], hf.height(this.xs[id], this.zs[id]) - 0.5, this.zs[id]);
        q.setFromAxisAngle(up, (id * 2.399) % (Math.PI * 2));
        s.set(w, h, w);
        m4.compose(p, q, s);
        hi.setMatrixAt(k, m4); lo.setMatrixAt(k, m4);
        const v = 0.85 + ((id * 104729) % 100) / 100 * 0.3;
        col.setRGB(v, v * (0.96 + ((id * 13) % 10) / 100), v);
        hi.setColorAt(k, col); lo.setColorAt(k, col);
      });
      hi.castShadow = true; hi.receiveShadow = true;
      lo.castShadow = false; lo.receiveShadow = false;
      hi.computeBoundingSphere(); lo.computeBoundingSphere();
      hi.visible = false;
      this.group.add(hi, lo);
      this.chunks.push({ hi, lo, cx, cz });
    });
    this.half = hf.half;
  }
  private half = 0;

  private key(i: number, j: number) { return (i + 4096) * 8192 + (j + 4096); }

  update(cam: THREE.Vector3, farDist = 2000, hiDist = 330) {
    for (const c of this.chunks) {
      const x = -this.half + (c.cx + 0.5) * this.chunkSize, z = -this.half + (c.cz + 0.5) * this.chunkSize;
      const d = Math.max(0, Math.hypot(x - cam.x, z - cam.z) - this.chunkSize * 0.7);
      c.hi.visible = d < hiDist;
      c.lo.visible = !c.hi.visible && d < farDist;
    }
  }

  /** arbre le plus proche dans un rayon : renvoie l'indice ou -1 */
  nearest(x: number, z: number, r: number): { i: number; d: number } {
    const g = this.gcell;
    let best = -1, bd = r;
    const i0 = Math.floor((x - r) / g), i1 = Math.floor((x + r) / g);
    const j0 = Math.floor((z - r) / g), j1 = Math.floor((z + r) / g);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.grid.get(this.key(i, j));
      if (!a) continue;
      for (const id of a) {
        const d = Math.hypot(this.xs[id] - x, this.zs[id] - z);
        if (d < bd) { bd = d; best = id; }
      }
    }
    return { i: best, d: bd };
  }
}
