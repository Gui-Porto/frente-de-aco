'use strict';
// =====================================================================
// Partida, lineup e pontos de spawn, hangar, entrada, câmera, laço principal
// =====================================================================
let state = 'menu', paused = false, tickets = { 1: 800, '-1': 800 }, respawns = [], stats = {}, choice = 'sherman', matchT = 0, ticketT = 0;
let player = null, me = null, roster = [], lastPlane = { 1: -999, '-1': -999 }, spectate = null;
const TICKETS = 800;
const NAMES = { 1: ['Sgt. Moura', 'Cb. Teixeira', 'Ten. Barros', 'Sd. Ribeiro'], '-1': ['Ofw. Brandt', 'Ltn. Krause', 'Uffz. Lenz', 'St. Sokolov', 'Sgt. Orlov'] };
const GROUND = ['sherman', 't34', 'pz4', 'tiger'];
const typeLabel = D => D.type === 'plane' ? 'AVIÃO' : D.type === 'spaa' ? 'AA' : 'TANQUE';

function mkWho(name, team, isPlayer) { const w = { name, team, isPlayer, kills: 0, airKills: 0, deaths: 0, score: 0, veh: null, v: null }; roster.push(w); return w; }
function spawnVehicle(who, key, slot) {
  const D = VEHICLES[key]; let v;
  if (D.type === 'plane') {
    const s = AIRSPAWN[who.team], off = (slot - 2) * 60;
    v = new Plane(key, who.team, who, new V3(s.x + off, s.y + rand(-50, 50), s.z), s.yaw, 125);
    if (!who.isPlayer) v.brain = new PlaneBrain(v);
    lastPlane[who.team] = now;
  } else {
    const s = SPAWN[who.team];
    v = new Tank(key, who.team, who, s.x + (slot - 2) * 14 + rand(-2, 2), s.z + rand(-4, 4), s.yaw);
    if (!who.isPlayer) v.brain = new TankBrain(v);
  }
  who.veh = key; who.v = v;
  return v;
}
function botPick(team) {
  const enemyPlanes = planes.some(p => p.alive && p.team !== team);
  const haveAA = tanks.some(t => t.alive && t.team === team && t.type === 'spaa');
  const myPlanes = planes.some(p => p.alive && p.team === team);
  if (enemyPlanes && !haveAA && Math.random() < 0.55) return 'wirbel';
  if (!myPlanes && now - lastPlane[team] > 75 && matchT > 40 && Math.random() < 0.45) return ['p47', 'il2', 'fw190'][Math.floor(Math.random() * 3)];
  return GROUND[Math.floor(Math.random() * GROUND.length)];
}
function clearWorld() {
  while (tanks.length) tanks[0].remove();
  while (planes.length) planes[0].remove();
  clearProjs(); for (const p of popped) scene.remove(p.obj); popped.length = 0; respawns = [];
  for (const p of POINTS) { p.owner = 0; p.prog = 0; }
  resetTrees(); hideCraters(); tickets = { 1: TICKETS, '-1': TICKETS }; player = null; spectate = null;
  roster = []; lastPlane = { 1: -999, '-1': -999 };
  $('#feed').innerHTML = ''; xray = null; $('#xray').hidden = true;
}

