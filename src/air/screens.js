import { renderer, scene, camera } from '../core/render.js';
import { S } from '../core/state.js';
import { settings, keyName, clearInput } from '../core/settings.js';
import { $, clamp } from '../core/util.js';
import { PLANES } from '../data/vehicles.js';
import { audioInit, sndUi } from '../fx/audio.js';
import { lockPointer, exitPointer } from '../game/controls.js';
import { AIR, AIR_ROSTER, NATION_TAG, armament, burstMass } from './aircraft.js';
import { MODES } from './missions.js';
import { DIFF } from './ai.js';
import { TIMES, WEATHER, resetEnv } from './environment.js';
import { B, career, levelOf } from './battle.js';
import { openHangar, closeHangar, showcase, setView, hangarPointer } from './hangar.js';
import { showAirHud } from './hud.js';
import { airAudioOff } from './sound.js';
import { Missile } from './missiles.js';
import { V3 } from '../core/util.js';
// =====================================================================
// Telas: hangar/seleção → ordem de missão → carregamento → batalha →
// debriefing → hangar. Uma área (#air) com quatro painéis.
// =====================================================================
const CFG = 'fda.air.cfg';
const cfg = Object.assign({ plane: 'spit9', mode: 'duelo', enemies: 3, allies: 2, diff: 'normal', weather: 'limpo', time: 'tarde', map: 'normandia' }, (() => { try { return JSON.parse(localStorage.getItem(CFG) || '{}'); } catch (e) { return {}; } })());
if (!AIR[cfg.plane] || AIR[cfg.plane].hidden) cfg.plane = 'spit9';
const save = () => { try { localStorage.setItem(CFG, JSON.stringify(cfg)); } catch (e) { /* ignorado */ } };
const RATE = { velocidade: 'Velocidade', subida: 'Subida', manobra: 'Manobra', resistencia: 'Resistência', fogo: 'Poder de fogo' };
const nf = n => n.toLocaleString('pt-BR');
const panels = ['#airSel', '#airCfg', '#airLoad', '#airRes'];
function only(id) { $('#air').hidden = false; for (const p of panels) $(p).hidden = p !== id; }

// ---------- hangar e seleção ----------
export function openAirHangar() {
  audioInit();
  S.state = 'airmenu'; S.mode = 'ground';
  $('#menu').hidden = true; $('#hud').hidden = true; showAirHud(false);
  only('#airSel'); openHangar(cfg.plane); fillList(); fillPlate(cfg.plane); fillCareer();
}
function fillCareer() {
  const c = career(), lv = levelOf(c.xp), a = 150 * (lv - 1) ** 2, b = 150 * lv ** 2;
  $('#airPilot').innerHTML = `<span>Piloto · nível <b>${lv}</b></span><i><em style="width:${clamp((c.xp - a) / (b - a), 0, 1) * 100}%"></em></i><small>${c.battles} missões · ${c.wins} vitórias · ${c.kills} abates</small>`;
}
function fillList() {
  const box = $('#airList'); box.innerHTML = '';
  for (const k of AIR_ROSTER) {
    const D = PLANES[k], A = AIR[k], b = document.createElement('button');
    b.className = 'acard'; b.dataset.k = k; b.setAttribute('aria-pressed', k === cfg.plane);
    b.innerHTML = `<span class="tag">${NATION_TAG[D.nation] || D.nation}</span><span class="nm">${D.short}</span><span class="rl">${A.role} · ${D.year}</span>`
      + `<span class="mini">${['velocidade', 'manobra', 'fogo'].map(r => `<i title="${RATE[r]}"><em style="width:${A.rate[r] * 10}%"></em></i>`).join('')}</span>`;
    b.onclick = () => { cfg.plane = k; save(); sndUi(); box.querySelectorAll('.acard').forEach(x => x.setAttribute('aria-pressed', x === b)); showcase(k); fillPlate(k); };
    b.ondblclick = () => openConfig();
    box.appendChild(b);
  }
}
function fillPlate(k) {
  const D = PLANES[k], A = AIR[k];
  $('#apMaker').textContent = `${A.maker} · ${D.nation} · ${D.year}`;
  $('#apName').textContent = D.name;
  $('#apRole').textContent = A.role + (A.era === 'jato' ? ' · era do jato' : ' · motor a pistão');
  $('#apRates').innerHTML = Object.entries(RATE).map(([r, l]) => `<div class="rate"><span>${l}</span><i><em style="width:${A.rate[r] * 10}%"></em></i><b>${A.rate[r]}</b></div>`).join('');
  const rows = [['Velocidade máxima', `${nf(A.vmax)} km/h`], ['Cruzeiro', `${nf(A.cruise)} km/h`], ['Teto', `${nf(A.ceiling)} m`], ['Razão de subida', `${A.climb} m/s`],
    ['Peso de combate', `${(D.mass / 1000).toFixed(2).replace('.', ',')} t`], ['Carga alar', `${Math.round(D.mass / D.S)} kg/m²`], ['Motor', A.engine],
    ['Limite estrutural', `${D.glim} G`], ['Peso de fogo', `${burstMass(k).toFixed(1).replace('.', ',')} kg/s`]];
  $('#apSpecs').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  $('#apArms').innerHTML = armament(k).map(w => w.missile ? `<li><b>${w.n}×</b> ${w.name}<small>guiado IR · ${nf(w.range)} m · aspecto traseiro</small></li>` : `<li><b>${w.n}×</b> ${w.name}<small>${nf(w.ammo)} tiros por arma · ${nf(w.rpm)} disp/min</small></li>`).join('');
  $('#apStrong').innerHTML = A.strong.map(s => `<li>${s}</li>`).join('');
  $('#apWeak').innerHTML = A.weak.map(s => `<li>${s}</li>`).join('');
}

