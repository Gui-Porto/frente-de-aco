import { S, planes } from '../../core/state.js';
import { clamp } from '../../core/util.js';
import { RADAR_MODE, B } from '../battle.js';
import { missiles } from '../missiles.js';
import { cam } from '../../game/camera.js';
import { g, V, C, MONO, UI, ptxt, txt, plate, dec, clock, fmtD } from './kit.js';
import { sysName } from './themes.js';
import { kb } from './flight.js';
// =====================================================================
// Canto inferior esquerdo: escopo do radar (B-scope: azimute × distância)
// e mostrador do RWR. Só aparecem se a aeronave tiver o sistema.
// O escopo é fósforo de verdade: cada eco acende quando o feixe passa e
// esmaece até a próxima passagem — a idade do contato fica visível.
// Canto superior direito: mapa tático HONESTO (aliados, objetivo, e só os
// inimigos que você vê a olho ou pelo seu radar).
// =====================================================================
const RH = 252, RW = 286, WW = 176, DEG = Math.PI / 180;
const LVL_TXT = { SEARCH: 'BUSCA', TRACK: 'RASTREIO', LOCK: 'TRAVADO', GUIDANCE: 'MÍSSIL GUIADO' };
const SCALES = [10000, 20000, 40000];
const QNAME = { DF: 'frente dir.', DT: 'trás dir.', EF: 'frente esq.', ET: 'trás esq.' };

export function leftPanels(p, T) {
  const k = clamp(Math.min(V.W / 1400, V.H / 820), 0.72, 1);
  let x = 16;
  const y = V.H - RH * k - 16;
  const rd = p.sys.radar;
  if (rd && !rd.ranging && T.scope) { g.save(); g.translate(x, y); g.scale(k, k); radarScope(p, rd, T); g.restore(); x += (RW + 12) * k; }
  if (p.sys.rwr) { g.save(); g.translate(x, y); g.scale(k, k); rwrScope(p, p.sys.rwr, T); g.restore(); }
}

// ---------- radar: B-scope ----------
function radarScope(p, rd, T) {
  const SC = T.scope, now = S.now;
  plate(0, 0, RW, RH, T);
  ptxt(sysName(T, rd.R), 22, 22, 13, T.fg, 'left', UI, 700);
  const mode = rd.mode === 'STT' ? (rd.locked ? 'TRAVADO' : 'TRAVANDO') : RADAR_MODE[rd.mode].toUpperCase();
  ptxt(mode, RW - 14, 22, 12, rd.mode === 'STT' ? (rd.locked ? C.enemy : C.amber) : rd.on ? T.accent : T.dim, 'right', UI, 700);
  const sx = 14, sy = 32, sw = RW - 28, sh = RH - 66;
  g.fillStyle = SC.bg; g.fillRect(sx, sy, sw, sh);
  // escala: a menor que cabe o contato mais distante (ACM sempre 10 km)
  let far = 0; for (const c of rd.contacts.values()) far = Math.max(far, c.r);
  const scale = rd.mode === 'ACM' ? 10000 : SCALES.find(s => s >= Math.max(far * 1.15, 8000)) || 40000;
  const azL = rd.R.azLim * DEG, X = az => sx + sw / 2 + clamp(az / azL, -1.04, 1.04) * sw / 2, Y = r => sy + sh - clamp(r / scale, 0, 1.02) * sh;
  g.save(); g.beginPath(); g.rect(sx, sy, sw, sh); g.clip();
  // grade: distância a cada quarto, azimute a cada 30°
  g.fillStyle = SC.grid;
  for (const q of [0.25, 0.5, 0.75]) g.fillRect(sx, Math.round(sy + sh * (1 - q)), sw, 1);
  for (let a = -60; a <= 60; a += 30) if (Math.abs(a) <= rd.R.azLim) g.fillRect(Math.round(X(a * DEG)), sy, 1, sh);
  // limites do volume atual (ACM é um cone estreito)
  if (rd.mode === 'ACM') { g.fillStyle = `rgba(${SC.glow},.35)`; g.fillRect(X(-rd.azLim), sy, 1, sh); g.fillRect(X(rd.azLim), sy, 1, sh); }
  // varredura com rastro de persistência atrás do feixe
  if (rd.on && rd.mode !== 'STT') {
    const bx = X(rd.beam), back = -rd.dir;
    for (let i = 10; i >= 1; i--) { g.fillStyle = `rgba(${SC.glow},${0.05 * (1 - i / 11)})`; g.fillRect(bx + back * i * 3 - 1.5, sy, 3, sh); }
    g.fillStyle = `rgba(${SC.sweep},.85)`; g.fillRect(bx - 0.75, sy, 1.5, sh);
  }
  // ecos: tijolos que acendem na passagem e esmaecem
  for (const [e, c] of rd.contacts) {
    if (c.r > scale * 1.02) continue;
    const age = now - c.t, a = Math.exp(-age / 1.8), x = X(c.az), y = Y(c.r);
    const ally = c.iff === 'ally';
    if (age < 0.12) { g.fillStyle = `rgba(${SC.sweep},.95)`; g.fillRect(x - 5, y - 3, 10, 6); }
    g.fillStyle = ally ? `rgba(109,180,227,${0.25 + 0.7 * a})` : `rgba(${SC.glow},${0.2 + 0.8 * a})`;
    if (ally) { g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); } else g.fillRect(x - 4, y - 2, 8, 4);
    if (e === B.marked && rd.target !== e) { g.strokeStyle = `rgba(${SC.glow},.8)`; g.lineWidth = 1; g.strokeRect(x - 7, y - 6, 14, 12); }
  }
  // alvo em rastreio: quadrado, distância, altitude e aproximação
  const tc = rd.target && rd.contacts.get(rd.target);
  if (rd.mode === 'STT' && tc) {
    const x = X(tc.az), y = Y(tc.r), col = rd.locked ? '#ff6a4d' : C.amber;
    g.strokeStyle = col; g.lineWidth = 1.6; g.strokeRect(x - 8, y - 7, 16, 14);
    if (!rd.locked) { g.fillStyle = col; g.fillRect(x - 8, y + 10, 16 * clamp(rd.lockT / rd.R.lockT, 0, 1), 2); }
  }
  g.restore();
  // escala e legendas
  txt(`${scale / 1000} km`, sx + sw - 4, sy + 12, 10, SC.text, 'right', MONO);
  txt(`${scale / 2000}`, sx + sw - 4, Math.round(sy + sh * 0.5) - 3, 9.5, SC.grid.replace('.16', '.6'), 'right', MONO);
  g.fillStyle = SC.text; g.beginPath(); g.moveTo(sx + sw / 2, sy + sh - 7); g.lineTo(sx + sw / 2 - 5, sy + sh); g.lineTo(sx + sw / 2 + 5, sy + sh); g.closePath(); g.fill();
  let ty = sy + sh + 17;
  if (rd.mode === 'STT' && tc) {
    ptxt(`${fmtD(tc.r)} · alt ${dec(tc.alt / 1000)} km · Vc ${tc.closure >= 0 ? '+' : ''}${Math.round(tc.closure * 3.6)}`, 14, ty, 12, rd.locked ? T.fg : C.amber, 'left', MONO, 500);
    return;
  } else if (!rd.on) ptxt('Radar desligado', 14, ty, 12, T.dim, 'left', UI, 600);
  else ptxt(`${rd.contacts.size} contato${rd.contacts.size === 1 ? '' : 's'}`, 14, ty, 12, T.dim, 'left', UI, 600);
  ptxt(`${kb('a_rmode')} modo  ·  ${kb('a_rlock')} travar`, RW - 14, ty, 10.5, T.dim, 'right', UI, 600);
}

