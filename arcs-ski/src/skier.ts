import * as THREE from 'three';
import { HeightField, MaskField } from './data';
import { Forest } from './trees';

export interface SkiInput { steer: number; tuck: number; brake: number; jump: boolean; push: number }

const G = 9.81;
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _l = new THREE.Vector3(), _a = new THREE.Vector3();
const _n = { x: 0, y: 1, z: 0 };

// ----------------------------------------------------------------- modèle 3D
function limb(r0: number, r1: number, len: number, mat: THREE.Material, shadow = true) {
  const g = new THREE.CylinderGeometry(r1, r0, len, 10, 1);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat); m.castShadow = shadow;
  return m;
}
function ball(r: number, mat: THREE.Material) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat); m.castShadow = true; return m; }

/** ski avec spatule relevée, talon et ligne de cote (géométrie déformée) */
function skiGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 24);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) * 1.7;          // longueur 1,70 m
    const t = z / 0.85;                 // -1 (talon) .. 1 (spatule)
    let w = 0.105 - 0.022 * Math.cos(t * Math.PI / 2);   // plus étroit au patin
    let y = p.getY(i) * 0.022;
    if (t > 0.72) { const k = (t - 0.72) / 0.28; y += k * k * 0.11; w *= 1 - k * k * 0.35; }
    if (t < -0.85) { const k = (-t - 0.85) / 0.15; y += k * k * 0.03; }
    p.setXYZ(i, p.getX(i) * w, y + 0.011, z);
  }
  g.computeVertexNormals();
  return g;
}

export class SkierModel {
  root = new THREE.Group();      // aux pieds, orienté selon la pente
  lean = new THREE.Group();      // inclinaison dans les virages
  hips = new THREE.Group();
  torso = new THREE.Group();
  head = new THREE.Group();
  legs: { thigh: THREE.Group; shin: THREE.Group }[] = [];
  arms: { upper: THREE.Group; lower: THREE.Group; pole: THREE.Group }[] = [];
  skis: THREE.Group[] = [];
  readonly L = 0.46;

