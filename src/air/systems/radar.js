import { V3, clamp } from '../../core/util.js';
import { RADARS } from './avionics.js';
// =====================================================================
// Radar de bordo como SISTEMA da aeronave (jogador e IA usam o mesmo).
// Busca (SRCH): a antena varre o azimute de verdade; um alvo só é
// atualizado quando o feixe passa por ele (o contato "pula" a cada
// varredura) e some se ficar sem eco por algumas varreduras.
// Combate (ACM): cone estreito à frente, trava sozinho no primeiro eco.
// Rastreio (STT): antena presa no alvo, atualiza todo tick; quebra fora do
// gimbal/alcance, com chaff ou clutter de solo (alvo baixo, olhando para baixo).
// Telemétrico (RNG): só mede a distância de quem está no cone de mira.
// Tudo que a antena ilumina fica em `paint` — é o que o RWR do outro ouve.
// Ângulos: az > 0 = à direita do nariz; el > 0 = acima; quadro estabilizado
// em rolagem (como uma antena real), tomado a partir do rumo/arfagem do nariz.
// =====================================================================
const DEG = Math.PI / 180, TICK = 1 / 20;
const _f = new V3(), _d = new V3();
const wrap = a => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);

// geometria do alvo em relação ao nariz do dono (r, az, el em rad; losEl = elevação absoluta)
export function losAngles(owner, tpos, out = {}) {
  _f.set(0, 0, 1).applyQuaternion(owner.q);
  const hdg = Math.atan2(_f.x, _f.z), pit = Math.asin(clamp(_f.y, -1, 1));
  _d.copy(tpos).sub(owner.pos); const r = Math.max(_d.length(), 1e-3);
  const th = Math.atan2(_d.x, _d.z), te = Math.asin(clamp(_d.y / r, -1, 1));
  out.r = r; out.az = wrap(hdg - th); out.el = te - pit; out.losEl = te;
  return out;
}
const _g = {};

