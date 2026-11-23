// Skieur articulé : personnage CC0 (Quaternius, « Universal Base Characters ») avec squelette,
// habillé en tenue de ski (couleurs par zone d'influence des os, volume ajouté au maillage)
// et piloté chaque image par le squelette procédural de SkierModel (visée des os vers les articulations).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface SkinDims {
  thigh: number; shin: number; upper: number; fore: number;
  hipX: number; hipY: number;                // hanches par rapport au bassin
  shoulder: THREE.Vector3;                   // épaule gauche par rapport au bassin (repère skieur : +X gauche, +Z avant)
  head: THREE.Vector3;                       // centre de la tête par rapport au bassin
  ankle: number;                             // hauteur de la cheville au-dessus de la semelle
  footLen: number; footDrop: number;
  headR: number;
}

interface RestBone { q: THREE.Quaternion; p: THREE.Vector3 }
interface Asset {
  scene: THREE.Object3D;
  align: THREE.Quaternion;
  rest: Map<string, RestBone>;
  dims: SkinDims;
  curl: Map<string, THREE.Quaternion>;
}
let ASSET: Asset | null = null;
export const skinAsset = () => ASSET;

const CAT_BONES: Record<string, number> = {};   // 0 veste, 1 pantalon, 2 gant, 3 peau

