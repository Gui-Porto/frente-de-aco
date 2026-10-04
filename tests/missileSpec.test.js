import { describe, it, expect } from 'vitest';
import { MISSILES } from '../src/data/vehicles.js';
import { smokeOf, boostGain, missileSheet } from '../src/air/missileSpec.js';

describe('ficha e motor dos mísseis', () => {
  it('todo míssil tem medidas de modelo coerentes com o comprimento e o diâmetro', () => {
    for (const M of Object.values(MISSILES)) {
      const F = M.form;
      expect(F, M.short).toBeTruthy();
      expect(F.nose.kind).toBe(M.seeker === 'sarh' ? 'ogive' : 'ir');
      for (const k of ['canards', 'wings', 'tails']) if (F[k]) {
        expect(F[k].at + F[k].root, `${M.short} ${k}`).toBeLessThanOrEqual(M.len + 1e-9);
        expect(F[k].span / 2, `${M.short} ${k}`).toBeGreaterThan(M.d / 2);
        expect(F[k].tip).toBeLessThan(F[k].root);
      }
      for (const b of Object.values(F.bands)) expect(b.at + b.w).toBeLessThan(M.len);
      expect(F.bands.warhead.at).toBeLessThan(F.bands.motor.at); // ogiva à frente do motor
    }
  });
  it('AIM-9/R-3 têm canards e rollerons; o Sparrow tem asas no meio e aletas traseiras', () => {
    for (const k of ['AIM9B', 'AIM9J', 'R3S', 'R3R']) { expect(MISSILES[k].form.canards).toBeTruthy(); expect(MISSILES[k].form.wings.roller).toBeGreaterThan(0); }
    const S = MISSILES.AIM7E.form;
    expect(S.canards).toBeUndefined();
    expect(S.wings.at).toBeGreaterThan(MISSILES.AIM7E.len * 0.25);
    expect(S.wings.at).toBeLessThan(MISSILES.AIM7E.len * 0.6);
    expect(S.tails.at + S.tails.root).toBeCloseTo(MISSILES.AIM7E.len, 1);
  });
  it('ganho de velocidade positivo e plausível (centenas de m/s)', () => {
    for (const M of Object.values(MISSILES)) {
      const g = boostGain(M);
      expect(g, M.short).toBeGreaterThan(200);
      expect(g, M.short).toBeLessThan(M.thrust * M.burn / M.mass);
    }
  });
  it('fumaça proporcional: Sparrow mais grossa que Sidewinder; AIM-9B na escala base', () => {
    const a = smokeOf(MISSILES.AIM9B), s = smokeOf(MISSILES.AIM7E);
    expect(a.w0).toBeCloseTo(1.8, 5); expect(a.w1).toBeCloseTo(14, 5);
    expect(s.w1).toBeGreaterThan(a.w1 * 1.3); expect(s.flame).toBeGreaterThan(a.flame);
  });
  it('ficha traz buscador, alcances, G, queima, ganho, ogiva e trava', () => {
    const rows = Object.fromEntries(missileSheet(MISSILES.AIM9B));
    expect(Object.keys(rows)).toEqual(['Buscador', 'Alcance', 'Manobra', 'Queima', 'Ganho de velocidade', 'Ogiva', 'Trava']);
    expect(rows.Buscador).toMatch(/Infravermelho.*cauda/);
    expect(rows.Alcance).toMatch(/250.*4\.600/);
    expect(rows.Trava).toBe('0,9 s');
    expect(Object.fromEntries(missileSheet(MISSILES.AIM7E)).Trava).toMatch(/STT/);
  });
});
