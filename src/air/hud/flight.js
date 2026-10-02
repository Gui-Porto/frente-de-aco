import { S } from '../../core/state.js';
import { clamp } from '../../core/util.js';
import { H } from '../../world/terrain.js';
import { settings, keyName } from '../../core/settings.js';
import { HEAT_LIMITS } from '../../vehicles/engineHeat.js';
import { modFrac, fuelLeak } from '../../vehicles/planeDamage.js';
import { RADAR_MODE } from '../battle.js';
import { g, V, C, MONO, UI, ptxt, plate, dec } from './kit.js';
import { sysName } from './themes.js';
// =====================================================================
// Painel da aeronave (canto inferior direito). Lê só o que o avião tem:
// motor (manete comandada × rotação/potência real × pós-combustão/WEP),
// voo, rumo, combustível, armas, sistemas e a silhueta de dano.
// A manete e o motor aparecem SEPARADOS de propósito: a manete responde na
// hora; o motor demora o que a turbina demora — e o piloto vê as duas coisas.
// =====================================================================
const PW = 480, PH = 340, FLAP_TXT = ['', 'COMBATE', 'DECOLAGEM', 'POUSO'];
export const kb = id => (settings.binds[id] || []).map(keyName).join(' / ');
const stallV = p => Math.sqrt(2 * p.def.mass * 9.81 / (1.225 * p.def.S * p.def.clmax)) * 0.95;
let T = null;
const lbl = (t, x, y, col = T.dim, align = 'left') => { g.letterSpacing = '1.2px'; ptxt(t, x, y, 10.5, col, align, UI, 600); g.letterSpacing = '0px'; };
const num = (t, x, y, size, col = T.fg, align = 'right') => ptxt(t, x, y, size, col, align, MONO, 500);

export function flightPanel(p, theme) {
  T = theme;
  const k = clamp(Math.min(V.W / 1400, V.H / 820), 0.72, 1), x0 = V.W - PW * k - 16, y0 = V.H - PH * k - 16;
  g.save(); g.translate(x0, y0); g.scale(k, k);
  plate(0, 0, PW, PH, T);
  header(p);
  silhouette(p, 14, 44, 118, 150);
  flight(p);
  heading(p, 150, 124, 316);
  engine(p, 150, 140);
  weapons(p, 150, 238);
  fuel(p, 14, 238, 118);
  chips(p);
  g.restore();
  return { x: x0, y: y0, k };
}

function header(p) {
  const D = p.def;
  ptxt(D.short, 22, 25, 22, T.fg, 'left', UI, 700);
  g.font = `700 22px ${UI}`; const w = g.measureText(D.short).width;
  ptxt(D.name.replace(D.short, '').trim() || D.nation, 30 + w, 25, 13, T.dim, 'left', UI, 500);
  const sys = Object.values(p.sys).map(s => sysName(T, s.R || s.W));
  if (sys.length) ptxt(sys.join('  ·  '), PW - 14, 24, 11, T.dim, 'right', MONO, 500);
  g.fillStyle = T.faint; g.fillRect(14, 34, PW - 28, 1);
}

function flight(p) {
  const D = p.def, kmh = Math.round(p.ias * 3.6), slow = p.ias < stallV(p) * 1.15;
  lbl('VELOCIDADE', 150, 52); num(String(kmh), 262, 82, 30, slow ? C.amber : T.fg); ptxt('km/h', 266, 82, 12, T.dim, 'left', UI, 500);
  if (T.mach) num(`M ${dec(p.mach || 0, 2)}`, 262, 97, 13, (p.mach || 0) > (D.mcrit || 0.8) ? C.amber : T.dim);
  const agl = p.pos.y - H(p.pos.x, p.pos.z), alt = Math.round(p.pos.y);
  lbl('ALTITUDE', 300, 52); num(alt.toLocaleString('pt-BR'), 388, 82, 28, agl < 150 ? C.amber : T.fg); ptxt('m', 392, 82, 12, T.dim, 'left', UI, 500);
  num(`${p.vel.y >= 0 ? '▲' : '▼'} ${Math.abs(p.vel.y).toFixed(0)} m/s`, 388, 97, 12, T.dim);
  lbl('G', 466, 52, T.dim, 'right');
  num(dec(p.n), 466, 82, 22, Math.abs(p.n) > D.glim * 0.8 ? C.enemy : Math.abs(p.n) > 7 ? C.amber : T.fg);
}