/** charge et prépare le personnage (à appeler avant de créer des skieurs) */
export async function loadSkier(url: string): Promise<void> {
  // glTF JSON au tampon intégré (base64) : reconstitué en GLB en mémoire (pas de requête data:)
  const json = await (await fetch(url)).json();
  const b64 = String(json.buffers[0].uri).split(',')[1];
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  delete json.buffers[0].uri;
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (js.length % 4)) % 4, bpad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + js.length + jpad + 8 + bin.length + bpad;
  const glb = new Uint8Array(total); const dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length + jpad, true); dv.setUint32(16, 0x4e4f534a, true);
  glb.set(js, 20); glb.fill(0x20, 20 + js.length, 20 + js.length + jpad);
  let o = 20 + js.length + jpad;
  dv.setUint32(o, bin.length + bpad, true); dv.setUint32(o + 4, 0x004e4942, true); glb.set(bin, o + 8);
  js = new Uint8Array(0);
  const gltf = await new GLTFLoader().parseAsync(glb.buffer, '');
  const scene = gltf.scene;
  let mesh: THREE.SkinnedMesh | null = null;
  scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh; });
  if (!mesh) throw new Error('skier.json : pas de maillage articulé');
  const sm = mesh as THREE.SkinnedMesh;
  scene.updateMatrixWorld(true);
  const bone = (n: string) => scene.getObjectByName(n) as THREE.Bone;
  const wp = (n: string) => bone(n).getWorldPosition(new THREE.Vector3());

  // orientation : l'avant du modèle (orteils) doit être +Z, la gauche +X
  const fwd = wp('ball_l').sub(wp('foot_l')).setY(0).normalize();
  const align = new THREE.Quaternion().setFromUnitVectors(fwd, new THREE.Vector3(0, 0, 1));
  const holder = new THREE.Group(); holder.quaternion.copy(align); holder.add(scene);
  holder.updateMatrixWorld(true);
  const W = (n: string) => bone(n).getWorldPosition(new THREE.Vector3());
  // côté gauche du skieur = +X ; si les os « _l » sont à -X, on échange les rôles
  const leftSign = Math.sign(W('thigh_l').x) || 1;
  const L = (s: string) => (leftSign > 0 ? s + '_l' : s + '_r');
  const R = (s: string) => (leftSign > 0 ? s + '_r' : s + '_l');

  const rest = new Map<string, RestBone>();
  scene.traverse(o => {
    if (!(o as THREE.Bone).isBone) return;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    o.matrixWorld.decompose(p, q, s);
    rest.set(o.name, { p, q });
  });
  const P = (n: string) => rest.get(n)!.p;
  const pelvis = P('pelvis');
  const minY = new THREE.Box3().setFromObject(sm).min.y;
  const sh = P(L('upperarm')).clone().sub(pelvis);
  const headTop = new THREE.Box3().setFromObject(sm).max.y;
  const headJ = P('Head');
  const dims: SkinDims = {
    thigh: P(L('calf')).distanceTo(P(L('thigh'))),
    shin: P(L('foot')).distanceTo(P(L('calf'))),
    upper: P(L('lowerarm')).distanceTo(P(L('upperarm'))),
    fore: P(L('hand')).distanceTo(P(L('lowerarm'))),
    hipX: Math.abs(P(L('thigh')).x - pelvis.x),
    hipY: P(L('thigh')).y - pelvis.y,
    shoulder: sh,
    head: new THREE.Vector3(0, (headJ.y + headTop) / 2 - pelvis.y, headJ.z - pelvis.z + 0.02),
    ankle: P(L('foot')).y - minY,
    footLen: Math.hypot(P(L('ball')).x - P(L('foot')).x, P(L('ball')).z - P(L('foot')).z),
    footDrop: P(L('foot')).y - P(L('ball')).y,
    headR: (headTop - headJ.y) / 2 + 0.01,
  };

  // ---- habillage : catégories par os, volume ajouté le long des normales
  const g = sm.geometry;
  const bones = sm.skeleton.bones;
  const catOf = (name: string): number => {
    if (/hand|thumb|index|middle|ring|pinky/.test(name)) return 2;
    if (/Head|neck/.test(name)) return 3;
    if (/thigh|calf|foot|ball/.test(name)) return 1;
    if (name === 'pelvis' || name === 'root') return 1;
    return 0;
  };
  bones.forEach(b => { CAT_BONES[b.name] = catOf(b.name); });
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const ji = g.attributes.skinIndex as THREE.BufferAttribute;
  const jw = g.attributes.skinWeight as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 4);
  const puffA = new Float32Array(pos.count);
  // repère du maillage -> repère monde du modèle au repos (pour décider veste/pantalon selon la hauteur)
  const toW = new THREE.Matrix4().copy(sm.matrixWorld);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const hipLine = pelvis.y - 0.13;               // bas de la veste
  const chinY = headJ.y + 0.01;
  for (let i = 0; i < pos.count; i++) {
    const w = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) w[catOf(bones[ji.getComponent(i, k)].name)] += jw.getComponent(i, k);
    v.fromBufferAttribute(pos, i).applyMatrix4(toW);
    // la veste descend sur le bassin, le col remonte sur le cou
    if (v.y > hipLine && w[1] > 0) { const t = Math.min(1, (v.y - hipLine) / 0.05); w[0] += w[1] * t; w[1] *= 1 - t; }
    if (v.y < chinY && w[3] > 0) { const t = Math.min(1, (chinY - v.y) / 0.03); w[0] += w[3] * t; w[3] *= 1 - t; }
    const s = w[0] + w[1] + w[2] + w[3] || 1;
    for (let k = 0; k < 4; k++) col[i * 4 + k] = w[k] / s;
    // volume : doudoune ample, pantalon de ski, gants épais
    puffA[i] = 0.026 * col[i * 4] + 0.02 * col[i * 4 + 1] + 0.012 * col[i * 4 + 2] + (v.y < chinY + 0.02 && v.y > chinY - 0.1 ? 0.012 * col[i * 4] : 0);
  }
  clothe(g, col, puffA);
  g.setAttribute('cat', new THREE.BufferAttribute(col, 4));
  g.computeBoundingSphere();

  // ---- doigts : poing fermé (axe de flexion trouvé numériquement : le bout doit descendre vers la paume)
  const curl = new Map<string, THREE.Quaternion>();
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
  scene.traverse(o => {
    const m = /^(index|middle|ring|pinky|thumb)_0([123])_/.exec(o.name);
    if (!m || !o.children.length) return;
    const child = o.children[0];
    const base = o.quaternion.clone();
    let best: THREE.Quaternion | null = null, bestY = Infinity;
    for (const ax of axes) {
      const q = base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(ax, 0.6));
      o.quaternion.copy(q); holder.updateMatrixWorld(true);
      const y = child.getWorldPosition(v).y;
      if (y < bestY) { bestY = y; best = new THREE.Quaternion().setFromAxisAngle(ax, 1); }
    }
    o.quaternion.copy(base);
    const ang = m[1] === 'thumb' ? 0.45 : m[2] === '1' ? 1.25 : 1.35;
    curl.set(o.name, base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().set(best!.x, best!.y, best!.z).normalize(), ang)));
  });
  holder.updateMatrixWorld(true);
  holder.remove(scene);
  ASSET = { scene, align, rest, dims, curl };
  // conserve les noms gauche/droite résolus
  (ASSET as unknown as { L: typeof L; R: typeof R }).L = L;
  (ASSET as unknown as { L: typeof L; R: typeof R }).R = R;
}

