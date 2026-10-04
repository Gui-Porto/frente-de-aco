import { describe, it, expect } from 'vitest';
import { Vector3, Quaternion } from 'three';
import { Radar, losAngles } from '../src/air/systems/radar.js';
import { Rwr, Maw } from '../src/air/systems/rwr.js';

// avião mínimo: nariz em +z (yaw 0); az > 0 = à direita (−x)
const ac = (x, y, z, team = 1, yaw = 0, rcs = 5) => ({ pos: new Vector3(x, y, z), vel: new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(250), q: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), team, alive: true, def: { rcs }, sys: {} });
const run = (s, fn, dt = 1 / 60) => { let t = 0; for (; t < s; t += dt) fn(dt, t); };

describe('geometria', () => {
  it('az positivo à direita, el positivo acima', () => {
    const me = ac(0, 1000, 0), g = losAngles(me, new Vector3(-1000, 1000, 1000));
    expect(g.az).toBeCloseTo(Math.PI / 4, 3);
    expect(losAngles(me, new Vector3(0, 2000, 1000)).el).toBeGreaterThan(0);
  });
});

describe('radar de busca', () => {
  it('só detecta dentro do volume de varredura e do alcance', () => {
    const me = ac(0, 3000, 0), front = ac(0, 3000, 10000, -1), side = ac(-10000, 3000, 0, -1), far = ac(0, 3000, 40000, -1);
    const r = new Radar('rp22'); let now = 0;
    run(4, dt => { now += dt; r.update(dt, me, [front, side, far], now); });
    expect(r.contacts.has(front)).toBe(true);
    expect(r.contacts.has(side)).toBe(false); // 90° fora dos ±30°
    expect(r.contacts.has(far)).toBe(false);
  });
  it('contato só atualiza quando o feixe passa (posição fica velha entre varreduras)', () => {
    const me = ac(0, 3000, 0), e = ac(0, 3000, 8000, -1), r = new Radar('rp22'); let now = 0, last = -1, passes = 0;
    run(5, dt => { now += dt; e.pos.z += 200 * dt; r.update(dt, me, [e], now); const c = r.contacts.get(e); if (c && c.t !== last) { if (c.t - last > 0.3) passes++; last = c.t; } });
    // ~0,86 s por varredura: em 5 s, ~5 passagens do feixe, não 300 quadros de atualização
    expect(passes).toBeGreaterThan(2); expect(passes).toBeLessThan(8);
  });
  it('alvo pequeno é detectado mais perto (RCS)', () => {
    const r = new Radar('rp22'), me = ac(0, 3000, 0), g = losAngles(me, new Vector3(0, 3000, 1000));
    expect(r.detRange(me, ac(0, 0, 0, -1, 0, 1), g)).toBeLessThan(r.detRange(me, ac(0, 0, 0, -1, 0, 10), g));
  });
  it('clutter: olhando para baixo contra alvo rente ao solo o alcance despenca', () => {
    const r = new Radar('rp22', () => 0), me = ac(0, 5000, 0), low = ac(0, 300, 8000, -1);
    expect(r.detRange(me, low, losAngles(me, low.pos))).toBeLessThan(r.detRange(me, ac(0, 5000, 8000, -1), losAngles(me, new Vector3(0, 5000, 8000))) * 0.5);
  });
  it('STT: trava após lockT, perde fora do gimbal e volta a buscar', () => {
    const me = ac(0, 3000, 0), e = ac(0, 3000, 6000, -1), r = new Radar('apq120'); let now = 0;
    run(3, dt => { now += dt; r.update(dt, me, [e], now); });
    expect(r.lock(e, now)).toBe(true);
    run(0.6, dt => { now += dt; r.update(dt, me, [e], now); }); expect(r.locked).toBe(false);
    run(1, dt => { now += dt; r.update(dt, me, [e], now); }); expect(r.locked).toBe(true);
    e.pos.set(-6000, 3000, -1000); // atrás e ao lado
    run(0.2, dt => { now += dt; r.update(dt, me, [e], now); });
    expect(r.mode).toBe('SRCH'); expect(r.events.some(x => x.k === 'lost')).toBe(true);
  });
  it('trocar alvo: próximo contato da esquerda p/ direita, dá a volta, pula aliado', () => {
    const me = ac(0, 3000, 0), l = ac(3000, 3000, 8000, -1), m = ac(0, 3000, 8000, -1), rt = ac(-3000, 3000, 8000, -1), al = ac(-1500, 3000, 8000, 1);
    const r = new Radar('apq120'); let now = 0;
    run(3, dt => { now += dt; r.update(dt, me, [l, m, rt, al], now); });
    expect(r.next(null)).toBe(l);
    expect(r.next(l)).toBe(m);
    expect(r.next(m)).toBe(rt);
    expect(r.next(rt)).toBe(l);
    r.contacts.delete(m); r.contacts.delete(rt);
    expect(r.next(l)).toBe(null);
  });
  it('não trava em quem não é contato', () => {
    const r = new Radar('apq120'); expect(r.lock(ac(0, 0, 5000, -1), 0)).toBe(false);
  });
  it('ACM trava sozinho no cone à frente', () => {
    const me = ac(0, 3000, 0), e = ac(0, 3100, 3000, -1), r = new Radar('apq120'); let now = 0;
    r.setMode('ACM');
    run(1.5, dt => { now += dt; r.update(dt, me, [e], now); });
    expect(r.target).toBe(e);
  });
  it('telemétrico mede distância só no cone de mira', () => {
    const me = ac(0, 1000, 0), e = ac(0, 1000, 1500, -1), r = new Radar('apg30');
    r.update(0.1, me, [e], 0); expect(r.range).toBeCloseTo(1500, 0);
    e.pos.set(-800, 1000, 1500); r.update(0.1, me, [e], 0.1); expect(r.target).toBe(null);
  });
});

