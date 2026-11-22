"""Extrait les objets OSM utiles (pistes, remontées, bâtiments, forêts, funiculaire, lieux) en JSON."""
import xml.etree.ElementTree as ET, glob, json, sys
nodes, ntags, ways = {}, {}, {}
for f in glob.glob(sys.argv[1] + '/*.osm'):
    r = ET.parse(f).getroot()
    for n in r.iter('node'):
        nodes[n.get('id')] = (float(n.get('lon')), float(n.get('lat')))
        t = {tg.get('k'): tg.get('v') for tg in n.findall('tag')}
        if t:
            ntags[n.get('id')] = t
    for w in r.iter('way'):
        t = {tg.get('k'): tg.get('v') for tg in w.findall('tag')}
        ways[w.get('id')] = (t, [nd.get('ref') for nd in w.findall('nd')])
out = []
for wid, (t, refs) in ways.items():
    keep = ('piste:type' in t or 'aerialway' in t or 'building' in t or t.get('railway') == 'funicular'
            or t.get('natural') in ('wood', 'scrub', 'bare_rock', 'scree', 'cliff', 'water') or t.get('landuse') == 'forest'
            or 'highway' in t)
    if not keep:
        continue
    coords = [nodes[r] for r in refs if r in nodes]
    if len(coords) < 2:
        continue
    out.append({'id': wid, 'tags': t, 'coords': coords})
for nid, t in ntags.items():
    if ('place' in t or t.get('amenity') in ('restaurant', 'bar', 'cafe') or t.get('tourism') in ('viewpoint', 'hotel')
            or t.get('man_made') == 'snow_cannon'):
        out.append({'id': nid, 'tags': t, 'coords': [nodes[nid]], 'node': True})
json.dump(out, open(sys.argv[2], 'w'))
print(len(out))
