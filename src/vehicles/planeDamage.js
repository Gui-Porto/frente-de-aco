import { S } from '../core/state.js';
import { clamp } from '../core/util.js';
import { segBox } from '../combat/ballistics.js';
import { GUNS } from '../data/vehicles.js';
import { wingCfg, tailCfg, finCfg, station, surfBox, SURF } from './planeGeom.js';
import { fxExplosion } from '../fx/particles.js';

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
// rótulos dos componentes gerados aqui; os da ficha (def.parts) trazem o próprio nome
export const LABEL = { pilot: 'Piloto', engine: 'Motor', radar: 'Radar', cables: 'Cabos de comando' };
const FUEL = { spit9: 270, p47: 900, fw190: 400, il2: 600, f86: 1300, mig15: 1100 };
export const fuelOf = D => D.fuel || FUEL[D.key] || 400;
const SIDE = { L: [1, ' esq.'], R: [-1, ' dir.'] };

// Componentes de cada aeronave: { name, kind, label, c:[x,y,z], h:[hx,hy,hz], hp, max }.
// Os comuns (piloto, motores, superfícies de comando, armas/munição, radar) saem das dimensões e do
// armamento; tanques, radiadores, turbo e sistemas hidráulico/pneumático/elétrico vêm de def.parts,
// que descreve o que o avião real tinha e onde (ver data/vehicles.js).
export function planeModules(D) {
  const L = D.L, fr = D.fuseR, jet = !!D.jet, M = [];
  const put = (name, kind, label, c, h, hp, extra) => M.push(Object.assign({ name, kind, label, c, h, hp }, extra));
  const cz = jet ? L * 0.24 : D.key === 'il2' ? L * 0.08 : -L * 0.02;
  put('pilot', 'pilot', LABEL.pilot, [0, fr * 0.65, cz], [0.32, 0.45, 0.45], 8);
  // motores: pistão no nariz; jato na fuselagem traseira (lado a lado quando são dois)
  const ne = D.engines || 1;
  for (let i = 0; i < ne; i++) {
    const x = ne > 1 ? (i ? -1 : 1) * fr * 0.4 : 0, lab = ne > 1 ? `Motor ${i ? 'dir.' : 'esq.'}` : LABEL.engine;
    put(ne > 1 ? `eng${i}` : 'engine', 'engine', lab, jet ? [x, 0, -L * 0.17] : [0, 0, L * 0.33], jet ? [fr * (ne > 1 ? 0.36 : 0.7), fr * 0.6, L * 0.17] : [fr * 0.82, fr * 0.82, L * 0.1], 0, { i });
  }
  // peças da ficha; as de asa (w: [s, cf]) saem em par, esquerda e direita
  for (const p of D.parts || []) {
    const extra = { does: p.does }, hp = p.hp || (p.k === 'fuel' ? 10 : p.k === 'act' ? 6 : 7);
    if (p.w) for (const sd of ['L', 'R']) {
      const st = station(wingCfg(D, SIDE[sd][0]), p.w[0], p.w[1]);
      put(p.id + sd, p.k, p.n + SIDE[sd][1], [st[0], st[1] + (p.dy || 0), st[2]], p.s, hp, extra);
    }
    else put(p.id, p.k, p.n, [(p.x || 0) * fr, (p.y || 0) * fr, p.z * L], p.s, hp, extra);
  }
  // armas e munição por grupo e por lado (asa ou fuselagem), onde a ficha põe os canos
  D.guns.forEach((g, gi) => {
    const nm = GUNS[g.w].name, sides = g.n > 1 && g.span[0] !== 0 ? [1, -1] : [Math.sign(g.span[0]) || 0];
    const wing = !jet && g.span[0] > fr * 1.5;
    for (const sd of sides) {
      const xs = g.span.map(v => v * sd), x = (Math.min(...xs) + Math.max(...xs)) / 2, hx = (Math.max(...xs) - Math.min(...xs)) / 2 + 0.2;
      const tag = sd > 0 ? 'L' : sd < 0 ? 'R' : '', side = sd > 0 ? ' esq.' : sd < 0 ? ' dir.' : '';
      const z = wing ? station(wingCfg(D, sd || 1), (Math.abs(x) - fr * 0.55) / wingCfg(D, 1).half, 0.3)[2] : g.z - 0.6;
      const y = wing ? station(wingCfg(D, sd || 1), (Math.abs(x) - fr * 0.55) / wingCfg(D, 1).half, 0.3)[1] : -0.1;
      put(`gun${gi}${tag}`, 'gun', nm + side, [x, y, z + 0.3], [hx, 0.12, 0.5], 5, { g: gi, sd });
      put(`ammo${gi}${tag}`, 'ammo', 'Munição ' + nm.split(' ').slice(0, 2).join(' ') + side, [x, y, z - (wing ? 0.5 : 1.0)], [hx + 0.1, 0.14, 0.45], 6, { g: gi, sd });
    }
  });
  if (D.radar) put('radar', 'radar', LABEL.radar, [0, 0, L * 0.43], [fr * 0.45, fr * 0.45, L * 0.04], 6);
  // superfícies de comando nas posições do modelo 3D
  const ail = D.ail || SURF.ail, flap = D.flap || SURF.flap, cf = SURF.cf;
  for (const sd of ['L', 'R']) {
    const o = wingCfg(D, SIDE[sd][0]);
    let b = surfBox(o, ail[0], ail[1], cf); put('ail' + sd, 'ctrl', 'Aileron' + SIDE[sd][1], b.c, b.h, 6);
    b = surfBox(o, flap[0], flap[1], cf); put('flap' + sd, 'flap', 'Flap' + SIDE[sd][1], b.c, b.h, 6);
  }
  const tl = surfBox(tailCfg(D, 1), 0, 0.95, D.stab === 'all' ? 0 : 0.65), tr = surfBox(tailCfg(D, -1), 0, 0.95, D.stab === 'all' ? 0 : 0.65);
  put('elev', 'ctrl', D.stab === 'all' ? 'Estabilizador móvel' : 'Profundor', [0, tl.c[1], tl.c[2]], [tl.c[0] + tl.h[0], tl.h[1], Math.max(tl.h[2], tr.h[2])], 7);
  const rb = surfBox(finCfg(D), 0.1, 0.95, 0.68, true); put('rud', 'ctrl', 'Leme', rb.c, rb.h, 7);
  put('cables', 'ctrl', D.boost ? 'Hastes de comando' : LABEL.cables, [0, 0, -L * 0.25], [0.18, 0.18, L * 0.14], 9);
  const out = {};
  for (const m of M) out[m.name] = Object.assign(m, { mn: [m.c[0] - m.h[0], m.c[1] - m.h[1], m.c[2] - m.h[2]], mx: [m.c[0] + m.h[0], m.c[1] + m.h[1], m.c[2] + m.h[2]], max: m.hp, hitT: -9, leak: 0, dead: false });
  return out;
}
export const modsOf = (pl, kind) => Object.values(pl.mods).filter(m => m.kind === kind);
// algum sistema que faz `job` ainda funciona? (sem nenhum sistema para isso = mecânico, sempre funciona)
export function powered(pl, job) {
  let any = false;
  for (const m of Object.values(pl.mods)) if (m.does && m.does.includes(job)) { if (!m.dead) return true; any = true; }
  return !any;
}
export const modFrac = m => (m.kind === 'engine' ? 1 : clamp(m.hp / m.max, 0, 1));

