import * as THREE from 'three';
import { renderer, camera, afterRender } from '../core/render.js';
import { S } from '../core/state.js';
import { XR } from '../ui/xray.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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

const glass = new THREE.ShaderMaterial({ vertexShader: XR.VS, transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, side: THREE.DoubleSide,
  fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float e = f * f * f; gl_FragColor = vec4(mix(vec3(0.45, 0.66, 0.76), vec3(0.8, 0.96, 1.0), e), 0.05 + 0.5 * e); }' });
{ const sc = new THREE.Scene(); sc.add(new THREE.Mesh(XR.GEO.box, glass)); renderer.compile(sc, camera); }
const COL = { pilot: 0x7fd070, engine: 0xc2c8ca, fuel: 0x6f9bd0, ammo: 0xd9b25a, gun: 0x9aa3a6, radar: 0xa9c6d8, cool: 0x8fb0a8, oil: 0xb08a4a, turbo: 0xc2c8ca, act: 0xc9b46a, spar: 0x8d9aa0, boom: 0x8d9aa0, gear: 0x7d868a, ctrl: 0x9fb6c4, flap: 0x9fb6c4 };
const YEL = new THREE.Color(0xffc83a), RED = new THREE.Color(0xff3b1f), DEAD = new THREE.Color(0x1c1414), _c = new THREE.Color();
// estado de um módulo: 0 inteiro … 1 no fim; dead/lost à parte. A HUD usa o mesmo para as etiquetas
export const modWear = m => (m.max > 0 ? 1 - Math.max(0, Math.min(1, m.hp / m.max)) : 0);
export function modColor(m, out = _c) {
  if (m.dead) return out.copy(DEAD);
  const d = modWear(m); out.set(COL[m.kind] || 0xb9c2c4);
  return d < 0.5 ? out.lerp(YEL, d / 0.5) : out.copy(YEL).lerp(RED, (d - 0.5) / 0.5);
}
// Formas dos módulos (unitárias, cabem em [-0,5; 0,5]³ e levam a escala da caixa do módulo): antes era tudo caixa e o
// raio-X ficava "quadradão" (dono). Motor a jato torneado (entrada, compressor, câmara, bocal), radial com a coroa de
// cilindros, motor em linha em bloco arredondado, tanque em cápsula, arma com culatra e cano, antena do radar em prato,
// piloto com corpo e cabeça. Tudo com o material sólido do raio-X dos tanques (sombreado pela normal: forma curva lê bem).
const mg = arr => mergeGeometries(arr.map(g => (g.index ? g.toNonIndexed() : g))); // juntar indexada com não indexada devolve null
const V2 = (x, y) => new THREE.Vector2(x, y), latheZ = (pts, seg = 22) => new THREE.LatheGeometry(pts, seg).rotateX(Math.PI / 2);
const SH = {
  jet: mg([latheZ([V2(0.30, -0.5), V2(0.44, -0.42), V2(0.40, -0.2), V2(0.5, -0.12), V2(0.5, 0.02), V2(0.42, 0.1), V2(0.47, 0.2), V2(0.47, 0.42), V2(0.36, 0.5)]),
    ...[-0.02, 0.22, 0.3, 0.38].map(z => new THREE.TorusGeometry(0.49, 0.025, 6, 22).translate(0, 0, z)), new THREE.ConeGeometry(0.16, 0.2, 14).rotateX(Math.PI / 2).translate(0, 0, 0.45)]),
  radial: mg([new THREE.CylinderGeometry(0.26, 0.3, 0.9, 16).rotateX(Math.PI / 2),
    ...Array.from({ length: 14 }, (_, k) => { const a = k / 14 * Math.PI * 2, z = k % 2 ? -0.16 : 0.16; return new THREE.CylinderGeometry(0.075, 0.085, 0.26, 8).translate(0, 0.37, 0).rotateZ(a).translate(0, 0, z); })]),
  block: mg([new RoundedBoxGeometry(0.62, 0.7, 1, 3, 0.12).translate(0, -0.1, 0), ...[-1, 1].map(sd => new RoundedBoxGeometry(0.3, 0.3, 0.92, 2, 0.08).rotateZ(sd * 0.5).translate(sd * 0.27, 0.27, 0))]),
  tank: new THREE.CapsuleGeometry(0.5, 1, 8, 18).rotateX(Math.PI / 2).scale(1, 1, 0.5),
  drum: new THREE.CapsuleGeometry(0.5, 0.6, 6, 14).scale(1, 0.625, 1),
  ammo: new RoundedBoxGeometry(1, 1, 1, 2, 0.14),
  gun: mg([new RoundedBoxGeometry(0.8, 0.85, 0.42, 2, 0.08).translate(0, 0, -0.29), new THREE.CylinderGeometry(0.2, 0.2, 0.62, 10).rotateX(Math.PI / 2).translate(0, 0, 0.19)]),
  dish: mg([new THREE.SphereGeometry(0.5, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.38).rotateX(-Math.PI / 2).translate(0, 0, 0.42), new THREE.CylinderGeometry(0.08, 0.14, 0.5, 8).rotateX(Math.PI / 2).translate(0, 0, -0.2)]),
  beam: new RoundedBoxGeometry(1, 0.55, 0.5, 1, 0.06),
  plate: new RoundedBoxGeometry(1, 0.35, 1, 1, 0.05),
  rod: new THREE.CylinderGeometry(0.5, 0.5, 1, 10).rotateX(Math.PI / 2),
};
const shapeOf = (m, D) => (m.kind === 'engine' ? (D.jet ? 'jet' : D.radial ? 'radial' : 'block') : m.kind === 'fuel' ? 'tank' : m.kind === 'oil' || m.kind === 'cool' || m.kind === 'turbo' || m.kind === 'act' ? 'drum'
  : m.kind === 'ammo' ? 'ammo' : m.kind === 'gun' ? 'gun' : m.kind === 'radar' ? 'dish' : m.kind === 'spar' ? 'beam' : m.kind === 'boom' || m.name === 'cables' ? 'rod' : 'plate');
// estrutura e comandos só aparecem avariados (a casca já mostra onde ficam): inteiros, viravam um monte de placas
const QUIET = { ctrl: 1, flap: 1, gear: 1, boom: 1 };
function build(p) {
  const grp = new THREE.Group(); grp.matrixAutoUpdate = false; const items = [];
  for (const m of Object.values(p.mods)) {
    const mat = XR.solid.clone(), o = new THREE.Group(); o.position.fromArray(m.c);
    if (m.kind === 'pilot') { const b = new THREE.Mesh(XR.GEO.body, mat), h = new THREE.Mesh(XR.GEO.head, mat); b.position.y = -0.1; h.position.y = 0.36; o.add(b, h); o.scale.setScalar(1.15); }
    else { const g = new THREE.Mesh(SH[shapeOf(m, p.def)], mat); g.scale.set(m.h[0] * 2, m.h[1] * 2, m.h[2] * 2); o.add(g); }
    o.traverse(q => { q.frustumCulled = false; }); grp.add(o); items.push([m, o, mat]);
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
    o.visible = !m.lost && !(QUIET[m.kind] && !m.dead && modWear(m) < 0.02); if (!o.visible) continue;
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
  setMat(glass); renderer.render(hull, camera);                              // vidro por cima
  renderer.autoClear = ac;
  meshes.forEach((o, i) => { o.material = mats[i]; });
  for (const o of hid) o.visible = true;
  hull.children.length = inner.children.length = 0;
});
