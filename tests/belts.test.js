import { describe, it, expect } from 'vitest';
import { GUNS, beltRounds, beltsOf } from '../src/data/vehicles.js';

describe('cintas de munição', () => {
  it('metralhadora não tem explosivo; canhão tem na HEF-I', () => {
    expect(beltRounds(GUNS.M3, 'Padrão').every(r => r.he === 0)).toBe(true);
    const c = beltRounds(GUNS.N37, 'Padrão');
    expect(c.find(r => r.round === 'HEFI').he).toBeCloseTo(GUNS.N37.he);
    expect(c.find(r => r.round === 'APT').he).toBe(0);
  });
  it('traçante só onde o tipo é traçante; cinta desconhecida cai na padrão', () => {
    expect(beltRounds(GUNS.M3, 'Furtiva').some(r => r.tracer)).toBe(false);
    expect(beltRounds(GUNS.M3, 'Traçante').every(r => r.tracer)).toBe(true);
    expect(beltRounds(GUNS.M3, 'xyz').map(r => r.round)).toEqual(beltsOf(GUNS.M3)['Padrão']);
  });
  it('incendiária pega fogo mais que a perfurante', () => {
    const b = beltRounds(GUNS.M3, 'Ar-ar');
    expect(b.find(r => r.round === 'I').inc).toBeGreaterThan(b.find(r => r.round === 'API').inc);
  });
});
