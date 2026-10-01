import * as THREE from 'three';
import { scene } from '../core/render.js';
import { S } from '../core/state.js';
import { settings, saveSettings, resetSettings, ACTIONS, QUALITY, keyName, clearInput } from '../core/settings.js';
import { $ } from '../core/util.js';
import { H, SPAWN } from '../world/terrain.js';
import { VEHICLES, LINEUP, GUNS, hePen, DEG, G, RHO } from '../data/vehicles.js';
import { buildTank, setArmorView } from '../vehicles/tank.js';
import { buildPlane } from '../vehicles/plane.js';
import { audioInit, audioPause, sndUi, eng } from '../fx/audio.js';
import { cam, resetCam } from '../game/camera.js';
import { input, lockPointer, exitPointer } from '../game/controls.js';
import { startMatch, spawnPlayer, clearWorld } from '../game/match.js';
import { destroyVehicle } from '../combat/ballistics.js';
import { buildPanels, hint } from './hud.js';

const typeLabel = D => (D.type === 'plane' ? 'AVIÃO' : D.type === 'spaa' ? 'AA' : 'TANQUE');
let choice = 'sherman', show = null, armorView = false;
const HANGAR = new THREE.Vector3(0, 0, 334);

// ---------- Hangar ----------
function buildShowcase(key) {
  if (show) scene.remove(show.root);
  const D = VEHICLES[key];
  show = D.type === 'plane' ? buildPlane(D) : buildTank(D);
  const y = H(HANGAR.x, HANGAR.z);
  show.root.position.set(HANGAR.x, y + (D.type === 'plane' ? 2.4 : 0), HANGAR.z);
  if (D.type === 'plane') show.root.rotation.z = 0.12;
  scene.add(show.root);
  if (D.type !== 'plane') setArmorView(show, armorView);
  $('#vArm').disabled = D.type === 'plane';
  $('#legend').hidden = !(armorView && D.type !== 'plane');
  cam.hangar = { pos: new THREE.Vector3(HANGAR.x, y, HANGAR.z), r: D.type === 'plane' ? 17 : 11.5 };
}
function fillSheet(key) {
  const D = VEHICLES[key];
  $('#shNat').textContent = `${D.nation} · ${D.year} · ${typeLabel(D)} · ${D.sp} SP`;
  $('#shName').textContent = D.name;
  let rows;
  if (D.type === 'plane') {
    rows = [['Massa de combate', `${(D.mass / 1000).toFixed(1).replace('.', ',')} t`], ['Carga alar', `${Math.round(D.mass / D.S)} kg/m²`], ['Motor', `${D.hp} hp (${D.wep} hp WEP)`], ['Potência/peso', `${(D.hp / (D.mass / 1000)).toFixed(0)} hp/t`],
      ['Estol (limpo)', `${Math.round(Math.sqrt(2 * D.mass * G / (RHO * D.S * D.clmax)) * 3.6)} km/h`], ['Vel. máx. de mergulho', `${Math.round(D.vne * 3.6)} km/h`],
      ['Armamento', D.guns.map(g => `${g.n}× ${GUNS[g.w].name.split(' ').slice(0, 2).join(' ')}`).join(', ')],
      ['Carga externa', [...D.bombs.map(b => `${b.n}× ${b.name}`), D.rockets ? `${D.rockets.n}× ${D.rockets.name}` : null].filter(Boolean).join(', ')]];
  } else {
    const eff = Math.round(D.armor.front[0] / Math.cos(D.armor.front[1] * DEG));
    rows = [['Glacis', `${D.armor.front[0]} mm a ${D.armor.front[1]}° → ${eff} mm`], ['Lateral / torre', `${D.armor.side[0]} / ${D.armor.tFront[0]} mm`], ['Canhão', D.gun.name],
      [D.gun.auto ? 'Cadência' : 'Recarga', D.gun.auto ? `${D.gun.rpm} disp/min` : `${D.gun.reload.toFixed(1).replace('.', ',')} s`],
      ['Perfuração', D.gun.ammo.map(a => (a.type === 'HE' ? Math.round(hePen(a.tnt)) : a.pen)).join(' / ') + ' mm'], ['Giro da torre', `${D.gun.trav}°/s${D.rpmTraverse ? ' (depende do RPM)' : ''}`],
      ['Massa · motor', `${(D.mass / 1000).toFixed(1).replace('.', ',')} t · ${D.hp} hp`], ['Potência/peso', `${(D.hp / (D.mass / 1000)).toFixed(1).replace('.', ',')} hp/t`], ['Vel. máxima', `${Math.round(D.vmax * 3.6)} km/h`]];
  }
  $('#shStats').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
}
function slotHtml(key, extra) {
  const D = VEHICLES[key];
  return `<span class="ic">${typeLabel(D)}</span><span>${D.short || D.name}<small>${D.nation} · ${D.year}</small></span><span class="cost">${extra ?? D.sp + ' SP'}</span>`;
}
function syncLineup() {
  document.querySelectorAll('#lineup .slot').forEach(s => s.setAttribute('aria-pressed', s.dataset.k === choice));
  fillSheet(choice); buildShowcase(choice);
}
export function initMenus() {
  const box = $('#lineup'); box.innerHTML = '';
  for (const key of LINEUP) {
    const b = document.createElement('button'); b.className = 'slot'; b.innerHTML = slotHtml(key); b.dataset.k = key;
    b.onclick = () => { choice = key; sndUi(); syncLineup(); };
    b.ondblclick = () => { choice = key; begin(); };
    box.appendChild(b);
  }
  syncLineup();
  $('#vExt').onclick = () => { armorView = false; $('#vExt').setAttribute('aria-pressed', true); $('#vArm').setAttribute('aria-pressed', false); buildShowcase(choice); };
  $('#vArm').onclick = () => { armorView = true; $('#vArm').setAttribute('aria-pressed', true); $('#vExt').setAttribute('aria-pressed', false); buildShowcase(choice); };
  $('#startBtn').onclick = begin;
  $('#setBtn').onclick = () => openSettings();
  $('#resumeBtn').onclick = () => setPause(false);
  $('#pSetBtn').onclick = () => openSettings();
  $('#bailBtn').onclick = () => { setPause(false); if (S.player && S.player.alive) destroyVehicle(S.player, null, 'bail'); };
  $('#quitBtn').onclick = () => { setPause(false); exitPointer(); toMenu(); };
  $('#againBtn').onclick = () => toMenu();
  $('#spawnBtn').onclick = onSpawnBtn;
  buildSettings();
}
function begin() {
  audioInit();
  if (show) { scene.remove(show.root); show = null; }
  spawnSel = choice;
  startMatch();
}
export function toMenu() {
  ['#end', '#hud', '#pause', '#spawn'].forEach(s => ($(s).hidden = true)); $('#menu').hidden = false;
  if (eng.tank) eng.tank.g.gain.value = 0; if (eng.air) eng.air.g.gain.value = 0;
  clearWorld(); S.state = 'menu'; S.player = null; syncLineup();
}

