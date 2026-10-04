import { Quaternion } from 'three';
import { camera } from '../core/render.js';
import { S } from '../core/state.js';
import { settings, isDown } from '../core/settings.js';
import { V3, UP, clamp, lerp, rand, REDUCED } from '../core/util.js';
import { H } from '../world/terrain.js';
import { cam } from '../game/camera.js';
import { cmd } from './input.js';
// =====================================================================
// CameraSystem da Batalha Aérea (mira "mouse aim" como no WT).
// A mira é uma orientação LIVRE (quaternion): o mouse gira em torno dos
// eixos da própria mira, então dá para passar da vertical e fazer loop.
// Longe da vertical, o horizonte da câmera se nivela sozinho.
// O avião persegue a direção da mira; a câmera fica atrás da mira.
// Modos (V): perseguição, terceira pessoa, cockpit, livre. Botão direito: mira.
// =====================================================================
export const CAM_MODES = ['Perseguição', 'Terceira pessoa', 'Cockpit', 'Livre'];
export const acam = { mode: 0, fov: 65, hit: 0, gOff: 0, pos: new V3(), off: new V3(), init: false, aimK: 0, free: false };
const aimQ = new Quaternion(), viewQ = new Quaternion(), _qa = new Quaternion(), FLIP = new Quaternion().setFromAxisAngle(new V3(0, 1, 0), Math.PI);
const X = new V3(1, 0, 0), Y = new V3(0, 1, 0);
const _d = new V3(), _u = new V3(), _p = new V3(), _t = new V3(), _f = new V3(), _w = new V3(), _r = new V3();
export const fwdQ = (q, out) => out.set(0, 0, 1).applyQuaternion(q);
export const upQ = (q, out) => out.set(0, 1, 0).applyQuaternion(q);

export function resetAirCam(yaw) {
  aimQ.setFromAxisAngle(Y, yaw); aimQ.multiply(_qa.setFromAxisAngle(X, 0.04)); viewQ.copy(aimQ);
  fwdQ(aimQ, cam.aimDir); acam.init = false; acam.mode = 0; acam.hit = 0; acam.aimK = 0;
}
// testes (Playwright): aponta a mira numa direção do mundo, como se o mouse tivesse ido até lá
export function aimAt(dir) { aimQ.setFromUnitVectors(_t.set(0, 0, 1), dir); cam.aimDir.copy(dir); }
// dx, dy em radianos (já com sensibilidade). Mouse para a direita = mira para a direita.
export function airMouse(dx, dy) {
  const q = acam.free ? viewQ : aimQ;
  q.multiply(_qa.setFromAxisAngle(Y, -dx)).multiply(_qa.setFromAxisAngle(X, dy)).normalize();
}
// gira a orientação em torno do próprio eixo frontal até o "para cima" ficar o mais vertical possível.
// Perto da vertical o céu não define "cima": aí o cima desejado passa a ser o dorso do avião (ref), como no WT.
// Antes o nivelamento simplesmente desligava acima de ~55° e a mira ficava torta/invertida depois de um looping.
const _h = new V3(), _ref = new V3();
function autoLevel(q, k, ref) {
  fwdQ(q, _f); upQ(q, _u);
  const t = ref ? clamp((Math.abs(_f.y) - 0.7) / 0.2, 0, 1) : 0;
  if (!ref && Math.abs(_f.y) > 0.82) return;
  _w.copy(UP).addScaledVector(_f, -_f.y);
  if (t > 0) { _h.copy(ref).addScaledVector(_f, -ref.dot(_f)); if (_h.lengthSq() > 1e-6) _w.normalize().lerp(_h.normalize(), t); }
  if (_w.lengthSq() < 1e-6) return;
  _w.normalize(); // cima desejado ⟂ frente
  const ang = Math.atan2(_r.crossVectors(_u, _w).dot(_f), _u.dot(_w));
  q.premultiply(_qa.setFromAxisAngle(_f, ang * k)).normalize();
}
function setFov(f) { if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); } }

