import * as THREE from 'three';
import { camera } from '../core/render.js';
import { S, tanks, planes, TICKETS } from '../core/state.js';
import { settings } from '../core/settings.js';
import { V3, $, clamp } from '../core/util.js';
import { POINTS } from '../world/terrain.js';
import { VEHICLES, ballistic, hePen } from '../data/vehicles.js';
import { segmentHit, raycast, evalArmor } from '../combat/ballistics.js';
import { drawXray } from './xray.js';
import { drawMini } from './minimap.js';
import { cam } from '../game/camera.js';

// ---------- Utilidades de mensagem ----------
export function shakeCam(s) { S.shake = Math.max(S.shake, s); }
export function shakeAt(pos, s, r) { const d = camera.position.distanceTo(pos); if (d < r) shakeCam(s * (1 - d / r)); }
export function makeLabel(v) {
  const el = document.createElement('div'); el.className = 'lbl ' + (v.team === 1 ? 'a' : 'e');
  const D = v.def, nm = D.short || D.name;
  el.textContent = v.isPlayer ? '' : (v.team === 1 && v.who ? `${v.who.name} · ${nm}` : nm);
  $('#labels').appendChild(el); return el;
}
const hitEl = $('#hitmsg'), dmgEl = $('#dmgmsg'); let hitTO, dmgTO, vignTO, hmTO;
export function report(target, word, detail, color) {
  hitEl.querySelector('b').textContent = word; hitEl.querySelector('b').style.color = `var(--${color})`;
  hitEl.querySelector('span').textContent = (target.def.short || target.def.name) + ' · ' + detail;
  hitEl.style.opacity = 1; clearTimeout(hitTO); hitTO = setTimeout(() => (hitEl.style.opacity = 0), 2800);
}
export function showDmg(text, mild) { dmgEl.textContent = text; dmgEl.style.color = mild ? 'var(--khaki)' : 'var(--enemy)'; dmgEl.style.opacity = 1; clearTimeout(dmgTO); dmgTO = setTimeout(() => (dmgEl.style.opacity = 0), 2800); }
export function flashVign() { $('#vign').style.opacity = 1; clearTimeout(vignTO); vignTO = setTimeout(() => ($('#vign').style.opacity = 0), 350); }
export function hitMarker() { const h = $('#hitx'); h.style.opacity = 1; clearTimeout(hmTO); hmTO = setTimeout(() => (h.style.opacity = 0), 160); }
export function hint(t) { const h = $('#hint'); h.textContent = t; h.style.opacity = 1; clearTimeout(h._t); h._t = setTimeout(() => (h.style.opacity = 0), 14000); }

export function addFeed(k, v, cause) {
  if (S.state === 'menu') return;
  const d = document.createElement('div');
  const nm = t => `<span class="${t.team === 1 ? 'a' : 'e'}">${t.isPlayer ? 'Você' : (t.who ? t.who.name : '')} (${t.def.short || t.def.name})</span>`;
  const verb = { ammo: ' detonou ', crew: ' abateu ', fire: ' incendiou ', pilot: ' matou o piloto de ', wing: ' arrancou a asa de ', tail: ' destruiu a cauda de ', structure: ' derrubou ', crash: ' derrubou ' }[cause] || ' destruiu ';
  const self = { oob: ' abandonou a área de combate', flip: ' capotou', crash: ' caiu', overg: ' quebrou a asa por excesso de G', vne: ' excedeu a velocidade máxima', fire: ' queimou', bail: ' abandonou o veículo' }[cause] || ' foi destruído';
  d.innerHTML = k ? `${nm(k)}${verb}${nm(v)}` : `${nm(v)}${self}`;
  $('#feed').prepend(d); setTimeout(() => d.remove(), 8000);
  while ($('#feed').children.length > 6) $('#feed').lastChild.remove();
}