describe('RWR', () => {
  const setup = (rwrId, radarId = 'apq120') => {
    const me = ac(0, 3000, 0, 1), e = ac(0, 3000, 9000, -1, Math.PI); // inimigo à frente, de frente
    e.sys.radar = new Radar(radarId); const rw = new Rwr(rwrId); let now = 0;
    const step = s => run(s, dt => { now += dt; e.sys.radar.update(dt, e, [me], now); rw.update(dt, me, [e], now); });
    return { me, e, rw, step, now: () => now };
  };
  it('busca → SEARCH; travando → TRACK; travado → LOCK; míssil guiado → GUIDANCE; some → perdido', () => {
    const s = setup('apr36');
    s.step(3); expect(s.rw.top.lvl).toBe('SEARCH');
    expect(s.e.sys.radar.lock(s.me, s.now())).toBe(true);
    s.step(0.3); expect(s.rw.top.lvl).toBe('TRACK');
    s.step(1.5); expect(s.rw.top.lvl).toBe('LOCK');
    s.e.sys.radar.guideUntil = s.now() + 10; s.e.sys.radar.guideTgt = s.me;
    s.step(0.3); expect(s.rw.top.lvl).toBe('GUIDANCE');
    expect(s.rw.events.map(x => x.k)).toContain('up');
    s.e.sys.radar.setMode('OFF'); s.step(0.3);
    expect(s.rw.top).toBe(null); expect(s.rw.events.some(x => x.k === 'lost')).toBe(true);
  });
  it('direção aproximada: ameaça à frente aparece perto de 0°, tipo pela biblioteca', () => {
    const s = setup('apr36'); s.step(3);
    expect(Math.abs(s.rw.top.az)).toBeLessThan(20 * Math.PI / 180);
    expect(s.rw.top.type).toBe('F4');
  });
  it('SPO-10 só dá quadrante, não identifica e não distingue guiamento', () => {
    const s = setup('spo10'); s.step(3);
    expect(Math.abs(Math.abs(s.rw.top.az) - Math.PI / 4)).toBeLessThan(1e-6);
    expect(s.rw.top.type).toBe(null);
    s.e.sys.radar.lock(s.me, s.now()); s.step(2);
    s.e.sys.radar.guideUntil = s.now() + 10; s.e.sys.radar.guideTgt = s.me; s.step(0.3);
    expect(s.rw.top.lvl).toBe('LOCK');
  });
  it('aliado não acende o RWR', () => {
    const me = ac(0, 3000, 0, 1), f = ac(0, 3000, 9000, 1, Math.PI); f.sys.radar = new Radar('apq120');
    const rw = new Rwr('apr36'); let now = 0;
    run(3, dt => { now += dt; f.sys.radar.update(dt, f, [me], now); rw.update(dt, me, [f], now); });
    expect(rw.list.length).toBe(0);
  });
});

describe('MAW', () => {
  const msl = (z, t, owner) => ({ pos: new Vector3(0, 3000, z), vel: new Vector3(0, 0, 600), t, M: { burn: 2.5 }, owner, dead: false });
  it('UV vê o lançamento com o motor aceso; não vê míssil planando', () => {
    const me = ac(0, 3000, 0), foe = { team: -1 }, mw = new Maw('uv');
    const a = msl(-4000, 1, foe), b = msl(-3000, 5, foe);
    mw.update(0.2, me, [a, b], 0);
    expect(mw.list.map(x => x.m)).toEqual([a]);
    expect(mw.events[0].k).toBe('launch');
  });
  it('Doppler vê o míssil depois da queima e ignora os do próprio time', () => {
    const me = ac(0, 3000, 0), mw = new Maw('pd');
    mw.update(0.2, me, [msl(-3000, 5, { team: -1 }), msl(-2000, 1, { team: 1 })], 0);
    expect(mw.list.length).toBe(1);
  });
});
