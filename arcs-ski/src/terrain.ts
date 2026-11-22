import * as THREE from 'three';
import { HeightField } from './data';

// ----------------------------------------------------------------------------
// Matériau neige : MeshStandardMaterial + shader maison (pistes damées, poudreuse,
// rochers sur les fortes pentes, forêt au loin, paillettes au soleil).
// ----------------------------------------------------------------------------

const NOISE = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
`;

/** Texture de détail répétable (RGB = normale, A = variation de teinte), générée une fois. */
let detailTex: THREE.DataTexture | null = null;
export function snowDetailTexture(): THREE.DataTexture {
  if (detailTex) return detailTex;
  const N = 512;
  const h = new Float32Array(N * N);
  const tile = (period: number, seed: number) => {
    const g = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < g.length; i++) { s = (s * 16807) % 2147483647; g[i] = s / 2147483647; }
    return (x: number, y: number) => {
      const fx = x * period, fy = y * period;
      const i = Math.floor(fx), j = Math.floor(fy);
      const u = fx - i, v = fy - j;
      const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
      const a = g[((j % period) * period + (i % period))], b = g[((j % period) * period + ((i + 1) % period))];
      const c = g[(((j + 1) % period) * period + (i % period))], d = g[(((j + 1) % period) * period + ((i + 1) % period))];
      return (a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv;
    };
  };
  const octs = [tile(4, 11), tile(8, 23), tile(16, 37), tile(32, 51), tile(64, 73), tile(128, 91)];
  const amps = [1, 0.55, 0.3, 0.17, 0.09, 0.05];
  const col = tile(6, 101), col2 = tile(24, 131);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (let k = 0; k < octs.length; k++) v += octs[k](x / N, y / N) * amps[k];
    h[y * N + x] = v;
  }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hl = h[y * N + ((x - 1 + N) % N)], hr = h[y * N + ((x + 1) % N)];
    const hd = h[((y - 1 + N) % N) * N + x], hu = h[((y + 1) % N) * N + x];
    const nx = (hl - hr) * 6, nz = (hd - hu) * 6, ny = 1;
    const l = Math.hypot(nx, ny, nz);
    const o = (y * N + x) * 4;
    data[o] = (nx / l * 0.5 + 0.5) * 255; data[o + 1] = (ny / l * 0.5 + 0.5) * 255; data[o + 2] = (nz / l * 0.5 + 0.5) * 255;
    data[o + 3] = (col(x / N, y / N) * 0.7 + col2(x / N, y / N) * 0.3) * 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  detailTex = t;
  return t;
}

export function makeSnowMaterial(kind: 'core' | 'mid' | 'far', mask: THREE.Texture | null, half: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
  const uniforms = {
    uMask: { value: mask },
    uDetail: { value: snowDetailTexture() },
    uHalf: { value: half },
    uTreeFade: { value: new THREE.Vector2(800, 1100) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
    uTime: { value: 0 },
  };
  (mat as any).snowUniforms = uniforms;
  mat.defines = { KIND_CORE: kind === 'core' ? 1 : 0, KIND_MID: kind === 'mid' ? 1 : 0, KIND_FAR: kind === 'far' ? 1 : 0 };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\nvarying float vAO;\n#if KIND_CORE\nattribute float ao;\n#endif')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);\n#if KIND_CORE\nvAO = ao;\n#else\nvAO = 1.0;\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNorm; varying float vAO;
uniform sampler2D uMask; uniform sampler2D uDetail; uniform float uHalf; uniform vec2 uTreeFade; uniform vec3 uSunDir; uniform float uTime;
${NOISE}
float gPiste; float gRock; float gForest; float gGround; float gEdge;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 uv = (vWPos.xz + uHalf) / (2.0 * uHalf);
  vec4 m = vec4(0.0);
  #if KIND_CORE || KIND_MID
    m = texture2D(uMask, uv);
  #endif
  vec3 wn = normalize(vWNorm);
  float slope = 1.0 - wn.y;
  float dist = length(cameraPosition - vWPos);
  vec4 dA = texture2D(uDetail, vWPos.xz / 41.0);
  vec4 dB = texture2D(uDetail, vWPos.xz / 337.0);
  float tint = dA.a * 0.5 + dB.a * 0.5;
  gGround = 0.0; gEdge = 0.0;
  #if KIND_CORE
    gPiste = smoothstep(0.35, 0.75, m.r);
    gEdge = smoothstep(0.12, 0.35, m.r) * (1.0 - smoothstep(0.45, 0.7, m.r));
    gForest = m.g;
  #elif KIND_MID
    gPiste = 0.0;
    gForest = smoothstep(0.25, 0.6, m.r) * (1.0 - smoothstep(2050.0, 2250.0, vWPos.y));
  #else
    gPiste = 0.0;
    gForest = smoothstep(0.55, 0.7, dB.a) * (1.0 - smoothstep(1700.0, 2000.0, vWPos.y)) * (1.0 - smoothstep(0.25, 0.45, slope));
  #endif
  #if !KIND_CORE
    // limite d'enneigement dans la vallée (plus haute sur les versants au soleil)
    float snowline = 930.0 + 260.0 * (dB.a - 0.5) + 120.0 * max(0.0, wn.z);
    gGround = (1.0 - smoothstep(snowline - 140.0, snowline + 160.0, vWPos.y)) * smoothstep(0.3, 0.7, dA.a * 0.5 + dB.a * 0.5 + 0.25);
  #endif
  // poudreuse : blanc pur légèrement bleuté, variations douces
  vec3 powder = vec3(0.94, 0.96, 1.0) * (0.95 + 0.07 * tint);
  // piste damée : plus mate et grise, bandes de dameuse (4,5 m) dans le sens de la pente + velours
  vec2 fall = normalize(wn.xz + vec2(1e-4));
  float across = dot(vWPos.xz, vec2(-fall.y, fall.x));
  float band = 0.5 + 0.5 * sin(across * 1.396 + dA.a * 2.0);
  float cord = 0.5 + 0.5 * sin(across * 40.0);
  cord = mix(cord, 0.5, smoothstep(6.0, 25.0, dist));
  vec3 groomed = vec3(0.80, 0.84, 0.91) * (0.95 + 0.06 * band + 0.06 * cord + 0.04 * tint);
  vec3 col = mix(powder, groomed, gPiste);
  // bourrelet de neige repoussée en bord de piste
  col = mix(col, vec3(1.0, 1.0, 1.02), gEdge * 0.6);
  // rochers sur les fortes pentes
  float rockN = dB.a;
  gRock = smoothstep(0.30, 0.42, slope + 0.14 * (rockN - 0.5));
  #if !KIND_CORE
    gRock = smoothstep(0.33, 0.48, slope + 0.18 * (rockN - 0.5));
  #endif
  vec3 rock = mix(vec3(0.20, 0.19, 0.18), vec3(0.44, 0.41, 0.37), dA.a);
  col = mix(col, rock, gRock * (1.0 - gPiste));
  // forêt au loin : vert sombre tacheté de neige
  float fFade = 1.0;
  #if KIND_CORE
    fFade = smoothstep(uTreeFade.x, uTreeFade.y, dist);
    col = mix(col, col * vec3(0.84, 0.89, 0.96), gForest * 0.5);
  #endif
  vec3 forestCol = mix(vec3(0.055, 0.095, 0.07), vec3(0.42, 0.47, 0.5), 0.12 + 0.25 * dB.a);
  col = mix(col, forestCol, gForest * fFade);
  // vallée sans neige : prés d'hiver et forêts de feuillus
  vec3 meadow = mix(vec3(0.20, 0.22, 0.16), vec3(0.30, 0.29, 0.22), tint);
  col = mix(col, mix(meadow, vec3(0.16, 0.18, 0.12), gForest), gGround);
  #if KIND_CORE
    col = mix(col, vec3(0.74, 0.76, 0.8), m.a * 0.5);
  #endif
  col *= mix(vec3(0.78, 0.86, 1.0), vec3(1.0), smoothstep(0.55, 1.0, vAO)) * min(vAO + 0.08, 1.06);
  diffuseColor.rgb = col;
}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= vec3(0.80, 0.91, 1.18);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(0.92, 0.62, gPiste);
roughnessFactor = mix(roughnessFactor, 0.95, max(gRock, gGround));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float d = length(cameraPosition - vWPos);
  // relief fin : texture filtrée (mipmaps) à deux échelles, plus marqué en poudreuse
  vec3 n1 = texture2D(uDetail, vWPos.xz / 9.0).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uDetail, vWPos.xz / 61.0 + 0.37).xyz * 2.0 - 1.0;
  float powderK = (1.0 - gPiste) * (1.0 - gRock) * (1.0 - gGround);
  float a1 = mix(0.25, 0.9, powderK) * (1.0 - smoothstep(40.0, 220.0, d));
  float a2 = mix(0.15, 1.3, powderK) * (1.0 - smoothstep(150.0, 900.0, d));
  vec3 pert = vec3(n1.x, 0.0, n1.z) * a1 + vec3(n2.x, 0.0, n2.z) * a2;
  // ondulations de vent (sastrugi) sur la poudreuse
  vec2 wd = normalize(vec2(0.8, 0.6));
  float rip = cos(dot(vWPos.xz, wd) * 0.85 + n2.x * 6.0);
  pert.xz += wd * rip * 0.18 * powderK * (1.0 - smoothstep(30.0, 300.0, d));
  normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float d = length(cameraPosition - vWPos);
  if (d < 24.0) {
    vec2 gp = vWPos.xz * 5.0;
    vec2 cell = floor(gp);
    float h = hash12(cell);
    vec3 cc = vec3((cell.x + 0.5) / 5.0, vWPos.y, (cell.y + 0.5) / 5.0);
    vec3 v = normalize(cameraPosition - cc);
    float tw = fract(h * 91.7 + dot(v, vec3(13.1, 7.7, 19.3)) * 2.0);
    float dot0 = 1.0 - smoothstep(0.05, 0.22, length(fract(gp) - 0.5 + (vec2(hash12(cell + 7.0), hash12(cell + 3.0)) - 0.5) * 0.4));
    float sp = step(0.985, tw) * step(0.5, h) * dot0 * (1.0 - smoothstep(4.0, 22.0, d)) * (1.0 - gRock) * max(dot(normalize(vWNorm), uSunDir), 0.0) * (1.0 - 0.6 * gPiste);
    totalEmissiveRadiance += vec3(1.0, 0.98, 0.92) * sp * 2.5;
  }
}`);
  };
  mat.customProgramCacheKey = () => 'snow2-' + kind;
  return mat;
}