// ---------- Painel de estado do veículo (silhueta vista de cima) ----------
const sc = $('#status'), sx = sc.getContext('2d'), SX = sx;
const C = { ok: '#c9c4ab', warn: '#efa53c', bad: '#e65a42', dead: '#5a1f18', dim: 'rgba(201,196,171,.35)', line: 'rgba(221,214,183,.55)', crew: '#93cf6c' };
const modCol = m => (m.broken ? C.bad : C.ok);
function drawTankStatus(t) {
  const W = sc.width, Hh = sc.height, D = t.def;
  sx.clearRect(0, 0, W, Hh);
  const s = Math.min((Hh - 24) / D.L, (W - 60) / D.W) * 0.95, ox = W / 2, oy = Hh / 2 + 4;
  const P = (x, z) => [ox - x * s, oy - z * s]; // frente para cima, +x (esquerda do tanque) à esquerda
  sx.lineWidth = 1.5;
  // lagartas
  for (const side of [1, -1]) {
    const [x0, y0] = P(side * D.W / 2, D.L * 0.48);
    sx.fillStyle = t.mods.tracks.broken ? C.bad : 'rgba(201,196,171,.25)';
    sx.fillRect(Math.min(x0, x0 + side * D.trackW * s), y0, D.trackW * s, D.L * 0.96 * s);
  }
  // casco
  const [hx, hy] = P(D.W / 2 - D.trackW, D.L / 2);
  sx.strokeStyle = C.line; sx.strokeRect(hx, hy, (D.W - 2 * D.trackW) * s, D.L * s);
  // módulos
  const box = (x, z, w, l, col) => { const [a, b] = P(x + w / 2, z + l / 2); sx.fillStyle = col; sx.fillRect(a, b, w * s, l * s); };
  box(0, -D.L * .33, D.W * .42, D.L * .2, modCol(t.mods.engine));
  box(0, D.transFront ? D.L * .43 : -D.L * .46, D.W * .38, D.L * .07, modCol(t.mods.transmission));
  const af = t.ammoFrac();
  for (const side of [1, -1]) box(side * (D.W - 2 * D.trackW) * .36, -D.L * .02, .45, .7, `rgba(239,165,60,${0.25 + af * 0.6})`);
  // torre e canhão (giram com a torre)
  if (t.turretOn) {
    const T = D.turret, [tx, ty] = P(0, T.z);
    sx.save(); sx.translate(tx, ty); sx.rotate(-t.turretYaw);
    sx.strokeStyle = t.mods.drive.broken ? C.bad : C.line; sx.lineWidth = 2;
    sx.beginPath(); sx.ellipse(0, 0, T.w / 2 * s, T.l / 2 * s, 0, 0, 7); sx.stroke();
    sx.strokeStyle = t.mods.breech.broken ? C.bad : C.ok; sx.lineWidth = 3;
    sx.beginPath(); sx.moveTo(0, -T.l * .3 * s); sx.lineTo(0, -(T.l / 2 + D.gun.len) * s * 0.7); sx.stroke();
    sx.restore();
  }
  // tripulação
  for (const c of t.components()) {
    if (c.kind !== 'crew') continue;
    const [x, y] = P(c.p[0], c.p[2]), rep = Object.values(t.replace).some(r => r.spare === c.ref);
    sx.fillStyle = !c.ref.alive ? C.dead : rep ? C.warn : C.crew;
    sx.beginPath(); sx.arc(x, y, 5, 0, 7); sx.fill();
    if (!c.ref.alive) { sx.strokeStyle = C.bad; sx.lineWidth = 2; sx.beginPath(); sx.moveTo(x - 4, y - 4); sx.lineTo(x + 4, y + 4); sx.moveTo(x + 4, y - 4); sx.lineTo(x - 4, y + 4); sx.stroke(); }
  }
  if (t.fire > 0) { sx.fillStyle = `rgba(255,${100 + Math.random() * 80},30,${0.35 + Math.random() * 0.25})`; const [a, b] = P(D.W / 2, D.L / 2); sx.fillRect(a, b, D.W * s, D.L * s); }
  if (t.repairT > 0) { sx.strokeStyle = C.warn; sx.lineWidth = 4; sx.beginPath(); sx.arc(W - 20, 20, 13, -Math.PI / 2, -Math.PI / 2 + (1 - t.repairT / t.repairMax) * Math.PI * 2); sx.stroke(); }
}
export function drawPlaneStatus(p, sx = SX, W = sc.width, Hh = sc.height) {
  const D = p.def;
  sx.clearRect(0, 0, W, Hh);
  const s = Math.min((Hh - 20) / D.L, (W - 20) / D.span) * 0.95, ox = W / 2, oy = Hh / 2;
  const col = k => { const f = p.hp[k] / p.maxHp[k]; return f <= 0 ? C.dead : f < .35 ? C.bad : f < .7 ? C.warn : C.ok; };
  const P = (x, z) => [ox - x * s, oy - z * s];
  sx.lineJoin = 'round';
  const wing = (side, k, on) => {
    sx.fillStyle = on ? col(k) : 'rgba(0,0,0,0)'; sx.strokeStyle = C.line;
    sx.beginPath();
    const r0 = P(side * D.fuseR, D.wingZ + D.chord * .35), t0 = P(side * D.span / 2, D.wingZ + D.tipChord * .3), t1 = P(side * D.span / 2, D.wingZ - D.tipChord * .7), r1 = P(side * D.fuseR, D.wingZ - D.chord * .65);
    sx.moveTo(...r0); sx.lineTo(...t0); sx.lineTo(...t1); sx.lineTo(...r1); sx.closePath(); if (on) sx.fill(); sx.stroke();
  };
  wing(1, 'wingL', p.wingOn.L); wing(-1, 'wingR', p.wingOn.R);
  // cauda
  if (p.tailOn) { sx.fillStyle = col('tail'); const [a, b] = P(D.span * .18, -D.L * .42); sx.fillRect(a, b, D.span * .36 * s, D.L * .1 * s); }
  // fuselagem, tanques, motor
  const [fx, fy] = P(D.fuseR, D.L * .45); sx.fillStyle = col('fuse'); sx.fillRect(fx, fy, D.fuseR * 2 * s, D.L * s);
  { const [a, b] = P(D.fuseR * .8, D.L * .45); sx.fillStyle = p.engineOn ? col('engine') : C.dead; sx.fillRect(a, b, D.fuseR * 1.6 * s, D.L * .2 * s); }
  { const [a, b] = P(D.fuseR * .6, D.L * .05); sx.fillStyle = col('fuel'); sx.fillRect(a, b, D.fuseR * 1.2 * s, D.L * .25 * s); }
  const [px, py] = P(0, -D.L * .02); sx.fillStyle = p.pilot ? C.crew : C.dead; sx.beginPath(); sx.arc(px, py, 5, 0, 7); sx.fill();
  if (p.fire > 0) { sx.fillStyle = `rgba(255,${100 + Math.random() * 80},30,${0.4 + Math.random() * 0.3})`; sx.beginPath(); sx.arc(...P(0, D.L * .1), 18, 0, 7); sx.fill(); }
  if (p.oil > 0) { sx.fillStyle = 'rgba(20,18,15,.6)'; sx.beginPath(); sx.arc(...P(0, D.L * .3), 10, 0, 7); sx.fill(); }
}

