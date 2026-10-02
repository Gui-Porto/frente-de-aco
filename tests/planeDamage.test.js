import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/combat/ballistics.js', () => ({ segBox: () => null }));
vi.mock('../src/fx/particles.js', () => ({ fxExplosion() {} }));
vi.mock('../src/ui/hud.js', () => ({ showDmg() {} }));
vi.mock('../src/core/state.js', () => ({ S: { now: 0 } }));
const { planeModules, applyMod, powered, ctrlAuthority, fuelInit, fuelStep, fuelLeak, modsOf } = await import('../src/vehicles/planeDamage.js');
const { PLANES } = await import('../src/data/vehicles.js');

// avião mínimo para os módulos (sem física nem modelo)
const mk = key => {
  const D = PLANES[key], pl = { def: D, mods: planeModules(D), wingOn: { L: true, R: true }, sys: {}, guns: D.guns.map(g => ({ pts: g.span.flatMap(s => (g.n > 1 ? [[s], [-s]] : [[s]])) })), ail: 0, elev: 0, rud: 0, damage() {}, ignite() {} };
  fuelInit(pl, 1000); return pl;
};
const kill = (pl, n) => applyMod(pl, pl.mods[n], 999, null, null);

describe('peças reais por aeronave', () => {
  it('Spitfire e Fw 190 não têm tanque na asa; F-86, F-4E e MiG-21 têm', () => {
    for (const k of ['spit9', 'fw190', 'p47', 'mig15']) expect(modsOf(mk(k), 'fuel').every(m => Math.abs(m.c[0]) < PLANES[k].fuseR)).toBe(true);
    for (const k of ['f86', 'f4e', 'mig21']) expect(modsOf(mk(k), 'fuel').some(m => m.c[0] > PLANES[k].fuseR)).toBe(true);
  });
  it('F-4E tem dois motores; Spitfire tem um radiador em cada asa; P-47 tem turbo', () => {
    expect(modsOf(mk('f4e'), 'engine').length).toBe(2);
    expect(modsOf(mk('spit9'), 'cool').map(m => Math.sign(m.c[0])).sort()).toEqual([-1, 1]);
    expect(mk('p47').mods.turbo).toBeTruthy();
  });
  it('superfícies de comando ficam no bordo de fuga, aileron por fora do flap', () => {
    for (const k of Object.keys(PLANES)) {
      const M = mk(k).mods, D = PLANES[k];
      expect(M.ailL.c[0]).toBeGreaterThan(M.flapL.c[0]);
      expect(M.ailR.c[0]).toBeLessThan(0);
      expect(M.flapL.c[2]).toBeLessThan(D.wingZ + D.chord * 0.35);
      expect(M.rud.c[1]).toBeGreaterThan(D.fuseR * 0.6);
    }
  });
});

describe('efeitos', () => {
  it('flaps do Spitfire são pneumáticos: sem o sistema, travam e as armas não disparam', () => {
    const pl = mk('spit9');
    expect(powered(pl, 'flaps') && powered(pl, 'guns')).toBe(true);
    kill(pl, 'pneu');
    expect(powered(pl, 'flaps') || powered(pl, 'guns')).toBe(false);
  });
  it('F-4E só perde os comandos com PC-1 e PC-2 destruídos', () => {
    const pl = mk('f4e'), a0 = ctrlAuthority(pl).elev;
    kill(pl, 'pc1'); expect(ctrlAuthority(pl).elev).toBe(a0);
    kill(pl, 'pc2'); expect(ctrlAuthority(pl).elev).toBeLessThan(a0 * 0.2);
  });
  it('furo num tanque esvazia só aquele tanque', () => {
    const pl = mk('f86'), t = pl.mods.fuelWL, other = pl.mods.fuelF;
    applyMod(pl, t, 5, null, null);
    expect(fuelLeak(pl)).toBeGreaterThan(0);
    const o0 = other.left;
    for (let i = 0; i < 2000; i++) fuelStep(pl, 0, 0.1);
    expect(t.left).toBe(0); expect(other.left).toBeCloseTo(o0); expect(fuelLeak(pl)).toBe(0);
  });
  it('arma destruída de um lado mantém os canos do outro', () => {
    const pl = mk('p47');
    kill(pl, 'gun0L');
    expect(pl.guns[0].pts.length).toBe(4);
    expect(pl.guns[0].pts.every(q => q[0] < 0)).toBe(true);
  });
  it('aileron destruído trava na deflexão em que estava', () => {
    const pl = mk('fw190'); pl.ail = 0.8;
    kill(pl, 'ailL');
    expect(pl.mods.ailL.stuck).toBeCloseTo(0.48);
  });
});
