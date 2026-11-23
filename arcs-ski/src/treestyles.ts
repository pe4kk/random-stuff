// Variantes de sapins (choix du style dans le jeu) : géométries et matériaux.
import * as THREE from 'three';

export type TreeStyle = 'A' | 'B' | 'C' | 'D';
export const TREE_STYLE_NAMES: Record<TreeStyle, string> = {
  A: 'Facettes (actuel)', B: 'Ombrés', C: 'Branches', D: 'Réalistes',
};

/**
 * Ombrage interne « cuit » dans les couleurs : le cœur et le bas des étages sont sombres,
 * les pointes et le haut de l'arbre plus clairs, la neige reste blanche. Aucun coût au rendu.
 */
export function shadeAO(g: THREE.BufferGeometry, strength = 1) {
  const p = g.attributes.position as THREE.BufferAttribute, c = g.attributes.color as THREE.BufferAttribute;
  // rayon maximal par tranche de hauteur
  const bins = 24, rmax = new Float32Array(bins).fill(0.02);
  for (let i = 0; i < p.count; i++) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(p.getY(i) * bins)));
    rmax[b] = Math.max(rmax[b], Math.hypot(p.getX(i), p.getZ(i)));
  }
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), b = Math.min(bins - 1, Math.max(0, Math.floor(y * bins)));
    const r = Math.hypot(p.getX(i), p.getZ(i)) / rmax[b];
    const lum = (c.getX(i) + c.getY(i) + c.getZ(i)) / 3;
    const snow = lum > 0.6 ? 1 : 0;
    let ao = 0.45 + 0.75 * Math.min(1, r) + 0.25 * y;          // cœur sombre, pointes claires
    ao = 1 + (Math.min(1.25, ao) - 1) * strength * (snow ? 0.35 : 1);
    // pointes légèrement plus vertes/jaunes (pousses), cœur bleuté
    const warm = Math.max(0, r - 0.7) * 0.25 * (1 - snow);
    c.setXYZ(i, c.getX(i) * ao * (1 + warm * 0.3), c.getY(i) * ao * (1 + warm * 0.6), c.getZ(i) * ao * (1 - warm * 0.2));
  }
  c.needsUpdate = true;
  return g;
}

/** normales « feuillage » : moitié face, moitié ellipsoïde autour du tronc */
function foliageNormals(P: number[], k = 0.55): Float32Array {
  const N = new Float32Array(P.length);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3(), rn = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < P.length; t += 9) {
    e1.set(P[t + 3] - P[t], P[t + 4] - P[t + 1], P[t + 5] - P[t + 2]);
    e2.set(P[t + 6] - P[t], P[t + 7] - P[t + 1], P[t + 8] - P[t + 2]);
    fn.crossVectors(e1, e2).normalize();
    for (let v = 0; v < 3; v++) {
      const x = P[t + v * 3], y = P[t + v * 3 + 1], z = P[t + v * 3 + 2];
      const trunk = y < 0.2 && Math.hypot(x, z) < 0.03;
      rn.set(x / 0.3, (y - 0.42) / 0.9 + 0.35, z / 0.3).normalize();
      n.copy(fn).multiplyScalar(1 - (trunk ? 0 : k)).addScaledVector(rn, trunk ? 0 : k).normalize();
      N[t + v * 3] = n.x; N[t + v * 3 + 1] = n.y; N[t + v * 3 + 2] = n.z;
    }
  }
  return N;
}

function trunkAndCore(P: number[], C: number[], tri: (a: number[], b: number[], c: number[], col: THREE.Color) => void, coreR: number, coreTop: number) {
  const bark = new THREE.Color(0x3b2a20), core = new THREE.Color(0x0f1f17);
  const tr = 0.024;
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2, a1 = ((i + 1) / 5) * Math.PI * 2;
    const p0 = [Math.cos(a0) * tr, 0, Math.sin(a0) * tr], p1 = [Math.cos(a1) * tr, 0, Math.sin(a1) * tr];
    const q0 = [p0[0] * 0.6, 0.25, p0[2] * 0.6], q1 = [p1[0] * 0.6, 0.25, p1[2] * 0.6];
    tri(p0, q0, p1, bark); tri(p1, q0, q1, bark);
  }
  // cône intérieur sombre : bouche les trous entre les branches
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
    tri([Math.cos(a0) * coreR, 0.14, Math.sin(a0) * coreR], [0, coreTop, 0], [Math.cos(a1) * coreR, 0.14, Math.sin(a1) * coreR], core);
  }
  void P; void C;
}

/**
 * Sapin à branches modélisées : chaque branche est un « toit » tombant (dessus souvent enneigé,
 * dessous vert sombre), étages irréguliers, flèche fine au sommet.
 */