// ---------- Hangar ----------
let show = null, showKey = null, armorView = false;
const HANGAR = new V3(0, 0, 334);
function buildShowcase(key) {
  if (show) scene.remove(show.root);
  const D = VEHICLES[key];
  show = D.type === 'plane' ? buildPlane(D) : buildTank(D);
  const y = H(HANGAR.x, HANGAR.z);
  show.root.position.set(HANGAR.x, y + (D.type === 'plane' ? 2.2 : 0), HANGAR.z);
  if (D.type === 'plane') show.root.rotation.z = 0.12;
  scene.add(show.root); showKey = key;
  if (D.type !== 'plane') setArmorView(show, armorView && D.type !== 'plane');
  $('#vArm').disabled = D.type === 'plane';
  $('#legend').hidden = !(armorView && D.type !== 'plane');
}
function fillSheet(key) {
  const D = VEHICLES[key];
  $('#shNat').textContent = `${D.nation} · ${D.year} · ${typeLabel(D)} · ${D.sp} SP`;
  $('#shName').textContent = D.name;
  let rows;
  if (D.type === 'plane') {
    const ws = D.mass / D.S, pw = D.hp / (D.mass / 1000);
    rows = [['Massa de combate', `${(D.mass / 1000).toFixed(1).replace('.', ',')} t`], ['Carga alar', `${Math.round(ws)} kg/m²`], ['Motor', `${D.hp} hp (${D.wep} hp WEP)`], ['Potência/peso', `${pw.toFixed(0)} hp/t`],
      ['Estol (limpo)', `${Math.round(Math.sqrt(2 * D.mass * G / (RHO * D.S * D.clmax)) * 3.6)} km/h`], ['Vel. máx. de mergulho', `${Math.round(D.vne * 3.6)} km/h`],
      ['Armamento', D.guns.map(g => `${g.n}× ${GUNS[g.w].name.split(' ').slice(0, 2).join(' ')}`).join(', ')],
      ['Carga externa', [...D.bombs.map(b => `${b.n}× ${b.name}`), D.rockets ? `${D.rockets.n}× ${D.rockets.name}` : null].filter(Boolean).join(', ')]];
  } else {
    const eff = Math.round(D.armor.front[0] / Math.cos(D.armor.front[1] * DEG));
    rows = [['Glacis', `${D.armor.front[0]} mm a ${D.armor.front[1]}° → ${eff} mm`], ['Lateral / torre', `${D.armor.side[0]} / ${D.armor.tFront[0]} mm`], ['Canhão', D.gun.name],
      [D.gun.auto ? 'Cadência' : 'Recarga', D.gun.auto ? `${D.gun.rpm} disp/min` : `${D.gun.reload.toFixed(1).replace('.', ',')} s`],
      ['Perfuração', D.gun.ammo.map(a => a.type === 'HE' ? Math.round(hePen(a.tnt)) : a.pen).join(' / ') + ' mm'], ['Giro da torre', `${D.gun.trav}°/s${D.rpmTraverse ? ' (depende do RPM)' : ''}`],
      ['Massa · motor', `${(D.mass / 1000).toFixed(1).replace('.', ',')} t · ${D.hp} hp`], ['Potência/peso', `${(D.hp / (D.mass / 1000)).toFixed(1).replace('.', ',')} hp/t`], ['Vel. máxima', `${Math.round(D.vmax * 3.6)} km/h`]];
  }
  $('#shStats').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
}
function slotHtml(key, extra) {
  const D = VEHICLES[key];
  return `<span class="ic">${typeLabel(D)}</span><span>${D.short || D.name}<small>${D.nation} · ${D.year}</small></span><span class="cost">${extra ?? D.sp + ' SP'}</span>`;
}
function buildLineup() {
  const box = $('#lineup'); box.innerHTML = '';
  for (const key of LINEUP) {
    const b = document.createElement('button'); b.className = 'slot'; b.innerHTML = slotHtml(key); b.dataset.k = key;
    b.onclick = () => { choice = key; syncLineup(); };
    b.ondblclick = () => { choice = key; startMatch(); };
    box.appendChild(b);
  }
  syncLineup();
}
function syncLineup() {
  document.querySelectorAll('#lineup .slot').forEach(s => s.setAttribute('aria-pressed', s.dataset.k === choice));
  fillSheet(choice); buildShowcase(choice);
}
$('#vExt').onclick = () => { armorView = false; $('#vExt').setAttribute('aria-pressed', true); $('#vArm').setAttribute('aria-pressed', false); buildShowcase(choice); };
$('#vArm').onclick = () => { armorView = true; $('#vArm').setAttribute('aria-pressed', true); $('#vExt').setAttribute('aria-pressed', false); buildShowcase(choice); };