// ----------------------------------------------------------------------------
// Terrain principal : 16×16 tronçons de 256 m, 3 niveaux de détail + jupes.
// ----------------------------------------------------------------------------
const LODS = [1, 2, 8]; // pas en cellules (2 m, 4 m, 16 m)
const LOD_DIST = [420, 1000];

export class CoreTerrain {
  group = new THREE.Group();
  chunks: { mesh: THREE.Mesh; cx: number; cz: number; lod: number; geos: (THREE.BufferGeometry | null)[]; center: THREE.Vector3 }[] = [];
  readonly chunkCells = 128;
  readonly nChunks: number;

  constructor(public hf: HeightField, public material: THREE.Material) {
    this.nChunks = hf.n / this.chunkCells;
    for (let cz = 0; cz < this.nChunks; cz++) {
      for (let cx = 0; cx < this.nChunks; cx++) {
        const geos: (THREE.BufferGeometry | null)[] = [null, null, null];
        geos[2] = this.build(cx, cz, 2);
        const mesh = new THREE.Mesh(geos[2], material);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        const c = this.hf.cell;
        const x = -hf.half + (cx + 0.5) * this.chunkCells * c;
        const z = -hf.half + (cz + 0.5) * this.chunkCells * c;
        const center = new THREE.Vector3(x, hf.height(x, z), z);
        this.chunks.push({ mesh, cx, cz, lod: 2, geos, center });
        this.group.add(mesh);
      }
    }
  }