// ---------- Spawn ----------
let spawnSel = null;
export function openSpawn(why) {
  S.state = 'spawn'; exitPointer(); clearInput();
  $('#menu').hidden = true; $('#hud').hidden = false;
  $('#spawn').hidden = false; $('#spWhy').textContent = why || '';
  const me = S.me;
  $('#spSP').textContent = `${me.sp} SP`;
  const box = $('#spLineup'); box.innerHTML = '';
  let any = false;
  for (const key of LINEUP) {
    const used = me.used.has(key), D = VEHICLES[key], cost = me.firstSpawn ? 0 : D.sp;
    const can = !used && cost <= me.sp && !(me.firstSpawn && D.type === 'plane');
    const b = document.createElement('button'); b.className = 'slot'; b.dataset.k = key;
    b.innerHTML = slotHtml(key, used ? 'usado' : me.firstSpawn && D.type === 'plane' ? 'após 1º spawn' : `${cost} SP`);
    b.disabled = !can; if (can) any = true;
    b.onclick = () => { spawnSel = key; box.querySelectorAll('.slot').forEach(x => x.setAttribute('aria-pressed', x === b)); };
    box.appendChild(b);
  }
  const pre = [...box.children].find(b => !b.disabled && b.dataset.k === (spawnSel || choice)) || [...box.children].find(b => !b.disabled);
  if (pre) pre.click(); else spawnSel = null;
  $('#spTitle').textContent = any ? 'Escolha o veículo' : 'Sem veículos disponíveis';
  if (!any) $('#spWhy').textContent = 'Você usou o lineup ou não tem SP suficiente. Acompanhe os aliados; Enter reabre esta tela.';
  $('#spawnBtn').textContent = any ? 'Entrar' : 'Assistir';
}
function onSpawnBtn() {
  if (!spawnSel || $('#spawnBtn').textContent === 'Assistir') { $('#spawn').hidden = true; S.state = 'spectate'; hint('Assistindo aliados · Enter abre a tela de spawn quando houver SP'); return; }
  const v = spawnPlayer(spawnSel); if (!v) return;
  $('#spawn').hidden = true; S.state = 'play';
  resetCam(v.type === 'plane' ? Math.PI : SPAWN[1].yaw);
  buildPanels(v);
  const b = settings.binds, k = id => keyName(b[id][0]);
  hint(v.type === 'plane'
    ? `Mouse aponta · ${k('a_thr_up')}/${k('a_thr_dn')} potência · ${k('a_roll_l')}/${k('a_roll_r')} rolagem · ${k('a_guns')} armas · ${k('a_bomb')} bombas · ${k('a_rocket')} foguetes · ${k('a_flaps')} flaps · ${k('freelook')} olhar livre`
    : `${k('t_fwd')}${k('t_left')}${k('t_back')}${k('t_right')} dirigir · ${k('t_fire')} canhão · ${k('t_sight')} mira · ${k('t_zoom')} zoom · ${k('t_mg')} metralhadora · ${k('t_repair')} reparar · ${k('t_cruise_up')}/${k('t_cruise_dn')} cruzeiro`);
  lockPointer();
}
addEventListener('keydown', e => { if (S.state === 'spectate' && e.code === 'Enter') openSpawn(''); });