// ---------- Spawn com SP ----------
let spawnSel = null;
function spCost(key) { return me.firstSpawn ? 0 : VEHICLES[key].sp; }
function openSpawn(why) {
  state = 'spawn'; exitPointer();
  $('#spawn').hidden = false; $('#spWhy').textContent = why || '';
  $('#spSP').textContent = `${me.sp} SP`;
  const box = $('#spLineup'); box.innerHTML = '';
  let any = false;
  for (const key of LINEUP) {
    const used = me.used.has(key), cost = spCost(key), D = VEHICLES[key];
    const can = !used && cost <= me.sp && !(me.firstSpawn && D.type === 'plane');
    const b = document.createElement('button'); b.className = 'slot'; b.dataset.k = key;
    b.innerHTML = slotHtml(key, used ? 'usado' : me.firstSpawn && D.type === 'plane' ? 'após 1º spawn' : `${cost} SP`);
    b.disabled = !can; if (can) any = true;
    b.onclick = () => { spawnSel = key; box.querySelectorAll('.slot').forEach(x => x.setAttribute('aria-pressed', x === b)); $('#spawnBtn').disabled = false; };
    box.appendChild(b);
  }
  const pre = [...box.children].find(b => !b.disabled && b.dataset.k === (spawnSel || choice)) || [...box.children].find(b => !b.disabled);
  if (pre) pre.click(); else { spawnSel = null; $('#spawnBtn').disabled = true; }
  $('#spTitle').textContent = any ? 'Escolha o veículo' : 'Sem veículos disponíveis';
  if (!any) $('#spWhy').textContent = 'Você usou todo o lineup ou não tem SP suficiente. Acompanhe a batalha pelos aliados; ganhe SP com abates e capturas.';
  $('#spawnBtn').textContent = any ? 'Entrar' : 'Assistir';
  $('#spawnBtn').disabled = false;
}
$('#spawnBtn').onclick = () => {
  if (!spawnSel || $('#spawnBtn').textContent === 'Assistir') { $('#spawn').hidden = true; state = 'spectate'; spectate = tanks.find(t => t.alive && t.team === 1) || null; hint('Assistindo aliados · Enter abre a tela de spawn quando houver SP'); return; }
  const key = spawnSel; if (me.used.has(key)) return;
  me.sp -= spCost(key); me.used.add(key); me.firstSpawn = false;
  player = spawnVehicle(me, key, 2);
  $('#spawn').hidden = true; state = 'play'; cam.sniper = false;
  if (player.type === 'plane') { cam.yaw = AIRSPAWN[1].yaw; cam.pitch = -0.1; buildPlanePanel(player); hint('Mouse aponta o avião · W/S motor · clique armas · Espaço bombas · X foguetes · A/D rolagem · C olhar livre'); }
  else { cam.yaw = SPAWN[1].yaw; cam.pitch = -0.05; buildTankPanel(player); hint('W A S D dirigir · mouse mira · clique atira · botão direito mira · Espaço metralhadora · 1/2/3 munição · F extintor'); }
  lockPointer();
};
function hint(t) { const h = $('#hint'); h.textContent = t; h.style.opacity = 1; clearTimeout(h._t); h._t = setTimeout(() => h.style.opacity = 0, 14000); }

