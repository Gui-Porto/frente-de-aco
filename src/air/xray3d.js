import * as THREE from 'three';
import { renderer, camera, afterRender } from '../core/render.js';
import { S } from '../core/state.js';
import { XR } from '../ui/xray.js';
// =====================================================================
// Raio-X no PRÓPRIO caça (como no WT): com a tecla ligada, o avião do jogador deixa de ser desenhado no quadro normal e
// é redesenhado por cima, direto na tela, como casca translúcida (o mesmo "vidro" do raio-X dos tanques) com os módulos
// do modelo de dano por dentro — cada caixa na posição real (pl.mods), na cor do tipo e amarelando/avermelhando com o
// estrago; destruído fica escuro, arrancado some, atingido agora há pouco pisca. É o avião de verdade (root vivo): ponta
// que caiu, trem baixado e superfície arrancada aparecem como estão. Nenhum material novo: os do raio-X dos tanques,
// já compilados na carga, mais uma sombra chapada (semente compilada aqui).
// =====================================================================
export const xr = { on: false, plane: null };
const hull = new THREE.Scene(), inner = new THREE.Scene();
hull.matrixWorldAutoUpdate = inner.matrixWorldAutoUpdate = false;
// fundo escuro só na camada da frente da casca: sem ele o vidro azul-claro sumia contra céu claro
const shade = new THREE.ShaderMaterial({ vertexShader: XR.VS, transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, side: THREE.DoubleSide, fragmentShader: 'void main(){ gl_FragColor = vec4(0.02, 0.05, 0.08, 0.5); }' });
{ const sc = new THREE.Scene(), m = new THREE.Mesh(XR.GEO.box, shade); sc.add(m); renderer.compile(sc, camera); }

const COL = { pilot: 0x7fd070, engine: 0xc2c8ca, fuel: 0x6f9bd0, ammo: 0xd9b25a, gun: 0x9aa3a6, radar: 0xa9c6d8, cool: 0x8fb0a8, oil: 0xb08a4a, turbo: 0xc2c8ca, act: 0xc9b46a, spar: 0x8d9aa0, boom: 0x8d9aa0, gear: 0x7d868a, ctrl: 0x9fb6c4, flap: 0x9fb6c4 };
const YEL = new THREE.Color(0xffc83a), RED = new THREE.Color(0xff3b1f), DEAD = new THREE.Color(0x1c1414), _c = new THREE.Color();
// estado de um módulo: 0 inteiro … 1 no fim; dead/lost à parte. A HUD usa o mesmo para as etiquetas
export const modWear = m => (m.max > 0 ? 1 - Math.max(0, Math.min(1, m.hp / m.max)) : 0);
export function modColor(m, out = _c) {
  if (m.dead) return out.copy(DEAD);
  const d = modWear(m); out.set(COL[m.kind] || 0xb9c2c4);
  return d < 0.5 ? out.lerp(YEL, d / 0.5) : out.copy(YEL).lerp(RED, (d - 0.5) / 0.5);
}
function build(p) {
  const grp = new THREE.Group(); grp.matrixAutoUpdate = false; const items = [];
  for (const m of Object.values(p.mods)) {
    const mat = XR.solid.clone(), round = m.kind === 'gun' || (m.kind === 'engine' && p.def.jet) || m.kind === 'boom';
    const o = new THREE.Mesh(m.kind === 'pilot' ? XR.GEO.body : round ? XR.GEO.cyl : XR.GEO.box, mat);
    o.position.fromArray(m.c); if (m.kind !== 'pilot') o.scale.set(m.h[0] * 2, m.h[1] * 2, m.h[2] * 2); else o.scale.setScalar(1.25);
    o.frustumCulled = false; grp.add(o); items.push([m, o, mat]);
  }
  return { grp, items, mods: p.mods };
}
const meshes = [], mats = [], hid = [];
const setMat = m => { for (const o of meshes) o.material = m; };
afterRender.push(() => {
  const p = xr.plane;
  if (!xr.on || !p || !p.alive || p.gone || !p.root.parent || S.state !== 'play' || S.player !== p) return;
  if (!p._xr || p._xr.mods !== p.mods) p._xr = build(p); // refit troca o modelo de dano: refaz
  const st = p._xr;
  p.root.visible = true; p.root.updateMatrixWorld(true);
  // casca = todas as malhas visíveis do avião; efeitos (chama, marcas) e sprites ficam fora destes passes
  meshes.length = mats.length = hid.length = 0;
  p.root.traverseVisible(o => {
    if (o.isMesh && !o.userData.fx && o.layers.test(camera.layers) && o.geometry.attributes.normal) { meshes.push(o); mats.push(o.material); }
    else if (o.isMesh || o.isSprite || o.isLine || o.isPoints) hid.push(o);
  });
  for (const o of hid) o.visible = false;
  for (const [m, o, mat] of st.items) {
    o.visible = !m.lost; if (m.lost) continue;
    modColor(m, mat.uniforms.col.value);
    mat.uniforms.glow.value = Math.max(0, 1 - (S.now - (m.hitT ?? -9)) / 0.7);
  }
  st.grp.matrix.copy(p.root.matrixWorld); st.grp.updateMatrixWorld(true);
  inner.children.length = 0; inner.children.push(st.grp); hull.children.length = 0; hull.children.push(p.root);
  const ac = renderer.autoClear; renderer.autoClear = false; renderer.setRenderTarget(null);
  renderer.clearDepth(); setMat(XR.ghostPre); renderer.render(hull, camera);   // profundidade da casca
  setMat(shade); renderer.render(hull, camera);                                 // silhueta escurecida (uma camada)
  renderer.clearDepth(); renderer.render(inner, camera);                         // módulos
  setMat(XR.ghostPre); renderer.render(hull, camera);
  setMat(XR.ghost); renderer.render(hull, camera);                              // vidro por cima
  renderer.autoClear = ac;
  meshes.forEach((o, i) => { o.material = mats[i]; });
  for (const o of hid) o.visible = true;
  hull.children.length = inner.children.length = 0;
});
