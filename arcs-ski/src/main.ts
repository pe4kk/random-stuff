import * as THREE from 'three';
import { GameData, HeightField, MaskField, Piste, loadAll } from './data';
import { CoreTerrain, makeBackdrop, makeSnowMaterial } from './terrain';
import { Forest } from './trees';
import { DIFF_COLOR, DIFF_LABEL, LiftRuntime, makeBuildings, makeLifts, makePistePoles, makeSigns } from './world';
import { Skier } from './skier';
import { Tracks, Spray, makeSky } from './effects';
import { Input } from './input';
import { Crowd, buildRoutes } from './npc';
import { makeSnowGuns, makeRocks, makeFunicular } from './props';
import { PisteMap } from './map';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SkiAudio } from './audio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ----------------------------------------------------------- chargement
const bar = $('load-bar'), loadLabel = $('load-label');
loadAll((f, label) => { bar.style.width = (f * 100).toFixed(0) + '%'; loadLabel.textContent = label; })
  .then(start)
  .catch((e) => { loadLabel.textContent = 'Erreur de chargement : ' + e.message; console.error(e); });

function start(data: GameData) {
  loadLabel.textContent = 'Construction du domaine…';
  // laisse le navigateur afficher le texte
  setTimeout(() => build(data), 30);
}

// ----------------------------------------------------------- pistes : recherche rapide
class PisteIndex {
  private grid = new Map<number, { p: Piste; ax: number; az: number; bx: number; bz: number }[]>();
  private readonly c = 32;
  constructor(pistes: Piste[]) {
    for (const p of pistes) {
      if (!p.name && p.area) continue;
      for (let i = 0; i < p.pts.length - 1; i++) {
        const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1];
        const seg = { p, ax, az, bx, bz };
        const i0 = Math.floor(Math.min(ax, bx) / this.c), i1 = Math.floor(Math.max(ax, bx) / this.c);
        const j0 = Math.floor(Math.min(az, bz) / this.c), j1 = Math.floor(Math.max(az, bz) / this.c);
        for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) {
          const k = a * 100000 + b;
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k)!.push(seg);
        }
      }
    }
  }
  nearest(x: number, z: number, r: number): Piste | null {
    let best: Piste | null = null, bd = r;
    const i0 = Math.floor((x - r) / this.c), i1 = Math.floor((x + r) / this.c);
    const j0 = Math.floor((z - r) / this.c), j1 = Math.floor((z + r) / this.c);
    for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) {
      const L = this.grid.get(a * 100000 + b); if (!L) continue;
      for (const s of L) {
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
        const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t);
        const tol = s.p.area ? 0 : 0;
        if (d - tol < bd && s.p.name) { bd = d; best = s.p; }
      }
    }
    return best;
  }
}