// ---------- ordem de missão ----------
function seg(id, label, opts, val, disabled) {
  return `<div class="orow${disabled ? ' off' : ''}"><span class="ol">${label}</span><div class="segs" data-id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(val)}" ${disabled ? 'disabled' : ''}>${l}</button>`).join('')}</div></div>`;
}
function openConfig() {
  sndUi(); only('#airCfg'); renderCfg();
}
function renderCfg() {
  const M = MODES[cfg.mode], n = a => Array.from({ length: a[1] - a[0] + 1 }, (_, i) => [a[0] + i, String(a[0] + i)]);
  $('#cfgBody').innerHTML =
    seg('mode', 'Missão', Object.entries(MODES).map(([k, m]) => [k, m.label]), cfg.mode)
    + `<p class="odesc"><b>${M.tag}</b> ${M.desc}</p>`
    + seg('map', 'Teatro', [['normandia', 'Normandia · setor de Caen']], cfg.map)
    + seg('enemies', cfg.mode === 'intercepta' ? 'Escolta inimiga' : 'Caças inimigos', n([1, 8]), cfg.enemies)
    + seg('allies', 'Alas', n([0, 6]), M.allies ? cfg.allies : 0, !M.allies)
    + seg('diff', 'Dificuldade', Object.entries(DIFF).map(([k, d]) => [k, d.label]), cfg.diff)
    + seg('weather', 'Clima', Object.entries(WEATHER).map(([k, w]) => [k, w.label]), cfg.weather)
    + seg('time', 'Horário', Object.entries(TIMES).map(([k, t]) => [k, t.label]), cfg.time);
  $('#cfgBody').querySelectorAll('.segs button').forEach(b => (b.onclick = () => {
    const id = b.parentElement.dataset.id, v = b.dataset.v; cfg[id] = isNaN(+v) ? v : +v; save(); sndUi(); renderCfg();
  }));
  const D = PLANES[cfg.plane], era = AIR[cfg.plane].era;
  $('#cfgSum').innerHTML = `<dt>Aeronave</dt><dd>${D.short}</dd><dt>Adversários</dt><dd>${era === 'jato' ? 'jatos (MiG-15 / F-86)' : 'caças a pistão'}</dd><dt>Esquadrilha</dt><dd>${M.allies ? `você + ${cfg.allies}` : 'só você'}</dd><dt>Dificuldade</dt><dd>${DIFF[cfg.diff].label}</dd><dt>Condições</dt><dd>${WEATHER[cfg.weather].label} · ${TIMES[cfg.time].label}</dd>`;
}

// ---------- carregamento ----------
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
async function takeoff() {
  only('#airLoad'); sndUi();
  const steps = $('#loadSteps'), bar = $('#loadBar');
  const step = async (t, f) => { steps.insertAdjacentHTML('beforeend', `<li>${t}</li>`); bar.style.width = f * 100 + '%'; await frame(); await frame(); };
  $('#loadTitle').textContent = MODES[cfg.mode].label; $('#loadDesc').textContent = MODES[cfg.mode].desc; steps.innerHTML = '';
  await step('Briefing da esquadrilha', 0.15);
  closeHangar();
  await step(`Meteorologia · ${WEATHER[cfg.weather].label.toLowerCase()}, ${TIMES[cfg.time].label.toLowerCase()}`, 0.35);
  B.start(Object.assign({}, cfg));
  await step('Aeronaves na posição de decolagem', 0.6);
  // compila os programas de tudo que pode surgir na partida (aviões, míssil, nuvens, chuva)
  const dummy = new Missile(B.player, null, { d: 0.12, len: 2.8 }, B.player.pos, new V3()); dummy.dead = true;
  try { renderer.compile(scene, camera); } catch (e) { /* opcional */ }
  scene.remove(dummy.mesh);
  await step('Armamento verificado', 0.85);
  await new Promise(r => setTimeout(r, 350));
  await step('Contato!', 1);
  $('#air').hidden = true; $('#hud').hidden = false; showAirHud(true); clearInput();
  const k = id => keyName(settings.binds[id][0]);
  toast(`Mouse aponta · ${k('a_thr_up')}/${k('a_thr_dn')} potência · ${k('a_roll_l')}/${k('a_roll_r')} rolagem · ${k('a_guns')} atira · ${k('a_missile')} míssil · ${k('a_cm')} contramedidas · ${k('a_target')} alvo · ${k('a_cam')} câmera · clique para capturar o mouse`, 9000);
  lockPointer();
}

// ---------- debriefing ----------
export function showResult(b) {
  if (S.mode !== 'air') return;
  exitPointer(); showAirHud(false); airAudioOff();
  only('#airRes');
  const r = b.result, st = b.stats, m = Math.floor(st.time / 60), s = Math.floor(st.time % 60);
  $('#resTitle').textContent = r.win ? 'Missão cumprida' : 'Missão fracassada';
  $('#resTitle').className = r.win ? 'win' : 'lose';
  $('#resWhy').textContent = r.why;
  const acc = st.shots ? Math.round(100 * st.hits / st.shots) : 0;
  const cells = [['Abates', st.kills], ['Assistências', st.assists], ['Dano causado', Math.round(st.dmgDealt)], ['Dano recebido', Math.round(st.dmgTaken)],
    ['Precisão', `${acc}%`], ['Munição usada', nf(st.ammoUsed)], ['Mísseis', st.missiles], ['Tempo de voo', `${m}:${String(s).padStart(2, '0')}`]];
  $('#resGrid').innerHTML = cells.map(([a, v], i) => `<div style="--i:${i}"><small>${a}</small><b>${v}</b></div>`).join('');
  const c = st.career, lv = st.level, a = 150 * (lv - 1) ** 2, bb = 150 * lv ** 2;
  $('#resScore').innerHTML = `<span>Pontuação <b>${nf(st.score)}</b></span><span>XP <b>+${nf(st.xp)}</b></span><span>Nível <b>${lv}</b>${st.levelUp ? ' <em>promovido</em>' : ''}</span><i><em style="width:${clamp((c.xp - a) / (bb - a), 0, 1) * 100}%"></em></i>`;
  $('#resBack').focus();
}
export function exitToHangar() {
  B.stop(); resetEnv(); airAudioOff(); exitPointer(); showAirHud(false);
  S.paused = false; $('#pause').hidden = true; $('#hud').hidden = true;
  openAirHangar();
}
function toMain() {
  closeHangar(); $('#air').hidden = true; S.state = 'menu'; S.mode = 'ground';
  $('#menu').hidden = false;
  import('../ui/menus.js').then(m => m.toMenu());
}
let toastT;
export function toast(t, ms = 3500) { const el = $('#airToast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms); }

export function initAir() {
  $('#airBtn').onclick = openAirHangar;
  $('#airBack').onclick = toMain;
  $('#airGo').onclick = openConfig;
  $('#cfgBack').onclick = () => { sndUi(); only('#airSel'); };
  $('#cfgGo').onclick = takeoff;
  $('#resBack').onclick = exitToHangar;
  $('#resAgain').onclick = () => { B.stop(); resetEnv(); openHangarSilently(); takeoff(); };
  document.querySelectorAll('#airViews button').forEach(b => (b.onclick = () => { setView(b.dataset.v); document.querySelectorAll('#airViews button').forEach(x => x.setAttribute('aria-pressed', x === b)); }));
  const gl = renderer.domElement;
  gl.addEventListener('pointerdown', e => { if (S.state === 'airmenu') hangarPointer('down', e); });
  addEventListener('pointerup', e => hangarPointer('up', e));
  addEventListener('pointermove', e => { if (S.state === 'airmenu') hangarPointer('move', e); });
  gl.addEventListener('wheel', e => { if (S.state === 'airmenu') hangarPointer('wheel', e); }, { passive: true });
  addEventListener('keydown', e => { if (S.state === 'airmenu' && e.code === 'Escape' && $('#airCfg').hidden === false) only('#airSel'); });
}
function openHangarSilently() { S.state = 'airmenu'; openHangar(cfg.plane); }
