import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HeightField, Lift, MaskField } from './data';
import { Forest } from './trees';
import { mergeStatic } from './merge';

export interface LiftRuntime {
  lift: Lift;
  top: THREE.Vector3; bottom: THREE.Vector3; topDir: THREE.Vector3;
  update(t: number, cam: THREE.Vector3, vehDist?: number): void;
}

const TYPE_LABEL: Record<string, string> = { chair_lift: 'TÉLÉSIÈGE', drag_lift: 'TÉLÉSKI', platter: 'TÉLÉSKI', 't-bar': 'TÉLÉSKI', gondola: 'TÉLÉCABINE', cable_car: 'TÉLÉPHÉRIQUE' };
const SEAT_COLORS = [0x1d4e89, 0xb3261e, 0x2f6f3e, 0x3a3f47, 0xd9822b];

function colorGeo(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c);
  const n = ng.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (ng.attributes.uv) ng.deleteAttribute('uv');
  return ng;
}

function chairGeometry(type: string, seat: number): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [];
  const metal = 0x5d636b;
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, c: number, rx = 0) => { g.rotateX(rx); g.translate(x, y, z); P.push(colorGeo(g, c)); };
  if (type === 'drag_lift' || type === 'platter' || type === 't-bar') {
    add(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 5), 0, -1.1, 0, metal);
    add(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 10), 0, -2.2, 0, seat);
  } else if (type === 'gondola' || type === 'cable_car') {
    add(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), 0, -0.8, 0, metal);
    add(new THREE.BoxGeometry(1.8, 2.0, 1.6), 0, -2.6, 0, seat);
    add(new THREE.BoxGeometry(1.82, 0.7, 1.62), 0, -2.3, 0, 0x22303c);
  } else {
    add(new THREE.BoxGeometry(0.25, 0.18, 0.3), 0, 0, 0, 0x2b2f36);                       // pince
    add(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 6), 0, -1.0, 0, metal);               // suspente
    add(new THREE.BoxGeometry(0.06, 0.06, 0.7), 0, -2.0, -0.15, metal);
    add(new THREE.BoxGeometry(2.5, 0.12, 0.55), 0, -2.35, 0.08, seat);                    // assise
    add(new THREE.BoxGeometry(2.5, 0.6, 0.1), 0, -2.0, -0.22, seat, -0.12);              // dossier
    add(new THREE.BoxGeometry(2.5, 0.05, 0.05), 0, -1.72, 0.55, metal);                  // garde-corps
    add(new THREE.BoxGeometry(2.5, 0.04, 0.04), 0, -2.55, 0.62, metal);                  // repose-skis
    for (const x of [-1.2, 1.2]) add(new THREE.BoxGeometry(0.05, 0.75, 0.05), x, -2.05, -0.2, metal);
  }
  return mergeGeometries(P);
}

/** skieur assis (blanc = teinté par instanceColor) */
function riderGeometry(): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, c: number) => { g.translate(x, y, z); P.push(colorGeo(g, c)); };
  add(new THREE.BoxGeometry(0.4, 0.55, 0.26), 0, -1.98, -0.06, 0xffffff);     // buste
  add(new THREE.SphereGeometry(0.13, 10, 8), 0, -1.55, -0.02, 0xe8e8e8);      // casque
  add(new THREE.BoxGeometry(0.2, 0.06, 0.06), 0, -1.56, 0.1, 0xffa21c);      // masque
  for (const x of [-0.11, 0.11]) {
    add(new THREE.BoxGeometry(0.15, 0.14, 0.48), x, -2.24, 0.2, 0x2a2a30);   // cuisses
    add(new THREE.BoxGeometry(0.14, 0.42, 0.14), x, -2.5, 0.42, 0x2a2a30);   // tibias
    add(new THREE.BoxGeometry(0.14, 0.14, 0.3), x, -2.72, 0.5, 0x202020);    // chaussures
    add(new THREE.BoxGeometry(0.09, 0.03, 1.65), x, -2.8, 0.55, 0xd0d0d0);   // skis
    add(new THREE.CylinderGeometry(0.055, 0.05, 0.34, 6), x * 2.2, -1.95, 0.05, 0xffffff); // bras
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 6).rotateX(Math.PI / 2), x * 2.2, -2.1, 0.25, 0xffffff); // avant-bras
    add(new THREE.SphereGeometry(0.05, 6, 5), x * 2.2, -2.1, 0.42, 0x1a1a1a);   // gants
    add(new THREE.CylinderGeometry(0.008, 0.008, 1.1, 4).rotateX(0.35), x * 2.6, -2.55, 0.62, 0xc0c4ca); // bâtons
  }
  add(new THREE.SphereGeometry(0.1, 10, 8), 0, -1.6, 0.03, 0xd9a383);           // visage
  return mergeGeometries(P);
}

