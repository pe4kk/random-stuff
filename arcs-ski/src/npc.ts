import * as THREE from 'three';
import { HeightField, MaskField, Piste } from './data';
import { Forest } from './trees';
import { Skier, SkierModel } from './skier';
import { Tracks } from './effects';
import { LiftRuntime } from './world';

export type Route = { pts: [number, number][]; len: number; name: string };

/** Construit des itinéraires de descente en enchaînant les tronçons de pistes OSM. */
export function buildRoutes(pistes: Piste[], lifts: LiftRuntime[], hf: HeightField, prefer = 'Mont-Blanc', seed = 7): Route[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // tronçons orientés vers l'aval
  const ways = pistes.filter(p => !p.area && p.pts.length >= 2 && p.diff !== 'freeride').map(p => {
    let pts = p.pts.slice();
    const h0 = hf.height(pts[0][0], pts[0][1]), h1 = hf.height(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    if (h1 > h0 + 2) pts = pts.reverse();
    return { pts, name: p.name, diff: p.diff };
  });
  const routes: Route[] = [];
  const starts = lifts.filter(l => hf.inside(l.top.x, l.top.z, 80));
  for (const l of starts) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const out: [number, number][] = [];
      let cur: [number, number] = [l.top.x, l.top.z];
      let curH = l.top.y + 5;
      const used = new Set<number>();
      let name = '';
      for (let step = 0; step < 14; step++) {
        // candidats : un sommet de tronçon proche, d'où la suite descend
        const cands: { w: number; i: number }[] = [];
        ways.forEach((w, wi) => {
          if (used.has(wi)) return;
          for (let i = 0; i < w.pts.length - 1; i++) {
            const d = Math.hypot(w.pts[i][0] - cur[0], w.pts[i][1] - cur[1]);
            if (d < (step === 0 ? 110 : 28)) {
              const hEnd = hf.height(w.pts[w.pts.length - 1][0], w.pts[w.pts.length - 1][1]);
              if (hEnd < curH - 5) { cands.push({ w: wi, i }); break; }
            }
          }
        });
        if (!cands.length) break;
        // on reste de préférence sur la même piste (ou sur la piste favorite au départ)
        const wanted = step === 0 ? (attempt < 3 ? prefer : '') : (rnd() < 0.85 ? name : '');
        const same = wanted ? cands.filter(c => ways[c.w].name === wanted) : [];
        const pool = same.length ? same : cands;
        const c = pool[Math.floor(rnd() * pool.length)];
        used.add(c.w);
        const w = ways[c.w];
        if (!name && w.name) name = w.name;
        for (let i = c.i; i < w.pts.length; i++) out.push(w.pts[i]);
        cur = w.pts[w.pts.length - 1];
        curH = hf.height(cur[0], cur[1]);
        if (!hf.inside(cur[0], cur[1], 60)) break;
      }
      if (out.length < 2) continue;
      // rééchantillonnage tous les 4 m
      const res: [number, number][] = [out[0]];
      for (let i = 1; i < out.length; i++) {
        const a = res[res.length - 1], b = out[i];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.floor(d / 4);
        for (let k = 1; k <= n; k++) res.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
      }
      let len = 0;
      for (let i = 1; i < res.length; i++) len += Math.hypot(res[i][0] - res[i - 1][0], res[i][1] - res[i - 1][1]);
      if (len > 350 && res.every(p => hf.inside(p[0], p[1], 50))) routes.push({ pts: res, len, name });
    }
  }
  return routes;
}

