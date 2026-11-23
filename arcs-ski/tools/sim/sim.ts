// Simulation sans rendu : un pilote automatique descend la piste Mont-Blanc.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { HeightField, MaskField, Features } from '../../src/data';
import { Forest } from '../../src/trees';
import { Skier } from '../../src/skier';

const D = 'public/data/';
const f: Features = JSON.parse(readFileSync(D + 'features.json', 'utf8'));
const m = f.meta;
const u16png = (name: string, n?: number) => { const p = PNG.sync.read(readFileSync(D + name)); const N = n ?? p.width * p.height; const o = new Uint16Array(N); for (let i = 0; i < N; i++) o[i] = (p.data[i * 4] << 8) | p.data[i * 4 + 1]; return o; };
const cu = u16png('core_h.png');
const core = new Float32Array(cu.length); for (let i = 0; i < cu.length; i++) core[i] = cu[i] / m.hScale + m.hOff;
const png = PNG.sync.read(readFileSync(D + 'core_mask.png'));
const img = { data: png.data, width: png.width, height: png.height } as unknown as ImageData;
const hf = new HeightField(core, m.coreN, m.coreHalf);
const mask = new MaskField(img, m.coreHalf);
const forest = new Forest(u16png('trees.png', m.nTrees * 3), hf, mask);

// chaîne ordonnée de la piste Mont-Blanc
const ways = f.pistes.filter(p => p.name === 'Mont-Blanc' && !p.area).map(p => p.pts);
const lift = f.lifts.find(l => l.name === 'Mont-Blanc')!;
const top = lift.pts[lift.pts.length - 1], bottom = lift.pts[0];
let chain: [number, number][] = [];
let cur: [number, number] = top;
const used = new Set<number>();
for (let k = 0; k < ways.length; k++) {
  let bi = -1, bd = 1e9, rev = false;
  ways.forEach((w, i) => { if (used.has(i)) return;
    const d0 = Math.hypot(w[0][0] - cur[0], w[0][1] - cur[1]); const d1 = Math.hypot(w[w.length-1][0] - cur[0], w[w.length-1][1] - cur[1]);
    if (d0 < bd) { bd = d0; bi = i; rev = false; } if (d1 < bd) { bd = d1; bi = i; rev = true; } });
  if (bi < 0 || bd > (k === 0 ? 150 : 60)) break;
  used.add(bi); const w = rev ? ways[bi].slice().reverse() : ways[bi]; chain.push(...w); cur = w[w.length - 1];
}
// rééchantillonnage tous les 5 m
const path: [number, number][] = [chain[0]];
for (let i = 1; i < chain.length; i++) { const a = path[path.length-1], b = chain[i]; const d = Math.hypot(b[0]-a[0], b[1]-a[1]); const n = Math.floor(d / 5); for (let k = 1; k <= n; k++) path.push([a[0] + (b[0]-a[0])*k/n, a[1] + (b[1]-a[1])*k/n]); }
let len = 0; for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0]-path[i-1][0], path[i][1]-path[i-1][1]);
console.log(`piste: ${path.length} pts, ${len.toFixed(0)} m, de ${hf.height(...path[0]).toFixed(0)} m à ${hf.height(...path[path.length-1]).toFixed(0)} m; fin à ${Math.hypot(path[path.length-1][0]-bottom[0], path[path.length-1][1]-bottom[1]).toFixed(0)} m du bas du TS`);

const mode = process.argv[2] || 'cruise';
const s = new Skier(hf, mask, forest);
const d0 = [path[1][0]-path[0][0], path[1][1]-path[0][1]];
s.place(path[0][0], path[0][1], Math.atan2(d0[0], d0[1]));
let idx = 0, t = 0, vmax = 0, crashes = 0, air = 0, offp = 0, skidT = 0;
const dt = 1 / 120;
let lastLog = 0;
let t30 = 0, t50 = 0, t70 = 0;
while (t < 900) {
  // point cible à ~ 12 m + v*0.8 devant
  while (idx < path.length - 1 && Math.hypot(path[idx][0]-s.pos.x, path[idx][1]-s.pos.z) < 8 + s.speed * 0.6) idx++;
  const tg = path[idx];
  const want = Math.atan2(tg[0]-s.pos.x, tg[1]-s.pos.z);
  let e = want - s.yaw; e = Math.atan2(Math.sin(e), Math.cos(e));
  const steer = Math.max(-1, Math.min(1, -e * 2.5));
  const vlim = mode === 'fast' ? 99 : 14;
  const brake = s.speed > vlim ? 1 : 0;
  const tuck = mode === 'fast' && Math.abs(e) < 0.2 ? 1 : 0;
  const before = s.crashT > 0;
  s.step(dt, { steer, tuck, brake, jump: false, push: s.speed < 3 ? 1 : 0 });
  if (!before && s.crashT > 0) { crashes++; console.log(`  chute à t=${t.toFixed(1)} (${s.crashMsg}) v=${(s.speed*3.6).toFixed(0)} pos=${s.pos.x.toFixed(0)},${s.pos.z.toFixed(0)} idx=${idx}`); }
  s.events.length = 0;
  if (!t30 && s.speed > 30 / 3.6) t30 = t; if (!t50 && s.speed > 50 / 3.6) t50 = t; if (!t70 && s.speed > 70 / 3.6) t70 = t;
  vmax = Math.max(vmax, s.speed); if (!s.grounded) air += dt; if (s.onPiste < 0.3) offp += dt; if (s.skid > 0.3) skidT += dt;
  t += dt;
  if (t - lastLog > 15) { lastLog = t; console.log(`  t=${t.toFixed(0)}s v=${(s.speed*3.6).toFixed(0)} km/h alt=${s.pos.y.toFixed(0)} idx=${idx}/${path.length} piste=${s.onPiste.toFixed(2)}`); }
  if (idx >= path.length - 1 && Math.hypot(path[idx][0]-s.pos.x, path[idx][1]-s.pos.z) < 15) break;
  if (s.speed < 0.3 && t > 20 && s.crashT <= 0) { /* bloqué */ }
}
console.log(`[${mode}] 0→30 km/h ${t30.toFixed(1)} s, 0→50 ${t50.toFixed(1)} s, 0→70 ${t70.toFixed(1)} s`);
console.log(`[${mode}] temps ${t.toFixed(1)} s, vmax ${(vmax*3.6).toFixed(0)} km/h, moy ${(len/t*3.6).toFixed(0)} km/h, chutes ${crashes}, en l'air ${air.toFixed(1)} s, hors-piste ${offp.toFixed(1)} s, dérapage ${skidT.toFixed(1)} s, arbres ${forest.count}`);
