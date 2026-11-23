import * as THREE from 'three';
import { HeightField, MaskField } from './data';
import { TreeStyle, shadeAO, coniferBranches, coniferCards, cardMaterial, makeImpostor } from './treestyles';

/** Conifère low-poly enneigé, hauteur 1, faces plates. round = silhouette plus ronde (pin cembro). */
function conifer(tiers: number, seg: number, seed: number, round = false, lite = false): THREE.BufferGeometry {
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
  for (let i = 0; i < (lite ? 0 : 5); i++) {
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
      if (!lite && rnd() < 0.35) tri(ia, b, a, snowShade); // paquets de neige sur les branches
      if (!lite) tri(a, b, under, dark);
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
  private meshes: THREE.InstancedMesh[][] = [];   // [lod][espèce]
  private caps: number[] = [];
  private mats!: Float32Array; private cols!: Float32Array; private species!: Uint8Array;
  private cells: number[][] = [];
  private readonly cellSize = 128;
  private get nCell() { return Math.round((this.half * 2) / this.cellSize); }
  private last = { x: 1e9, z: 1e9, dx: 0, dz: 1, far: 0, hi: 0, t: 0 };
  private half: number;
  private extra: { x: number; z: number; r: number; h: number }[] = [];

  constructor(raw: Uint16Array, hf: HeightField, mask: MaskField, public style: TreeStyle = 'A', renderer?: THREE.WebGLRenderer) {
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

    // éclairage diffus (Lambert) : moins coûteux que le PBR, identique à l’œil sur des aiguilles mates
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x060a08 });
    mat.color.setScalar(1.3);
    let geoHi = [conifer(11, 13, 11), conifer(12, 12, 29), conifer(8, 13, 53, true)];
    let geoMid = [conifer(6, 8, 5), conifer(6, 8, 17), conifer(5, 8, 41, true)];
    let geoLo = [conifer(2, 5, 7, false, true), conifer(2, 5, 13, false, true), conifer(2, 5, 9, true, true)];
    const lodMat: THREE.Material[] = [mat, mat, mat];
    if (style !== 'A') {
      geoMid.forEach(g => shadeAO(g)); geoLo.forEach(g => shadeAO(g, 0.6));
    }
    if (style === 'B') geoHi.forEach(g => shadeAO(g));
    if (style === 'C') {
      geoHi = [coniferBranches(14, 11, 11), coniferBranches(15, 10, 29), coniferBranches(10, 11, 53, true)];
      geoMid = [shadeAO(conifer(8, 10, 5)), shadeAO(conifer(8, 10, 17)), shadeAO(conifer(6, 10, 41, true))];
    }
    if (style === 'D') {
      const cm = cardMaterial();
      // cartes détourées seulement de près ; au-delà, branches pleines (pas de découpe = beaucoup moins de pixels calculés)
      geoHi = [coniferCards(11, 7, 11), coniferCards(12, 7, 29), coniferCards(9, 8, 53, true)];
      geoMid = [coniferBranches(8, 7, 5), coniferBranches(9, 7, 17), coniferBranches(7, 7, 41, true)];
      lodMat[0] = cm;
    }
    // lointain : imposteurs photographiés depuis le modèle intermédiaire (même teinte, même neige)
    let loMats: THREE.Material[] | null = null;
    if (renderer && style !== 'A') {
      const imps = geoMid.map(g => makeImpostor(renderer, g));
      geoLo = imps.map(i => i.geo);
      loMats = imps.map(i => i.mat);
    }
    // données par arbre : matrice, couleur, espèce ; liste par carré de 128 m pour les requêtes de distance
    const n = this.count;
    this.mats = new Float32Array(n * 16); this.cols = new Float32Array(n * 3); this.species = new Uint8Array(n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    this.cells = Array.from({ length: this.nCell * this.nCell }, () => [] as number[]);
    for (let i = 0; i < n; i++) {
      const y = hf.height(this.xs[i], this.zs[i]);
      // pins cembro surtout en altitude
      const pinChance = Math.min(0.6, Math.max(0, (y - 1850) / 400));
      const sp = ((i * 2654435761) >>> 0) % 1000 / 1000 < pinChance ? 2 : (i % 2);
      this.species[i] = sp;
      const h = this.hs[i];
      const w = h * (sp === 2 ? 0.62 : 0.5) * (1 + ((i * 7919) % 100) / 100 * 0.35);
      p.set(this.xs[i], y - 0.5, this.zs[i]);
      q.setFromAxisAngle(up, (i * 2.399) % (Math.PI * 2));
      s.set(w, h, w);
      m4.compose(p, q, s).toArray(this.mats, i * 16);
      const v = 0.82 + ((i * 104729) % 100) / 100 * 0.32;
      col.setRGB(v, v * (0.95 + ((i * 13) % 10) / 90), v * 0.98).toArray(this.cols, i * 3);
      const cx = Math.min(this.nCell - 1, Math.max(0, Math.floor((this.xs[i] + hf.half) / this.cellSize)));
      const cz = Math.min(this.nCell - 1, Math.max(0, Math.floor((this.zs[i] + hf.half) / this.cellSize)));
      this.cells[cz * this.nCell + cx].push(i);
    }
    // un maillage instancié par espèce et par niveau de détail, rempli selon la caméra
    const caps = [2500, 9000, 30000];
    const geos = [geoHi, geoMid, geoLo];
    for (let lod = 0; lod < 3; lod++) {
      const row: THREE.InstancedMesh[] = [];
      for (let sp = 0; sp < 3; sp++) {
        const im = new THREE.InstancedMesh(geos[lod][sp], lod === 2 && loMats ? loMats[sp] : lodMat[lod], caps[lod]);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.setColorAt(0, col.setRGB(1, 1, 1));
        im.instanceColor!.setUsage(THREE.DynamicDrawUsage);
        im.count = 0; im.frustumCulled = false;
        im.castShadow = lod === 0; im.receiveShadow = lod === 0;
        this.group.add(im);
        row.push(im);
      }
      this.meshes.push(row);
      this.caps.push(caps[lod]);
    }
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
  /**
   * Choix arbre par arbre : détaillé (avec ombres) tout autour du joueur, simplifié puis très simplifié
   * plus loin, et rien derrière la caméra au-delà de 30 m. Recalcul seulement quand la caméra a bougé.
   */
  update(cam: THREE.Vector3, farDist = 2000, hiDist = 330, dir?: THREE.Vector3) {
    const L = this.last;
    let dx = dir ? dir.x : L.dx, dz = dir ? dir.z : L.dz;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const now = performance.now();
    const moved = Math.hypot(cam.x - L.x, cam.z - L.z) > 6 || dx * L.dx + dz * L.dz < 0.985 || farDist !== L.far || hiDist !== L.hi;
    if (!moved && now - L.t < 1500) return;
    Object.assign(L, { x: cam.x, z: cam.z, dx, dz, far: farDist, hi: hiDist, t: now });
    const rHi = hiDist * 0.36, rMid = hiDist, rLo = farDist;
    const rHi2 = rHi * rHi, rMid2 = rMid * rMid, rLo2 = rLo * rLo;
    const cosLim = -0.3;   // demi-angle ~107° : large marge pour les rotations rapides de caméra
    const cnt = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const N = this.nCell, cs = this.cellSize, h = this.half;
    const c0 = Math.max(0, Math.floor((cam.x - rLo + h) / cs)), c1 = Math.min(N - 1, Math.floor((cam.x + rLo + h) / cs));
    const r0 = Math.max(0, Math.floor((cam.z - rLo + h) / cs)), r1 = Math.min(N - 1, Math.floor((cam.z + rLo + h) / cs));
    for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
      // carré entièrement derrière la caméra et hors de l'anneau détaillé : ignoré
      const ccx = -h + (cx + 0.5) * cs - cam.x, ccz = -h + (cz + 0.5) * cs - cam.z;
      const cd = Math.hypot(ccx, ccz);
      if (cd - cs * 0.71 > rLo) continue;
      if (cd > rHi + cs && (ccx * dx + ccz * dz) / cd < cosLim - 0.35) continue;
      for (const i of this.cells[cz * N + cx]) {
        const tx = this.xs[i] - cam.x, tz = this.zs[i] - cam.z;
        const d2 = tx * tx + tz * tz;
        if (d2 > rLo2) continue;
        let lod: number;
        if (d2 < rHi2) lod = 0;
        else {
          if (d2 > 900 && (tx * dx + tz * dz) < cosLim * Math.sqrt(d2)) continue;
          lod = d2 < rMid2 ? 1 : 2;
        }
        const sp = this.species[i];
        const k = cnt[lod][sp];
        if (k >= this.caps[lod]) continue;
        const im = this.meshes[lod][sp];
        (im.instanceMatrix.array as Float32Array).set(this.mats.subarray(i * 16, i * 16 + 16), k * 16);
        (im.instanceColor!.array as Float32Array).set(this.cols.subarray(i * 3, i * 3 + 3), k * 3);
        cnt[lod][sp] = k + 1;
      }
    }
    for (let lod = 0; lod < 3; lod++) for (let sp = 0; sp < 3; sp++) {
      const im = this.meshes[lod][sp], c = cnt[lod][sp];
      im.count = c;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, c * 16); im.instanceMatrix.needsUpdate = true;
      im.instanceColor!.clearUpdateRanges(); im.instanceColor!.addUpdateRange(0, c * 3); im.instanceColor!.needsUpdate = true;
    }
  }

  /** nombre d'arbres dessinés par niveau (diagnostic) */
  stats() { return this.meshes.map(r => r.reduce((a, m) => a + m.count, 0)); }

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