// ---------- Painéis ----------
export function buildPanels(v) {
  const air = v.type === 'plane';
  $('#vehName').textContent = v.def.short || v.def.name;
  $('#tankInfo').hidden = air; $('#planeInfo').hidden = !air; $('#instr').hidden = !air;
  if (air) {
    $('#weapons').innerHTML = v.guns.map((g, i) => `<div class="slot w" data-g="${i}"><small>${g.W.name}</small><b class="mono"></b></div>`).join('')
      + (v.def.bombs.length ? `<div class="slot w" data-b><small>Bombas · ${v.def.bombs.map(b => b.name).join(' + ')}</small><b class="mono"></b></div>` : '')
      + (v.def.rockets ? `<div class="slot w" data-r><small>${v.def.rockets.name}</small><b class="mono"></b></div>` : '');
  } else {
    const kbd = i => settings.binds['t_ammo' + (i + 1)] ? settings.binds['t_ammo' + (i + 1)][0].replace('Digit', '') : i + 1;
    $('#weapons').innerHTML = v.gun.ammo.map((a, i) => `<div class="slot" data-a="${i}"><i class="k">${kbd(i)}</i><small>${a.name} · ${a.type}</small><b class="mono"></b><span class="mono pen">${a.type === 'HE' ? Math.round(hePen(a.tnt)) : a.pen} mm</span></div>`).join('')
      + (v.def.mg ? `<div class="slot mg"><i class="k">MG</i><small>${v.def.mg.name}</small><b class="mono"></b></div>` : '');
  }
}
function updatePanels(v) {
  if (v.type === 'plane') {
    drawPlaneStatus(v);
    $('#iIas').textContent = Math.round(v.ias * 3.6);
    $('#iAlt').textContent = Math.round(v.pos.y);
    $('#iVsi').textContent = (v.vel.y >= 0 ? '+' : '') + v.vel.y.toFixed(0);
    $('#iThr').textContent = v.wep ? 'WEP' : Math.round(v.throttle * 100) + '%'; $('#iThr').className = 'mono' + (v.wep ? ' warn' : '');
    $('#iG').textContent = v.n.toFixed(1); $('#iG').className = 'mono' + (Math.abs(v.n) > v.def.glim * .8 ? ' bad' : Math.abs(v.n) > 6 ? ' warn' : '');
    $('#iTemp').textContent = Math.round(v.temp) + '°'; $('#iTemp').className = 'mono' + (v.temp > 110 ? ' bad' : v.temp > 100 ? ' warn' : '');
    $('#iAoa').textContent = (v.alpha * 57.3).toFixed(0) + '°';
    $('#planeFlags').innerHTML = [v.flaps ? '<span class="chip warn">FLAPS</span>' : '', v.airbrake ? '<span class="chip warn">FREIO AR.</span>' : '', v.fire > 0 ? '<span class="chip dead">FOGO</span>' : '', v.oil > 0 ? '<span class="chip warn">ÓLEO</span>' : '', !v.engineOn ? '<span class="chip dead">MOTOR PARADO</span>' : ''].join('');
    $('#weapons').querySelectorAll('[data-g]').forEach(el => (el.querySelector('b').textContent = v.guns[+el.dataset.g].ammo));
    const b = $('#weapons').querySelector('[data-b] b'); if (b) b.textContent = v.bombs.length;
    const r = $('#weapons').querySelector('[data-r] b'); if (r) r.textContent = v.rockets;
    $('#gdark').style.opacity = (v.blackout || 0) * 0.97;
    return;
  }
  drawTankStatus(v);
  $('#tSpeed').textContent = Math.round(Math.abs(v.vFwd) * 3.6);
  $('#tGear').textContent = v.gear < 0 ? 'R' : Math.abs(v.vFwd) < 0.2 && Math.abs(v.throttle) < 0.05 ? 'N' : String(v.gear);
  $('#tRpm').textContent = Math.round(v.rpm / 10) * 10;
  $('#tCruise').textContent = v.cruise ? (v.cruise < 0 ? 'R' : '▲'.repeat(v.cruise)) : '—';
  const g = v.gun, ready = v.loaded >= 0;
  $('#weapons').querySelectorAll('[data-a]').forEach(el => {
    const i = +el.dataset.a; el.classList.toggle('sel', i === v.sel); el.classList.toggle('loaded', i === v.loaded);
    el.querySelector('b').textContent = v.ammoLeft[i];
  });
  const mg = $('#weapons').querySelector('.mg b'); if (mg) mg.textContent = v.mgReload > 0 ? `${v.mgReload.toFixed(0)} s` : `${v.mgBelt}/${v.mgAmmo}`;
  const frac = ready ? (g.auto ? v.clip / g.clip : 1) : 1 - v.reload / g.reload;
  $('#reloadBar').style.width = frac * 100 + '%'; $('#reloadBox').className = 'reload' + (ready ? ' ready' : '');
  $('#reloadT').textContent = !v.alive ? 'destruído' : v.mods.breech.broken ? 'culatra danificada' : !v.seat('gunner').alive ? 'sem atirador' : ready ? (g.auto ? `pente ${v.clip}/${g.clip}` : 'carregado') : `${v.reload.toFixed(1)} s`;
  $('#tFire').hidden = !(v.fire > 0);
  $('#tRepair').hidden = !(v.repairT > 0); if (v.repairT > 0) $('#tRepair').textContent = `Reparando · ${Math.ceil(v.repairT)} s (F cancela)`;
  $('#tBroken').hidden = !(v.brokenCount() && v.repairT <= 0 && v.fire <= 0);
}

