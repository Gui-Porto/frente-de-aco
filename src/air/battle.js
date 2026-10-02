import { S, planes } from '../core/state.js';
import { V3, rand, rv, clamp } from '../core/util.js';
import { Plane } from '../vehicles/plane.js';
import { mkWho, clearWorld } from '../game/match.js';
import { destroyVehicle } from '../combat/ballistics.js';
import { fxBurn, fxExplosion, spawnP, TEX } from '../fx/particles.js';
import { addFeed, showDmg, flashVign, shakeCam } from '../ui/hud.js';
import { AIR, ENEMY_POOL, ALLY_POOL, ARENA } from './aircraft.js';
import { MODES } from './missions.js';
import { FighterBrain } from './ai.js';
import { Seeker, LOCK } from './targeting.js';
import { launchMissile, updateMissiles, clearMissiles, dropCM, missiles } from './missiles.js';
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
export const RADAR_MODE = { SRCH: 'busca', ACM: 'combate (ACM)', STT: 'rastreio', OFF: 'desligado', RNG: 'telemétrico' };
export function career() { try { return Object.assign({ xp: 0, battles: 0, wins: 0, kills: 0 }, JSON.parse(localStorage.getItem(SAVE) || '{}')); } catch (e) { return { xp: 0, battles: 0, wins: 0, kills: 0 }; } }
export const levelOf = xp => Math.floor(Math.sqrt(xp / 150)) + 1;

