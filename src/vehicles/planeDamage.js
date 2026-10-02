import { S } from '../core/state.js';
import { clamp } from '../core/util.js';
import { segBox } from '../combat/ballistics.js';
import { fxExplosion } from '../fx/particles.js';
import { showDmg } from '../ui/hud.js';
// =====================================================================
// Dano por módulos (estilo WT): cada avião tem componentes internos com
// caixa própria no espaço do corpo. A bala entra pela casca (asa, cauda,
// fuselagem), segue em linha reta alguns metros e acerta o que estiver no
// caminho, perdendo energia a cada componente. Granadas explosivas
// espalham estilhaços em volta do ponto de entrada.
// Efeitos: tanque perfurado vaza e pode pegar fogo, radiador vaza e o
// motor superaquece, superfícies de comando travam, munição detona,
// armas deixam de funcionar, piloto ferido aguenta menos G.
// =====================================================================
export const LABEL = {
  pilot: 'Piloto', engine: 'Motor', cool: 'Radiador', hyd: 'Hidráulico', fuelF: 'Tanque da fuselagem', fuelL: 'Tanque da asa esq.', fuelR: 'Tanque da asa dir.',
  ammoL: 'Munição esq.', ammoR: 'Munição dir.', gunL: 'Armas esq.', gunR: 'Armas dir.', ailL: 'Aileron esq.', ailR: 'Aileron dir.', elev: 'Profundor', rud: 'Leme', cables: 'Cabos de comando',
};
const FUEL = { spit9: 270, p47: 900, fw190: 400, il2: 600, f86: 1300, mig15: 1100 };
export const fuelOf = D => D.fuel || FUEL[D.key] || 400;

// Componentes gerados das dimensões do avião: { name, kind, c:[x,y,z], h:[hx,hy,hz], hp, max }
export function planeModules(D) {
  const L = D.L, fr = D.fuseR, sp = D.span, jet = !!D.jet, sw = t => sp / 2 * t * Math.tan((D.sweep || 0) * Math.PI / 180);
  const cz = jet ? L * 0.24 : D.key === 'il2' ? L * 0.08 : -L * 0.02;
  const gunsInWing = !jet && D.guns.some(g => g.span[0] > fr * 1.5);
  const gx = gunsInWing ? D.guns[0].span[0] : fr * 0.55, gz = gunsInWing ? D.wingZ - D.chord * 0.15 - sw(gx / (sp / 2)) : L * 0.3;
  const M = [
    ['pilot', 'pilot', [0, fr * 0.65, cz], [0.32, 0.45, 0.45], 8],
    ['engine', 'engine', jet ? [0, 0, -L * 0.17] : [0, 0, L * 0.33], jet ? [fr * 0.7, fr * 0.7, L * 0.17] : [fr * 0.82, fr * 0.82, L * 0.1], 0],
    [jet ? 'hyd' : 'cool', jet ? 'hyd' : 'cool', jet ? [0, -fr * 0.4, -L * 0.02] : [0, -fr * 0.75, D.key === 'p47' ? L * 0.2 : L * 0.08], [fr * 0.45, fr * 0.25, 0.45], 6],
    ['fuelF', 'fuel', jet ? [0, 0, L * 0.06] : [0, 0, L * 0.15], [fr * 0.7, fr * 0.65, jet ? L * 0.1 : L * 0.07], 10],
    ['fuelL', 'fuel', [fr + sp * 0.09, -0.1, D.wingZ - D.chord * 0.05 - sw(0.25)], [sp * 0.08, 0.13, D.chord * 0.25], 8],
    ['fuelR', 'fuel', [-(fr + sp * 0.09), -0.1, D.wingZ - D.chord * 0.05 - sw(0.25)], [sp * 0.08, 0.13, D.chord * 0.25], 8],
    ['ammoL', 'ammo', [gx + (gunsInWing ? 0.4 : 0), -0.05, gz - 0.4], [0.32, 0.14, 0.45], 6],
    ['ammoR', 'ammo', [-gx - (gunsInWing ? 0.4 : 0), -0.05, gz - 0.4], [0.32, 0.14, 0.45], 6],
    ['gunL', 'gun', [gx, -0.05, gz + 0.35], [0.22, 0.12, 0.5], 5],
    ['gunR', 'gun', [-gx, -0.05, gz + 0.35], [0.22, 0.12, 0.5], 5],
    ['ailL', 'ctrl', [sp * 0.38, 0, D.wingZ - D.chord * 0.55 - sw(0.76)], [sp * 0.11, 0.07, D.chord * 0.14], 6],
    ['ailR', 'ctrl', [-sp * 0.38, 0, D.wingZ - D.chord * 0.55 - sw(0.76)], [sp * 0.11, 0.07, D.chord * 0.14], 6],
    ['elev', 'ctrl', [0, D.key === 'mig15' ? L * 0.09 : 0.1, -L * 0.5], [sp * 0.17, 0.07, 0.28], 7],
    ['rud', 'ctrl', [0, fr * 0.6 + L * 0.09, -L * 0.53], [0.07, L * 0.07, 0.28], 7],
    ['cables', 'ctrl', [0, 0, -L * 0.25], [0.18, 0.18, L * 0.14], 9],
  ];
  const out = {};
  for (const [name, kind, c, h, hp] of M) out[name] = { name, kind, c, h, mn: [c[0] - h[0], c[1] - h[1], c[2] - h[2]], mx: [c[0] + h[0], c[1] + h[1], c[2] + h[2]], hp, max: hp, hitT: -9, leak: 0, dead: false };
  return out;
}
export const modFrac = m => (m.kind === 'engine' ? 1 : clamp(m.hp / m.max, 0, 1));

