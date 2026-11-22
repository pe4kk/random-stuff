import { Features, HeightField, MaskField } from './data';
import { DIFF_COLOR } from './world';
import { LiftRuntime } from './lifts';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** Plan des pistes plein écran : relief ombré, forêts, pistes, remontées, position. */
export class PisteMap {
  el: HTMLElement;
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private readonly S = 2048;             // px de la carte de base (2 m/px)
  private zoom = 1; private cx = 0; private cz = 0;   // centre en mètres
  open = false;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private hover: LiftRuntime | null = null;
  player = { x: 0, z: 0, yaw: 0 };
  others: { x: number; z: number }[] = [];

  constructor(private f: Features, private hf: HeightField, private mask: MaskField, private lifts: LiftRuntime[],
    private onTeleport: (l: LiftRuntime) => void) {
    this.el = document.getElementById('map')!;
    this.cv = document.getElementById('map-canvas') as HTMLCanvasElement;
    this.ctx = this.cv.getContext('2d')!;
    this.cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.toWorld(e.offsetX, e.offsetY);
      this.zoom = Math.min(8, Math.max(0.6, this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const after = this.toWorld(e.offsetX, e.offsetY);
      this.cx += before.x - after.x; this.cz += before.z - after.z;
      this.draw();
    }, { passive: false });
    this.cv.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false }; this.cv.setPointerCapture(e.pointerId); });
    this.cv.addEventListener('pointermove', (e) => {
      if (this.drag) {
        const k = this.mPerPx();
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
        this.cx = this.drag.cx - dx * k; this.cz = this.drag.cz - dy * k;
        this.draw();
      } else {
        const h = this.pick(e.offsetX, e.offsetY);
        if (h !== this.hover) { this.hover = h; this.cv.style.cursor = h ? 'pointer' : 'grab'; this.draw(); }
      }
    });
    this.cv.addEventListener('pointerup', (e) => {
      const d = this.drag; this.drag = null;
      if (d && !d.moved) { const l = this.pick(e.offsetX, e.offsetY); if (l) this.onTeleport(l); }
    });
    window.addEventListener('resize', () => { if (this.open) this.fit(); });
  }

  private mPerPx() { const W = Math.max(this.cv.clientWidth, 1), H = Math.max(this.cv.clientHeight, 1); return (2 * this.hf.half) / (Math.min(W, H) * this.zoom); }
  private toScreen(x: number, z: number) { const k = this.mPerPx(); return { x: this.cv.clientWidth / 2 + (x - this.cx) / k, y: this.cv.clientHeight / 2 + (z - this.cz) / k }; }
  private toWorld(sx: number, sy: number) { const k = this.mPerPx(); return { x: this.cx + (sx - this.cv.clientWidth / 2) * k, z: this.cz + (sy - this.cv.clientHeight / 2) * k }; }

  private pick(sx: number, sy: number): LiftRuntime | null {
    let best: LiftRuntime | null = null, bd = 16;
    for (const l of this.lifts) {
      if (!this.hf.inside(l.top.x, l.top.z, 30)) continue;
      const p = this.toScreen(l.top.x, l.top.z);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  toggle(v = !this.open) {
    this.open = v;
    this.el.classList.toggle('show', v);
    if (v) {
      if (!this.base) this.build();
      this.cx = this.player.x; this.cz = this.player.z; this.zoom = 2.2;
      this.fit();
    }
  }

  private fit() {
    const r = Math.min(window.devicePixelRatio, 2);
    this.cv.width = this.cv.clientWidth * r; this.cv.height = this.cv.clientHeight * r;
    this.ctx.setTransform(r, 0, 0, r, 0, 0);
    this.draw();
  }

  /** carte de base : relief ombré façon plan des pistes */
  private build() {
    const S = this.S, hf = this.hf;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d')!;
    const im = x.createImageData(S, S);
    const d = im.data, md = this.mask.img.data, mn = this.mask.img.width;
    const H = hf.data, N = hf.n;
    // lumière du nord-ouest (convention cartographique)
    const lx = -0.6, ly = 0.75, lz = -0.55;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const ii = Math.min(N - 2, Math.max(1, Math.floor(i * N / S))), jj = Math.min(N - 2, Math.max(1, Math.floor(j * N / S)));
      const dx = (H[jj * N + ii - 1] - H[jj * N + ii + 1]) / 4, dz = (H[(jj - 1) * N + ii] - H[(jj + 1) * N + ii]) / 4;
      const l = Math.hypot(dx, 1, dz);
      let sh = (dx * lx + ly + dz * lz) / l;
      sh = Math.max(0, Math.min(1, 0.35 + sh * 0.75));
      const h = H[jj * N + ii];
      const k = (jj * mn + ii) * 4;
      const forest = md[k + 1] / 255, bld = md[k + 3] / 255;
      // neige bleutée ombrée
      let r = 160 + 95 * sh, g = 175 + 80 * sh, b = 200 + 55 * sh;
      // forêt : vert sombre tacheté
      if (forest > 0.08) {
        const t = Math.min(1, forest * 2.2) * (0.7 + 0.3 * ((((i * 73856093) ^ (j * 19349663)) >>> 0) % 7) / 7);
        r = r * (1 - t) + (30 + 40 * sh) * t; g = g * (1 - t) + (62 + 50 * sh) * t; b = b * (1 - t) + (45 + 35 * sh) * t;
      }
      if (bld > 0.4) { r = 150; g = 110; b = 90; }
      // courbes de niveau tous les 50 m
      const h2 = H[jj * N + ii + 1], h3 = H[(jj + 1) * N + ii];
      if (Math.floor(h / 50) !== Math.floor(h2 / 50) || Math.floor(h / 50) !== Math.floor(h3 / 50)) {
        const major = Math.floor(Math.max(h, h2, h3) / 50) % 4 === 0;
        const f = major ? 0.72 : 0.86;
        r *= f; g *= f; b *= f;
      }
      const o = (j * S + i) * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    x.putImageData(im, 0, 0);
    this.base = c;
  }

  draw() {
    if (!this.open || !this.base) return;
    const ctx = this.ctx, W = this.cv.clientWidth, Hh = this.cv.clientHeight;
    ctx.fillStyle = '#0d1b2e'; ctx.fillRect(0, 0, W, Hh);
    const half = this.hf.half;
    const p0 = this.toScreen(-half, -half), p1 = this.toScreen(half, half);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    const k = this.mPerPx();
    const lw = Math.max(1.5, Math.min(6, 9 / k));
    // routes
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(120,110,100,0.55)'; ctx.lineWidth = Math.max(1, lw * 0.5);
    for (const r of this.f.roads) this.path(r.pts), ctx.stroke();
    // pistes (liseré blanc puis couleur)
    const pistes = this.f.pistes.filter(p => !p.area && p.diff in DIFF_COLOR);
    for (const p of pistes) { ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = lw + 2.5; this.path(p.pts); ctx.stroke(); }
    for (const p of pistes) {
      ctx.strokeStyle = hex(DIFF_COLOR[p.diff]); ctx.lineWidth = p.name === 'Mont-Blanc' ? lw * 1.5 : lw;
      if (p.diff === 'freeride') ctx.setLineDash([lw * 2, lw * 1.5]); else ctx.setLineDash([]);
      this.path(p.pts); ctx.stroke();
    }
    ctx.setLineDash([]);
    // funiculaire
    for (const fu of this.f.funiculars) { ctx.strokeStyle = '#7a1f2b'; ctx.lineWidth = lw * 0.9; this.path(fu.pts); ctx.stroke(); }
    // remontées
    for (const l of this.lifts) {
      const pts = l.lift.pts;
      ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.2, lw * 0.45);
      this.path(pts); ctx.stroke();
      const a = this.toScreen(pts[0][0], pts[0][1]), b = this.toScreen(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, 7); ctx.fill();
      // sommet : point de téléportation
      const hov = this.hover === l;
      ctx.fillStyle = hov ? '#ffcc00' : '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, hov ? 8 : 5.5, 0, 7); ctx.fill(); ctx.stroke();
    }
    // libellés
    const boxes: number[][] = [];
    const label = (text: string, x: number, y: number, size: number, color: string, weight = 700, halo = '#fff', force = false) => {
      ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // pas de chevauchement entre étiquettes
      const w = ctx.measureText(text).width + 6, h = size + 4;
      const b = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (!force && boxes.some(o => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]))) return;
      boxes.push(b);
      ctx.lineWidth = 3.5; ctx.strokeStyle = halo; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
    };
    if (this.zoom > 1.4) {
      const done = new Set<string>();
      for (const p of pistes.slice().sort((a, b) => b.pts.length - a.pts.length)) {
        if (!p.name || done.has(p.name)) continue; done.add(p.name);
        const m = p.pts[Math.floor(p.pts.length / 2)];
        const s = this.toScreen(m[0], m[1]);
        label(p.name, s.x, s.y - 10, 12 + (p.name === 'Mont-Blanc' ? 3 : 0), hex(DIFF_COLOR[p.diff]));
      }
    }
    for (const l of this.lifts) {
      if (!l.lift.name) continue;
      const pts = l.lift.pts, m = pts[Math.floor(pts.length / 2)];
      const s = this.toScreen(m[0], m[1]);
      if (this.zoom > 1.1) label('▲ ' + l.lift.name, s.x, s.y, 11, '#111', 700);
    }
    for (const pl of this.f.places) {
      if (!['village', 'hamlet', 'town'].includes(pl.kind)) continue;
      const s = this.toScreen(pl.p[0], pl.p[1]);
      if (s.x < -50 || s.y < -50 || s.x > W + 50 || s.y > Hh + 50) continue;
      label(pl.name, s.x, s.y, pl.kind === 'hamlet' ? 12 : 18, '#3b2416', 800);
    }
    if (this.zoom > 2.5) for (const poi of this.f.pois) {
      if (!poi.name || !['restaurant', 'bar', 'cafe'].includes(poi.kind)) continue;
      const s = this.toScreen(poi.p[0], poi.p[1]);
      ctx.fillStyle = '#b5532a'; ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, 7); ctx.fill();
      label(poi.name, s.x, s.y + 11, 10, '#5a2a14', 600);
    }
    // autres skieurs
    ctx.fillStyle = 'rgba(30,30,40,0.8)';
    for (const o of this.others) { const s = this.toScreen(o.x, o.z); ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, 7); ctx.fill(); }
    // joueur
    const s = this.toScreen(this.player.x, this.player.z);
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(-this.player.yaw + Math.PI);
    ctx.fillStyle = '#ff3b30'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // info survol
    if (this.hover) {
      const b = this.toScreen(this.hover.top.x, this.hover.top.z);
      label(`Se téléporter : ${this.hover.lift.name} (${Math.round(this.hover.top.y)} m)`, b.x, b.y - 20, 14, '#111', 800, '#fff', true);
    }
    // échelle
    const meters = 500, px = meters / k;
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(20, Hh - 34, px, 6);
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText('500 m', 20, Hh - 44);
  }

  private path(pts: [number, number][]) {
    const c = this.ctx;
    c.beginPath();
    pts.forEach(([x, z], i) => { const s = this.toScreen(x, z); if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y); });
  }
}
