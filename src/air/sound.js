import { camera } from '../core/render.js';
import { S, planes } from '../core/state.js';
import { AC, eng } from '../fx/audio.js';
import { B } from './battle.js';
import { LOCK } from './targeting.js';
// =====================================================================
// AudioSystem do modo aéreo: motor a pistão ou turbina do avião mais
// próximo (o seu, se vivo), tom do buscador (rosnado em rastreio, tom
// contínuo travado) e alarmes de míssil e estol. Tudo sintetizado.
// =====================================================================
let beepT = 0;
export function airAudio(dt) {
  if (!AC || !eng.jet) return;
  const live = S.state === 'play' || S.state === 'spectate' || S.state === 'end';
  const p = S.player && S.player.alive ? S.player : null;
  let near = p, nd = 0;
  if (!near) { nd = 1e9; for (const q of planes) { if (!q.alive) continue; const d = q.pos.distanceTo(camera.position); if (d < nd) { nd = d; near = q; } } }
  const vol = !live || S.paused || !near ? 0 : (p ? 1 : 1.6 / (1 + nd / 150)) * (near.engineOn ? 1 : 0.1);
  const jet = near && near.def.jet;
  eng.air.g.gain.value = jet ? 0 : vol * 0.06;
  eng.jet.g.gain.value = jet ? vol * 0.09 : 0;
  if (near) {
    const thr = jet ? near.spool : near.throttle;
    eng.air.o.frequency.value = 45 + thr * 40 + (near.wep ? 8 : 0); eng.air.o2.frequency.value = eng.air.o.frequency.value / 2;
    eng.jet.f.frequency.value = 300 + thr * 900 + near.ias * 1.5; eng.jet.w.frequency.value = 1800 + thr * 1600;
  }
  // tons de cockpit
  const st = p && B.seeker && p.missiles > 0 && !S.paused ? B.seeker.state : LOCK.OFF;
  const sk = eng.seek;
  if (st === LOCK.LOCKED) { sk.o.frequency.value = 1450; sk.g.gain.value = 0.05; }
  else if (st === LOCK.TRACK) { sk.o.frequency.value = 520 + Math.sin(performance.now() / 40) * 60; sk.g.gain.value = 0.035; }
  else if (st === LOCK.SEARCH) { sk.o.frequency.value = 260; sk.g.gain.value = 0.012; }
  else sk.g.gain.value = 0;
  const w = p && !S.paused ? B.warnTone : null;
  beepT += dt;
  if (w === 'missile') { eng.warn.o.frequency.value = 1150; eng.warn.g.gain.value = (beepT * 8) % 1 < 0.5 ? 0.03 : 0; }
  else if (w === 'stall') { eng.warn.o.frequency.value = 330; eng.warn.g.gain.value = (beepT * 3) % 1 < 0.6 ? 0.025 : 0; }
  else eng.warn.g.gain.value = 0;
}
export function airAudioOff() { if (!eng.jet) return; eng.jet.g.gain.value = 0; eng.seek.g.gain.value = 0; eng.warn.g.gain.value = 0; eng.air.g.gain.value = 0; }
