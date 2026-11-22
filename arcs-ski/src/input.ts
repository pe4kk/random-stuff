import { SkiInput } from './skier';

/** Clavier (positions physiques : marche en AZERTY comme en QWERTY) + manette */
export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  private padPrev: boolean[] = [];
  padPressed = new Set<number>();
  usingPad = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingPad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** à appeler une fois par image, avant les lectures */
  poll() {
    this.padPressed.clear();
    const p = this.pad();
    if (!p) return;
    p.buttons.forEach((b, i) => {
      if (b.pressed && !this.padPrev[i]) { this.padPressed.add(i); this.usingPad = true; }
      this.padPrev[i] = b.pressed;
    });
    if (Math.abs(p.axes[0] ?? 0) > 0.3) this.usingPad = true;
  }

  endFrame() { this.pressed.clear(); }

  was(code: string, padButton?: number) {
    return this.pressed.has(code) || (padButton !== undefined && this.padPressed.has(padButton));
  }

  private steerS = 0;
  private lastT = performance.now();

  ski(): SkiInput {
    const k = this.keys;
    let steer = 0, tuck = 0, brake = 0, push = 0, jump = false;
    let target = 0;
    if (k.has('ArrowLeft') || k.has('KeyA')) target -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) target += 1;
    // clavier : prise de carre progressive (~0,25 s), relâchement plus rapide
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000); this.lastT = now;
    const rate = target === 0 ? 7 : Math.sign(target) !== Math.sign(this.steerS) ? 9 : 4;
    const d = target - this.steerS;
    this.steerS += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    steer = this.steerS;
    if (k.has('ArrowUp') || k.has('KeyW')) { tuck = 1; push = 1; }
    if (k.has('ArrowDown') || k.has('KeyS')) brake = 1;
    if (k.has('Space')) jump = true;
    const p = this.pad();
    if (p) {
      const ax = p.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) steer = Math.sign(ax) * Math.min(1, (Math.abs(ax) - 0.12) / 0.8);
      const rt = p.buttons[7]?.value ?? 0, lt = p.buttons[6]?.value ?? 0;
      const ay = p.axes[1] ?? 0;
      tuck = Math.max(tuck, rt, ay < -0.4 ? 1 : 0);
      push = Math.max(push, rt, ay < -0.4 ? 1 : 0);
      brake = Math.max(brake, lt, ay > 0.4 ? 1 : 0);
      if (p.buttons[0]?.pressed) jump = true;
    }
    return { steer, tuck, brake, jump, push };
  }
}