// fita de rumo: N = +z do mundo; girar para a direita aumenta o rumo
function heading(p, x, y, w) {
  const f = p.root.matrixWorld.elements, hdg = ((Math.atan2(-f[8], f[10]) * 180 / Math.PI) + 360) % 360;
  const pxd = w / 70, cx = x + w / 2;
  g.save(); g.beginPath(); g.rect(x, y - 24, w, 32); g.clip();
  for (let d = Math.ceil((hdg - 36) / 5) * 5; d <= hdg + 36; d += 5) {
    const sx = cx + (d - hdg) * pxd, dd = ((d % 360) + 360) % 360, big = dd % 30 === 0;
    g.fillStyle = big ? T.fg : T.dim; g.fillRect(sx, y - (big ? 6 : 3), 1, big ? 6 : 3);
    if (big) { const n = { 0: 'N', 90: 'L', 180: 'S', 270: 'O' }[dd]; ptxt(n || String(dd / 10).padStart(2, '0'), sx, y - 9, n ? 12 : 10.5, n ? T.accent : T.dim, 'center', MONO, 500); }
  }
  g.restore();
  g.fillStyle = T.faint; g.fillRect(x, y, w, 1);
  g.fillStyle = T.fg; g.beginPath(); g.moveTo(cx, y + 2); g.lineTo(cx - 5, y + 9); g.lineTo(cx + 5, y + 9); g.closePath(); g.fill();
  ptxt(String(Math.round(hdg) % 360).padStart(3, '0') + '°', cx, y + 22, 12, T.fg, 'center', MONO, 500);
}

