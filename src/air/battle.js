import { S, planes } from '../core/state.js';
import { V3, rand, rv, clamp } from '../core/util.js';
import { Plane } from '../vehicles/plane.js';
import { MISSILES } from '../data/vehicles.js';
import { mkWho, clearWorld } from '../game/match.js';
import { destroyVehicle } from '../combat/ballistics.js';
import { fxBurn, fxExplosion, spawnP, TEX } from '../fx/particles.js';
import { addFeed, showDmg, flashVign, shakeCam } from '../ui/hud.js';
import { AIR, ENEMY_POOL, ALLY_POOL } from './aircraft.js';
import { MODES } from './missions.js';
import { FighterBrain } from './ai.js';
import { Seeker, LOCK } from './targeting.js';
import { launchMissile, updateMissiles, clearMissiles, dropCM } from './missiles.js';
import { readInput, pilot } from './input.js';
import { applyEnv, updateEnv } from './environment.js';
import { acam, resetAirCam } from './camera.js';
import { showResult, toast } from './screens.js';
import { cam } from '../game/camera.js';
// =====================================================================
// BattleManager: estados da batalha, equipes, objetivo, estatísticas,
// colisões entre aeronaves, armas do jogador e fim de partida.
// =====================================================================
const NAMES = { 1: ['Ten. Barros', 'Cap. Moura', 'Sgt. Teixeira', 'Ten. Lima', 'Sgt. Ribeiro', 'Cb. Prado'], '-1': ['Hptm. Brandt', 'Ltn. Krause', 'Kpt. Orlov', 'Lt. Sokolov', 'Ofw. Lenz', 'Maj. Volkov', 'Ltn. Hahn', 'Kpt. Belov', 'Uffz. Roth'] };
const SAVE = 'fda.air.v1';
export function career() { try { return Object.assign({ xp: 0, battles: 0, wins: 0, kills: 0 }, JSON.parse(localStorage.getItem(SAVE) || '{}')); } catch (e) { return { xp: 0, battles: 0, wins: 0, kills: 0 }; } }
export const levelOf = xp => Math.floor(Math.sqrt(xp / 150)) + 1;

