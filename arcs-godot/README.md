# Les Arcs Ski (version Godot, réaliste)

Descente de la piste **Mont-Blanc** (Arc 1600) avec un rendu réaliste : relief réel IGN (2 m) et
Copernicus (30 m) jusqu'au Mont Blanc, neige et roche photographiées, 48 600 sapins aux positions réelles,
ciel d'altitude, brume de vallée, skieur articulé.

## Lancer le jeu sur ton PC

1. Télécharge **Godot 4.5.1** (version standard, pas « .NET ») : https://godotengine.org/download/archive/4.5.1-stable/
   C'est un seul fichier à dézipper, aucune installation.
2. Récupère le dossier `arcs-godot` du dépôt (branche `claude/peaceful-mendel-tc9l3w`) :
   sur GitHub, bouton **Code → Download ZIP**, puis dézippe.
3. Lance Godot → **Importer** → choisis `arcs-godot/project.godot` → **Importer et modifier**.
   La première ouverture importe les textures (1 à 2 minutes).
4. Appuie sur **F5** (ou le bouton ▶ en haut à droite) pour jouer.

Place nécessaire : environ 0,5 Go (Godot + projet + fichiers importés).

## Commandes

| Action | Clavier | Manette |
|---|---|---|
| Tourner | ← → (ou Q/A, D) | stick gauche |
| Schuss / pousser sur les bâtons | ↑ (ou Z/W) | gâchette droite |
| Freiner (chasse-neige) | ↓ (ou S) | gâchette gauche |
| Sauter (maintenir puis relâcher) | Espace | A |
| Recommencer en haut | R | |
| Changer de caméra (poursuite, large, subjective) | C | |
| Zoom de la caméra | molette | |
| Plan des pistes (clic sur un sommet : téléportation) | M | |
| Couper / remettre le son | N | |
| Plein écran / fenêtre | F11 | |
| Menu (reprendre, recommencer, quitter) | Échap | |

## Données et licences

- Relief : © IGN (RGE ALTI®) ; massifs lointains : Copernicus GLO-30 © DLR e.V. 2010-2014 et © Airbus Defence and Space GmbH 2014-2018, fourni dans le cadre de COPERNICUS par l'Union européenne et l'ESA.
- Pistes, remontées, bâtiments : © contributeurs OpenStreetMap (ODbL).
- Textures de neige, de roche et de rameaux de sapin : Poly Haven (CC0).
- Sons : synthétisés par `tools/make_sounds.py` (aucun enregistrement tiers).
- Personnage : Quaternius, « Universal Base Characters » (CC0), habillé par `tools/clothe_skier.py`.

## Pour le développement

- `tools/prepare.py` régénère `data/` depuis `../arcs-ski/public/data` et les dalles Copernicus.
- Capture sans écran : `godot --path . -- --shot=out.png --sim=8` (descente simulée 8 s puis capture).
