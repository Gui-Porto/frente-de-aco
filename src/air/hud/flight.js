import { S } from '../../core/state.js';
import { clamp } from '../../core/util.js';
import { H } from '../../world/terrain.js';
import { settings, keyName } from '../../core/settings.js';
import { HEAT_LIMITS } from '../../vehicles/engineHeat.js';
import { modFrac, fuelLeak, sparFrac, partState } from '../../vehicles/planeDamage.js';
import { wingCfg, tailCfg, finCfg, station, finStation, tipBreak, SURF } from '../../vehicles/planeGeom.js';
import { RADAR_MODE } from '../battle.js';
import { g, V, C, MONO, UI, ptxt, plate, dec, otxt } from './kit.js';
import { sysName } from './themes.js';
// =====================================================================
// Painel da aeronave (canto inferior direito). Lê só o que o avião tem:
// motor (manete comandada × rotação/potência real × pós-combustão/WEP),
// voo, rumo, combustível, armas, sistemas e a silhueta de dano.
// A manete e o motor aparecem SEPARADOS de propósito: a manete responde na
// hora; o motor demora o que a turbina demora — e o piloto vê as duas coisas.
// =====================================================================
const FLAP_TXT = ['', 'COMBATE', 'DECOLAGEM', 'POUSO'];
export const kb = id => (settings.binds[id] || []).map(keyName).join(' / ');
const stallV = p => Math.sqrt(2 * p.def.mass * 9.81 / (1.225 * p.def.S * p.def.clmax)) * 0.95;
let T = null;
const lbl = (t, x, y, col = T.dim, align = 'left') => { g.letterSpacing = '1.2px'; ptxt(t, x, y, 10.5, col, align, UI, 600); g.letterSpacing = '0px'; };
const num = (t, x, y, size, col = T.fg, align = 'right') => ptxt(t, x, y, size, col, align, MONO, 500);

