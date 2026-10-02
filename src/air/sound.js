import { camera } from '../core/render.js';
import { S, planes } from '../core/state.js';
import { AC, eng, cockpitTone, cockpitThump, sndWhoosh, sndSonicBoom, sndGear, sndTouch, sndFlaps, sndAB, soundAt } from '../fx/audio.js';
import { acam } from './camera.js';
import { clamp } from '../core/util.js';
import { B } from './battle.js';
import { LOCK } from './targeting.js';
// =====================================================================
// AudioSystem do modo aéreo. Tudo sintetizado e dirigido por DADOS:
//  - motor: perfil em ENGINES[id].snd (pistão: f0..f1; jato: rugido, apito,
//    ronco da pós-combustão); segue a ROTAÇÃO real, não a manete — o ouvido
//    sente o spool da turbina;
//  - cockpit: eventos do radar (contato, rastreio, trava, perda), do RWR
//    (perfil em RWRS[id].snd) e do MAW; tons contínuos de alerta por prioridade;
//  - detentes da manete (marcha lenta, 100%, PC/WEP) e ignição da PC.
// =====================================================================
let beepT = 0, prevThr = -1, prevAB = 0, prevWep = false, prevGear = 0, prevFlap = 0, prevTouch = 0;
export function airAudio(dt) {
  if (!AC || !eng.jet) return;
  const live = S.state === 'play' || S.state === 'spectate' || S.state === 'end';
  const p = S.player && S.player.alive ? S.player : null;
  let near = p, nd = 0;
  if (!near) { nd = 1e9; for (const q of planes) { if (!q.alive) continue; const d = q.pos.distanceTo(camera.position); if (d < nd) { nd = d; near = q; } } }
  const vol = !live || S.paused || !near ? 0 : (p ? 1 : 1.6 / (1 + nd / 150)) * (near.engineOn ? 1 : 0.1);
  engine(near, vol);
  gunLoop(p, live && !S.paused && S.state === 'play');
  voices(near, live && !S.paused);
  wind(p, live && !S.paused);
  passes(live && !S.paused);
  if (p && !S.paused && S.state === 'play') { cockpitEvents(p); detents(p); }
  else drain(p);
  tones(p, dt);
}

