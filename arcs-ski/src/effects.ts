import * as THREE from 'three';

// ------------------------------------------------------------------ ciel
export function makeSky(sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir } },
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
      uniform vec3 uSun;
      varying vec3 vDir;
      void main(){
        #include <logdepthbuf_fragment>
        vec3 d = normalize(vDir);
        float h = max(d.y, -0.05);
        vec3 zenith = vec3(0.13, 0.32, 0.72);
        vec3 horizon = vec3(0.66, 0.78, 0.92);
        vec3 col = mix(horizon, zenith, pow(smoothstep(-0.02, 0.6, h), 0.65));
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.85, 0.6) * pow(s, 8.0) * 0.25;
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
  m.renderOrder = -1;
  return m;
}

// --------------------------------------------------------- traces de skis
export class Tracks {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private alpha: Float32Array;
  private i = 0;
  private readonly N = 3000;            // segments par ski
  private last: (THREE.Vector3 | null)[] = [null, null];
  private geo: THREE.BufferGeometry;

  constructor() {
    const n = this.N * 2;
    this.pos = new Float32Array(n * 4 * 3);
    this.alpha = new Float32Array(n * 4);
    const idx = new Uint32Array(n * 6);
    for (let k = 0; k < n; k++) {
      const b = k * 4;
      idx.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], k * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float alpha; varying float vA;
        void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        varying float vA;
        void main(){
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(0.55, 0.62, 0.75, vA * 0.45); }`,
      transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  reset() { this.last = [null, null]; }

  /** ajoute un point pour chaque ski (gauche/droite) */
  add(points: THREE.Vector3[], side: THREE.Vector3, width: number, strength: number) {
    for (let s = 0; s < 2; s++) {
      const p = points[s];
      const prev = this.last[s];
      if (!prev) { this.last[s] = p.clone(); continue; }
      if (prev.distanceToSquared(p) < 0.25) continue;
      if (prev.distanceToSquared(p) > 25) { this.last[s] = p.clone(); continue; }
      const k = (this.i % (this.N * 2));
      this.i++;
      const b = k * 4 * 3;
      const w = width * 0.5;
      const lift = 0.03;
      const P = this.pos;
      P[b] = prev.x - side.x * w; P[b + 1] = prev.y + lift; P[b + 2] = prev.z - side.z * w;
      P[b + 3] = prev.x + side.x * w; P[b + 4] = prev.y + lift; P[b + 5] = prev.z + side.z * w;
      P[b + 6] = p.x - side.x * w; P[b + 7] = p.y + lift; P[b + 8] = p.z - side.z * w;
      P[b + 9] = p.x + side.x * w; P[b + 10] = p.y + lift; P[b + 11] = p.z + side.z * w;
      this.alpha.fill(strength, k * 4, k * 4 + 4);
      prev.copy(p);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ----------------------------------------------------- gerbes de neige
export class Spray {
  points: THREE.Points;
  private p: Float32Array; private v: Float32Array; private life: Float32Array; private size: Float32Array;
  private i = 0;
  private readonly N = 2500;
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
          gl_PointSize = size * uScale / -mv.z * (0.6 + 0.6 * (1.0 - life));
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        varying float vL;
        void main(){
          #include <logdepthbuf_fragment>
          vec2 c = gl_PointCoord - 0.5; float d = length(c);
          float a = smoothstep(0.5, 0.0, d) * clamp(vL, 0.0, 1.0) * 0.8;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.97, 0.98, 1.0), a); }`,
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
      this.life[i] = 0.7 + Math.random() * 0.5;
      this.size[i] = 0.12 + Math.random() * 0.25;
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
