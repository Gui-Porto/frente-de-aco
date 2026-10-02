import { H } from '../../world/terrain.js';
import { B } from '../battle.js';
import { g, V, C, UI, txt, clock } from './kit.js';
import { S } from '../../core/state.js';
import { losAngles } from '../systems/radar.js';
const clockTo = (p, pos) => clock(losAngles(p, pos).az);
// =====================================================================
// Alertas centrais por prioridade. Ameaças vêm SÓ dos sistemas da aeronave:
// MAW (lançamento/aproximação), RWR (rastreio, trava, guiamento). Sem
// sistema, não há alerta — o piloto precisa ver a fumaça. Também define o
// tom de alerta (B.warnTone) e desenha o arco de direção da ameaça.
// =====================================================================
const QUAD = { FD: 'frente à direita', TD: 'atrás à direita', TE: 'atrás à esquerda', FE: 'frente à esquerda' };
const where = (rw, az) => (rw && rw.W.res >= 90 ? QUAD[(az >= 0 ? (Math.abs(az) < Math.PI / 2 ? 'FD' : 'TD') : (Math.abs(az) < Math.PI / 2 ? 'FE' : 'TE'))] : clock(az));
const stallV = p => Math.sqrt(2 * p.def.mass * 9.81 / (1.225 * p.def.S * p.def.clmax)) * 0.95;

export function warnings(p) {
  const list = [], rw = p.sys.rwr, mw = p.sys.maw;
  let tone = null, arc = null;
  if (mw && mw.list.length) {
    const m = mw.list[0];
    list.push([`LANÇAMENTO DE MÍSSIL · ${clock(m.az)} · ${Math.max(1, Math.round(m.tti))} s`, C.enemy, true]);
    tone = 'maw'; arc = { az: m.az, col: C.enemy, k: 1 };
  }
  const vis = B.launches.find(l => l.how === 'visual' && S.now - l.at < 4);
  if (vis && !(mw && mw.list.length)) {
    list.push([`LANÇAMENTO DE MÍSSIL · ${clockTo(p, vis.owner.pos)}${vis.mine ? ' · CONTRA VOCÊ' : ''}`, C.enemy, true]);
    tone = tone || 'launch';
  }
  const th = rw && rw.top;
  if (th && th.lvl !== 'SEARCH') {
    const ty = th.type ? ` (${th.type})` : '';
    if (th.lvl === 'GUIDANCE') list.push([`MÍSSIL GUIADO${ty} · ${where(rw, th.az)}`, C.enemy, true]);
    else if (th.lvl === 'LOCK') list.push([`TRAVADO PELO RADAR${ty} · ${where(rw, th.az)}`, C.enemy, false]);
    else list.push([`RASTREADO${ty} · ${where(rw, th.az)}`, C.amber, false]);
    tone = tone || { GUIDANCE: 'guidance', LOCK: 'lock', TRACK: 'track' }[th.lvl];
    if (!arc) arc = { az: th.az, col: th.lvl === 'TRACK' ? C.amber : C.enemy, k: th.strength, wide: rw.W.res >= 90 };
  }
  if (tone === 'launch' && th && th.lvl === 'GUIDANCE') tone = 'guidance'; // guiamento contra você vale mais que o lançamento visto
  const as = p.def.clmax / p.def.cla, stall = Math.abs(p.alpha) > as * 0.9 || p.ias < stallV(p);
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
