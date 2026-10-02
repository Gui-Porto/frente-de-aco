// Configurações persistentes e mapeamento de controles (padrões no estilo War Thunder).
const KEY = 'fda.settings.v1';

export const ACTIONS = [
  // [id, grupo, rótulo, padrões]
  ['t_fwd', 'Tanque', 'Acelerar', ['KeyW', 'ArrowUp']],
  ['t_back', 'Tanque', 'Ré', ['KeyS', 'ArrowDown']],
  ['t_left', 'Tanque', 'Virar à esquerda', ['KeyA', 'ArrowLeft']],
  ['t_right', 'Tanque', 'Virar à direita', ['KeyD', 'ArrowRight']],
  ['t_fire', 'Tanque', 'Disparar canhão', ['Mouse0']],
  ['t_mg', 'Tanque', 'Metralhadora coaxial', ['Space']],
  ['t_sight', 'Tanque', 'Mira do atirador (alternar)', ['ShiftLeft']],
  ['t_zoom', 'Tanque', 'Zoom (segurar)', ['Mouse2']],
  ['t_ammo1', 'Tanque', 'Munição 1', ['Digit1']],
  ['t_ammo2', 'Tanque', 'Munição 2', ['Digit2']],
  ['t_ammo3', 'Tanque', 'Munição 3', ['Digit3']],
  ['t_repair', 'Tanque', 'Reparar / extinguir', ['KeyF']],
  ['t_ext', 'Tanque', 'Extintor de incêndio', ['Digit6']],
  ['t_cruise_up', 'Tanque', 'Controle de cruzeiro +', ['KeyE']],
  ['t_cruise_dn', 'Tanque', 'Controle de cruzeiro −', ['KeyQ']],
  ['t_binoc', 'Tanque', 'Binóculo (alternar)', ['KeyB']],
  ['a_thr_up', 'Avião', 'Aumentar potência', ['ShiftLeft']],
  ['a_thr_dn', 'Avião', 'Reduzir potência', ['ControlLeft']],
  ['a_roll_l', 'Avião', 'Rolar à esquerda', ['KeyA']],
  ['a_roll_r', 'Avião', 'Rolar à direita', ['KeyD']],
  ['a_yaw_l', 'Avião', 'Leme à esquerda', ['KeyQ']],
  ['a_yaw_r', 'Avião', 'Leme à direita', ['KeyE']],
  ['a_pitch_up', 'Avião', 'Cabrar (subir o nariz)', ['KeyS', 'ArrowDown']],
  ['a_pitch_dn', 'Avião', 'Picar (baixar o nariz)', ['KeyW', 'ArrowUp']],
  ['a_guns', 'Avião', 'Disparar armas', ['Mouse0']],
  ['a_bomb', 'Avião', 'Lançar bombas', ['Space']],
  ['a_rocket', 'Avião', 'Disparar foguetes', ['KeyR']],
  ['a_flaps', 'Avião', 'Flaps (alternar)', ['KeyF']],
  ['a_airbrake', 'Avião', 'Freio aerodinâmico', ['KeyH']],
  ['a_zoom', 'Avião', 'Zoom / câmera de mira (segurar)', ['Mouse2']],
  // mesmos comandos nas batalhas terrestres e na Batalha Aérea (padrão do War Thunder com mouse aim)
  ['a_missile', 'Avião', 'Disparar míssil ar-ar', ['Space']],
  ['a_cm', 'Avião', 'Contramedidas (flares + chaff)', ['KeyX']],
  ['a_wsel', 'Avião', 'Selecionar míssil', ['KeyZ']],
  ['a_rmode', 'Avião', 'Radar: trocar modo', ['KeyN']],
  ['a_rlock', 'Avião', 'Radar: travar / soltar alvo', ['CapsLock']],
  ['a_gear', 'Avião', 'Trem de pouso', ['KeyG']],
  ['a_ext', 'Avião', 'Extintor de incêndio', ['KeyK']],
  ['a_cam', 'Avião', 'Trocar câmera (cockpit / externa)', ['KeyV']],
  ['a_target', 'Avião', 'Marcar alvo na mira', ['Mouse1', 'KeyT']],
  ['freelook', 'Geral', 'Olhar livre (segurar)', ['KeyC']],
  ['score', 'Geral', 'Placar (segurar)', ['Tab']],
  ['map', 'Geral', 'Mapa ampliado (segurar)', ['KeyM']],
  ['menu', 'Geral', 'Menu / pausa', ['Escape']],
];