function engine(q, vol) {
  const E = q && q.eng, jet = E && E.jet, sd = E ? E.E.snd || {} : {}, pit = acam.mode === 2 && q === S.player; // cabine: mais abafado
  // pistão no WEP: mais alto e mais "sujo" (a distorção vem do ganho maior entrando no waveshaper)
  eng.air.g.gain.value = E && !jet ? vol * (0.06 + 0.05 * Math.max(0, E.power - 1) * 10) : 0;
  eng.jet.g.gain.value = jet ? vol * 0.09 : 0;
  // PC: ronco com estalos (ganho tremendo aleatoriamente a cada quadro)
  eng.ab.g.gain.value = jet ? vol * (sd.ab || 0) * E.ab * (0.75 + Math.random() * 0.5) : 0;
  eng.rumble.g.gain.value = jet ? vol * (0.05 + 0.12 * Math.min(1, E.output)) : 0;
  // gravações: viram a base do som; a síntese fica por baixo (rotação, apito, sub-grave)
  const rp = eng.recP, rj = eng.recJ;
  if (rp) { eng.air.g.gain.value *= 0.12; rp.g.gain.value = E && !jet ? vol * 0.55 * (0.55 + 0.45 * Math.min(E.power, 1.2)) : 0; }
  if (rj) { eng.jet.g.gain.value *= 0.25; eng.rumble.g.gain.value *= 0.6; rj.g.gain.value = jet ? vol * 0.7 * (0.3 + 0.7 * Math.max(0, (E.N - E.E.nIdle) / (1 - E.E.nIdle))) : 0; }
  if (!E) return;
  if (rp && !jet) { rp.s.playbackRate.value = 0.72 + 0.4 * Math.min(E.power, 1.2); rp.f.frequency.value = pit ? 1600 : 16000; }
  if (rj && jet) { rj.s.playbackRate.value = 0.62 + 0.55 * E.N; rj.f.frequency.value = pit ? 1400 : 16000; }
  // cabine do jato: o ruído gravado lá dentro toma o lugar do rugido de fora
  const rc = eng.recC;
  if (rc) { rc.g.gain.value = jet && pit ? vol * 0.55 * (0.5 + 0.5 * Math.min(1, E.N)) : 0; rc.s.playbackRate.value = 0.85 + 0.2 * (E ? E.N : 0); if (jet && pit && rj) rj.g.gain.value *= 0.35; }

  if (jet) {
    const n = Math.max(0, (E.N - E.E.nIdle) / (1 - E.E.nIdle)), [r0, r1] = sd.roar || [300, 1200], [w0, w1] = sd.whine || [1800, 3400];
    const wh = w0 + E.N * (w1 - w0);
    eng.jet.f.frequency.value = (r0 + n * (r1 - r0) + q.ias * 1.2) * (pit ? 0.6 : 1);
    eng.jet.w.frequency.value = wh; eng.jet.w2.frequency.value = wh * 1.52 + 7; eng.jet.howl.frequency.value = wh * 0.48; // pás do compressor + uivo da entrada de ar
    eng.ab.f.frequency.value = 160 + 120 * E.ab;
  } else {
    const f = (sd.f0 || 45) + Math.min(E.power, 1.2) * ((sd.f1 || 85) - (sd.f0 || 45));
    eng.air.o.frequency.value = f; eng.air.o2.frequency.value = f / 2;
    eng.air.lfo.frequency.value = f / 6; // batida dos cilindros acompanha a rotação
    eng.air.prop.frequency.value = f * 0.36; eng.air.ex.frequency.value = 280 + f * 3.2; // passagem das pás e ronco do escapamento
    eng.air.f.frequency.value = pit ? 520 : 950;
  }
}
// gatilho: rajada gravada da Browning em laço (tom pelo calibre da metralhadora), solta rápido ao parar
function gunLoop(p, on) {
  const gl = eng.gunLoop; if (!gl) return;
  const mg = p && on ? p.guns.find(g => g.W.cal < 20 && g.ammo > 0 && !g.jam && !g.broken) : null, fire = !!(mg && p.firing);
  gl.g.gain.setTargetAtTime(fire ? (acam.mode === 2 ? 0.5 : 0.38) : 0, AC.currentTime, fire ? 0.01 : 0.04);
  if (mg) gl.s.playbackRate.value = Math.min(1.3, Math.max(0.85, 12.7 / mg.W.cal));
}
// Motores dos OUTROS aviões por perto: até 3 vozes, com Doppler (sobe chegando, cai indo embora) e lado estéreo.
// `skip` é o avião cujo motor já toca na voz principal (o jogador ou o mais próximo assistindo).
function voices(skip, on) {
  const Vs = eng.voices; if (!Vs) return;
  const cp = camera.position, lv = S.player && S.player.alive ? S.player.vel : null;
  const list = on ? planes.filter(q => q !== skip && !q.gone && q.pos.distanceTo(cp) < 1800).sort((a, b) => a.pos.distanceTo(cp) - b.pos.distanceTo(cp)).slice(0, Vs.length) : [];
  Vs.forEach((v, i) => {
    const q = list[i];
    if (!q) { v.g.gain.value = 0; if (v.recP) v.recP.g.gain.value = 0; if (v.recJ) v.recJ.g.gain.value = 0; return; }
    const d = Math.max(1, q.pos.distanceTo(cp)), E = q.eng, sd = E.E.snd || {};
    const rx = q.vel.x - (lv ? lv.x : 0), ry = q.vel.y - (lv ? lv.y : 0), rz = q.vel.z - (lv ? lv.z : 0);
    const radial = (rx * (q.pos.x - cp.x) + ry * (q.pos.y - cp.y) + rz * (q.pos.z - cp.z)) / d, dop = clamp(343 / (343 + radial), 0.55, 1.9);
    const a = soundAt(q.pos, 1);
    const lv2 = (q.alive && q.engineOn ? 0.5 : 0.04) / (1 + d / 70), rec = E.jet ? v.recJ : v.recP;
    v.g.gain.value = rec ? lv2 * 0.3 : lv2;
    if (v.recP) v.recP.g.gain.value = !E.jet ? lv2 * 1.6 : 0;
    if (v.recJ) v.recJ.g.gain.value = E.jet ? lv2 * 1.8 : 0;
    if (rec) rec.s.playbackRate.value = (E.jet ? 0.62 + 0.55 * E.N : 0.72 + 0.4 * Math.min(E.power, 1.2)) * dop;
    v.pan.pan.value = a.pan; v.air.frequency.value = Math.max(500, a.cut);
    if (E.jet) { v.o.type = 'sine'; v.og.gain.value = 0.08; const [w0, w1] = sd.whine || [1800, 3400]; v.o.frequency.value = (w0 + E.N * (w1 - w0)) * dop; v.nf.frequency.value = (sd.roar || [300, 1200])[1] * 0.6 * dop; }
    else { v.o.type = 'sawtooth'; v.og.gain.value = 0.45; const f = (sd.f0 || 45) + Math.min(E.power, 1.2) * ((sd.f1 || 85) - (sd.f0 || 45)); v.o.frequency.value = f * dop; v.nf.frequency.value = (280 + f * 3) * dop; }
  });
}

