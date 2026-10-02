import { V3, clamp } from '../../core/util.js';
import { RWRS, MAWS, THREAT } from './avionics.js';
import { losAngles } from './radar.js';
// =====================================================================
// Receptor de alerta radar (RWR) e alerta de aproximação de míssil (MAW).
// O RWR só sabe o que o RADAR DO OUTRO está fazendo com você:
//  SEARCH   — o feixe de busca passa por você (intermitente)
//  TRACK    — antena presa em você, ainda travando
//  LOCK     — travado (rastreio contínuo / telêmetro de mira)
//  GUIDANCE — iluminação para míssil semiativo em voo (só RWR que distingue)
// Direção vem quantizada pela resolução do aparelho (quadrante no SPO-10)
// com um erro fixo por emissor; tipo só se o emissor estiver na biblioteca.
// O MAW vê o míssil em si (pluma UV ou eco Doppler), não o radar.
// =====================================================================
const DEG = Math.PI / 180, TICK = 1 / 10, _g = {};
const LEVELS = Object.keys(THREAT);

export class Rwr {
  constructor(id) {
    this.id = id; this.W = RWRS[id]; if (!this.W) throw new Error(`RWR desconhecido: ${id}`);
    this.threats = new Map(); this.list = []; this.events = []; this.acc = Math.random() * TICK;
  }
  update(dt, owner, list, now) {
    this.acc += dt; if (this.acc < TICK) return; this.acc = 0;
    const W = this.W, seen = new Set();
    if (owner.alive) for (const e of list) {
      const rd = e.sys && e.sys.radar;
      if (!rd || !rd.on || !e.alive || e.team === owner.team) continue;
      let lvl = null;
      if (rd.target === owner && (rd.mode === 'STT' || rd.mode === 'RNG')) lvl = W.guidance && rd.guiding(owner, now) ? 'GUIDANCE' : rd.locked ? 'LOCK' : 'TRACK';
      else { const t = rd.paint.get(owner); if (t !== undefined && now - t < rd.period * 1.3 + 0.3) lvl = 'SEARCH'; }
      if (!lvl) continue;
      const g = losAngles(owner, e.pos, _g), hear = (rd.ranging ? rd.R.range * 1.5 : rd.R.range) * W.sens;
      if (g.r > hear) continue;
      seen.add(e);
      let th = this.threats.get(e);
      if (!th) { th = { e, bias: (Math.random() - 0.5) * W.res * 0.4 * DEG, lvl: null }; this.threats.set(e, th); }
      const step = W.res * DEG, az = g.az + th.bias;
      // só quadrante (centro a ±45°/±135°) ou setor de `res` graus
      th.az = W.res >= 90 ? (az >= 0 ? 1 : -1) * (Math.abs(az) < Math.PI / 2 ? 45 : 135) * DEG : Math.round(az / step) * step;
      th.strength = clamp(1 - g.r / hear, 0.05, 1);
      th.type = W.lib ? (W.lib[rd.id] || 'U') : null;
      th.r = g.r; th.t = now;
      if (th.lvl !== lvl) { this.events.push({ k: !th.lvl ? 'new' : THREAT[lvl] > THREAT[th.lvl] ? 'up' : 'down', lvl, th }); th.lvl = lvl; }
    }
    for (const [e, th] of this.threats) if (!seen.has(e)) { this.threats.delete(e); this.events.push({ k: 'lost', lvl: th.lvl, th }); }
    this.list = [...this.threats.values()].sort((a, b) => THREAT[b.lvl] - THREAT[a.lvl] || b.strength - a.strength);
  }
  get top() { return this.list[0] || null; }
}
export { LEVELS };

export class Maw {
  constructor(id) { this.id = id; this.W = MAWS[id]; if (!this.W) throw new Error(`MAW desconhecido: ${id}`); this.list = []; this.events = []; this.known = new Set(); this.acc = Math.random() * TICK; }
  // missiles: [{pos, vel, t, M:{burn}, owner:{team}, dead}]
  update(dt, owner, missiles, now) {
    this.acc += dt; if (this.acc < TICK) return; this.acc = 0;
    const out = [], W = this.W, d = new V3();
    if (owner.alive) for (const m of missiles) {
      if (m.dead || m.owner.team === owner.team) continue;
      const g = losAngles(owner, m.pos, _g); if (g.r > W.range) continue;
      if (W.kind === 'uv' && m.t > m.M.burn) continue;           // sem pluma, o UV não vê
      d.copy(owner.pos).sub(m.pos).divideScalar(g.r);
      const closing = d.dot(m.vel) - d.dot(owner.vel); if (closing < 30) continue;
      out.push({ m, az: g.az, el: g.el, r: g.r, tti: g.r / closing });
      if (!this.known.has(m)) { this.known.add(m); this.events.push({ k: 'launch', m }); }
    }
    for (const m of this.known) if (m.dead || !out.some(o => o.m === m)) this.known.delete(m);
    this.list = out.sort((a, b) => a.tti - b.tti);
  }
}