function startMatch() {
  audioInit(); if (AC && AC.state === 'suspended') AC.resume();
  if (show) { scene.remove(show.root); show = null; }
  camera.clearViewOffset();
  clearWorld(); stats = { kills: 0, airKills: 0, deaths: 0, shots: 0, hits: 0, pens: 0 }; matchT = 0;
  me = mkWho('Você', 1, true); me.sp = 300; me.used = new Set(); me.firstSpawn = true;
  NAMES[1].forEach((n, i) => spawnVehicle(mkWho(n, 1, false), GROUND[Math.floor(Math.random() * 4)], i < 2 ? i : i + 1));
  NAMES[-1].forEach((n, i) => spawnVehicle(mkWho(n, -1, false), GROUND[Math.floor(Math.random() * 4)], i));
  paused = false;
  $('#menu').hidden = true; $('#hud').hidden = false; $('#end').hidden = true; $('#pause').hidden = true;
  const caps = $('#caps'); caps.innerHTML = POINTS.map(p => `<div class="cap">${p.id}<i></i></div>`).join('');
  spawnSel = choice;
  openSpawn('Primeiro spawn sem custo. Aviões ficam disponíveis com SP, ganhos por abates e capturas.');
}
function onVehicleDestroyed(v, k, cause) {
  const air = v.type === 'plane';
  tickets[v.team] = Math.max(0, tickets[v.team] - (air ? 20 : 30));
  if (v.who) v.who.deaths++;
  if (k && k.who) { if (air) k.who.airKills++; else k.who.kills++; k.who.score += air ? 120 : 150; if (k.who === me) { me.sp += air ? 120 : 150; air ? stats.airKills++ : stats.kills++; } }
  addFeed(k, v, cause);
  if (v === player) { stats.deaths++; cam.sniper = false; setTimeout(() => { if (state === 'play' && player === v) openSpawn(deathText(k, cause)); }, 3500); }
  else if (v.who && !v.who.isPlayer) respawns.push({ who: v.who, t: rand(12, 18) });
}
function deathText(k, cause) {
  const why = { ammo: 'Detonação da munição.', crew: 'Tripulação fora de combate.', fire: 'O incêndio tomou o veículo.', pilot: 'Piloto morto.', wing: 'Asa arrancada.', tail: 'Cauda destruída.', structure: 'Estrutura destruída.', crash: 'Colisão com o solo.', overg: 'A asa quebrou por excesso de G.', vne: 'Excesso de velocidade: a estrutura cedeu.', oob: 'Fora da área de combate.', flip: 'Veículo capotado.', bail: 'Veículo abandonado.' }[cause] || 'Veículo perdido.';
  return why + (k ? ` Abatido por ${k.who ? k.who.name : ''} (${k.def.short || k.def.name}).` : '');
}
function updateMatch(dt) {
  matchT += dt;
  for (const p of POINTS) {
    let a = 0, e = 0, meIn = false;
    for (const t of tanks) if (t.alive && Math.hypot(t.pos.x - p.x, t.pos.z - p.z) < p.r) { t.team === 1 ? a++ : e++; if (t === player) meIn = true; }
    p.contested = a > 0 && e > 0;
    if (!p.contested && (a || e)) {
      const dir = a ? 1 : -1, n = Math.min(3, a || e), was = p.owner;
      p.prog = clamp(p.prog + dir * n * 0.055 * dt, -1, 1);
      if (p.owner === -dir && p.prog * dir >= 0) p.owner = 0;
      if (Math.abs(p.prog) >= 1) p.owner = Math.sign(p.prog);
      if (p.owner !== was && p.owner === 1 && meIn) { me.sp += 100; me.score += 100; showDmg(`Ponto ${p.id} capturado · +100 SP`, true); }
    }
    const col = p.owner === 1 ? 0x6db4e3 : p.owner === -1 ? 0xe65a42 : 0xddd6b7;
    p.ring.material.color.setHex(col); p.flag.material.color.setHex(col);
  }
  if ((ticketT += dt) >= 1) {
    ticketT = 0;
    const own = POINTS.reduce((s, p) => s + p.owner, 0);
    if (own > 0) tickets[-1] = Math.max(0, tickets[-1] - own * 1.5);
    if (own < 0) tickets[1] = Math.max(0, tickets[1] + own * 1.5);
  }
  for (let i = respawns.length - 1; i >= 0; i--) {
    const r = respawns[i];
    if ((r.t -= dt) <= 0) { respawns.splice(i, 1); spawnVehicle(r.who, botPick(r.who.team), Math.floor(Math.random() * 5)); }
  }
  for (const t of [...tanks]) if (!t.alive && (t.deadT += dt) > 80 && t !== player) t.remove();
  for (const p of [...planes]) {
    if (p.returned && p !== player) { p.remove(); if (p.who) respawns.push({ who: p.who, t: 8 }); continue; }
    if (p.gone && (p.burnT -= dt) <= 0 && p !== player) p.remove();
    else if (p.gone && p.burnT > 0 && Math.random() < dt * 12) fxBurn(p.burnAt.clone().add(rv(2)), 1.4);
  }
  // detecção de aeronaves (visíveis a longa distância)
  for (const p of planes) if (p.alive && [...tanks, ...planes].some(o => o.alive && o.team !== p.team && o.pos.distanceTo(p.pos) < 2600)) p.spottedUntil = now + 2;
  if (state === 'spectate' && (!spectate || !spectate.alive)) spectate = tanks.find(t => t.alive && t.team === 1) || planes.find(p => p.alive && p.team === 1) || null;
  if (tickets[1] <= 0 || tickets[-1] <= 0) endMatch(tickets[-1] <= 0);
}
function endMatch(win) {
  state = 'end'; exitPointer();
  ['#spawn', '#pause'].forEach(s => $(s).hidden = true); $('#end').hidden = false;
  $('#endTitle').textContent = win ? 'Vitória' : 'Derrota';
  $('#endWhy').textContent = win ? 'Os pontos inimigos acabaram. O setor é nosso.' : 'Nossos pontos acabaram. A linha recuou.';
  const m = Math.floor(matchT / 60), s = Math.floor(matchT % 60);
  $('#endStats').innerHTML = `<dt>Terrestres destruídos</dt><dd>${stats.kills}</dd><dt>Aeronaves derrubadas</dt><dd>${stats.airKills}</dd><dt>Veículos perdidos</dt><dd>${stats.deaths}</dd><dt>Disparos de canhão</dt><dd>${stats.shots}</dd><dt>Acertos</dt><dd>${stats.hits}</dd><dt>Penetrações</dt><dd>${stats.pens}</dd><dt>Pontos</dt><dd>${me.score}</dd><dt>Duração</dt><dd>${m}:${String(s).padStart(2, '0')}</dd>`;
  $('#againBtn').focus();
}
function toMenu() {
  ['#end', '#hud', '#pause', '#spawn'].forEach(s => $(s).hidden = true); $('#menu').hidden = false;
  if (eng) eng.g.gain.value = 0; if (aeng) aeng.g.gain.value = 0;
  clearWorld(); state = 'menu'; player = null; syncLineup();
}

