import * as THREE from 'three';
import { camera } from '../core/render.js';
import { settings, onSettings } from '../core/settings.js';
import { rand, clamp } from '../core/util.js';

// =====================================================================
// Som sintetizado (WebAudio), tudo gerado em tempo real — nenhum arquivo.
// Cadeia: fontes → [estéreo + absorção do ar por distância] → seco (sfx) e
// envio de reverberação (convolução com resposta gerada: o "eco" do vale) →
// compressor no master. O som viaja a 343 m/s: o estampido distante chega
// depois do clarão, mais abafado e com mais cauda.
// =====================================================================
export let AC = null;
let master = null, sfx = null, engBus = null, verb = null, noiseBuf = null, brownBuf = null;
const lastShot = new Map();
export const eng = { tank: null, air: null };
function applyVol() { if (!AC) return; master.gain.value = settings.audio.master * 0.7; sfx.gain.value = settings.audio.sfx; engBus.gain.value = settings.audio.engine; }
onSettings(applyVol);

// resposta ao impulso "ao ar livre": pré-eco curto (chão), cauda difusa de ~2,4 s com agudos morrendo antes
function impulse(sec) {
  const n = Math.floor(AC.sampleRate * sec), b = AC.createBuffer(2, n, AC.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / AC.sampleRate, k = Math.min(1, t * 40), dec = Math.exp(-t * 2.6);
      lp += (Math.random() * 2 - 1 - lp) * Math.max(0.04, 0.6 * Math.exp(-t * 1.8)); // cada vez mais grave
      d[i] = lp * dec * k * (t > 0.06 && t < 0.075 ? 2.2 : 1);
    }
  }
  return b;
}
export function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const comp = AC.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    master = AC.createGain(); master.connect(comp); comp.connect(AC.destination);
    // efeitos passam por uma saturação suave (tanh): tiro e explosão ganham corpo em vez de só chiado de ruído filtrado
    const sat = AC.createWaveShaper(), sc = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; sc[i] = Math.tanh(x * 1.7) / Math.tanh(1.7); } sat.curve = sc; sat.oversample = '2x'; sat.connect(master);
    sfx = AC.createGain(); sfx.connect(sat); engBus = AC.createGain(); engBus.connect(master);
    verb = AC.createConvolver(); verb.buffer = impulse(2.4); const vg = AC.createGain(); vg.gain.value = 0.55; verb.connect(vg); vg.connect(sfx);
    applyVol();
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // ruído marrom (grave, "rumor"): base de motores, vento forte e explosões
    brownBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const e = brownBuf.getChannelData(0); let last = 0; for (let i = 0; i < e.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; e[i] = last * 3.5; }
    const loop = (buf, rate = 1) => { const n = AC.createBufferSource(); n.buffer = buf; n.loop = true; n.playbackRate.value = rate; n.start(0, Math.random() * 1.9); return n; };
    const filt = (type, f, q = 0.7) => { const x = AC.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
    const gain = v => { const x = AC.createGain(); x.gain.value = v; return x; };

    // ---- tanque: V12 a gasolina. O oscilador roda na frequência do CICLO do motor (rpm/120) e a forma de onda traz as
    // ordens: 12 (queima dos 12 cilindros) e múltiplos dominam, 6 e 18 dão o ronco irregular entre bancadas, o resto é
    // mecânica. A carga abre o filtro (motor "abrindo") e sobe o ruído de escape, que pulsa na queima; esteiras à parte.
    {
      const N = 72, re = new Float32Array(N + 1), im = new Float32Array(N + 1); let sd = 7;
      const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      for (let n = 1; n <= N; n++) {
        const amp = n % 12 === 0 ? 1 / Math.pow(n / 12, 0.75) : n % 6 === 0 ? 0.5 / Math.pow(n / 6, 0.9) : n % 3 === 0 ? 0.16 / Math.sqrt(n / 3) : 0.07 * rnd() / Math.sqrt(n);
        const ph = rnd() * Math.PI * 2; re[n] = amp * Math.cos(ph); im[n] = amp * Math.sin(ph);
      }
      const wave = AC.createPeriodicWave(re, im), o = AC.createOscillator(); o.setPeriodicWave(wave); o.frequency.value = 6;
      const fl = filt('lowpass', 320, 0.9), body = filt('peaking', 110, 1.2); body.gain.value = 7; const g = gain(0);
      o.connect(fl); fl.connect(body); body.connect(g); g.connect(engBus); o.start();
      // escape: ruído marrom que pulsa com o motor
      const xn = loop(brownBuf, 1.3), xf = filt('bandpass', 180, 0.7), xam = gain(0.5), xmod = gain(0.9), xg = gain(0);
      o.connect(xmod); xmod.connect(xam.gain); xn.connect(xf); xf.connect(xam); xam.connect(xg); xg.connect(g);
      // mecânica: válvulas/engrenagens, chiado agudo e baixo
      const mn = loop(noiseBuf, 1), mf = filt('bandpass', 2600, 1.5), mam = gain(0.4), mmod = gain(0.6), mg = gain(0);
      o.connect(mmod); mmod.connect(mam.gain); mn.connect(mf); mf.connect(mam); mam.connect(mg); mg.connect(g);
      const tn = loop(noiseBuf, 0.7), tf = filt('bandpass', 900, 1.2), tam = gain(0.5), tl = AC.createOscillator(), tlg = gain(0.5), tg = gain(0);
      tl.type = 'square'; tl.frequency.value = 6; tl.connect(tlg); tlg.connect(tam.gain); tn.connect(tf); tf.connect(tam); tam.connect(tg); tg.connect(engBus); tl.start();
      // squeal: rangido metálico dos pinos da esteira, só andando
      const sq = AC.createOscillator(), sqf = filt('bandpass', 2300, 9), sqg = gain(0); sq.type = 'sawtooth'; sq.frequency.value = 2300; sq.connect(sqf); sqf.connect(sqg); sqg.connect(engBus); sq.start();
      // rpm real do motor, carga 0..1 (acelerador), velocidade da esteira em m/s
      const set = (on, rpm, load, sp) => {
        const t = AC.currentTime, k = 0.06;
        const rt = eng.recT;
        g.gain.setTargetAtTime(on ? (0.10 + load * 0.11) * (rt ? 0.35 : 1) : 0, t, k);
        if (rt) { rt.g.gain.setTargetAtTime(on ? 0.32 + load * 0.3 : 0, t, 0.08); if (on) { rt.s.playbackRate.setTargetAtTime(0.72 + clamp((rpm - 700) / 2300, 0, 1) * 0.75, t, 0.06); rt.f.frequency.setTargetAtTime(1800 + load * 6000 + rpm * 1.5, t, 0.1); } }
        if (!on) { tg.gain.setTargetAtTime(0, t, k); sqg.gain.setTargetAtTime(0, t, k); return; }
        o.frequency.setTargetAtTime(rpm / 120, t, 0.03);
        fl.frequency.setTargetAtTime(260 + rpm * 0.12 + load * 900, t, 0.09);
        body.frequency.setTargetAtTime(70 + rpm * 0.03, t, 0.1);
        xf.frequency.setTargetAtTime(120 + rpm * 0.1, t, 0.1); xg.gain.setTargetAtTime(0.5 + load * 1.3, t, 0.08);
        mg.gain.setTargetAtTime(0.05 + rpm / 2500 * 0.12, t, 0.1);
        tg.gain.setTargetAtTime(Math.min(1, sp / 6) * 0.09, t, k); tl.frequency.setTargetAtTime(2 + sp * 2.2, t, k); tf.frequency.setTargetAtTime(700 + sp * 40, t, k);
        sqg.gain.setTargetAtTime(sp > 0.5 ? 0.006 + Math.min(sp, 8) * 0.0015 : 0, t, 0.15); sq.frequency.setTargetAtTime(2100 + sp * 60 + Math.sin(t * 7) * 120, t, 0.05);
      };
      eng.tank = { g, set, track: { g: tg } };
      // motores dos OUTROS blindados por perto (3 vozes): o mesmo timbre do V12 com escape, posição, distância e abafamento
      eng.tvoices = [];
      for (let i = 0; i < 3; i++) {
        const vo = AC.createOscillator(); vo.setPeriodicWave(wave); vo.frequency.value = 6;
        const vf = filt('lowpass', 300, 0.8), vnf = filt('bandpass', 160, 0.7), vng = gain(0.6), vg = gain(0), vp = AC.createStereoPanner();
        vo.connect(vf); loop(brownBuf, 1.1 + i * 0.13).connect(vnf); vnf.connect(vng); vng.connect(vf); vf.connect(vg); vg.connect(vp); vp.connect(engBus); vo.start();
        eng.tvoices.push({ o: vo, f: vf, g: vg, p: vp });
      }
    }
    // ---- pistão: forma de onda com harmônicos de escapamento + "estalo" de ruído no ritmo das explosões + batida da hélice ----
    {
      const real = new Float32Array(16), imag = new Float32Array(16);
      for (let k = 1; k < 16; k++) imag[k] = (k === 2 ? 1.1 : k === 3 ? 0.8 : 1) / k ** 1.15 * (k % 4 === 0 ? 0.5 : 1);
      const o = AC.createOscillator(), o2 = AC.createOscillator(); o.setPeriodicWave(AC.createPeriodicWave(real, imag)); o2.type = 'square';
      const fl = filt('lowpass', 900, 0.9), g2 = gain(0.3), mix = gain(1);
      o.connect(mix); o2.connect(g2); g2.connect(mix);
      const ex = loop(noiseBuf), exf = filt('bandpass', 420, 0.9), exg = gain(0.55); ex.connect(exf); exf.connect(exg); exg.connect(mix); // ruído do escapamento
      mix.connect(fl);
      const am = gain(0.7), lfo = AC.createOscillator(), lg = gain(0.3); lfo.connect(lg); lg.connect(am.gain); lfo.start();
      const pm = gain(0.85), pl = AC.createOscillator(), plg = gain(0.15); pl.connect(plg); plg.connect(pm.gain); pl.start(); // pás da hélice
      const sh = AC.createWaveShaper(), curve = new Float32Array(512); for (let i = 0; i < 512; i++) { const x = i / 256 - 1; curve[i] = Math.tanh(x * 2.8); } sh.curve = curve;
      const g = gain(0);
      fl.connect(am); am.connect(pm); pm.connect(g); g.connect(sh); sh.connect(engBus); o.start(); o2.start();
      eng.air = { o, o2, g, f: fl, lfo, prop: pl, ex: exf };
    }
    // ---- turbina: rugido (ruído), apito com dois harmônicos levemente desafinados (pás do compressor) e uivo da entrada de ar ----
    {
      const jn = loop(noiseBuf), jf = filt('bandpass', 500, 0.6), jg = gain(0);
      const w1 = AC.createOscillator(), w2 = AC.createOscillator(), wg = gain(0.03), w2g = gain(0.014); w1.type = 'sine'; w2.type = 'triangle';
      const hn = loop(noiseBuf, 1.3), hf = filt('bandpass', 1400, 9), hg = gain(0.5);
      jn.connect(jf); jf.connect(jg); w1.connect(wg); wg.connect(jg); w2.connect(w2g); w2g.connect(jg); hn.connect(hf); hf.connect(hg); hg.connect(jg); jg.connect(engBus); w1.start(); w2.start();
      eng.jet = { g: jg, f: jf, w: w1, w2, howl: hf };
    }
    // pós-combustão: ronco grave de ruído com "estalos"
    { const an = loop(brownBuf, 0.9), af = filt('lowpass', 260, 0.9), ag = gain(0); an.connect(af); af.connect(ag); ag.connect(engBus); eng.ab = { g: ag, f: af }; }
    // PC/WEP por perfil de motor (ENGINES[id].snd.boost): ronco grave, estalos (ganho sorteado a cada quadro), o "grito"
    // tonal (ruído em banda estreita), chiado da injeção e a aspereza (dois tons graves batendo)
    {
      const lo = filt('lowpass', 300, 0.8), log = gain(0); loop(brownBuf, 1.1).connect(lo); lo.connect(log); log.connect(engBus);
      const cf = filt('bandpass', 1500, 0.8), cg = gain(0); loop(noiseBuf, 0.9).connect(cf); cf.connect(cg); cg.connect(engBus);
      const hf = filt('bandpass', 800, 6), hg = gain(0); loop(noiseBuf, 1.05).connect(hf); hf.connect(hg); hg.connect(engBus);
      const sf = filt('highpass', 3500, 0.5), sg = gain(0); loop(noiseBuf, 1.2).connect(sf); sf.connect(sg); sg.connect(engBus);
      const r1 = AC.createOscillator(), r2 = AC.createOscillator(), rf = filt('lowpass', 180), rg = gain(0); r1.type = r2.type = 'sawtooth'; r1.frequency.value = 52; r2.frequency.value = 57;
      r1.connect(rf); r2.connect(rf); rf.connect(rg); rg.connect(engBus); r1.start(); r2.start();
      eng.boost = { lo, log, cf, cg, hf, hg, sg, r1, r2, rg };
    }
    // vento na fuselagem (duas bandas: chiado e sopro grave) e trepidação perto do estol
    {
      const wf = filt('bandpass', 700, 0.5), wg = gain(0), lf = filt('lowpass', 260, 0.7), lg = gain(0.8);
      loop(noiseBuf).connect(wf); wf.connect(wg); loop(brownBuf, 1.2).connect(lf); lf.connect(lg); lg.connect(wg); wg.connect(engBus);
      const bf = filt('lowpass', 70, 1.5), bam = gain(0), bl = AC.createOscillator(), blg = gain(1), bg = gain(0); bl.type = 'square'; bl.frequency.value = 11; bl.connect(blg); blg.connect(bam.gain); loop(brownBuf, 0.7).connect(bf); bf.connect(bam); bam.connect(bg); bg.connect(engBus); bl.start();
      eng.wind = { g: wg, f: wf, buffet: bg };
    }
    // ronco grave da turbina (o "peso" que o apito sozinho não tem)
    { const rf = filt('lowpass', 110, 1.2), rg = gain(0); loop(brownBuf, 0.6).connect(rf); rf.connect(rg); rg.connect(engBus); eng.rumble = { g: rg, f: rf }; }
    // rodas rolando na pista
    { const rf = filt('bandpass', 180, 0.8), rg = gain(0); loop(brownBuf, 1.5).connect(rf); rf.connect(rg); rg.connect(engBus); eng.roll = { g: rg, f: rf }; }
    // motores dos OUTROS aviões por perto (até 3 vozes): rugido/pistão com Doppler e posição estéreo
    eng.voices = [];
    for (let i = 0; i < 3; i++) {
      const n = loop(noiseBuf, 0.8 + i * 0.1), nf = filt('bandpass', 600, 0.8), o = AC.createOscillator(), og = gain(0.25), of = filt('lowpass', 700), mix = gain(0), pan = AC.createStereoPanner(), air = filt('lowpass', 8000);
      o.type = 'sawtooth'; n.connect(nf); nf.connect(mix); o.connect(of); of.connect(og); og.connect(mix); mix.connect(air); air.connect(pan); pan.connect(engBus); o.start();
      eng.voices.push({ g: mix, nf, o, og, pan, air, q: null });
    }
    // tons do cockpit: buscador do míssil (rosnado/tom) e alarmes
    const tone = type => { const o = AC.createOscillator(), g = AC.createGain(); o.type = type; g.gain.value = 0; o.connect(g); g.connect(sfx); o.start(); return { o, g }; };
    eng.seek = tone('triangle'); eng.warn = tone('square');
    loadSamples();
  } catch (e) { AC = null; }
}