// manete × motor: trilho vertical; a marca ◀ é a manete, a coluna cheia é o que o motor entrega
function engine(p, x, y) {
  const E = p.eng, h = 68, top = y + 14, boost = p.canBoost, abH = boost ? 16 : 0, track = h - abH;
  // trilho
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x, top, 14, h);
  g.strokeStyle = T.edge; g.lineWidth = 1; g.strokeRect(x + .5, top + .5, 13, h - 1);
  if (boost) { g.fillStyle = 'rgba(255,154,60,.12)'; g.fillRect(x + 1, top + 1, 12, abH - 1); g.fillStyle = T.faint; g.fillRect(x, top + abH, 14, 1); }
  // saída real: rotação acima da marcha lenta (jato) ou potência (pistão); a faixa de cima é PC/WEP
  const mil = E.jet ? Math.min(1, (E.N - E.E.nIdle) / (1 - E.E.nIdle)) : Math.min(1, E.power);
  g.fillStyle = p.engineOn ? T.fg : C.enemy; g.fillRect(x + 3, top + abH + track * (1 - mil), 8, track * mil);
  const ab = E.jet ? E.ab : (E.power > 1.001 ? (E.power - 1) / (E.E.wep / E.E.hp - 1) : 0);
  if (ab > 0) { g.fillStyle = T.ab; g.fillRect(x + 3, top + abH * (1 - ab), 8, abH * ab); }
  // manete comandada
  const cy = p.wep && boost ? top + 2 : top + abH + track * (1 - p.throttle);
  g.fillStyle = T.accent; g.beginPath(); g.moveTo(x + 15, cy); g.lineTo(x + 23, cy - 5); g.lineTo(x + 23, cy + 5); g.closePath(); g.fill();
  g.fillRect(x - 3, cy - 1, 18, 2);
  // números
  const tx = x + 34;
  lbl('MANETE', tx, top + 8); num(`${Math.round(p.throttle * 100)}%`, tx + 108, top + 8, 15, T.accent);
  if (E.jet) { lbl('ROTAÇÃO', tx, top + 30); num(`${Math.round(E.N * 100)}%`, tx + 108, top + 30, 15, E.N < p.throttle * (1 - E.E.nIdle) + E.E.nIdle - 0.02 ? C.amber : T.fg); }
  else { lbl('POTÊNCIA', tx, top + 30); num(`${Math.round(E.power * 100)}%`, tx + 108, top + 30, 15); }
  if (E.jet && E.hasAB) {
    const lit = E.ab > 0.02, lighting = p.wep && !lit;
    lbl('PÓS-COMB.', tx, top + 52); ptxt(lit ? `ACESA ${Math.round(E.ab * 100)}%` : lighting ? (E.N > 0.97 ? 'ACENDENDO' : 'AGUARDA ROTAÇÃO') : 'DESLIGADA', tx + 108, top + 52, 13, lit ? T.ab : lighting ? C.amber : T.dim, 'right', UI, 700);
  } else if (!E.jet) { lbl('WEP', tx, top + 52); ptxt(p.wep ? 'LIGADO' : 'DESLIGADO', tx + 108, top + 52, 13, p.wep ? T.ab : T.dim, 'right', UI, 700); }
  else { lbl('PÓS-COMB.', tx, top + 52); ptxt('NÃO EQUIPADO', tx + 108, top + 52, 12, T.faint, 'right', UI, 600); }
  // temperaturas
  const rx = x + 170, L = HEAT_LIMITS[p.cooling], hc = (v, lim) => (v > lim + 10 ? (Math.sin(V.blink * 10) > 0 ? C.enemy : T.fg) : v > lim ? C.amber : T.fg);
  if (!p.engineOn) { lbl('MOTOR', rx, top + 8); ptxt('PARADO', rx + 146, top + 8, 15, C.enemy, 'right', UI, 700); }
  else if (L.water) { lbl('ÁGUA', rx, top + 8); num(`${Math.round(p.heat.water)}°`, rx + 146, top + 8, 15, hc(p.heat.water, L.water)); lbl('ÓLEO', rx, top + 30); num(`${Math.round(p.heat.oil)}°`, rx + 146, top + 30, 15, hc(p.heat.oil, L.oil)); }
  else { lbl(E.jet ? 'TURBINA' : 'ÓLEO', rx, top + 8); num(`${Math.round(p.heat.oil)}°`, rx + 146, top + 8, 15, hc(p.heat.oil, L.oil)); }
  if (E.jet && E.count > 1) { lbl('MOTORES', rx, top + 30); num(`${E.count}× ${E.E.name.split(' ').slice(-1)[0]}`, rx + 146, top + 30, 12, T.dim); }
  lbl('CONSUMO', rx, top + 52); num(`${dec(E.flow, 1)} kg/s`, rx + 146, top + 52, 13, E.flow > 4 ? C.amber : T.fg);
}

function weapons(p, x, y) {
  g.fillStyle = T.faint; g.fillRect(x, y - 4, PW - x - 14, 1);
  lbl('ARMAMENTO', x, y + 10); if (p.racks.length > 1) lbl(`${kb('a_wsel')} troca míssil`, PW - 14, y + 10, T.dim, 'right');
  let yy = y + 30;
  for (const gg of p.guns) {
    const col = gg.broken || gg.jam ? C.enemy : gg.ammo < gg.max * 0.15 ? C.amber : T.fg;
    ptxt(gg.W.name, x, yy, 13.5, gg.broken ? C.enemy : T.fg, 'left', UI, 500);
    g.fillStyle = T.faint; g.fillRect(x + 150, yy - 5, 90, 3);
    if (gg.heat > 0.02) { g.fillStyle = gg.jam ? C.enemy : gg.heat > 0.7 ? C.amber : T.dim; g.fillRect(x + 150, yy - 5, 90 * gg.heat, 3); }
    num(gg.broken ? '—' : gg.jam ? 'QUENTE' : String(gg.ammo), PW - 14, yy, 14, col);
    yy += 19;
  }
  for (const r of p.racks) {
    const sel = r === p.rack;
    if (sel) { g.fillStyle = T.accent; g.beginPath(); g.moveTo(x - 9, yy - 9); g.lineTo(x - 3, yy - 5); g.lineTo(x - 9, yy - 1); g.closePath(); g.fill(); }
    ptxt(r.M.short, x, yy, 13.5, sel ? T.fg : T.dim, 'left', UI, sel ? 700 : 500);
    ptxt(r.M.seeker === 'sarh' ? 'RADAR' : 'IR', x + 62, yy, 10.5, sel ? T.accent : T.faint, 'left', UI, 700);
    for (let i = 0; i < r.max; i++) { const mx = PW - 14 - (r.max - i) * 13; g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(mx - 1, yy - 12, 10, 14); g.fillStyle = i < r.n ? (sel ? T.fg : T.dim) : T.faint; g.fillRect(mx, yy - 11, 8, 12); }
    yy += 19;
  }
  if (p.flares > 0 || p.chaff > 0 || p.def.jet) { ptxt('Flares · chaff', x, yy, 13.5, T.dim, 'left', UI, 500); num(`${p.flares} · ${p.chaff}`, PW - 14, yy, 14, p.flares ? T.fg : C.amber); }
}