/**
 * Tissu : lissage de Taubin pondéré (efface la musculature sous la veste et le pantalon),
 * puis gonflement le long des normales. Les sommets dupliqués (coutures) sont soudés par position.
 */
function clothe(g: THREE.BufferGeometry, col: Float32Array, puff: Float32Array) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const n = pos.count;
  const key = new Map<string, number>(); const weld = new Int32Array(n); let m = 0;
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    let id = key.get(k); if (id === undefined) { id = m++; key.set(k, id); }
    weld[i] = id;
  }
  const P = new Float32Array(m * 3), W = new Float32Array(m), A = new Float32Array(m);
  const cnt = new Float32Array(m);
  for (let i = 0; i < n; i++) {
    const w = weld[i];
    P[w * 3] = pos.getX(i); P[w * 3 + 1] = pos.getY(i); P[w * 3 + 2] = pos.getZ(i);
    W[w] += col[i * 4] + col[i * 4 + 1]; A[w] += puff[i]; cnt[w]++;
  }
  for (let w = 0; w < m; w++) { W[w] /= cnt[w]; A[w] /= cnt[w]; }
  const idx = g.index ? (g.index.array as ArrayLike<number>) : Array.from({ length: n }, (_, i) => i);
  const nb: Set<number>[] = Array.from({ length: m }, () => new Set<number>());
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t]], b = weld[idx[t + 1]], c = weld[idx[t + 2]];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  const adj = nb.map(s => Int32Array.from(s));
  const T = new Float32Array(m * 3);
  const pass = (lam: number) => {
    for (let w = 0; w < m; w++) {
      const l = adj[w]; let x = 0, y = 0, z = 0;
      for (const j of l) { x += P[j * 3]; y += P[j * 3 + 1]; z += P[j * 3 + 2]; }
      const k = lam * W[w] / (l.length || 1);
      T[w * 3] = P[w * 3] + (x - P[w * 3] * l.length) * k;
      T[w * 3 + 1] = P[w * 3 + 1] + (y - P[w * 3 + 1] * l.length) * k;
      T[w * 3 + 2] = P[w * 3 + 2] + (z - P[w * 3 + 2] * l.length) * k;
    }
    P.set(T);
  };
  for (let it = 0; it < 8; it++) pass(0.5);
  for (let it = 0; it < 30; it++) { pass(0.6); pass(-0.62); }
  const N = new Float32Array(m * 3);
  const normals = () => {
    N.fill(0);
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
    for (let t = 0; t < idx.length; t += 3) {
      const a = weld[idx[t]], b = weld[idx[t + 1]], c = weld[idx[t + 2]];
      e1.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
      e2.set(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]);
      fn.crossVectors(e1, e2);
      for (const v of [a, b, c]) { N[v * 3] += fn.x; N[v * 3 + 1] += fn.y; N[v * 3 + 2] += fn.z; }
    }
    for (let w = 0; w < m; w++) { const l = Math.hypot(N[w * 3], N[w * 3 + 1], N[w * 3 + 2]) || 1; N[w * 3] /= l; N[w * 3 + 1] /= l; N[w * 3 + 2] /= l; }
  };
  normals();
  // garde le sens des normales d'origine (orientation des triangles)
  let dot = 0; for (let i = 0; i < n; i += 7) { const w = weld[i]; dot += N[w * 3] * nor.getX(i) + N[w * 3 + 1] * nor.getY(i) + N[w * 3 + 2] * nor.getZ(i); }
  const sgn = dot < 0 ? -1 : 1;
  for (let w = 0; w < m; w++) for (let k = 0; k < 3; k++) P[w * 3 + k] += N[w * 3 + k] * sgn * A[w];
  normals();
  for (let i = 0; i < n; i++) {
    const w = weld[i];
    pos.setXYZ(i, P[w * 3], P[w * 3 + 1], P[w * 3 + 2]);
    // tissu : normales lissées ; peau et gants gardent les normales d'origine
    const c = col[i * 4] + col[i * 4 + 1];
    if (c > 0.5) nor.setXYZ(i, N[w * 3] * sgn, N[w * 3 + 1] * sgn, N[w * 3 + 2] * sgn);
  }
  pos.needsUpdate = true; nor.needsUpdate = true;
}

