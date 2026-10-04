import { S } from '../../core/state.js';
import { clamp } from '../../core/util.js';
import { B, CAUSE_TXT } from '../battle.js';
import { g, V, C, MONO, UI, ptxt, plate } from './kit.js';
// =====================================================================
// Cartões de dano (como no WT):
//  - ABATE: quando você derruba alguém — avião, causa, o que você acertou e com o quê;
//  - MORTE: quando você cai — quem te derrubou, com que munição, causa e o que você levou.
// Os dados vêm de hitSummary (planeDamage.js), gravados a cada acerto.
// =====================================================================
const who = pl => (pl ? `${pl.isPlayer ? 'Você' : pl.who ? pl.who.name : '?'} · ${pl.def.short}` : '—');
const cap = t => (t ? t[0].toUpperCase() + t.slice(1) : '');
// texto que cabe na largura (corta com reticências)
function fit(t, w, font) { g.font = font; if (g.measureText(t).width <= w) return t; while (t.length > 3 && g.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }

// lista "componente ........ estado" com cor pelo estado
function rows(parts, x, y, w, T) {
  for (const r of parts) {
    const bad = /perdid|cortad|destru|arrancad|parad|mort|vazio|travad/.test(r.state), warn = /vazando|ferido|%/.test(r.state) && !bad;
    ptxt(r.label, x, y, 12.5, T.fg, 'left', UI, 500);
    ptxt(r.state, x + w, y, 12, bad ? C.enemy : warn ? C.amber : T.dim, 'right', MONO, 500);
    y += 17;
  }
  return y;
}

export function killCard(T) {
  const c = B.killCard; if (!c) return;
  const age = S.now - c.at, life = 5.5; if (age > life) { B.killCard = null; return; }
  const n = c.sum.parts.length, w = 400, h = 76 + n * 17 + (c.sum.more ? 14 : 0) + 18, x = V.W / 2 - w / 2, y = V.H * 0.58; // abaixo da mira: o centro-alto é das mensagens de acerto
  g.globalAlpha = clamp((life - age) * 2, 0, 1) * clamp(age * 6, 0, 1);
  plate(x, y, w, h, T);
  ptxt('ABATIDO · +100', x + 18, y + 24, 13, C.enemy, 'left', UI, 800);
  ptxt(who(c.v), x + w - 16, y + 24, 14, T.fg, 'right', UI, 700);
  ptxt(cap(CAUSE_TXT[c.cause] || 'derrubado'), x + 18, y + 44, 15, C.amber, 'left', UI, 700);
  g.fillStyle = T.faint; g.fillRect(x + 16, y + 54, w - 32, 1);
  let yy = rows(c.sum.parts, x + 18, y + 72, w - 36, T);
  if (c.sum.more) { ptxt(`+ ${c.sum.more} componente${c.sum.more > 1 ? 's' : ''}`, x + 18, yy, 11, T.dim, 'left', UI, 600); yy += 14; }
  ptxt(fit(c.sum.weapons.join(' · '), w - 36, `500 11px ${MONO}`), x + 18, yy + 4, 11, T.dim, 'left', MONO, 500);
  g.globalAlpha = 1;
}

export function deathCard(T) {
  const c = B.deathCard; if (!c || S.state === 'end') return;
  const age = S.now - c.at; if (age > 9) return;
  const n = c.sum.parts.length, w = 460, h = 112 + n * 17 + (c.sum.more ? 14 : 0), x = V.W / 2 - w / 2, y = V.H * 0.3;
  g.globalAlpha = clamp(age * 4, 0, 1) * clamp((9 - age) * 2, 0, 1);
  plate(x, y, w, h, T);
  ptxt('VOCÊ FOI ABATIDO', x + 18, y + 26, 18, C.enemy, 'left', UI, 800);
  ptxt(cap(CAUSE_TXT[c.cause] || 'derrubado'), x + w - 16, y + 26, 14, C.amber, 'right', UI, 700);
  ptxt(c.k ? `por ${who(c.k)}` : 'sem atirador (queda/colisão)', x + 18, y + 48, 14, T.fg, 'left', UI, 600);
  if (c.kw.length) ptxt(fit(c.kw.join(' · '), w - 36, `500 11px ${MONO}`), x + 18, y + 66, 11, T.dim, 'left', MONO, 500);
  g.fillStyle = T.faint; g.fillRect(x + 16, y + 76, w - 32, 1);
  ptxt('O QUE VOCÊ LEVOU', x + 18, y + 92, 10.5, T.dim, 'left', UI, 700);
  let yy = rows(c.sum.parts, x + 18, y + 110, w - 36, T);
  if (c.sum.more) ptxt(`+ ${c.sum.more} componente${c.sum.more > 1 ? 's' : ''}`, x + 18, yy, 11, T.dim, 'left', UI, 600);
  g.globalAlpha = 1;
}
