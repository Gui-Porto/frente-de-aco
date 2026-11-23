import * as THREE from 'three';
import { splitSkin, splitCockpit } from './skinSplit.js';
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
const GLASS = /glass|transparent|canopy/i;
// escuro e bem refletivo: de fora, capota de caça é um espelho do céu (e não deixa ver que a pele não tem piloto)
const glassMat = () => new THREE.MeshPhysicalMaterial({ color: 0x1b2328, roughness: .04, metalness: 0, transparent: true, opacity: .62, clearcoat: 1, clearcoatRoughness: .05, envMapIntensity: 2.4, depthWrite: false });

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
  const paint = new Set(r.mats), keep = new Set(D.model.solo ? (D.jet ? [r.gearMesh] : [r.gearMesh, r.prop]) : // hélice: sempre a do jogo (gira, borra e para)
    [r.gearMesh, ...r.bombMeshes, ...r.rocketMeshes, ...(r.ordFit || [])]); // solo: o armamento pendurado já vem na pele
  // model.solo: a pele é o avião inteiro (formas que o procedural não faz, como o A-10) — da estrutura só aparecem o
  // trem e os efeitos; senão some só a chapa (às vezes [pintura, ventre]) e os decalques
  const hidden = [];
  const hide = o => {
    const decal = o.isMesh && [o.material].flat().some(m => m.polygonOffset); // insígnia projetada na chapa (vem marcada como fx)
    if (keep.has(o) || (o.userData.fx && !decal)) return;
    if (o.isMesh && (D.model.solo || decal || [o.material].flat().some(m => paint.has(m)))) { o.visible = false; o.layers.set(1); hidden.push(o); } // camada 1: o raio das marcas de bala passa direto e pega a pele
    for (const c of o.children) hide(c);
  };
  hide(r.root);
  // solo: a tripulação procedural senta na altura da capota procedural e furava a capota da pele (capacete do F-4E para fora)
  // model.seats: [[y, z], ...] = cabeça de cada tripulante NA PELE — com a capota de vidro, cabine vazia chamava atenção
  const crew = []; r.root.traverse(g => { if (g.userData.crew) crew.push(g); });
  const seats = D.model.seats || [], home = crew.map(g => g.position.clone());
  if (D.model.solo) crew.forEach((g, i) => { if (seats[i]) g.position.set(0, seats[i][0], seats[i][1]); else g.traverse(o => { if (o.isMesh && o.visible) { o.visible = false; o.layers.set(1); hidden.push(o); } }); });
  // solo: o alojamento do trem é o da estrutura (invisível, noutra altura) — recolhido, o trem some em vez de ficar sobre a asa da pele
  // model.nozzles: a chama da pós-combustão sai dos bocais da pele (os da estrutura ficam noutro lugar: no F-4E, 6 m atrás)
  (D.model.nozzles || []).forEach(([x, y, z, rr], i) => { const f = r.fx.flames[i]; if (!f) return; f.out.position.set(x, y, z); f.inn.position.set(x, y, z); f.glow.position.set(x, y, z + 0.05); f.r = rr; });
  // solo: as portas do trem são recortes da chapa procedural (cinza, noutra forma) — na pele real ficavam chapas soltas no ar
  r.gearMesh.traverse(o => { if (o.userData.door || o.userData.legDoor) o.visible = false; });
  if (D.model.solo && r.gearMesh.userData.anim) { const g = r.gearMesh, anim = g.userData.anim; g.userData.anim = (k, ...a) => { anim(k, ...a); g.visible = k > 0.03; }; }
  const body = src.clone(true); if (D.model.off) body.position.fromArray(D.model.off);
  r.root.add(body); r.root.updateMatrixWorld(true);
  const glass = [];
  body.traverse(o => {
    if (!o.isMesh) return;
    // vidro da capota: os arquivos chegam com tudo opaco (capota branca leitosa) — vira o mesmo vidro da capota procedural
    if (GLASS.test(o.material.name) || (D.model.glass || []).includes(o.material.name)) { o.material = glassMat(); o.castShadow = false; o.renderOrder = 2; o.userData.normalMat = o.material; glass.push(o); return; }
    o.castShadow = o.receiveShadow = true; o.material = o.material.clone(); o.userData.normalMat = o.material; r.mats.push(o.material); // material por avião: o fogo escurece só o dele
  });
  const nodes = [body], named = {};
  for (const [n, g] of [['wingL', r.wingL], ['wingR', r.wingR], ['tail', r.tail]]) { const o = body.getObjectByName(n); if (o) { g.attach(o); nodes.push(o); named[n] = o; } }
  // a pele acompanha o dano: ponta da asa, ailerons, flaps, profundores e leme viram peças presas aos grupos do modelo de dano
  // (skinSplit.js); o vidro da capota vai para a peça solta da capota (ejetada/arrancada, leva o vidro junto)
  nodes.push(...splitSkin(D, r, named));
  let canopy = null; r.root.traverse(o => { if (o.userData.loose && o.userData.loose.k === 'canopy') canopy = o; });
  if (canopy) for (const o of glass) { canopy.attach(o); nodes.push(o); }
  // solo: na vista de cabine volta a estrutura procedural (é ela que tem painel, assento e vidro por dentro) e a pele some
  // trem na asa DA PELE: o munhão da perna fica na altura da asa procedural; a asa da pele costuma passar mais baixo e o topo
  // da perna (munhão, macaco de recolhimento) atravessava o extradorso — o trem parecia de outro avião. Mede a asa da pele no
  // ponto do trem (raio de cima para baixo) e desce/sobe o trem inteiro até o munhão ficar no meio dela; a altura do CG ao chão
  // (lift) acompanha, senão as rodas afundariam na pista.
  const U = r.gearMesh && r.gearMesh.userData;
  if (D.model.solo && U && U.bayY != null && named.wingL) {
    r.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(r.root.localToWorld(new THREE.Vector3(U.mainX, 6, U.mainZ)), new THREE.Vector3(0, -1, 0).transformDirection(r.root.matrixWorld), 0, 12);
    const hits = ray.intersectObjects([r.wingL, r.tipL].filter(Boolean), true).filter(h => h.object.visible).map(h => r.root.worldToLocal(h.point.clone()).y);
    if (hits.length >= 2) {
      const dy = THREE.MathUtils.clamp((Math.max(...hits) + Math.min(...hits)) / 2 - U.bayY, -0.7, 0.7);
      r.gearMesh.position.y += dy; U.lift -= dy; U.noseLift -= dy; U.skinDy = dy;
    }
  }
  // vista de cabine: a pele CONTINUA (nariz, asas e hélice de verdade lá fora; por dentro ela é invisível, as faces olham para
  // fora) e da estrutura só entra o interior — painel, mira, assento. Antes a pele sumia e voltava a estrutura inteira: sem
  // nariz, com as armas flutuando e a asa sem pintura
  const inCock = o => { for (let q = o; q; q = q.parent) if (q.userData.cockpit) return true; return false; }, inner = hidden.filter(inCock);
  const core = D.model.solo ? splitCockpit(D, r, body, crew.map((g, i) => seats[i] || [home[i].y, home[i].z]).slice(0, Math.max(1, seats.length))) : [];
  if (D.model.solo) r.skinView = cockpit => { for (const o of inner) o.visible = cockpit; for (const o of glass) o.visible = !cockpit; for (const o of core) o.visible = !cockpit; };
  // o interior (painel, mira, assento) vai junto com o piloto para a cabine DA PELE: o olho da câmera é a cabeça dele
  if (D.model.solo && seats[0] && home[0]) r.root.traverse(o => { if (o.userData.cockpit) { o.position.y += seats[0][0] - home[0].y; o.position.z += seats[0][1] - home[0].z; } }); // soma: o grupo já vem recuado por model.fz
}