// ---------- Retículos ----------
const _a = new V3(), _b = new V3(), _c = new V3(), _sp = new V3();
const gunret = $('#gunret'), drop = $('#drop'), lead = $('#lead');
function toScreen(p, el) {
  _sp.copy(p).project(camera);
  if (_sp.z > 1 || Math.abs(_sp.x) > 1.2 || Math.abs(_sp.y) > 1.2) { el.hidden = true; return false; }
  el.hidden = false; el.style.transform = `translate(${(_sp.x + 1) / 2 * innerWidth}px, ${(1 - _sp.y) / 2 * innerHeight}px)`; return true;
}
// Ponto de impacto previsto (assistência arcade): simula a granada a partir do cano
function predictImpact(t, out) {
  const am = t.ammo, p = t.muzzles[0].getWorldPosition(_a), v = _b.set(0, 0, 1).transformDirection(t.gunPivot.matrixWorld).multiplyScalar(am.v);
  for (let i = 0; i < 200; i++) {
    const h = 0.02, sp = v.length();
    v.x += -am.k * sp * v.x * h; v.y += (-9.81 - am.k * sp * v.y) * h; v.z += -am.k * sp * v.z * h;
    _c.copy(p).addScaledVector(v, h);
    const hit = segmentHit(p, _c, t);
    if (hit) return out.copy(hit.point);
    p.copy(_c);
  }
  return null;
}
function reticles(t) {
  const inPlane = t && t.type === 'plane' && t.alive;
  $('#aimcircle').hidden = !inPlane; $('#nose').hidden = !inPlane;
  $('#cross').hidden = inPlane || cam.sniper || !t || !t.alive;
  lead.hidden = true; drop.hidden = true;
  if (inPlane) {
    toScreen(_a.set(0, 0, 350).applyMatrix4(t.root.matrixWorld), $('#nose'));
    if (settings.gameplay.leadMarker) {
      let best = null, bd = 1300;
      for (const e of planes) { if (!e.alive || e.team === t.team) continue; const d = e.pos.distanceTo(t.pos); if (d < bd) { bd = d; best = e; } }
      if (best) {
        const W = t.guns[0].W, tof = ballistic(W, bd).t || bd / W.v;
        _c.copy(best.pos).addScaledVector(best.vel, tof).addScaledVector(t.vel, -tof); _c.y += 0.5 * 9.81 * tof * tof;
        _c.addScaledVector(t.vel, tof); // as balas herdam a velocidade do avião
        toScreen(_c, lead);
      }
    }
    return;
  }
  if (t && t.alive && t.turretOn) {
    const mp = t.muzzles[0].getWorldPosition(_a), gd = _b.set(0, 0, 1).transformDirection(t.gunPivot.matrixWorld);
    const h = raycast(mp, gd, 1600, t), pt = h ? h.point : _c.copy(mp).addScaledVector(gd, 1600);
    toScreen(pt, gunret);
    let cls = '';
    if (h && h.type === 'tank' && h.tank.team !== t.team && h.tank.alive && t.ammo.type !== 'HE') {
      const d = mp.distanceTo(h.point), E = evalArmor(h.tank, h, t.ammo, ballistic(t.ammo, d).v);
      cls = E.ricoP > .5 || E.pen < E.eff ? 'nopen' : E.pen < E.eff * 1.15 ? 'maybe' : 'pen';
    }
    gunret.className = cls + (t.canFire() ? '' : ' unready');
    if (settings.gameplay.tankAssist && !t.def.gun.auto) { const ip = predictImpact(t, new V3()); if (ip) toScreen(ip, drop); }
  } else gunret.hidden = true;
}