// ---------- Pausa e fim ----------
export function setPause(p) {
  S.paused = p; $('#pause').hidden = !p; clearInput();
  $('#bailBtn').hidden = !(S.player && S.player.alive);
  audioPause(p);
  if (p) { exitPointer(); $('#resumeBtn').focus(); } else { $('#settings').hidden = true; if (S.state === 'play') lockPointer(); }
}
export function showEnd(win) {
  if (S.state === 'end') return;
  S.state = 'end'; exitPointer();
  ['#spawn', '#pause'].forEach(s => ($(s).hidden = true)); $('#end').hidden = false;
  $('#endTitle').textContent = win ? 'Vitória' : 'Derrota';
  $('#endWhy').textContent = win ? 'Os pontos inimigos acabaram. O setor é nosso.' : 'Nossos pontos acabaram. A linha recuou.';
  const m = Math.floor(S.matchT / 60), s = Math.floor(S.matchT % 60), st = S.stats;
  $('#endStats').innerHTML = `<dt>Terrestres destruídos</dt><dd>${st.kills}</dd><dt>Aeronaves derrubadas</dt><dd>${st.airKills}</dd><dt>Veículos perdidos</dt><dd>${st.deaths}</dd><dt>Disparos de canhão</dt><dd>${st.shots}</dd><dt>Acertos</dt><dd>${st.hits}</dd><dt>Penetrações</dt><dd>${st.pens}</dd><dt>Pontos</dt><dd>${S.me.score}</dd><dt>Duração</dt><dd>${m}:${String(s).padStart(2, '0')}</dd>`;
  $('#againBtn').focus();
}