  build(cx: number, cz: number, lod: number): THREE.BufferGeometry {
    const hf = this.hf;
    const step = LODS[lod];
    const n = this.chunkCells / step;          // segments
    const W = n + 3;                           // grille avec anneau de jupe
    const pos = new Float32Array(W * W * 3);
    const nor = new Float32Array(W * W * 3);
    const ao = new Float32Array(W * W);
    const c = hf.cell;
    const i0 = cx * this.chunkCells, j0 = cz * this.chunkCells;
    const nv = { x: 0, y: 1, z: 0 };
    const skirt = 6 + step * 3;
    for (let b = 0; b < W; b++) {
      for (let a = 0; a < W; a++) {
        const aa = Math.min(n, Math.max(0, a - 1));
        const bb = Math.min(n, Math.max(0, b - 1));
        const i = i0 + aa * step, j = j0 + bb * step;
        const x = -hf.half + (i + 0.5) * c;
        const z = -hf.half + (j + 0.5) * c;
        let y = hf.at(i, j);
        const edge = a === 0 || b === 0 || a === W - 1 || b === W - 1;
        if (edge) y -= skirt;
        const k = (b * W + a) * 3;
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
        hf.normal(x, z, nv, Math.max(2, step * c * 0.5));
        nor[k] = nv.x; nor[k + 1] = nv.y; nor[k + 2] = nv.z;
        // occlusion approximative : creux plus sombres, crêtes plus claires (courbure à ~16 et ~48 m)
        const h0 = hf.at(i, j);
        let lap = 0;
        for (const r of [8, 24]) {
          const m = (hf.at(i - r, j) + hf.at(i + r, j) + hf.at(i, j - r) + hf.at(i, j + r)) * 0.25 - h0;
          lap += m / (r * c) * (r === 8 ? 1.0 : 0.6);
        }
        ao[b * W + a] = Math.max(0.55, Math.min(1.08, 1 - lap * 1.6));
      }
    }
    const idx = new Uint32Array((W - 1) * (W - 1) * 6);
    let t = 0;
    for (let b = 0; b < W - 1; b++) {
      for (let a = 0; a < W - 1; a++) {
        const p00 = b * W + a, p10 = p00 + 1, p01 = p00 + W, p11 = p01 + 1;
        idx[t++] = p00; idx[t++] = p01; idx[t++] = p10;
        idx[t++] = p11; idx[t++] = p10; idx[t++] = p01;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** met à jour les niveaux de détail autour de la caméra (budget de construction par image) */
  update(cam: THREE.Vector3) {
    let budget = 2;
    const sorted = this.chunks
      .map(ch => ({ ch, d: Math.hypot(ch.center.x - cam.x, ch.center.z - cam.z) }))
      .sort((a, b) => a.d - b.d);
    for (const { ch, d } of sorted) {
      const half = this.chunkCells * this.hf.cell * 0.5;
      const dd = Math.max(0, d - half);
      const want = dd < LOD_DIST[0] ? 0 : dd < LOD_DIST[1] ? 1 : 2;
      if (want !== ch.lod) {
        if (!ch.geos[want]) {
          if (budget <= 0) continue;
          ch.geos[want] = this.build(ch.cx, ch.cz, want);
          budget--;
        }
        ch.mesh.geometry = ch.geos[want]!;
        ch.lod = want;
      }
      // libère la mémoire des niveaux fins éloignés
      if (dd > LOD_DIST[1] * 1.6 && ch.geos[0]) { ch.geos[0]!.dispose(); ch.geos[0] = null; }
    }
  }

  /** force la construction des niveaux fins autour d'un point (au chargement / téléportation) */
  warm(p: THREE.Vector3) {
    for (let k = 0; k < 40; k++) this.update(p);
  }
}

// ----------------------------------------------------------------------------
// Terrains de fond (vallée, massifs lointains)
// ----------------------------------------------------------------------------
export function makeBackdrop(hf: HeightField, segs: number, holeHalf: number, drop: number, mat: THREE.Material): THREE.Mesh {
  const W = segs + 1;
  const pos = new Float32Array(W * W * 3);
  const size = hf.half * 2;
  for (let b = 0; b < W; b++) {
    for (let a = 0; a < W; a++) {
      const x = -hf.half + (a / segs) * size;
      const z = -hf.half + (b / segs) * size;
      let y = hf.height(x, z);
      if (Math.abs(x) < holeHalf && Math.abs(z) < holeHalf) y -= drop;
      const k = (b * W + a) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
    }
  }
  const idx = new Uint32Array(segs * segs * 6);
  let t = 0;
  for (let b = 0; b < segs; b++) for (let a = 0; a < segs; a++) {
    const p00 = b * W + a, p10 = p00 + 1, p01 = p00 + W, p11 = p01 + 1;
    idx[t++] = p00; idx[t++] = p01; idx[t++] = p10; idx[t++] = p11; idx[t++] = p10; idx[t++] = p01;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = false;
  return m;
}