export class Radar {
  // agl(x, z): altura do terreno (clutter); opcional nos testes
  constructor(id, agl = null) {
    this.id = id; this.R = RADARS[id]; if (!this.R) throw new Error(`radar desconhecido: ${id}`);
    this.ranging = this.R.kind === 'ranging';
    this.mode = this.ranging ? 'RNG' : 'SRCH'; this.on = true;
    this.beam = -(this.R.azLim || 0) * DEG; this.dir = 1;
    this.contacts = new Map();          // alvo → contato {pos, vel, t, r, az, el, alt, closure, iff}
    this.paint = new Map();             // alvo → instante em que o feixe passou por ele
    this.target = null; this.lockT = 0; this.locked = false; this.range = 0;
    this.guideUntil = -1; this.guideTgt = null; // mísseis semiativos guiados por este radar
    this.events = []; this.acc = Math.random() * TICK; this.agl = agl;
  }
  // tempo de uma varredura completa (ida); o RWR usa para manter o "SEARCH" entre passagens
  get period() { const a = this.mode === 'ACM' ? this.R.acm.az : this.R.azLim; return this.ranging ? TICK : 2 * a / this.R.scanRate; }
  get azLim() { return (this.mode === 'ACM' ? this.R.acm.az : this.R.azLim) * DEG; }
  get elLim() { return (this.mode === 'ACM' ? this.R.acm.el : this.R.elLim) * DEG; }
  get maxRange() { return this.mode === 'ACM' ? this.R.acm.range : this.R.range; }
  get modes() { return this.ranging ? ['RNG'] : this.R.acm ? ['SRCH', 'ACM', 'OFF'] : ['SRCH', 'OFF']; }
  setMode(m) {
    if (this.dead && m !== 'OFF') return; // radar destruído pelo dano
    if (this.mode === 'STT') this.drop('unlock');
    this.mode = m; this.on = m !== 'OFF'; this.beam = -this.azLim; this.dir = 1;
    if (!this.on) { this.contacts.clear(); this.paint.clear(); }
  }
  cycleMode() { const ms = this.modes, cur = this.mode === 'STT' ? 'SRCH' : this.mode; this.setMode(ms[(ms.indexOf(cur) + 1) % ms.length]); return this.mode; }
  // trava num contato recente (jogador escolhe pelo contato; IA pelo alvo que já persegue)
  lock(e, now) {
    if (this.ranging || !this.on || !e || !e.alive) return false;
    const c = this.contacts.get(e); if (!c || now - c.t > this.memory) return false;
    this.mode = 'STT'; this.target = e; this.lockT = 0; this.locked = false; this.events.push({ k: 'track', e });
    return true;
  }
  drop(why = 'lost') {
    if (this.target && this.mode === 'STT') this.events.push({ k: why, e: this.target });
    this.target = null; this.locked = false; this.lockT = 0;
    if (this.mode === 'STT') { this.mode = this.prevMode || 'SRCH'; this.beam = -this.azLim; }
  }
  // troca de alvo: próximo contato não aliado em azimute (esquerda → direita) depois de `cur`, dando a volta; null se não há outro
  next(cur) {
    const L = [...this.contacts].filter(([e, k]) => e !== cur && e.alive && k.iff !== 'ally').sort((a, b) => a[1].az - b[1].az);
    const c = cur && this.contacts.get(cur), ca = c ? c.az : -Infinity;
    return (L.find(([, k]) => k.az > ca) || L[0] || [null])[0];
  }
  get memory() { return this.ranging ? 0.3 : this.period * 2.2 + 0.5; }
  // alcance de detecção contra este alvo agora (RCS, clutter)
  detRange(owner, e, g) {
    let R = this.maxRange * Math.pow((e.def && e.def.rcs || 5) / 5, 0.25);
    if (this.agl && g.losEl < -3 * DEG && e.pos.y - this.agl(e.pos.x, e.pos.z) < 1500) R *= this.R.lookDown;
    return R;
  }
  update(dt, owner, list, now) {
    this.acc += dt; if (this.acc < TICK) return; const h = this.acc; this.acc = 0;
    if (!this.on || !owner.alive) { if (this.target) this.drop('lost'); this.contacts.clear(); return; }
    if (this.ranging) return this.rangeOnly(owner, list, now);
    if (this.mode === 'STT') return this.track(h, owner, now);
    // varredura: o feixe vai e volta; o intervalo varrido neste tick é [b0, b1] ± meio feixe
    const lim = this.azLim, b0 = this.beam;
    this.beam += this.dir * this.R.scanRate * DEG * h;
    if (this.beam > lim) { this.beam = lim; this.dir = -1; } else if (this.beam < -lim) { this.beam = -lim; this.dir = 1; }
    const half = this.R.beam * DEG / 2, lo = Math.min(b0, this.beam) - half, hi = Math.max(b0, this.beam) + half;
    for (const e of list) {
      if (e === owner || !e.alive) continue;
      const g = losAngles(owner, e.pos, _g);
      if (g.r > this.R.range * 2 || Math.abs(g.el) > this.elLim + half || g.az < lo || g.az > hi) continue;
      this.paint.set(e, now);
      const R = this.detRange(owner, e, g), pd = g.r < R * 0.8 ? 0.95 : g.r < R ? 0.6 : 0;
      if (Math.random() < pd) this.see(owner, e, g, now);
    }
    for (const [e, c] of this.contacts) if (!e.alive || now - c.t > this.memory) { this.contacts.delete(e); this.events.push({ k: 'drop', e }); }
    for (const [e, t] of this.paint) if (now - t > 5) this.paint.delete(e);
    // ACM: trava sozinho no eco mais próximo dentro do cone
    if (this.mode === 'ACM') {
      let best = null, bd = 1e9;
      for (const [e, c] of this.contacts) if (c.iff !== 'ally' && c.r < bd) { bd = c.r; best = e; }
      if (best) { this.prevMode = 'ACM'; this.lock(best, now); }
    } else this.prevMode = 'SRCH';
  }
  see(owner, e, g, now) {
    let c = this.contacts.get(e);
    if (!c) { c = { pos: new V3(), vel: new V3(), t: 0 }; this.contacts.set(e, c); this.events.push({ k: 'contact', e }); }
    c.pos.copy(e.pos); c.vel.copy(e.vel); c.t = now; c.r = g.r; c.az = g.az; c.el = g.el; c.alt = e.pos.y;
    _d.copy(e.pos).sub(owner.pos).divideScalar(g.r);
    c.closure = -_f.copy(e.vel).sub(owner.vel).dot(_d);
    c.iff = this.R.iff ? (e.team === owner.team ? 'ally' : 'hostile') : 'unknown';
  }
  track(h, owner, now) {
    const e = this.target, R = this.R;
    if (!e || !e.alive) return this.drop('lost');
    const g = losAngles(owner, e.pos, _g), gl = R.gimbal * DEG;
    let ok = Math.abs(g.az) < gl && Math.abs(g.el) < gl && g.r < this.detRange(owner, e, g) * 1.15;
    if (ok && e.chaffUntil > now && Math.random() < h * 1.5 * R.chaffSus) ok = false;
    if (ok && this.agl && g.losEl < -3 * DEG && e.pos.y - this.agl(e.pos.x, e.pos.z) < 300 && Math.random() < h * 0.6) ok = false;
    if (!ok) return this.drop('lost');
    this.paint.set(e, now); this.see(owner, e, g, now);
    this.lockT += h;
    if (!this.locked && this.lockT >= R.lockT) { this.locked = true; this.events.push({ k: 'lock', e }); }
  }
  rangeOnly(owner, list, now) {
    let best = null, ba = 1e9;
    for (const e of list) {
      if (e === owner || !e.alive || e.team === owner.team) continue;
      const g = losAngles(owner, e.pos, _g); if (g.r > this.R.range) continue;
      const off = Math.hypot(g.az, g.el); if (off > this.R.cone * DEG) continue;
      if (off < ba) { ba = off; best = e; this.range = g.r; }
    }
    if (best !== this.target) this.events.push({ k: best ? 'lock' : 'lost', e: best || this.target });
    this.target = best; this.locked = !!best; if (best) this.paint.set(best, now); else this.range = 0;
  }
  // este radar está iluminando `e` para um míssil semiativo agora?
  guiding(e, now) { return this.guideUntil > now && this.guideTgt === e && this.target === e && this.locked; }
}
