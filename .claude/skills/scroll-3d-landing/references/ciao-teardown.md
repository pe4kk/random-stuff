# Analyse : ciaoenergy.com (novembre 2026)

Source d'inspiration du skill. Analyse faite à partir du HTML/JS public et de captures mobiles.
**Mécaniques uniquement** — la marque, les textes, les sons et les modèles 3D appartiennent à Ciao Energy / Skaald.

## Stack

- Webflow (mise en page, formulaire Brevo), jQuery (runtime Webflow).
- GSAP 3.15 + ScrollTrigger + SplitText (servis par le CDN Webflow).
- Lenis 1.3 en **scroll infini** (`infinite: true, syncTouch: true`) : après le footer on revient en haut sans coupure.
- Three.js 0.161 en module : `GLTFLoader` (canette `.glb` + socle), `RGBELoader` (HDRI), `EffectComposer` (RenderPass, UnrealBloom, SMAA/FXAA, OutputPass).
- Étiquettes : une texture `.avif` par saveur appliquée au mesh `Shell` du modèle ; métal via `metalnessMap`.
- Son : Web Audio, 4 mp3 (défilement canette, entrée section 2, transition bénéfices, clic UI), volume 0,5, débloqué au premier geste, bouton ON/OFF dans la nav.
- Analytics Umami.

## Structure (11 sections)

1. **Gamme** — carrousel 3D de 6 canettes dupliquées à 12 (mobile) / 24 (desktop). Nom de saveur sur 2 lignes, flèches, barre de progression, « Scroller pour découvrir ».
2. **Profil** — même canette sur un socle, description de la saveur.
3-6. **Bénéfices ×4** — pastille « × » + mot barré (ce que font les autres : « 11G de sucres », « arômes artificiels », « caféine artificielle », « aspartame… ») → titre (« Moins de sucre », « Arômes naturels »…) + paragraphe. Rail de 4 icônes à droite, l'active est entourée. La canette est en très gros plan, tournée différemment à chaque section ; une ligne (`--benefits-line`) se trace.
7. **« Zero bullshit »** — packshot de face avec halo.
8. **Gamme complète** — canettes alignées et inclinées, drag réactivé.
9. **FAQ** — accordéon.
10. **Newsletter**.
11. **Footer** — puis boucle vers le haut.

## Mécaniques clés

- **Une timeline GSAP unique** anime un objet `data` d'environ 25 paramètres (caméra, position/rotation/échelle canette, `canSpin`, `spacing`, `wave`, `swirl`, lumière, teinte, influence du pointeur, vitesse de swipe). Chaque étape dure `hauteurSection / hauteurTotale` → la timeline est mappée sur la progression du scroll.
- `tl.set(swipe, { active })` dans la timeline active/désactive le drag selon la section.
- **Téléportation** caméra en fin de page pour boucler proprement avec le scroll infini.
- **Snap** : après `scrollend` (debounce 50 ms) ou `scroll` (250 ms), aimantation sur les sections marquées `snap` — 2 premières en desktop, 6 premières en mobile.
- **Raycaster** : clic sur canette voisine → `carousel.next/previous` ; clic sur la canette centrale → scroll vers la section 2 (easing cubic out). Curseur `grab` / `grabbing` / `pointer`.
- **Swipe** : direction verrouillée après 2 px (horizontal → `lenis.stop()` + `overflow: hidden` sur touch), inertie ×8 au relâcher.
- **Loader** : compteur %, scroll bloqué au niveau `wheel`/`touchmove` (capture, passive: false) tant que `pointer.prevent`.
- **Couleurs** : variables CSS `--color-scheme-1--taste-primary/secondary` animées (transition 0,6 s), utilisées dans un dégradé de fond.
- **Profil device** : `lowPower = iOS || innerWidth < 1024` → moins de canettes, passes allégées.
- Micro-interactions : boutons avec cercles animés en boucle au survol, flèches qui « respirent », menu plein écran avec extras mobiles.

## Direction artistique observée

- Fond noir → dégradé violet/couleur saveur, halo derrière le produit.
- Titres : italique, très gras, condensé, capitales, interlignage serré (~0,9).
- Petits textes : monospace espacé, capitales.
- Repères graphiques : coins de cadre, réticules, barre de progression en haut.
- Ton : phrases courtes, « on a choisi… », comparaison frontale avec les concurrents.

## Ce que le skill reprend / adapte

| Ciao | Skill |
|---|---|
| Webflow + scripts inline | Fichier HTML unique, sans build, `CONFIG` séparé du moteur |
| Modèle GLB + textures avif | Produits procéduraux (bouteille, canette) + étiquettes canvas, GLB optionnel |
| Progression = ratio de hauteur | `timeline.time = scrollY` en pixels (robuste aux sections de hauteurs différentes) |
| `tl.set(swipe)` | Drag déduit de la section au milieu de l'écran (correct en scroll arrière) |
| Scroll infini + téléport | Scroll fini (plus accessible) ; à ajouter si demandé (`Lenis({ infinite: true })`) |
| Bloom / SMAA | Non inclus par défaut (coût mobile) ; éclairage + environnement `RoomEnvironment` |
| 4 mp3 | Sons synthétisés en Web Audio (ou URLs mp3 via `CONFIG.sounds`) |
| — | `prefers-reduced-motion`, fallback sans WebGL, focus clavier, voile de contraste |
