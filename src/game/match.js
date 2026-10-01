import { S, tanks, planes, TICKETS } from '../core/state.js';
import { V3, rand, rv, clamp } from '../core/util.js';
import { POINTS, SPAWN, AIRSPAWN } from '../world/terrain.js';
import { resetTrees, hideCraters } from '../world/scenery.js';
import { VEHICLES } from '../data/vehicles.js';
import { Tank } from '../vehicles/tank.js';
import { Plane } from '../vehicles/plane.js';
import { TankBrain, PlaneBrain } from '../ai/brains.js';
import { clearProjs, clearDebris } from '../combat/ballistics.js';
import { fxBurn, clearParts } from '../fx/particles.js';
import { addFeed, showDmg } from '../ui/hud.js';
import { openSpawn, showEnd } from '../ui/menus.js';
import { cam } from './camera.js';
import { $ } from '../core/util.js';

const NAMES = { 1: ['Sgt. Moura', 'Cb. Teixeira', 'Ten. Barros', 'Sd. Ribeiro'], '-1': ['Ofw. Brandt', 'Ltn. Krause', 'Uffz. Lenz', 'St. Sokolov', 'Sgt. Orlov'] };
const GROUND = ['sherman', 't34', 'pz4', 'tiger'];
let respawns = [], lastPlane = { 1: -999, '-1': -999 }, ticketT = 0;

