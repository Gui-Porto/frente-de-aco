import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// =====================================================================
// "Pele" glTF das aeronaves (opcional), só por dados:
//   def.model = { url: '/models/p47.glb', off?: [x, y, z], fz?: recuo da fuselagem procedural (m), def?: { ...ajustes da ficha } }
// O arquivo (preparado por tools/blender/skin.py) traz 4 nós — fuse, wingL, wingR, tail — em metros, +z nariz,
// +y cima, +x asa esquerda, origem no CG. Ele NÃO substitui o avião: a estrutura continua sendo a procedural
// (planeModel.js: trem, hélice, armas, cabine, bombas, peças de dano, efeitos); a pele só toma o lugar da chapa
// pintada, que fica invisível. Cada nó vai para o grupo correspondente, então asa/cauda arrancada leva a pele junto.
// Sem arquivo (ou falha ao carregar) o avião aparece com a chapa procedural.
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

// r = o que buildPlane() montou. Esconde a chapa pintada e as insígnias projetadas nela e pendura a pele.
export function applySkin(D, r) {
  const src = cache.get(D.model.url); if (!src) return;
  const paint = new Set(r.mats);
  r.root.traverse(o => {
    if (!o.isMesh || ![o.material].flat().some(m => paint.has(m) || m.polygonOffset)) return; // chapa (às vezes [pintura, ventre]) e decalques
    o.visible = false; o.layers.set(1); // camada 1: o raio das marcas de bala passa direto e pega a pele
  });
  const body = src.clone(true); if (D.model.off) body.position.fromArray(D.model.off);
  r.root.add(body); r.root.updateMatrixWorld(true);
  body.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true; o.material = o.material.clone(); o.userData.normalMat = o.material; r.mats.push(o.material); // material por avião: o fogo escurece só o dele
  });
  for (const [n, g] of [['wingL', r.wingL], ['wingR', r.wingR], ['tail', r.tail]]) { const o = body.getObjectByName(n); if (o) g.attach(o); }
}
