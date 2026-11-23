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
    uGroom: { value: null as THREE.Texture | null },
    uNormTex: { value: null as THREE.Texture | null },
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
uniform sampler2D uMask; uniform sampler2D uDetail; uniform sampler2D uGroom; uniform sampler2D uNormTex; uniform float uHalf; uniform vec2 uTreeFade; uniform vec3 uSunDir; uniform float uTime;
${NOISE}
float gPiste; float gRock; float gForest; float gGround; float gEdge; vec3 gWN; float gAcross; vec2 gDir; float gCordF; float gBandF; float gPack;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 uv = (vWPos.xz + uHalf) / (2.0 * uHalf);
  vec4 m = vec4(0.0);
  #if KIND_CORE || KIND_MID
    m = texture2D(uMask, uv);
  #endif
  vec3 wn = normalize(vWNorm);
  #if !KIND_CORE
    // relief lointain : normales issues du MNT à pleine résolution + ravines procédurales
    wn = normalize(texture2D(uNormTex, uv).xyz * 2.0 - 1.0);
    {
      float st = smoothstep(0.08, 0.35, 1.0 - wn.y);
      vec3 g1 = texture2D(uDetail, vWPos.xz / 900.0).xyz * 2.0 - 1.0;
      vec3 g2 = texture2D(uDetail, vWPos.xz / 2600.0 + 0.21).xyz * 2.0 - 1.0;
      wn = normalize(wn + vec3(g1.x, 0.0, g1.z) * (0.25 + 0.9 * st) + vec3(g2.x, 0.0, g2.z) * (0.2 + 0.5 * st));
    }
  #endif
  gWN = wn;
  float slope = 1.0 - wn.y;
  float dist = length(cameraPosition - vWPos);
  vec4 dA = texture2D(uDetail, vWPos.xz / 41.0);
  // variations basse fréquence non répétitives (bruit procédural, 2 octaves seulement)
  float low = vnoise(vWPos.xz / 610.0) * 0.6 + vnoise(mat2(0.8, -0.6, 0.6, 0.8) * vWPos.xz / 217.0) * 0.4;
  vec4 dB = vec4(0.0, 0.0, 0.0, low);
  float tint = dA.a * 0.4 + low * 0.6;
  gGround = 0.0; gEdge = 0.0;
  gPack = 0.0;
  #if KIND_CORE
    gPiste = smoothstep(0.35, 0.75, m.r);
    gEdge = smoothstep(0.1, 0.22, m.r) * (1.0 - smoothstep(0.26, 0.38, m.r));     // bourrelet de poudreuse
    gPack = smoothstep(0.38, 0.5, m.r) * (1.0 - smoothstep(0.55, 0.72, m.r));     // bande tassée en bord de piste
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
    gGround = (1.0 - smoothstep(snowline - 140.0, snowline + 160.0, vWPos.y)) * smoothstep(0.25, 0.6, dB.a + vnoise(vWPos.xz / 90.0) * 0.3);
  #endif
  // poudreuse : blanc pur légèrement bleuté, variations douces
  vec3 powder = vec3(0.96, 0.975, 1.0) * (0.96 + 0.05 * tint);
  // piste damée : plus mate et grise, bandes de dameuse (4,5 m) dans le sens de la pente + velours
  vec2 fall = normalize(wn.xz + vec2(1e-4));
  float across = dot(vWPos.xz, vec2(-fall.y, fall.x));
  #if KIND_CORE
    // bandes parallèles à l'axe de la piste (distance signée à la ligne OSM, calculée au chargement)
    vec4 gt = texture2D(uGroom, uv);
    across = mix(across, gt.r, step(0.5, gt.g));
    gDir = mix(vec2(-fall.y, fall.x), normalize(gt.ba + vec2(1e-5)), step(0.5, gt.g));
  #else
    gDir = vec2(-fall.y, fall.x);
  #endif
  gAcross = across;
  float band = 0.5 + 0.5 * sin(across * 1.396 + dA.a * 2.0);
  // velours filtré : s'efface quand les stries deviennent plus fines qu'un pixel (pas de moiré)
  float cw = fwidth(across * 40.0 / 6.2832);
  float cord = mix(0.5 + 0.5 * sin(across * 40.0), 0.5, smoothstep(0.25, 0.7, cw));
  float bw = fwidth(across * 1.396 / 6.2832);
  band = mix(band, 0.5, smoothstep(0.3, 0.8, bw));
  gCordF = 1.0 - smoothstep(0.25, 0.7, cw); gBandF = 1.0 - smoothstep(0.3, 0.8, bw);
  // damé presque aussi blanc que la poudreuse : le velours se lit dans le relief (normales), pas dans la couleur
  vec3 groomed = vec3(0.86, 0.9, 0.97) * (0.97 + 0.03 * band + 0.025 * cord + 0.03 * tint);
  vec3 col = mix(powder, groomed, gPiste);
  col = mix(col, groomed * vec3(0.9, 0.92, 0.96), gPack * 0.8);
  col = mix(col, vec3(1.02, 1.03, 1.05), gEdge * 0.85);
  // rochers sur les fortes pentes
  float rockN = dB.a;
  gRock = smoothstep(0.30, 0.42, slope + 0.14 * (rockN - 0.5));
  #if !KIND_CORE
    gRock = smoothstep(0.2, 0.34, slope + 0.16 * (rockN - 0.5) + 0.08 * (vnoise(vWPos.xz / 160.0) - 0.5));
  #endif
  // roche en projection triplanaire (pas d'étirement sur les falaises)
  vec3 bw3 = pow(abs(wn), vec3(4.0)); bw3 /= (bw3.x + bw3.y + bw3.z);
  #if KIND_CORE
    float rx = texture2D(uDetail, vWPos.zy / 23.0).a, ry = dA.a, rz = texture2D(uDetail, vWPos.xy / 23.0).a;
    float rt = rx * bw3.x + ry * bw3.y + rz * bw3.z;
  #else
    float rt = dA.a;      // au loin : une seule projection suffit
  #endif
  float strata = 0.5 + 0.5 * sin(vWPos.y * 0.9 + rt * 5.0);
  vec3 rock = mix(vec3(0.17, 0.16, 0.15), vec3(0.47, 0.44, 0.40), rt * 0.75 + strata * 0.25);
  col = mix(col, rock, gRock * (1.0 - gPiste));
  // forêt au loin : vert sombre tacheté de neige
  float fFade = 1.0;
  #if KIND_CORE
    fFade = smoothstep(uTreeFade.x, uTreeFade.y, dist);
    col = mix(col, col * vec3(0.84, 0.89, 0.96), gForest * 0.5);
  #endif
  vec3 forestCol = mix(vec3(0.055, 0.095, 0.07), vec3(0.42, 0.47, 0.5), 0.12 + 0.25 * dB.a);
  #if !KIND_CORE
  {
    // forêt lointaine : houppiers et clairières enneigées, lisières irrégulières (pas d'aplats)
    float canopy = texture2D(uDetail, vWPos.xz / 47.0).a * 0.55 + texture2D(uDetail, vWPos.xz / 11.0).a * 0.45;
    float edge = vnoise(vWPos.xz / 130.0);
    gForest *= smoothstep(0.32, 0.6, canopy * 0.8 + gForest * 0.45 + (edge - 0.5) * 0.35);
    forestCol = mix(vec3(0.05, 0.085, 0.065), vec3(0.5, 0.55, 0.6), smoothstep(0.55, 0.8, canopy) * 0.45);
  }
  #endif
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
roughnessFactor = mix(0.93, 0.5, gPiste);
roughnessFactor = mix(roughnessFactor, 0.95, max(gRock, gGround));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#if !KIND_CORE
  normal = normalize((viewMatrix * vec4(gWN, 0.0)).xyz);
