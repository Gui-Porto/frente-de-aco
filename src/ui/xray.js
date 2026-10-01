import { S } from '../core/state.js';
import { $, clamp, lerp } from '../core/util.js';
import { hullProfile } from '../vehicles/tank.js';
import { compLabel } from '../combat/ballistics.js';
import { report } from './hud.js';

// Hit-cam raio-X: vista 3D esquemática do interior do alvo, com trajetória e estilhaços
const xc = $('#xray'), xctx = xc.getContext('2d');
export function xrayShot(t, hit, dir, E, am, word, detail, color, inner) {
  report(t, word, detail, color);
  const lp = hit.part === 'hull' ? hit.lp : hit.point.clone().applyMatrix4(t.invRoot).toArray();
  const ld = dir.clone().transformDirection(t.invRoot);
  const ent = inner ? inner.lp : lp;
  const pre = [ent[0] - ld.x * 3, ent[1] - ld.y * 3, ent[2] - ld.z * 3];
  S.xray = { t0: performance.now(), def: t.def, ty: t.turretYaw, turret: t.turretOn, entry: ent, pre, end: inner ? inner.end : null, frags: inner ? inner.frags : [], blast: inner ? inner.blast : null,
    comps: inner ? inner.comps.map((c, i) => ({ p: c.p, r: c.r, kind: c.kind, label: compLabel(c), was: inner.before[i], now: c.kind === 'crew' ? c.ref.alive : !(c.name in t.mods) || !t.mods[c.name].broken })) : t.components().map(c => ({ p: c.p, r: c.r, kind: c.kind, was: true, now: true })),
    word, color, ammo: `${am.name} · ${Math.round(E.pen)} mm`, plate: `${E.arm.t} mm · ${Math.round(E.ang)}° → ${Math.round(E.eff)} mm` };
  xc.hidden = false;
}
export function xrayReport(r) {
  report(r.t, r.w, r.s, r.c);
  if (!r.x) return;
  const t = r.t;
  S.xray = { t0: performance.now(), def: t.def, ty: t.turretYaw, turret: t.turretOn, entry: r.x.lp, pre: [r.x.lp[0], r.x.lp[1] + 3, r.x.lp[2]], end: null, frags: r.x.frags, blast: r.x.blast,
    comps: r.x.comps.map((c, i) => ({ p: c.p, r: c.r, kind: c.kind, label: compLabel(c), was: r.x.before[i], now: c.kind === 'crew' ? c.ref.alive : !(c.name in t.mods) || !t.mods[c.name].broken })),
    word: r.w, color: r.c, ammo: 'Alto-explosivo', plate: r.s.split(' · ').slice(1, 2).join('') };
  xc.hidden = false;
}
export function drawXray() {
  if (!S.xray) return;
  const el = (performance.now() - S.xray.t0) / 1000;
  if (el > 4.2) { S.xray = null; xc.hidden = true; return; }
  const W = xc.width, Hh = xc.height, c = xctx, D = S.xray.def;
  c.clearRect(0, 0, W, Hh);
  c.fillStyle = 'rgba(8,14,18,.92)'; c.fillRect(0, 0, W, Hh);
  const yaw = 0.7 + el * 0.25, pit = 0.42, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  const sc = Math.min(W, Hh) / (D.L * 1.25), ox = W / 2, oy = Hh * 0.58;
  const P = (x, y, z) => { y -= D.clr + D.Hh * 0.5; const X = x * cy - z * sy, Z = x * sy + z * cy; const Y = y * cp - Z * sp; return [ox + X * sc, oy - Y * sc, Z * cp + y * sp]; };
  const box = (mn, mx, tf) => {
    const v = []; for (const x of [mn[0], mx[0]]) for (const y of [mn[1], mx[1]]) for (const z of [mn[2], mx[2]]) v.push(P(...(tf ? tf(x, y, z) : [x, y, z])));
    const e = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    c.beginPath(); for (const [a, b] of e) { c.moveTo(v[a][0], v[a][1]); c.lineTo(v[b][0], v[b][1]); } c.stroke();
  };
  c.strokeStyle = 'rgba(120,190,220,.55)'; c.lineWidth = 1;
  // casco pelo perfil real
  const pr = hullProfile(D), hw = (D.W - 2 * D.trackW) / 2;
  c.beginPath();
  for (const s of [hw, -hw]) pr.forEach(([z, y], i) => { const q = P(s, y, z); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); if (i === pr.length - 1) { const q0 = P(s, pr[0][1], pr[0][0]); c.lineTo(q0[0], q0[1]); } });
  for (const [z, y] of pr) { const a = P(hw, y, z), b = P(-hw, y, z); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
  c.stroke();
  c.strokeStyle = 'rgba(120,190,220,.3)';
  box([-D.W / 2, 0.05, -D.L * .47], [-D.W / 2 + D.trackW, D.clr + .45, D.L * .47]); box([D.W / 2 - D.trackW, 0.05, -D.L * .47], [D.W / 2, D.clr + .45, D.L * .47]);
  if (S.xray.turret) {
    const T = D.turret, yH = D.clr + D.Hh, ct = Math.cos(S.xray.ty), st = Math.sin(S.xray.ty);
    c.strokeStyle = 'rgba(120,190,220,.55)';
    box([-T.w / 2, 0, -T.l / 2], [T.w / 2, T.h, T.l / 2], (x, y, z) => [x * ct + z * st, yH + y, -x * st + z * ct + T.z]);
    const g0 = P(T.l / 2 * st, yH + T.h / 2, T.l / 2 * ct + T.z), g1 = P((T.l / 2 + D.gun.len) * st, yH + T.h / 2, (T.l / 2 + D.gun.len) * ct + T.z);
    c.lineWidth = 2; c.beginPath(); c.moveTo(g0[0], g0[1]); c.lineTo(g1[0], g1[1]); c.stroke(); c.lineWidth = 1;
  }
  // componentes ordenados por profundidade
  const k = clamp((el - 0.6) / 0.8, 0, 1);
  const comps = S.xray.comps.map(o => ({ o, q: P(...o.p) })).sort((a, b) => b.q[2] - a.q[2]);
  for (const { o, q } of comps) {
    const hitNow = o.was && !o.now && k > 0.5;
    c.fillStyle = hitNow ? 'rgba(230,70,50,.95)' : o.now ? (o.kind === 'crew' ? 'rgba(110,200,110,.85)' : 'rgba(170,170,160,.7)') : 'rgba(120,40,30,.8)';
    c.beginPath(); c.arc(q[0], q[1], Math.max(3, o.r * sc * 0.55), 0, 7); c.fill();
  }
  // trajetória do projétil
  const s = clamp(el / 0.6, 0, 1), a = P(...xray.pre), b = P(...xray.entry);
  c.strokeStyle = '#ffd08a'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(lerp(a[0], b[0], s), lerp(a[1], b[1], s)); c.stroke();
  if (s >= 1 && S.xray.end) { const e = P(...xray.end); c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(lerp(b[0], e[0], k), lerp(b[1], e[1], k)); c.stroke(); }
  if (k > 0) {
    c.strokeStyle = 'rgba(255,170,80,.75)'; c.lineWidth = 1; c.beginPath();
    for (const [f0, f1] of S.xray.frags) { const p0 = P(...f0), p1 = P(...f1); c.moveTo(p0[0], p0[1]); c.lineTo(lerp(p0[0], p1[0], k), lerp(p0[1], p1[1], k)); }
    c.stroke();
    if (S.xray.blast && k < 0.7) { const q = P(...xray.blast); c.fillStyle = `rgba(255,180,80,${0.7 - k})`; c.beginPath(); c.arc(q[0], q[1], 10 + k * 30, 0, 7); c.fill(); }
  }
  c.fillStyle = '#ddd6b7'; c.font = '600 13px "Barlow Condensed", sans-serif'; c.textAlign = 'left';
  c.fillText(`${D.short || D.name}`, 10, 18);
  c.font = '500 11px "IBM Plex Mono", monospace'; c.fillStyle = 'rgba(221,214,183,.75)';
  c.fillText(S.xray.ammo, 10, Hh - 26); c.fillText(S.xray.plate || '', 10, Hh - 11);
  c.textAlign = 'right'; c.font = '400 18px "Saira Stencil One", sans-serif';
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--' + S.xray.color);
  c.fillText(S.xray.word, W - 10, 22);
  const lost = S.xray.comps.filter(o => o.was && !o.now && o.label).map(o => o.label);
  if (k > 0.5 && lost.length) { c.font = '500 11px "IBM Plex Mono", monospace'; c.fillStyle = '#e65a42'; lost.slice(0, 5).forEach((l, i) => c.fillText(l, W - 10, 42 + i * 14)); }
}

