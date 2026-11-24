#!/usr/bin/env python3
"""Habille le personnage CC0 (Quaternius, Universal Base Characters) en tenue de ski :
catégories par os (veste, pantalon, gants, peau) dans COLOR_0, tissu lissé (muscles effacés) et gonflé,
position de repos copiée dans TEXCOORD_0/1 (motifs de la veste). Entrée : glTF à tampon intégré."""
import json, base64, struct, sys
import numpy as np

src, dst = sys.argv[1], sys.argv[2]
g = json.load(open(src))
buf = bytearray(base64.b64decode(g['buffers'][0]['uri'].split(',', 1)[1]))
CT = {5126: ('f', 4), 5123: ('H', 2), 5121: ('B', 1), 5125: ('I', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def read(ai):
    a = g['accessors'][ai]; v = g['bufferViews'][a['bufferView']]
    fmt, sz = CT[a['componentType']]; n = NC[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(bytes(buf[off: off + a['count'] * n * sz]), dtype={'f': np.float32, 'H': np.uint16, 'B': np.uint8, 'I': np.uint32}[fmt]).reshape(a['count'], n).copy()
prim = g['meshes'][0]['primitives'][0]
P = read(prim['attributes']['POSITION']).astype(np.float64)
Nrm = read(prim['attributes']['NORMAL']).astype(np.float64)
J = read(prim['attributes']['JOINTS_0']).astype(int)
W = read(prim['attributes']['WEIGHTS_0']).astype(np.float64)
idx = read(prim['indices']).reshape(-1)
joints = g['skins'][0]['joints']
names = [g['nodes'][j]['name'] for j in joints]
def cat(nm):
    if any(k in nm for k in ('hand', 'thumb', 'index', 'middle', 'ring', 'pinky')): return 2
    if 'Head' in nm or 'neck' in nm: return 3
    if any(k in nm for k in ('thigh', 'calf', 'foot', 'ball')) or nm in ('pelvis', 'root'): return 1
    return 0
cats = np.array([cat(n) for n in names])
col = np.zeros((len(P), 4))
for k in range(4): np.add.at(col, (np.arange(len(P)), cats[J[:, k]]), W[:, k])
# hauteurs de repère (modèle debout, Y vers le haut, ~1,81 m)
inv = read(g['skins'][0]['inverseBindMatrices']).reshape(-1, 4, 4)
def joint_pos(name):
    m = np.linalg.inv(inv[names.index(name)].T); return m[:3, 3]
pelvis_y = joint_pos('pelvis')[1]; head_y = joint_pos('Head')[1]
hip_line, chin_y = pelvis_y - 0.13, head_y + 0.01
y = P[:, 1]
t = np.clip((y - hip_line) / 0.05, 0, 1) * (col[:, 1] > 0)
col[:, 0] += col[:, 1] * t; col[:, 1] *= 1 - t
t = np.clip((chin_y - y) / 0.03, 0, 1) * (col[:, 3] > 0)
col[:, 0] += col[:, 3] * t; col[:, 3] *= 1 - t
col /= col.sum(1, keepdims=True)
puff = 0.026 * col[:, 0] + 0.02 * col[:, 1] + 0.012 * col[:, 2] + np.where((y < chin_y + 0.02) & (y > chin_y - 0.1), 0.012 * col[:, 0], 0)
# soudure des sommets dupliqués, lissage (Laplace puis Taubin) pondéré par le tissu, gonflement
key = {}; weld = np.zeros(len(P), int)
for i, p in enumerate(np.round(P * 1e4).astype(int)):
    weld[i] = key.setdefault(tuple(p), len(key))
m = len(key)
Q = np.zeros((m, 3)); cnt = np.zeros(m); Wc = np.zeros(m); A = np.zeros(m)
np.add.at(Q, weld, P); np.add.at(cnt, weld, 1); np.add.at(Wc, weld, col[:, 0] + col[:, 1]); np.add.at(A, weld, puff)
Q /= cnt[:, None]; Wc /= cnt; A /= cnt
tri = weld[idx].reshape(-1, 3)
nb = [set() for _ in range(m)]
for a, b, c in tri: nb[a] |= {b, c}; nb[b] |= {a, c}; nb[c] |= {a, b}
deg = np.array([len(s) for s in nb]); rows = np.repeat(np.arange(m), deg); cols = np.concatenate([list(s) for s in nb])
def lap(Q):
    S = np.zeros_like(Q); np.add.at(S, rows, Q[cols]); return S / np.maximum(deg, 1)[:, None] - Q
for _ in range(8): Q += 0.5 * Wc[:, None] * lap(Q)
for _ in range(30): Q += 0.6 * Wc[:, None] * lap(Q); Q += -0.62 * Wc[:, None] * lap(Q)
def normals(Q):
    fn = np.cross(Q[tri[:, 1]] - Q[tri[:, 0]], Q[tri[:, 2]] - Q[tri[:, 0]])
    Nw = np.zeros_like(Q)
    for k in range(3): np.add.at(Nw, tri[:, k], fn)
    return Nw / np.maximum(np.linalg.norm(Nw, axis=1, keepdims=True), 1e-9)
Nw = normals(Q)
sgn = 1 if (Nw[weld] * Nrm).sum() > 0 else -1
Q += Nw * sgn * A[:, None]
Nw = normals(Q) * sgn
P2 = Q[weld]
cloth = (col[:, 0] + col[:, 1]) > 0.5
N2 = np.where(cloth[:, None], Nw[weld], Nrm)
# écriture : nouveaux tampons à la fin
def add(arr, typ, comp=5126):
    data = arr.astype({5126: np.float32}[comp]).tobytes()
    while len(buf) % 4: buf.append(0)
    off = len(buf); buf.extend(data)
    g['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
    acc = {'bufferView': len(g['bufferViews']) - 1, 'componentType': comp, 'count': len(arr), 'type': typ}
    if typ == 'VEC3': acc['min'] = arr.min(0).tolist(); acc['max'] = arr.max(0).tolist()
    g['accessors'].append(acc); return len(g['accessors']) - 1
prim['attributes']['POSITION'] = add(P2, 'VEC3')
prim['attributes']['NORMAL'] = add(N2, 'VEC3')
prim['attributes']['COLOR_0'] = add(col, 'VEC4')
prim['attributes']['TEXCOORD_0'] = add(P[:, [0, 1]], 'VEC2')
prim['attributes']['TEXCOORD_1'] = add(np.stack([P[:, 2], np.zeros(len(P))], 1), 'VEC2')
g['buffers'][0] = {'byteLength': len(buf), 'uri': 'data:application/octet-stream;base64,' + base64.b64encode(bytes(buf)).decode()}
json.dump(g, open(dst, 'w'))
print('ok', len(P), 'sommets ; bassin', round(pelvis_y, 3), 'tête', round(head_y, 3))
