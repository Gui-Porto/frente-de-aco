import { describe, it, expect } from 'vitest';
import { Vector3, Quaternion } from 'three';
import { Seeker, LOCK, pnAccel, leadPoint, energyHeight, seekerAngle } from '../src/air/targeting.js';
import { MISSILES, PLANES } from '../src/data/vehicles.js';

const M = MISSILES.AIM9B;
const ac = (x, y, z, yaw = 0, team = 1) => ({ pos: new Vector3(x, y, z), q: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), team, alive: true, vel: new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(200) });

describe('buscador infravermelho', () => {
  it('trava pela cauda após o tempo de aquisição', () => {
    const me = ac(0, 1000, 0), tg = ac(0, 1000, 1500, 0, -1), s = new Seeker(M);
    expect(s.update(0.1, me, [tg])).toBe(LOCK.TRACK);
    for (let i = 0; i < 20; i++) s.update(0.1, me, [tg]);
    expect(s.state).toBe(LOCK.LOCKED);
    expect(s.target).toBe(tg);
  });
  it('não trava de frente (aspecto traseiro)', () => {
    const me = ac(0, 1000, 0), tg = ac(0, 1000, 1500, Math.PI, -1), s = new Seeker(M);
    for (let i = 0; i < 20; i++) s.update(0.1, me, [tg]);
    expect(s.state).toBe(LOCK.SEARCH);
  });
  it('perde o alvo quando ele sai do gimbal', () => {
    const me = ac(0, 1000, 0), tg = ac(0, 1000, 1500, 0, -1), s = new Seeker(M);
    for (let i = 0; i < 20; i++) s.update(0.1, me, [tg]);
    tg.pos.set(1500, 1000, 200); // ~82° fora do eixo
    expect(s.update(0.1, me, [tg])).toBe(LOCK.LOST);
  });
  it('ignora aliados e alvos fora de alcance', () => {
    const me = ac(0, 1000, 0);
    expect(seekerAngle(me.pos, new Vector3(0, 0, 1), ac(0, 1000, 9000, 0, -1), M, 10)).toBe(-1);
    const s = new Seeker(M); s.update(0.1, me, [ac(0, 1000, 1500, 0, 1)]);
    expect(s.state).toBe(LOCK.SEARCH);
  });
});

describe('navegação proporcional', () => {
  it('alvo cruzando para a esquerda gera aceleração para a esquerda', () => {
    const a = new Vector3();
    pnAccel(new Vector3(0, 0, 0), new Vector3(0, 0, 500), new Vector3(0, 0, 2000), new Vector3(200, 0, 0), 4, a);
    expect(a.x).toBeGreaterThan(0);
    expect(Math.abs(a.y)).toBeLessThan(1e-6);
  });
  it('colisão em rota (linha de visada parada) não pede manobra', () => {
    const a = new Vector3();
    pnAccel(new Vector3(0, 0, 0), new Vector3(0, 0, 500), new Vector3(0, 0, 2000), new Vector3(0, 0, -100), 4, a);
    expect(a.length()).toBeLessThan(1e-6);
  });
});

describe('mira com avanço e energia', () => {
  it('o ponto de avanço fica à frente do alvo no sentido do movimento relativo', () => {
    const out = new Vector3();
    const t = leadPoint(new Vector3(0, 0, 0), new Vector3(0, 0, 150), new Vector3(0, 0, 400), new Vector3(150, 0, 150), 870, out, 0);
    expect(t).toBeGreaterThan(0.4); expect(t).toBeLessThan(0.6);
    expect(out.x).toBeCloseTo(150 * t, 1);
  });
  it('altura de energia soma a energia cinética', () => {
    expect(energyHeight(1000, 0)).toBe(1000);
    expect(energyHeight(0, 100)).toBeCloseTo(509.7, 1);
  });
});

describe('dados das aeronaves', () => {
  it('jatos têm empuxo e caças a pistão têm potência', () => {
    for (const k of ['f86', 'mig15']) { expect(PLANES[k].jet).toBe(true); expect(PLANES[k].thrust).toBeGreaterThan(20); }
    for (const k of ['spit9', 'p47', 'fw190']) expect(PLANES[k].hp).toBeGreaterThan(1000);
  });
  it('mísseis por estante: F-86 só IR; MiG-15 nenhum; F-4E e MiG-21 com semiativo + IR', () => {
    expect(PLANES.f86.missiles.map(r => r.w)).toEqual(['AIM9B']);
    expect(PLANES.mig15.missiles).toBeUndefined();
    for (const k of ['f4e', 'mig21']) expect(PLANES[k].missiles.map(r => MISSILES[r.w].seeker).sort()).toEqual(['ir', 'sarh']);
  });
  it('sistemas só onde existem historicamente', () => {
    expect(PLANES.f86.rwr).toBeUndefined(); expect(PLANES.mig15.rwr).toBeUndefined();
    expect(PLANES.f4e.rwr).toBe('apr36'); expect(PLANES.mig21.rwr).toBe('spo10');
    expect(PLANES.spit9.radar).toBeUndefined();
  });
});

import { stepHeat, heatLevel } from '../src/vehicles/engineHeat.js';
describe('temperatura do motor (água → óleo → desgaste)', () => {
  const run = (kind, thr, wep, ias, secs) => { const e = { water: 85, oil: 70 }; let wear = 0; for (let t = 0; t < secs; t += 0.1) wear += stepHeat(e, kind, thr, wep, ias, false, 0.1); return { e, wear }; };
  it('100% em cruzeiro rápido não desgasta', () => {
    expect(run('liquid', 1, false, 120, 600).wear).toBe(0);
    expect(run('radial', 1, false, 120, 600).wear).toBe(0);
  });
  it('WEP nivelado rápido aguenta 2 min sem estragar o motor', () => {
    expect(run('liquid', 1, true, 120, 120).wear).toBeLessThan(0.05);
  });
  it('WEP subindo devagar: água esquenta antes do óleo e o motor acaba danificado', () => {
    const a = run('liquid', 1, true, 65, 30);
    expect(heatLevel(a.e, 'liquid')).toBeGreaterThan(0);
    expect(a.e.water - 115).toBeGreaterThan(a.e.oil - 95); // água passa do limite primeiro
    expect(run('liquid', 1, true, 65, 300).wear).toBeGreaterThan(1);
  });
});