// ---------- Entrada ----------
const keys = {}; let mouseDown = false, locked = false;
const cam = { yaw: 0, pitch: -.05, dist: 11, sniper: false, fov: 9, orbit: 0, rangeT: 0, range: 0, free: false, aimDir: new V3(0, 0, 1), drag: false };
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); if (state !== 'menu') { drawScore(); $('#score').hidden = false; } }
  if (state === 'spectate' && e.code === 'Enter') openSpawn('');
  if (state !== 'play' || paused || !player || !player.alive) return;
  if (player.type !== 'plane') {
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') player.selectAmmo(+e.code.slice(5) - 1);
    if (e.code === 'KeyF') player.extinguish();
    if (e.code === 'ShiftLeft' || e.code === 'KeyZ') toggleSniper();
  } else {
    if (e.code === 'Space') player.dropBomb();
    if (e.code === 'KeyX') { player.fireRocket(); player.fireRocket(); }
  }
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'Escape' && !locked) setPause(true);
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Tab') $('#score').hidden = true; });
function toggleSniper() { if (player && player.alive && player.type !== 'plane') cam.sniper = !cam.sniper; }
const gl = renderer.domElement;
addEventListener('contextmenu', e => { if (state !== 'menu') e.preventDefault(); });
addEventListener('mousedown', e => {
  if (state === 'menu' && e.target === gl) { cam.drag = true; return; }
  if (state !== 'play' || paused) return;
  if (e.target.closest && e.target.closest('button')) return;
  if (!locked) lockPointer();
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) toggleSniper();
});
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; cam.drag = false; });
addEventListener('mousemove', e => {
  if (state === 'menu') { if (cam.drag) cam.orbit -= e.movementX * 0.006; return; }
  if (paused || state === 'end' || state === 'spawn') return;
  const k = 0.0022 * (cam.sniper ? cam.fov / 60 : 1);
  cam.yaw -= e.movementX * k; cam.pitch = clamp(cam.pitch - e.movementY * k, player && player.type === 'plane' ? -1.45 : -0.6, player && player.type === 'plane' ? 1.45 : 0.55);
});
addEventListener('wheel', e => {
  if (state === 'menu') return;
  if (cam.sniper) cam.fov = clamp(cam.fov * (e.deltaY > 0 ? 1.15 : 0.87), 3.5, 16);
  else cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 1.2, 6, 26);
}, { passive: true });
function lockPointer() { try { const r = gl.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } }
function exitPointer() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { } }
document.addEventListener('pointerlockchange', () => {
  const was = locked; locked = !!document.pointerLockElement;
  if (was && !locked && (state === 'play' || state === 'spectate')) setPause(true);
});
function setPause(p) {
  paused = p; $('#pause').hidden = !p; mouseDown = false;
  $('#bailBtn').hidden = !(player && player.alive);
  if (AC) p ? AC.suspend() : AC.resume();
  if (p) { exitPointer(); $('#resumeBtn').focus(); } else lockPointer();
}
$('#resumeBtn').onclick = () => setPause(false);
$('#bailBtn').onclick = () => { setPause(false); if (player && player.alive) destroyVehicle(player, null, 'bail'); };
$('#quitBtn').onclick = () => { setPause(false); exitPointer(); toMenu(); };
$('#againBtn').onclick = () => toMenu();
$('#startBtn').onclick = () => startMatch();