// Projétil atravessando o avião a partir do ponto de entrada (coordenadas locais)
export function hitPlaneModules(pl, lp, ld, am, dmg, pen, by, shell) {
  pl.hitLx = lp[0]; // onde (na envergadura) acertou: decide se a ponta da asa se solta
  pl.damage(shell, dmg * 0.55, by, false); // furos na estrutura
  // lascas de chapa: granada explosiva arranca mais; bala comum de vez em quando
  if (pl.hitFx) pl.hitFx(lp, (am.tnt || am.he || 0) > 0, ld); // lascas de chapa e o som do acerto (plane.js)
  if (pl.gone) return;
  const P = 1 + (am.cal || 12) * 0.06, o = [lp[0], lp[1], lp[2]], d = [ld[0] * P, ld[1] * P, ld[2] * P];
  const list = [];
  for (const m of Object.values(pl.mods)) { if (m.lost) continue; const r = segBox(o, d, m.mn, m.mx); if (r || inside(m, lp)) list.push([r ? r.t : 0, m]); }
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
  if (pl.hitFx && dmg > 1) pl.hitFx([lx, ly, lz], true, null, R);
  for (const m of Object.values(pl.mods)) { const dd = boxDist(m, lx, ly, lz); if (dd < R) applyMod(pl, m, dmg * (1 - dd / R), by, { tnt: 1 }); }
}
const inside = (m, p) => p[0] > m.mn[0] && p[0] < m.mx[0] && p[1] > m.mn[1] && p[1] < m.mx[1] && p[2] > m.mn[2] && p[2] < m.mx[2];
function boxDist(m, x, y, z) { const dx = Math.max(m.mn[0] - x, 0, x - m.mx[0]), dy = Math.max(m.mn[1] - y, 0, y - m.mx[1]), dz = Math.max(m.mn[2] - z, 0, z - m.mx[2]); return Math.hypot(dx, dy, dz); }