function fuel(p, x, y, w) {
  const leak = fuelLeak(p), burn = Math.max(p.eng.flow, 0.05), mins = p.fuel / Math.max(burn + leak, 0.01) / 60, low = p.fuel < p.fuelMax * 0.15;
  lbl('COMBUSTÍVEL', x, y + 10);
  num(`${Math.round(p.fuel).toLocaleString('pt-BR')} kg`, x + w, y + 30, 14, low ? C.amber : T.fg);
  g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(x, y + 37, w, 5);
  g.fillStyle = leak > 0 || low ? C.amber : T.fg; g.fillRect(x, y + 38, w * p.fuel / p.fuelMax, 3);
  num(`≈ ${mins > 99 ? '99+' : Math.floor(mins)} min`, x + w, y + 56, 11, T.dim);
}

// etiquetas acima da placa: configuração (flaps/trem/freio), radar e avarias
function chips(p) {
  const list = [];
  if (p.flapStage || p.flaps > 0.02) list.push([`FLAPS ${FLAP_TXT[p.flapStage] || '↑'}`, C.ok]);
  if (p.gear) list.push(['TREM', C.amber]);
  if (p.brakeOn) list.push(['FREIO', C.amber]);
  const rd = p.sys.radar;
  if (rd && !rd.ranging) list.push([`RADAR ${RADAR_MODE[rd.mode].toUpperCase()}`, rd.on ? T.accent : T.dim]);
  if (p.fire > 0) list.push([`INCÊNDIO · ${kb('a_ext')} ${p.ext ? 'extintor' : 'sem extintor'}`, C.enemy]);
  const leak = fuelLeak(p); if (leak > 0 && p.fuel > 0) list.push([`VAZAMENTO ${dec(leak)} kg/s`, C.amber]);
  if (p.engineOn && p.hp.engine < p.maxHp.engine * 0.7) list.push([`MOTOR ${Math.round(100 * (0.35 + 0.65 * p.hp.engine / p.maxHp.engine))}%`, C.amber]);
  if (p.oil) list.push([p.eng.jet ? 'ÓLEO VAZANDO' : 'RADIADOR VAZANDO', C.amber]);
  if (p.wounded) list.push(['PILOTO FERIDO', C.amber]);
  const dead = Object.values(p.mods).filter(m => m.dead && ['ctrl', 'flap', 'act', 'turbo', 'radar'].includes(m.kind)).map(m => m.label.toUpperCase());
  if (dead.length) list.push([dead.join(' · ') + ' INOP.', C.enemy]);
  let x = PW, y = -10;
  g.font = `600 11px ${UI}`; g.letterSpacing = '1px';
  for (const [t, col] of list) {
    const w = g.measureText(t).width + 14;
    if (x - w < 0) { x = PW; y -= 20; }
    x -= w;
    g.fillStyle = 'rgba(0,0,0,.62)'; g.fillRect(x, y - 11, w - 4, 16); g.strokeStyle = col; g.lineWidth = 1; g.strokeRect(x + .5, y - 10.5, w - 5, 15);
    g.fillStyle = col; g.textAlign = 'left'; g.fillText(t, x + 5, y + 1);
    x -= 4;
  }
  g.letterSpacing = '0px';
}

