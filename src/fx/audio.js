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
    // pós-combustão: ronco grave de ruído (ganho = fração acesa)
    const an = AC.createBufferSource(); an.buffer = noiseBuf; an.loop = true; an.playbackRate.value = 0.6;
    const af = AC.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 220; af.Q.value = 0.9;
    const ag = AC.createGain(); ag.gain.value = 0; an.connect(af); af.connect(ag); ag.connect(engBus); an.start();
    eng.ab = { g: ag, f: af };
    const loopNoise = rate => { const n = AC.createBufferSource(); n.buffer = noiseBuf; n.loop = true; n.playbackRate.value = rate; n.start(); return n; };
    // vento na fuselagem: cresce com a pressão dinâmica
    const wf = AC.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 700; wf.Q.value = 0.5;
    const wg = AC.createGain(); wg.gain.value = 0; loopNoise(1).connect(wf); wf.connect(wg); wg.connect(engBus);
    eng.wind = { g: wg, f: wf };
    // ronco grave da turbina (o "peso" do motor que o apito sozinho não tem)
    const rf = AC.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 110; rf.Q.value = 1.2;
    const rg = AC.createGain(); rg.gain.value = 0; loopNoise(0.5).connect(rf); rf.connect(rg); rg.connect(engBus);
    eng.rumble = { g: rg, f: rf };
    // pistão: batida dos cilindros (modulação de amplitude) e distorção do escapamento
    const am = AC.createGain(); am.gain.value = 0.75; const lfo = AC.createOscillator(); lfo.frequency.value = 12; const lfoG = AC.createGain(); lfoG.gain.value = 0.25;
    lfo.connect(lfoG); lfoG.connect(am.gain); lfo.start();
    const sh = AC.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.6); } sh.curve = curve;
    eng.air.g.disconnect(); eng.air.g.connect(am); am.connect(sh); sh.connect(engBus);
    eng.air.lfo = lfo;
    // tons do cockpit: buscador do míssil (rosnado/tom) e alarmes
    const tone = (type) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = type; g.gain.value = 0; o.connect(g); g.connect(sfx); o.start(); return { o, g }; };
    eng.seek = tone('triangle'); eng.warn = tone('square');
  } catch (e) { AC = null; }
}
export function sndCm(pos) { const a = at(pos, 0.7); if (!a) return; noiseBurst(a.t, Math.min(a.vol, .6), 3200, 0.35, 2); noiseBurst(a.t + 0.12, Math.min(a.vol, .5), 2600, 0.3, 2); }
export function sndLaunch(pos) { const a = at(pos, 1.2); if (!a) return; noiseBurst(a.t, Math.min(a.vol, 1), 1600, 1.6, 0.5); }
// tom curto de cockpit (bipes de radar/RWR): varre f0→f1 em dur s, começando após `delay` s
export function cockpitTone(f0, f1, dur, vol = 0.05, type = 'sine', delay = 0) {
  if (!AC) return; const t = AC.currentTime + delay, o = AC.createOscillator(), gg = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur);
  gg.gain.setValueAtTime(0.0001, t); gg.gain.exponentialRampToValueAtTime(vol, t + 0.008); gg.gain.setValueAtTime(vol, t + Math.max(0.01, dur - 0.02)); gg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gg); gg.connect(sfx); o.start(t); o.stop(t + dur + 0.02);
}
// "vush" de avião passando perto (ruído que varre do agudo ao grave)
export function sndWhoosh(pos, k = 1) {
  const a = at(pos, 1.2 * k); if (!a) return;
  const s = AC.createBufferSource(); s.buffer = noiseBuf; const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
  f.frequency.setValueAtTime(2600, a.t); f.frequency.exponentialRampToValueAtTime(380, a.t + 0.9);
  const g = AC.createGain(); g.gain.setValueAtTime(0.0001, a.t); g.gain.exponentialRampToValueAtTime(Math.max(Math.min(a.vol, 0.9), 0.0002), a.t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, a.t + 1.1);
  s.connect(f); f.connect(g); g.connect(sfx); s.start(a.t, rand(0, 1)); s.stop(a.t + 1.2);
}
// estrondo sônico: dois estalos secos (onda N) com grave
export function sndSonicBoom(pos) { const a = at(pos, 2.5); if (!a) return; noiseBurst(a.t, Math.min(a.vol, 1.3), 900, 0.35, 1); noiseBurst(a.t + 0.12, Math.min(a.vol, 1.1), 900, 0.4, 1); thump(a.t, Math.min(a.vol, 1.2), 45, 0.8); }
export function cockpitThump(vol = 0.5, f0 = 70, dur = 0.35) { if (AC) thump(AC.currentTime, vol, f0, dur); }
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