// HUD limpa, como no WT (pedido do dono): os números ficam em texto branco discreto no canto superior esquerdo; embaixo, à
// esquerda, só a silhueta de dano (o RWR vai ao lado dela e o radar à direita — scopes.js). A placa grande com tudo dentro saiu.
export const SIL = { w: 158, h: 224 };
const WH = 'rgba(255,255,255,.92)', WD = 'rgba(255,255,255,.58)';
// texto solto sobre o céu: sombra curta em vez de contorno (o contorno grosso embaçava o corpo pequeno)
const wt = (t, x, y, size, col, align, font, weight) => { g.shadowColor = '#000'; g.shadowBlur = 4; g.shadowOffsetY = 1; ptxt(t, x, y, size, col, align, font, weight); ptxt(t, x, y, size, col, align, font, weight); g.shadowBlur = 0; g.shadowOffsetY = 0; }; // duas passadas: sobre nuvem branca uma sombra só não segurava a leitura
export function flightPanel(p, theme) {
  T = theme;
  const k = clamp(Math.min(V.W / 1400, V.H / 820), 0.8, 1);
  g.save(); g.translate(18, 60); g.scale(k, k); readouts(p); g.restore();
  g.save(); g.translate(16, V.H - 16 - SIL.h * k); g.scale(k, k); silhouette(p, 0, 0, SIL.w, SIL.h); chips(p); g.restore();
  g.save(); g.translate(V.W / 2 - 150 * k, 86); g.scale(k, k); heading(p, 0, 0, 300); g.restore();
}
// uma linha por parâmetro: rótulo apagado + valor. A manete (comando, responde na hora) e a rotação/potência (o que o motor
// entrega, com o atraso da turbina) ficam em linhas vizinhas — a diferença entre as duas É o atraso
function readouts(p) {
  const E = p.eng, D = p.def, rows = [], L = HEAT_LIMITS[p.cooling], hot = (v, lim) => (v > lim + 10 ? C.enemy : v > lim ? C.amber : WH);
  const lit = E.jet && E.ab > 0.02, bt = !p.canBoost ? '' : E.jet && E.hasAB ? (lit ? `  PC ${Math.round(E.ab * 100)}%` : p.wep ? '  PC acendendo' : '') : p.wep ? '  WEP' : '';
  rows.push(['MANETE', `${Math.round(p.throttle * 100)}%${bt}`, bt ? T.ab : WH]);
  if (E.jet) rows.push(['ROTAÇÃO', `${Math.round(E.N * 100)}%`, E.N < p.throttle * (1 - E.E.nIdle) + E.E.nIdle - 0.02 ? C.amber : WH]);
  else rows.push(['POTÊNCIA', `${Math.round(E.power * 100)}%`, WH]);
  const agl = p.pos.y - H(p.pos.x, p.pos.z);
  rows.push(['VEL', `${Math.round(p.ias * 3.6)} km/h${T.mach ? `   M ${dec(p.mach || 0, 2)}` : ''}`, p.ias < stallV(p) * 1.15 ? C.amber : WH]);
  rows.push(['ALT', `${Math.round(p.pos.y).toLocaleString('pt-BR')} m   ${p.vel.y >= 0 ? '▲' : '▼'}${Math.abs(p.vel.y).toFixed(0)}`, agl < 100 ? C.amber : WH]);
  rows.push(['G', dec(p.n), Math.abs(p.n) > D.glim * 0.8 ? C.enemy : Math.abs(p.n) > 7 ? C.amber : WH]);
  if (!p.engineOn) rows.push(['MOTOR', 'PARADO', C.enemy]);
  else if (L.water) rows.push(['ÁGUA', `${Math.round(p.heat.water)}°`, hot(p.heat.water, L.water)], ['ÓLEO', `${Math.round(p.heat.oil)}°`, hot(p.heat.oil, L.oil)]);
  else rows.push([E.jet ? 'TURBINA' : 'ÓLEO', `${Math.round(p.heat.oil)}°`, hot(p.heat.oil, L.oil)]);
  const leak = fuelLeak(p), mins = p.fuel / Math.max(Math.max(E.flow, 0.05) + leak, 0.01) / 60;
  rows.push(['COMB', `${Math.round(p.fuel).toLocaleString('pt-BR')} kg   ${mins > 99 ? '99+' : Math.floor(mins)} min`, leak > 0 || p.fuel < p.fuelMax * 0.15 ? C.amber : WH]);
  rows.push(null);
  for (const gg of p.guns) rows.push([`${gg.pts.length}× ${gg.W.name.replace(/^[\d,]+ mm /, '')}`, gg.broken ? 'DESTRUÍDA' : gg.jam ? 'QUENTE' : String(gg.ammo), gg.broken || gg.jam ? C.enemy : gg.ammo < gg.max * 0.15 ? C.amber : WH]);
  for (const r of p.racks) rows.push([(r === p.rack ? '▸ ' : '  ') + r.M.short, '●'.repeat(r.n) + '○'.repeat(r.max - r.n) + (r.M.seeker === 'sarh' ? '  radar' : '  IR'), r === p.rack ? WH : WD]);
  if (p.flares > 0 || p.chaff > 0 || D.jet) rows.push(['FLARE · CHAFF', `${p.flares} · ${p.chaff}`, p.flares ? WH : C.amber]);
  if (p.ord0 && (p.ord0.bombs || p.ord0.rockets)) rows.push(['BOMBA · FOG.', `${p.bombs.length} · ${p.rockets}`, p.bombs.length || p.rockets ? WH : C.amber]);
  let y = 0;
  for (const r of rows) { if (!r) { y += 10; continue; } wt(r[0], 0, y, 12.5, WD, 'left', UI, 600); wt(r[1], 118, y, 16, r[2], 'left', MONO, 600); y += 21; }
}
// fita de rumo: N = +z do mundo; girar para a direita aumenta o rumo
function heading(p, x, y, w) {
  const f = p.root.matrixWorld.elements, hdg = ((Math.atan2(-f[8], f[10]) * 180 / Math.PI) + 360) % 360;
  const pxd = w / 70, cx = x + w / 2;
  g.save(); g.beginPath(); g.rect(x, y - 24, w, 32); g.clip();
  for (let d = Math.ceil((hdg - 36) / 5) * 5; d <= hdg + 36; d += 5) {
    const sx = cx + (d - hdg) * pxd, dd = ((d % 360) + 360) % 360, big = dd % 30 === 0;
    g.globalAlpha = Math.max(0, Math.min(1, 1.3 - Math.abs(d - hdg) / 30)); g.fillStyle = big ? WH : WD; g.fillRect(sx, y - (big ? 6 : 3), 1, big ? 6 : 3);
    if (big) { const n = { 0: 'N', 90: 'L', 180: 'S', 270: 'O' }[dd]; wt(n || String(dd / 10).padStart(2, '0'), sx, y - 9, n ? 12 : 10.5, n ? T.accent : WD, 'center', MONO, 500); }
  }
  g.restore(); g.globalAlpha = 1;
  g.fillStyle = WH; g.beginPath(); g.moveTo(cx, y + 2); g.lineTo(cx - 4, y + 8); g.lineTo(cx + 4, y + 8); g.closePath(); g.fill();
}