export function coniferBranches(tiers: number, perTier: number, seed: number, round = false): THREE.BufferGeometry {
  const P: number[] = [], C: number[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const greens = [new THREE.Color(round ? 0x2c4632 : 0x1d3a29), new THREE.Color(round ? 0x355238 : 0x244632), new THREE.Color(0x1a3325)];
  const under = new THREE.Color(0x0f2318), snow = new THREE.Color(0xf6f8fc), snowS = new THREE.Color(0xdbe5f2);
  const tri = (a: number[], b: number[], c: number[], col: THREE.Color) => { P.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) C.push(col.r, col.g, col.b); };
  trunkAndCore(P, C, tri, round ? 0.2 : 0.16, 0.9);
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const yb = 0.13 + f * 0.8;
    const prof = round ? Math.sqrt(Math.max(0, 1 - Math.pow(f * 1.15 - 0.35, 2) / 0.65)) * 0.3 + 0.04 : 0.36 * Math.pow(1 - f, 0.95) + 0.03;
    const n = Math.max(4, Math.round(perTier * (0.55 + 0.45 * (1 - f))));
    const rot = rnd() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = rot + (k / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const r = prof * (0.75 + rnd() * 0.45);
      const ca = Math.cos(a), sa = Math.sin(a);
      const droop = (0.05 + 0.07 * rnd()) * (1 - f * 0.5);
      const base = [ca * 0.02, yb + 0.03, sa * 0.02];
      const tip = [ca * r, yb - droop, sa * r];
      const m = 0.55;
      const w = r * (0.42 + rnd() * 0.15);
      const mx = ca * r * m, mz = sa * r * m, my = yb - droop * 0.45;
      // ailes : écartées perpendiculairement et un peu plus basses (forme de toit)
      const left = [mx - sa * w * 0.5, my - w * 0.18, mz + ca * w * 0.5];
      const right = [mx + sa * w * 0.5, my - w * 0.18, mz - ca * w * 0.5];
      const ridge = [mx, my + 0.012, mz];
      const g = greens[Math.floor(rnd() * 3)];
      const snowy = rnd() < 0.45 + 0.3 * f;
      const top = snowy ? snow : g, top2 = snowy ? snowS : g;
      // dessus (4 triangles)
      tri(base, left, ridge, top2); tri(base, ridge, right, top);
      tri(ridge, left, tip, top); tri(ridge, tip, right, top2);
      // dessous (vert sombre)
      tri(base, ridge, left, under); tri(base, right, ridge, under);
      tri(ridge, tip, left, g); tri(ridge, right, tip, under);
    }
  }
  // flèche
  const apex = [0, 1, 0];
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 2 + 0.3, a1 = ((i + 1) / 4) * Math.PI * 2 + 0.3;
    tri([Math.cos(a0) * 0.04, 0.88, Math.sin(a0) * 0.04], apex, [Math.cos(a1) * 0.04, 0.88, Math.sin(a1) * 0.04], i % 2 ? snow : greens[0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(foliageNormals(P, 0.5), 3));
  return shadeAO(g, 0.8);
}