// Projétil atravessando o avião a partir do ponto de entrada (coordenadas locais)
export function hitPlaneModules(pl, lp, ld, am, dmg, pen, by, shell) {
  pl.damage(shell, dmg * 0.55, by, false); // furos na estrutura
  if (pl.gone) return;
  const P = 1 + (am.cal || 12) * 0.06, o = [lp[0], lp[1], lp[2]], d = [ld[0] * P, ld[1] * P, ld[2] * P];
  const list = [];
  for (const m of Object.values(pl.mods)) { const r = segBox(o, d, m.mn, m.mx); if (r || inside(m, lp)) list.push([r ? r.t : 0, m]); }
  list.sort((a, b) => a[0] - b[0]);
  let e = dmg;
  for (const [, m] of list) {
    if (m.kind === 'pilot') { const arm = (pl.def.armor && pl.def.armor.pilot) || 0; if (ld[2] > 0.3 && pen < arm) { e *= 0.1; break; } } // blindagem atrás do piloto
    applyMod(pl, m, e * 1.15, by, am);
    e *= 0.55; if (e < 0.15) break;
  }
  // granada explosiva: estilhaços ao redor do ponto de entrada
  const tnt = am.tnt || am.he || 0;
  if (tnt > 0) {
    const R = 0.5 + 6 * Math.cbrt(tnt), cx = lp[0] + ld[0] * 0.3, cy = lp[1] + ld[1] * 0.3, cz = lp[2] + ld[2] * 0.3;
    for (const m of Object.values(pl.mods)) {
      const dd = boxDist(m, cx, cy, cz); if (dd > R) continue;
      applyMod(pl, m, dmg * 0.9 * (1 - dd / R), by, am);
    }
  }
}
// Explosão próxima (míssil, bomba, granada antiaérea) em coordenadas locais
export function blastPlaneModules(pl, lx, ly, lz, R, dmg, by) {
  for (const m of Object.values(pl.mods)) { const dd = boxDist(m, lx, ly, lz); if (dd < R) applyMod(pl, m, dmg * (1 - dd / R), by, { tnt: 1 }); }
}
const inside = (m, p) => p[0] > m.mn[0] && p[0] < m.mx[0] && p[1] > m.mn[1] && p[1] < m.mx[1] && p[2] > m.mn[2] && p[2] < m.mx[2];
function boxDist(m, x, y, z) { const dx = Math.max(m.mn[0] - x, 0, x - m.mx[0]), dy = Math.max(m.mn[1] - y, 0, y - m.mx[1]), dz = Math.max(m.mn[2] - z, 0, z - m.mx[2]); return Math.hypot(dx, dy, dz); }

