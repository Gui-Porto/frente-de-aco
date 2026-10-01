import { camera } from '../core/render.js';
import { settings, onSettings } from '../core/settings.js';
import { rand } from '../core/util.js';

// Som sintetizado (WebAudio). O som viaja a 343 m/s: o estampido distante chega depois do clarão.
export let AC = null;
let master = null, sfx = null, engBus = null, noiseBuf = null, lastMg = 0;
export const eng = { tank: null, air: null };
function applyVol() { if (!AC) return; master.gain.value = settings.audio.master * 0.6; sfx.gain.value = settings.audio.sfx; engBus.gain.value = settings.audio.engine; }
onSettings(applyVol);
export function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.connect(AC.destination);
    sfx = AC.createGain(); sfx.connect(master); engBus = AC.createGain(); engBus.connect(master);
    applyVol();
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mk = (type, f, cut) => {
      const o = AC.createOscillator(), o2 = AC.createOscillator(), fl = AC.createBiquadFilter(), g = AC.createGain();
      o.type = type; o.frequency.value = f; o2.type = 'square'; o2.frequency.value = f * 0.5;
      fl.type = 'lowpass'; fl.frequency.value = cut; g.gain.value = 0;
      const g2 = AC.createGain(); g2.gain.value = 0.35; o2.connect(g2); g2.connect(fl);
      o.connect(fl); fl.connect(g); g.connect(engBus); o.start(); o2.start(); return { o, o2, g, f: fl };
    };
    eng.tank = mk('sawtooth', 32, 240);
    eng.air = mk('sawtooth', 70, 650);
    // turbina: ruído filtrado (rugido) + apito agudo
    const jn = AC.createBufferSource(); jn.buffer = noiseBuf; jn.loop = true;
    const jf = AC.createBiquadFilter(); jf.type = 'bandpass'; jf.frequency.value = 500; jf.Q.value = 0.6;
    const jw = AC.createOscillator(); jw.type = 'sine'; jw.frequency.value = 2600;
    const jwg = AC.createGain(); jwg.gain.value = 0.04; const jg = AC.createGain(); jg.gain.value = 0;
    jn.connect(jf); jf.connect(jg); jw.connect(jwg); jwg.connect(jg); jg.connect(engBus); jn.start(); jw.start();
    eng.jet = { g: jg, f: jf, w: jw };
    // tons do cockpit: buscador do míssil (rosnado/tom) e alarmes
    const tone = (type) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = type; g.gain.value = 0; o.connect(g); g.connect(sfx); o.start(); return { o, g }; };
    eng.seek = tone('triangle'); eng.warn = tone('square');
  } catch (e) { AC = null; }
}
export function sndCm(pos) { const a = at(pos, 0.7); if (!a) return; noiseBurst(a.t, Math.min(a.vol, .6), 3200, 0.35, 2); noiseBurst(a.t + 0.12, Math.min(a.vol, .5), 2600, 0.3, 2); }
export function sndLaunch(pos) { const a = at(pos, 1.2); if (!a) return; noiseBurst(a.t, Math.min(a.vol, 1), 1600, 1.6, 0.5); }
export function audioPause(p) { if (AC) p ? AC.suspend() : AC.resume(); }
function at(pos, base) { if (!AC) return null; const d = camera.position.distanceTo(pos); return { t: AC.currentTime + d / 343, vol: base / (1 + d / 40), d }; }
function noiseBurst(t, vol, freq, dur, q = 0.7) {
  const s = AC.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = rand(.8, 1.1);
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
  const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(sfx); s.start(t, rand(0, 1)); s.stop(t + dur + 0.05);
}
function thump(t, vol, f0, dur) {
  const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.4, t + dur);
  g.gain.setValueAtTime(Math.max(vol, 0.0002), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(sfx); o.start(t); o.stop(t + dur);
}
export function sndShot(pos, cal) { const a = at(pos, 1.4 * cal / 80); if (!a) return; noiseBurst(a.t, Math.min(a.vol, 1.2), 2400 / (1 + a.d / 300), 1.1); thump(a.t, Math.min(a.vol, 1), 90, .4); }
export function sndMG(pos, cal) { if (!AC) return; const t = AC.currentTime; if (t - lastMg < 0.045) return; lastMg = t; const a = at(pos, 0.25 * cal / 10); if (a.vol < 0.004) return; noiseBurst(a.t, Math.min(a.vol, .5), 3000 / (1 + a.d / 300), .12, 1.5); }
export function sndBoom(pos, big) { const a = at(pos, big ? 2.2 : 0.9); if (!a) return; noiseBurst(a.t, Math.min(a.vol, 1.4), big ? 700 : 1200, big ? 2.6 : 0.9); thump(a.t, Math.min(a.vol, 1.2), 60, big ? 1.2 : .5); }
export function sndPing(pos) { const a = at(pos, 0.6); if (!a) return; const o = AC.createOscillator(), g = AC.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(2600, a.t); o.frequency.exponentialRampToValueAtTime(700, a.t + .35); g.gain.setValueAtTime(Math.max(Math.min(a.vol, .5), .0002), a.t); g.gain.exponentialRampToValueAtTime(0.0001, a.t + .4); o.connect(g); g.connect(sfx); o.start(a.t); o.stop(a.t + .45); }
export function sndClank(pos) { const a = at(pos, 1); if (!a) return; noiseBurst(a.t, Math.min(a.vol, 1), 3500, .25, 4); thump(a.t, Math.min(a.vol, .6), 220, .15); }
export function sndCrack(pos) { const a = at(pos, .5); if (!a) return; noiseBurst(a.t, Math.min(a.vol, .6), 1800, .5, 2); }
export function sndClick() { if (!AC) return; const t = AC.currentTime; noiseBurst(t, .25, 5000, .06, 6); noiseBurst(t + .09, .3, 3000, .08, 6); }
export function sndUi() { if (!AC) return; const t = AC.currentTime; noiseBurst(t, .08, 6000, .04, 8); }