// ---------- raio-X da aeronave (segurar a tecla): silhueta grande + cada componente e seu estado ----------
const XG = [
  ['ESTRUTURA', ['skin', 'spar', 'boom', 'gear']], ['MOTOR', ['engine', 'oil', 'cool', 'turbo']], ['COMBUSTÍVEL', ['fuel']],
  ['COMANDOS', ['ctrl', 'flap', 'act']], ['ARMAS E SISTEMAS', ['gun', 'ammo', 'radar', 'pilot']],
];
export function xrayPanel(p, theme) {
  T = theme;
  const w = 700, h = 470, x0 = 16, y0 = 70;
  g.save(); g.translate(x0, y0);
  plate(0, 0, w, h, T);
  ptxt(`RAIO-X · ${p.def.short}`, 22, 26, 16, T.fg, 'left', UI, 700);
  ptxt(`solte ${kb('a_xray')} para fechar`, w - 16, 26, 11, T.dim, 'right', UI, 600);
  silhouette(p, 10, 44, 230, 410);
  // linhas: [rótulo, estado]; estruturas agregadas (4 longarinas, 4 revestimentos), o resto componente a componente
  const M = p.mods, lines = [];
  for (const [title, kinds] of XG) {
    const L = [];
    for (const k of kinds) {
      if (k === 'skin') for (const [n, lab] of [['wingL', 'Asa esq.'], ['wingR', 'Asa dir.'], ['fuse', 'Fuselagem'], ['tail', 'Empenagem']]) {
        const lost = n === 'tail' ? !p.tailOn : n.startsWith('wing') ? !p.wingOn[n.slice(4)] : false;
        L.push([lab + ' (revestimento)', lost ? 'perdida' : `${Math.round(clamp(p.hp[n] / p.maxHp[n], 0, 1) * 100)}%`]);
      } else if (k === 'spar') for (const seg of ['L0', 'L1', 'R0', 'R1']) {
        const lost = !p.wingOn[seg[0]] || (seg[1] === '1' && !p.tipOn[seg[0]]), f = sparFrac(p, seg);
        L.push([`Longarina ${seg[0] === 'L' ? 'esq.' : 'dir.'} (${seg[1] === '0' ? 'raiz' : 'externa'})`, lost ? 'perdida' : f <= 0 ? 'cortada' : `${Math.round(f * 100)}%`]);
      } else for (const m of Object.values(M)) if (m.kind === k) L.push([m.label, partState(p, { name: m.name, kind: m.kind })]);
      if (k === 'oil') L.push(['Óleo', `${Math.round(p.oilQ * 100)}% · ${Math.round(p.heat.oil)} °C${p.oil > 0 ? ' · vazando' : ''}`]);
      if (k === 'cool' && p.cooling === 'liquid') L.push(['Água', `${Math.round(p.waterQ * 100)}% · ${Math.round(p.heat.water)} °C${p.water > 0 ? ' · vazando' : ''}`]);
    }
    // tanques: quanto resta em cada um junto do estado
    if (kinds[0] === 'fuel') for (const r of L) { const m = Object.values(M).find(q => q.label === r[0]); if (m && m.cap) r[1] = `${Math.round(m.left)} kg · ${r[1]}`; }
    lines.push([title, L]);
  }
  // duas colunas de grupos
  let col = 0, x = 256, y = 56; const cw = 205, maxY = h - 16;
  for (const [title, L] of lines) {
    if (y + 20 + L.length * 15 > maxY && col === 0) { col = 1; x = 256 + cw + 16; y = 56; }
    lbl(title, x, y); y += 16;
    for (const [a, b] of L) {
      const bad = /perdid|cortad|destru|arrancad|parad|mort|vazio|travad/.test(b), warn = /vazando|ferido/.test(b) || (/^\d+%$/.test(b) && parseInt(b) < 70);
      ptxt(a, x, y, 11.5, T.fg, 'left', UI, 500); ptxt(b, x + cw, y, 10.5, bad ? C.enemy : warn ? C.amber : T.dim, 'right', MONO, 500); y += 15;
    }
    y += 8;
  }
  g.restore();
}
// registro de avarias como no WT: um aviso por problema que EXISTE agora (some quando deixa de existir)
const UP = t => t.toUpperCase(), SD = { L: 'ESQ.', R: 'DIR.' };
export function damageList(p) {
  const M = p.mods, out = [], E = p.eng;
  if (p.fire > 0) out.push([`INCÊNDIO · ${kb('a_ext')} ${p.ext ? 'extintor' : 'sem extintor'}`, C.enemy]);
  // combustível: cada tanque furado (com o que ainda resta)
  for (const m of Object.values(M)) if (m.kind === 'fuel' && m.leak > 0 && m.left > 0) out.push([`${UP(m.label)} VAZANDO · ${dec(m.leak)} kg/s`, C.amber]);
  if (p.oil > 0) out.push([p.oilQ <= 0 ? 'SEM ÓLEO · MOTOR ENGRIPANDO' : `VAZAMENTO DE ÓLEO · ${Math.round(p.oilQ * 100)}%`, p.oilQ < 0.3 ? C.enemy : C.amber]);
  if (p.water > 0) out.push([p.waterQ <= 0 ? 'SEM ÁGUA · MOTOR FERVENDO' : `VAZAMENTO DE ÁGUA · ${Math.round(p.waterQ * 100)}%`, p.waterQ < 0.3 ? C.enemy : C.amber]);
  if (p.engineOn && (p.heat.oil > 120 || p.heat.water > 118)) out.push(['MOTOR SUPERAQUECENDO', C.enemy]);
  p.engs.forEach((e, i) => { const nm = p.engs.length > 1 ? `MOTOR ${i ? 'DIR.' : 'ESQ.'}` : 'MOTOR'; if (!e.on) out.push([`${nm} PAROU`, C.enemy]); else if (e.hp < p.maxHp.engine * 0.7) out.push([`${nm} ${Math.round(100 * (0.35 + 0.65 * e.hp / p.maxHp.engine))}%`, C.amber]); });
  if (!p.pilot) out.push(['PILOTO ABATIDO', C.enemy]); else if (p.wounded) out.push(['PILOTO FERIDO', C.amber]);
  // estrutura
  for (const sd of ['L', 'R']) {
    if (!p.wingOn[sd]) { out.push([`ASA ${SD[sd]} PERDIDA`, C.enemy]); continue; }
    if (!p.tipOn[sd]) out.push([`PONTA DA ASA ${SD[sd]} PERDIDA`, C.enemy]);
    const k = Math.min(sparFrac(p, sd + '0'), p.tipOn[sd] ? sparFrac(p, sd + '1') : 1);
    if (k < 0.95) out.push([`LONGARINA ${SD[sd]} ${Math.round(k * 100)}% · LIMITE ${dec(D_G(p) * (0.3 + 0.7 * k), 1)} G`, k < 0.5 ? C.enemy : C.amber]);
  }
  if (!p.tailOn) out.push(['CAUDA PERDIDA', C.enemy]); else if (M.boom && M.boom.hp < M.boom.max * 0.6) out.push(['CONE DE CAUDA DANIFICADO', C.amber]);
  // comandos: flaps desalinhados (um lado travado ou perdido), superfícies e cabos
  const fl = M.flapL, fr = M.flapR;
  if ((fl.dead || fr.dead) && !(fl.dead && fr.dead) || Math.abs(p.flapP.L - p.flapP.R) > 0.15) out.push(['FLAPS DESALINHADOS', C.enemy]);
  for (const m of Object.values(M)) {
    if (m.kind === 'ctrl' && m.dead && !m.lost) out.push([`${UP(m.label)} ${m.ripped ? 'ARRANCADO' : m.name === 'cables' ? (m.label.startsWith('Hastes') ? 'CORTADAS' : 'CORTADOS') : 'TRAVADO'}`, C.enemy]);
    else if (m.kind === 'flap' && m.dead && !m.lost && (fl.dead && fr.dead)) out.push([`${UP(m.label)} ${m.ripped ? 'ARRANCADO' : 'TRAVADO'}`, C.amber]);
    else if (m.kind === 'act' && m.dead) out.push([`${UP(m.label)} AVARIADO`, C.amber]);
    else if (m.kind === 'gear' && m.dead) out.push([`${UP(m.label)} ${m.lost ? 'ARRANCADO' : 'TRAVADO'}`, m.lost ? C.enemy : C.amber]);
    else if (m.kind === 'radar' && m.dead) out.push(['RADAR INOPERANTE', C.amber]);
    else if (m.kind === 'turbo' && m.dead) out.push(['TURBO AVARIADO', C.amber]);
    else if (m.kind === 'gun' && m.dead && !m.lost) out.push([`${UP(m.label)} INOPERANTE`, C.amber]);
  }
  return out;
}
const D_G = p => p.def.glim;
// etiquetas acima da silhueta: configuração (flaps/trem/freio), radar e avarias — uma por linha, de baixo para cima
function chips(p) {
  const list = [];
  if (p.flapStage || p.flaps > 0.02) list.push([`FLAPS ${FLAP_TXT[p.flapStage] || '↑'}`, C.ok]);
  if (p.gear > 0) list.push([p.gear < 1 ? (p.gearCmd ? 'TREM DESCENDO' : 'TREM SUBINDO') : 'TREM', C.amber]);
  if (p.brakeOn) list.push(['FREIO', C.amber]);
  const rd = p.sys.radar;
  if (rd && !rd.ranging) list.push([`RADAR ${RADAR_MODE[rd.mode].toUpperCase()}`, rd.on ? T.accent : T.dim]);
  for (const [t, col] of damageList(p)) list.push([t, col]);
  let y = -12; g.letterSpacing = '1px';
  for (const [t, col] of list.slice(0, 9)) { wt(t, 2, y, 12, col, 'left', UI, 600); y -= 17; }
  g.letterSpacing = '0px';
}