// ---------- RWR ----------
function rwrScope(p, rw, T) {
  plate(0, 0, WW, RH, T);
  ptxt(sysName(T, rw.W), 22, 22, 13, T.fg, 'left', UI, 700);
  ptxt('RWR', WW - 14, 22, 11, T.dim, 'right', UI, 700);
  const cx = WW / 2, cy = 32 + (RH - 66) / 2, R = 66, top = rw.top;
  g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(cx, cy, R + 4, 0, 7); g.fill();
  // avião no centro
  g.strokeStyle = T.dim; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx, cy - 7); g.lineTo(cx, cy + 6); g.moveTo(cx - 6, cy); g.lineTo(cx + 6, cy); g.moveTo(cx - 3, cy + 5); g.lineTo(cx + 3, cy + 5); g.stroke();
  if (rw.W.res >= 90) quadrants(rw, T, cx, cy, R);
  else {
    g.strokeStyle = T.faint; g.lineWidth = 1;
    for (const k of [0.4, 0.75, 1]) { g.beginPath(); g.arc(cx, cy, R * k, 0, 7); g.stroke(); }
    for (let a = 0; a < 360; a += 30) { const r0 = a % 90 ? R - 4 : R - 9, s = Math.sin(a * DEG), c = Math.cos(a * DEG); g.beginPath(); g.moveTo(cx + s * r0, cy - c * r0); g.lineTo(cx + s * R, cy - c * R); g.stroke(); }
    for (const th of rw.list.slice(0, rw.W.maxShow)) {
      const rr = R * (0.22 + 0.72 * (1 - th.strength)), x = cx + Math.sin(th.az) * rr, y = cy - Math.cos(th.az) * rr;
      const col = th.lvl === 'SEARCH' ? T.fg : th.lvl === 'TRACK' ? C.amber : C.enemy;
      const show = th.lvl !== 'GUIDANCE' || Math.sin(V.blink * 16) > -0.3;
      if (show) ptxt(th.type || '?', x, y + 4, 12.5, col, 'center', MONO, 500);
      if (th.lvl === 'LOCK' || th.lvl === 'GUIDANCE') { g.strokeStyle = col; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y - 11); g.lineTo(x + 11, y); g.lineTo(x, y + 11); g.lineTo(x - 11, y); g.closePath(); g.stroke(); }
      if (th === top) { g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y + 2, 13, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
    }
  }
  const ty = 32 + (RH - 66) + 17;
  if (top) ptxt(`${LVL_TXT[top.lvl]}${top.type ? ' · ' + top.type : ''} · ${rw.W.res >= 90 ? QNAME[(top.az >= 0 ? 'D' : 'E') + (Math.abs(top.az) < Math.PI / 2 ? 'F' : 'T')] : clock(top.az)}`, cx, ty, 12, top.lvl === 'SEARCH' ? T.fg : top.lvl === 'TRACK' ? C.amber : C.enemy, 'center', UI, 700);
  else ptxt('Sem emissões', cx, ty, 12, T.dim, 'center', UI, 600);
}
// SPO-10: quatro lâmpadas (quadrantes). Busca pisca; rastreio/trava fica acesa.
function quadrants(rw, T, cx, cy, R) {
  for (const [qa, label] of [[45, 'FD'], [135, 'TD'], [-135, 'TE'], [-45, 'FE']]) {
    const th = rw.list.find(t => Math.abs(t.az - qa * DEG) < 0.01);
    const a0 = (qa - 90 - 38) * DEG, a1 = (qa - 90 + 38) * DEG;
    let col = 'rgba(255,255,255,.06)';
    if (th) {
      const on = th.lvl === 'SEARCH' ? Math.sin(V.blink * 9) > 0 : true;
      col = on ? (th.lvl === 'SEARCH' ? `rgba(255,214,120,${0.35 + 0.5 * th.strength})` : `rgba(255,80,60,${0.55 + 0.4 * th.strength})`) : 'rgba(255,255,255,.08)';
    }
    g.beginPath(); g.arc(cx, cy, R, a0, a1); g.arc(cx, cy, R * 0.45, a1, a0, true); g.closePath();
    g.fillStyle = col; g.fill(); g.strokeStyle = T.edge; g.lineWidth = 1; g.stroke();
    const am = (qa - 90) * DEG; ptxt(label, cx + Math.cos(am) * R * 0.73, cy + Math.sin(am) * R * 0.73 + 4, 10, T.dim, 'center', UI, 700);
  }
}

