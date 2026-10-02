import { camera } from '../core/render.js';
import { S, planes } from '../core/state.js';
import { AC, eng, cockpitTone, cockpitThump, sndWhoosh, sndSonicBoom } from '../fx/audio.js';
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
let beepT = 0, prevThr = -1, prevAB = 0, prevWep = false;
export function airAudio(dt) {
  if (!AC || !eng.jet) return;
  const live = S.state === 'play' || S.state === 'spectate' || S.state === 'end';
  const p = S.player && S.player.alive ? S.player : null;
  let near = p, nd = 0;
  if (!near) { nd = 1e9; for (const q of planes) { if (!q.alive) continue; const d = q.pos.distanceTo(camera.position); if (d < nd) { nd = d; near = q; } } }
  const vol = !live || S.paused || !near ? 0 : (p ? 1 : 1.6 / (1 + nd / 150)) * (near.engineOn ? 1 : 0.1);
  engine(near, vol);
  wind(p, live && !S.paused);
  passes(live && !S.paused);
  if (p && !S.paused && S.state === 'play') { cockpitEvents(p); detents(p); }
  else drain(p);
  tones(p, dt);
}

function engine(q, vol) {
  const E = q && q.eng, jet = E && E.jet, sd = E ? E.E.snd || {} : {};
  // pistão no WEP: mais alto e mais "sujo" (a distorção vem do ganho maior entrando no waveshaper)
  eng.air.g.gain.value = E && !jet ? vol * (0.06 + 0.05 * Math.max(0, E.power - 1) * 10) : 0;
  eng.jet.g.gain.value = jet ? vol * 0.09 : 0;
  // PC: ronco com estalos (ganho tremendo aleatoriamente a cada quadro)
  eng.ab.g.gain.value = jet ? vol * (sd.ab || 0) * E.ab * (0.75 + Math.random() * 0.5) : 0;
  eng.rumble.g.gain.value = jet ? vol * (0.05 + 0.12 * Math.min(1, E.output)) : 0;
  if (!E) return;
  if (jet) {
    const n = Math.max(0, (E.N - E.E.nIdle) / (1 - E.E.nIdle)), [r0, r1] = sd.roar || [300, 1200], [w0, w1] = sd.whine || [1800, 3400];
    eng.jet.f.frequency.value = r0 + n * (r1 - r0) + q.ias * 1.2; eng.jet.w.frequency.value = w0 + E.N * (w1 - w0);
    eng.ab.f.frequency.value = 160 + 120 * E.ab;
  } else {
    const f = (sd.f0 || 45) + Math.min(E.power, 1.2) * ((sd.f1 || 85) - (sd.f0 || 45));
    eng.air.o.frequency.value = f; eng.air.o2.frequency.value = f / 2;
    eng.air.lfo.frequency.value = f / 6; // batida dos cilindros acompanha a rotação
  }
}

// vento: cresce com a pressão dinâmica; na cabine (câmera 2) abafa um pouco
function wind(p, on) {
  const q = p ? Math.min(1, (p.ias / 260) ** 2) : 0;
  eng.wind.g.gain.value = on ? q * 0.11 : 0; eng.wind.f.frequency.value = 500 + q * 900;
}
// avião passando perto da câmera ("vush") e estrondo de quem cruza Mach 1 por perto
const passMem = new WeakMap();
function passes(on) {
  if (!on) return;
  for (const q of planes) {
    if (!q.alive || q === S.player) continue;
    const d = q.pos.distanceTo(camera.position), m = passMem.get(q) || { d, mach: q.mach || 0, t: 0 };
    if (m.d < 160 && d > m.d && m.closing && performance.now() - m.t > 1500) { sndWhoosh(q.pos, Math.min(1.5, q.ias / 180)); m.t = performance.now(); }
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
  const ab = p.eng.ab;
  if (ab > 0.02 && prevAB <= 0.02) cockpitThump(0.7, 55, 0.6);
  prevThr = t; prevAB = ab; prevWep = p.wep;
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
  else if (w === 'pullup') { wn.o.frequency.value = 700; wn.g.gain.value = pulse(5, 0.5) ? 0.03 : 0; }
  else if (w === 'stall') { wn.o.frequency.value = 330; wn.g.gain.value = pulse(3, 0.6) ? 0.025 : 0; }
  else wn.g.gain.value = 0;
}
export function airAudioOff() { if (!eng.jet) return; eng.jet.g.gain.value = 0; eng.ab.g.gain.value = 0; eng.wind.g.gain.value = 0; eng.rumble.g.gain.value = 0; eng.seek.g.gain.value = 0; eng.warn.g.gain.value = 0; eng.air.g.gain.value = 0; }
