import { heatLevel } from '../vehicles/engineHeat.js';
import { S, planes } from '../core/state.js';
import { V3, UP, clamp, rand } from '../core/util.js';
import { H } from '../world/terrain.js';
import { G, RHO } from '../data/vehicles.js';
import { AIR } from './aircraft.js';
import { Seeker, leadPoint, energyHeight, fwdOf } from './targeting.js';
import { launchMissile, incomingTo, dropCM } from './missiles.js';
// =====================================================================
// IA de caça. Usa o MESMO instrutor de voo do jogador (steerTo), então
// obedece à física: perde energia em curva, estola, quebra a asa com G.
// Estados: patrulha → perseguição → ataque; defesa (break), evasão de míssil,
// extensão (recupera energia), fuga (danificado). Percebe e perde alvos.
// =====================================================================
export const DIFF = {
  facil: { label: 'Fácil', react: 0.75, aimErr: 0.018, glim: 6, detect: 2200, defend: 0.35, fireRange: 450, jink: false, energy: false, missileP: 0.3 },
  normal: { label: 'Normal', react: 0.4, aimErr: 0.008, glim: 8, detect: 3000, defend: 0.75, fireRange: 600, jink: true, energy: false, missileP: 0.6 },
  dificil: { label: 'Difícil', react: 0.2, aimErr: 0.003, glim: 9.5, detect: 4000, defend: 1, fireRange: 700, jink: true, energy: true, missileP: 1 },
};
const _d = new V3(), _f = new V3(), _r = new V3(), _u = new V3(), _l = new V3(), _a = new V3(), _b = new V3();

