import SamJs from 'sam-js';
import { clamp } from '../core/util.js';
// =====================================================================
// Voz de alerta (estilo caça moderno): frases curtas em inglês, repetidas;
// quanto maior o perigo, menor a pausa entre repetições. Só fala quem tem
// RWR/MAW — avião sem aviônica de alerta fica nos tons. A ameaça vem só dos
// sistemas, como na HUD (que não escreve nada disso: é voz + símbolos).
// Fala sintetizada pelo SAM (sam-js, voz robótica de 8 bits) e tocada pelo
// áudio do jogo (cockpitVoice, filtro de rádio, volume de efeitos).
// =====================================================================
// ordem = prioridade (a de cima interrompe as de baixo); [primeira vez, repetição]
const SAY = {
  pullup: ['PULL UP! PULL UP!'],
  missile: ['MISSILE! MISSILE!'],
  guidance: ['MISSILE LOCK!', 'MISSILE LOCK! MISSILE LOCK!'],
  altitude: ['ALTITUDE! ALTITUDE!'],
  lock: ['RADAR LOCK!', 'LOCK! LOCK!'],
  track: ['WARNING! WARNING!'],
};
const RANK = Object.keys(SAY);
export const VOICE_RATE = 22050; // taxa de amostragem do SAM

// alerta de maior prioridade agora: { k, gap } (gap = pausa em s entre repetições), ou null
export function pickVoice(p, agl) {
  const rw = p.sys.rwr, mw = p.sys.maw;
  if (!rw && !mw) return null;
  const vy = p.vel.y, ground = !p.onGround && vy < -12 ? agl / -vy : Infinity; // segundos até o chão
  if (ground < 5) return { k: 'pullup', gap: 0.15 };
  const m = mw && mw.list[0];
  if (m) return { k: 'missile', gap: clamp(m.tti * 0.12, 0.1, 1.5) };
  const lvl = rw && rw.top && rw.top.lvl;
  if (lvl === 'GUIDANCE') return { k: 'guidance', gap: 0.4 };
  if (ground < 10) return { k: 'altitude', gap: 0.7 };
  if (lvl === 'LOCK') return { k: 'lock', gap: 1.5 };
  if (lvl === 'TRACK') return { k: 'track', gap: 4 };
  return null;
}

const sam = new SamJs({ speed: 68, pitch: 72, throat: 190, mouth: 190 }), pcm = new Map();
let cur = null, busy = 0, wait = 0, quiet = 0;
// Retorno: undefined = nada a fazer; null = cale a fala em curso; Float32Array = toque isto agora.
export function voiceStep(a, dt, on) {
  if (!on) { const was = cur; cur = null; busy = wait = quiet = 0; return was ? null : undefined; }
  busy -= dt; wait -= dt;
  // ameaça some por um instante (RWR oscila entre níveis): não recomeça pela 1ª frase
  if (!a) { if ((quiet += dt) > 1.5) cur = null; return; }
  quiet = 0;
  const first = a.k !== cur;
  if (first ? cur && RANK.indexOf(a.k) > RANK.indexOf(cur) && busy > 0 : wait > 0) return; // menos grave espera a vez
  const L = SAY[a.k], t = L[first ? 0 : L.length - 1];
  if (!pcm.has(t)) pcm.set(t, sam.buf32(t));
  const b = pcm.get(t);
  cur = a.k; busy = b.length / VOICE_RATE; wait = busy + a.gap;
  return b;
}