// silhueta vista de cima (como a do WT), desenhada com a MESMA planta do modelo 3D (planeGeom.js):
// asa em raiz + ponta, aileron/flap/profundor/leme onde estão, contorno da fuselagem pelo loft.
// Cor = integridade; peça perdida = contorno vermelho tracejado; tanque mostra o nível de combustível.
const fcol = f => (f <= 0 ? '#1d1d1d' : f < 0.35 ? C.enemy : f < 0.7 ? C.amber : 'rgba(238,241,236,.75)');
function silhouette(p, x, y, w, sh) {
  const D = p.def, M = p.mods;
  const s = Math.min(sh / (D.L * 1.04), w / D.span), ox = x + w / 2, oy = y + sh / 2;
  const P = (lx, lz) => [ox - lx * s, oy - lz * s];
  const path = pts => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(...P(q[0], q[2])) : g.moveTo(...P(q[0], q[2])))); g.closePath(); };
  const strip = (o, s0, s1, a, b, fin) => { const S = fin ? (u, c) => finStation(o, u, c) : (u, c) => station(o, u, c), out = []; for (let i = 0; i <= 8; i++) out.push(S(s0 + (s1 - s0) * i / 8, a)); for (let i = 8; i >= 0; i--) out.push(S(s0 + (s1 - s0) * i / 8, b)); return out; };
  // f = integridade 0..1; lost = peça que caiu
  const draw = (pts, f, lost, flash) => {
    path(pts);
    if (lost) { g.lineWidth = 1.2; g.strokeStyle = C.enemy; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]); return; }
    g.fillStyle = flash ? '#fff' : f >= 0.7 ? 'rgba(238,241,236,.13)' : fcol(f); g.globalAlpha = flash ? 0.8 : f >= 0.7 ? 1 : 0.55; g.fill(); g.globalAlpha = 1;
    g.lineWidth = 2.6; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke(); g.lineWidth = 1; g.strokeStyle = f >= 0.7 ? T.dim : fcol(f); g.stroke();
  };
  const sf = k => clamp(p.hp[k] / p.maxHp[k], 0, 1), hot = m => m && S.now - m.hitT < 0.25;
  const sB = tipBreak(D), A = D.ail || SURF.ail, F = D.flap || SURF.flap;
  g.lineJoin = 'round';
  // asas: raiz e ponta (estrutura), e por cima as superfícies de comando com a cor do módulo
  for (const [side, sd] of [[1, 'L'], [-1, 'R']]) {
    const o = wingCfg(D, side), k = 'wing' + sd, wOn = p.wingOn[sd], tOn = wOn && p.tipOn[sd];
    draw(strip(o, 0, sB, 0, 1), sf(k), !wOn);
    draw(strip(o, sB, 1, 0, 1), sf(k), !tOn);
    for (const [n, r] of [['ail' + sd, A], ['flap' + sd, F]]) { const m = M[n], inTip = (r[0] + r[1]) / 2 >= sB; if (!wOn || (inTip && !tOn)) continue; draw(strip(o, r[0], r[1], SURF.cf, 1), m.ripped ? 0 : modFrac(m), m.ripped, hot(m)); }
  }
  // empenagem: estabilizador (todo móvel ou com profundor) e deriva com o leme
  for (const side of [1, -1]) {
    const o = tailCfg(D, side), m = M[side > 0 ? 'elevL' : 'elevR'];
    draw(strip(o, 0, 1, 0, 1), sf('tail'), !p.tailOn);
    const gone = m.ripped && !(p.surf && p.surf[side > 0 ? 'elevL' : 'elevR']);
    if (p.tailOn) draw(strip(o, 0.04, 0.95, D.stab === 'all' ? 0.05 : 0.68, 1), gone ? 0 : modFrac(m), gone, hot(m));
  }
  // fuselagem pelo loft do modelo (sem loft, um retângulo arredondado)
  const fz = []; for (let i = 0; i <= 24; i++) fz.push(-0.53 + i * (0.99 / 24));
  const fa = p.fuseAt;
  const fuse = fa ? [...fz.map(z => [fa(z).hw, 0, z * D.L]), ...fz.slice().reverse().map(z => [-fa(z).hw, 0, z * D.L])] : [[D.fuseR, 0, D.L * .47], [D.fuseR, 0, -D.L * .5], [-D.fuseR, 0, -D.L * .5], [-D.fuseR, 0, D.L * .47]];
  draw(fuse, sf('fuse'), false);
  { const o = finCfg(D), r = M.rud, fz0 = finStation(o, 0, 0)[2], fz1 = finStation(o, 0, 1)[2]; draw([[0.07, 0, fz0], [0.07, 0, fz1], [-0.07, 0, fz1], [-0.07, 0, fz0]], sf('tail'), !p.tailOn);
    if (p.tailOn) { const z0 = finStation(o, 0.1, 0.7)[2], z1 = finStation(o, 0.1, 1)[2]; draw([[0.09, 0, z0], [0.09, 0, z1], [-0.09, 0, z1], [-0.09, 0, z0]], r.ripped ? 0 : modFrac(r), r.ripped, hot(r)); } }
  // componentes internos, como no WT: inteiro, só o que orienta o piloto (motores e piloto, em tom neutro);
  // o resto (longarinas, armas, munição, tanques, óleo, sistemas) só aparece quando avaria, como uma marca
  // colorida no lugar dele. Antes cada módulo era um quadrado cinza e eles se sobrepunham numa mancha.
  const marks = [];
  for (const m of Object.values(M)) {
    if (m.lost || m.kind === 'ctrl' || m.kind === 'flap' || m.kind === 'skin') continue;
    const f = m.kind === 'engine' ? (p.engs[m.i].on ? p.engs[m.i].hp / p.maxHp.engine : 0) : modFrac(m);
    const key = m.kind === 'engine' || m.kind === 'pilot', leak = m.leak > 0 && m.left > 0;
    if (!key && f >= 0.7 && !leak && !hot(m)) continue;
    const [cx, cy] = P(m.c[0], m.c[2]);
    if (key) {
      const ww = Math.max(5, m.h[0] * 2 * s), hh = Math.max(5, m.h[2] * 2 * s);
      g.fillStyle = hot(m) ? '#fff' : f >= 0.7 ? 'rgba(238,241,236,.32)' : fcol(f); g.beginPath();
      if (m.kind === 'pilot') g.arc(cx, cy, Math.min(ww, hh) / 2 + 1, 0, 7); else g.roundRect(cx - ww / 2, cy - hh / 2, ww, hh, Math.min(ww, hh) / 2);
      g.fill();
      if (f <= 0) marks.push([cx, cy, true]);
      continue;
    }
    // avaria: longarina vira um traço ao longo da asa; o resto, um ponto do tamanho certo para não cobrir os vizinhos
    g.fillStyle = hot(m) ? '#fff' : fcol(Math.min(f, 0.69)); g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 1;
    if (m.kind === 'spar') { const w = Math.max(6, m.h[0] * 2 * s); g.fillRect(cx - w / 2, cy - 1.5, w, 3); }
    else { g.beginPath(); g.arc(cx, cy, 3.2, 0, 7); g.fill(); g.stroke(); }
    if (f <= 0) marks.push([cx, cy, false]);
    if (leak) { g.fillStyle = C.sky; g.beginPath(); g.arc(cx + 6, cy + Math.sin(V.blink * 8) * 2, 2, 0, 7); g.fill(); }
  }
  // destruído: X vermelho por cima de tudo
  g.strokeStyle = C.enemy; g.lineWidth = 1.5;
  for (const [cx, cy, big] of marks) { const r = big ? 5 : 3.5; g.beginPath(); g.moveTo(cx - r, cy - r); g.lineTo(cx + r, cy + r); g.moveTo(cx + r, cy - r); g.lineTo(cx - r, cy + r); g.stroke(); }
  if (p.fire > 0) { const [a, b] = P(p.fireAt[0], p.fireAt[2]); g.fillStyle = `rgba(255,${120 + Math.random() * 80},40,${0.5 + Math.random() * 0.3})`; g.beginPath(); g.arc(a, b, 8 + Math.random() * 3, 0, 7); g.fill(); }
}