// vento: cresce com a pressão dinâmica (na cabine soa mais); trepidação perto do estol; rodas na pista
function wind(p, on) {
  const q = p ? Math.min(1, (p.ias / 260) ** 2) : 0;
  eng.wind.g.gain.value = on ? q * (acam.mode === 2 ? 0.13 : 0.1) : 0; eng.wind.f.frequency.value = 500 + q * 900;
  const as = p ? p.def.clmax / p.def.cla : 1, bf = p ? clamp((Math.abs(p.alpha) - as * 0.72) / (as * 0.3), 0, 1) * Math.min(1, p.ias / 60) : 0;
  eng.wind.buffet.gain.value = on ? bf * 0.5 : 0;
  const gv = p && p.onGround ? Math.hypot(p.vel.x, p.vel.z) : 0;
  eng.roll.g.gain.value = on ? Math.min(1, gv / 35) * 0.16 : 0; eng.roll.f.frequency.value = 110 + gv * 4;
}
// avião passando perto da câmera ("vush") e estrondo de quem cruza Mach 1 por perto
const passMem = new WeakMap();
function passes(on) {
  if (!on) return;
  for (const q of planes) {
    if (!q.alive || q === S.player) continue;
    const d = q.pos.distanceTo(camera.position), m = passMem.get(q) || { d, mach: q.mach || 0, t: 0 };
    if (m.d < 160 && d > m.d && m.closing && performance.now() - m.t > 1500) { sndWhoosh(q.pos, Math.min(1.5, q.ias / 180), !!q.eng.jet); m.t = performance.now(); }
    m.closing = d < m.d;
    if (d < 1800 && (m.mach < 1) !== ((q.mach || 0) < 1) && (q.mach || 0) >= 1) sndSonicBoom(q.pos);
    m.d = d; m.mach = q.mach || 0; passMem.set(q, m);
  }
}
// eventos do jogador (radar/RWR/MAW) viram bipes curtos
function cockpitEvents(p) {
  const s = p.sys;
  if (s.radar) for (const e of s.radar.events.splice(0)) {
    if (e.k === 'contact' && !s.radar.ranging) cockpitTone(2300, 2300, 0.025, 0.02);
    else if (e.k === 'track') cockpitTone(900, 900, 0.06, 0.035);
    else if (e.k === 'lock') { cockpitTone(1200, 1200, 0.07, 0.045); cockpitTone(1650, 1650, 0.09, 0.045, 'sine', 0.09); }
    else if (e.k === 'lost') cockpitTone(1100, 480, 0.3, 0.045, 'triangle');
    else if (e.k === 'unlock') cockpitTone(700, 700, 0.05, 0.03);
  }
  if (s.rwr) {
    const sd = s.rwr.W.snd;
    for (const e of s.rwr.events.splice(0)) {
      if (e.k === 'new' && e.lvl === 'SEARCH') { const [a, b, d, w] = sd.search; for (let i = 0; i < 3; i++) cockpitTone(a, b, d, 0.035, w, i * (d + 0.035)); }
      else if (e.k === 'up' || (e.k === 'new' && e.lvl !== 'SEARCH')) cockpitTone(sd.lock[0] * 1.2, sd.lock[0] * 1.2, 0.12, 0.05, sd.lockType);
      else if (e.k === 'lost' && e.lvl !== 'SEARCH') cockpitTone(sd.lock[0], sd.lock[0] * 0.5, 0.35, 0.03, sd.lockType);
    }
  }
  if (s.maw) for (const e of s.maw.events.splice(0)) if (e.k === 'launch') { cockpitTone(600, 1800, 0.25, 0.06, 'sawtooth'); cockpitTone(600, 1800, 0.25, 0.06, 'sawtooth', 0.3); }
}
function drain(p) { if (p) for (const k in p.sys) p.sys[k].events.length = 0; }

