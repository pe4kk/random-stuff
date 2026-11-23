import * as THREE from 'three';

// ------------------------------------------------------------------ ciel
export function makeSky(sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSun; uniform float uTime;
      varying vec3 vDir;
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
      float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vn(p); p = p*2.1 + 13.7; a *= 0.5; } return s; }
      void main(){
        #include <logdepthbuf_fragment>
        vec3 d = normalize(vDir);
        float h = max(d.y, -0.05);
        vec3 zenith = vec3(0.12, 0.30, 0.70);
        vec3 horizon = vec3(0.68, 0.79, 0.92);
        vec3 col = mix(horizon, zenith, pow(smoothstep(-0.02, 0.6, h), 0.6));
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.85, 0.6) * pow(s, 8.0) * 0.22;
        // nuages : couche plane à haute altitude
        if (d.y > 0.02) {
          vec2 uv = d.xz / (d.y + 0.08) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
          float c = fbm(uv * 1.2);
          float cover = smoothstep(0.52, 0.78, c + 0.06 * fbm(uv * 6.0));
          float lit = 0.75 + 0.25 * pow(s, 3.0) + 0.15 * fbm(uv * 3.0 + 4.0);
          vec3 cc = mix(vec3(0.82, 0.86, 0.92), vec3(1.0, 0.98, 0.95), lit - 0.5);
          col = mix(col, cc, cover * smoothstep(0.02, 0.25, d.y) * 0.9);
        }
        col += vec3(1.0, 0.95, 0.85) * pow(s, 400.0) * 6.0;
        col += vec3(1.0, 0.98, 0.9) * smoothstep(0.9995, 0.99975, s) * 20.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(150000, 32, 16), mat);
  m.frustumCulled = false;
  // dessiné après le relief : seuls les pixels de ciel réellement visibles sont calculés
  m.renderOrder = 1000;
  return m;
}

// --------------------------------------------------------- traces de skis
/** Sillons dans la neige : bande ombrée d'un côté, bourrelet clair de l'autre. */
export class Tracks {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private alpha: Float32Array;
  private side: Float32Array;
  private i = 0;
  private last: (THREE.Vector3 | null)[] = [];
  private edge: (number[] | null)[] = [];
  private geo: THREE.BufferGeometry;