// ---------- gravações reais (CC0, em public/audio; ver public/audio/CREDITOS.md) ----------
// Se um arquivo existir, a gravação vira a base daquele som e a síntese fica só de tempero (rotação, apito,
// sub-grave); se faltar, tudo segue sintetizado. SMP.meta traz o "pico" dos rasantes (s) para alinhar o vush.
export const SMP = {};
const FILES = ['tankshot', 'tank', 'piston', 'jet', 'jetcab', 'mg', 'mgloop', 'cannon', 'boom', 'boom_small', 'jetby', 'propby', 'hit1', 'hit2', 'hit3', 'hit4', 'snap1', 'snap2', 'snap3', 'abstart'];
async function loadSamples() {
  try { SMP.meta = await (await fetch(new URL('audio/meta.json', document.baseURI))).json(); } catch (e) { SMP.meta = {}; }
  await Promise.all(FILES.map(async k => {
    // audio/local/ (fora do git) tem prioridade: sons do próprio jogador, para uso pessoal — ver public/audio/LEIAME.md
    for (const f of ['local/' + k + '.wav', 'local/' + k + '.ogg', 'local/' + k + '.mp3', k + '.wav', k + '.ogg']) { // .wav: preparados por tools/audio_prep.py
      try { const r = await fetch(new URL(`audio/${f}`, document.baseURI)); if (r.ok && !/html/.test(r.headers.get('content-type') || '')) { SMP[k] = await AC.decodeAudioData(await r.arrayBuffer()); break; } }
      catch (e) { /* sem o arquivo: fica a síntese */ }
    }
  }));
  // laços de motor gravados: um para o avião principal e um por voz dos outros aviões
  const loopOf = (buf, dest) => { const s = AC.createBufferSource(); s.buffer = buf; s.loop = true; const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 16000; const g = AC.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(dest); s.start(0, Math.random() * buf.duration); return { s, f, g }; };
  if (SMP.tank) eng.recT = loopOf(SMP.tank, engBus);       // motor do seu tanque: gravação em laço, tom e volume pela rotação/carga
  if (SMP.piston) eng.recP = loopOf(SMP.piston, engBus);
  if (SMP.jet) eng.recJ = loopOf(SMP.jet, engBus);
  if (SMP.jetcab) eng.recC = loopOf(SMP.jetcab, engBus);  // jato ouvido de dentro da cabine
  if (SMP.mgloop) eng.gunLoop = loopOf(SMP.mgloop, sfx);   // suas metralhadoras: rajada gravada em laço enquanto segura o gatilho
  for (const v of eng.voices) { if (SMP.piston) v.recP = loopOf(SMP.piston, v.air); if (SMP.jet) v.recJ = loopOf(SMP.jet, v.air); }
}
// toca uma gravação num ponto do mundo (estéreo, distância, reverberação); rate muda tom e duração juntos
function playRec(buf, a, vol, rate = 1, dest, offset = 0, dur) {
  const s = AC.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
  const g = AC.createGain(); g.gain.value = vol; s.connect(g); g.connect(dest || sfx);
  s.start(a ? a.t : AC.currentTime, offset, dur); return s;
}

