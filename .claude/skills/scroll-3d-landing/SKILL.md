---
name: scroll-3d-landing
description: Crée des landing pages produit « immersives » pilotées par le scroll — un produit 3D (bouteille, canette, ou modèle GLB) fixe derrière la page, qui tourne, zoome et change de couleur section après section, avec carrousel de variantes à glisser, loader, révélations de texte, sons d'interface et version mobile. À utiliser quand on demande un site « dynamique », « à la Ciao Energy », « avec un produit 3D qui bouge au scroll », un one-page de marque de boisson / cosmétique / objet, ou une page produit animée Three.js + GSAP.
---

# scroll-3d-landing

Un moteur prêt à l'emploi (`assets/template.html`) + une méthode pour l'habiller.
Le moteur est générique ; **tout ce qui change d'un site à l'autre vit dans `window.CONFIG`**.
La démo intégrée (marque fictive « Limpide », eau en bouteille de verre) sert d'exemple rempli.

Stack : Three.js 0.161 · GSAP 3.13 (ScrollTrigger + SplitText) · Lenis 1.3 — un seul fichier HTML, sans build, chargé depuis jsdelivr (autorisé dans les Artifacts et sur n'importe quel hébergement statique).

## Workflow

1. **Brief** — récupérer (ou proposer si l'utilisateur dit « choisis ») :
   - produit + forme : `bottle`, `can` (procéduraux) ou un `.glb` fourni ;
   - 3 à 6 **variantes** (nom sur 2 lignes, phrase de profil, 2 couleurs `c1` lueur / `c2` fond, couleur d'accent 3D) ;
   - 3 à 5 **bénéfices** au format « ce que les autres font » (barré) → « ce qu'on fait » ;
   - un **manifeste** de 2-4 mots, un titre de packshot, 4-8 questions de FAQ, le texte newsletter ;
   - le ton (Ciao : direct, tutoiement de marque, « zero bullshit »).
   Si une info manque et que l'utilisateur a délégué, invente du contenu plausible **et signale-le** (marque fictive, chiffres de démo).
2. **Copier** `assets/template.html` vers le dossier du site (`<site>/index.html`).
3. **Remplir `CONFIG`** (seul bloc à réécrire) : marque, variantes, bénéfices, FAQ, sons, keyframes.
4. **Chorégraphier les keyframes** (voir plus bas) — c'est là que se joue la qualité.
5. **Tester** avec `scripts/preview.js` (desktop puis `--mobile`), regarder chaque capture, corriger cadrage et contraste.
6. **Livrer** : publier en Artifact (fichier unique) et/ou committer le dossier.

Ne touche au moteur que pour ajouter une capacité réutilisable (nouvelle forme, nouvel effet) — et reporte-la dans le template du skill.

## Ce que fait le moteur (et pourquoi)

| Bloc | Rôle | Pattern UX |
|---|---|---|
| Loader | % réel (LoadingManager) + durée mini 1,4 s, scroll bloqué (`lenis.stop()`) | Pas d'écran à moitié chargé ; l'intro démarre sur une scène prête |
| Intro | Rideau qui se lève, produits qui montent (`intro.y/s`), nav et titre qui se révèlent | Premier « waouh » sans action |
| Scène fixe | `#stage` en `position: fixed` derrière `<main>` (pointer-events: none sauf UI) | Un seul objet 3D raconte toute la page |
| Timeline | `timeline.time = scrollY` ; une étape par section, durée = distance entre sections | Quand le haut d'une section touche le haut de l'écran, la scène est pile sur sa keyframe |
| Carrousel | Produits dupliqués en boucle, `wrap()` infini, lissage exponentiel, aimant au relâcher | Glisser = changer de variante ; clic sur voisin = y aller ; clic sur l'actif = descendre |
| Variante active | `--c1/--c2` CSS + uniforms du fond 3D, noms remplacés ligne par ligne, son « goutte » | La page entière prend la couleur du produit |
| Bénéfices | Pastille barrée qui se trace, titre SplitText, rail d'icônes à droite | Lecture « avant / après » instantanée, repère de progression |
| Snap | Aimantation entre sections `data-snap` uniquement (gamme ↔ profil) | Les 2 premiers écrans se comportent comme des slides |
| Son | Web Audio synthétisé (goutte, clic, souffle) ou mp3, débloqué au 1er geste, toggle persistant | Texture sensorielle sans asset |
| Fallbacks | `no-webgl`, `prefers-reduced-motion` (pas de Lenis, pas d'idle), mobile allégé | La page reste lisible partout |

## Keyframes : comment chorégraphier

`CONFIG.keyframes[<data-key de section>]` — chaque section hérite de la précédente, ne mets que ce qui change.

| Champ | Effet | Plage utile |
|---|---|---|
| `camZ` | distance caméra (plus petit = gros plan) | 8 (macro) → 21 (gamme entière) |
| `camY` | hauteur caméra (regarde `camY*0.6`) | -1 → 2 |
| `x`, `y` | position du produit actif (x est compressé sur écran étroit) | x ±1.8, y -1 → 2.6 ; `y: 12` = sorti de l'écran par le haut |
| `scale` | taille | 0.8 → 1.4 |
| `rotX` / `rotY` / `rotZ` | bascule / rotation sur l'axe / inclinaison | rotY en multiples de π pour montrer l'étiquette (0, 2π) ou le dos (π) |
| `spread` | écart entre produits (1 = carrousel ; ≥3 = les autres sortent) | 0.8 packshot · 1 gamme · 3.2 focus |
| `others` | visibilité des produits non actifs | 0 ou 1 |
| `swipe` | drag autorisé dans cette section | true sur gamme et packshot |

Règles qui marchent :
- **Alterner gauche/droite** d'un bénéfice à l'autre (`x` −/+) et l'inclinaison (`rotZ` −/+) : le regard zigzague, le texte reste au centre-bas.
- **Toujours progresser en `rotY`** (0 → 0,6π → 1,1π → 1,55π → 2π) : la bouteille fait un tour complet sur les bénéfices et revient étiquette de face pour le manifeste.
- Gros plans : `camZ` 10-12 et `scale` ≤ 1,2. En dessous, le produit mange le texte sur mobile.
- Garder le produit dans la **moitié haute** quand du texte est en bas (`y` ≥ 0,7 en desktop).
- Sortie de scène avant la FAQ (`y: 12`) : les sections denses en texte n'ont pas de 3D derrière.
- Le packshot (`spread` 0,8 + `rotZ` 0,22) rappelle la gamme et réactive le drag.

## Produit 3D

- `product.type: 'bottle'` : profil `BOTTLE_PROFILE` (paires `[rayon, y]`) tourné en `LatheGeometry`. Verre = coque transparente brillante ; eau = `transmission` (réfracte le fond animé) ; étiquette = texture canvas générée (marque + variante) ; bulles instanciées si `bubbles: true`.
- `product.type: 'can'` : profil `CAN_PROFILE`, métal + étiquette pleine hauteur aux couleurs de la variante.
- **Nouvelle forme** (flacon, pot, tube) : écrire un profil `[rayon, y]` de bas en haut, centré sur y = 0, hauteur ~4,2 unités, et une fonction `createXxx(v)` sur le modèle de `createCan`.
- **Modèle fourni** : `product: { gltf: 'https://…/model.glb', labelMesh: 'Label' }` — le moteur clone le modèle par variante et remplace la texture du mesh nommé `labelMesh`. Normaliser le modèle à ~4,2 unités de haut, centré.
- Matériaux transmission : coûteux. `lowPower` (iOS ou < 1024 px) les remplace par de la transparence simple.
- Les objets en `transmission` ne voient pas les autres objets transparents : garder **eau = transmission, verre = transparent** (pas l'inverse), sinon l'eau disparaît.

## Pièges connus

- Ne jamais animer `state` hors de la timeline (elle le réécrit à chaque frame) : pour une animation ponctuelle, utiliser un objet séparé appliqué en plus (comme `intro`).
- Ne pas nommer une timeline locale comme un objet global animé (bug réel rencontré : `const intro = gsap.timeline()` masquait l'objet `intro`).
- Après tout changement de hauteur du DOM (accordéon FAQ, images), appeler `ScrollTrigger.refresh()` ; le resize reconstruit la timeline.
- Le drag écoute `window` : exclure l'UI (`a, button, input, summary…`) sinon les clics deviennent des swipes.
- Les sons ne jouent qu'après un geste utilisateur (politique autoplay) — c'est voulu.
- Texte blanc sur produit clair : le voile `.section::before` est indispensable ; vérifier sur les captures mobiles.
- Les polices web doivent être chargées **avant** de dessiner les étiquettes canvas (`document.fonts.load`).
- Pas d'aimantation après le dernier point `data-snap`, sinon le site « ramène » l'utilisateur en arrière.

## Tester

```bash
# Playwright est requis. Si jsdelivr est bloqué par le réseau, servir les libs en local :
npm i --prefix /tmp/libs three@0.161.0 lenis@1.3.23 gsap@3.13.0
LOCAL_MODULES=/tmp/libs/node_modules node scripts/preview.js <site>/index.html <dossier-captures>
LOCAL_MODULES=/tmp/libs/node_modules node scripts/preview.js <site>/index.html <dossier-captures> --mobile
```

Le script : attend la fin du loader, capture la gamme, simule un drag, puis capture chaque section, et écrit les erreurs console dans `<tag>-console.txt`. Le rendu est logiciel (SwiftShader) : lent, mais suffisant pour juger cadrage, couleurs et contraste. Regarder **chaque** capture avant de livrer.

Checklist avant livraison :
- [ ] Aucun `pageerror` ; seuls avertissements tolérés : polices bloquées en test, messages du driver GL.
- [ ] Le produit ne masque jamais un titre sur mobile (390 px).
- [ ] Le drag change bien la variante, couleurs et textes suivent.
- [ ] Rail des bénéfices visible uniquement sur les bénéfices.
- [ ] FAQ ouvrable au clavier, menu fermable avec Échap, focus visible.
- [ ] Contenu inventé signalé à l'utilisateur.

## Références

- `references/ciao-teardown.md` — analyse détaillée de ciaoenergy.com (structure, stack, timings, interactions) qui a servi de modèle. S'en inspirer pour les **mécaniques**, jamais copier marque, textes, sons ou assets.