export const B = {
  cfg: null, mode: null, obj: null, player: null, t: 0, phase: 'idle', stats: null, result: null,
  weapon: 1, seeker: null, marked: null, downT: 0, prevFire: false, nameI: { 1: 0, '-1': 0 },
  // ---------- spawn ----------
  spawnOne(key, team, i, n, o = {}) {
    const side = team === 1 ? 1 : -1, z = o.z ?? side * 2700, y = (o.y ?? 1600) + i * 25 + rand(-40, 40);
    const x = (i - (n - 1) / 2) * 130 + rand(-20, 20), yaw = side > 0 ? Math.PI : 0;
    const names = NAMES[team], who = mkWho(names[this.nameI[team]++ % names.length], team, false);
    const p = new Plane(key, team, who, new V3(x, y, z + Math.abs(i - (n - 1) / 2) * 60 * side), yaw, PLANE_V(key), { ord: !!o.ord });
    p.brain = new FighterBrain(p, this.cfg.diff, o); p.dmgBy = new Map();
    who.veh = key; who.v = p; who.assists = 0;
    return p;
  },
  spawnTeam(team, n, o = {}) {
    const era = AIR[this.cfg.plane].era, pool = team === 1 ? ALLY_POOL[era] : ENEMY_POOL[era];
    const out = [], off = team === 1 ? 1 : 0; // aliados abrem espaço no centro para o jogador
    for (let i = 0; i < n; i++) {
      const slot = team === 1 ? (i < Math.ceil(n / 2) ? i : i + off) : i;
      const key = this.cfg.enemyPlane && team === -1 ? this.cfg.enemyPlane : pool[Math.floor(Math.random() * pool.length)];
      out.push(this.spawnOne(key, team, slot, team === 1 ? n + 1 : n, o));
    }
    return out;
  },
  toast(t) { toast(t); },
  // acertos críticos do jogador ("Tanque perfurado", "Piloto ferido"…), mostrados perto do retículo
  critLog: [],
  crit(t) { this.critLog.push({ t, at: S.now }); if (this.critLog.length > 4) this.critLog.shift(); },
  // ---------- ciclo ----------
  start(cfg) {
    clearWorld(); clearMissiles();
    S.mode = 'air'; S.airLimit = 4200; S.air = this;
    this.cfg = cfg; this.mode = MODES[cfg.mode]; this.t = 0; this.phase = 'battle'; this.result = null; this.downT = 0; this.nameI = { 1: 0, '-1': 0 };
    this.stats = { kills: 0, assists: 0, dmgDealt: 0, dmgTaken: 0, missiles: 0, deaths: 0 };
    applyEnv(cfg.weather, cfg.time);
    S.me = mkWho('Você', 1, true); S.me.assists = 0;
    const p = new Plane(cfg.plane, 1, S.me, new V3(0, 1650, 2700), Math.PI, PLANE_V(cfg.plane), { ord: false });
    p.dmgBy = new Map(); S.me.veh = cfg.plane; S.me.v = p;
    this.player = S.player = p;
    this.seeker = p.def.missiles ? new Seeker(MISSILES[p.def.missiles.w]) : null;
    this.weapon = 1; this.marked = null; this.critLog = [];
    this.obj = this.mode.create(this); this.obj.setup(this);
    S.state = 'play'; S.paused = false; S.matchT = 0;
    resetAirCam(Math.PI);
  },
  onDamage(v, dmg, by) {
    if (!v.dmgBy) return;
    if (by && by.team !== v.team) { const e = v.dmgBy.get(by) || { dmg: 0, t: 0 }; e.dmg += dmg; e.t = S.now; v.dmgBy.set(by, e); }
    if (by === this.player && v.team !== 1) this.stats.dmgDealt += dmg;
    if (v === this.player) { this.stats.dmgTaken += dmg; acam.hit = Math.min(1, acam.hit + dmg / 20); shakeCam(Math.min(0.6, dmg / 25)); }
  },
  onDestroyed(v, k, cause) {
    if (v.who) v.who.deaths++;
    if (k && k.who) { k.who.airKills++; k.who.score += 100; }
    for (const [pl, e] of v.dmgBy || []) {
      if (pl === k || S.now - e.t > 30 || !pl.who) continue;
      pl.who.assists = (pl.who.assists || 0) + 1; pl.who.score += 40;
      if (pl === this.player) { this.stats.assists++; showDmg('Assistência · +40', true); }
    }
    if (k === this.player) { this.stats.kills++; showDmg(`${v.def.short || v.def.name} derrubado · +100`, true); }
    addFeed(k, v, cause);
    // explosão no ar quando a estrutura cede (o resto cai em chamas até o solo)
    if (cause === 'structure' || cause === 'wing' || cause === 'tail' || cause === 'fire') {
      fxExplosion(v.pos.clone(), 1.4);
      for (let i = 0; i < 14; i++) spawnP({ pos: v.pos.clone(), vel: rv(25).add(v.vel), life: rand(1, 2.2), size: .6, size1: .2, tex: TEX.fire, add: true, color: 0xff9a40, grav: 9.8, drag: .25 });
    }
    v.fire = Math.max(v.fire, 0.01);
    if (v === this.player) { this.stats.deaths++; this.downT = 3; flashVign(); }
  },
  update(dt) {
    if (this.phase !== 'battle') return;
    this.t += dt; S.matchT = this.t;
    const p = this.player;
    // jogador: comando → avião
    if (p && p.alive && S.state === 'play') {
      const c = readInput();
      if (c.cam) acam.mode = (acam.mode + 1) % 4;
      if (!this.marked || !this.marked.alive) this.marked = this.bestTarget();
      if (c.target) { this.cycleTarget(); if (this.seeker) this.seeker.reset(); toast(`Alvo: ${this.marked ? this.marked.def.short : '—'}`, 1200); }
      pilot(p, c, cam.aimDir, dt);
      p.firing = c.fire;
      if (c.cm) { if (dropCM(p)) this.stats.cm = (this.stats.cm || 0) + 1; else if (!p.flares && !p.chaff) toast('Sem contramedidas', 1200); }
      if (c.ext && !p.extinguish()) toast(p.fire > 0 ? 'Extintor já usado' : 'Sem incêndio', 1200);
      // buscador sempre ligado enquanto houver míssil (o tom avisa); prioriza o alvo marcado (T)
      if (this.seeker && p.missiles > 0) this.seeker.update(dt, p, planes, this.marked, S.now); else if (this.seeker) { this.seeker.state = LOCK.OFF; this.seeker.target = null; }
      if (c.missile && p.missiles > 0) {
        const tg = this.seeker && this.seeker.locked ? this.seeker.target : null;
        if (launchMissile(p, tg)) { this.stats.missiles++; if (!tg) toast('Míssil sem trava: voo balístico', 1600); }
      }
    } else if (p) { p.firing = false; }
    updateMissiles(dt);
    this.collisions();
    updateEnv(dt);
    // destroços queimando caem e somem
    for (const q of [...planes]) {
      if (q.gone && (q.burnT -= dt) <= 0 && q !== p) q.remove();
      else if (q.gone && q.burnT > 0 && Math.random() < dt * 10) fxBurn(q.burnAt.clone().add(rv(2)), 1.4);
    }
    // jogador abatido: assiste aos aliados ou termina
    if (p && !p.alive && this.downT > 0 && (this.downT -= dt) <= 0) {
      const ally = planes.find(q => q.alive && q.team === 1);
      if (ally && this.mode.allies) { S.state = 'spectate'; S.spectate = ally; toast('Você foi abatido · assistindo à esquadrilha (T troca, Esc sai)'); }
      else return this.finish({ win: false, why: 'Você foi abatido.' });
    }
    if (S.state === 'spectate') {
      if (!S.spectate || !S.spectate.alive) S.spectate = planes.find(q => q.alive && q.team === 1) || S.spectate;
      if (readInput().target) { const al = planes.filter(q => q.alive && q.team === 1); S.spectate = al[(al.indexOf(S.spectate) + 1) % al.length] || S.spectate; }
    }
    const r = this.obj.update(this, dt);
    if (r) this.finish(r);
  },
  // ---------- alvo marcado (lead, distância, seta) ----------
  bestTarget() {
    const p = this.player; let best = null, bs = 1e9; const f = cam.aimDir;
    for (const e of planes) {
      if (!e.alive || e.team === p.team) continue;
      const d = e.pos.distanceTo(p.pos), a = Math.acos(clamp(e.pos.clone().sub(p.pos).divideScalar(d).dot(f), -1, 1));
      const s = d * (0.4 + a); if (s < bs) { bs = s; best = e; }
    }
    return best;
  },
  cycleTarget() {
    const en = planes.filter(e => e.alive && e.team !== 1).sort((a, b) => a.pos.distanceTo(this.player.pos) - b.pos.distanceTo(this.player.pos));
    if (en.length) this.marked = en[(en.indexOf(this.marked) + 1) % en.length];
  },
  // ---------- colisão entre aeronaves (as balas e mísseis já colidem por conta própria) ----------
  collisions() {
    const L = planes.filter(q => q.alive);
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j], r = (a.def.span + b.def.span) * 0.32;
      if (Math.abs(a.pos.x - b.pos.x) > r || Math.abs(a.pos.y - b.pos.y) > r || Math.abs(a.pos.z - b.pos.z) > r || a.pos.distanceTo(b.pos) > r) continue;
      fxExplosion(a.pos.clone().lerp(b.pos, .5), 1.6);
      for (const x of [a, b]) { x.lastHitBy = null; x.breakWing(Math.random() < .5 ? 'L' : 'R', 'wing'); if (x.alive) destroyVehicle(x, null, 'crash'); }
    }
  },
  finish(r) {
    if (this.phase !== 'battle') return;
    this.phase = 'over'; this.result = r;
    S.state = 'end';
    const p = this.player, st = this.stats;
    st.shots = p ? p.shotsN : 0; st.hits = p ? p.hitsN : 0; st.time = this.t;
    st.ammoUsed = p ? p.guns.reduce((s, g) => s + g.max - g.ammo, 0) : 0;
    st.score = Math.round(st.kills * 100 + st.assists * 40 + st.dmgDealt * 1.5 + (r.win ? 250 : 0) + (st.shots ? 100 * st.hits / st.shots : 0));
    const c = career(), lv0 = levelOf(c.xp);
    st.xp = Math.round(st.score * ({ facil: 0.7, normal: 1, dificil: 1.4 }[this.cfg.diff] || 1));
    c.xp += st.xp; c.battles++; c.wins += r.win ? 1 : 0; c.kills += st.kills;
    try { localStorage.setItem(SAVE, JSON.stringify(c)); } catch (e) { /* sem armazenamento */ }
    st.level = levelOf(c.xp); st.levelUp = st.level > lv0; st.career = c;
    setTimeout(() => showResult(this), 2200);
  },
  stop() { this.phase = 'idle'; clearMissiles(); clearWorld(); S.air = null; S.mode = 'ground'; S.airLimit = 0; this.player = null; },
};
// velocidade inicial: perto do cruzeiro de cada avião
function PLANE_V(key) { const A = AIR[key]; return (A ? A.cruise : 450) / 3.6 * 0.85; }