/** Pilote automatique : suit l'itinéraire en faisant des virages en S. */
class Pilot {
  idx = 0;
  t = 0;
  amp: number; wave: number; vmax: number; phase: number;
  constructor(public route: Route, rnd: () => number, startFrac = 0) {
    this.amp = 4 + rnd() * 7;
    this.wave = 22 + rnd() * 22;
    this.vmax = 7 + rnd() * 9;
    this.phase = rnd() * 6.28;
    this.idx = Math.floor(startFrac * (route.pts.length - 2));
  }
  steer(sk: Skier): { steer: number; brake: number; tuck: number; push: number; done: boolean } {
    const P = this.route.pts;
    while (this.idx < P.length - 2 && Math.hypot(P[this.idx][0] - sk.pos.x, P[this.idx][1] - sk.pos.z) < 7 + sk.speed * 0.5) this.idx++;
    const a = P[this.idx], b = P[Math.min(P.length - 1, this.idx + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const off = Math.sin(this.idx * 4 / this.wave * Math.PI + this.phase) * this.amp;
    const tx = a[0] - dz / l * off, tz = a[1] + dx / l * off;
    const want = Math.atan2(tx - sk.pos.x, tz - sk.pos.z);
    let e = want - sk.yaw; e = Math.atan2(Math.sin(e), Math.cos(e));
    const done = this.idx >= P.length - 2 && Math.hypot(P[P.length - 1][0] - sk.pos.x, P[P.length - 1][1] - sk.pos.z) < 15;
    return {
      steer: Math.max(-1, Math.min(1, -e * 2.2)),
      brake: sk.speed > this.vmax ? Math.min(1, (sk.speed - this.vmax) * 0.5) : 0,
      tuck: 0,
      push: sk.speed < 2.5 ? 1 : 0,
      done,
    };
  }
}

const JACKETS = [0x1f6fe0, 0x2e9d57, 0xf2b705, 0xff6f3c, 0x7b3fe4, 0x0fb5c9, 0xe63978, 0x222831, 0xffffff, 0xa4161a, 0x3d5a80, 0x8ac926];
const PANTS = [0x1b1f2a, 0x2b2d42, 0x3a3a3a, 0x283618, 0x14213d, 0xf1faee];

export class Crowd {
  skiers: { sk: Skier; pilot: Pilot; key: number; stuck: number }[] = [];
  private s = 99;
  private rnd = () => ((this.s = (this.s * 16807) % 2147483647) / 2147483647);

  constructor(public routes: Route[], private hf: HeightField, private mask: MaskField, private forest: Forest,
    scene: THREE.Object3D, count: number, private tracks: Tracks) {
    if (!routes.length) return;
    for (let i = 0; i < count; i++) {
      const model = new SkierModel({
        jacket: JACKETS[Math.floor(this.rnd() * JACKETS.length)], pants: PANTS[Math.floor(this.rnd() * PANTS.length)],
        helmet: this.rnd() < 0.5 ? 0x222222 : JACKETS[Math.floor(this.rnd() * JACKETS.length)],
        ski: JACKETS[Math.floor(this.rnd() * JACKETS.length)],
      });
      const sk = new Skier(hf, mask, forest, model);
      scene.add(model.root);
      const entry = { sk, pilot: null as unknown as Pilot, key: i + 10, stuck: 0 };
      this.respawn(entry, this.rnd() * 0.9);
      this.skiers.push(entry);
    }
  }

  private respawn(e: { sk: Skier; pilot: Pilot; stuck: number }, frac = 0) {
    const r = this.routes[Math.floor(this.rnd() * this.routes.length)];
    e.pilot = new Pilot(r, this.rnd, frac);
    const p = r.pts[e.pilot.idx], q = r.pts[e.pilot.idx + 1];
    e.sk.place(p[0], p[1], Math.atan2(q[0] - p[0], q[1] - p[1]));
    e.sk.vel.set(Math.sin(e.sk.yaw), 0, Math.cos(e.sk.yaw)).multiplyScalar(frac > 0 ? 6 : 0);
    e.stuck = 0;
  }

  private _l = new THREE.Vector3(); private _r = new THREE.Vector3(); private _s = new THREE.Vector3();

  update(dt: number, cam: THREE.Vector3, steps: number, stepDt: number) {
    for (const e of this.skiers) {
      const far = Math.hypot(e.sk.pos.x - cam.x, e.sk.pos.z - cam.z) > 900;
      // les skieurs lointains sont simulés moins finement
      const n = far ? Math.max(1, Math.round(steps / 4)) : steps;
      const sdt = far ? stepDt * steps / n : stepDt;
      for (let k = 0; k < n; k++) {
        const c = e.pilot.steer(e.sk);
        if (c.done) { this.respawn(e); break; }
        e.sk.step(sdt, { steer: c.steer, brake: c.brake, tuck: c.tuck, push: c.push, jump: false });
      }
      e.sk.events.length = 0;
      if (e.sk.speed < 0.5 && e.sk.crashT <= 0) e.stuck += dt; else e.stuck = 0;
      if (e.stuck > 6) this.respawn(e);
      const model = e.sk.model;
      model.root.visible = !far;
      if (!far) {
        e.sk.updateModel(dt);
        if (e.sk.grounded && e.sk.crashT <= 0 && e.sk.speed > 1) {
          const root = model.root; root.updateMatrixWorld();
          this._l.set(-0.13, 0, -0.3).applyMatrix4(root.matrixWorld); this._l.y = this.hf.height(this._l.x, this._l.z);
          this._r.set(0.13, 0, -0.3).applyMatrix4(root.matrixWorld); this._r.y = this.hf.height(this._r.x, this._r.z);
          this._s.set(1, 0, 0).applyQuaternion(root.quaternion).setY(0).normalize();
          this.tracks.add([this._l, this._r], this._s, 0.12 + e.sk.skid * 0.2, 0.55 * (1 - this.mask.sample(e.sk.pos.x, e.sk.pos.z, 0) * 0.3), e.key, false);
        }
      }
    }
    this.tracks.flush();
  }

  /** descentes simulées au chargement pour que les pistes portent déjà des traces */
  static pretrace(routes: Route[], hf: HeightField, mask: MaskField, forest: Forest, tracks: Tracks, runs: number) {
    if (!routes.length) return;
    let s = 4242;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const sk = new Skier(hf, mask, forest, null);
    const l = new THREE.Vector3(), r = new THREE.Vector3(), side = new THREE.Vector3();
    const dt = 1 / 50;
    for (let run = 0; run < runs; run++) {
      const route = routes[run % routes.length];
      const pilot = new Pilot(route, rnd, 0);
      const p = route.pts[0], q = route.pts[1];
      sk.place(p[0], p[1], Math.atan2(q[0] - p[0], q[1] - p[1]));
      tracks.reset();
      let t = 0, stuck = 0;
      while (t < 600) {
        const c = pilot.steer(sk);
        if (c.done) break;
        sk.step(dt, { steer: c.steer, brake: c.brake, tuck: 0, push: c.push, jump: false });
        sk.events.length = 0;
        t += dt;
        if (sk.speed < 0.4) { stuck += dt; if (stuck > 4) break; } else stuck = 0;
        if (sk.grounded && sk.crashT <= 0) {
          const c0 = Math.cos(sk.yaw), s0 = Math.sin(sk.yaw);
          side.set(c0, 0, -s0);
          l.set(sk.pos.x - side.x * 0.13 - s0 * 0.3, 0, sk.pos.z - side.z * 0.13 - c0 * 0.3); l.y = hf.height(l.x, l.z);
          r.set(sk.pos.x + side.x * 0.13 - s0 * 0.3, 0, sk.pos.z + side.z * 0.13 - c0 * 0.3); r.y = hf.height(r.x, r.z);
          const fade = 0.25 + rnd() * 0.3;
          tracks.add([l, r], side, 0.11 + sk.skid * 0.2, fade, 0, false);
        }
      }
    }
    tracks.reset();
    tracks.flush();
  }
}