function build(data: GameData) {
  const meta = data.features.meta;
  const hf = new HeightField(data.core, meta.coreN, meta.coreHalf);
  const midHF = new HeightField(data.mid, meta.midN, meta.midHalf);
  const farHF = new HeightField(data.far, meta.farN, meta.farHalf);
  const mask = new MaskField(data.mask, meta.coreHalf);

  // ------------------------------------------------------- rendu
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.56;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('game').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const fogCol = new THREE.Color(0xa9bdd6);
  scene.fog = new THREE.FogExp2(fogCol, 0.000032);
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 160000);

  // soleil d'après-midi au sud-ouest (éclaire les pentes d'Arc 1600)
  const sunDir = new THREE.Vector3(-0.62, 0.66, 0.42).normalize();
  const sun = new THREE.DirectionalLight(0xffeedd, 4.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const S = 110;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 1200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xb4cdf8, 0x9aa8bf, 1.0);
  scene.add(hemi);
  const sky = makeSky(sunDir);
  scene.add(sky);

  // ------------------------------------------------------- terrain
  const maskTex = new THREE.Texture(data.maskImage);
  maskTex.flipY = false; maskTex.colorSpace = THREE.NoColorSpace; maskTex.generateMipmaps = true;
  maskTex.minFilter = THREE.LinearMipmapLinearFilter; maskTex.anisotropy = 8; maskTex.needsUpdate = true;
  const coreMat = makeSnowMaterial('core', maskTex, meta.coreHalf);
  const core = new CoreTerrain(hf, coreMat);
  core.chunks.forEach(c => (c.mesh.castShadow = true));
  scene.add(core.group);

  const midTex = new THREE.Texture(data.midForest);
  midTex.flipY = false; midTex.colorSpace = THREE.NoColorSpace; midTex.needsUpdate = true;
  const midMat = makeSnowMaterial('mid', midTex, meta.midHalf);
  scene.add(makeBackdrop(midHF, 512, meta.coreHalf - 40, 30, midMat));
  const farMat = makeSnowMaterial('far', null, meta.farHalf);
  scene.add(makeBackdrop(farHF, 400, meta.midHalf - 300, 80, farMat));

  // ------------------------------------------------------- monde
  const forest = new Forest(data.trees, hf, mask);
  scene.add(forest.group);
  scene.add(makeBuildings(data.features.buildings, hf));
  const lifts = makeLifts(data.features.lifts, hf, scene, mask, forest);
  scene.add(makePistePoles(data.features.pistes, hf, mask));
  scene.add(makeSigns(data.features.pistes, hf));
  scene.add(makeSnowGuns(data.features.pistes, hf, mask, forest));
  scene.add(makeRocks(hf, mask, forest));
  const funi = makeFunicular(data.features.funiculars ?? [], hf);
  if (funi) scene.add(funi.group);
  const pisteIdx = new PisteIndex(data.features.pistes);

  // ------------------------------------------------------- skieur
  const skier = new Skier(hf, mask, forest);
  scene.add(skier.model.root);
  const tracks = new Tracks(10000, 0.5); scene.add(tracks.mesh);
  const spray = new Spray(); scene.add(spray.points);
  // autres skieurs + traces déjà présentes sur les pistes
  const routes = buildRoutes(data.features.pistes, lifts, hf);
  const oldTracks = new Tracks(40000, 0.9); scene.add(oldTracks.mesh);
  Crowd.pretrace(routes, hf, mask, forest, oldTracks, Math.min(60, routes.length * 3));
  const crowd = new Crowd(routes, hf, mask, forest, scene, 22, oldTracks);

  // points de téléportation : sommets des remontées
  const mb = lifts.find(l => l.lift.name === 'Mont-Blanc');
  const mbPistes = data.features.pistes.filter(p => p.name === 'Mont-Blanc' && !p.area);
  function spawnAtLift(l: LiftRuntime) {
    // départ à 10 m en aval de la gare, orienté vers la pente
    let dir = l.topDir.clone();
    // si une piste Mont-Blanc part d'ici, on suit sa direction
    if (l === mb && mbPistes.length) {
      // départ sur le premier point de la piste Mont-Blanc proche de la gare
      let best = Infinity, bp: [number, number] = [l.top.x, l.top.z], bdir = dir;
      for (const p of mbPistes) for (let i = 0; i < p.pts.length; i++) {
        const d = Math.hypot(p.pts[i][0] - l.top.x, p.pts[i][1] - l.top.z);
        if (d < best && d > 25) {
          best = d; bp = p.pts[i];
          const a = p.pts[Math.min(i, p.pts.length - 2)], b = p.pts[Math.min(i, p.pts.length - 2) + 1];
          bdir = new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize();
        }
      }
      skier.place(bp[0], bp[1], Math.atan2(bdir.x, bdir.z));
      tracks.reset(); core.warm(skier.pos); camSnap = true; chronoReset();
      return;
    } else {
      // direction de plus grande pente
      const n = { x: 0, y: 1, z: 0 };
      hf.normal(l.top.x + dir.x * 15, l.top.z + dir.z * 15, n, 8);
      const fall = new THREE.Vector3(n.x, 0, n.z);
      if (fall.length() > 0.05) dir = fall.normalize();
    }
    // départ en aval de la gare, hors des bâtiments
    let x = l.top.x + dir.x * 22, z = l.top.z + dir.z * 22;
    for (let k = 0; k < 20 && mask.sample(x, z, 3) > 0.2; k++) { x += dir.x * 5; z += dir.z * 5; }
    skier.place(x, z, Math.atan2(dir.x, dir.z));
    tracks.reset();
    core.warm(skier.pos);
    camSnap = true;
  }

  // ------------------------------------------------------- caméra
  let camMode = 0;
  let camSnap = true;
  let camZoom = 1;
  renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); camZoom = Math.min(2.5, Math.max(0.55, camZoom * (e.deltaY > 0 ? 1.1 : 1 / 1.1))); }, { passive: false });
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const camDir = new THREE.Vector3(0, 0, 1);
  let debugCam: { p: THREE.Vector3; l: THREE.Vector3 } | null = null;
  function updateCamera(dt: number) {
    if (debugCam) { camera.position.copy(debugCam.p); camera.lookAt(debugCam.l); camera.fov = 60; camera.updateProjectionMatrix(); return; }
    const sp = skier.speed;
    const head = new THREE.Vector3(Math.sin(skier.yaw), 0, Math.cos(skier.yaw));
    const vdir = skier.vel.clone().setY(0);
    const want = sp > 2.5 ? vdir.normalize().lerp(head, 0.3).normalize() : head;
    camDir.lerp(want, camSnap ? 1 : Math.min(1, dt * 2.5)).normalize();
    const p = skier.pos;
    let target: THREE.Vector3, look: THREE.Vector3;
    if (camMode === 2) {
      const h = skier.model.root.localToWorld(new THREE.Vector3(0, 1.55, 0.2));
      target = h; look = h.clone().addScaledVector(head, 10).add(new THREE.Vector3(0, -1.5, 0));
    } else {
      let dist = (camMode === 0 ? 8 + sp * 0.08 : 18) * camZoom;
      let height = (camMode === 0 ? 3.6 : 8) * camZoom;
      // ne pas se retrouver dans un sapin : on rapproche la caméra
      const full = dist;
      for (let t = 2; t <= full; t += 1) {
        const qx = p.x - camDir.x * t, qz = p.z - camDir.z * t;
        const qy = p.y + height * (t / full);
        const nb = forest.nearest(qx, qz, 4);
        if (nb.i >= 0 && nb.i < forest.count) {
          const h = forest.oh(nb.i);
          const base = hf.height(forest.ox(nb.i), forest.oz(nb.i));
          const rel = (qy - base) / h;
          const crown = h * 0.24 * Math.max(0, 1 - rel) + 0.4;
          if (rel < 1 && nb.d < crown) { dist = Math.max(2.5, t - 1); height = height * (dist / full) + 0.6; break; }
        }
      }
      target = p.clone().addScaledVector(camDir, -dist); target.y = p.y + height;
      look = p.clone().addScaledVector(camDir, 6); look.y += camMode === 0 ? 0.9 : 0.5;
    }
    const k = camSnap ? 1 : Math.min(1, dt * (camMode === 2 ? 30 : 6));
    camPos.lerp(target, k); camLook.lerp(look, camSnap ? 1 : Math.min(1, dt * 10));
    const ground = hf.height(camPos.x, camPos.z) + (camMode === 2 ? 0.3 : 1.0);
    if (camPos.y < ground) camPos.y = ground;
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    const fov = 62 + Math.min(16, sp * 0.45);
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 2);
    // léger tremblement à grande vitesse
    if (sp > 18 && skier.grounded) {
      const a = (sp - 18) * 0.0009;
      camera.rotation.z += (Math.random() - 0.5) * a;
      camera.rotation.x += (Math.random() - 0.5) * a;
    }
    camera.updateProjectionMatrix();
    camSnap = false;
    skier.model.root.visible = camMode !== 2 || skier.crashT > 0;
  }

  // ------------------------------------------------------- interface
  const hudSpeed = $('speed'), hudAlt = $('alt'), hudPiste = $('piste'), hudChrono = $('chrono'), hudMsg = $('msg');
  const tpMenu = $('teleport'), tpList = $('tp-list'), help = $('help'), pauseEl = $('pause');
  let msgT = 0;
  function message(text: string, t = 2.2) { hudMsg.textContent = text; hudMsg.classList.add('show'); msgT = t; }

  // liste de téléportation
  const tpLifts = lifts.filter(l => hf.inside(l.top.x, l.top.z, 60) && l.lift.name)
    .sort((a, b) => (a === mb ? -1 : b === mb ? 1 : b.top.y - a.top.y));
  const typeLabel: Record<string, string> = { chair_lift: 'Télésiège', drag_lift: 'Téléski', platter: 'Téléski', 't-bar': 'Téléski', gondola: 'Télécabine', cable_car: 'Téléphérique' };
  tpLifts.forEach((l, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="k">${i < 9 ? i + 1 : ''}</span><span class="n">${typeLabel[l.lift.type] ?? 'Remontée'} ${l.lift.name}</span><span class="a">${Math.round(l.top.y)} m</span>`;
    b.onclick = () => { spawnAtLift(l); toggleTp(false); };
    tpList.appendChild(b);
  });
  let tpOpen = false, paused = false;
  function toggleTp(v = !tpOpen) { tpOpen = v; tpMenu.classList.toggle('show', v); if (v) { togglePause(false); map.toggle(false); } }
  function togglePause(v = !paused) { paused = v; pauseEl.classList.toggle('show', v); if (v) refreshPause(); }
  function toggleMap(v = !map.open) { map.toggle(v); if (v) { togglePause(false); toggleTp(false); } }
  function restart() {
    togglePause(false); toggleMap(false); toggleTp(false);
    if (mb) spawnAtLift(mb);
    tracks.clear();
    message('Nouvelle descente : piste Mont-Blanc', 2);
  }
  function refreshPause() {
    $('btn-quality').textContent = `Qualité graphique : ${QUALITY[quality].name}`;
    $('btn-sound').textContent = `Son : ${audio.muted ? 'coupé' : 'activé'}`;
  }
  $('btn-resume').onclick = () => togglePause(false);
  $('btn-restart').onclick = () => restart();
  $('btn-map').onclick = () => toggleMap(true);
  $('btn-tp').onclick = () => toggleTp(true);
  $('btn-help').onclick = () => { togglePause(false); help.classList.add('show'); };
  $('btn-quality').onclick = () => { autoQ = false; applyQuality((quality + 1) % 3); refreshPause(); };
  $('btn-sound').onclick = () => { audio.setMuted(!audio.muted); refreshPause(); };
  $('map-close').onclick = () => toggleMap(false);
  help.addEventListener('click', () => help.classList.remove('show'));
  const map = new PisteMap(data.features, hf, mask, lifts, (l) => { spawnAtLift(l); toggleMap(false); message(`Sommet : ${l.lift.name}`, 2); });

  // mini-carte
  const mini = $('minimap') as HTMLCanvasElement;
  const mctx = mini.getContext('2d')!;
  const base = document.createElement('canvas'); base.width = base.height = 1024;
  {
    const b = base.getContext('2d')!;
    const im = b.createImageData(1024, 1024);
    const src = data.mask.data, n = data.mask.width;
    for (let j = 0; j < 1024; j++) for (let i = 0; i < 1024; i++) {
      const k = ((j * 2) * n + i * 2) * 4;
      const f = src[k + 1] / 255, bd = src[k + 3] / 255;
      const o = (j * 1024 + i) * 4;
      im.data[o] = 236 - f * 120 - bd * 60; im.data[o + 1] = 241 - f * 95 - bd * 60; im.data[o + 2] = 246 - f * 120 - bd * 50; im.data[o + 3] = 255;
    }
    b.putImageData(im, 0, 0);
    const toM = (v: number) => (v + meta.coreHalf) / 4;
    b.lineCap = 'round'; b.lineJoin = 'round';
    for (const p of data.features.pistes) {
      if (p.area || !(p.diff in DIFF_COLOR)) continue;
      b.strokeStyle = '#' + DIFF_COLOR[p.diff].toString(16).padStart(6, '0');
      b.lineWidth = p.name === 'Mont-Blanc' ? 4 : 2.2;
      b.beginPath(); p.pts.forEach(([x, z], i) => (i ? b.lineTo(toM(x), toM(z)) : b.moveTo(toM(x), toM(z)))); b.stroke();
    }
    b.strokeStyle = '#222'; b.lineWidth = 1.2; b.setLineDash([4, 3]);
    for (const l of data.features.lifts) { b.beginPath(); l.pts.forEach(([x, z], i) => (i ? b.lineTo(toM(x), toM(z)) : b.moveTo(toM(x), toM(z)))); b.stroke(); }
  }
  function drawMini() {
    const W = mini.width, zoom = 2.2; // px de carte par px écran
    const cx = (skier.pos.x + meta.coreHalf) / 4, cz = (skier.pos.z + meta.coreHalf) / 4;
    mctx.save();
    mctx.clearRect(0, 0, W, W);
    mctx.beginPath(); mctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); mctx.clip();
    mctx.drawImage(base, cx - (W / 2) / zoom * 1, cz - (W / 2) / zoom, W / zoom, W / zoom, 0, 0, W, W);
    mctx.translate(W / 2, W / 2);
    mctx.rotate(-skier.yaw + Math.PI);
    mctx.fillStyle = '#ff3b30'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.moveTo(0, -9); mctx.lineTo(6, 7); mctx.lineTo(0, 3); mctx.lineTo(-6, 7); mctx.closePath(); mctx.fill(); mctx.stroke();
    mctx.restore();
  }

  // chrono Mont-Blanc
  let best = NaN;
  try { best = Number(localStorage.getItem('arcs-mb-best') ?? 'NaN'); } catch { /* stockage indisponible */ }
  let chronoRun = false, chronoT = 0, armed = true;
  function chronoReset() { chronoRun = false; chronoT = 0; armed = true; }
  const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  function updateChrono(dt: number) {
    if (!mb) return;
    const dTop = Math.hypot(skier.pos.x - mb.top.x, skier.pos.z - mb.top.z);
    const dBot = Math.hypot(skier.pos.x - mb.bottom.x, skier.pos.z - mb.bottom.z);
    if (dTop < 30) { chronoRun = false; chronoT = 0; armed = true; }
    else if (armed && dTop < 80 && skier.speed > 1) { chronoRun = true; armed = false; message('Chrono lancé — piste Mont-Blanc', 1.6); }
    if (chronoRun) {
      chronoT += dt;
      if (dBot < 110 && skier.pos.y < mb.bottom.y + 20) {
        chronoRun = false;
        const isBest = !(best <= chronoT);
        if (isBest) { best = chronoT; try { localStorage.setItem('arcs-mb-best', String(best)); } catch { /* ignore */ } }
        message(`Arrivée Arc 1600 : ${fmt(chronoT)}${isBest ? ' — record !' : ''}`, 4);
      }
      if (chronoT > 900) chronoRun = false;
    }
    hudChrono.innerHTML = chronoRun ? `⏱ ${fmt(chronoT)}` : (isFinite(best) ? `Record Mont-Blanc ${fmt(best)}` : '');
  }

  // ------------------------------------------------------- qualité graphique
  const QUALITY = [
    { name: 'Haute', ratio: Math.min(window.devicePixelRatio, 1.5), shadow: 4096, hi: 330, lo: 2000 },
    { name: 'Moyenne', ratio: 1, shadow: 2048, hi: 220, lo: 1400 },
    { name: 'Basse', ratio: 0.75, shadow: 1024, hi: 140, lo: 900 },
  ];
  let quality = 0;
  try { const q = Number(localStorage.getItem('arcs-quality')); if (q >= 0 && q < 3) quality = q; } catch { /* ignore */ }
  let autoQ = true;
  function applyQuality(q: number, announce = true) {
    quality = q;
    const Q = QUALITY[q];
    renderer.setPixelRatio(Q.ratio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) { composer.setPixelRatio(Q.ratio); composer.setSize(window.innerWidth, window.innerHeight); }
    sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); (sun.shadow as any).map = null; }
    (coreMat as any).snowUniforms.uTreeFade.value.set(Q.lo * 0.75, Q.lo * 1.05);
    try { localStorage.setItem('arcs-quality', String(q)); } catch { /* ignore */ }
    if (announce) message(`Qualité graphique : ${Q.name}`, 1.6);
  }
  // post-traitement : léger halo lumineux, vignettage et étalonnage
  let composer: EffectComposer | null = null;
  try {
    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.12, 0.4, 2.2));
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          vec2 d = vUv - 0.5;
          float v = 1.0 - dot(d, d) * 0.55;
          vec3 col = c.rgb * v;
          // contraste doux et légère chaleur dans les hautes lumières
          col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
          col *= vec3(1.01, 1.0, 0.985);
          gl_FragColor = vec4(col, c.a);
        }`,
    }));
  } catch (e) { console.warn('post-traitement indisponible', e); composer = null; }
  applyQuality(quality, false);
  const fpsEl = $('fps');
  let fpsAcc = 0, fpsN = 0, fpsShown = false, autoT = 0, autoFrames = 0;

  // ------------------------------------------------------- boucle
  const input = new Input();
  const audio = new SkiAudio();
  const clock = new THREE.Clock();
  let acc = 0, elapsed = 0;
  const STEP = 1 / 120;
  const skiL = new THREE.Vector3(), skiR = new THREE.Vector3(), side = new THREE.Vector3();
  let lastPiste = '';

  if (mb) spawnAtLift(mb); else skier.place(0, 0, 0);

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    input.poll();

    // commandes ponctuelles
    if (input.was('Escape', 9)) {
      if (tpOpen) toggleTp(false);
      else if (map.open) toggleMap(false);
      else if (help.classList.contains('show')) help.classList.remove('show');
      else togglePause();
    }
    if (input.was('KeyT', 3)) toggleTp();
    if (input.was('KeyM', 2)) toggleMap();
    if (paused && input.was('Enter')) restart();
    if (input.was('KeyR', 8)) { if (mb) spawnAtLift(mb); message('Retour au sommet du télésiège Mont-Blanc'); }
    if (input.was('KeyC', 1)) { camMode = (camMode + 1) % 3; camSnap = true; }
    if (input.was('KeyH')) help.classList.toggle('show');
    if (input.was('KeyN')) { audio.setMuted(!audio.muted); message(audio.muted ? 'Son coupé' : 'Son activé', 1.2); }
    if (input.was('KeyG')) { autoQ = false; applyQuality((quality + 1) % 3); }
    if (input.was('KeyF')) { fpsShown = !fpsShown; fpsEl.style.display = fpsShown ? 'block' : 'none'; }
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fpsEl.textContent = `${Math.round(fpsN / fpsAcc)} i/s · ${QUALITY[quality].name}`; fpsAcc = 0; fpsN = 0; }
    // ajustement automatique de la qualité dans les premières secondes de jeu
    if (autoQ && started) {
      autoT += dt; autoFrames++;
      if (autoT > 4) {
        const fps = autoFrames / autoT;
        if (fps < 38 && quality < 2) applyQuality(quality + 1);
        else autoQ = false;
        autoT = 0; autoFrames = 0;
      }
    }
    if (tpOpen) for (let i = 0; i < Math.min(9, tpLifts.length); i++) if (input.was('Digit' + (i + 1)) || input.was('Numpad' + (i + 1))) { spawnAtLift(tpLifts[i]); toggleTp(false); }

    const frozen = paused || tpOpen || map.open;
    if (!frozen) {
      elapsed += dt;
      acc += dt;
      const inp = input.ski();
      while (acc >= STEP) { skier.step(STEP, inp); acc -= STEP; }
      for (const e of skier.events) {
        if (e === 'crash') message(skier.crashMsg + '  (R : retour en haut)', 2.4);
        if (e === 'land') spray.emit(skier.pos, skier.vel, 40, 3, 2);
      }
      skier.events.length = 0;
      updateChrono(dt);
    }
    skier.updateModel(dt);

    // traces + gerbes
    const root = skier.model.root;
    root.updateMatrixWorld();
    if (skier.grounded && skier.crashT <= 0 && skier.speed > 0.5) {
      skiL.set(-0.13, 0, -0.3).applyMatrix4(root.matrixWorld);
      skiR.set(0.13, 0, -0.3).applyMatrix4(root.matrixWorld);
      skiL.y = hf.height(skiL.x, skiL.z); skiR.y = hf.height(skiR.x, skiR.z);
      side.set(1, 0, 0).applyQuaternion(root.quaternion).setY(0).normalize();
      tracks.add([skiL, skiR], side, 0.13 + skier.skid * 0.3, (1 - skier.onPiste * 0.25) * (0.8 + skier.skid * 0.2));
      const sp = skier.speed;
      const intensity = skier.skid * Math.min(1, sp / 5) + skier.carve * 0.35 + (1 - skier.onPiste) * Math.min(1, sp / 12) * 0.5;
      const n = Math.floor(intensity * 7 * (dt * 60) + Math.random());
      if (n > 0) {
        const outward = new THREE.Vector3().crossVectors(skier.normal, skier.vel).normalize().multiplyScalar(skier.leanAngle > 0 ? -1 : 1);
        spray.emit(skiL.clone().lerp(skiR, 0.5), skier.vel.clone().multiplyScalar(0.4).addScaledVector(outward, sp * 0.15), n, 1.5, 1.5 + intensity * 2);
      }
    } else if (skier.crashT > 0 && skier.speed > 2) {
      spray.emit(skier.pos, skier.vel, 3, 2, 2);
    }
    spray.update(dt);

    for (const l of lifts) l.update(elapsed, camera.position);
    if (funi) funi.update(elapsed);
    if (!frozen) crowd.update(dt, camera.position, Math.max(1, Math.round(dt / (1 / 60))), Math.min(dt, 0.05) / Math.max(1, Math.round(dt / (1 / 60))));
    (sky.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed;
    updateCamera(dt);
    core.update(camera.position);
    forest.update(camera.position, QUALITY[quality].lo, QUALITY[quality].hi);
    (coreMat as any).snowUniforms.uTime.value = elapsed;
    (coreMat as any).snowUniforms.uSunDir.value.copy(sunDir);

    // ombres centrées sur le joueur (alignées sur les texels pour éviter le scintillement)
    const tgt = skier.pos;
    const texel = (2 * S) / 4096;
    const sx = Math.round(tgt.x / texel) * texel, sz = Math.round(tgt.z / texel) * texel;
    sun.target.position.set(sx, tgt.y, sz);
    sun.position.set(sx, tgt.y, sz).addScaledVector(sunDir, 600);
    sun.target.updateMatrixWorld();

    // HUD
    const kmh = skier.speed * 3.6;
    hudSpeed.innerHTML = `${kmh.toFixed(0)}<small>km/h</small>`;
    hudAlt.textContent = `${Math.round(skier.pos.y)} m`;
    const p = pisteIdx.nearest(skier.pos.x, skier.pos.z, 26);
    const key = p ? p.name + p.diff : skier.onPiste > 0.3 ? 'piste' : 'hors';
    if (key !== lastPiste) {
      lastPiste = key;
      if (p) hudPiste.innerHTML = `<i style="background:#${DIFF_COLOR[p.diff].toString(16).padStart(6, '0')}"></i>${p.name} <span>· ${DIFF_LABEL[p.diff] ?? ''}</span>`;
      else hudPiste.innerHTML = skier.onPiste > 0.3 ? '<i style="background:#888"></i>Piste' : '<i style="background:#f08a1c"></i>Hors-piste';
    }
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) hudMsg.classList.remove('show'); }
    drawMini();
    if (map.open) {
      map.player = { x: skier.pos.x, z: skier.pos.z, yaw: skier.yaw };
      map.others = crowd.skiers.map(e => ({ x: e.sk.pos.x, z: e.sk.pos.z }));
      if ((fpsN & 7) === 0) map.draw();
    }
    audio.update(skier.speed, skier.carve, skier.skid, skier.grounded, skier.crashT > 0);

    if (composer && quality < 2) composer.render(); else renderer.render(scene, camera);
    input.endFrame();
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  });

  // écran titre
  const loading = $('loading');
  var started = false;
  loading.classList.add('ready');
  loadLabel.textContent = 'Prêt';
  $('load-progress').style.display = 'none';
  const go = $('btn-start');
  go.style.display = 'inline-flex';
  go.onclick = () => {
    started = true;
    loading.classList.add('hide');
    audio.start();
    message('Piste Mont-Blanc · Arc 1600 — bonne descente !', 3);
    renderer.domElement.focus();
  };
  // test automatique : ?auto=1 lance directement
  if (new URLSearchParams(location.search).has('auto')) go.click();
  (window as any).__game = { skier, camera, hf, lifts, routes, crowd, toggleMap, togglePause, setCam: (m: number) => { camMode = m; camSnap = true; },
    debugCam: (p: number[] | null, l?: number[]) => { debugCam = p ? { p: new THREE.Vector3(...p), l: new THREE.Vector3(...l!) } : null; },
    place: (x: number, z: number, yaw: number) => { skier.place(x, z, yaw); core.warm(skier.pos); camSnap = true; } };
  frame();
}
