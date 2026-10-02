import { describe, it, expect } from 'vitest';
import { ENGINES, EngineSet, spoolTime } from '../src/air/systems/engine.js';
import { isa } from '../src/air/systems/atmosphere.js';

const run = (es, s, thr, boost = false, alt = 0, V = 200) => { const a = isa(alt); a.alt = alt; let t = 0; for (; t < s; t += 1 / 120) { es.step(1 / 120, thr, boost, 1, true); es.force(V, a, V / a.a); } return es; };

describe('atmosfera ISA', () => {
  it('nível do mar e tropopausa', () => {
    expect(isa(0).rho).toBeCloseTo(1.225, 2);
    expect(isa(0).a).toBeCloseTo(340.3, 0);
    expect(isa(11000).a).toBeCloseTo(295.1, 0);
    expect(isa(11000).rho).toBeCloseTo(0.364, 2);
  });
});

describe('turbojato', () => {
  it('tempos de spool batem com a ficha de cada motor', () => {
    for (const E of Object.values(ENGINES).filter(e => e.kind === 'turbojet')) {
      expect(Math.abs(spoolTime(E, true) - E.spoolUp)).toBeLessThan(0.1);
      expect(Math.abs(spoolTime(E, false) - E.spoolDn)).toBeLessThan(0.1);
    }
  });
  it('desacelera mais rápido do que acelera', () => {
    for (const E of Object.values(ENGINES).filter(e => e.kind === 'turbojet')) expect(spoolTime(E, false)).toBeLessThan(spoolTime(E, true));
  });
  it('perto do máximo responde rápido (85% → 100% da manete em < 1,6 s)', () => {
    const es = run(new EngineSet('j47'), 8, 0.85), f0 = es.output;
    run(es, 1.6, 1);
    expect(es.output).toBeGreaterThan(0.94);
    expect(f0).toBeLessThan(0.75);
  });
  it('resposta não-linear: o primeiro segundo saindo da marcha lenta rende pouco empuxo', () => {
    const es = run(new EngineSet('j47'), 10, 0);
    run(es, 1, 1);
    expect(es.output).toBeLessThan(0.3);
  });
  it('motor diferente responde diferente', () => {
    const a = run(run(new EngineSet('j47'), 10, 0), 3, 1).output, b = run(run(new EngineSet('r13'), 10, 0), 3, 1).output;
    expect(b).toBeGreaterThan(a);
  });
  it('pós-combustão: só com manete cheia, liga e corta na hora', () => {
    const es = run(new EngineSet('j79', 2), 10, 1);
    const mil = es.thrust;
    run(es, 1 / 120, 1, true); expect(es.ab).toBe(1);
    expect(es.thrust / mil).toBeGreaterThan(1.4);
    expect(es.flow).toBeGreaterThan(3 * 2 * 52.8 * 0.086 / 3.6 * 0.9); // consumo dispara
    run(es, 1 / 120, 1, false); expect(es.ab).toBe(0);
  });
  it('jato sem PC tem WEP: empuxo extra na hora, sem chama', () => {
    const es = run(new EngineSet('j47'), 10, 1), mil = es.thrust;
    run(es, 1 / 120, 1, true); expect(es.thrust / mil).toBeCloseTo(28.9 / 26.3, 2); expect(es.hasAB).toBe(false); expect(es.hasBoost).toBe(true);
  });
  it('empuxo cai com a altitude', () => {
    const lo = run(new EngineSet('j47'), 10, 1, false, 0).thrust, hi = run(new EngineSet('j47'), 10, 1, false, 10000).thrust;
    expect(hi / lo).toBeLessThan(0.5);
  });
});

describe('pistão', () => {
  it('responde em fração de segundo e WEP soma potência', () => {
    const es = run(new EngineSet('merlin66'), 5, 0);
    run(es, 1.2, 1); expect(es.output).toBeGreaterThan(0.95);
    run(es, 3, 1, true); expect(es.output).toBeCloseTo(1720 / 1580, 2);
  });
  it('turbocompressor do P-47 segura potência mais alto que o Merlin', () => {
    const p = (id, h) => run(new EngineSet(id), 3, 1, false, h).shaft / ENGINES[id].hp;
    expect(p('r2800', 7000)).toBeGreaterThan(p('merlin66', 7000));
  });
});