// ---------- Câmera ----------
const _dir = new V3(), _cp = new V3(), _ca = new V3(), _cb = new V3();
function camDir(out) { return out.set(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)); }
function updateCamera(dt) {
  if (state === 'menu') {
    cam.orbit += cam.drag ? 0 : dt * 0.12;
    const D = VEHICLES[showKey] || TANKS.sherman, r = D.type === 'plane' ? 17 : 11.5, y = H(HANGAR.x, HANGAR.z);
    if (Math.abs(camera.fov - 40) > .01) { camera.fov = 40; camera.updateProjectionMatrix(); }
    camera.setViewOffset(innerWidth, innerHeight, -innerWidth * (innerWidth > 760 ? 0.13 : 0), innerHeight * 0.06, innerWidth, innerHeight);
    camera.position.set(HANGAR.x + Math.sin(cam.orbit) * r, y + 4.2, HANGAR.z + Math.cos(cam.orbit) * r);
    camera.lookAt(HANGAR.x, y + 1.3, HANGAR.z); return;
  }
  const v = player && (player.alive || state === 'play') ? player : spectate || player;
  if (!v) { camera.position.set(0, 120, 300); camera.lookAt(0, 0, 0); return; }
  camDir(_dir);
  if (v.type === 'plane') {
    if (Math.abs(camera.fov - 65) > .01) { camera.fov = 65; camera.updateProjectionMatrix(); }
    const piv = _ca.copy(v.pos);
    camera.position.copy(piv).addScaledVector(_dir, -cam.dist * 1.5).addScaledVector(UP, 3.2);
    camera.position.y = Math.max(camera.position.y, H(camera.position.x, camera.position.z) + 2);
    camera.lookAt(_cb.copy(camera.position).add(_dir));
    if (!cam.free || !keys.KeyC) cam.aimDir.copy(_dir);
  } else {
    const t = v, D = t.def;
    const sn = cam.sniper && t.alive && t.turretOn && t === player;
    if (sn) {
      t.turret.localToWorld(_cp.set(D.turret.w * .22, D.turret.h + .1, D.turret.l * .3));
      camera.position.copy(_cp); t.root.visible = false;
      if (Math.abs(camera.fov - cam.fov) > .01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
      t.aimPoint.copy(_cp).addScaledVector(_dir, 1500);
      if ((cam.rangeT -= dt) <= 0) { cam.rangeT = .25; const h = raycast(_cp, _dir, 2000, t); cam.range = h ? h.t * 2000 : 0; }
    } else {
      t.root.visible = true;
      const pv = t.eyePos(_ca); pv.y += 1.2;
      camera.position.copy(pv).addScaledVector(_dir, -cam.dist);
      camera.position.y = Math.max(camera.position.y, H(camera.position.x, camera.position.z) + 1);
      if (Math.abs(camera.fov - 60) > .01) { camera.fov = 60; camera.updateProjectionMatrix(); }
      if (t.alive && t === player) { const h = raycast(camera.position, _dir, 1800, t); if (h) t.aimPoint.copy(h.point); else t.aimPoint.copy(camera.position).addScaledVector(_dir, 1800); }
    }
    camera.lookAt(_cb.copy(camera.position).add(_dir));
  }
  if (shake > 0 && !REDUCED) { camera.rotation.x += rand(-1, 1) * shake * .01; camera.rotation.y += rand(-1, 1) * shake * .01; }
  shake = Math.max(0, shake - dt * 1.5);
}

// ---------- HUD por quadro ----------
const scope = $('#scope'), sctx = scope.getContext('2d'), gunret = $('#gunret');
function drawScope() {
  if (scope.width !== innerWidth || scope.height !== innerHeight) { scope.width = innerWidth; scope.height = innerHeight; }
  const w = scope.width, h = scope.height;
  sctx.clearRect(0, 0, w, h);
  if (!cam.sniper || !player || !player.alive || player.type === 'plane' || state !== 'play') return;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * .47;
  sctx.fillStyle = 'rgba(5,7,4,.96)'; sctx.beginPath(); sctx.rect(0, 0, w, h); sctx.arc(cx, cy, R, 0, Math.PI * 2, true); sctx.fill();
  sctx.strokeStyle = 'rgba(10,10,10,.85)'; sctx.fillStyle = 'rgba(10,10,10,.85)'; sctx.lineWidth = 2;
  sctx.fillRect(cx - R, cy - 1.5, R - 60, 3); sctx.fillRect(cx + 60, cy - 1.5, R - 60, 3); sctx.fillRect(cx - 1.5, cy + 60, 3, R - 60);
  sctx.beginPath(); sctx.moveTo(cx - 9, cy + 14); sctx.lineTo(cx, cy); sctx.lineTo(cx + 9, cy + 14); sctx.stroke();
  const am = player.ammo, f = (h / 2) / Math.tan(cam.fov * DEG / 2);
  sctx.font = '500 12px "IBM Plex Mono", monospace'; sctx.textAlign = 'right'; sctx.textBaseline = 'middle';
  for (let r = 200; r <= 2000; r += 200) {
    const y = cy + Math.tan(ballistic(am, r).ang) * f; if (y > cy + R * .95) break;
    const big = r % 400 === 0;
    sctx.fillRect(cx - (big ? 46 : 30), y - 1, big ? 28 : 16, 2);
    if (big) sctx.fillText(String(r / 100), cx - 50, y);
  }
  sctx.textAlign = 'center'; sctx.fillStyle = 'rgba(221,214,183,.85)';
  const zoom = Math.tan(30 * DEG) / Math.tan(cam.fov * DEG / 2);
  const rng = player.seat('commander').alive && cam.range ? `≈ ${Math.round(cam.range / 25) * 25} m` : 'sem telemetria';
  sctx.fillText(`×${zoom.toFixed(1)}  ·  ${am.name}  ·  ${rng}`, cx, cy + R - 24);
}
let hudT = 0;
const _sp = new V3();
function toScreen(p, el) {
  _sp.copy(p).project(camera);
  if (_sp.z > 1) { el.hidden = true; return false; }
  el.hidden = false; el.style.transform = `translate(${(_sp.x + 1) / 2 * innerWidth}px, ${(1 - _sp.y) / 2 * innerHeight}px)`; return true;
}
function updateHUD(dt) {
  if (state === 'menu') return;
  $('#tkA').textContent = Math.ceil(tickets[1]); $('#tkE').textContent = Math.ceil(tickets[-1]);
  $('#tkAbar').style.width = tickets[1] / TICKETS * 100 + '%'; $('#tkEbar').style.width = tickets[-1] / TICKETS * 100 + '%';
  drawXray();
  const t = player, inPlane = t && t.type === 'plane' && t.alive;
  $('#aimcircle').hidden = !inPlane; $('#cross').hidden = inPlane || cam.sniper || !t || !t.alive;
  $('#nose').hidden = !inPlane;
  if (inPlane) toScreen(_ca.set(0, 0, 400).applyMatrix4(t.root.matrixWorld), $('#nose'));
  if (t && t.alive && t.type !== 'plane' && t.turretOn) {
    const mp = t.muzzles[0].getWorldPosition(_ca), gd = _cb.set(0, 0, 1).transformDirection(t.gunPivot.matrixWorld);
    const h = raycast(mp, gd, 1600, t), pt = h ? h.point : _cp.copy(mp).addScaledVector(gd, 1600);
    toScreen(pt, gunret);
    let cls = '';
    if (h && h.type === 'tank' && h.tank.team !== t.team && h.tank.alive && t.ammo.type !== 'HE') {
      const d = mp.distanceTo(h.point), E = evalArmor(h.tank, h, t.ammo, ballistic(t.ammo, d).v);
      cls = E.ricoP > .5 || E.pen < E.eff ? 'nopen' : E.pen < E.eff * 1.15 ? 'maybe' : 'pen';
    }
    gunret.className = cls + (t.canFire() ? '' : ' unready');
  } else gunret.hidden = true;
  const oob = t && t.alive && (t.type === 'plane' ? t.oobT > 0 : t.oobT > 0);
  $('#oob').hidden = !oob; if (oob) $('#oob').textContent = `Retorne à área de combate · ${Math.max(0, Math.ceil((t.type === 'plane' ? 15 : 12) - t.oobT))} s`;
  if (!inPlane) $('#gdark').style.opacity = 0;
  if ((hudT -= dt) > 0) return; hudT = .1;
  for (const k of [...tanks, ...planes]) {
    const el = k.label;
    if (k === player || !k.alive || (k.team === -1 && k.spottedUntil < now)) { el.style.display = 'none'; continue; }
    const p = k.type === 'plane' ? _ca.copy(k.pos).add(_cb.set(0, 3, 0)) : k.eyePos(_ca).add(_cb.set(0, 1.4, 0));
    const d = p.distanceTo(camera.position); p.project(camera);
    if (p.z > 1 || d > (k.type === 'plane' ? 3000 : 900)) { el.style.display = 'none'; continue; }
    el.style.display = ''; el.style.transform = `translate(${(p.x + 1) / 2 * innerWidth}px, ${(1 - p.y) / 2 * innerHeight}px) translate(-50%,-100%)`;
    el.style.opacity = d > 500 ? .6 : 1;
  }
  [...$('#caps').children].forEach((c, i) => { const p = POINTS[i]; c.className = 'cap o' + p.owner; const bar = c.querySelector('i'); bar.style.width = Math.abs(p.prog) * 100 + '%'; bar.style.background = p.prog > 0 ? 'var(--ally)' : 'var(--enemy)'; });
  const v = t && t.alive ? t : spectate;
  drawMini(v, v && v.type === 'plane');
  if (t && t.alive) { if (t.type === 'plane') updatePlanePanel(t); else updateTankPanel(t); }
  if (!$('#score').hidden) drawScore();
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// ---------- Controle do jogador ----------
let wepHold = 0;
function controlPlayer(dt) {
  const p = player;
  if (!p || !p.alive || state !== 'play') { if (p && p.type !== 'plane') { p.throttle = 0; p.steer = 0; p.mgFiring = false; } return; }
  if (p.type === 'plane') {
    if (keys.KeyW) { p.throttle = Math.min(1, p.throttle + dt * 0.6); if (p.throttle >= 1) wepHold += dt; } else wepHold = 0;
    if (keys.KeyS) { p.throttle = Math.max(0, p.throttle - dt * 0.6); p.wep = false; }
    if (wepHold > 0.6) p.wep = true;
    cam.free = keys.KeyC;
    p.steerTo(cam.aimDir, dt, { glim: 9 });
    if (keys.KeyA) p.ail = -1; if (keys.KeyD) p.ail = 1;
    if (keys.KeyQ) p.rud = 1; if (keys.KeyE) p.rud = -1;
    p.firing = mouseDown;
  } else {
    p.throttle = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    p.steer = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
    p.compensate = false;
    if (p.gun.auto) p.firing = mouseDown; else if (mouseDown) p.shoot();
    p.mgFiring = !!keys.Space;
    if ((p.spotT = (p.spotT || 0) - dt) < 0) { p.spotT = .5; for (const e of tanks) if (e.team !== 1 && e.alive && p.pos.distanceTo(e.pos) < 650 && los(p, e)) e.spottedUntil = now + 4; }
  }
}

// ---------- Simulação ----------
function simulate(dt) {
  now += dt;
  controlPlayer(dt);
  for (const t of tanks) if (t.brain) t.brain.update(dt);
  for (const p of planes) if (p.brain) p.brain.update(dt);
  for (const t of tanks) {
    if (t.alive || !t.popped || true) { t.physics(dt); t.collide(); }
  }
  for (let i = 0; i < tanks.length; i++) for (let j = i + 1; j < tanks.length; j++) {
    const a = tanks[i], b = tanks[j];
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), r = (a.def.L + b.def.L) * 0.5;
    if (d > r || d < 1e-3) continue;
    // dois círculos por casco
    a.axes(); const ax = _az.x, az = _az.z; b.axes(); const bx = _az.x, bz = _az.z;
    for (const ka of [-0.25, 0.25]) for (const kb of [-0.25, 0.25]) {
      const px = a.pos.x + ax * a.def.L * ka, pz = a.pos.z + az * a.def.L * ka, qx = b.pos.x + bx * b.def.L * kb, qz = b.pos.z + bz * b.def.L * kb;
      const ex = qx - px, ez = qz - pz, e = Math.hypot(ex, ez), rr = (a.def.W + b.def.W) * 0.5;
      if (e >= rr || e < 1e-3) continue;
      const nx = ex / e, nz = ez / e, pen = rr - e, ma = a.def.mass, mb = b.def.mass;
      a.pos.x -= nx * pen * mb / (ma + mb); a.pos.z -= nz * pen * mb / (ma + mb); b.pos.x += nx * pen * ma / (ma + mb); b.pos.z += nz * pen * ma / (ma + mb);
      const rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
      if (rv < 0) { const j = -1.1 * rv / (1 / ma + 1 / mb); a.vel.x -= nx * j / ma; a.vel.z -= nz * j / ma; b.vel.x += nx * j / mb; b.vel.z += nz * j / mb; }
    }
  }
  for (const t of tanks) {
    t.updateTurret(dt); t.updateSystems(dt); t.applyTransform();
    if (!t.alive && t.burnT > 0) { t.burnT -= dt; if ((t.smokeT -= dt) < 0) { t.smokeT = .12; fxBurn(t.centerPos(new V3()).add(rv(1)), 1.2); } }
  }
  for (const p of planes) { p.physics(dt); p.updateWeapons(dt); p.applyTransform(); }
  updateProjs(dt); updatePopped(dt); updateParts(dt);
  if (state === 'play' || state === 'spawn' || state === 'spectate') updateMatch(dt);
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) flash.intensity = 0; }
}