  constructor(private N = 12000, private minStep = 0.6) {
    this.pos = new Float32Array(N * 4 * 3);
    this.alpha = new Float32Array(N * 4);
    this.side = new Float32Array(N * 4 * 2);
    const across = new Float32Array(N * 4);
    const idx = new Uint32Array(N * 6);
    for (let k = 0; k < N; k++) {
      const b = k * 4;
      idx.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], k * 6);
      across.set([-1, 1, -1, 1], b);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('across', new THREE.BufferAttribute(across, 1));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    // sillon en relief : profil creusé (fond tassé, parois, bourrelet) éclairé selon le soleil.
    // Fusion : couleur = reflet ajouté + neige existante × ombrage (assombrit ET éclaircit, sans éclairage réel)
    this.geo.setAttribute('sideV', new THREE.BufferAttribute(this.side, 2).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() } },
      vertexShader: `attribute float alpha; attribute float across; attribute vec2 sideV;
        varying float vA; varying float vX; varying float vD; varying vec2 vS;
        void main(){ vA = alpha; vX = across; vS = sideV; vec4 mv = modelViewMatrix * vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uSun;
        varying float vA; varying float vX; varying float vD; varying vec2 vS;
        void main(){
          float x = vX, ax = abs(x), sx = sign(x);
          float k = vA * (1.0 - smoothstep(120.0, 420.0, vD));
          // pente du profil : parois montantes vers l'extérieur, bourrelet qui redescend
          float wall = smoothstep(0.12, 0.55, ax) * (1.0 - smoothstep(0.6, 0.85, ax));
          float rim = smoothstep(0.8, 0.92, ax) * (1.0 - smoothstep(0.94, 1.0, ax));
          float dz = sx * (wall * 0.75 - rim * 0.5);
          vec3 n = normalize(vec3(-vS.x * dz, 1.0, -vS.y * dz));
          float sunY = max(uSun.y, 0.25);
          float shade = max(dot(n, uSun), 0.0) / sunY;
          float bottom = 1.0 - smoothstep(0.15, 0.5, ax);
          float mul = clamp(mix(1.0, shade, 0.75), 0.6, 1.0) * (1.0 - 0.08 * bottom);     // fond tassé un peu plus mat ; ombre bleutée douce
          float add = max(shade - 1.0, 0.0) * 0.18;
          mul = mix(1.0, mul, k); add *= k;
          gl_FragColor = vec4(vec3(add) * vec3(0.95, 0.97, 1.0), mul);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  setSun(d: THREE.Vector3) { ((this.mesh.material as THREE.ShaderMaterial).uniforms.uSun.value as THREE.Vector3).copy(d).normalize(); }

  reset() { this.last = []; this.edge = []; }

  clear() {
    this.alpha.fill(0); this.i = 0; this.last = []; this.edge = []; this.geo.setDrawRange(0, 0);
    const aa = this.geo.attributes.alpha as THREE.BufferAttribute;
    aa.clearUpdateRanges(); aa.needsUpdate = true;
  }

  /** ajoute un point pour chaque trace (deux skis, ou plus) ; key permet plusieurs skieurs */
  add(points: THREE.Vector3[], side: THREE.Vector3, width: number, strength: number, key = 0, update = true) {
    for (let s = 0; s < points.length; s++) {
      const slot = key * 2 + s;
      const p = points[s];
      const prev = this.last[slot];
      if (!prev) { this.last[slot] = p.clone(); this.edge[slot] = null; continue; }
      const d2 = prev.distanceToSquared(p);
      if (d2 < this.minStep * this.minStep) continue;
      if (d2 > 36) { this.last[slot] = p.clone(); this.edge[slot] = null; continue; }
      const k = this.i % this.N;
      this.i++;
      const b = k * 12;
      const w = width * 0.5;
      const lift = 0.025;
      const P = this.pos;
      // le segment repart exactement du bord du précédent : ruban continu, pas de marches dans les virages
      const e = this.edge[slot];
      if (e) { P[b] = e[0]; P[b + 1] = e[1]; P[b + 2] = e[2]; P[b + 3] = e[3]; P[b + 4] = e[4]; P[b + 5] = e[5]; }
      else {
        P[b] = prev.x - side.x * w; P[b + 1] = prev.y + lift; P[b + 2] = prev.z - side.z * w;
        P[b + 3] = prev.x + side.x * w; P[b + 4] = prev.y + lift; P[b + 5] = prev.z + side.z * w;
      }
      P[b + 6] = p.x - side.x * w; P[b + 7] = p.y + lift; P[b + 8] = p.z - side.z * w;
      P[b + 9] = p.x + side.x * w; P[b + 10] = p.y + lift; P[b + 11] = p.z + side.z * w;
      this.edge[slot] = [P[b + 6], P[b + 7], P[b + 8], P[b + 9], P[b + 10], P[b + 11]];
      this.alpha.fill(strength, k * 4, k * 4 + 4);
      const sl = Math.hypot(side.x, side.z) || 1;
      for (let v = 0; v < 4; v++) { this.side[k * 8 + v * 2] = side.x / sl; this.side[k * 8 + v * 2 + 1] = side.z / sl; }
      prev.copy(p);
      this.dirtyLo = Math.min(this.dirtyLo, k); this.dirtyHi = Math.max(this.dirtyHi, k);
    }
    if (update) this.flush();
    this.geo.setDrawRange(0, Math.min(this.i, this.N) * 6);   // ne dessine que les segments utilisés
  }

  private dirtyLo = Infinity; private dirtyHi = -1;
  /** envoie à la carte graphique uniquement les segments modifiés */
  flush() {
    if (this.dirtyHi < 0) return;
    const pa = this.geo.attributes.position as THREE.BufferAttribute, aa = this.geo.attributes.alpha as THREE.BufferAttribute;
    pa.clearUpdateRanges(); aa.clearUpdateRanges();
    pa.addUpdateRange(this.dirtyLo * 12, (this.dirtyHi - this.dirtyLo + 1) * 12);
    const sa = this.geo.attributes.sideV as THREE.BufferAttribute;
    sa.clearUpdateRanges(); sa.addUpdateRange(this.dirtyLo * 8, (this.dirtyHi - this.dirtyLo + 1) * 8); sa.needsUpdate = true;
    aa.addUpdateRange(this.dirtyLo * 4, (this.dirtyHi - this.dirtyLo + 1) * 4);
    pa.needsUpdate = true; aa.needsUpdate = true;
    this.dirtyLo = Infinity; this.dirtyHi = -1;
  }
}

// ----------------------------------------------------- gerbes de neige
export class Spray {
  points: THREE.Points;
  private p: Float32Array; private v: Float32Array; private life: Float32Array; private size: Float32Array;
  private i = 0;
  private readonly N = 4000;
  constructor() {
    this.p = new Float32Array(this.N * 3); this.v = new Float32Array(this.N * 3);
    this.life = new Float32Array(this.N); this.size = new Float32Array(this.N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float life; attribute float size; varying float vL; uniform float uScale;
        void main(){ vL = life; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * uScale / -mv.z * (0.6 + 0.8 * (1.0 - life));
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        varying float vL;
        void main(){
          #include <logdepthbuf_fragment>
          vec2 c = gl_PointCoord - 0.5; float d = length(c);
          float a = smoothstep(0.5, 0.1, d) * clamp(vL, 0.0, 1.0) * 0.7;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(1.9, 1.95, 2.05), a); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }
  emit(at: THREE.Vector3, vel: THREE.Vector3, n: number, spread: number, up: number) {
    for (let k = 0; k < n; k++) {
      const i = this.i++ % this.N;
      this.p[i * 3] = at.x + (Math.random() - 0.5) * 0.4;
      this.p[i * 3 + 1] = at.y + 0.05;
      this.p[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.4;
      this.v[i * 3] = vel.x * 0.5 + (Math.random() - 0.5) * spread;
      this.v[i * 3 + 1] = up * (0.5 + Math.random());
      this.v[i * 3 + 2] = vel.z * 0.5 + (Math.random() - 0.5) * spread;
      this.life[i] = 0.7 + Math.random() * 0.6;
      this.size[i] = 0.06 + Math.random() * 0.16;
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 1.1;
      this.v[i * 3 + 1] -= 6 * dt;
      const damp = Math.exp(-dt * 2.2);
      this.v[i * 3] *= damp; this.v[i * 3 + 2] *= damp;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.life as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }
}