// ---------- espacialização ----------
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
// pan (−1 esq. .. 1 dir.), atraso de propagação, volume por distância, corte de agudos (ar) e fração de reverberação
function at(pos, base) {
  if (!AC) return null;
  const d = camera.position.distanceTo(pos);
  _v.copy(pos).sub(camera.position).applyQuaternion(_q.copy(camera.quaternion).invert());
  const pan = clamp(_v.x / (Math.hypot(_v.x, _v.z) + 2), -1, 1) * 0.8;
  return { t: AC.currentTime + d / 343, vol: base / (1 + d / 40), d, pan, cut: 16000 / (1 + d / 380), wet: d / (d + 220) };
}
export { at as soundAt };
// cadeia de saída de um som posicionado: panner → absorção → seco + envio para a reverberação
function out(a, wetK = 1) {
  const p = AC.createStereoPanner(); p.pan.value = a.pan;
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(400, a.cut);
  const dry = AC.createGain(); dry.gain.value = 1 - a.wet * 0.55; const wet = AC.createGain(); wet.gain.value = (0.25 + a.wet * 0.9) * wetK;
  p.connect(lp); lp.connect(dry); lp.connect(wet); dry.connect(sfx); wet.connect(verb);
  return p;
}
// f1: o filtro varre de freq até f1 durante o som (explosão real começa clara e escurece)
function noiseBurst(t, vol, freq, dur, q = 0.7, dest = sfx, type = 'lowpass', buf = noiseBuf, att = 0.006, f1 = 0) {
  const s = AC.createBufferSource(); s.buffer = buf; s.playbackRate.value = rand(.8, 1.1);
  const f = AC.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (f1) { f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7); }
  const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest); s.start(t, rand(0, 1)); s.stop(t + dur + 0.05);
}
function thump(t, vol, f0, dur, dest = sfx) {
  const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.4, t + dur);
  g.gain.setValueAtTime(Math.max(vol, 0.0002), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur);
}
function ping(t, vol, f0, f1, dur, dest = sfx, type = 'triangle') {
  const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(Math.max(vol, 0.0002), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
}

// motores dos outros blindados: list = até 3 de { pos, rpm, load } (os mais próximos da câmera); [] cala todos
export function tankVoices(list) {
  if (!AC || !eng.tvoices) return; const t = AC.currentTime;
  eng.tvoices.forEach((v, i) => {
    const q = list[i], a = q && at(q.pos, 1);
    if (!a) { v.g.gain.setTargetAtTime(0, t, 0.15); return; }
    v.o.frequency.setTargetAtTime(q.rpm / 120, t, 0.06); v.f.frequency.setTargetAtTime((240 + q.rpm * 0.1 + q.load * 600) / (1 + a.d / 150), t, 0.1);
    v.g.gain.setTargetAtTime((0.09 + q.load * 0.08) / (1 + a.d / 18), t, 0.12); v.p.pan.setTargetAtTime(a.pan, t, 0.1);
  });
}

// ---------- cockpit ----------
// tom curto (bipes de radar/RWR): varre f0→f1 em dur s, começando após `delay` s
export function cockpitTone(f0, f1, dur, vol = 0.05, type = 'sine', delay = 0) {
  if (!AC) return; const t = AC.currentTime + delay, o = AC.createOscillator(), gg = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur);
  gg.gain.setValueAtTime(0.0001, t); gg.gain.exponentialRampToValueAtTime(vol, t + 0.008); gg.gain.setValueAtTime(vol, t + Math.max(0.01, dur - 0.02)); gg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gg); gg.connect(sfx); o.start(t); o.stop(t + dur + 0.02);
}
// voz do aviônico: um canal só (fala nova corta a anterior; null cala); amostras mono a `rate` Hz com filtro de rádio
let voiceSrc = null;
export function cockpitVoice(pcm, rate) {
  if (!AC) return;
  if (voiceSrc) { voiceSrc.stop(); voiceSrc = null; }
  if (!pcm) return;
  const b = AC.createBuffer(1, pcm.length, rate); b.copyToChannel(pcm, 0);
  const s = AC.createBufferSource(), hp = AC.createBiquadFilter(), lp = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = b; hp.type = 'highpass'; hp.frequency.value = 300; lp.type = 'lowpass'; lp.frequency.value = 3200; g.gain.value = 0.35;
  s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(sfx); s.start(); voiceSrc = s;
}
export function cockpitThump(vol = 0.5, f0 = 70, dur = 0.35) { if (AC) thump(AC.currentTime, vol, f0, dur); }
// impacto no PRÓPRIO avião: "tinc" metálico de bala, "bang" seco de granada
export function sndHit(big) {
  if (!AC) return; const t = AC.currentTime;
  const hs = ['hit1', 'hit2', 'hit3', 'hit4'].filter(k => SMP[k]);
  if (hs.length) { playRec(SMP[hs[Math.floor(Math.random() * hs.length)]], null, big ? 0.9 : 0.55, rand(0.85, 1.15) * (big ? 0.8 : 1)); if (big) thump(t, 0.6, 90, 0.3); return; }
  noiseBurst(t, big ? 0.5 : 0.28, big ? 2200 : 5200, big ? 0.22 : 0.07, 3, sfx, 'bandpass');
  ping(t, big ? 0.12 : 0.09, rand(1800, 3200), rand(700, 1100), big ? 0.25 : 0.12, sfx, 'square');
  if (big) thump(t, 0.6, 90, 0.3);
}
// trem de pouso (motor + trava), toque na pista (guincho do pneu) e flaps
export function sndGear(down) { if (!AC) return; const t = AC.currentTime; noiseBurst(t, 0.06, 300, 1.4, 1, sfx, 'bandpass', brownBuf, 0.2); thump(t + 1.3, 0.35, down ? 110 : 80, 0.18); noiseBurst(t + 1.3, 0.12, 1500, 0.08, 2); }
export function sndTouch(k) { if (!AC) return; const t = AC.currentTime; noiseBurst(t, 0.12 * k, 2600, 0.35, 6, sfx, 'bandpass'); thump(t, 0.4 * k, 70, 0.3); }
export function sndFlaps() { if (!AC) return; noiseBurst(AC.currentTime, 0.05, 420, 0.9, 2, sfx, 'bandpass', brownBuf, 0.15); }