#else
{
  float d = length(cameraPosition - vWPos);
  // relief fin : texture filtrée (mipmaps) à deux échelles, plus marqué en poudreuse
  vec3 n1 = texture2D(uDetail, vWPos.xz / 9.0).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uDetail, vWPos.xz / 61.0 + 0.37).xyz * 2.0 - 1.0;
  float powderK = (1.0 - gPiste) * (1.0 - gRock) * (1.0 - gGround) + gEdge * 0.5;
  float a1 = mix(0.25, 0.9, powderK) * (1.0 - smoothstep(40.0, 220.0, d));
  float a2 = mix(0.15, 1.3, powderK) * (1.0 - smoothstep(150.0, 900.0, d));
  vec3 pert = vec3(n1.x, 0.0, n1.z) * a1 + vec3(n2.x, 0.0, n2.z) * a2;
  // ondulations de vent (sastrugi) sur la poudreuse
  vec2 wd = normalize(vec2(0.8, 0.6));
  float rph = dot(vWPos.xz, wd) * 0.85 + n2.x * 6.0;
  float rip = cos(rph) * (1.0 - smoothstep(0.2, 0.6, fwidth(rph / 6.2832)));
  pert.xz += wd * rip * 0.18 * powderK * (1.0 - smoothstep(30.0, 300.0, d));
  // velours de dameuse et bandes en relief : la lumière rasante dessine les stries
  float cordH = cos(gAcross * 40.0) * 0.13 * gCordF * (1.0 - smoothstep(12.0, 70.0, d)) + cos(gAcross * 1.396) * 0.06 * gBandF * (1.0 - smoothstep(60.0, 220.0, d));
  pert.xz += gDir * cordH * gPiste * (1.0 - gPack * 0.6) * (0.8 + 0.4 * n2.y);
  normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz);
}
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#if KIND_CORE
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
}
#endif`);
  };
  mat.customProgramCacheKey = () => 'snow5-' + kind;
  return mat;
}