// ---------- Laço ----------
let last = performance.now();
function frame(ts) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (ts - last) / 1000); last = ts;
  if (paused) dt = 0; else if (state === 'end') dt *= 0.25;
  if (dt > 0 && state !== 'menu') simulate(dt);
  else if (state === 'menu') { updateParts(dt); }
  updateCamera(dt);
  const fx = state === 'menu' ? HANGAR : (player && player.alive ? player.pos : spectate ? spectate.pos : camera.position);
  sun.position.set(fx.x + 120, Math.max(fx.y, 0) + 190, fx.z + 70); sun.target.position.set(fx.x, Math.max(fx.y - 10, 0), fx.z);
  sky.position.copy(camera.position);
  scene.fog.density = lerp(0.00085, 0.00028, clamp((camera.position.y - H(camera.position.x, camera.position.z)) / 700, 0, 1));
  if (eng) {
    const on = player && player.alive && state === 'play' && !paused && player.type !== 'plane';
    eng.g.gain.value = on ? 0.05 + Math.abs(player.throttle) * 0.03 : 0;
    if (on) eng.o.frequency.value = 22 + player.rpm / 60;
    const pl = player && player.alive && player.type === 'plane' && !paused ? player : null;
    let near = pl, nd = 0;
    if (!near) { nd = 1e9; for (const p of planes) { if (!p.alive) continue; const d = p.pos.distanceTo(camera.position); if (d < nd) { nd = d; near = p; } } }
    aeng.g.gain.value = near && !paused && state !== 'menu' ? (pl ? 0.06 : 0.12 / (1 + nd / 120)) * (near.engineOn ? 1 : 0.1) : 0;
    if (near) aeng.o.frequency.value = 45 + near.throttle * 40 + (near.wep ? 8 : 0);
  }
  updateHUD(dt || 0.016); drawScope();
  renderer.render(scene, camera);
}
buildLineup();
requestAnimationFrame(frame);
