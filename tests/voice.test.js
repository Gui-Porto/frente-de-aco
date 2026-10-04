import { describe, it, expect } from 'vitest';
import { pickVoice } from '../src/air/voice.js';

const plane = (o = {}) => ({ sys: { rwr: { top: o.lvl ? { lvl: o.lvl } : null }, maw: { list: o.tti ? [{ tti: o.tti }] : [] } }, vel: { y: o.vy ?? 0 }, onGround: false });

describe('voz de alerta', () => {
  it('sem RWR/MAW não fala', () => {
    expect(pickVoice({ sys: {}, vel: { y: -100 }, onGround: false }, 50)).toBe(null);
  });
  it('prioridade: chão iminente > míssil > guiamento > altitude > trava > rastreio', () => {
    expect(pickVoice(plane({ vy: -50, tti: 2, lvl: 'GUIDANCE' }), 200).k).toBe('pullup');
    expect(pickVoice(plane({ tti: 2, lvl: 'GUIDANCE' }), 2000).k).toBe('missile');
    expect(pickVoice(plane({ vy: -50, lvl: 'GUIDANCE' }), 400).k).toBe('guidance');
    expect(pickVoice(plane({ vy: -50, lvl: 'LOCK' }), 400).k).toBe('altitude');
    expect(pickVoice(plane({ lvl: 'LOCK' }), 2000).k).toBe('lock');
    expect(pickVoice(plane({ lvl: 'TRACK' }), 2000).k).toBe('track');
    expect(pickVoice(plane({ lvl: 'SEARCH' }), 2000)).toBe(null);
  });
  it('míssil mais perto repete mais rápido; pouso lento não grita', () => {
    expect(pickVoice(plane({ tti: 2 }), 2000).gap).toBeLessThan(pickVoice(plane({ tti: 8 }), 2000).gap);
    expect(pickVoice(plane({ vy: -5 }), 20)).toBe(null);
  });
});