export function updateAirCamera(dt) {
  camera.clearViewOffset();
  const p = S.player, v = p && (p.alive || S.state !== 'spectate') ? p : S.spectate || p;
  if (!v) return;
  if (cmd.lookX || cmd.lookY) airMouse(-cmd.lookX * dt, -cmd.lookY * dt); // direcional do gamepad
  const own = v === p && p.alive;
  const free = acam.mode === 3 || isDown('freelook') || !own;
  acam.free = free;
  if (own && settings.gameplay.flightMode === 'teclado' && !free) {
    // controle direto: a mira acompanha o nariz (câmera presa atrás do avião)
    aimQ.slerp(v.q, 1 - Math.exp(-dt * 8));
  }
  // tecla de manche no modo mouse: a câmera continua livre no mouse (o jogador não quer a vista presa);
  // ao soltar, o instrutor volta a levar o nariz para o círculo, como no WT
  // o horizonte nivela devagar (mais rápido quando de cabeça para baixo)
  upQ(aimQ, _u); autoLevel(aimQ, 1 - Math.exp(-dt * (_u.y < 0 ? 2.2 : 1.4)), own ? upQ(v.q, _ref) : null);
  // visão: igual à mira; no modo livre ela gira sozinha e volta ao sair
  if (!free) viewQ.slerp(aimQ, 1 - Math.exp(-dt * 28)); else autoLevel(viewQ, 1 - Math.exp(-dt * 2));
  fwdQ(aimQ, _d); cam.aimDir.copy(own ? _d : fwdQ(viewQ, _t));
  const aiming = own && cmd.aim;
  acam.aimK += ((aiming ? 1 : 0) - acam.aimK) * (1 - Math.exp(-dt * 8));
  const ias = v.ias || 0, n = v.n || 1;
  // recuo com G e FOV que abre com a velocidade
  acam.gOff += (clamp((n - 1) / 8, -0.3, 1) - acam.gOff) * (1 - Math.exp(-dt * 3));
  const speedK = clamp((ias - 90) / 230, 0, 1);
  let fov = 62 + speedK * 12 - acam.gOff * 3;
  let dist = 15 + v.def.span * 0.25, up = 3.2, k = 12;
  if (acam.mode === 1) { dist *= 2; up = 7; k = 5; fov -= 4; }
  if (acam.mode === 3) { dist *= 1.5; up = 4.5; k = 7; }
  dist = (dist + acam.gOff * 3) * (1 + speedK * 0.1);
  const cockpit = own && acam.mode === 2;
  v.root.visible = !cockpit;
  fwdQ(viewQ, _f); upQ(viewQ, _u);
  // A suavização é feita no DESLOCAMENTO em relação ao avião (não na posição do mundo):
  // assim não existe atraso proporcional à velocidade e trocar de modo é só uma transição curta.
  if (cockpit) {
    _p.set(0, v.def.fuseR * 1.15, v.def.jet ? v.def.L * 0.24 : -v.def.L * 0.02).applyQuaternion(v.q);
    acam.off.copy(_p); fov = 70 + speedK * 6;
  } else {
    // atrás e acima da linha de visada (no "cima" da própria câmera: funciona invertido)
    _p.copy(_f).multiplyScalar(-dist).addScaledVector(_u, up).addScaledVector(v.vel, -0.006); // leve recuo com a velocidade
    if (!acam.init) { acam.off.copy(_p); acam.init = true; }
    acam.off.lerp(_p, settings.gameplay.camSmooth ? 1 - Math.exp(-dt * k) : 1).setLength(_p.length()); // gira em volta, sem encurtar
  }
  acam.pos.copy(v.pos).add(acam.off);
  // câmera de mira (como no WT): continua atrás da linha de visada, um pouco mais alta e com FOV fechado.
  // Antes ia para um ponto no referencial do AVIÃO olhando pela mira: em curva o avião enchia a tela.
  if (acam.aimK > 0.01 && !cockpit) {
    _t.copy(v.pos).addScaledVector(_f, -dist).addScaledVector(_u, up * 1.7); // mais alto: a deriva não cobre a mira
    acam.pos.lerp(_t, acam.aimK);
  }
  if (acam.aimK > 0.01) fov = lerp(fov, 32, acam.aimK);
  acam.fov += (fov - acam.fov) * (1 - Math.exp(-dt * 5));
  setFov(acam.fov);
  acam.pos.y = Math.max(acam.pos.y, H(acam.pos.x, acam.pos.z) + 2);
  camera.position.copy(acam.pos);
  camera.quaternion.copy(viewQ).multiply(FLIP); // a câmera olha para −z
  // tremores: impacto, armas, buffet perto do estol, velocidade-limite
  let sh = S.shake + acam.hit * 0.8;
  if (own) {
    if (v.firing) sh += 0.08 + (v.guns[0].W.cal > 20 ? 0.12 : 0);
    const as = v.def.clmax / v.def.cla; if (Math.abs(v.alpha) > as * 0.85) sh += 0.25;
    if (ias > v.def.vne * 0.92) sh += 0.3;
    sh += speedK * 0.04;
    sh += (v.brakeK || 0) * Math.min(1, ias / 200) * 0.35; // freio aerodinâmico aberto: buffet dos painéis
    if (v.onGround) sh += Math.min(1, Math.hypot(v.vel.x, v.vel.z) / 60) * 0.18; // rolando na pista: juntas das placas
  }
  if (sh > 0 && !REDUCED) { const a = sh * 0.006 * (1 - acam.aimK * 0.7); camera.rotateX(rand(-1, 1) * a); camera.rotateY(rand(-1, 1) * a); camera.rotateZ(rand(-1, 1) * a * 0.5); }
  S.shake = Math.max(0, S.shake - dt * 1.5); acam.hit = Math.max(0, acam.hit - dt * 2.5);
}