export function applyMod(pl, m, dmg, by, am) {
  if (pl.gone || !isFinite(dmg) || dmg <= 0) return;
  if (m.lost) return; // peça que já caiu junto com a ponta da asa ou a asa
  m.hitT = S.now;
  // explosiva pega fogo mais fácil; incendiária (cinta: am.inc) muito mais — e só a explosiva arranca superfícies
  const hev = !!am && ((am.he || 0) > 0 || (am.tnt || 0) > 0), inc = (hev ? 2.2 : 1) + (am && am.inc ? am.inc * 6 : 0);
  const shooter = by && by.isPlayer;
  const crit = t => { if (shooter && S.air) S.air.crit(t); }; // o dano em você aparece só na silhueta de integridade, sem texto
  if (m.kind === 'engine') { pl.damage('engine', dmg, by, true, true, m.i); if (inc > 2.5 && Math.random() < 0.012 * dmg * inc && pl.fire <= 0) { pl.ignite(m.c); crit('Incêndio no motor'); } return; }
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
      if (m.left <= 0) break; // tanque já vazio: o furo não vaza nada nem pega fogo fácil
      const was = m.leak;
      m.leak = Math.min(m.leak + dmg * 0.6, 8); // kg/s
      if (!was) crit(`${m.label} perfurado`);
      if (Math.random() < 0.035 * dmg * inc) { pl.ignite(m.c); crit('Incêndio: ' + m.label.toLowerCase()); }
      break;
    }
    case 'cool': if (!pl.oil) { pl.oil = 1; crit(`${m.label} perfurado · motor vai superaquecer`); } break;
    case 'turbo': if (died) crit(`${m.label} destruído · motor perde potência em altitude`); break;
    case 'act': if (died) {
      const lost = (m.does || []).filter(j => !powered(pl, j)).map(j => ({ flaps: 'flaps', brake: 'freio aerodinâmico', guns: 'disparo das armas', ctl: 'comandos sem assistência' })[j]);
      crit(`${m.label} danificado${lost.length ? ' · ' + lost.join(', ') : ''}`);
    } break;
    case 'radar': if (died && pl.sys.radar) { pl.sys.radar.setMode('OFF'); pl.sys.radar.dead = true; crit('Radar destruído'); } break;
    case 'ammo':
      if (died && Math.random() < 0.3) {
        crit(`${m.label} detonou`);
        fxExplosion(pl.pos.clone(), 0.8);
        pl.damage(m.c[0] > 1.2 ? 'wingL' : m.c[0] < -1.2 ? 'wingR' : 'fuse', 60, by, true);
      }
      break;
    case 'gun': if (died) {
      // só os canos daquele lado param; o grupo inteiro só quando não sobra nenhum
      const g = pl.guns[m.g];
      if (g) { g.pts = m.sd ? g.pts.filter(q => Math.sign(q[0]) !== m.sd) : []; if (!g.pts.length) g.broken = true; }
      crit(`${m.label} inoperante`);
    } break;
    case 'ctrl': case 'flap': if (died) {
      // trava onde estava (cabo/haste cortado deixa a superfície meio solta: guarda parte da deflexão)
      m.stuck = 0.6 * ({ ailL: pl.ail, ailR: pl.ail, elev: pl.elev, rud: pl.rud }[m.name] || 0);
      // explosiva ou muito estrago: a superfície é arrancada e cai (sem ela, sem deflexão nenhuma)
      if (m.name !== 'cables' && (hev || m.hp < -m.max * 0.4)) { pl.ripSurface(m); crit(`${m.label} arrancado`); }
      else crit(`${m.label} ${m.kind === 'flap' ? 'travado' : 'inoperante'}`);
    } break;
  }
}
// autoridade dos comandos (0..1) a partir dos módulos
export function ctrlAuthority(pl) {
  const M = pl.mods, f = n => (M[n].dead ? 0.12 : 0.5 + 0.5 * modFrac(M[n]));
  const cab = M.cables.dead ? 0.35 : 0.7 + 0.3 * modFrac(M.cables), pil = pl.wounded ? 0.8 : 1;
  // comandos com servo hidráulico: sem nenhum sistema vivo, o canal fica quase travado (só a força do piloto)
  const B = pl.def.boost, man = B && !powered(pl, 'ctl') ? B.manual : 1, k = ch => (B && B.ch.includes(ch) ? man : 1);
  return { elev: f('elev') * cab * pil * k('elev'), ail: (f('ailL') + f('ailR')) / 2 * cab * pil * k('ail'), rud: f('rud') * cab * pil * k('rud'), ailBias: (f('ailL') - f('ailR')) * 0.5 };
}
// tanques: o combustível fica em cada um (m.left); o motor puxa de todos na proporção e o furo esvazia só o seu
export function fuelInit(pl, total) {
  const T = modsOf(pl, 'fuel'), vol = T.reduce((s, m) => s + m.h[0] * m.h[1] * m.h[2], 0);
  for (const m of T) m.left = m.cap = total * m.h[0] * m.h[1] * m.h[2] / vol;
}
export function fuelLeak(pl) { let l = 0; for (const m of Object.values(pl.mods)) if (m.kind === 'fuel' && m.left > 0) l += m.leak; return l; }
export function fuelStep(pl, burn, dt) {
  const T = modsOf(pl, 'fuel'); let tot = 0;
  for (const m of T) tot += m.left;
  for (const m of T) {
    if (m.left <= 0) continue;
    m.left = Math.max(0, m.left - (tot > 0 ? burn * dt * m.left / tot : 0) - m.leak * dt);
  }
  pl.fuel = T.reduce((s, m) => s + m.left, 0);
}