// ---------- mapa tático (canto superior direito) ----------
export function tacMap(v, T) {
  const R = 74, x = V.W - R - 22, y = R + 70, rng = Math.max(5000, (S.airLimit || 4200) * 1.1);
  g.shadowBlur = 0; g.fillStyle = 'rgba(8,11,9,.5)'; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
  g.strokeStyle = T.faint; g.lineWidth = 1; for (const k of [1, 0.5]) { g.beginPath(); g.arc(x, y, R * k, 0, 7); g.stroke(); }
  const hd = Math.atan2(cam.aimDir.x, cam.aimDir.z), c = Math.cos(hd), s = Math.sin(hd);
  const to = (wx, wz) => { const dx = wx - v.pos.x, dz = wz - v.pos.z; return [x - (dx * c - dz * s) / rng * R, y - (dx * s + dz * c) / rng * R]; };
  const o = B.obj;
  if (o && o.zone) { const [zx, zy] = to(o.zone.x, o.zone.z); g.strokeStyle = C.sky; g.setLineDash([3, 4]); g.beginPath(); g.arc(zx, zy, o.zone.r / rng * R, 0, 7); g.stroke(); g.setLineDash([]); }
  if (o && o.base) { const [bx, by] = to(o.base.x, o.base.z); g.fillStyle = C.ally; g.fillRect(bx - 4, by - 4, 8, 8); }
  g.save(); g.beginPath(); g.arc(x, y, R, 0, 7); g.clip();
  const rd = v.sys && v.sys.radar && !v.sys.radar.ranging ? v.sys.radar : null;
  for (const e of planes) {
    if (!e.alive || e === v) continue;
    const ally = e.team === v.team;
    // inimigo só aparece se estiver à vista (≤ 2,5 km) ou for contato do seu radar (na posição do último eco)
    let px, pz, fresh = 1;
    if (ally || e.pos.distanceTo(v.pos) < 2500) { px = e.pos.x; pz = e.pos.z; }
    else if (rd && rd.contacts.has(e)) { const k = rd.contacts.get(e); px = k.pos.x; pz = k.pos.z; fresh = Math.exp(-(S.now - k.t) / 2); }
    else continue;
    const [qx, qy] = to(px, pz), eh = Math.atan2(e.vel.x, e.vel.z) - hd;
    g.save(); g.translate(qx, qy); g.rotate(-eh); g.globalAlpha = 0.35 + 0.65 * fresh; g.fillStyle = ally ? C.ally : C.enemy;
    g.beginPath(); g.moveTo(0, -5); g.lineTo(3.5, 4); g.lineTo(-3.5, 4); g.closePath(); g.fill(); g.restore();
  }
  for (const m of missiles) if (m.pos.distanceTo(v.pos) < 2000) { const [px, py] = to(m.pos.x, m.pos.z); g.fillStyle = '#fff'; g.fillRect(px - 1, py - 1, 2, 2); }
  g.restore();
  g.fillStyle = T.fg; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 4, y + 4); g.lineTo(x - 4, y + 4); g.closePath(); g.fill();
  txt(`${Math.round(rng / 1000)} km`, x + R - 4, y + R + 12, 10, T.dim, 'right');
}