function stationSign(text: string, type: string): THREE.Mesh {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 192;
  const x = c.getContext('2d')!;
  x.fillStyle = '#16324f'; x.fillRect(0, 0, 1024, 192);
  x.fillStyle = '#ffffff'; x.font = '600 44px system-ui, sans-serif'; x.textAlign = 'center';
  x.fillText(TYPE_LABEL[type] ?? 'REMONTÉE', 512, 66);
  let size = 92; x.font = `800 ${size}px system-ui, sans-serif`;
  while (x.measureText(text.toUpperCase()).width > 960 && size > 40) { size -= 4; x.font = `800 ${size}px system-ui, sans-serif`; }
  x.fillText(text.toUpperCase(), 512, 160);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(6, 1.125), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
}

export function makeLifts(lifts: Lift[], hf: HeightField, scene: THREE.Object3D, mask: MaskField, forest: Forest): LiftRuntime[] {
  const out: LiftRuntime[] = [];
  const metal = new THREE.MeshStandardMaterial({ color: 0x8c949e, roughness: 0.45, metalness: 0.65 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.5, metalness: 0.5 });
  const vcol = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
  const stationMat = new THREE.MeshStandardMaterial({ color: 0x8f9aa6, roughness: 0.6, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2a38, roughness: 0.15, metalness: 0.6 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.8 });
  const padMat = new THREE.MeshStandardMaterial({ color: 0xc8242b, roughness: 0.7 });
  const cableMat = new THREE.LineBasicMaterial({ color: 0x15171a });
  const riderGeo = riderGeometry();
  const riderMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const JACKETS = [0x1f6fe0, 0x2e9d57, 0xf2b705, 0xff6f3c, 0x7b3fe4, 0x0fb5c9, 0xe63978, 0x333a44, 0xf5f5f5, 0xa4161a];
  let li = 0;
  for (const lift of lifts) {
    li++;
    let pts = lift.pts.filter(p => hf.inside(p[0], p[1], 5));
    if (pts.length < 2) continue;
    // nœuds trop proches des gares = mécanique interne, on les ignore
    const a0 = pts[0], a1 = pts[pts.length - 1];
    pts = pts.filter((p, i) => i === 0 || i === pts.length - 1 ||
      (Math.hypot(p[0] - a0[0], p[1] - a0[1]) > 18 && Math.hypot(p[0] - a1[0], p[1] - a1[1]) > 18));
    const drag = ['drag_lift', 'platter', 't-bar'].includes(lift.type);
    const towerH = drag ? 6 : lift.type === 'gondola' ? 14 : 10;
    const gap = drag ? 0.0 : 2.7;
    const tops: THREE.Vector3[] = pts.map(p => new THREE.Vector3(p[0], hf.height(p[0], p[1]) + towerH, p[1]));
    tops[0].y = hf.height(pts[0][0], pts[0][1]) + (drag ? 4 : 6);
    tops[tops.length - 1].y = hf.height(a1[0], a1[1]) + (drag ? 4 : 6);
    const g = new THREE.Group();
    const towerGeo = new THREE.CylinderGeometry(0.3, 0.45, 1, 10);
    const armGeo = new THREE.BoxGeometry(gap * 2 + 1.0, 0.35, 0.45);
    const sheaveGeo = new THREE.BoxGeometry(0.3, 0.35, 2.4);
    const padGeo = new THREE.CylinderGeometry(0.85, 0.85, 2.6, 14);
    for (let i = 1; i < tops.length - 1; i++) {
      const t = tops[i];
      const ground = hf.height(t.x, t.z) - 1;
      const m = new THREE.Mesh(towerGeo, metal);
      m.scale.set(1, t.y - ground, 1); m.position.set(t.x, (t.y + ground) / 2, t.z);
      m.castShadow = true; g.add(m);
      const dir = tops[i + 1].clone().sub(tops[i - 1]); dir.y = 0; dir.normalize();
      const head = new THREE.Group();
      head.position.set(t.x, t.y + 0.3, t.z); head.rotation.y = Math.atan2(dir.x, dir.z);
      const arm = new THREE.Mesh(armGeo, metal); arm.castShadow = true; head.add(arm);
      if (!drag) for (const sx of [-gap, gap]) { const sh = new THREE.Mesh(sheaveGeo, darkMetal); sh.position.set(sx, -0.25, 0); head.add(sh); }
      const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.1), darkMetal); ladder.position.set(0, 0.8, 0); head.add(ladder);
      g.add(head);
      // matelas de protection si le pylône est sur une piste
      if (mask.sample(t.x, t.z, 0) > 0.25) {
        const pad = new THREE.Mesh(padGeo, padMat); pad.position.set(t.x, hf.height(t.x, t.z) + 1.1, t.z); pad.castShadow = true; g.add(pad);
        forest.addObstacle(t.x, t.z, 1.0, 4);
      } else forest.addObstacle(t.x, t.z, 0.6, 8);
    }
    // gares
    for (const k of [0, tops.length - 1]) {
      const t = tops[k];
      const other = tops[k === 0 ? 1 : tops.length - 2];
      const dir = other.clone().sub(t); dir.y = 0; dir.normalize();
      const ground = hf.height(t.x, t.z);
      const st = new THREE.Group();
      if (drag) {
        const body = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), stationMat);
        body.position.y = 1.5; body.castShadow = true; st.add(body);
      } else {
        const H = 6;
        const base = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 5), stationMat); base.position.set(0, 1.6, -4); base.castShadow = true; base.receiveShadow = true; st.add(base);
        const win = new THREE.Mesh(new THREE.BoxGeometry(6.05, 1.0, 3.5), glass); win.position.set(0, 2.2, -4); st.add(win);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 15), roofMat); roof.position.y = H + 0.6; roof.castShadow = true; st.add(roof);
        const beam = new THREE.Mesh(new THREE.BoxGeometry(8, 0.8, 14), darkMetal); beam.position.y = H; st.add(beam);
        for (const sx of [-3.5, 3.5]) for (const sz of [-6, 6]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, H, 0.45), metal); post.position.set(sx, H / 2, sz); post.castShadow = true; st.add(post);
        }
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.35, 28), darkMetal); wheel.position.set(0, H - 0.4, k === 0 ? -1 : 1); st.add(wheel);
        const sign = stationSign(lift.name || 'Remontée', lift.type);
        sign.position.set(0, H + 1.6, 7.6); st.add(sign);
        const sign2 = sign.clone(); sign2.position.z = -7.6; sign2.rotation.y = Math.PI; st.add(sign2);
        // socle en béton jusqu'au terrain le plus bas (la gare ne pend plus dans le vide)
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(8.6, 12, 15.4), new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9 }));
        plinth.position.y = -5.6; plinth.receiveShadow = true; st.add(plinth);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.3, 15.4), new THREE.MeshStandardMaterial({ color: 0xe9edf3, roughness: 0.9 }));
        deck.position.y = 0.3; deck.receiveShadow = true; st.add(deck);
        // portique de départ
        const gate = new THREE.Mesh(new THREE.BoxGeometry(5, 0.25, 0.25), new THREE.MeshStandardMaterial({ color: 0xf2b705 }));
        gate.position.set(0, 2.4, 7); st.add(gate);
        forest.addObstacle(t.x - dir.x * 4, t.z - dir.z * 4, 3.2, 6);
      }
      st.position.set(t.x, ground - 0.3, t.z);
      st.rotation.y = Math.atan2(dir.x, dir.z);
      g.add(st);
    }
    // câbles
    const sideOf = (i: number) => {
      const a = tops[Math.max(0, i - 1)], b = tops[Math.min(tops.length - 1, i + 1)];
      const d = b.clone().sub(a); d.y = 0; d.normalize();
      return new THREE.Vector3(d.z, 0, -d.x);
    };
    const lineUp: THREE.Vector3[] = [], lineDown: THREE.Vector3[] = [];
    for (let i = 0; i < tops.length - 1; i++) {
      const a = tops[i], b = tops[i + 1];
      const sa = sideOf(i), sb = sideOf(i + 1);
      const len = a.distanceTo(b);
      const N = Math.max(2, Math.ceil(len / 6));
      for (let k = 0; k < N; k++) {
        const f = k / N;
        const sag = Math.sin(f * Math.PI) * len * 0.014;
        const p = a.clone().lerp(b, f); p.y -= sag;
        const s = sa.clone().lerp(sb, f).normalize();
        lineUp.push(p.clone().addScaledVector(s, -gap));
        lineDown.push(p.clone().addScaledVector(s, gap));
      }
    }
    lineUp.push(tops[tops.length - 1].clone().addScaledVector(sideOf(tops.length - 1), -gap));
    lineDown.push(tops[tops.length - 1].clone().addScaledVector(sideOf(tops.length - 1), gap));
    const cablePts: number[] = [];
    for (const L of [lineUp, lineDown]) for (let i = 0; i < L.length - 1; i++) cablePts.push(L[i].x, L[i].y, L[i].z, L[i + 1].x, L[i + 1].y, L[i + 1].z);
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
    g.add(new THREE.LineSegments(cg, cableMat));

    // véhicules
    const loop = [...lineUp, ...lineDown.slice().reverse()];
    const cum: number[] = [0];
    for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1] + loop[i].distanceTo(loop[i - 1]));
    const total = cum[cum.length - 1];
    let upLen = 0; for (let i = 1; i < lineUp.length; i++) upLen += lineUp[i].distanceTo(lineUp[i - 1]);
    const spacing = drag ? 14 : lift.type === 'gondola' ? 40 : 20;
    const n = Math.floor(total / spacing);
    const seatCol = SEAT_COLORS[li % SEAT_COLORS.length];
    const chairs = new THREE.InstancedMesh(chairGeometry(lift.type, seatCol), vcol, n);
    chairs.castShadow = true; chairs.frustumCulled = false;
    g.add(chairs);
    const seated = lift.type === 'chair_lift';
    const riders = seated ? new THREE.InstancedMesh(riderGeo, riderMat, n * 4) : null;
    const riderSeats: number[][] = [];
    const riderCols: number[] = [];
    if (riders) {
      riders.castShadow = true; riders.frustumCulled = false;
      const c = new THREE.Color();
      let rs = li * 977;
      const rr = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < n; i++) {
        const k = rr() < 0.25 ? 0 : 1 + Math.floor(rr() * 3);
        const seats = [-0.9, -0.3, 0.3, 0.9].sort(() => rr() - 0.5).slice(0, k);
        riderSeats.push(seats);
        for (let j = 0; j < 4; j++) riderCols.push(JACKETS[Math.floor(rr() * JACKETS.length)]);
        riders.setColorAt(i, c.setHex(riderCols[i * 4]));
      }
      g.add(riders);
    }
    const speed = drag ? 3 : lift.type === 'gondola' ? 5 : 2.5;
    const m4 = new THREE.Matrix4(), m5 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const tmpC = new THREE.Color();
    let seg = 0;
    const sample = (s: number, outP: THREE.Vector3): number => {
      s = ((s % total) + total) % total;
      if (!(cum[seg] <= s && cum[seg + 1] >= s)) {
        let lo = 0, hi = cum.length - 1;
        while (hi - lo > 1) { const mI = (lo + hi) >> 1; if (cum[mI] <= s) lo = mI; else hi = mI; }
        seg = lo;
      }
      const f = (s - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]);
      outP.copy(loop[seg]).lerp(loop[seg + 1], f);
      const d = loop[seg + 1].clone().sub(loop[seg]);
      return Math.atan2(d.x, d.z);
    };
    const bottom = new THREE.Vector3(a0[0], hf.height(a0[0], a0[1]), a0[1]);
    const top = new THREE.Vector3(a1[0], hf.height(a1[0], a1[1]), a1[1]);
    const prev = pts[pts.length - 2];
    const topDir = new THREE.Vector3(a1[0] - prev[0], 0, a1[1] - prev[1]).normalize();
    const center = bottom.clone().lerp(top, 0.5);
    const radius = bottom.distanceTo(top) / 2 + 200;
    mergeStatic(g);
    scene.add(g);
    out.push({
      lift, top, bottom, topDir,
      update(t: number, cam: THREE.Vector3, vehDist = 450) {
        const visible = cam.distanceTo(center) < radius + 1800;
        g.visible = visible;
        if (!visible) return;
        // sièges et passagers seulement près de la caméra (au-delà : 1 ou 2 pixels, inutile de les dessiner)
        const cd2 = vehDist * vehDist, rd2 = cd2 * 0.45;
        let nr = 0, nc = 0;
        for (let i = 0; i < n; i++) {
          const s = (((t * speed + i * spacing) % total) + total) % total;
          const yaw = sample(s, p);
          const d2 = p.distanceToSquared(cam);
          if (d2 > cd2) continue;
          q.setFromAxisAngle(up, yaw);
          m4.compose(p, q, one);
          chairs.setMatrixAt(nc++, m4);
          if (riders && d2 < rd2 && s > 8 && s < upLen - 8) {
            riderSeats[i].forEach((sx, j) => {
              m5.makeTranslation(sx, 0, 0).premultiply(m4);
              riders.setMatrixAt(nr, m5);
              riders.setColorAt(nr, tmpC.setHex(riderCols[i * 4 + j]));
              nr++;
            });
          }
        }
        chairs.count = nc;
        chairs.instanceMatrix.needsUpdate = true;
        if (riders) { riders.count = nr; riders.instanceMatrix.needsUpdate = true; if (riders.instanceColor) riders.instanceColor.needsUpdate = true; }
      },
    });
  }
  return out;
}
