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
  it('só o F-86 leva mísseis', () => {
    expect(PLANES.f86.missiles.w).toBe('AIM9B');
    expect(PLANES.mig15.missiles).toBeUndefined();
  });
});
