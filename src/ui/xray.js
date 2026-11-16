import * as THREE from 'three';
import { S } from '../core/state.js';
import { $, clamp } from '../core/util.js';
import { renderer, afterRender } from '../core/render.js';
import { buildTank } from '../vehicles/tank.js';
import { compLabel } from '../combat/ballistics.js';
import { report } from './hud.js';

// =====================================================================
// Hit-cam raio-X em 3D: o PRÓPRIO modelo do alvo, translúcido, com tripulação e módulos por dentro, a trajetória do
// projétil, os estilhaços e o que foi atingido. É desenhado no canvas principal, por cima do quadro, no retângulo do
// #xray (que fica transparente e só leva os textos). Tudo em coordenadas locais do alvo (root), então o alvo pode
// andar/explodir à vontade. Materiais criados e compilados na carga: nenhum shader novo na hora do tiro.
// =====================================================================
const xc = $('#xray'), xctx = xc.getContext('2d');
const DUR = 5.2;

const VS = `varying vec3 vN; varying vec3 vV;
void main(){ vec4 p = vec4(position, 1.0); vec3 n = normal;
#ifdef USE_INSTANCING
  p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
#endif
  vec4 mv = modelViewMatrix * p; vN = normalize(normalMatrix * n); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
// casca: brilha nas bordas (fresnel), quase some de frente — dá para ver o interior
const ghost = new THREE.ShaderMaterial({
  vertexShader: VS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(vec3(0.42, 0.72, 0.86) * (0.025 + 0.34 * f * f * f), 1.0); }'
});
// peças internas: cor chapada com sombreado simples; `glow` acende quando é atingida
const solidProto = new THREE.ShaderMaterial({
  vertexShader: VS, uniforms: { col: { value: new THREE.Color() }, glow: { value: 0 } },
  fragmentShader: 'uniform vec3 col; uniform float glow; varying vec3 vN; varying vec3 vV; void main(){ float d = 0.45 + 0.55 * abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(col * d + vec3(1.0, 0.55, 0.2) * glow, 1.0); }'
});
const lineMat = new THREE.LineBasicMaterial({ color: 0xffb060, transparent: true, depthTest: false });
const pathMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8, depthTest: false, toneMapped: false });
const blastMat = new THREE.MeshBasicMaterial({ color: 0xffb050, transparent: true, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false });
const COL = { crew: 0x7fd070, dead: 0x4a1410, hit: 0xff4630, mod: 0xb9c2c4, ammo: 0xe0a040, fuel: 0x6f9bd0 };

const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 460 / 290, 0.1, 100);
const inner = new THREE.Group(); scene.add(inner);
const ghosts = new Map(); // um fantasma por tipo de veículo
function ghostOf(D) {
  let g = ghosts.get(D.key);
  if (!g) {
    g = buildTank(D);
    g.root.traverse(o => { if (o.isMesh) { o.material = ghost; o.castShadow = o.receiveShadow = false; o.renderOrder = 2; } else if (o.isSprite || o.isLine) o.visible = false; });
    ghosts.set(D.key, g);
  }
  return g;
}
// geometrias das peças (unitárias; a escala vem do raio do componente)
const GEO = {
  body: new THREE.CapsuleGeometry(0.2, 0.36, 3, 10), head: new THREE.SphereGeometry(0.14, 12, 8),
  box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14).rotateX(Math.PI / 2), ring: new THREE.TorusGeometry(1, 0.07, 6, 28).rotateX(Math.PI / 2),
  shell: new THREE.CylinderGeometry(0.035, 0.035, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5), ball: new THREE.SphereGeometry(1, 14, 10)
};
// [geometria, escala x/y/z em múltiplos do raio]
const SHAPE = { engine: ['box', 1.5, 1.0, 1.9], transmission: ['box', 2.0, 0.9, 1.0], ammo: ['box', 1.0, 1.3, 2.0], fuel: ['box', 1.0, 1.1, 1.9], drive: ['ring', 2.2, 2.2, 2.2], breech: ['cyl', 1.0, 1.0, 2.6] };
function compMesh(o) {
  const mat = solidProto.clone(), g = new THREE.Group(); g.position.fromArray(o.p);
  if (o.kind === 'crew') {
    const b = new THREE.Mesh(GEO.body, mat), h = new THREE.Mesh(GEO.head, mat); b.position.y = -0.05; h.position.y = 0.42; g.add(b, h);
  } else {
    const [geo, sx, sy, sz] = SHAPE[o.name] || ['box', 1.2, 1.2, 1.2], m = new THREE.Mesh(GEO[geo], mat); m.scale.set(sx * o.r, sy * o.r, sz * o.r); g.add(m);
  }
  g.userData = { o, mat };
  return g;
}
const path = new THREE.Mesh(GEO.shell, pathMat), path2 = new THREE.Mesh(GEO.shell, pathMat), blast = new THREE.Mesh(GEO.ball, blastMat);
const fragGeo = new THREE.BufferGeometry(), frags = new THREE.LineSegments(fragGeo, lineMat);
for (const m of [path, path2, blast, frags]) { m.renderOrder = 5; m.frustumCulled = false; scene.add(m); }
// compila tudo já (um fantasma qualquer não é preciso: os programas são os mesmos para qualquer geometria)
{ const tmp = new THREE.Mesh(GEO.box, ghost), tmp2 = new THREE.Mesh(GEO.box, solidProto); scene.add(tmp, tmp2); renderer.compile(scene, cam); scene.remove(tmp, tmp2); }

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
function stretch(m, p0, p1, k) { _a.fromArray(p0); _b.fromArray(p1); m.position.copy(_a); m.lookAt(_b); m.scale.set(1, 1, Math.max(0.001, _a.distanceTo(_b) * k)); }

let cur = null; // fantasma em cena
function open(t, x) {
  S.xray = Object.assign(x, { t0: performance.now(), def: t.def });
  if (cur) scene.remove(cur.root);
  cur = ghostOf(t.def); scene.add(cur.root);
  cur.turret.visible = t.turretOn; cur.turret.rotation.y = t.turretYaw; cur.gunPivot.rotation.x = -t.gunPitch;
  inner.clear(); for (const o of x.comps) inner.add(compMesh(o));
  const pts = []; for (const [f0, f1] of x.frags) pts.push(...f0, ...f0); // crescem a partir da origem
  fragGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  xc.hidden = false;
}
const state = (c, t) => c.kind === 'crew' ? c.ref.alive : !(c.name in t.mods) || !t.mods[c.name].broken;

export function xrayShot(t, hit, dir, E, am, word, detail, color, inn) {
  report(t, word, detail, color);
  const lp = hit.part === 'hull' ? hit.lp : hit.point.clone().applyMatrix4(t.invRoot).toArray();
  const ld = dir.clone().transformDirection(t.invRoot);
  const ent = inn ? inn.lp : lp;
  open(t, {
    entry: ent, pre: [ent[0] - ld.x * 4, ent[1] - ld.y * 4, ent[2] - ld.z * 4], end: inn ? inn.end : null, frags: inn ? inn.frags : [], blast: inn ? inn.blast : null,
    comps: inn ? inn.comps.map((c, i) => ({ p: c.p, r: c.r, kind: c.kind, name: c.name, label: compLabel(c), was: inn.before[i], now: state(c, t) }))
      : t.components().map(c => ({ p: c.p, r: c.r, kind: c.kind, name: c.name, was: state(c, t), now: state(c, t) })),
    word, color, ammo: `${am.name} · ${Math.round(E.pen)} mm`, plate: `${E.arm.t} mm · ${Math.round(E.ang)}° → ${Math.round(E.eff)} mm`
  });
}
export function xrayReport(r) {
  report(r.t, r.w, r.s, r.c);
  if (!r.x) return;
  const t = r.t;
  open(t, {
    entry: r.x.lp, pre: [r.x.lp[0], r.x.lp[1] + 4, r.x.lp[2]], end: null, frags: r.x.frags, blast: r.x.blast,
    comps: r.x.comps.map((c, i) => ({ p: c.p, r: c.r, kind: c.kind, name: c.name, label: compLabel(c), was: r.x.before[i], now: state(c, t) })),
    word: r.w, color: r.c, ammo: 'Alto-explosivo', plate: r.s.split(' · ').slice(1, 2).join('')
  });
}

// linha do tempo: 0–0,7 s o projétil chega; 0,7–1,6 s atravessa e os estilhaços abrem; depois o estrago fica à mostra
const _vp = new THREE.Vector4(), _sc = new THREE.Vector4(), _cc = new THREE.Color();
afterRender.push(() => {
  const X = S.xray; if (!X || xc.hidden) return;
  const el = (performance.now() - X.t0) / 1000, D = X.def, s = clamp(el / 0.7, 0, 1), k = clamp((el - 0.7) / 0.9, 0, 1);
  // câmera: orbita devagar em volta do alvo, do lado de onde veio o tiro
  const side = Math.atan2(X.pre[0] - X.entry[0], X.pre[2] - X.entry[2]), yaw = side + 0.9 - el * 0.16, pit = 0.36, dist = D.L * 1.95, cy = D.clr + D.Hh * 0.6;
  cam.position.set(Math.sin(yaw) * Math.cos(pit) * dist, cy + Math.sin(pit) * dist, Math.cos(yaw) * Math.cos(pit) * dist); cam.lookAt(0, cy, 0);
  for (const g of inner.children) {
    const { o, mat } = g.userData, lost = o.was && !o.now, shown = lost && k > 0.45;
    mat.uniforms.col.value.setHex(shown ? (el < 2.6 ? COL.hit : COL.dead) : !o.was ? COL.dead : o.kind === 'crew' ? COL.crew : COL[o.name] || COL.mod);
    mat.uniforms.glow.value = shown ? Math.max(0, 1 - (el - 1.1) / 0.9) : 0;
    if (o.kind === 'crew') g.rotation.z = shown || !o.was ? 0.9 : 0; // tripulante atingido tomba
  }
  stretch(path, X.pre, X.entry, s);
  path2.visible = s >= 1 && !!X.end; if (path2.visible) stretch(path2, X.entry, X.end, k);
  const fp = fragGeo.attributes.position; if (fp) { X.frags.forEach(([f0, f1], i) => { fp.setXYZ(i * 2 + 1, f0[0] + (f1[0] - f0[0]) * k, f0[1] + (f1[1] - f0[1]) * k, f0[2] + (f1[2] - f0[2]) * k); }); fp.needsUpdate = true; }
  frags.visible = k > 0; lineMat.opacity = clamp(2.2 - el * 0.5, 0.25, 1);
  blast.visible = !!X.blast && k > 0 && k < 0.8; if (blast.visible) { blast.position.fromArray(X.blast); blast.scale.setScalar(0.2 + k * 1.1); blastMat.opacity = 0.8 - k; }
  // desenha no retângulo do #xray
  const r = xc.getBoundingClientRect(), H = renderer.domElement.clientHeight;
  renderer.getViewport(_vp); renderer.getScissor(_sc); const st = renderer.getScissorTest(), ac = renderer.autoClear, a0 = renderer.getClearAlpha(); renderer.getClearColor(_cc);
  cam.aspect = r.width / r.height; cam.updateProjectionMatrix();
  renderer.setRenderTarget(null); renderer.autoClear = false; renderer.setScissorTest(true);
  renderer.setViewport(r.left, H - r.bottom, r.width, r.height); renderer.setScissor(r.left, H - r.bottom, r.width, r.height);
  renderer.setClearColor(0x070d11, 1); renderer.clear(true, true, false);
  renderer.render(scene, cam);
  renderer.setClearColor(_cc, a0); renderer.setViewport(_vp); renderer.setScissor(_sc); renderer.setScissorTest(st); renderer.autoClear = ac;
});

// textos por cima (canvas 2D transparente)
export function drawXray() {
  const X = S.xray; if (!X) return;
  const el = (performance.now() - X.t0) / 1000;
  if (el > DUR) { S.xray = null; xc.hidden = true; return; }
  const W = xc.width, Hh = xc.height, c = xctx, D = X.def;
  c.clearRect(0, 0, W, Hh);
  c.fillStyle = '#ddd6b7'; c.font = '600 15px "Barlow Condensed", sans-serif'; c.textAlign = 'left';
  c.fillText(`${D.short || D.name}`, 12, 22);
  c.font = '500 11px "IBM Plex Mono", monospace'; c.fillStyle = 'rgba(221,214,183,.8)';
  c.fillText(X.ammo, 12, Hh - 28); c.fillText(X.plate || '', 12, Hh - 12);
  c.textAlign = 'right'; c.font = '400 22px "Saira Stencil One", sans-serif';
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--' + X.color);
  c.fillText(X.word, W - 12, 26);
  // o que foi perdido, aparecendo um a um depois que os estilhaços abrem
  const lost = X.comps.filter(o => o.was && !o.now && o.label);
  c.font = '500 12px "IBM Plex Mono", monospace';
  lost.slice(0, 7).forEach((o, i) => {
    if (el < 1.15 + i * 0.12) return;
    c.fillStyle = '#ff5a40'; c.fillText(o.label, W - 26, 48 + i * 16); c.fillRect(W - 20, 40 + i * 16, 8, 8);
  });
  if (el > 1.2 && !lost.length && X.end) { c.fillStyle = 'rgba(221,214,183,.7)'; c.fillText('sem dano crítico', W - 12, 48); }
}
