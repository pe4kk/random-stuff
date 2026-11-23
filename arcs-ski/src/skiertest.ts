// page de test (dev) : poses du skieur articulé
import * as THREE from 'three';
import { loadSkier } from './skinrig';
import { SkierModel } from './skier';
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(innerWidth, innerHeight); document.body.appendChild(r.domElement);
r.shadowMap.enabled = true; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.9;
const sc = new THREE.Scene(); sc.background = new THREE.Color(0x9fc4e0);
const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
const p = new URLSearchParams(location.search);
const view = p.get('view') ?? 'side';
sc.add(new THREE.HemisphereLight(0xcfe3ff, 0x8899aa, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(3, 6, 4); sun.castShadow = true; sc.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0xf2f5fa })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sc.add(ground);
(window as any).ready = false;
loadSkier('./data/skier.json').then(() => {
  const poses = [
    { crouch: 0.15, lean: 0, tuck: 0, push: 0, brake: 0 },
    { crouch: 0.5, lean: 0.5, tuck: 0, push: 0, brake: 0 },
    { crouch: 0.3, lean: 0, tuck: 1, push: 0, brake: 0 },
    { crouch: 0.3, lean: -0.4, tuck: 0, push: 0, brake: 0, plant: 0.5, side: 1 },
    { crouch: 0.2, lean: 0, tuck: 0, push: 0, brake: 1 },
  ];
  poses.forEach((ps, i) => {
    const m = new SkierModel({ jacket: [0xd8262c, 0x1e88e5, 0xffc107, 0x2e7d32, 0x8e24aa][i], pants: 0x1b1f2a });
    m.root.position.set((i - 2) * 1.6, 0, 0);
    sc.add(m.root);
    m.root.updateMatrixWorld(true);
    m.pose(ps.crouch, ps.lean, ps.tuck, 0.3, ps.push, ps.brake, (ps as any).plant ?? 0, (ps as any).side ?? 0, 0);
  });
  if (view === 'side') { cam.position.set(9, 1.6, 4); }
  else if (view === 'front') { cam.position.set(0, 1.4, 11); }
  else if (view === 'close') { cam.position.set(1.5, 1.4, 2.6); cam.lookAt(0, 0.9, 0); }
  else if (view === 'back') { cam.position.set(0, 2.6, -9); }
  if (view !== 'close') cam.lookAt(0, 0.8, 0);
  r.render(sc, cam);
  (window as any).ready = true;
}).catch(e => { document.body.textContent = String(e?.stack ?? e); (window as any).ready = true; });