// ---------- Escopo do atirador ----------
const scope = $('#scope'), sctx = scope.getContext('2d');
function drawScope(t) {
  if (scope.width !== innerWidth || scope.height !== innerHeight) { scope.width = innerWidth; scope.height = innerHeight; }
  const w = scope.width, h = scope.height;
  sctx.clearRect(0, 0, w, h);
  if (!(cam.sniper || cam.binoc) || !t || !t.alive || t.type === 'plane' || S.state !== 'play') return;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * .47;
  sctx.fillStyle = 'rgba(5,7,4,.96)'; sctx.beginPath(); sctx.rect(0, 0, w, h);
  if (cam.binoc) { sctx.arc(cx - R * .52, cy, R * .62, 0, Math.PI * 2, true); sctx.moveTo(cx + R * 1.14, cy); sctx.arc(cx + R * .52, cy, R * .62, 0, Math.PI * 2, true); }
  else sctx.arc(cx, cy, R, 0, Math.PI * 2, true);
  sctx.fill('evenodd');
  sctx.fillStyle = 'rgba(10,10,10,.85)'; sctx.strokeStyle = 'rgba(10,10,10,.85)'; sctx.lineWidth = 2;
  const f = (h / 2) / Math.tan(camera.fov * Math.PI / 360);
  if (cam.binoc) {
    sctx.font = '500 12px "IBM Plex Mono", monospace'; sctx.textAlign = 'center';
    for (let m = -40; m <= 40; m += 10) { const x = cx + Math.tan(m / 1000) * f; sctx.fillRect(x - 1, cy - (m % 20 ? 5 : 10), 2, m % 20 ? 10 : 20); }
  } else {
    sctx.fillRect(cx - R, cy - 1.5, R - 60, 3); sctx.fillRect(cx + 60, cy - 1.5, R - 60, 3); sctx.fillRect(cx - 1.5, cy + 60, 3, R - 60);
    sctx.beginPath(); sctx.moveTo(cx - 9, cy + 14); sctx.lineTo(cx, cy); sctx.lineTo(cx + 9, cy + 14); sctx.stroke();
    const am = t.ammo;
    sctx.font = '500 12px "IBM Plex Mono", monospace'; sctx.textAlign = 'right'; sctx.textBaseline = 'middle';
    for (let r = 200; r <= 2000; r += 200) {
      const y = cy + Math.tan(ballistic(am, r).ang) * f; if (y > cy + R * .95) break;
      const big = r % 400 === 0; sctx.fillRect(cx - (big ? 46 : 30), y - 1, big ? 28 : 16, 2);
      if (big) sctx.fillText(String(r / 100), cx - 50, y);
    }
  }
  sctx.textAlign = 'center'; sctx.fillStyle = 'rgba(221,214,183,.85)'; sctx.font = '500 12px "IBM Plex Mono", monospace';
  const zoom = Math.tan(30 * Math.PI / 180) / Math.tan(camera.fov * Math.PI / 360);
  const rng = t.seat('commander').alive && cam.range ? `≈ ${Math.round(cam.range / 25) * 25} m` : 'sem telemetria';
  sctx.fillText(`×${zoom.toFixed(1)}  ·  ${cam.binoc ? 'binóculo' : t.ammo.name}  ·  ${rng}`, cx, cy + R - 24);
}