/** Texture de branche (aiguilles + neige), générée une fois dans un canvas. */
let cardTex: THREE.Texture | null = null;
export function branchTexture(): THREE.Texture {
  if (cardTex) return cardTex;
  const W = 256, H = 128;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;
  let s = 777;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  x.clearRect(0, 0, W, H);
  // la branche part de la gauche (tronc) vers la droite (pointe), silhouette en fuseau
  const shape = (u: number) => Math.sin(Math.PI * Math.min(1, u * 1.05)) * (0.42 - 0.12 * u);
  x.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 1400; i++) {
      const u = rnd();
      const half = shape(u) * H;
      const side = rnd() < 0.5 ? -1 : 1;
      const len = half * (0.5 + rnd() * 0.5);
      const x0 = u * W * 0.97, y0 = H / 2 + (rnd() - 0.5) * 6;
      const x1 = x0 + len * 0.45 * (0.6 + rnd()), y1 = y0 + side * len;
      const g = 45 + rnd() * 40;
      x.strokeStyle = pass === 0 ? `rgb(${12 + rnd() * 10},${g},${26 + rnd() * 14})` : `rgb(${22 + rnd() * 16},${g + 20},${34 + rnd() * 16})`;
      x.lineWidth = pass === 0 ? 2.2 : 1.2;
      x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
    }
  }
  // pastille opaque grise (coin haut-gauche) pour le tronc et le cœur, teintés par la couleur des sommets
  x.fillStyle = '#7a7a7a'; x.fillRect(0, 0, 10, 10);
  // rameau central
  x.strokeStyle = '#3a2a1e'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W * 0.95, H / 2 + 2); x.stroke();
  // neige : paquets sur la moitié supérieure
  for (let i = 0; i < 70; i++) {
    const u = 0.08 + rnd() * 0.85;
    const half = shape(u) * H;
    const cy = H / 2 - half * (0.15 + rnd() * 0.6);
    const r = 4 + rnd() * 10 * (1 - u * 0.5);
    const grd = x.createRadialGradient(u * W, cy, 0, u * W, cy, r);
    grd.addColorStop(0, 'rgba(250,252,255,1)'); grd.addColorStop(0.7, 'rgba(232,240,250,0.95)'); grd.addColorStop(1, 'rgba(225,235,248,0)');
    x.fillStyle = grd; x.beginPath(); x.arc(u * W, cy, r, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  cardTex = t;
  return t;
}

/**
 * Sapin « réaliste » : branches en cartes texturées (aiguilles détourées), deux plans croisés
 * par branche, tombants. Peu de triangles, mais le détourage coûte au remplissage.
 */
export function coniferCards(tiers: number, perTier: number, seed: number, round = false): THREE.BufferGeometry {
  const P: number[] = [], C: number[] = [], U: number[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const quad = (a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[], col: THREE.Color) => {
    // a-b le long du bord « tronc », c-d côté pointe
    P.push(...a, ...b, ...c, ...a, ...c, ...d);
    U.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud);
    for (let i = 0; i < 6; i++) C.push(col.r, col.g, col.b);
  };
  const solidTri = (a: number[], b: number[], c: number[], col: THREE.Color) => { P.push(...a, ...b, ...c); U.push(0.012, 0.975, 0.012, 0.975, 0.012, 0.975); for (let i = 0; i < 3; i++) C.push(col.r, col.g, col.b); };
  // tronc + cône intérieur (texture : zone pleine du rameau)
  const bark = new THREE.Color(0x7a5840), core = new THREE.Color(0x2c4a36);
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2, a1 = ((i + 1) / 5) * Math.PI * 2, tr = 0.024;
    const p0 = [Math.cos(a0) * tr, 0, Math.sin(a0) * tr], p1 = [Math.cos(a1) * tr, 0, Math.sin(a1) * tr];
    solidTri(p0, [p0[0] * 0.6, 0.25, p0[2] * 0.6], p1, bark);
  }
  const coreR = round ? 0.16 : 0.12;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
    solidTri([Math.cos(a0) * coreR, 0.15, Math.sin(a0) * coreR], [0, 0.92, 0], [Math.cos(a1) * coreR, 0.15, Math.sin(a1) * coreR], core);
  }
  const white = new THREE.Color(1, 1, 1);
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const yb = 0.14 + f * 0.8;
    const prof = round ? Math.sqrt(Math.max(0, 1 - Math.pow(f * 1.15 - 0.35, 2) / 0.65)) * 0.32 + 0.05 : 0.38 * Math.pow(1 - f, 0.95) + 0.05;
    const n = Math.max(3, Math.round(perTier * (0.5 + 0.5 * (1 - f))));
    const rot = rnd() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = rot + (k / n) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const r = prof * (0.8 + rnd() * 0.4);
      const ca = Math.cos(a), sa = Math.sin(a);
      const droop = (0.06 + 0.08 * rnd()) * (1 - f * 0.4);
      const w = r * 0.55;
      const b0 = [0, yb + 0.02, 0], tip = [ca * r, yb - droop, sa * r];
      const px = -sa * w * 0.5, pz = ca * w * 0.5;
      const v = 0.85 + rnd() * 0.3;
      const col = white.clone().multiplyScalar(v);
      // plan horizontal (vu du dessus : neige) et plan vertical (silhouette de côté)
      quad([b0[0] - px * 0.3, b0[1], b0[2] - pz * 0.3], [b0[0] + px * 0.3, b0[1], b0[2] + pz * 0.3],
        [tip[0] + px, tip[1], tip[2] + pz], [tip[0] - px, tip[1], tip[2] - pz],
        [0, 1], [0, 0], [1, 0], [1, 1], col);
      quad([b0[0], b0[1] - w * 0.15, b0[2]], [b0[0], b0[1] + w * 0.15, b0[2]],
        [tip[0], tip[1] + w * 0.5, tip[2]], [tip[0], tip[1] - w * 0.5, tip[2]],
        [0, 0.35], [0, 0.65], [1, 1], [1, 0], col.clone().multiplyScalar(0.85));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(foliageNormals(P, 0.85), 3));
  return g;
}

/** matériau des cartes : texture détourée, double face */
export function cardMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: branchTexture(), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, emissive: 0x050806 });
  return m;
}