// ---------- mundo ----------
export function sndCm(pos) { const a = at(pos, 0.7); if (!a) return; const o = out(a); noiseBurst(a.t, Math.min(a.vol, .6), 3200, 0.35, 2, o); noiseBurst(a.t + 0.12, Math.min(a.vol, .5), 2600, 0.3, 2, o); }
// motor-foguete acendendo: estalo + rugido rasgado que some ao longe
export function sndLaunch(pos) {
  const a = at(pos, 1.3); if (!a) return; const o = out(a);
  noiseBurst(a.t, Math.min(a.vol, 0.8), 3000, 0.08, 1, o);
  noiseBurst(a.t, Math.min(a.vol, 1), 1500, 2.2, 0.6, o, 'lowpass', noiseBuf, 0.04);
  noiseBurst(a.t, Math.min(a.vol, 0.9), 300, 1.8, 0.8, o, 'lowpass', brownBuf, 0.05);
}
// "vush" de avião passando perto (ruído que varre do agudo ao grave) com o lado de onde vem
export function sndWhoosh(pos, k = 1, jet = true) {
  const a = at(pos, 1.2 * k); if (!a) return; const o = out(a, 0.4);
  const rec = jet ? SMP.jetby : SMP.propby, pk = (SMP.meta || {})[jet ? 'jetby' : 'propby'];
  if (rec && pk) { playRec(rec, a, Math.min(a.vol * 1.6, 1.4), rand(0.95, 1.05), o, Math.max(0, pk.peak - 0.35), 4); return; } // rasante gravado, a partir do pico
  const s = AC.createBufferSource(); s.buffer = noiseBuf; const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
  f.frequency.setValueAtTime(2600, a.t); f.frequency.exponentialRampToValueAtTime(380, a.t + 0.9);
  const g = AC.createGain(); g.gain.setValueAtTime(0.0001, a.t); g.gain.exponentialRampToValueAtTime(Math.max(Math.min(a.vol, 0.9), 0.0002), a.t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, a.t + 1.1);
  s.connect(f); f.connect(g); g.connect(o); s.start(a.t, rand(0, 1)); s.stop(a.t + 1.2);
}
// estrondo sônico: dois estalos secos (onda N) com grave
// estrondo sônico de quem passa supersônico: onda em N (dois estalos secos ~0,1 s) e o ribombo que rola depois
export function sndSonicBoom(pos) {
  const a = at(pos, 3.2); if (!a) return; const o = out(a, 1.4), v = Math.min(a.vol, 1.4);
  noiseBurst(a.t, v, 2600, 0.09, 0.8, o, 'lowpass', noiseBuf, 0.002); thump(a.t, v * 0.9, 60, 0.35, o);
  noiseBurst(a.t + 0.11, v * 0.95, 2400, 0.1, 0.8, o, 'lowpass', noiseBuf, 0.002); thump(a.t + 0.11, v * 0.8, 55, 0.4, o);
  noiseBurst(a.t + 0.15, v * 0.6, 160, 1.8, 0.8, o, 'lowpass', brownBuf, 0.05);
}
// cruzando Mach 1 (o próprio jogador): o "tum" da onda de choque passando pela cabine, um sopro que some e o ronco
export function sndMachCross() {
  if (!AC) return; const t = AC.currentTime;
  thump(t, 0.9, 48, 0.9); noiseBurst(t, 0.35, 900, 0.18, 1, sfx, 'lowpass', noiseBuf, 0.003);
  noiseBurst(t + 0.05, 0.4, 140, 1.4, 0.9, sfx, 'lowpass', brownBuf, 0.03); noiseBurst(t, 0.12, 2400, 0.6, 1.5, sfx, 'bandpass', noiseBuf, 0.02);
}
// ignição da PC/WEP: "tum" grave + baforada (tamanho por motor), sintetizado (a gravação abstart foi removida)
export function sndBoostIgnite(k = 1) {
  if (!AC) return; const t = AC.currentTime;
  thump(t, 0.35 + 0.45 * k, 50 + 15 * (1 - k), 0.5 + 0.3 * k); noiseBurst(t, 0.12 + 0.2 * k, 500, 0.45 + 0.25 * k, 0.8, sfx, 'lowpass', brownBuf, 0.01);
  noiseBurst(t + 0.03, 0.06 * k, 2200, 0.2, 1.2, sfx, 'bandpass');
}
// estalo da PC: estouro curto e encorpado (no lugar do ganho sorteado a cada quadro, que zumbia a 60 Hz)
export function sndCrackle(v, muf = 1) {
  if (!AC) return; const t = AC.currentTime + rand(0, 0.015);
  noiseBurst(t, v, rand(500, 1600) * muf, rand(0.03, 0.08), 0.6, engBus, 'lowpass', noiseBuf, 0.002);
  if (Math.random() < 0.3) thump(t, v * 0.8, rand(55, 80), 0.09, engBus);
}
export function audioPause(p) { if (AC) p ? AC.suspend() : AC.resume(); }
// canhão de tanque: estalo da boca, corpo do disparo, sub-grave e a cauda do vale (reverberação)
// Tiro de canhão em camadas: estalo supersônico, corpo da explosão com o filtro fechando, sub grave que cresce com o
// calibre, e o eco que volta do terreno. De perto (o seu canhão) entra o tranco da culatra e o estojo caindo.
export function sndShot(pos, cal) {
  const a = at(pos, 1.6 * cal / 80); if (!a) return; const o = out(a, 1.5), v = Math.min(a.vol, 1.3), big = clamp((cal - 37) / 60, 0, 1.3);
  if (SMP.tankshot) { // gravação de peça de artilharia: calibre maior toca mais grave; o sub, o eco e a culatra continuam sintetizados por cima
    playRec(SMP.tankshot, a, v * 1.5, clamp(1.3 - cal / 300, 0.82, 1.15) * rand(0.97, 1.03), o);
    thump(a.t, Math.min(a.vol * 1.1, 1.1), 70 - big * 25, 0.5 + big * 0.4, o);
  } else {
  noiseBurst(a.t, v, 5200, 0.045, 0.7, o, 'highpass', noiseBuf, 0.001);
  noiseBurst(a.t, v * 1.2, 3600 / (1 + a.d / 400), 0.55 + big * 0.5, 0.8, o, 'lowpass', noiseBuf, 0.003, 240);
  noiseBurst(a.t + 0.01, v, 700 - big * 180, 1.1 + big * 0.8, 0.7, o, 'lowpass', noiseBuf, 0.006, 140);
  noiseBurst(a.t, v, 190 - big * 60, 1.8 + big * 1.2, 0.7, o, 'lowpass', brownBuf, 0.008);
  thump(a.t, Math.min(a.vol * 1.2, 1.2), 82 - big * 30, 0.5 + big * 0.5, o);
  thump(a.t, Math.min(a.vol, 1) * big, 38, 0.9, o);
  }
  // eco do terreno: repetição mais grave e fraca, mais longe = mais atrasada
  const e = 0.28 + Math.min(a.d, 600) / 1500; noiseBurst(a.t + e, v * 0.22, 700, 1.4, 0.6, o, 'lowpass', brownBuf, 0.05);
  if (a.d < 12) { // dentro/junto do tanque: culatra recuando e voltando, estojo no piso
    ping(a.t + 0.05, 0.16, 190, 90, 0.18, sfx, 'square'); noiseBurst(a.t + 0.32, 0.22, 2400, 0.09, 5, sfx, 'bandpass');
    ping(a.t + 0.9, 0.07, 3100, 2300, 0.25, sfx); ping(a.t + 1.02, 0.04, 3600, 2700, 0.2, sfx);
  }
}
// metralhadoras e canhões de avião: estalo curto que muda com o calibre; a partir de 20 mm, o "tum" do canhão.
// Limite de cadência POR CALIBRE (antes era um só para tudo: o canhão sumia no meio das .50)
export function sndMG(pos, cal, own, rpm = 0) {
  if (!AC || (own && cal < 20 && eng.gunLoop)) return; // as suas metralhadoras tocam no laço gravado
  if (rpm >= 2400) { // canhão rotativo (GAU-8, M61): os tiros fundem num zumbido — dente de serra na cadência + sopro, em grãos que se emendam
    const t0 = AC.currentTime; if (t0 - (lastShot.get('b') || 0) < 0.07) return; lastShot.set('b', t0);
    const a = at(pos, 0.3 * cal / 10); if (a.vol < 0.004) return; const o = out(a, 0.7), v = Math.min(a.vol, 0.8), dur = 0.15;
    const os = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain(); os.type = 'sawtooth'; os.frequency.value = rpm / 60 * rand(0.98, 1.02);
    f.type = 'lowpass'; f.frequency.value = Math.max(300, 2600 / (1 + a.d / 250));
    g.gain.setValueAtTime(0.0001, a.t); g.gain.exponentialRampToValueAtTime(v * 0.7, a.t + 0.015); g.gain.setValueAtTime(v * 0.7, a.t + dur - 0.04); g.gain.exponentialRampToValueAtTime(0.0001, a.t + dur);
    os.connect(f); f.connect(g); g.connect(o); os.start(a.t); os.stop(a.t + dur + 0.02);
    noiseBurst(a.t, v * 0.8, 1400 / (1 + a.d / 300), dur, 0.8, o, 'bandpass', noiseBuf, 0.015); thump(a.t, v * 0.5, cal >= 30 ? 75 : 100, dur, o);
    return;
  }
  const t = AC.currentTime, key = cal >= 20 ? 'c' : 'm', gap = cal >= 30 ? 0.09 : cal >= 20 ? 0.055 : 0.04;
  if (t - (lastShot.get(key) || 0) < gap) return; lastShot.set(key, t);
  const a = at(pos, 0.25 * cal / 10); if (a.vol < 0.004) return; const o = out(a, 0.5), v = Math.min(a.vol, cal >= 20 ? .7 : .5);
  // gravação: metralhadora (calibre menor = tom mais agudo) ou canhão automático (37 mm mais grave)
  const rec = cal >= 20 ? SMP.cannon : SMP.mg;
  if (rec) { playRec(rec, a, v * 1.8, (cal >= 20 ? 20 / cal * 1.05 : 12.7 / cal) * rand(0.95, 1.05), o); if (cal >= 20) thump(a.t, v * 0.6, cal >= 30 ? 65 : 90, 0.12, o); return; }
  noiseBurst(a.t, v, (cal >= 20 ? 2200 : 3400) / (1 + a.d / 300), cal >= 20 ? .16 : .1, 1.5, o, 'bandpass');
  noiseBurst(a.t, v * 0.6, 7000, 0.03, 0.7, o, 'highpass');
  if (cal >= 20) thump(a.t, v * 0.8, cal >= 30 ? 70 : 95, 0.12, o);
}
// explosão: estalo, estrondo grave, sub, estilhaços chovendo e a cauda longa (reverberação)
export function sndBoom(pos, big) {
  const a = at(pos, big ? 2.2 : 0.9); if (!a) return; const o = out(a, 1.4), v = Math.min(a.vol, 1.4);
  const rec = big ? SMP.boom : SMP.boom_small;
  if (rec) { playRec(rec, a, v * 1.3, rand(0.88, 1.08) * (big ? 0.9 : 1), o); thump(a.t, Math.min(a.vol, 1.2), big ? 45 : 60, big ? 1.4 : .5, o); return; }
  noiseBurst(a.t, v, 5000, 0.06, 0.7, o, 'highpass');
  noiseBurst(a.t, v * 1.1, big ? 2200 : 2800, big ? 2.6 : 0.9, 0.7, o, 'lowpass', noiseBuf, 0.004, big ? 120 : 200);
  noiseBurst(a.t, v, big ? 160 : 260, big ? 3.2 : 1.4, 0.8, o, 'lowpass', brownBuf, 0.01);
  if (a.d > 250) noiseBurst(a.t + 0.2 + a.d / 2500, v * 0.5, 120, big ? 3 : 1.6, 0.7, o, 'lowpass', brownBuf, 0.08); // de longe: o trovão que rola depois do estalo
  thump(a.t, Math.min(a.vol, 1.2), big ? 48 : 60, big ? 1.4 : .5, o);
  if (big && a.d < 400) for (let i = 0; i < 6; i++) noiseBurst(a.t + rand(0.5, 1.6), v * 0.15, rand(2000, 5000), 0.05, 4, o, 'bandpass');
}
export function sndPing(pos) { const a = at(pos, 0.6); if (!a) return; ping(a.t, Math.min(a.vol, .5), 2600, 700, .4, out(a, 0.6)); }
export function sndClank(pos) { const a = at(pos, 1); if (!a) return; const o = out(a, 0.6); noiseBurst(a.t, Math.min(a.vol, 1), 3500, .25, 4, o); thump(a.t, Math.min(a.vol, .6), 220, .15, o); }
// chapa rasgando (peça arrancada do avião): guincho metálico + estalo
export function sndTear(pos) {
  const a = at(pos, 1.6); if (!a) return; const o = out(a, 0.8), v = Math.min(a.vol, 0.9);
  noiseBurst(a.t, v, 2600, 0.5, 5, o, 'bandpass', noiseBuf, 0.02);
  ping(a.t, v * 0.25, rand(900, 1400), rand(300, 500), 0.45, o, 'sawtooth');
  thump(a.t, v * 0.6, 120, 0.2, o);
}
// bala inimiga passando perto: estalo supersônico gravado (de quem estava do lado de lá da .50)
export function sndSnap(pos) { const a = at(pos, 1); if (!a) return; const k = ['snap1', 'snap2', 'snap3'].filter(n => SMP[n]); if (k.length) playRec(SMP[k[Math.floor(Math.random() * k.length)]], null, 0.55, rand(0.9, 1.15), out(a, 0.2)); }
export function sndAB() { if (AC && SMP.abstart) playRec(SMP.abstart, null, 0.5, rand(0.95, 1.05)); else sndBoostIgnite(1); }
export function sndCrack(pos) { const a = at(pos, .5); if (!a) return; noiseBurst(a.t, Math.min(a.vol, .6), 1800, .5, 2, out(a)); }
export function sndClick() { if (!AC) return; const t = AC.currentTime; noiseBurst(t, .25, 5000, .06, 6); noiseBurst(t + .09, .3, 3000, .08, 6); }
export function sndUi() { if (!AC) return; const t = AC.currentTime; noiseBurst(t, .08, 6000, .04, 8); }
