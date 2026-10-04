import { describe, it, expect } from 'vitest';
import { PLANES } from '../src/data/vehicles.js';

const JETS = ['f86', 'mig15', 'mig21', 'f4e'];
describe('detalhes do modelo dos jatos (dados)', () => {
  it('os quatro jatos continuam no roster e têm bocal descrito', () => {
    for (const k of JETS) { expect(PLANES[k], k).toBeTruthy(); expect(PLANES[k].nozzle, k).toBeTruthy(); }
  });
  it('pós-combustão (pétalas) só em quem tem PC: MiG-21 e F-4E', () => {
    expect(PLANES.mig21.nozzle.petals).toBeGreaterThan(8); expect(PLANES.f4e.nozzle.petals).toBeGreaterThan(8);
    expect(PLANES.f86.nozzle.petals).toBeUndefined(); expect(PLANES.mig15.nozzle.petals).toBeUndefined();
  });
  it('F-4E tem dois tripulantes em ordem, dentro da capota', () => {
    const s = PLANES.f4e.canopy.seats;
    expect(s).toHaveLength(2); expect(s[0]).toBeLessThan(s[1]);
    for (const t of s) { expect(t).toBeGreaterThan(0.2); expect(t).toBeLessThan(0.85); }
  });
  it('tanques externos: estação na asa válida ou posição ventral dentro da fuselagem', () => {
    for (const k of JETS) for (const T of PLANES[k].drops || []) {
      if (T.belly != null) { expect(Math.abs(T.belly) * PLANES[k].L + T.len / 2).toBeLessThan(PLANES[k].L * 0.5); }
      else { expect(T.ws).toBeGreaterThan(0.1); expect(T.ws).toBeLessThan(0.95); }
      expect(T.d).toBeLessThan(T.len / 3);
    }
  });
  it('antenas com tipo conhecido e posição no corpo', () => {
    for (const k of JETS) for (const A of PLANES[k].antennas || []) {
      expect(['blade', 'whip', 'mast', 'rods']).toContain(A.k);
      expect(Math.abs(A.zf)).toBeLessThan(0.5);
      expect([1, -1]).toContain(A.ay);
    }
  });
});