// silhueta vista de cima com os componentes (como a do WT): cor = integridade
const fcol = f => (f <= 0 ? '#1d1d1d' : f < 0.35 ? C.enemy : f < 0.7 ? C.amber : 'rgba(238,241,236,.75)');
function silhouette(p, x, y, w, sh) {
  const D = p.def, M = p.mods;
  const s = Math.min(sh / D.L, w / D.span), ox = x + w / 2, oy = y + sh / 2;
  const P = (lx, lz) => [ox - lx * s, oy - lz * s];
  const sf = k => p.hp[k] / p.maxHp[k];
  const OUT = 'rgba(0,0,0,.7)', LINE = T.dim;
  g.lineJoin = 'round';
  const shape = (fill, f, path, broken) => {
    path(); g.lineWidth = 3; g.strokeStyle = OUT; g.stroke();
    if (broken) { g.lineWidth = 1.2; g.strokeStyle = C.enemy; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]); return; }
    g.fillStyle = fill; g.globalAlpha = f >= 0.7 ? 0.16 : 0.42; g.fill(); g.globalAlpha = 1; g.lineWidth = 1; g.strokeStyle = f >= 0.7 ? LINE : fill; g.stroke();
  };
  const swp = D.span / 2 * Math.tan((D.sweep || 0) * Math.PI / 180);
  for (const [side, k, on] of [[1, 'wingL', p.wingOn.L], [-1, 'wingR', p.wingOn.R]]) {
    const pts = [P(side * D.fuseR, D.wingZ + D.chord * 0.35), P(side * D.span / 2, D.wingZ + D.tipChord * 0.3 - swp), P(side * D.span / 2, D.wingZ - D.tipChord * 0.7 - swp), P(side * D.fuseR, D.wingZ - D.chord * 0.65)];
    shape(fcol(sf(k)), sf(k), () => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(...q) : g.moveTo(...q))); g.closePath(); }, !on);
  }
  { const [a, b] = P(D.span * 0.19, -D.L * 0.43); shape(fcol(sf('tail')), sf('tail'), () => { g.beginPath(); g.rect(a, b, D.span * 0.38 * s, D.L * 0.1 * s); }, !p.tailOn); }
  { const [a, b] = P(D.fuseR, D.L * 0.47); shape(fcol(sf('fuse')), sf('fuse'), () => { g.beginPath(); g.roundRect(a, b, D.fuseR * 2 * s, D.L * 0.97 * s, D.fuseR * s); }, false); }
  for (const m of Object.values(M)) {
    if ((Math.abs(m.c[0]) > D.fuseR * 1.2 && !p.wingOn[m.c[0] > 0 ? 'L' : 'R']) || ((m.name === 'elev' || m.name === 'rud') && !p.tailOn)) continue;
    const f = m.kind === 'engine' ? (p.engs[m.i].on ? p.engs[m.i].hp / p.maxHp.engine : 0) : modFrac(m);
    const [a, b] = P(m.c[0] + m.h[0], m.c[2] + m.h[2]), ww = Math.max(3, m.h[0] * 2 * s), hh = Math.max(3, m.h[2] * 2 * s);
    g.fillStyle = S.now - m.hitT < 0.25 ? '#fff' : f >= 0.7 ? T.faint : fcol(f); g.beginPath();
    if (m.kind === 'pilot') g.arc(a + ww / 2, b + hh / 2, Math.min(ww, hh) / 2 + 1, 0, 7); else g.roundRect(a, b, ww, hh, 1.5);
    g.fill();
    if (f <= 0) { g.strokeStyle = C.enemy; g.lineWidth = 1.3; g.beginPath(); g.moveTo(a, b); g.lineTo(a + ww, b + hh); g.moveTo(a + ww, b); g.lineTo(a, b + hh); g.stroke(); }
    if (m.leak > 0 && m.left > 0) { g.fillStyle = C.sky; g.beginPath(); g.arc(a + ww + 3, b + hh / 2 + Math.sin(V.blink * 8) * 2, 2, 0, 7); g.fill(); }
  }
  if (p.fire > 0) { const [a, b] = P(p.fireAt[0], p.fireAt[2]); g.fillStyle = `rgba(255,${120 + Math.random() * 80},40,${0.5 + Math.random() * 0.3})`; g.beginPath(); g.arc(a, b, 8 + Math.random() * 3, 0, 7); g.fill(); }
}