export class FighterBrain {
  constructor(p, diffKey = 'normal', opts = {}) {
    this.p = p; this.d = DIFF[diffKey] || DIFF.normal; this.style = (AIR[p.def.key] || {}).ai || 'turn';
    this.role = opts.role || (this.style === 'bomber' ? 'bomber' : 'fighter'); this.goal = opts.goal || null; this.escort = opts.escort || null;
    this.think = Math.random() * this.d.react; this.target = null; this.lostT = 0; this.state = 'patrol'; this.stateT = 0;
    this.err = new V3(); this.jinkT = 0; this.jinkS = Math.random() < .5 ? 1 : -1; this.mslT = rand(3, 6);
    this.home = new V3(p.pos.x * 0.5, p.pos.y, p.pos.z * 0.5); this.patrolA = Math.random() * 6.28;
    // estantes: IR usa o buscador próprio; semiativo (sarh) depende do radar travado
    this.irRack = p.racks.find(r => r.M.seeker !== 'sarh') || null; this.sarhRack = p.racks.find(r => r.M.seeker === 'sarh') || null;
    this.seeker = this.irRack ? new Seeker(this.irRack.M) : null;
    this.threat = null; this.missile = null;
    // decolagem: parado na pista (opts.runway), espera a vez (delay), rola na própria faixa, roda em vr, recolhe o trem e sobe
    this.runway = opts.runway || null; this.takeoff = !!(this.runway && p.onGround); this.toDelay = opts.delay || 0;
    if (this.takeoff) {
      const a = this.runway, D = p.def;
      this.rx = Math.cos(a.yaw); this.rz = -Math.sin(a.yaw); this.lane = (p.pos.x - a.x) * this.rx + (p.pos.z - a.z) * this.rz;
      this.vr = 1.1 * Math.sqrt(2 * D.mass * G / (RHO * D.S * D.clmax)); // ~10% acima do estol limpo
    }
  }
  // fase de decolagem (sem combate): segue o eixo da faixa e só puxa o nariz com velocidade
  takeoffStep(dt) {
    const p = this.p, a = this.runway, fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), dir = _d;
    p.firing = false; p.airbrake = false; p.flapStage = 0;
    const off = (p.pos.x - a.x) * this.rx + (p.pos.z - a.z) * this.rz - this.lane;
    dir.set(fx, 0, fz).addScaledVector(_a.set(this.rx, 0, this.rz), -clamp(off * 0.08, -0.3, 0.3));
    if ((this.toDelay -= dt) > 0) { p.throttle = 0; p.wep = false; dir.y = -0.05; p.steerTo(dir.normalize(), dt, { glim: 3 }); return; }
    p.throttle = 1; p.wep = true;
    const agl = p.pos.y - H(p.pos.x, p.pos.z);
    if (p.onGround) dir.y = p.ias > this.vr ? 0.17 : -0.05;
    else { dir.y = 0.22; if (agl > 25) p.gearCmd = 0; }
    p.steerTo(dir.normalize(), dt, { glim: 3 });
    if ((!p.onGround && agl > 250) || this.stateT > 90) { this.takeoff = false; this.state = 'patrol'; this.stateT = 0; p.gearCmd = 0; }
  }
  // percepção e decisão (em frequência menor que a física)
  decide() {
    const p = this.p, d = this.d;
    p.axes(); fwdOf(p.q, _f);
    // ameaça: inimigo atrás e apontando para mim
    this.threat = null; let td = 1e9;
    for (const e of planes) {
      if (!e.alive || e.team === p.team) continue;
      _r.copy(p.pos).sub(e.pos); const dist = _r.length(); if (dist > 1100) continue;
      _r.divideScalar(dist);
      const behind = _r.dot(_f) > 0.35, aiming = fwdOf(e.q, _a).dot(_r) > 0.94;
      if (behind && aiming && dist < td && Math.random() < d.defend) { td = dist; this.threat = e; }
    }
    // só reage a míssil que consegue perceber: guiamento no RWR, alerta do MAW ou a fumaça à vista
    const m = incomingTo(p); this.missile = m && perceives(p, m) ? m : null;
    // contramedidas: flares contra míssil chegando, chaff quando alguém está colado na cauda
    if (this.missile && this.missile.pos.distanceTo(p.pos) < 2200 && Math.random() < d.missileP) dropCM(p);
    else if (this.threat && p.chaff > 0 && Math.random() < 0.12 * d.missileP) dropCM(p);
    if (this.role === 'bomber') return;
    // chaff do alvo confunde a pontaria (perde o alvo por um instante)
    if (this.target && this.target.chaffUntil > S.now && Math.random() < 0.35) { this.target = null; this.lostT = 0; }
    // alvo: mantém o atual com histerese; senão o mais "barato" (perto e à frente)
    const t = this.target;
    const rd = p.sys.radar && !p.sys.radar.ranging ? p.sys.radar : null;
    if (t && (!t.alive || (t.pos.distanceTo(p.pos) > d.detect * 1.4 && !(rd && rd.contacts.has(t))))) { this.lostT += d.react; if (!t.alive || this.lostT > 3) { this.target = null; this.lostT = 0; } }
    else this.lostT = 0;
    if (!this.target) {
      let best = null, bs = 1e9;
      for (const e of planes) {
        if (!e.alive || e.team === p.team) continue;
        const dist = e.pos.distanceTo(p.pos); if (dist > d.detect && !(rd && rd.contacts.has(e))) continue;
        _r.copy(e.pos).sub(p.pos).divideScalar(dist);
        const sc = dist + (1 - _r.dot(_f)) * 700 - (e.isPlayer ? 150 : 0);
        if (sc < bs) { bs = sc; best = e; }
      }
      if (best) { this.target = best; this.err.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)); }
    }
    // escolta: só se afasta dos bombardeiros quando o inimigo chega perto
    if (this.escort && this.target && this.escort.alive && this.target.pos.distanceTo(this.escort.pos) > 1800) this.target = null;
    this.err.multiplyScalar(0.85).add(_a.set(rand(-.3, .3), rand(-.3, .3), rand(-.3, .3)));
    const hpF = Object.keys(p.hp).reduce((s, k) => s + Math.max(0, p.hp[k]) / p.maxHp[k], 0) / Object.keys(p.hp).length;
    const ammo = p.guns.some(g => g.ammo > 0) || p.missiles > 0;
    // decisão de estado (prioridades)
    let st = 'patrol';
    if (this.missile && this.missile.pos.distanceTo(p.pos) < 2600) st = 'evade';
    else if (this.threat) st = 'defend';
    else if ((hpF < 0.35 || !ammo) && this.target) st = 'flee';
    else if (this.target) {
      const eMine = energyHeight(p.pos.y, p.vel.length()), eTgt = energyHeight(this.target.pos.y, this.target.vel.length());
      if (d.energy && this.state !== 'attack' && eMine < eTgt - 450 && this.target.pos.distanceTo(p.pos) > 900) st = 'extend';
      else if (this.state === 'zoom' && this.stateT < 5) st = 'zoom';
      else st = this.target.pos.distanceTo(p.pos) < 1300 ? 'attack' : 'pursue';
    }
    if (st !== this.state) { this.state = st; this.stateT = 0; }
  }
  update(dt) {
    const p = this.p; if (!p.alive) { p.firing = false; return; }
    this.stateT += dt;
    if ((this.think -= dt) <= 0) { this.think = this.d.react * rand(0.8, 1.2); this.decide(); }
    if (this.takeoff) { this.takeoffStep(dt); return; }
    p.axes(); fwdOf(p.q, _f);
    const d = this.d, dir = _d.set(0, 0, 0); let glim = d.glim, fire = false;
    // WEP só em combate e com o motor frio (acima de ~118 °C ele se degrada)
    p.throttle = 1; p.airbrake = false; p.wep = this.state !== 'patrol' && this.state !== 'pursue' && heatLevel(p.heat, p.cooling) === 0;
    const fwdFlat = _l.set(_f.x, 0, _f.z).normalize();
    const tg = this.target;
    switch (this.role === 'bomber' ? 'bomber' : this.state) {
      case 'bomber': { // segue para o objetivo em linha; se atacado, serpenteia
        const g = this.goal || this.home;
        dir.set(g.x - p.pos.x, (g.y - p.pos.y) * 0.4, g.z - p.pos.z).normalize();
        if (this.threat) { dir.addScaledVector(_a.crossVectors(fwdFlat, UP), Math.sin(S.now * 1.3) * 0.5).normalize(); glim = 4; }
        p.wep = false; glim = Math.min(glim, 4); break;
      }
      case 'evade': { // míssil: curva máxima perpendicular à linha de visada (estoura o gimbal/limite de G)
        const m = this.missile; _r.copy(m.pos).sub(p.pos).normalize();
        _a.crossVectors(_r, UP).normalize(); if (_a.dot(_f) < 0) _a.negate();
        dir.copy(_a).addScaledVector(UP, -0.25).normalize(); glim = p.def.glim - 1; break;
      }
      case 'defend': { // break turn para o lado do atacante; jink inverte o sentido (tesoura)
        const e = this.threat; _r.copy(e.pos).sub(p.pos);
        const side = Math.sign(_r.dot(_u.crossVectors(UP, _f))) || 1;
        if (d.jink && (this.jinkT -= dt) <= 0) { this.jinkT = rand(1.6, 3); if (Math.random() < .45) this.jinkS *= -1; }
        _a.crossVectors(UP, _f).normalize().multiplyScalar(side * (d.jink ? this.jinkS : 1));
        dir.copy(_a).addScaledVector(_f, 0.15).addScaledVector(UP, d.jink ? Math.sin(S.now * 0.9) * 0.4 : 0.1).normalize();
        glim = p.def.glim - 1.5; break;
      }
      case 'flee': { // estende para longe, mergulhando para ganhar velocidade, rumo à base
        _r.copy(p.pos).sub(tg.pos).setY(0).normalize();
        dir.copy(_r).add(_a.copy(this.home).sub(p.pos).setY(0).normalize()).normalize().setY(-0.15).normalize(); glim = 4; break;
      }
      case 'extend': { // energia baixa: descarrega G, ganha velocidade e altitude longe do alvo
        _r.copy(p.pos).sub(tg.pos).setY(0).normalize();
        dir.copy(_r).setY(p.ias < 170 ? -0.1 : 0.25).normalize(); glim = 3; break;
      }
      case 'zoom': { dir.copy(fwdFlat).addScaledVector(UP, 0.9).normalize(); glim = 6; if (p.ias < 110) this.state = 'pursue'; break; }
      case 'pursue': case 'attack': {
        const dist = tg.pos.distanceTo(p.pos), W = p.guns[0].W;
        if (this.state === 'pursue') {
          // aproximação: lag pursuit com vantagem de altura (estilo energia ganha altura antes)
          dir.copy(tg.pos).addScaledVector(tg.vel, -1.2).sub(p.pos).normalize();
          if (this.style === 'boom' && p.pos.y < tg.pos.y + 350 && p.ias > 120) dir.y += 0.25;
          dir.normalize(); glim = Math.min(glim, 6.5);
        } else {
          leadPoint(p.pos, p.vel, tg.pos, tg.vel, W.v, _a);
          _a.addScaledVector(this.err, dist * d.aimErr);
          dir.copy(_a).sub(p.pos).normalize();
          const al = dir.dot(_f);
          fire = dist < d.fireRange && al > Math.cos(Math.max(0.012, 9 / dist));
          // evita ultrapassar: reduz potência e usa freio aéreo se fechando rápido por trás
          const closing = -_r.copy(tg.vel).sub(p.vel).dot(_b.copy(tg.pos).sub(p.pos).normalize());
          if (dist < 320 && closing > 55 && d.energy) { p.throttle = 0.3; p.airbrake = closing > 90; p.wep = false; }
          // passou do alvo: energia (boom) sobe; curva (turn) continua girando
          _b.copy(tg.pos).sub(p.pos).normalize();
          if (this.style === 'boom' && dist < 250 && _b.dot(_f) < 0) { this.state = 'zoom'; this.stateT = 0; }
        }
        // mísseis: travou, distância boa → dispara (com probabilidade pela dificuldade)
        this.mslT -= dt;
        if (this.seeker && this.irRack.n > 0) {
          this.seeker.update(dt, p, [tg], tg, S.now);
          if (this.mslT <= 0 && this.seeker.locked && dist > this.seeker.M.minRange && dist < this.seeker.M.range * 0.8) {
            this.mslT = rand(5, 9); if (Math.random() < d.missileP) launchMissile(p, tg, this.irRack);
          }
        }
        // semiativo: trava o radar no alvo e dispara de mais longe; mantém o nariz no alvo até o impacto
        const rdr = p.sys.radar;
        if (rdr && !rdr.ranging && this.sarhRack) {
          if (rdr.target !== tg && rdr.contacts.has(tg) && dist < rdr.R.range * 0.85) rdr.lock(tg, S.now);
          const M = this.sarhRack.M, flying = this.sarhInFlight && !this.sarhInFlight.dead && this.sarhInFlight.tracking;
          if (!flying && this.sarhRack.n > 0 && this.mslT <= 0 && rdr.locked && rdr.target === tg && dist > M.minRange && dist < M.range * 0.7) {
            this.mslT = rand(6, 10); if (Math.random() < d.missileP) this.sarhInFlight = launchMissile(p, tg, this.sarhRack);
          }
        }
        break;
      }
      default: { // patrulha em círculo largo na altitude de cruzeiro
        this.patrolA += dt * 0.05;
        const wx = this.home.x + Math.cos(this.patrolA) * 1400, wz = this.home.z + Math.sin(this.patrolA) * 1400;
        dir.set(wx - p.pos.x, (Math.max(this.home.y, 1200) - p.pos.y) * 0.3, wz - p.pos.z).normalize(); glim = 4; p.wep = false;
      }
    }
    // evita colisão com outros aviões
    for (const o of planes) {
      if (o === p || !o.alive) continue;
      _r.copy(o.pos).sub(p.pos); const dist = _r.length(); if (dist > 140) continue;
      const closing = -_a.copy(o.vel).sub(p.vel).dot(_r) / dist;
      if (closing > 0 && dist / closing < 2.5) { dir.addScaledVector(_r.normalize(), -1.4).normalize(); fire = false; }
    }
    // solo: altitude mínima para recuperar de mergulho, R = v²/(g(n−1))
    const agl = p.pos.y - H(p.pos.x, p.pos.z), V = p.vel.length(), sinD = clamp(-p.vel.y / Math.max(V, 1), 0, 1);
    const pullAlt = V * V / (G * 4) * (1 - Math.sqrt(1 - sinD * sinD)) + 160;
    if (agl < pullAlt) { dir.copy(fwdFlat).addScaledVector(UP, 1.0).normalize(); glim = Math.max(glim, 7); fire = false; }
    else if (dir.y < 0 && agl < 450) dir.y *= 0.2;
    // limite do mapa
    const lim = (S.airLimit || 4000) - 500;
    if (Math.max(Math.abs(p.pos.x), Math.abs(p.pos.z)) > lim) dir.set(-p.pos.x, 0, -p.pos.z).normalize().addScaledVector(UP, .15).normalize();
    p.firing = fire;
    p.steerTo(dir, dt, { glim: Math.min(glim, p.def.glim - 1) });
  }
}
// a IA sabe do míssil pelos MESMOS sistemas do jogador ou vendo a fumaça (motor aceso / perto)
function perceives(p, m) {
  const s = p.sys;
  if (s.maw && s.maw.list.some(x => x.m === m)) return true;
  if (s.rwr && s.rwr.list.some(t => t.lvl === 'GUIDANCE' && t.e === m.owner)) return true;
  const d = m.pos.distanceTo(p.pos);
  return d < 900 || (d < 1800 && m.t < m.M.burn + 1.5);
}