  constructor(colors: { jacket?: number; pants?: number; helmet?: number; ski?: number } = {}, lite = false) {
    const jacket = new THREE.MeshStandardMaterial({ color: colors.jacket ?? 0xd8262c, roughness: 0.55 });
    const jacket2 = new THREE.MeshStandardMaterial({ color: new THREE.Color(colors.jacket ?? 0xd8262c).multiplyScalar(0.6), roughness: 0.6 });
    const pants = new THREE.MeshStandardMaterial({ color: colors.pants ?? 0x1b1f2a, roughness: 0.75 });
    const helmet = new THREE.MeshStandardMaterial({ color: colors.helmet ?? 0xf5f5f5, roughness: 0.25, metalness: 0.1 });
    const goggle = new THREE.MeshStandardMaterial({ color: 0xff9a1c, roughness: 0.05, metalness: 0.9, emissive: 0x2a1000 });
    const skiMat = new THREE.MeshStandardMaterial({ color: colors.ski ?? 0x1565ff, roughness: 0.3, metalness: 0.25 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.35, metalness: 0.1 });
    const buckle = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.3, metalness: 0.9 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xc7ccd4, roughness: 0.25, metalness: 0.85 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a383, roughness: 0.7 });

    this.root.add(this.lean);
    const skiGeo = skiGeometry();
    for (const sx of [-0.12, 0.12]) {
      const ski = new THREE.Group();
      const body = new THREE.Mesh(skiGeo, skiMat); body.position.z = 0.05; body.castShadow = true; ski.add(body);
      const bind = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.42), buckle); bind.position.set(0, 0.04, 0); ski.add(bind);
      // chaussure : coque + tige + boucles
      const shell = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.32), bootMat); shell.position.set(0, 0.09, 0.02); shell.castShadow = true; ski.add(shell);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.075, 0.24, 10), bootMat); cuff.position.set(0, 0.24, -0.03); cuff.rotation.x = 0.25; cuff.castShadow = true; ski.add(cuff);
      if (!lite) for (const by of [0.16, 0.26]) { const bk = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.02, 0.05), buckle); bk.position.set(0, by, 0.03); ski.add(bk); }
      ski.position.x = sx;
      this.lean.add(ski); this.skis.push(ski);
    }
    this.lean.add(this.hips);
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), pants); pelvis.scale.set(1.2, 0.8, 0.95); pelvis.castShadow = true; this.hips.add(pelvis);
    for (const sx of [-0.11, 0.11]) {
      const thigh = new THREE.Group(); thigh.position.set(sx, 0, 0);
      thigh.add(limb(0.085, 0.065, this.L, pants));
      const shin = new THREE.Group(); shin.position.y = -this.L;
      shin.add(limb(0.068, 0.07, this.L - 0.05, pants));
      if (!lite) shin.add(ball(0.07, pants));
      thigh.add(shin);
      this.hips.add(thigh);
      this.legs.push({ thigh, shin });
    }
    this.hips.add(this.torso);
    // veste : torse évasé aux épaules, bande de couleur, col
    const chestG = new THREE.CylinderGeometry(0.2, 0.16, 0.5, 14, 1); chestG.translate(0, 0.27, 0);
    const chest = new THREE.Mesh(chestG, jacket); chest.scale.set(1.05, 1, 0.72); chest.castShadow = true; this.torso.add(chest);
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), jacket); shoulders.scale.set(1.12, 0.45, 0.75); shoulders.position.y = 0.51; shoulders.castShadow = true; this.torso.add(shoulders);
    if (!lite) {
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.175, 0.07, 14), jacket2); stripe.scale.set(1.06, 1, 0.74); stripe.position.y = 0.25; this.torso.add(stripe);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.1, 10), jacket2); collar.position.y = 0.6; this.torso.add(collar);
    }
    this.head.position.set(0, 0.74, 0.02); this.torso.add(this.head);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), skin); face.position.set(0, -0.02, 0.01); this.head.add(face);
    const hg = new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const hm = new THREE.Mesh(hg, helmet); hm.position.y = 0.0; hm.castShadow = true; this.head.add(hm);
    const gm = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.06, 16, 1, true, -1.2, 2.4), goggle); gm.position.set(0, -0.005, 0.0); gm.rotation.y = 0; this.head.add(gm);
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.04, 16, 1, true, 1.2, Math.PI * 2 - 2.4), new THREE.MeshStandardMaterial({ color: 0x111111 })); strap.position.y = -0.005; this.head.add(strap);
    for (const sx of [-0.23, 0.23]) {
      const upper = new THREE.Group(); upper.position.set(sx, 0.5, 0);
      if (!lite) upper.add(ball(0.065, jacket));
      upper.add(limb(0.06, 0.055, 0.3, jacket));
      const lower = new THREE.Group(); lower.position.y = -0.3;
      if (!lite) lower.add(ball(0.055, jacket));
      lower.add(limb(0.052, 0.048, 0.26, jacket));
      const hand = ball(0.05, glove); hand.position.y = -0.28; hand.scale.set(1, 1.2, 1); lower.add(hand);
      upper.add(lower);
      const pole = new THREE.Group(); pole.position.y = -0.28;
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.018, 0.14, 6), glove); grip.position.y = -0.02; pole.add(grip);
      const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.007, 1.15, 5), poleMat);
      pm.position.y = -0.6; pm.castShadow = true; pole.add(pm);
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 10), glove);
      basket.position.y = -1.07; pole.add(basket);
      lower.add(pole);
      this.torso.add(upper);
      this.arms.push({ upper, lower, pole });
    }
  }

  /** pose : flexion, inclinaison, schuss, temps, poussée, freinage, planté de bâton (-1 gauche / +1 droite, 0..1), chute */
  pose(crouch: number, lean: number, tuck: number, t: number, push: number, brake: number, plant = 0, plantSide = 0, crash = 0) {
    const a = 0.42 + crouch * 0.6 + tuck * 0.45;
    const L = this.L;
    this.hips.position.set(0, 0.24 + 2 * L * Math.cos(a) * 0.97, -Math.sin(a) * 0.17);
    const plough = brake * 0.13;
    this.skis[0].rotation.y = plough; this.skis[1].rotation.y = -plough;
    this.skis[0].position.x = -0.14 - brake * 0.07; this.skis[1].position.x = 0.14 + brake * 0.07;
    // angulation : genoux vers l'intérieur du virage, hanches décalées
    const ang = lean * 0.55;
    this.hips.position.x = -lean * 0.12;
    this.legs.forEach((leg, i) => {
      leg.thigh.rotation.x = -a + (crash ? Math.sin(t * 9 + i) * crash : 0);
      leg.thigh.rotation.z = -ang + (crash ? (i ? 0.5 : -0.5) * crash : 0);
      leg.shin.rotation.x = 2 * a;
    });
    this.lean.rotation.z = lean;
    this.torso.rotation.z = -lean * 0.55;
    this.torso.rotation.x = 0.18 + a * 0.42 + tuck * 0.6;
    this.head.rotation.x = -(0.18 + a * 0.42 + tuck * 0.6) * 0.75;   // regard vers l'avant
    const swing = Math.sin(t * 5) * push;
    this.arms.forEach((arm, i) => {
      const s = i === 0 ? -1 : 1;
      // côté du planté : bras intérieur au virage
      const pl = plantSide === s ? Math.sin(Math.min(1, plant) * Math.PI) : 0;
      arm.upper.rotation.x = -0.55 - tuck * 0.85 + swing * 0.9 - pl * 0.55;
      arm.upper.rotation.z = s * (0.3 - tuck * 0.18) + (crash ? s * Math.sin(t * 11 + i) * 1.2 * crash : 0);
      arm.lower.rotation.x = -0.8 - tuck * 0.55 + pl * 0.35;
      arm.pole.rotation.x = 1.3 + tuck * 0.95 - swing * 0.7 - pl * 0.9;
      arm.pole.rotation.z = -s * 0.12;
    });
  }
}

