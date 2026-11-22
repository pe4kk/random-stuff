import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Fusionne les maillages statiques d'un groupe en un seul maillage par matériau
 * (réduit fortement le nombre d'appels de dessin). Les InstancedMesh, lignes et
 * objets marqués userData.dynamic sont laissés tels quels.
 */
export function mergeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean; recv: boolean; meshes: THREE.Mesh[] }>();
  const isDynamic = (o: THREE.Object3D): boolean => { for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.userData.dynamic) return true; return false; };
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || isDynamic(m)) return;
    const mat = m.material as THREE.Material;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const keepUV = !!(mat as THREE.MeshStandardMaterial).map;
    const keepCol = !!(mat as THREE.MeshStandardMaterial).vertexColors;
    for (const name of Object.keys(g.attributes)) {
      if (name === 'position' || name === 'normal' || (name === 'uv' && keepUV) || (name === 'color' && keepCol)) continue;
      g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.morphAttributes = {};
    let e = byMat.get(mat);
    if (!e) byMat.set(mat, (e = { geos: [], cast: false, recv: false, meshes: [] }));
    e.geos.push(g); e.cast ||= m.castShadow; e.recv ||= m.receiveShadow; e.meshes.push(m);
  });
  for (const [mat, e] of byMat) {
    if (e.meshes.length < 2) continue;
    const merged = mergeGeometries(e.geos, false);
    if (!merged) continue;
    for (const m of e.meshes) m.parent?.remove(m);
    const mm = new THREE.Mesh(merged, mat);
    mm.castShadow = e.cast; mm.receiveShadow = e.recv;
    root.add(mm);
  }
}
