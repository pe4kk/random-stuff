/** Sons procéduraux : vent, glisse sur les carres, dérapage. */
export class SkiAudio {
  ctx: AudioContext | null = null;
  private wind!: GainNode; private windF!: BiquadFilterNode;
  private carve!: GainNode; private carveF!: BiquadFilterNode;
  private scrape!: GainNode; private scrapeF!: BiquadFilterNode;
  private master!: GainNode;
  muted = false;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.98 * b + 0.02 * w; d[i] = w * 0.5 + b * 4; }
    this.master = ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(ctx.destination);
    const chain = (type: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      src.playbackRate.value = 0.7 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return [g, f] as const;
    };
    [this.wind, this.windF] = chain('lowpass', 400, 0.7);
    [this.carve, this.carveF] = chain('bandpass', 900, 1.2);
    [this.scrape, this.scrapeF] = chain('bandpass', 2400, 0.8);
  }

  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.6; }

  update(speed: number, carve: number, skid: number, grounded: boolean, crashed: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, speed / 30);
    this.wind.gain.setTargetAtTime(0.05 + s * s * 0.9, t, 0.15);
    this.windF.frequency.setTargetAtTime(250 + s * 1400, t, 0.2);
    const g = grounded && !crashed ? 1 : 0;
    this.carve.gain.setTargetAtTime(g * (0.05 + carve * 0.35) * Math.min(1, speed / 6), t, 0.08);
    this.carveF.frequency.setTargetAtTime(500 + speed * 25, t, 0.1);
    this.scrape.gain.setTargetAtTime((g * skid * 0.5 + (crashed ? 0.3 * s : 0)) * Math.min(1, speed / 3), t, 0.06);
    this.scrapeF.frequency.setTargetAtTime(1500 + speed * 60, t, 0.1);
  }
}
