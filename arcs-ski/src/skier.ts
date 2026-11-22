import * as THREE from 'three';
import { HeightField, MaskField } from './data';
import { Forest } from './trees';

export interface SkiInput { steer: number; tuck: number; brake: number; jump: boolean; push: number }

const G = 9.81;
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _l = new THREE.Vector3(), _a = new THREE.Vector3();
const _n = { x: 0, y: 1, z: 0 };

// ----------------------------------------------------------------- modèle 3D
function limb(r: number, len: number, mat: THREE.Material) {
  const g = new THREE.CapsuleGeometry(r, len - 2 * r, 4, 8);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat); m.castShadow = true;
  return m;
}

export class SkierModel {
  root = new THREE.Group();      // aux pieds, orienté selon la pente
  lean = new THREE.Group();      // inclinaison dans les virages
  hips = new THREE.Group();
  torso = new THREE.Group();
  legs: { thigh: THREE.Group; shin: THREE.Group }[] = [];
  arms: { upper: THREE.Group; lower: THREE.Group; pole: THREE.Group }[] = [];
  skis: THREE.Group[] = [];
  readonly L = 0.46;

  constructor() {
    const jacket = new THREE.MeshStandardMaterial({ color: 0xd8262c, roughness: 0.55 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x1b1f2a, roughness: 0.7 });
    const helmet = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3, metalness: 0.1 });
    const goggle = new THREE.MeshStandardMaterial({ color: 0xffa21c, roughness: 0.1, metalness: 0.9, emissive: 0x331500 });
    const skiMat = new THREE.MeshStandardMaterial({ color: 0x1565ff, roughness: 0.35, metalness: 0.2 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xbfc4cc, roughness: 0.3, metalness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });

    this.root.add(this.lean);
    // skis
    for (const sx of [-0.13, 0.13]) {
      const ski = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 1.6), skiMat);
      body.position.set(0, 0.012, -0.05); body.castShadow = true; ski.add(body);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 0.22), skiMat);
      tip.position.set(0, 0.05, 0.84); tip.rotation.x = -0.45; tip.castShadow = true; ski.add(tip);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.3), bootMat);
      boot.position.set(0, 0.12, 0); boot.castShadow = true; ski.add(boot);
      ski.position.x = sx;
      this.lean.add(ski); this.skis.push(ski);
    }
    // jambes
    this.lean.add(this.hips);
    for (const sx of [-0.12, 0.12]) {
      const thigh = new THREE.Group(); thigh.position.set(sx, 0, 0);
      thigh.add(limb(0.075, this.L, pants));
      const shin = new THREE.Group(); shin.position.y = -this.L;
      shin.add(limb(0.065, this.L, pants));
      thigh.add(shin);
      this.hips.add(thigh);
      this.legs.push({ thigh, shin });
    }
    // buste
    this.hips.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.32, 4, 10), jacket);
    chest.position.y = 0.3; chest.scale.set(1.1, 1, 0.75); chest.castShadow = true; this.torso.add(chest);
    const head = new THREE.Group(); head.position.y = 0.72; this.torso.add(head);
    const hm = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), helmet); hm.castShadow = true; head.add(hm);
    const gm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.06), goggle); gm.position.set(0, 0.0, 0.11); head.add(gm);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8), skin); neck.position.y = 0.58; this.torso.add(neck);
    // bras + bâtons
    for (const sx of [-0.23, 0.23]) {
      const upper = new THREE.Group(); upper.position.set(sx, 0.52, 0);
      upper.add(limb(0.055, 0.3, jacket));
      const lower = new THREE.Group(); lower.position.y = -0.3;
      lower.add(limb(0.05, 0.28, jacket));
      upper.add(lower);
      const pole = new THREE.Group(); pole.position.y = -0.28;
      const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 5), poleMat);
      pm.position.y = -0.55; pm.castShadow = true; pole.add(pm);
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 10), skin);
      basket.position.y = -1.05; pole.add(basket);
      lower.add(pole);
      this.torso.add(upper);
      this.arms.push({ upper, lower, pole });
    }
  }

  /** pose : flexion 0..1, inclinaison (rad), position de recherche de vitesse 0..1, chute */
  pose(crouch: number, lean: number, tuck: number, t: number, push: number, brake: number) {
    const a = 0.42 + crouch * 0.6 + tuck * 0.4;            // angle de la cuisse
    const L = this.L;
    this.hips.position.set(0, 0.2 + 2 * L * Math.cos(a), -Math.sin(a) * 0.15);
    // dérapage / chasse-neige : skis légèrement ouverts
    const plough = brake * 0.12;
    this.skis[0].rotation.y = plough; this.skis[1].rotation.y = -plough;
    this.skis[0].position.x = -0.13 - brake * 0.05; this.skis[1].position.x = 0.13 + brake * 0.05;
    for (const leg of this.legs) {
      leg.thigh.rotation.x = -a;
      leg.shin.rotation.x = 2 * a;
    }
    this.lean.rotation.z = lean;
    // angulation : le buste reste plus droit que les jambes
    this.torso.rotation.z = -lean * 0.45;
    this.torso.rotation.x = 0.25 + a * 0.55 + tuck * 0.55;
    const swing = Math.sin(t * 5) * push;
    this.arms.forEach((arm, i) => {
      const s = i === 0 ? -1 : 1;
      arm.upper.rotation.x = -0.45 - tuck * 0.9 + swing * 0.9;
      arm.upper.rotation.z = s * (0.32 - tuck * 0.2);
      arm.lower.rotation.x = -0.85 - tuck * 0.5;
      arm.pole.rotation.x = 1.35 + tuck * 0.9 - swing * 0.7;
      arm.pole.rotation.z = -s * 0.15;
    });
  }
}

