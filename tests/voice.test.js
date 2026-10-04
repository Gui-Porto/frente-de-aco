import { describe, it, expect } from 'vitest';
import { pickVoice, voiceStep, VOICE_RATE } from '../src/air/voice.js';

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
  it('fila: repete só após fala + pausa; mais grave interrompe, menos grave espera; desligar cala', () => {
    voiceStep(null, 0, false);
    const lock = { k: 'lock', gap: 1.5 };
    const b = voiceStep(lock, 0.1, true);
    expect(b).toBeInstanceOf(Float32Array);
    expect(voiceStep(lock, 0.1, true)).toBe(undefined);
    expect(voiceStep({ k: 'track', gap: 4 }, 0.1, true)).toBe(undefined);
    expect(voiceStep({ k: 'missile', gap: 0.2 }, 0.1, true)).toBeInstanceOf(Float32Array);
    expect(voiceStep(null, 0, false)).toBe(null);
    expect(voiceStep(null, 0, false)).toBe(undefined);
    voiceStep(lock, 0.1, true);
    expect(voiceStep(lock, b.length / VOICE_RATE + 1.6, true)).toBeInstanceOf(Float32Array);
  });
});
