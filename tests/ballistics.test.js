import { describe, it, expect } from 'vitest';
import { TANKS, PLANES, ballistic, penAt, hePen, prepAmmo } from '../src/data/vehicles.js';

describe('balística das munições', () => {
  const am = TANKS.tiger.gun.ammo[0];
  it('a granada cai mais e chega mais devagar quanto maior a distância', () => {
    const a = ballistic(am, 200), b = ballistic(am, 1000);
    expect(b.ang).toBeGreaterThan(a.ang);
    expect(b.v).toBeLessThan(a.v);
    expect(b.t).toBeGreaterThan(a.t);
  });
  it('na boca do cano a perfuração é a nominal', () => {
    expect(penAt(am, am.v)).toBeCloseTo(am.pen, 5);
  });
  it('a perfuração cai com a velocidade (De Marre, expoente 1,43)', () => {
    const v = ballistic(am, 1000).v;
    expect(penAt(am, v)).toBeCloseTo(am.pen * Math.pow(v / am.v, 1.43), 5);
    expect(penAt(am, v)).toBeLessThan(am.pen);
  });
  it('APCR perde perfuração mais rápido que APHE com a distância', () => {
    const he = TANKS.sherman.gun.ammo[0], cr = TANKS.sherman.gun.ammo[1];
    const r = d => penAt(cr, ballistic(cr, d).v) / cr.pen - penAt(he, ballistic(he, d).v) / he.pen;
    expect(r(1500)).toBeLessThan(0);
  });
  it('queda a 1000 m do 88 mm fica entre 0,1° e 1°', () => {
    const deg = ballistic(am, 1000).ang * 180 / Math.PI;
    expect(deg).toBeGreaterThan(0.1); expect(deg).toBeLessThan(1);
  });
});

describe('explosivos', () => {
  it('perfuração de HE cresce com a carga e é ~74 mm para uma bomba de 500 lb', () => {
    expect(hePen(0.39)).toBeLessThan(hePen(0.86));
    expect(hePen(121)).toBeGreaterThan(70); expect(hePen(121)).toBeLessThan(80);
  });
  it('bombas e foguetes têm tabela balística preparada', () => {
    const b = prepAmmo({ m: 227, d: 0.36, v: 200, type: 'BOMB' }, 360, 0.22);
    expect(b.k).toBeGreaterThan(0); expect(b.tab.length).toBeGreaterThan(10);
    expect(PLANES.p47.bombs[0].name).toMatch(/500 lb/);
  });
});
