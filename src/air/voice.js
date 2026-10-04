import { clamp } from '../core/util.js';
// =====================================================================
// Voz de alerta (estilo caça moderno): frases curtas em inglês, repetidas;
// quanto maior o perigo, menor o intervalo. Só fala quem tem RWR/MAW — avião
// sem aviônica de alerta fica nos tons. A ameaça vem só dos sistemas, como
// na HUD (que não escreve nada disso: é voz + símbolos). Fala pelo
// sintetizador do navegador (speechSynthesis), grave e rápida.
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

// alerta de maior prioridade agora: { k, gap } (gap = segundos até repetir), ou null
export function pickVoice(p, agl) {
  const rw = p.sys.rwr, mw = p.sys.maw;
  if (!rw && !mw) return null;
  const vy = p.vel.y, ground = !p.onGround && vy < -12 ? agl / -vy : Infinity; // segundos até o chão
  if (ground < 5) return { k: 'pullup', gap: 0.9 };
  const m = mw && mw.list[0];
  if (m) return { k: 'missile', gap: clamp(m.tti * 0.25, 0.6, 2) };
  const lvl = rw && rw.top && rw.top.lvl;
  if (lvl === 'GUIDANCE') return { k: 'guidance', gap: 1.4 };
  if (ground < 10) return { k: 'altitude', gap: 1.8 };
  if (lvl === 'LOCK') return { k: 'lock', gap: 2.5 };
  if (lvl === 'TRACK') return { k: 'track', gap: 5 };
  return null;
}

const SYN = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
let cur = null, wait = 0, quiet = 0, voice = null;
// a: saída de pickVoice; vol 0 = cala na hora (pausa, morte, fora da partida)
export function voiceStep(a, dt, vol) {
  if (!SYN) return;
  if (vol <= 0) { if (cur) SYN.cancel(); cur = null; return; }
  wait -= dt;
  // ameaça some por um instante (RWR oscila entre níveis): não repete a 1ª frase
  if (!a) { if ((quiet += dt) > 1.5) cur = null; return; }
  quiet = 0;
  const first = a.k !== cur, busy = SYN.speaking || wait > 0;
  if (first ? cur && RANK.indexOf(a.k) > RANK.indexOf(cur) && busy : busy) return; // menos grave espera a vez
  voice = voice || SYN.getVoices().find(v => v.lang === 'en-US') || SYN.getVoices().find(v => /^en/i.test(v.lang)) || null;
  const L = SAY[a.k], u = new SpeechSynthesisUtterance(L[first ? 0 : L.length - 1]);
  u.lang = 'en-US'; if (voice) u.voice = voice; u.pitch = 0.2; u.rate = 1.4; u.volume = clamp(vol, 0, 1);
  SYN.cancel(); SYN.speak(u);
  cur = a.k; wait = a.gap;
}