// ------------------------------------------------------------------ instance
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _bm = new THREE.Matrix4();

function frame(dir: THREE.Vector3, pole: THREE.Vector3, out: THREE.Quaternion) {
  _a.copy(dir).normalize();
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-8) _b.set(0, 0, 1).addScaledVector(_a, -_a.z);
  _b.normalize();
  _c.crossVectors(_a, _b);
  _bm.makeBasis(_a, _b, _c);
  return out.setFromRotationMatrix(_bm);
}

export interface Driver {
  root: THREE.Object3D; hips: THREE.Object3D; torso: THREE.Object3D; head: THREE.Object3D;
  arms: { upper: THREE.Object3D; lower: THREE.Object3D; pole: THREE.Object3D; wrist: THREE.Object3D }[];
  skis: THREE.Object3D[];
}

export class SkinRig {
  container = new THREE.Group();
  mesh: THREE.SkinnedMesh;
  material: THREE.MeshStandardMaterial;
  headSocket = new THREE.Group();
  private b: Record<string, THREE.Bone> = {};
  private rest: Map<string, RestBone>;
  private L: (s: string) => string;
  private R: (s: string) => string;
  private dims: SkinDims;

  constructor(colors: { jacket: number; jacket2: number; pants: number; glove: number; skin: number }) {
    const A = ASSET!;
    this.dims = A.dims; this.rest = A.rest;
    this.L = (A as unknown as { L: (s: string) => string }).L;
    this.R = (A as unknown as { R: (s: string) => string }).R;
    const sc = cloneSkinned(A.scene);
    this.container.quaternion.copy(A.align);
    this.container.add(sc);
    let mesh: THREE.SkinnedMesh | null = null;
    sc.traverse(o => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
      if ((o as THREE.Bone).isBone) this.b[o.name] = o as THREE.Bone;
    });
    this.mesh = mesh!;
    for (const [name, q] of A.curl) this.b[name]?.quaternion.copy(q);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62 });
    const u = {
      cJacket: { value: new THREE.Color(colors.jacket) }, cJacket2: { value: new THREE.Color(colors.jacket2) },
      cPants: { value: new THREE.Color(colors.pants) }, cGlove: { value: new THREE.Color(colors.glove) }, cSkin: { value: new THREE.Color(colors.skin) },
    };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 cat;\nvarying vec4 vCat;\nvarying vec3 vRest;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCat = cat; vRest = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 cJacket, cJacket2, cPants, cGlove, cSkin;
