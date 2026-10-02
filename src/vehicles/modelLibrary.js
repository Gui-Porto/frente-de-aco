import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// =====================================================================
// Biblioteca de modelos glTF das aeronaves (opcional). Uma aeronave passa a
// usar um modelo comprado/importado só com dados:
//   def.model = { url: '/models/f4e.glb', scale: 1, rot: [0, Math.PI, 0] }
// Contrato de nós (nomes no arquivo .glb):
//   wingL, wingR — asas inteiras (soltam ao quebrar)   tail — empenagem
//   prop         — hélice/fan que gira (o último filho some com o motor parado)
//   hp_1..hp_N   — pontos duros, na ordem das estantes de def.missiles
//   paint        — material(is) que escurecem quando o avião queima (opcional)
// O que faltar no arquivo vira um grupo vazio; sem arquivo (ou falha ao carregar)
// o jogo segue com o modelo procedural (planeModel.js), que também serve de LOD.
// Eixos esperados após rot/scale: +z nariz, +y cima, +x asa esquerda; origem no CG.
// =====================================================================
const loader = new GLTFLoader(), cache = new Map(), failed = new Set();

// carrega (uma vez) os modelos das aeronaves pedidas; nunca rejeita
export async function preloadModels(defs) {
  await Promise.all(defs.filter(D => D.model && !cache.has(D.model.url) && !failed.has(D.model.url)).map(async D => {
    try { const gl = await loader.loadAsync(D.model.url); cache.set(D.model.url, gl.scene); }
    catch (e) { failed.add(D.model.url); console.warn(`[modelos] ${D.key}: ${D.model.url} indisponível, usando procedural`); }
  }));
}
export const hasModel = D => !!(D.model && cache.has(D.model.url));

// Monta o mesmo objeto que buildPlane() devolve, a partir do glTF carregado.
// missileMesh(M) cria a malha do míssil (a mesma do procedural) para pendurar nos pontos duros.
export function gltfPlane(D, missileMesh) {
  const src = cache.get(D.model.url); if (!src) return null;
  const root = new THREE.Group(), body = src.clone(true);
  body.scale.setScalar(D.model.scale || 1);
  if (D.model.rot) body.rotation.set(...D.model.rot);
  root.add(body);
  const find = n => body.getObjectByName(n);
  const part = n => find(n) || (() => { const gq = new THREE.Group(); gq.name = n; body.add(gq); return gq; })();
  const wingL = part('wingL'), wingR = part('wingR'), tail = part('tail'), prop = part('prop');
  if (!prop.children.length) prop.add(new THREE.Group());
  const mats = new Set();
  body.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    // material próprio por avião (o dano escurece a pintura sem afetar os outros)
    o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
    if (o.name.startsWith('paint') || (o.material.name || '').startsWith('paint')) mats.add(o.material);
    o.userData.normalMat = o.material;
  });
  const missileMeshes = []; let i = 0;
  for (const rk of D.missiles || []) for (let k = 0; k < rk.n; k++) {
    const hp = find(`hp_${++i}`), m = missileMesh(rk.w);
    if (hp) hp.add(m); else { m.visible = false; root.add(m); }
    missileMeshes.push(m);
  }
  if (!mats.size) body.traverse(o => { if (o.isMesh && !mats.size) mats.add(o.material); });
  return { root, wingL, wingR, tail, prop, bombMeshes: [], rocketMeshes: [], missileMeshes, mats: [...mats] };
}
