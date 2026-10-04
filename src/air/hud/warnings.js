import { H } from '../../world/terrain.js';
import { B } from '../battle.js';
import { g, V, C, UI, txt } from './kit.js';
import { S } from '../../core/state.js';
// =====================================================================
// Alertas centrais por prioridade. Ameaças vêm SÓ dos sistemas da aeronave:
// RWR (rastreio, trava, guiamento) e MAW. Rastreio/trava/míssil NUNCA viram
// texto: são voz (voice.js) + tom + arco de direção aqui + símbolos no painel
// do RWR/MAW. Sem sistema, não há alerta — o piloto precisa ver a fumaça.
// Também define o tom de alerta (B.warnTone).
// =====================================================================

export function warnings(p) {
  const list = [], rw = p.sys.rwr, mw = p.sys.maw;
  let tone = null, arc = null;
  // lançamento de míssil: só som aqui; o MAW mostra no próprio painel (scopes.js), sem texto no centro
  if (mw && mw.list.length) tone = 'maw';
  else if (B.launches.some(l => l.how === 'visual' && S.now - l.at < 4)) tone = 'launch';
  const th = rw && rw.top;
  if (th && th.lvl !== 'SEARCH') {
    tone = tone || { GUIDANCE: 'guidance', LOCK: 'lock', TRACK: 'track' }[th.lvl];
    if (!arc) arc = { az: th.az, col: th.lvl === 'TRACK' ? C.amber : C.enemy, k: th.strength, wide: rw.W.res >= 90 };
  }
  if (tone === 'launch' && th && th.lvl === 'GUIDANCE') tone = 'guidance'; // guiamento contra você vale mais que o lançamento visto
  // estol = asa perto do ângulo crítico de verdade (a física perde sustentação acima de clmax/cla), só no ar.
  // Antes: 90% do ângulo (o instrutor chega a 94% com flaps numa curva comum) ou velocidade < estol limpo ao nível
  // do mar — tocava em curva, na aproximação com flaps e até parado no chão.
  const as = p.def.clmax / p.def.cla, agl0 = p.pos.y - H(p.pos.x, p.pos.z), stall = !p.onGround && agl0 > 5 && Math.abs(p.alpha) > as * 0.97;
  if (stall) list.push(['ESTOL', C.amber, true]);
  const agl = p.pos.y - H(p.pos.x, p.pos.z), pull = agl < 220 && p.vel.y < -12;
  if (pull) list.push(['ALTITUDE · PUXE', C.enemy, true]);
  if (!p.eng.jet && Math.abs(p.n) > p.def.glim * 0.85) list.push(['SOBRECARGA G', C.enemy, false]);
  if (p.ias > p.def.vne * 0.95) list.push(['VELOCIDADE-LIMITE', C.amber, true]);
  if (p.guns.some(q => q.jam)) list.push(['ARMA SUPERAQUECIDA', C.amber, false]);
  if (p.oobT > 0) list.push([`RETORNE À ÁREA · ${Math.ceil(15 - p.oobT)} s`, C.amber, true]);
  list.slice(0, 3).forEach(([t, c, bl], i) => {
    if (bl && Math.sin(V.blink * 9) < -0.2) return;
    g.font = `600 22px ${UI}`; const tw = g.measureText(t).width + 26, x = V.W / 2 - tw / 2, y = V.H * 0.27 + i * 34;
    g.fillStyle = 'rgba(8,11,9,.55)'; g.fillRect(x, y - 21, tw, 29); g.strokeStyle = c; g.lineWidth = 1.5; g.strokeRect(x, y - 21, tw, 29);
    txt(t, V.W / 2, y + 1, 22, c, 'center', UI);
  });
  // arco de direção (vista de cima: alto = nariz); quadrante do SPO-10 vira arco largo
  if (arc) {
    const R = Math.min(V.W, V.H) * 0.33, a = arc.az - Math.PI / 2, w = arc.wide ? 0.7 : 0.2;
    g.beginPath(); g.arc(V.W / 2, V.H / 2, R, a - w, a + w);
    g.lineWidth = arc.wide ? 2 + 3 * arc.k : 4 + 5 * arc.k; g.strokeStyle = arc.col; g.globalAlpha = 0.45 + 0.4 * Math.abs(Math.sin(V.blink * 6)); g.stroke(); g.globalAlpha = 1;
  }
  B.warnTone = tone || (pull ? 'pullup' : stall ? 'stall' : null);
}