// ---------------------------------------------------------------- physique
export class Skier {
  model = new SkierModel();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  grounded = true;
  airTime = 0;
  crashT = 0;
  crashMsg = '';
  leanAngle = 0;
  crouch = 0.2;
  compress = 0;
  skid = 0;            // 0..1 intensité de dérapage
  carve = 0;           // 0..1 intensité de carving
  onPiste = 0;         // 0..1
  lastLanding = 0;     // vitesse d'impact
  normal = new THREE.Vector3(0, 1, 0);
  private upSmooth = new THREE.Vector3(0, 1, 0);
  private t = 0;
  private tuck = 0;
  private push = 0;
  private brake = 0;
  private jumpHeld = false;
  private tumble = new THREE.Euler();
  events: string[] = [];

  constructor(public hf: HeightField, public mask: MaskField, public forest: Forest) {}

  get speed() { return this.vel.length(); }

  place(x: number, z: number, yaw: number) {
    this.pos.set(x, this.hf.height(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.grounded = true;
    this.crashT = 0;
    this.airTime = 0;
  }

  private crash(msg: string) {
    if (this.crashT > 0) return;
    this.crashT = 2.6;
    this.crashMsg = msg;
    this.events.push('crash');
    this.tumble.set(0, 0, 0);
  }

  step(dt: number, inp: SkiInput) {
    this.t += dt;
    const hf = this.hf;
    this.tuck += (inp.tuck - this.tuck) * Math.min(1, dt * 6);
    this.brake += (inp.brake - this.brake) * Math.min(1, dt * 8);
    this.push += ((inp.push > 0 && this.speed < 7 ? 1 : 0) - this.push) * Math.min(1, dt * 5);

    if (this.crashT > 0) {
      this.crashT -= dt;
      hf.normal(this.pos.x, this.pos.z, _n);
      this.normal.set(_n.x, _n.y, _n.z);
      _a.set(0, -G, 0).addScaledVector(this.normal, G * this.normal.y);
      this.vel.addScaledVector(_a, dt * 0.4);
      this.vel.multiplyScalar(Math.exp(-dt * 2.5));
      this.vel.addScaledVector(this.normal, -this.vel.dot(this.normal));
      this.pos.addScaledVector(this.vel, dt);
      this.pos.y = hf.height(this.pos.x, this.pos.z);
      this.collide(true);
      const sp = this.speed;
      this.tumble.x += dt * sp * 1.2; this.tumble.z += dt * sp * 0.7;
      if (this.crashT <= 0) {
        this.tumble.set(0, 0, 0);
        if (sp > 0.3) this.yaw = Math.atan2(this.vel.x, this.vel.z);
        this.vel.multiplyScalar(0.2);
        this.grounded = true;
      }
      this.skid = Math.min(1, sp / 8); this.carve = 0;
      return;
    }

    const onP = this.mask.sample(this.pos.x, this.pos.z, 0);
    this.onPiste = onP;
    const steer = inp.steer;

    if (this.grounded) {
      hf.normal(this.pos.x, this.pos.z, _n);
      const n = this.normal.set(_n.x, _n.y, _n.z);
      _d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      _d.addScaledVector(n, -_d.dot(n)).normalize();
      _l.crossVectors(n, _d);                       // gauche
      const v = this.vel;
      const speed = v.length();
      const vf = v.dot(_d), vl = v.dot(_l);

      // virage : rayon de carving qui se resserre avec la prise de carre
      const absS = Math.abs(steer);
      const R = 38 - 27 * absS - 6 * this.brake;
      let yawRate = -steer * (Math.max(Math.abs(vf), 0) / R);
      yawRate += -steer * 1.9 * Math.max(0, 1 - speed / 9);            // pivot à basse vitesse
      yawRate += -steer * this.brake * 1.2;                               // dérapage piloté
      this.yaw += yawRate * dt;

      // forces (par unité de masse)
      const N = G * n.y + Math.max(0, this.compress) * 2;
      _a.set(0, -G, 0).addScaledVector(n, G * n.y);     // gravité tangentielle
      // adhérence latérale (carres)
      const powder = 1 - onP;
      const grip = (1.25 + 0.35 * absS) * (1 - 0.3 * powder) * (1 - 0.65 * this.brake) * N;
      let aLat = -vl * 9;
      const need = Math.abs(aLat);
      let skid = 0;
      if (need > grip) { skid = Math.min(1, (need - grip) / (grip + 1)); aLat = Math.sign(aLat) * grip; }
      _a.addScaledVector(_l, aLat);
      // frottements
      const mu = 0.035 + 0.035 * powder + 0.15 * this.brake + 0.12 * skid;
      const cda = 0.55 - 0.32 * this.tuck + 0.25 * this.brake;
      const drag = mu * N + (0.5 * 1.2 * cda / 80) * speed * speed + powder * 0.012 * speed * speed * 0.3;
      if (speed > 0.01) {
        const dec = Math.min(drag, speed / dt);
        _a.addScaledVector(v, -dec / speed);
      }
      // pas de patineur / poussée sur les bâtons
      if (inp.push > 0 && speed < 7) _a.addScaledVector(_d, 2.6 * inp.push * (1 - speed / 7));
      // freinage fort : chasse-neige / dérapage
      if (this.brake > 0.05 && speed > 0.01) _a.addScaledVector(v, -Math.min(this.brake * 5.5, speed / dt) / speed);

      v.addScaledVector(_a, dt);
      v.addScaledVector(n, -v.dot(n));
      this.skid += (Math.max(skid, this.brake * Math.min(1, speed / 6)) - this.skid) * Math.min(1, dt * 10);
      this.carve += (Math.min(1, absS * speed / 14) * (1 - skid) - this.carve) * Math.min(1, dt * 6);

      // inclinaison visuelle = accélération latérale
      const latAcc = vf * yawRate;
      const targetLean = Math.max(-0.95, Math.min(0.95, Math.atan2(latAcc, G)));
      this.leanAngle += (targetLean - this.leanAngle) * Math.min(1, dt * 8);

      const prevY = this.pos.y;
      this.pos.addScaledVector(v, dt);
      const ty = hf.height(this.pos.x, this.pos.z);
      if (this.pos.y > ty + 0.12 && speed > 5) {
        this.grounded = false; this.airTime = 0;
      } else {
        // absorption : vitesse verticale perdue en compression
        this.pos.y = ty;
      }
      void prevY;

      // saut : on charge en maintenant, on décolle en relâchant
      if (inp.jump && !this.jumpHeld) this.jumpHeld = true;
      if (inp.jump) this.compress = Math.min(1, this.compress + dt * 3);
      if (!inp.jump && this.jumpHeld) {
        this.jumpHeld = false;
        v.addScaledVector(n, 2.2 + 2.8 * this.compress);
        this.grounded = false; this.airTime = 0;
        this.pos.y += 0.05;
        this.events.push('jump');
        this.compress = 0;
      }
      if (!inp.jump) this.compress *= Math.exp(-dt * 6);
    } else {
      // en l'air
      const v = this.vel;
      const speed = v.length();
      v.y -= G * dt;
      const cda = 0.5 - 0.25 * this.tuck;
      v.multiplyScalar(1 - (0.5 * 1.2 * cda / 80) * speed * dt);
      this.yaw += -steer * 2.6 * dt;
      this.airTime += dt;
      this.pos.addScaledVector(v, dt);
      this.leanAngle *= Math.exp(-dt * 3);
      const ty = hf.height(this.pos.x, this.pos.z);
      if (this.pos.y <= ty) {
        hf.normal(this.pos.x, this.pos.z, _n);
        const n = this.normal.set(_n.x, _n.y, _n.z);
        const vn = v.dot(n);
        const impact = Math.max(0, -vn);
        v.addScaledVector(n, -vn);
        this.pos.y = ty;
        this.grounded = true;
        this.lastLanding = impact;
        this.compress = -Math.min(1, impact / 9);
        // réception : skis alignés avec la vitesse ?
        _d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        _v.copy(v).setY(0);
        const sp = _v.length();
        const align = sp > 1 ? Math.abs(_d.dot(_v) / sp) : 1;
        if (impact > 15 || (sp > 9 && align < 0.4)) this.crash(impact > 15 ? 'Réception trop violente' : 'Réception de travers');
        else {
          v.multiplyScalar(1 - Math.min(0.25, impact * 0.015));
          if (impact > 3) this.events.push('land');
          // alignement doux des skis sur la trajectoire
          if (sp > 2 && align > 0.4) {
            const target = Math.atan2(_v.x, _v.z);
            const fwd = _d.dot(_v) >= 0 ? target : target + Math.PI;
            let dy = fwd - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            this.yaw += dy * 0.5;
          }
        }
      }
    }
    // marche arrière impossible : si on recule, les skis pivotent dans le sens de la pente
    _d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (this.grounded && this.vel.dot(_d) < -1.5) this.yaw += Math.PI;
    this.collide(false);
    this.compress += (0 - this.compress) * Math.min(1, dt * 4);
  }

  private collide(crashed: boolean) {
    const hf = this.hf;
    // bords de la carte
    const lim = hf.half - 40;
    if (Math.abs(this.pos.x) > lim || Math.abs(this.pos.z) > lim) {
      this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
      this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));
      this.vel.multiplyScalar(0.3);
      this.pos.y = hf.height(this.pos.x, this.pos.z);
    }
    // arbres
    const near = this.forest.nearest(this.pos.x, this.pos.z, 2.0);
    if (near.i >= 0) {
      const h = this.forest.hs[near.i];
      const r = 0.35 + Math.min(0.7, h * 0.035);
      if (near.d < r && this.pos.y < hf.height(this.pos.x, this.pos.z) + h * 0.8) {
        const dx = this.pos.x - this.forest.xs[near.i], dz = this.pos.z - this.forest.zs[near.i];
        const l = Math.hypot(dx, dz) || 1;
        this.pos.x = this.forest.xs[near.i] + dx / l * r;
        this.pos.z = this.forest.zs[near.i] + dz / l * r;
        const sp = this.speed;
        const vn = (this.vel.x * dx + this.vel.z * dz) / l;
        if (vn < 0) { this.vel.x -= vn * dx / l * 1.3; this.vel.z -= vn * dz / l * 1.3; }
        if (!crashed && sp > 6) this.crash('Sapin !');
        this.vel.multiplyScalar(0.6);
      }
    }
    // bâtiments
    if (this.mask.sample(this.pos.x, this.pos.z, 3) > 0.75) {
      const sp = this.speed;
      this.pos.addScaledVector(this.vel, -1 / 60 * 2);
      this.vel.multiplyScalar(-0.25);
      this.pos.y = hf.height(this.pos.x, this.pos.z);
      if (!crashed && sp > 6) this.crash('Bâtiment !');
    }
  }

