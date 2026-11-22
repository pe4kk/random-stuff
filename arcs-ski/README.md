# Les Arcs Ski (prototype)

Jeu de ski 3D en simulation libre sur la piste **Mont-Blanc** (bleue) à **Arc 1600**, construit à partir de données réelles :

- relief : IGN RGE ALTI® 2 m (MNT) et MNS pour placer chaque arbre et donner leur hauteur aux bâtiments ;
- pistes, remontées, bâtiments : OpenStreetMap (ODbL) ;
- fond de vallée et massifs lointains : IGN + SRTM.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/
```

## Données

```bash
tools/fetch_data.sh raw                 # télécharge IGN + OSM dans raw/
python3 tools/build_data.py raw public/data
```

Le dossier `public/data` est versionné : pas besoin de refaire cette étape pour jouer.

## Réglage de la glisse

`tools/sim/run.sh cruise|fast` lance une descente automatique de la piste Mont-Blanc sans affichage
et donne temps, vitesses, chutes et dérapages (utile pour régler `src/skier.ts`).

## Commandes

Flèches (ou ZQSD / WASD) : tourner, schuss, freiner · Espace : saut · R : retour au sommet ·
T : téléportation · C : caméra · G : qualité graphique · F : images/s · M : son · Échap : pause.
Manette compatible.