export function applyMod(pl, m, dmg, by, am) {
  if (pl.gone || !isFinite(dmg) || dmg <= 0) return;
  m.hitT = S.now;
  const inc = am && ((am.he || 0) > 0 || (am.tnt || 0) > 0) ? 2.2 : 1; // explosiva/incendiária pega fogo mais fácil
  const me = pl.isPlayer, shooter = by && by.isPlayer;
  const crit = t => { if (me) showDmg(t); if (shooter && S.air) S.air.crit(t); };
  if (m.kind === 'engine') { pl.damage('engine', dmg, by, true); return; }
  if (m.kind === 'pilot') {
    m.hp -= dmg;
    if (by && by.team !== pl.team) { pl.lastHitBy = by; pl.lastHitT = S.now; }
    if (S.air) S.air.onDamage(pl, dmg, by);
    if (m.hp <= 0 || Math.random() < 0.12 * dmg) { pl.damage('pilot', 99, by, false, true); if (!pl.pilot) crit('Piloto abatido'); }
    else if (!pl.wounded && m.hp < m.max * 0.6) { pl.wounded = true; crit('Piloto ferido'); }
    return;
  }
  m.hp -= dmg;
  if (by && by.team !== pl.team) { pl.lastHitBy = by; pl.lastHitT = S.now; }
  if (S.air) S.air.onDamage(pl, dmg * 0.7, by);
  const died = m.hp <= 0 && !m.dead; if (died) m.dead = true;
  switch (m.kind) {
    case 'fuel': {
      const was = m.leak;
      m.leak = Math.min(m.leak + dmg * 0.6, 8); // kg/s
      if (!was) crit(`${LABEL[m.name]} perfurado`);
      if (Math.random() < 0.035 * dmg * inc) { pl.ignite(m.c); crit('Incêndio no ' + LABEL[m.name].toLowerCase()); }
      break;
    }
    case 'cool': if (!pl.oil) { pl.oil = 1; crit('Radiador perfurado · motor vai superaquecer'); } break;
    case 'hyd': if (died) crit('Hidráulico danificado · flaps e freio inoperantes'); break;
    case 'ammo':
      if (died && Math.random() < 0.3) {
        crit('Munição detonou');
        fxExplosion(pl.pos.clone(), 0.8);
        pl.damage(m.name === 'ammoL' ? (pl.def.jet ? 'fuse' : 'wingL') : (pl.def.jet ? 'fuse' : 'wingR'), 60, by, true);
      }
      break;
    case 'gun': if (died) { for (const g of pl.guns) if ((m.name === 'gunL') === (g.pts[0][0] >= 0)) g.broken = true; crit(`${LABEL[m.name]} inoperantes`); } break;
    case 'ctrl': if (died) crit(`${LABEL[m.name]} inoperante`); break;
  }
}
// autoridade dos comandos (0..1) a partir dos módulos
export function ctrlAuthority(pl) {
  const M = pl.mods, f = n => (M[n].dead ? 0.12 : 0.5 + 0.5 * modFrac(M[n]));
  const cab = M.cables.dead ? 0.35 : 0.7 + 0.3 * modFrac(M.cables), pil = pl.wounded ? 0.8 : 1;
  return { elev: f('elev') * cab * pil, ail: (f('ailL') + f('ailR')) / 2 * cab * pil, rud: f('rud') * cab * pil, ailBias: (f('ailL') - f('ailR')) * 0.5 };
}
export function fuelLeak(pl) { let l = 0; for (const n of ['fuelF', 'fuelL', 'fuelR']) l += pl.mods[n].leak; return l; }