export const B = {
  cfg: null, mode: null, obj: null, player: null, t: 0, phase: 'idle', stats: null, result: null,
  weapon: 1, seeker: null, marked: null, downT: 0, prevFire: false, nameI: { 1: 0, '-1': 0 },
  // ---------- spawn ----------
  spawnOne(key, team, i, n, o = {}) {
    const A = this.arena, side = team === 1 ? 1 : -1, z = o.z ?? side * A.spawnZ, y = (o.y ?? A.alt) + i * 25 + rand(-40, 40);
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
  crit(t) { this.critLog.push({ t, at: S.now }); if (this.critLog.length > 4) this.critLog.shift(); this.flash('ACERTO CRÍTICO', 2); },
  // mensagem grande de acerto no centro (como "Hit / Critical hit / Shot down" do WT); só sobe de nível
  hitMsg: null, hitT: -9, hitBig: false, hurtT: -9, hurtK: 0, hurtFrom: new V3(),
  flash(t, lvl) { const m = this.hitMsg; if (m && S.now - m.at < 0.9 && m.lvl > lvl) return; this.hitMsg = { t, lvl, at: S.now }; },
  // ---------- ciclo ----------
  start(cfg) {
    clearWorld(); clearMissiles();
    this.cfg = cfg; this.arena = ARENA[AIR[cfg.plane].era] || ARENA.jato;
    S.mode = 'air'; S.airLimit = this.arena.limit; S.air = this; this.mode = MODES[cfg.mode]; this.t = 0; this.phase = 'battle'; this.result = null; this.downT = 0; this.nameI = { 1: 0, '-1': 0 };
    this.stats = { kills: 0, assists: 0, dmgDealt: 0, dmgTaken: 0, missiles: 0, deaths: 0 };
    applyEnv(cfg.weather, cfg.time);
    S.me = mkWho('Você', 1, true); S.me.assists = 0;
    const p = new Plane(cfg.plane, 1, S.me, new V3(0, this.arena.alt + 50, this.arena.spawnZ), Math.PI, PLANE_V(cfg.plane), { ord: false });
    p.dmgBy = new Map(); S.me.veh = cfg.plane; S.me.v = p;
    this.player = S.player = p;
    this.seeker = null; this.syncSeeker();
    this.weapon = 1; this.marked = null; this.critLog = []; this.hitMsg = null; this.hitT = this.hurtT = -9; this.hurtK = 0;
    this.obj = this.mode.create(this); this.obj.setup(this);
    S.state = 'play'; S.paused = false; S.matchT = 0;
    resetAirCam(Math.PI);
  },
  onDamage(v, dmg, by) {
    if (!v.dmgBy) return;
    if (by && by.team !== v.team) { const e = v.dmgBy.get(by) || { dmg: 0, t: 0 }; e.dmg += dmg; e.t = S.now; v.dmgBy.set(by, e); }
    if (by === this.player && v.team !== 1) { this.stats.dmgDealt += dmg; this.hitT = S.now; this.hitBig = dmg > 6; this.flash('ACERTO', dmg > 6 ? 1 : 0); }
    if (v === this.player) {
      this.stats.dmgTaken += dmg; acam.hit = Math.min(1, acam.hit + dmg / 20); shakeCam(Math.min(0.6, dmg / 25));
      this.hurtT = S.now; this.hurtK = Math.min(1, (this.hurtT - (this.hurtPrev || -9) < 0.5 ? this.hurtK || 0 : 0) + 0.25 + dmg / 15); this.hurtPrev = S.now;
      if (by && by.pos) this.hurtFrom.copy(by.pos); else this.hurtFrom.copy(v.pos);
    }
  },
  onDestroyed(v, k, cause) {
    if (v.who) v.who.deaths++;
    if (k && k.who) { k.who.airKills++; k.who.score += 100; }
    for (const [pl, e] of v.dmgBy || []) {
      if (pl === k || S.now - e.t > 30 || !pl.who) continue;
      pl.who.assists = (pl.who.assists || 0) + 1; pl.who.score += 40;
      if (pl === this.player) { this.stats.assists++; showDmg('Assistência · +40', true); }
    }
    if (k === this.player) { this.stats.kills++; showDmg(`${v.def.short || v.def.name} derrubado · +100`, true); this.flash('ABATIDO', 3); }
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
      this.avionicsInput(p, c);
      pilot(p, c, cam.aimDir, dt);
      p.firing = c.fire;
      if (c.cm) { if (dropCM(p)) this.stats.cm = (this.stats.cm || 0) + 1; else if (!p.flares && !p.chaff) toast('Sem contramedidas', 1200); }
      if (c.ext && !p.extinguish()) toast(p.fire > 0 ? 'Extintor já usado' : 'Sem incêndio', 1200);
      // buscador sempre ligado enquanto houver míssil (o tom avisa); prioriza o alvo marcado (T)
      if (this.seeker && p.missiles > 0) this.seeker.update(dt, p, planes, this.marked, S.now); else if (this.seeker) { this.seeker.state = LOCK.OFF; this.seeker.target = null; }
      if (c.missile && p.missiles > 0) this.fireMissile(p);
      else if (c.missile) toast(p.racks.length ? 'Mísseis esgotados' : 'Esta aeronave não leva mísseis', 1600);
    } else if (p) { p.firing = false; }
    updateMissiles(dt);
    this.updateAvionics(dt);
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
  // ---------- armas e aviônicos do jogador ----------
  // buscador IR existe só quando a estante selecionada é infravermelha (o semiativo usa o radar)
  syncSeeker() {
    const r = this.player && this.player.rack;
    if (!r || r.M.seeker === 'sarh') this.seeker = null;
    else if (!this.seeker || this.seeker.M !== r.M) this.seeker = new Seeker(r.M);
  },
  avionicsInput(p, c) {
    const rd = p.sys.radar;
    if (c.wsel && p.racks.length) { const r = p.cycleRack(); this.syncSeeker(); toast(r ? `${r.M.short} · ${r.M.seeker === 'sarh' ? 'semiativo (radar)' : 'infravermelho'} · ${r.n}` : 'Sem mísseis', 1400); }
    if (!rd || rd.ranging) { if (c.rmode || c.rlock) toast(rd ? `${rd.R.name}: só telemétrico de mira` : 'Esta aeronave não tem radar', 1400); return; }
    if (c.rmode) { const m = rd.cycleMode(); toast(`Radar: ${RADAR_MODE[m]}`, 1200); }
    if (c.rlock) {
      if (rd.mode === 'STT') rd.drop('unlock');
      else {
        // trava no alvo marcado se ele for contato; senão no contato hostil mais perto do nariz
        let best = this.marked && rd.contacts.has(this.marked) ? this.marked : null, bs = 1e9;
        if (!best) for (const [e, k] of rd.contacts) { if (k.iff === 'ally') continue; const sc = Math.hypot(k.az, k.el) * 4 + k.r / 10000; if (sc < bs) { bs = sc; best = e; } }
        if (!best || !rd.lock(best, S.now)) toast(rd.on ? 'Radar: nenhum contato para travar' : 'Radar desligado', 1200);
      }
    }
  },
  fireMissile(p) {
    const r = p.rack, rd = p.sys.radar;
    let tg = null;
    if (r.M.seeker === 'sarh') {
      if (!rd || !rd.locked || !rd.target) return toast(`${r.M.short} precisa do radar travado no alvo`, 1600);
      tg = rd.target;
      const d = tg.pos.distanceTo(p.pos);
      if (d > r.M.range) return toast(`Fora de alcance (${(d / 1000).toFixed(1).replace('.', ',')} km)`, 1400);
    } else tg = this.seeker && this.seeker.locked ? this.seeker.target : null;
    if (launchMissile(p, tg, r)) { this.stats.missiles++; if (!tg) toast('Míssil sem trava: voo balístico', 1600); this.syncSeeker(); }
  },
  // radar/RWR/MAW de todas as aeronaves (cada sistema tem a própria taxa interna)
  updateAvionics(dt) {
    for (const q of planes) {
      const s = q.sys; if (!s || q.gone) continue;
      if (s.radar) s.radar.update(dt, q, planes, S.now);
      if (s.rwr) s.rwr.update(dt, q, planes, S.now);
      if (s.maw) s.maw.update(dt, q, missiles, S.now);
      // eventos só interessam ao jogador (som/HUD); nos outros não podem acumular
      if (q !== this.player) for (const k in s) s[k].events.length = 0;
      else for (const k in s) if (s[k].events.length > 40) s[k].events.splice(0, s[k].events.length - 40);
    }
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