// ---------- Placar ----------
export function drawScore() {
  const rows = team => S.roster.filter(w => w.team === team).sort((a, b) => b.score - a.score)
    .map(w => `<tr class="${w.isPlayer ? 'me' : ''}"><td>${w.name}</td><td>${w.veh ? (VEHICLES[w.veh].short || VEHICLES[w.veh].name) : '—'}</td><td class="mono">${w.kills}</td><td class="mono">${w.airKills}</td><td class="mono">${w.deaths}</td><td class="mono">${w.score}</td></tr>`).join('');
  const head = '<tr><th>Nome</th><th>Veículo</th><th>Terrestres</th><th>Aéreos</th><th>Mortes</th><th>Pontos</th></tr>';
  $('#scoreA').innerHTML = head + rows(1); $('#scoreE').innerHTML = head + rows(-1);
}

// ---------- Atualização por quadro ----------
let hudT = 0;
export function updateHUD(dt) {
  if (S.state === 'menu') return;
  $('#tkA').textContent = Math.ceil(S.tickets[1]); $('#tkE').textContent = Math.ceil(S.tickets[-1]);
  $('#tkAbar').style.width = S.tickets[1] / TICKETS * 100 + '%'; $('#tkEbar').style.width = S.tickets[-1] / TICKETS * 100 + '%';
  if (settings.gameplay.hitcam) drawXray(); else $('#xray').hidden = true;
  const t = S.player;
  reticles(t);
  drawScope(t);
  const live = t && t.alive;
  $('#vehHud').hidden = !live;
  const oob = live && t.oobT > 0;
  $('#oob').hidden = !oob; if (oob) $('#oob').textContent = `Retorne à área de combate · ${Math.max(0, Math.ceil((t.type === 'plane' ? 15 : 12) - t.oobT))} s`;
  if (!live || t.type !== 'plane') $('#gdark').style.opacity = 0;
  if ((hudT -= dt) > 0) return; hudT = .08;
  for (const k of [...tanks, ...planes]) {
    const el = k.label;
    if (k === t || !k.alive || (k.team === -1 && k.spottedUntil < S.now)) { el.style.display = 'none'; continue; }
    const p = k.type === 'plane' ? _a.copy(k.pos).add(_b.set(0, 3, 0)) : k.eyePos(_a).add(_b.set(0, 1.4, 0));
    const d = p.distanceTo(camera.position); p.project(camera);
    if (p.z > 1 || d > (k.type === 'plane' ? 3000 : 900)) { el.style.display = 'none'; continue; }
    el.style.display = ''; el.style.transform = `translate(${(p.x + 1) / 2 * innerWidth}px, ${(1 - p.y) / 2 * innerHeight}px) translate(-50%,-100%)`;
    el.style.opacity = d > 500 ? .6 : 1;
  }
  [...$('#caps').children].forEach((c, i) => { const p = POINTS[i]; c.className = 'cap o' + p.owner; const bar = c.querySelector('i'); bar.style.width = Math.abs(p.prog) * 100 + '%'; bar.style.background = p.prog > 0 ? 'var(--ally)' : 'var(--enemy)'; });
  const v = live ? t : S.spectate;
  drawMini(v, v && v.type === 'plane', cam);
  if (live) updatePanels(t);
  if (!$('#score').hidden) drawScore();
}