// ---------------------------------------------------------------- physique
export class Skier {
  model: SkierModel;
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
  plant = 1; plantSide = 0; private turnSign = 0; private edgeLoss = 0; private warned = false;

  constructor(public hf: HeightField, public mask: MaskField, public forest: Forest, model?: SkierModel | null) {
    this.model = model ?? new SkierModel();
  }

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
    this.plant = Math.min(1, this.plant + dt / 0.45);
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
      const mu = 0.045 + 0.035 * powder + 0.15 * this.brake + 0.12 * skid;
      const cda = 0.6 - 0.28 * this.tuck + 0.25 * this.brake;
      const drag = mu * N + (0.5 * 1.2 * cda / 80) * speed * speed + powder * (0.01 * speed * speed + 0.25 * speed);
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
      // planté de bâton au changement de virage
      const sgn = steer > 0.3 ? 1 : steer < -0.3 ? -1 : 0;
      if (sgn !== 0 && sgn !== this.turnSign && speed > 2.5) { this.plant = 0; this.plantSide = sgn > 0 ? -1 : 1; }
      if (sgn !== 0) this.turnSign = sgn;
      // perte de carre : virage trop serré à grande vitesse
      if (skid > 0.7 && speed > 17 && this.brake < 0.3) this.edgeLoss += dt; else this.edgeLoss = Math.max(0, this.edgeLoss - dt * 2);
      // signe avant-coureur : vibration, gerbe et crissement avant la chute ; pas de chute sur les replats
      if (this.edgeLoss > 0.15 && !this.warned) { this.warned = true; this.events.push('edgewarn'); }
      if (this.edgeLoss > 0.08) this.leanAngle += (Math.random() - 0.5) * 0.12;
      if (this.edgeLoss === 0) this.warned = false;
      if (this.edgeLoss > 0.6 && n.y < 0.975) { this.edgeLoss = 0; this.warned = false; this.crash('Perte de carre !'); }

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
    if (this.grounded && this.crashT <= 0 && this.vel.dot(_d) < -1.0) {
      const target = Math.atan2(this.vel.x, this.vel.z);
      let dy = target - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += Math.sign(dy) * Math.min(Math.abs(dy), dt * 4);
    }
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
    // arbres et obstacles
    const near = this.forest.nearest(this.pos.x, this.pos.z, 2.0);
    if (near.i >= 0) {
      const f = this.forest;
      const h = f.oh(near.i), r = near.rad;
      if (near.d < r && this.pos.y < hf.height(this.pos.x, this.pos.z) + h * 0.9) {
        const ox = f.ox(near.i), oz = f.oz(near.i);
        const dx = this.pos.x - ox, dz = this.pos.z - oz;
        const l = Math.hypot(dx, dz) || 1;
        this.pos.x = ox + dx / l * r;
        this.pos.z = oz + dz / l * r;
        const sp = this.speed;
        const vn = (this.vel.x * dx + this.vel.z * dz) / l;
        if (vn < 0) { this.vel.x -= vn * dx / l * 1.3; this.vel.z -= vn * dz / l * 1.3; }
        if (!crashed && sp > 6 && vn < -3) this.crash(near.i < f.count ? 'Sapin !' : 'Obstacle !');
        this.vel.multiplyScalar(0.7);
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
    m.pose(this.crouch, -this.leanAngle, this.tuck, this.t, this.push, this.brake, this.plant, this.plantSide, this.crashT > 0 ? 1 : 0);
    // enfoncement dans la poudreuse
    if (this.grounded && this.crashT <= 0) m.root.position.y -= 0.14 * (1 - this.onPiste);
  }
}
