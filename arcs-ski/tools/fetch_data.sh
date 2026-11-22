#!/usr/bin/env bash
# Télécharge les données brutes (IGN Géoplateforme + OpenStreetMap) dans $1
set -euo pipefail
RAW=${1:-raw}; mkdir -p "$RAW/osm"; cd "$RAW"
CX=996300; CY=6506100   # centre en Lambert 93 (Arc 1600 / piste Mont-Blanc)
W="https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&CRS=EPSG:2154"
get(){ curl -sf -m 300 "$W&LAYERS=$1&BBOX=$((CX-$2)),$((CY-$2)),$((CX+$2)),$((CY+$2))&WIDTH=$3&HEIGHT=$3&FORMAT=$5" -o "$4"; echo "$4"; }
BIL="image/x-bil;bits=32"
get ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES      2048  2048 core_mnt.bil  "$BIL"
get ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.MNS  2048  2048 core_mns.bil  "$BIL"
get ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES      8192  2048 mid_mnt.bil   "$BIL"
get ELEVATION.ELEVATIONGRIDCOVERAGE              40960 1024 far_mnt.bil   "$BIL"
get ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3        40960 1024 far_srtm.bil  "$BIL"
get ORTHOIMAGERY.ORTHOPHOTOS                     8192  2048 mid_ortho.jpg "image/jpeg"
# OSM : API principale, tuiles de 0.02°
for lon in 6.76 6.78 6.80 6.82; do for lat in 45.56 45.58 45.60; do
  f=osm/${lon}_${lat}.osm; [ -s "$f" ] && continue
  curl -sf -m 120 -A "arcs-ski-data/0.1" "https://api.openstreetmap.org/api/0.6/map?bbox=$lon,$lat,$(python3 -c "print(round($lon+0.02,2))"),$(python3 -c "print(round($lat+0.02,2))")" -o "$f"; echo "$f"
done; done
python3 "$(dirname "$0")/../tools/parse_osm.py" osm features.json > /dev/null 2>&1 || python3 ../tools/parse_osm.py osm features.json >/dev/null