export function mkWho(name, team, isPlayer) {
  const w = { name, team, isPlayer, kills: 0, airKills: 0, deaths: 0, score: 0, veh: null, v: null };
  S.roster.push(w); return w;
}
export function spawnVehicle(who, key, slot) {
  const D = VEHICLES[key]; let v;
  if (D.type === 'plane') {
    const s = AIRSPAWN[who.team], off = (slot - 2) * 60;
    v = new Plane(key, who.team, who, new V3(s.x + off, s.y + rand(-50, 50), s.z), s.yaw, 125);
    if (!who.isPlayer) v.brain = new PlaneBrain(v);
    lastPlane[who.team] = S.now;
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
  if (!myPlanes && S.now - lastPlane[team] > 75 && S.matchT > 40 && Math.random() < 0.45) return ['p47', 'il2', 'fw190'][Math.floor(Math.random() * 3)];
  return GROUND[Math.floor(Math.random() * GROUND.length)];
}
export function clearWorld() {
  while (tanks.length) tanks[0].remove();
  while (planes.length) planes[0].remove();
  clearProjs(); clearDebris(); clearParts(); respawns = [];
  for (const p of POINTS) { p.owner = 0; p.prog = 0; }
  resetTrees(); hideCraters();
  S.tickets = { 1: TICKETS, '-1': TICKETS }; S.player = null; S.spectate = null; S.roster = []; S.xray = null;
  lastPlane = { 1: -999, '-1': -999 };
  $('#feed').innerHTML = ''; $('#xray').hidden = true;
}
export function startMatch() {
  clearWorld();
  S.stats = { kills: 0, airKills: 0, deaths: 0, shots: 0, hits: 0, pens: 0 }; S.matchT = 0;
  S.me = mkWho('Você', 1, true); S.me.sp = 300; S.me.used = new Set(); S.me.firstSpawn = true;
  NAMES[1].forEach((n, i) => spawnVehicle(mkWho(n, 1, false), GROUND[Math.floor(Math.random() * 4)], i < 2 ? i : i + 1));
  NAMES[-1].forEach((n, i) => spawnVehicle(mkWho(n, -1, false), GROUND[Math.floor(Math.random() * 4)], i));
  S.paused = false;
  $('#caps').innerHTML = POINTS.map(p => `<div class="cap">${p.id}<i></i></div>`).join('');
  openSpawn('Primeiro spawn sem custo. Aviões liberam com SP, ganhos por abates e capturas.');
}
export function spawnPlayer(key) {
  const me = S.me, cost = me.firstSpawn ? 0 : VEHICLES[key].sp;
  if (me.used.has(key) || cost > me.sp) return null;
  me.sp -= cost; me.used.add(key); me.firstSpawn = false;
  S.player = spawnVehicle(me, key, 2);
  return S.player;
}
export function onVehicleDestroyed(v, k, cause) {
  const air = v.type === 'plane';
  S.tickets[v.team] = Math.max(0, S.tickets[v.team] - (air ? 20 : 30));
  if (v.who) v.who.deaths++;
  if (k && k.who) {
    if (air) k.who.airKills++; else k.who.kills++;
    k.who.score += air ? 120 : 150;
    if (k.who === S.me) { S.me.sp += air ? 120 : 150; air ? S.stats.airKills++ : S.stats.kills++; showDmg(`${air ? 'Aeronave derrubada' : 'Veículo destruído'} · +${air ? 120 : 150} SP`, true); }
  }
  addFeed(k, v, cause);
  if (v === S.player) { S.stats.deaths++; cam.sniper = cam.binoc = false; setTimeout(() => { if (S.state === 'play' && S.player === v) openSpawn(deathText(k, cause)); }, 3500); }
  else if (v.who && !v.who.isPlayer) respawns.push({ who: v.who, t: rand(12, 18) });
}
function deathText(k, cause) {
  const why = { ammo: 'Detonação da munição.', crew: 'Tripulação fora de combate.', fire: 'O incêndio tomou o veículo.', pilot: 'Piloto morto.', wing: 'Asa arrancada.', tail: 'Cauda destruída.', structure: 'Estrutura destruída.', crash: 'Colisão com o solo.', overg: 'A asa quebrou por excesso de G.', vne: 'Excesso de velocidade: a estrutura cedeu.', oob: 'Fora da área de combate.', flip: 'Veículo capotado.', bail: 'Veículo abandonado.' }[cause] || 'Veículo perdido.';
  return why + (k ? ` Abatido por ${k.who ? k.who.name : ''} (${k.def.short || k.def.name}).` : '');
}
export function updateMatch(dt) {
  S.matchT += dt;
  for (const p of POINTS) {
    let a = 0, e = 0, meIn = false;
    for (const t of tanks) if (t.alive && Math.hypot(t.pos.x - p.x, t.pos.z - p.z) < p.r) { t.team === 1 ? a++ : e++; if (t === S.player) meIn = true; }
    p.contested = a > 0 && e > 0;
    if (!p.contested && (a || e)) {
      const dir = a ? 1 : -1, n = Math.min(3, a || e), was = p.owner;
      p.prog = clamp(p.prog + dir * n * 0.055 * dt, -1, 1);
      if (p.owner === -dir && p.prog * dir >= 0) p.owner = 0;
      if (Math.abs(p.prog) >= 1) p.owner = Math.sign(p.prog);
      if (p.owner !== was && p.owner === 1 && meIn) { S.me.sp += 100; S.me.score += 100; showDmg(`Ponto ${p.id} capturado · +100 SP`, true); }
    }
    const col = p.owner === 1 ? 0x6db4e3 : p.owner === -1 ? 0xe65a42 : 0xddd6b7;
    p.ring.material.color.setHex(col); p.flag.material.color.setHex(col);
  }
  if ((ticketT += dt) >= 1) {
    ticketT = 0;
    const own = POINTS.reduce((s, p) => s + p.owner, 0);
    if (own > 0) S.tickets[-1] = Math.max(0, S.tickets[-1] - own * 1.5);
    if (own < 0) S.tickets[1] = Math.max(0, S.tickets[1] + own * 1.5);
  }
  for (let i = respawns.length - 1; i >= 0; i--) {
    const r = respawns[i];
    if ((r.t -= dt) <= 0) { respawns.splice(i, 1); spawnVehicle(r.who, botPick(r.who.team), Math.floor(Math.random() * 5)); }
  }
  for (const t of [...tanks]) if (!t.alive && (t.deadT += dt) > 80 && t !== S.player) t.remove();
  for (const p of [...planes]) {
    if (p.returned && p !== S.player) { p.remove(); if (p.who) respawns.push({ who: p.who, t: 8 }); continue; }
    if (p.gone && (p.burnT -= dt) <= 0 && p !== S.player) p.remove();
    else if (p.gone && p.burnT > 0 && Math.random() < dt * 12) fxBurn(p.burnAt.clone().add(rv(2)), 1.4);
  }
  for (const p of planes) if (p.alive && [...tanks, ...planes].some(o => o.alive && o.team !== p.team && o.pos.distanceTo(p.pos) < 2600)) p.spottedUntil = S.now + 2;
  if (S.state === 'spectate' && (!S.spectate || !S.spectate.alive)) S.spectate = tanks.find(t => t.alive && t.team === 1) || planes.find(p => p.alive && p.team === 1) || null;
  if (S.tickets[1] <= 0 || S.tickets[-1] <= 0) showEnd(S.tickets[-1] <= 0);
}