// ---------- Configurações ----------
let tab = 'controles';
export function openSettings() { $('#settings').hidden = false; renderTab(); }
function buildSettings() {
  $('#setClose').onclick = () => { $('#settings').hidden = true; };
  $('#setReset').onclick = () => {
    const map = { controles: 'binds', mouse: 'mouse', graficos: 'graphics', audio: 'audio', jogabilidade: 'gameplay' };
    resetSettings(map[tab]); renderTab();
  };
  document.querySelectorAll('#setTabs button').forEach(b => (b.onclick = () => { tab = b.dataset.t; renderTab(); }));
}
const range = (id, label, val, min, max, step, fmt) => `<label class="srow"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output class="mono">${fmt(val)}</output></label>`;
const check = (id, label, val, desc) => `<label class="srow chk"><span>${label}${desc ? `<small>${desc}</small>` : ''}</span><input type="checkbox" id="${id}" ${val ? 'checked' : ''}></label>`;
const select = (id, label, val, opts, desc) => `<label class="srow"><span>${label}${desc ? `<small>${desc}</small>` : ''}</span><select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
function renderTab() {
  document.querySelectorAll('#setTabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === tab));
  const body = $('#setBody');
  if (tab === 'controles') {
    let html = '';
    for (const grp of ['Tanque', 'Avião', 'Geral']) {
      html += `<h4>${grp}</h4><div class="binds">`;
      for (const [id, g, label] of ACTIONS) if (g === grp) {
        const b = settings.binds[id];
        html += `<div class="brow"><span>${label}</span><button class="key" data-id="${id}" data-i="0">${keyName(b[0])}</button><button class="key" data-id="${id}" data-i="1">${keyName(b[1])}</button></div>`;
      }
      html += '</div>';
    }
    body.innerHTML = html + '<p class="note">Clique numa tecla e pressione a nova. Esc cancela, Backspace limpa. Tanque e avião podem usar as mesmas teclas.</p>';
    body.querySelectorAll('.key').forEach(btn => (btn.onclick = () => {
      btn.textContent = 'Pressione…'; btn.classList.add('wait');
      input.capture = code => {
        input.capture = null;
        const id = btn.dataset.id, i = +btn.dataset.i, arr = settings.binds[id];
        if (code === 'Escape') { renderTab(); return; }
        if (code === 'Backspace' || code === 'Delete') arr.splice(i, 1);
        else { arr[i] = code; }
        settings.binds[id] = arr.filter(Boolean);
        saveSettings(); renderTab();
      };
    }));
  } else if (tab === 'mouse') {
    const m = settings.mouse, f = v => (+v).toFixed(2);
    body.innerHTML = range('mTank', 'Sensibilidade · tanque (câmera)', m.tank, 0.2, 3, 0.05, f) + range('mSight', 'Sensibilidade · mira do atirador', m.sight, 0.2, 3, 0.05, f)
      + range('mPlane', 'Sensibilidade · avião', m.plane, 0.2, 3, 0.05, f) + check('mInv', 'Inverter eixo vertical', m.invertY);
    bindRange('mTank', v => (m.tank = v)); bindRange('mSight', v => (m.sight = v)); bindRange('mPlane', v => (m.plane = v)); bindCheck('mInv', v => (m.invertY = v));
  } else if (tab === 'graficos') {
    const q = settings.graphics;
    body.innerHTML = select('gQ', 'Qualidade', q.quality, [['baixa', 'Baixa'], ['media', 'Média'], ['alta', 'Alta'], ['ultra', 'Ultra']], 'Resolução interna, sombras, oclusão de ambiente (GTAO), bloom, antisserrilhado e densidade da grama.')
      + `<dl class="tbl qtbl">${Object.entries(QUALITY[q.quality]).map(([k, v]) => `<dt>${{ pr: 'Escala de resolução', shadow: 'Mapa de sombras', cascades: 'Cascatas', ao: 'Oclusão de ambiente', bloom: 'Bloom', aa: 'Antisserrilhado', grass: 'Tufos de grama', far: 'Distância de visão' }[k]}</dt><dd>${v === true ? 'sim' : v === false ? 'não' : v}</dd>`).join('')}</dl>`;
    $('#gQ').onchange = e => { q.quality = e.target.value; saveSettings(); renderTab(); };
  } else if (tab === 'audio') {
    const a = settings.audio, f = v => Math.round(v * 100) + '%';
    body.innerHTML = range('aM', 'Volume geral', a.master, 0, 1, 0.05, f) + range('aS', 'Efeitos', a.sfx, 0, 1, 0.05, f) + range('aE', 'Motores', a.engine, 0, 1, 0.05, f);
    bindRange('aM', v => (a.master = v)); bindRange('aS', v => (a.sfx = v)); bindRange('aE', v => (a.engine = v));
  } else {
    const g = settings.gameplay;
    body.innerHTML = select('pFlight', 'Controle do avião', g.flightMode, [['instrutor', 'Mouse (instrutor, como o WT)'], ['teclado', 'Teclado (controle direto)']], 'Instrutor: o avião segue o mouse. Teclado: setas cabram/picam, A/D rolam, Q/E leme.')
      + check('pAssist', 'Marcador de queda da granada', g.tankAssist, 'Mostra onde a granada vai cair (modo arcade).')
      + check('pLead', 'Indicador de avanço para aviões', g.leadMarker, 'Mostra onde mirar para acertar aviões em movimento.')
      + check('pHit', 'Câmera de impacto (raio-X)', g.hitcam) + check('pSmooth', 'Câmera suavizada', g.camSmooth);
    $('#pFlight').onchange = e => { g.flightMode = e.target.value; saveSettings(); };
    bindCheck('pAssist', v => (g.tankAssist = v)); bindCheck('pLead', v => (g.leadMarker = v)); bindCheck('pHit', v => (g.hitcam = v)); bindCheck('pSmooth', v => (g.camSmooth = v));
  }
}
function bindRange(id, set) { const el = $('#' + id), out = el.nextElementSibling; el.oninput = () => { set(+el.value); out.textContent = out.textContent.includes('%') ? Math.round(el.value * 100) + '%' : (+el.value).toFixed(2); saveSettings(); }; }
function bindCheck(id, set) { $('#' + id).onchange = e => { set(e.target.checked); saveSettings(); }; }