export const QUALITY = {
  baixa: { pr: 0.85, shadow: 1024, cascades: 2, ao: false, bloom: false, aa: 'fxaa', grass: 0, far: 0.6 },
  media: { pr: 1.0, shadow: 2048, cascades: 3, ao: false, bloom: false, aa: 'smaa', grass: 6000, far: 0.8 },
  alta: { pr: 1.25, shadow: 2048, cascades: 3, ao: true, bloom: false, aa: 'smaa', grass: 14000, far: 1.0 },
  ultra: { pr: 1.5, shadow: 4096, cascades: 4, ao: true, bloom: false, aa: 'smaa', grass: 24000, far: 1.0 },
};

export function defaults() {
  const binds = {};
  for (const [id, , , d] of ACTIONS) binds[id] = [...d];
  return {
    binds,
    mouse: { tank: 1.0, sight: 1.0, plane: 1.0, invertY: false },
    graphics: { quality: 'alta' },
    audio: { master: 0.8, sfx: 1.0, engine: 0.8 },
    bindsV: 3,
    gameplay: { tankAssist: true, leadMarker: true, flightMode: 'instrutor', camSmooth: true, hitcam: true },
  };
}
function merge(base, o) {
  for (const k in o) {
    if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && base[k]) merge(base[k], o[k]);
    else if (k in base) base[k] = o[k];
  }
  return base;
}
export const settings = defaults();
let saved = null;
try { const s = localStorage.getItem(KEY); if (s) merge(settings, saved = JSON.parse(s)); } catch (e) { /* sem armazenamento: usa padrões */ }
// configurações salvas antes do atalho de teclado: míssil só no botão do meio (touchpad não tem)
if (settings.binds.a_missile.join() === 'Mouse1') settings.binds.a_missile.push('Space');
// esquema de voo v2 (Shift/Ctrl potência, W/S manche, A/D rolagem, Q/E leme, C olhar livre):
// aplicado uma vez também sobre configurações salvas no esquema antigo (W/S era potência)
if (saved && saved.binds && (saved.bindsV || 1) < 2) {
  const d = defaults().binds;
  for (const id of ['a_thr_up', 'a_thr_dn', 'a_pitch_up', 'a_pitch_dn', 'a_roll_l', 'a_roll_r', 'a_yaw_l', 'a_yaw_r', 'freelook']) settings.binds[id] = [...d[id]];
  settings.bindsV = 2;
}
// v3 (padrão WT): Caps trava o alvo no radar, botão do meio (scroll) marca o alvo; míssil fica no Espaço
if (saved && saved.binds && (saved.bindsV || 1) < 3) {
  const d = defaults().binds;
  for (const id of ['a_rlock', 'a_target', 'a_missile']) settings.binds[id] = [...d[id]];
  settings.bindsV = 3;
}
const listeners = [];
export function onSettings(fn) { listeners.push(fn); }
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignorado */ }
  listeners.forEach(f => f(settings));
}
export function resetSettings(group) {
  const d = defaults();
  if (group) settings[group] = d[group]; else Object.assign(settings, d);
  saveSettings();
}

// ---------- Estado de entrada ----------
const down = new Set();
const pressedQ = new Set();
export const mouse = { dx: 0, dy: 0, wheel: 0 };
export function codeDown(c) { down.add(c); pressedQ.add(c); }
export function codeUp(c) { down.delete(c); }
export function clearInput() { down.clear(); pressedQ.clear(); }
export const isDown = a => settings.binds[a].some(c => down.has(c));
export const pressed = a => settings.binds[a].some(c => pressedQ.has(c));
export function endFrame() { pressedQ.clear(); mouse.dx = mouse.dy = mouse.wheel = 0; }
export function actionFor(code, prefix) {
  return ACTIONS.filter(([id]) => (!prefix || id.startsWith(prefix) || !id.includes('_')) && settings.binds[id].includes(code)).map(a => a[0]);
}
export function keyName(c) {
  if (!c) return '—';
  const map = { Mouse0: 'Botão esq.', Mouse1: 'Botão do meio', Mouse2: 'Botão dir.', Space: 'Espaço', ShiftLeft: 'Shift esq.', ShiftRight: 'Shift dir.', ControlLeft: 'Ctrl esq.', ControlRight: 'Ctrl dir.', AltLeft: 'Alt esq.', Escape: 'Esc', Tab: 'Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Backspace: 'Backspace' };
  if (map[c]) return map[c];
  if (c.startsWith('Key')) return c.slice(3);
  if (c.startsWith('Digit')) return c.slice(5);
  if (c.startsWith('Numpad')) return 'Num ' + c.slice(6);
  return c;
}