  /** met à jour le modèle 3D (appelé une fois par image) */
  updateModel(dt: number) {
    const m = this.model;
    m.root.position.copy(this.pos);
    // orientation : axe Y = normale lissée, avant = cap
    const targetUp = this.grounded ? this.normal : _v.set(0, 1, 0);
    this.upSmooth.lerp(targetUp, Math.min(1, dt * 10)).normalize();
    const up = this.upSmooth;
    _d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _d.addScaledVector(up, -_d.dot(up)).normalize();
    _l.crossVectors(up, _d);
    const mat = new THREE.Matrix4().makeBasis(_l, up, _d);
    m.root.quaternion.setFromRotationMatrix(mat);
    if (this.crashT > 0) {
      const q = new THREE.Quaternion().setFromEuler(this.tumble);
      m.root.quaternion.multiply(q);
      m.root.position.y += 0.3;
    }
    const crouchT = 0.15 + this.carve * 0.35 + Math.max(0, -this.compress) * 0.6 + Math.max(0, this.compress) * 0.5 + (this.grounded ? 0 : 0.25);
    this.crouch += (crouchT - this.crouch) * Math.min(1, dt * 8);
    m.pose(this.crouch, -this.leanAngle, this.tuck, this.t, this.push, this.brake);
  }
}
