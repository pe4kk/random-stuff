import xml.etree.ElementTree as ET, glob, json, sys
nodes={}; ways={}
for f in glob.glob(sys.argv[1]+'/*.osm'):
    r=ET.parse(f).getroot()
    for n in r.iter('node'):
        nodes[n.get('id')]=(float(n.get('lon')),float(n.get('lat')))
    for w in r.iter('way'):
        t={tg.get('k'):tg.get('v') for tg in w.findall('tag')}
        ways[w.get('id')]=(t,[nd.get('ref') for nd in w.findall('nd')])
out=[]
for wid,(t,refs) in ways.items():
    keep = 'piste:type' in t or 'aerialway' in t or 'building' in t or t.get('natural') in ('wood','scrub','bare_rock','scree','cliff') or t.get('landuse')=='forest' or 'highway' in t or t.get('natural')=='water'
    if not keep: continue
    coords=[nodes[r] for r in refs if r in nodes]
    if len(coords)<2: continue
    out.append({'id':wid,'tags':t,'coords':coords})
json.dump(out,open(sys.argv[2],'w'))
print(len(out))
for o in out:
    t=o['tags']
    if 'piste:type' in t or 'aerialway' in t:
        n=t.get('name') or t.get('piste:name') or ''
        c=o['coords']
        print(o['id'],t.get('piste:type',''),t.get('aerialway',''),t.get('piste:difficulty',''),repr(n),len(c),c[0],c[-1])
