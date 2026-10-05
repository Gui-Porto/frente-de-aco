import { renderer } from '../core/render.js';
import { S, tanks } from '../core/state.js';
import { settings, codeDown, codeUp, isDown, pressed, mouse, clearInput } from '../core/settings.js';
import { clamp } from '../core/util.js';
import { cam } from './camera.js';
import { airMouse } from '../air/camera.js';
import { los } from '../combat/ballistics.js';
import { setPause } from '../ui/menus.js';
import { drawScore } from '../ui/hud.js';
import { $ } from '../core/util.js';

export const input = { locked: false, capture: null };
const gl = renderer.domElement;
export function lockPointer() { try { const r = gl.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { /* sem pointer lock: segue sem */ } }
export function exitPointer() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* ignorado */ } }
const playing = () => S.state === 'play' || S.state === 'spectate';

addEventListener('keydown', e => {
  if (input.capture) { e.preventDefault(); input.capture(e.code); return; }
  if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code) && S.state !== 'menu' && S.state !== 'airmenu') e.preventDefault();
  // Ctrl reduz a potência do avião: bloqueia os atalhos do navegador com Ctrl durante a partida (Ctrl+S, Ctrl+D…)
  if (e.ctrlKey && playing()) e.preventDefault();
  if (e.repeat) return;
  codeDown(e.code);
  if (e.code === 'Escape' && playing() && !input.locked && !S.paused) setPause(true);
});
addEventListener('keyup', e => codeUp(e.code));
// Ctrl+W (potência − com manche para baixo) fecha a aba no Chrome e não dá para bloquear: pede confirmação antes
addEventListener('beforeunload', e => { if (playing()) { e.preventDefault(); e.returnValue = ''; } });
addEventListener('blur', () => clearInput());
addEventListener('contextmenu', e => { if (S.state !== 'menu') e.preventDefault(); });
addEventListener('mousedown', e => {
  if (input.capture) { e.preventDefault(); input.capture('Mouse' + e.button); return; }
  if (S.state === 'menu') { if (e.target === gl) cam.drag = true; return; }
  if (!playing() || S.paused) return;
  if (e.target.closest && e.target.closest('button, .ov')) return;
  if (!input.locked) lockPointer();
  if (e.button === 1) e.preventDefault(); // botão do meio marca alvo: sem rolagem automática do navegador
  codeDown('Mouse' + e.button);
});
addEventListener('mouseup', e => { codeUp('Mouse' + e.button); cam.drag = false; });
addEventListener('mousemove', e => {
  if (S.state === 'menu') { if (cam.drag) cam.orbit -= e.movementX * 0.006; return; }
  if (S.paused || !playing()) return;
  const p = S.player, air = p && p.type === 'plane';
  const inSight = cam.sniper || cam.binoc;
  const base = 0.0022 * (air ? settings.mouse.plane : inSight ? settings.mouse.sight * Math.max(cam.fov, 3) / 60 : settings.mouse.tank);
  const inv = settings.mouse.invertY ? -1 : 1;
  // Batalha Aérea: mira livre em quaternion (permite loop, sem trava perto da vertical)
  if (S.mode === 'air') { airMouse(e.movementX * base, e.movementY * base * inv); return; }
  cam.yaw -= e.movementX * base;
  cam.pitch = clamp(cam.pitch - e.movementY * base * inv, air ? -1.5 : -0.6, air ? 1.5 : 0.55);
});
addEventListener('wheel', e => { if (S.state !== 'menu') mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
document.addEventListener('pointerlockchange', () => {
  const was = input.locked; input.locked = !!document.pointerLockElement;
  if (was && !input.locked && playing() && !S.paused) setPause(true);
});

// ---------- Controle do veículo do jogador (uma vez por quadro) ----------
let wepHold = 0;
export function controlPlayer(dt) {
  // gerais
  $('#score').hidden = !(isDown('score') && S.state !== 'menu'); if (!$('#score').hidden) drawScore();
  $('#mini').classList.toggle('big', isDown('map'));
  const p = S.player;
  if (!p || !p.alive || S.state !== 'play' || S.paused) { if (p && p.type !== 'plane') { p.throttle = 0; p.steer = 0; p.mgFiring = false; p.firing = false; } return; }
  if (mouse.wheel && p.type !== 'plane') {
    if (cam.sniper || cam.binoc) cam.fov = clamp(cam.fov * (mouse.wheel > 0 ? 1.15 : 0.87), 3.5, 16);
    else cam.dist = clamp(cam.dist + mouse.wheel * 1.2, 6, 26);
  }
  if (p.type === 'plane') return controlPlane(p, dt);
  // tanque
  if (pressed('t_cruise_up')) p.cruise = Math.min(4, p.cruise + 1);
  if (pressed('t_cruise_dn')) p.cruise = Math.max(-1, p.cruise - 1);
  const fw = isDown('t_fwd'), bk = isDown('t_back');
  if (fw || bk) { p.throttle = (fw ? 1 : 0) - (bk ? 1 : 0); if (bk && p.cruise > 0) p.cruise = 0; }
  else p.throttle = p.cruise < 0 ? -1 : p.cruise / 4;
  p.steer = (isDown('t_left') ? 1 : 0) - (isDown('t_right') ? 1 : 0);
  p.compensate = false;
  if (p.gun.auto) p.firing = isDown('t_fire'); else if (isDown('t_fire')) p.shoot();
  p.mgFiring = isDown('t_mg');
  if (pressed('t_sight')) { cam.sniper = !cam.sniper; cam.binoc = false; }
  if (pressed('t_binoc')) { cam.binoc = !cam.binoc; cam.sniper = false; }
  for (let i = 0; i < 3; i++) if (pressed('t_ammo' + (i + 1))) p.selectAmmo(i);
  if (pressed('t_repair')) p.toggleRepair();
  if (pressed('t_ext')) p.extinguish();
  if ((p.spotT = (p.spotT || 0) - dt) < 0) { p.spotT = .5; for (const e of tanks) if (e.team !== 1 && e.alive && p.pos.distanceTo(e.pos) < 650 && los(p, e)) e.spottedUntil = S.now + 4; }
}
function controlPlane(p, dt) {
  if (isDown('a_thr_up')) { p.throttle = Math.min(1, p.throttle + dt * 0.6); if (p.throttle >= 1) wepHold += dt; } else wepHold = 0;
  if (isDown('a_thr_dn')) { p.throttle = Math.max(0, p.throttle - dt * 0.6); p.wep = false; }
  if (wepHold > 0.5) p.wep = true;
  // scroll = manete, 1% por passo (para cima acelera; em 100% liga o WEP)
  if (mouse.wheel < 0) { if (p.throttle >= 1) p.wep = true; p.throttle = Math.min(1, p.throttle - 0.01 * mouse.wheel); }
  if (mouse.wheel > 0) { p.throttle = Math.max(0, p.throttle - 0.01 * mouse.wheel); p.wep = false; }
  if (pressed('a_flaps')) p.cycleFlaps();
  p.airbrake = isDown('a_airbrake');
  const kx = (isDown('a_roll_r') ? 1 : 0) - (isDown('a_roll_l') ? 1 : 0);
  const ky = (isDown('a_yaw_l') ? 1 : 0) - (isDown('a_yaw_r') ? 1 : 0);
  const kp = (isDown('a_pitch_up') ? 1 : 0) - (isDown('a_pitch_dn') ? 1 : 0);
  if (settings.gameplay.flightMode === 'teclado') {
    // controle direto pelas teclas, com rampa suave
    const r = 1 - Math.exp(-dt * 6);
    p.elev += (kp - p.elev) * r; p.ail += (kx - p.ail) * r; p.rud += (ky - p.rud) * r;
  } else {
    p.steerTo(cam.aimDir, dt, { glim: 9, groundAssist: true });
    if (kx) p.ail = kx; if (ky) p.rud = ky; if (kp) p.elev = kp;
  }
  p.firing = isDown('a_guns');
  if (pressed('a_bomb')) p.dropBomb();
  if (pressed('a_rocket')) { p.fireRocket(); p.fireRocket(); }
}
