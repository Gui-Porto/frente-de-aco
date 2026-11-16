import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// =====================================================================
// Modelos glTF dos blindados (opcional), só por dados:
//   def.model = { url, turret: 'nome do material da torre', ring: [x, y, z] (centro do anel da torre),
//                 trunnion: [x, y, z] (munhão do canhão), cut: z a partir do qual a malha da torre é canhão/mantelete,
//                 muzzle: z da boca do cano, scale?, rot? }
// Coordenadas do arquivo já no mundo dele: +y cima, +z frente (cano), metros, chão em y = 0.
// O arquivo não precisa ter nós separados: a torre é achada pelo material e o canhão é recortado dela em `cut`.
// Sem arquivo (ou falha ao carregar) o jogo segue com o tanque procedural.
// ponytail: rodas e esteiras do modelo ficam paradas (vêm fundidas numa malha só); separar por roda quando incomodar.
// =====================================================================
const loader = new GLTFLoader(), cache = new Map(), failed = new Set();

// separa os triângulos de g (não indexada) em [pred verdadeiro, falso]
function splitGeo(g, pred) {
  const names = Object.keys(g.attributes), pos = g.attributes.position, out = [{}, {}];
  for (const n of names) out[0][n] = [], out[1][n] = [];
  for (let t = 0; t < pos.count; t += 3) {
    const o = out[pred((pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3, (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3, (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3) ? 0 : 1];
    for (const n of names) { const a = g.attributes[n], s = a.itemSize; for (let i = t * s; i < (t + 3) * s; i++) o[n].push(a.array[i]); }
  }
  return out.map(o => { const r = new THREE.BufferGeometry(); for (const n of names) r.setAttribute(n, new THREE.Float32BufferAttribute(o[n], g.attributes[n].itemSize)); return r; });
}

function prepare(D, scene) {
  const M = D.model, fix = new THREE.Matrix4().makeScale(M.scale || 1, M.scale || 1, M.scale || 1);
  if (M.rot) fix.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...M.rot)));
  scene.updateMatrixWorld(true);
  const parts = { hull: [], track: [], turret: [], gun: [] }, mats = new Map();
  scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld).applyMatrix4(fix), mat = o.material;
    if (!mats.has(mat)) { mat.transparent = false; mat.depthWrite = true; mats.set(mat, mats.size); }
    const mi = mats.get(mat);
    if (mat.name === M.turret) {
      const [gun, tur] = splitGeo(g.toNonIndexed(), (x, y, z) => z > M.cut);
      parts.gun.push({ g: gun.translate(-M.trunnion[0], -M.trunnion[1], -M.trunnion[2]), mi });
      parts.turret.push({ g: tur.translate(-M.ring[0], -M.ring[1], -M.ring[2]), mi });
    } else parts[mat.name === (M.track || 'chassis') ? 'track' : 'hull'].push({ g, mi });
  });
  return { parts, mats: [...mats.keys()] };
}

export async function preloadTankModels(defs) {
  await Promise.all(defs.filter(D => D.model && !cache.has(D.key) && !failed.has(D.key)).map(async D => {
    try { cache.set(D.key, prepare(D, (await loader.loadAsync(D.model.url)).scene)); }
    catch (e) { failed.add(D.key); console.warn(`[modelos] ${D.key}: ${D.model.url} indisponível, usando procedural`); }
  }));
}
export const hasTankModel = D => !!(D.model && cache.has(D.key));

// Monta o mesmo objeto que buildTank() devolve. tagArmor(mesh, D, part) grava a espessura por vértice (visão de blindagem).
export function gltfTank(D, tagArmor) {
  const C = cache.get(D.key), M = D.model, mats = C.mats.map(m => m.clone()), armorMeshes = [];
  const root = new THREE.Group(), turret = new THREE.Group(), gunPivot = new THREE.Group();
  turret.position.fromArray(M.ring); root.add(turret);
  gunPivot.position.set(M.trunnion[0] - M.ring[0], M.trunnion[1] - M.ring[1], M.trunnion[2] - M.ring[2]); turret.add(gunPivot);
  const put = (list, parent, part) => {
    for (const { g, mi } of list) {
      const m = new THREE.Mesh(g, mats[mi]); m.castShadow = m.receiveShadow = true; parent.add(m);
      if (!g.attributes.thick) { m.updateMatrix(); tagArmor(m, D, part); } else m.userData.normalMat = m.material;
      armorMeshes.push(m);
    }
  };
  put(C.parts.hull, root, 'hull'); put(C.parts.track, root, 'track'); put(C.parts.turret, turret, 'turret'); put(C.parts.gun, gunPivot, 'mantlet');
  const mz = new THREE.Object3D(); mz.position.set(0, 0, M.muzzle - M.trunnion[2]); gunPivot.add(mz);
  const mgMuzzle = new THREE.Object3D(); mgMuzzle.position.set(D.turret.w * .14, .05, .7); gunPivot.add(mgMuzzle);
  const still = () => ({ map: { offset: { x: 0 } } }); // esteira do modelo não rola (ver nota no topo)
  return { root, turret, gunPivot, muzzles: [mz], mgMuzzle, mats, wheels: [], armorMeshes, trackL: still(), trackR: still() };
}