// detentes da manete e ignição/corte da pós-combustão
function detents(p) {
  const t = p.throttle;
  if (prevThr >= 0 && ((t >= 1 && prevThr < 1) || (t <= 0 && prevThr > 0))) cockpitTone(180, 120, 0.04, 0.05, 'square');
  if (p.wep !== prevWep && p.canBoost) cockpitTone(p.wep ? 240 : 160, p.wep ? 300 : 120, 0.06, 0.05, 'square');
  const ab = p.eng.hasAB ? p.eng.ab : 0;
  if (ab > 0.02 && prevAB <= 0.02) { cockpitThump(0.7, 55, 0.6); sndAB(); }
  if (p.gearCmd !== prevGear) sndGear(p.gearCmd > 0.5);
  if (p.flapStage !== prevFlap) sndFlaps();
  if (p.touchT && p.touchT !== prevTouch) sndTouch(Math.min(1.4, 0.4 + (p.touchV || 0) / 4));
  prevThr = t; prevAB = ab; prevWep = p.wep; prevGear = p.gearCmd; prevFlap = p.flapStage; prevTouch = p.touchT || 0;
}

// tons contínuos: buscador IR e alerta de maior prioridade
function tones(p, dt) {
  const st = p && B.seeker && p.rack && !S.paused ? B.seeker.state : LOCK.OFF;
  const sk = eng.seek;
  if (st === LOCK.LOCKED) { sk.o.frequency.value = 1450; sk.g.gain.value = 0.05; }
  else if (st === LOCK.TRACK) { sk.o.frequency.value = 520 + Math.sin(performance.now() / 40) * 60; sk.g.gain.value = 0.035; }
  else if (st === LOCK.SEARCH) { sk.o.frequency.value = 260; sk.g.gain.value = 0.012; }
  else sk.g.gain.value = 0;
  const w = p && !S.paused ? B.warnTone : null, wn = eng.warn, rs = p && p.sys.rwr ? p.sys.rwr.W.snd : null;
  beepT += dt;
  const pulse = (hz, duty) => ((beepT * hz) % 1 < duty);
  wn.o.type = 'square';
  if (w === 'maw') { wn.o.frequency.value = 900 + 700 * ((beepT * 4) % 1); wn.g.gain.value = 0.035; }
  else if (w === 'guidance' && rs && rs.guidance) { const [a, b, hz] = rs.guidance; wn.o.type = 'sine'; wn.o.frequency.value = pulse(hz, 0.5) ? b : a; wn.g.gain.value = 0.05; }
  else if ((w === 'lock' || w === 'guidance') && rs) { const [f, hz] = rs.lock; wn.o.type = rs.lockType; wn.o.frequency.value = f; wn.g.gain.value = !hz || pulse(hz, 0.55) ? 0.035 : 0; }
  else if (w === 'track' && rs) { wn.o.type = rs.lockType; wn.o.frequency.value = rs.lock[0] * 0.8; wn.g.gain.value = pulse(1.5, 0.25) ? 0.025 : 0; }
  else if (w === 'launch') { wn.o.frequency.value = pulse(6, 0.5) ? 1500 : 1100; wn.g.gain.value = 0.04; } // lançamento visto: alterna agudo rápido
  else if (w === 'pullup') { wn.o.frequency.value = 700; wn.g.gain.value = pulse(5, 0.5) ? 0.03 : 0; }
  else if (w === 'stall') { wn.o.frequency.value = 330; wn.g.gain.value = pulse(3, 0.6) ? 0.025 : 0; }
  else wn.g.gain.value = 0;
}
export function airAudioOff() { if (!eng.jet) return; for (const v of eng.voices) { v.g.gain.value = 0; if (v.recP) v.recP.g.gain.value = 0; if (v.recJ) v.recJ.g.gain.value = 0; } for (const r of [eng.recP, eng.recJ, eng.recC, eng.gunLoop]) if (r) r.g.gain.value = 0; eng.roll.g.gain.value = 0; eng.wind.buffet.gain.value = 0; eng.jet.g.gain.value = 0; eng.ab.g.gain.value = 0; eng.wind.g.gain.value = 0; eng.rumble.g.gain.value = 0; eng.seek.g.gain.value = 0; eng.warn.g.gain.value = 0; eng.air.g.gain.value = 0; }
