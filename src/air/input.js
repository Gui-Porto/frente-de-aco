import { isDown, pressed, settings } from '../core/settings.js';
// =====================================================================
// InputSystem + AircraftController da Batalha Aérea.
// Teclado, mouse e gamepad viram um COMANDO normalizado; o comando é que
// pilota o avião. Num multiplayer futuro, é este objeto que viaja pela rede.
// Usa as mesmas ações do grupo "Avião" das configurações (padrão WT).
// =====================================================================
export const cmd = {
  pitch: 0, roll: 0, yaw: 0, thr: 0,      // -1..1 (eixos; 0 = instrutor decide)
  fire: false, missile: false, aim: false, // gatilhos
  cm: false, ext: false, cam: false, target: false, gear: false, flaps: false, brake: false, wsel: false, rmode: false, rlock: false, rnext: false,
  lookX: 0, lookY: 0,                     // olhar/mira pelo direcional analógico (rad/s)
  pad: false,
};
const DZ = 0.15, dz = v => (Math.abs(v) < DZ ? 0 : (v - Math.sign(v) * DZ) / (1 - DZ));

export function readInput() {
  const k = (a, b) => (isDown(a) ? 1 : 0) - (isDown(b) ? 1 : 0);
  cmd.pitch = k('a_pitch_up', 'a_pitch_dn'); cmd.roll = k('a_roll_r', 'a_roll_l'); cmd.yaw = k('a_yaw_l', 'a_yaw_r');
  cmd.thr = k('a_thr_up', 'a_thr_dn');
  cmd.fire = isDown('a_guns'); cmd.missile = pressed('a_missile'); cmd.aim = isDown('a_zoom');
  cmd.cm = pressed('a_cm'); cmd.ext = pressed('a_ext');
  cmd.cam = pressed('a_cam'); cmd.target = pressed('a_target');
  cmd.gear = pressed('a_gear'); cmd.flaps = pressed('a_flaps'); cmd.brake = pressed('a_airbrake');
  cmd.wsel = pressed('a_wsel'); cmd.rmode = pressed('a_rmode'); cmd.rlock = pressed('a_rlock'); cmd.rnext = pressed('a_rnext');
  cmd.lookX = cmd.lookY = 0; cmd.pad = false;
  // Gamepad padrão (Xbox/PS): esquerdo = rolagem/arfagem direta, direito = mira, gatilhos = potência
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g && g.connected && g.mapping === 'standard') : null;
  if (gp) {
    const ax = i => dz(gp.axes[i] || 0), bt = i => !!(gp.buttons[i] && gp.buttons[i].pressed), an = i => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const roll = ax(0), pitch = -ax(1), lx = ax(2), ly = ax(3);
    if (roll || pitch) { cmd.roll = cmd.roll || roll; cmd.pitch = cmd.pitch || pitch; cmd.pad = true; }
    cmd.lookX = -lx * 2.2; cmd.lookY = -ly * 1.6;
    const t = an(7) - an(6); if (Math.abs(t) > 0.05) cmd.thr = t;
    const e = [3, 2, 4, 1].map(i => padEdge(gp, i));
    cmd.fire = cmd.fire || bt(0) || bt(5);
    if (e[0]) cmd.cam = true; if (e[1]) cmd.target = true; if (e[2]) cmd.missile = true; if (e[3]) cmd.cm = true;
    cmd.yaw = cmd.yaw || (bt(14) ? 1 : 0) - (bt(15) ? 1 : 0);
  }
  return cmd;
}
const prev = [];
function padEdge(gp, i) { const now = !!(gp.buttons[i] && gp.buttons[i].pressed), was = prev[i]; prev[i] = now; return now && !was; }

// Aplica o comando ao avião. aimDir = direção do círculo do mouse (instrutor).
const THR_RATE = 4;
export function pilot(p, c, aimDir, dt) {
  // a MANETE responde na hora (0→100% em 0,25 s; toque curto = ajuste fino); continuar segurando em 100%
  // liga o WEP/pós-combustão na hora, e reduzir desliga na hora. O atraso da rotação é do motor (EngineSet).
  if (c.thr > 0) { const was = p.throttle; p.throttle = Math.min(1, p.throttle + dt * THR_RATE * c.thr); if (was >= 1 && p.canBoost) p.wep = true; }
  if (c.thr < 0) { p.throttle = Math.max(0, p.throttle + dt * THR_RATE * c.thr); p.wep = false; }
  if (c.flaps) p.cycleFlaps();
  if (c.gear) p.toggleGear();
  if (c.brake) p.airbrake = !p.airbrake; // H liga/desliga (freio aerodinâmico no ar, freio das rodas no chão)
  // Tecla de manche no modo mouse = controle direto naquele instante (como no WT): antes só o profundor
  // era trocado e o instrutor seguia rolando o avião atrás do círculo do mouse parado → avião "bambo".
  // A câmera continua livre no mouse; ao soltar, o instrutor volta a levar o nariz para o círculo.
  if (settings.gameplay.flightMode === 'teclado' || c.pad || manualAxes(c)) {
    // controle direto, com rampa suave nas superfícies
    const r = 1 - Math.exp(-dt * 6);
    p.elev += (c.pitch - p.elev) * r; p.ail += (c.roll - p.ail) * r; p.rud += (c.yaw - p.rud) * r;
  } else {
    // instrutor: nariz (linha das armas) no círculo do mouse, resposta mais viva que a da IA.
    // lead 0,1 s: com o integral e a inclinação de curva da mira, 0,3 deixava o nariz ~3° À FRENTE do círculo em curva
    p.steerTo(aimDir, dt, { glim: Math.min(p.def.glim - 1.5, 10), groundAssist: !p.gearCmd, nose: true, // pouso é do piloto: o círculo leva o nariz também com trem baixado
      gain: 1.3, lead: 0.1 });
  }
}
export const manualAxes = c => !!(c.pitch || c.roll || c.yaw);