// ----------------------------------------------------------------------------
// Terrain principal : 16×16 tronçons de 256 m, 3 niveaux de détail + jupes.
// ----------------------------------------------------------------------------
const LODS = [1, 2, 8]; // pas en cellules (2 m, 4 m, 16 m)


export class CoreTerrain {
  group = new THREE.Group();
  chunks: { mesh: THREE.Mesh; cx: number; cz: number; lod: number; geos: (THREE.BufferGeometry | null)[]; center: THREE.Vector3 }[] = [];
  readonly chunkCells = 128;
  /** distances de passage aux niveaux 4 m et 16 m (réglées par la qualité graphique) */
  lodDist = [420, 1000];
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
      const want = dd < this.lodDist[0] ? 0 : dd < this.lodDist[1] ? 1 : 2;
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
      if (dd > this.lodDist[1] * 1.6 && ch.geos[0]) { ch.geos[0]!.dispose(); ch.geos[0] = null; }
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
export function makeBackdrop(hf: HeightField, segs: number, holeHalf: number, drop: number, mat: THREE.Material, tiles = 8): THREE.Group {
  // découpé en tuiles : celles hors du champ de vision ne sont pas dessinées
  const group = new THREE.Group();
  const size = hf.half * 2;
  const ts = segs / tiles;
  for (let ty = 0; ty < tiles; ty++) for (let tx = 0; tx < tiles; tx++) {
    const W = ts + 1;
    const pos = new Float32Array(W * W * 3);
    let allHole = true;
    for (let b = 0; b < W; b++) for (let a = 0; a < W; a++) {
      const x = -hf.half + ((tx * ts + a) / segs) * size;
      const z = -hf.half + ((ty * ts + b) / segs) * size;
      let y = hf.height(x, z);
      if (Math.abs(x) < holeHalf && Math.abs(z) < holeHalf) y -= drop; else allHole = false;
      const k = (b * W + a) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
    }
    if (allHole) continue;     // entièrement recouverte par le terrain plus fin
    const idx = new Uint32Array(ts * ts * 6);
    let t = 0;
    for (let b = 0; b < ts; b++) for (let a = 0; a < ts; a++) {
      const p00 = b * W + a, p10 = p00 + 1, p01 = p00 + W, p11 = p01 + 1;
      idx[t++] = p00; idx[t++] = p01; idx[t++] = p10; idx[t++] = p11; idx[t++] = p10; idx[t++] = p01;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = false; m.matrixAutoUpdate = false;
    group.add(m);
  }
  return group;
}

// ----------------------------------------------------------------------------
// Textures préparées au chargement
// ----------------------------------------------------------------------------
/** normales du champ de hauteur (relief des terrains de fond, indépendant de la finesse du maillage) */
export function makeNormalTexture(hf: HeightField): THREE.DataTexture {
  const N = hf.n, c = hf.cell;
  const d = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const dx = (hf.at(i - 1, j) - hf.at(i + 1, j)) / (2 * c), dz = (hf.at(i, j - 1) - hf.at(i, j + 1)) / (2 * c);
    const l = Math.hypot(dx, 1, dz);
    const o = (j * N + i) * 4;
    d[o] = (dx / l * 0.5 + 0.5) * 255; d[o + 1] = (1 / l * 0.5 + 0.5) * 255; d[o + 2] = (dz / l * 0.5 + 0.5) * 255; d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

/**
 * Bandes de dameuse : distance signée (m) à l'axe de la piste la plus proche (R) et validité (G).
 * Les lignes OSM sont d'abord adoucies (Chaikin) pour éviter les coutures aux angles.
 */
export function makeGroomTexture(pistes: { pts: [number, number][]; area: boolean; diff: string }[], half: number, N = 1024): THREE.DataTexture {
  const d = new Float32Array(N * N * 4);
  const best = new Float32Array(N * N).fill(1e9);
  const cell = (2 * half) / N, R = 42;
  for (const p of pistes) {
    if (p.area || p.diff === 'freeride' || p.pts.length < 2) continue;
    let pts = p.pts.map(q => [q[0], q[1]] as [number, number]);
    for (let it = 0; it < 3; it++) {
      const o: [number, number][] = [pts[0]];
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      o.push(pts[pts.length - 1]);
      pts = o;
    }
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
      if (L2 < 1e-6) continue;
      const L = Math.sqrt(L2);
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + half) / cell)), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + R + half) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R + half) / cell)), j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + R + half) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2));
        const px = ax + ex * t - x, pz = az + ez * t - z;
        const dist = Math.hypot(px, pz);
        if (dist > R || dist >= best[j * N + i]) continue;
        best[j * N + i] = dist;
        const signed = ((x - ax) * ez - (z - az) * ex) / L;    // distance à la droite, signée
        const o = (j * N + i) * 4;
        d[o] = signed; d[o + 1] = 1; d[o + 2] = ez / L; d[o + 3] = -ex / L;
      }
    }
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.FloatType);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