varying vec4 vCat; varying vec3 vRest;`)
        .replace('#include <color_fragment>', `
  vec3 jk = cJacket;
  // empiècement d'épaules et bande de poitrine plus sombres, fermeture éclair
  float yoke = smoothstep(0.0, 0.02, vRest.y - 1.38);
  jk = mix(jk, cJacket2, yoke);
  float band = smoothstep(0.015, 0.0, abs(vRest.y - 1.12) - 0.025);
  jk = mix(jk, cJacket2 * 0.9, band);
  float zip = smoothstep(0.012, 0.004, abs(vRest.x)) * step(0.0, vRest.z) * step(vRest.y, 1.5);
  jk = mix(jk, vec3(0.05), zip * 0.85);
  // pantalon : renfort plus sombre en bas de jambe
  vec3 pt = mix(cPants, cPants * 0.55, smoothstep(0.42, 0.36, vRest.y));
  diffuseColor.rgb *= jk * vCat.x + pt * vCat.y + cGlove * vCat.z + cSkin * vCat.w;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, vCat.y) ;');
    };
    mat.customProgramCacheKey = () => 'skier-skin';
    this.material = mat;
    this.mesh.material = mat;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    // support du casque : centre de la tête, orienté comme le skieur
    const head = this.b['Head'];
    const hr = this.rest.get('Head')!;
    const pelvisRest = this.rest.get('pelvis')!.p;
    const want = new THREE.Vector3().copy(pelvisRest).add(this.dims.head);   // repère modèle aligné
    // dans le repère de l'os : inverse(repos monde) * voulu
    this.headSocket.position.copy(want).sub(hr.p).applyQuaternion(hr.q.clone().invert());
    this.headSocket.quaternion.copy(hr.q).invert();
    head.add(this.headSocket);
  }

  /** centre de la paume (repère monde) */
  handCenter(left: boolean, out: THREE.Vector3): boolean {
    const hb = this.b[left ? this.L('hand') : this.R('hand')];
    const mid = this.b[left ? this.L('middle_01') : this.R('middle_01')];
    if (!hb) return false;
    hb.getWorldPosition(out);
    if (mid) out.lerp(mid.getWorldPosition(_a), 0.7);
    return true;
  }

  /** applique la pose du squelette pilote (repère local de d.root) */
  apply(d: Driver, lean: number) {
    const root = d.root;
    root.updateMatrixWorld(true);   // pilote + squelette, une seule fois
    _inv.copy(root.matrixWorld).invert();
    const rl = (o: THREE.Object3D, q?: THREE.Quaternion, p?: THREE.Vector3) => {
      _m.multiplyMatrices(_inv, o.matrixWorld).decompose(p ?? _p, q ?? _q, _s);
    };
    const b = this.b, rest = this.rest, L = this.L, R = this.R;
    const qHips = new THREE.Quaternion(), qTorso = new THREE.Quaternion(), qHead = new THREE.Quaternion();
    const pHips = new THREE.Vector3();
    rl(d.hips, qHips, pHips); rl(d.torso, qTorso); rl(d.head, qHead);

    const setQ = (name: string, qd: THREE.Quaternion) => {
      const bone = b[name]; if (!bone) return;
      const parent = bone.parent!;
      // seule la chaîne des parents est mise à jour (pas tout le sous-arbre) : beaucoup moins de calcul
      parent.updateWorldMatrix(true, false);
      _m.multiplyMatrices(_inv, parent.matrixWorld).decompose(_p, _q2, _s);
      bone.quaternion.copy(_q2.invert().multiply(qd));
    };
    const restQ = (name: string) => rest.get(name)!.q;
    const jointRL = (name: string, out: THREE.Vector3) => { b[name].updateWorldMatrix(true, false); _m.multiplyMatrices(_inv, b[name].matrixWorld); return out.setFromMatrixPosition(_m); };
    const aim = (name: string, child: string, target: THREE.Vector3, restPole: THREE.Vector3, pole: THREE.Vector3) => {
      const r = rest.get(name)!, rc = rest.get(child)!;
      const fr = frame(_c.copy(rc.p).sub(r.p), restPole, new THREE.Quaternion());
      const from = jointRL(name, new THREE.Vector3());
      const ft = frame(new THREE.Vector3().subVectors(target, from), pole, new THREE.Quaternion());
      setQ(name, ft.multiply(fr.invert()).multiply(restQ(name)));
    };

    // bassin : position et orientation
    const pelvis = b['pelvis'];
    {
      const parent = pelvis.parent!;
      parent.updateWorldMatrix(true, false);
      _m.multiplyMatrices(_inv, parent.matrixWorld).invert();
      pelvis.position.copy(pHips).applyMatrix4(_m);
      setQ('pelvis', _q.copy(qHips).multiply(restQ('pelvis')));
    }
    const sl = (w: number) => new THREE.Quaternion().slerpQuaternions(qHips, qTorso, w);
    setQ('spine_01', sl(0.4).multiply(restQ('spine_01')));
    setQ('spine_02', sl(0.75).multiply(restQ('spine_02')));
    setQ('spine_03', sl(1).multiply(restQ('spine_03')));
    setQ('neck_01', new THREE.Quaternion().slerpQuaternions(qTorso, qHead, 0.5).multiply(restQ('neck_01')));
    setQ('Head', qHead.clone().multiply(restQ('Head')));

    // bras : visée coude puis poignet du pilote
    const BACK = new THREE.Vector3(0, 0, -1), FWD = new THREE.Vector3(0, 0, 1);
    const tmp = new THREE.Vector3(), pole = new THREE.Vector3(), qq = new THREE.Quaternion();
    d.arms.forEach((arm, i) => {
      const side = i === 1 ? L : R;           // bras 1 = gauche (+X)
      rl(arm.lower, qq, tmp);
      rl(arm.upper, _q2);
      pole.copy(BACK).applyQuaternion(_q2);
      aim(side('upperarm'), side('lowerarm'), tmp.clone(), BACK, pole.clone());
      rl(arm.wrist, undefined, tmp);
      pole.copy(FWD).applyQuaternion(qq);
      aim(side('lowerarm'), side('hand'), tmp.clone(), FWD, pole.clone());
    });

    // jambes : IK à deux os vers la chaussure fixée sur le ski
    const dm = this.dims;
    const UP = new THREE.Vector3(0, 1, 0);
    d.skis.forEach((ski, i) => {
      const side = i === 1 ? L : R;           // ski 1 = gauche
      const qs = new THREE.Quaternion(), ps = new THREE.Vector3();
      rl(ski, qs, ps);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(qs);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(qs);
      const ankle = new THREE.Vector3(0, dm.ankle + 0.075, -0.045).applyQuaternion(qs).add(ps);
      const hip = jointRL(side('thigh'), new THREE.Vector3());
      const lt = dm.thigh, ls = dm.shin;
      const dv = new THREE.Vector3().subVectors(ankle, hip);
      let dist = dv.length();
      dist = Math.min(dist, (lt + ls) * 0.999);
      dv.normalize();
      // genou : vers l'avant du ski, rentré vers l'intérieur du virage
      const kp = fwd.clone().addScaledVector(new THREE.Vector3(1, 0, 0), -lean * 0.5).addScaledVector(dv, -fwd.dot(dv)).normalize();
      const ca = (lt * lt + dist * dist - ls * ls) / (2 * lt * dist);
      const along = lt * Math.max(-1, Math.min(1, ca));
      const hgt = Math.sqrt(Math.max(0, lt * lt - along * along));
      const knee = hip.clone().addScaledVector(dv, along).addScaledVector(kp, hgt);
      const ankleT = hip.clone().addScaledVector(dv, dist);
      aim(side('thigh'), side('calf'), knee, FWD, kp);
      aim(side('calf'), side('foot'), ankleT, FWD, kp);
      const toe = ankleT.clone().addScaledVector(fwd, dm.footLen).addScaledVector(up, -dm.footDrop);
      aim(side('foot'), side('ball'), toe, UP, up);
    });
  }
}
