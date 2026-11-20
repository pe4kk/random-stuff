#!/usr/bin/env node
/*
  Capture une page scroll-3d section par section (desktop + mobile) et remonte les erreurs console.

  Usage :
    node preview.js <page.html> <dossier-sortie> [--mobile] [--width 1280 --height 800]

  Variables d'environnement :
    LOCAL_MODULES=/chemin/vers/node_modules   Sert three / lenis / gsap depuis ce dossier au lieu des CDN
                                              (utile si jsdelivr/unpkg sont bloqués par le réseau).
  Requiert Playwright (require('playwright')). Le rendu WebGL passe par SwiftShader : lent mais fidèle.
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const file = path.resolve(args[0] || 'index.html');
const out = path.resolve(args[1] || 'shots');
const mobile = args.includes('--mobile');
const num = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const W = num('--width', mobile ? 390 : 1280);
const H = num('--height', mobile ? 800 : 800);
const NM = process.env.LOCAL_MODULES;
fs.mkdirSync(out, { recursive: true });

function localFor(url) {
  if (!NM) return null;
  const rules = [
    [/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/, 'three'],
    [/(?:unpkg\.com|cdn\.jsdelivr\.net\/npm)\/lenis@[^/]+\/(.*)$/, 'lenis'],
    [/cdn\.jsdelivr\.net\/npm\/gsap@[^/]+\/(.*)$/, 'gsap'],
  ];
  for (const [re, pkg] of rules) { const m = url.match(re); if (m) return path.join(NM, pkg, m[1]); }
  return null;
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.route('http://preview.local/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(file) }));
  if (NM) {
    await page.route(/(cdn\.jsdelivr\.net|unpkg\.com)/, (r) => {
      const f = localFor(r.request().url());
      if (f && fs.existsSync(f)) return r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' } });
      return r.abort();
    });
  }
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => (process.env.FONTS === '1' ? r.continue() : r.abort()));

  await page.goto('http://preview.local/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const tag = mobile ? 'm' : 'd';
  await page.screenshot({ path: `${out}/${tag}-00-gamme.png`, timeout: 120000 });

  // drag horizontal sur la gamme → variante suivante
  await page.mouse.move(W * 0.7, H * 0.45); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(W * 0.7 - i * W * 0.04, H * 0.45);
  await page.mouse.up(); await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/${tag}-01-gamme-drag.png`, timeout: 120000 });

  const sections = await page.$$eval('#content > section', (els) => els.map((e) => ({ id: e.id, top: e.offsetTop })));
  let n = 2;
  for (const s of sections) {
    await page.evaluate((y) => { const l = window.__scroll3d.lenis; l ? l.scrollTo(y, { immediate: true, force: true }) : window.scrollTo(0, y); }, s.top);
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${out}/${tag}-${String(n++).padStart(2, '0')}-${s.id}.png`, timeout: 120000 });
  }
  fs.writeFileSync(`${out}/${tag}-console.txt`, logs.join('\n') || '(aucune erreur)');
  console.log(`${n} captures → ${out}`);
  console.log(logs.length ? logs.slice(0, 15).join('\n') : 'console : aucune erreur');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
