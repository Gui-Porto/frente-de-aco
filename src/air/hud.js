import { Quaternion } from 'three';
import { camera } from '../core/render.js';
import { S, planes } from '../core/state.js';
import { isDown } from '../core/settings.js';
import { V3, $, clamp } from '../core/util.js';
import { H } from '../world/terrain.js';
import { MISSILES } from '../data/vehicles.js';
import { drawScore } from '../ui/hud.js';
import { settings, keyName } from '../core/settings.js';
import { LABEL, modFrac, fuelLeak } from '../vehicles/planeDamage.js';
import { B } from './battle.js';
import { LOCK, LOCK_LABEL, leadPoint, energyHeight } from './targeting.js';
import { incomingTo, missiles } from './missiles.js';
import { acam, CAM_MODES } from './camera.js';
import { cam } from '../game/camera.js';
// =====================================================================
// HUDSystem da Batalha Aérea: um único canvas 2D redesenhado por quadro.
// Assinatura: retículo giroscópico (K-14) cujo anel fecha com a distância do
// alvo marcado. Fitas de velocidade/altitude/rumo, energia, armas com
// aquecimento, lock do míssil, ameaças, radar e silhueta de dano.
// =====================================================================
const cv = $('#airhud'), g = cv.getContext('2d');
const C = { ink: 'rgba(8,11,9,.62)', ph: '#e9dfb4', phd: 'rgba(233,223,180,.55)', amber: '#efa53c', enemy: '#e65a42', ally: '#6db4e3', sky: '#8fb7cf', ok: '#93cf6c' };
const MONO = '"IBM Plex Mono", ui-monospace, monospace', UI = '"Barlow Condensed", "Arial Narrow", sans-serif';
const _a = new V3(), _b = new V3(), _s = new V3();
let W = 0, Hh = 0, dpr = 1, blink = 0, lastE = 0, eRate = 0, eT = 0;
export function showAirHud(on) { cv.hidden = !on; $('#hud').classList.toggle('air', on); }

// projeta um ponto do mundo; retorna null se atrás da câmera
function proj(p, out = { x: 0, y: 0, on: false }) {
  _s.copy(p).project(camera);
  if (_s.z > 1) { out.on = false; out.x = -_s.x; out.y = _s.y; return null; }
  out.x = (_s.x + 1) / 2 * W; out.y = (1 - _s.y) / 2 * Hh; out.on = Math.abs(_s.x) <= 1 && Math.abs(_s.y) <= 1; return out;
}
const P1 = { x: 0, y: 0, on: false }, P2 = { x: 0, y: 0, on: false };
const glow = (c, b = 6) => { g.shadowColor = c; g.shadowBlur = b; };
function txt(s, x, y, size = 13, col = C.ph, align = 'left', font = MONO) { g.font = `500 ${size}px ${font}`; g.fillStyle = col; g.textAlign = align; g.fillText(s, x, y); }

export function updateAirHUD(dt) {
  if (S.state === 'airmenu' || S.mode !== 'air') return;
  dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== innerWidth * dpr || cv.height !== innerHeight * dpr) { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
  W = innerWidth; Hh = innerHeight; blink += dt;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
  $('#score').hidden = !isDown('score'); if (!$('#score').hidden) drawScore();
  const p = S.player, live = p && p.alive && S.state === 'play';
  const v = live ? p : S.spectate;
  g.lineCap = 'round'; g.lineJoin = 'round';
  topBar(v);
  if (!v) return;
  targets(v, live);
  if (live) {
    if (acam.mode === 2) cockpitFrame();
    speedLines(p);
    reticle(p);
    tapes(p, dt);
    instruments(p, dt);
    weapons(p);
    warnings(p);
    crits();
    damagePanel(p);
  } else if (S.state === 'spectate' && v) {
    txt(`ASSISTINDO · ${v.who ? v.who.name : ''} · ${v.def.short}`, W / 2, Hh - 40, 15, C.ally, 'center', UI);
  }
  radar(v);
  $('#gdark').style.opacity = live ? clamp(p.gStress - 0.3, 0, 1) * 0.92 : 0;
}

// ---------- barra superior: objetivo, tempo, câmera ----------
function topBar(v) {
  const o = B.obj, t = B.t, m = Math.floor(t / 60), s = Math.floor(t % 60);
  g.shadowBlur = 0;
  const w = 420, x = W / 2 - w / 2;
  g.fillStyle = C.ink; g.fillRect(x, 12, w, 30);
  g.fillStyle = C.sky; g.fillRect(x, 12, 3, 30);
  txt(B.mode ? B.mode.label.toUpperCase() : '', x + 12, 32, 13, C.sky, 'left', UI);
  txt(o ? o.status(B) : '', W / 2 + 10, 32, 13, C.ph, 'center', MONO);
  txt(`${m}:${String(s).padStart(2, '0')}`, x + w - 10, 32, 13, C.phd, 'right');
  if (v && S.state === 'play') txt(`CÂMERA · ${CAM_MODES[acam.mode].toUpperCase()}${acam.aimK > 0.5 ? ' · MIRA' : ''}`, x + w - 10, 58, 11, C.phd, 'right', UI);
}

// ---------- marcadores de aeronaves e setas fora da tela ----------
function targets(v, live) {
  const mk = B.marked;
  for (const e of planes) {
    if (!e.alive || e === v) continue;
    const d = e.pos.distanceTo(camera.position), en = e.team !== 1, col = en ? C.enemy : C.ally;
    if (d > 5000) continue;
    const pr = proj(e.pos, P1);
    if (!pr || !pr.on) { if (en && (e === mk || d < 2500)) edgeArrow(e, col, d, e === mk); continue; }
    const r = clamp(1400 / d * 6, 9, 30);
    g.strokeStyle = col; g.lineWidth = e === mk ? 2 : 1.4; glow(col, 4);
    if (en) { // colchetes de alvo
      const c = r * 0.45;
      g.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(pr.x + sx * r, pr.y + sy * (r - c)); g.lineTo(pr.x + sx * r, pr.y + sy * r); g.lineTo(pr.x + sx * (r - c), pr.y + sy * r); }
      g.stroke();
      if (e === mk) { g.beginPath(); g.moveTo(pr.x, pr.y - r - 9); g.lineTo(pr.x + 5, pr.y - r - 4); g.lineTo(pr.x - 5, pr.y - r - 4); g.closePath(); g.fillStyle = col; g.fill(); }
    } else { g.beginPath(); g.moveTo(pr.x - 7, pr.y - r * 0.6); g.lineTo(pr.x, pr.y - r * 0.6 + 6); g.lineTo(pr.x + 7, pr.y - r * 0.6); g.stroke(); }
    g.shadowBlur = 0;
    const lab = en ? `${e.def.short}  ${fmtD(d)}` : `${e.who ? e.who.name : ''}`;
    if (en || d < 1500) txt(lab, pr.x, pr.y + r + 14, 11, col, 'center');
    // avanço (lead) do alvo marcado: onde mirar para as balas encontrarem o alvo
    if (live && e === mk && d < 1600) {
      const Wg = v.guns.find(q => q.ammo > 0) || v.guns[0];
      leadPoint(v.pos, v.vel, e.pos, e.vel, Wg.W.v, _a);
      const lp = proj(_a, P2);
      if (lp && lp.on) {
        g.strokeStyle = C.enemy; g.lineWidth = 1.6; glow(C.enemy, 5);
        g.beginPath(); g.arc(lp.x, lp.y, 7, 0, 7); g.stroke();
        g.beginPath(); g.arc(lp.x, lp.y, 1.6, 0, 7); g.fillStyle = C.enemy; g.fill();
        g.globalAlpha = 0.35; g.beginPath(); g.moveTo(pr.x, pr.y); g.lineTo(lp.x, lp.y); g.stroke(); g.globalAlpha = 1; g.shadowBlur = 0;
      }
    }
  }
  // mísseis no ar
  for (const m of missiles) { const pr = proj(m.pos, P1); if (pr && pr.on) { g.fillStyle = m.target === v ? C.enemy : C.ph; g.fillRect(pr.x - 2, pr.y - 2, 4, 4); } }
}
function edgeArrow(e, col, d, big) {
  _a.copy(e.pos).sub(camera.position).applyQuaternion(_q.copy(camera.quaternion).invert());
  const ang = Math.atan2(-_a.y, _a.x), R = Math.min(W, Hh) * 0.42;
  const x = W / 2 + Math.cos(ang) * R, y = Hh / 2 + Math.sin(ang) * R;
  g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = col; g.globalAlpha = big ? 1 : 0.7;
  g.beginPath(); g.moveTo(big ? 14 : 10, 0); g.lineTo(-6, big ? 8 : 6); g.lineTo(-6, big ? -8 : -6); g.closePath(); g.fill(); g.restore();
  if (big) txt(fmtD(d), x - Math.cos(ang) * 26, y - Math.sin(ang) * 26 + 4, 11, col, 'center');
}
const _q = new Quaternion();
const fmtD = d => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1).replace('.', ',')} km`);

// ---------- retículo giroscópico + círculo do mouse + lock do míssil ----------
function reticle(p) {
  // eixo das armas (convergência ~400 m)
  _a.set(0, 0, 400).applyMatrix4(p.root.matrixWorld);
  const pr = proj(_a, P1);
  const mk = B.marked, d = mk ? mk.pos.distanceTo(p.pos) : 0;
  if (pr) {
    // anel de 8 losangos: raio ∝ envergadura típica / distância (encaixe o alvo no anel = alcance certo)
    const fpx = Hh / 2 / Math.tan(camera.fov * Math.PI / 360);
    const R = mk && d < 1200 ? clamp(11 / d * fpx, 16, 90) : 46;
    g.strokeStyle = C.ph; g.fillStyle = C.ph; g.lineWidth = 1.6; glow(C.ph, 7);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, x = pr.x + Math.cos(a) * R, y = pr.y + Math.sin(a) * R; g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 3, y); g.lineTo(x, y + 4); g.lineTo(x - 3, y); g.closePath(); g.fill(); }
    g.beginPath(); g.arc(pr.x, pr.y, 2.2, 0, 7); g.fill();
    g.beginPath(); g.moveTo(pr.x - 14, pr.y); g.lineTo(pr.x - 6, pr.y); g.moveTo(pr.x + 6, pr.y); g.lineTo(pr.x + 14, pr.y); g.moveTo(pr.x, pr.y + 6); g.lineTo(pr.x, pr.y + 14); g.stroke();
    if (mk && d < 1200) txt(fmtD(d), pr.x + R + 8, pr.y + 4, 11, C.ph);
    g.shadowBlur = 0;
    // lock do míssil: cone do buscador ao redor do eixo
    if (B.seeker && p.missiles > 0) {
      const M = B.seeker.M, st = B.seeker.state, rc = Math.tan((M.acq || M.fov * 2.5) * Math.PI / 180) * fpx;
      const col = st === LOCK.LOCKED ? C.enemy : st === LOCK.TRACK ? C.amber : st === LOCK.LOST ? C.enemy : C.phd;
      g.strokeStyle = col; g.lineWidth = 1.4; g.setLineDash(st === LOCK.SEARCH ? [4, 6] : []);
      g.beginPath(); g.arc(pr.x, pr.y, rc, 0, 7); g.stroke(); g.setLineDash([]);
      txt(LOCK_LABEL[st], pr.x, pr.y + rc + 16, 13, col, 'center', UI);
      const tg = B.seeker.target;
      if (tg) { const tp = proj(tg.pos, P2); if (tp) { const s = st === LOCK.LOCKED ? 16 : 13 + Math.sin(blink * 18) * 3; g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(tp.x - s, tp.y - s, s * 2, s * 2); if (st === LOCK.TRACK) { g.fillStyle = col; g.fillRect(tp.x - s, tp.y + s + 4, s * 2 * clamp(B.seeker.t / M.lockT, 0, 1), 3); } } }
    }
  }
  // para onde o mouse está mandando o avião
  _b.copy(p.pos).addScaledVector(cam.aimDir, 1000);
  const ap = proj(_b, P2);
  if (ap && acam.mode !== 3) { g.strokeStyle = C.phd; g.lineWidth = 1.2; g.beginPath(); g.arc(ap.x, ap.y, 9, 0, 7); g.stroke(); }
}

// ---------- fitas de velocidade, altitude e rumo ----------
function tapes(p, dt) {
  const cx = W / 2, cy = Hh / 2, off = Math.min(W * 0.27, 330), hh = 220;
  const ias = p.ias * 3.6, alt = p.pos.y;
  tape(cx - off, cy, hh, ias, 50, 10, 'left', 'KM/H', Math.round(ias), p.ias < stallV(p) * 1.15 ? C.amber : C.ph);
  tape(cx + off, cy, hh, alt, 250, 50, 'right', 'M', Math.round(alt), alt - H(p.pos.x, p.pos.z) < 150 ? C.amber : C.ph);
  // rumo
  const hd = (Math.atan2(cam.aimDir.x, cam.aimDir.z) * 180 / Math.PI + 360 + 180) % 360;
  const hw = 300, hx = cx - hw / 2, hy = 74;
  g.save(); g.beginPath(); g.rect(hx, hy - 16, hw, 30); g.clip();
  g.strokeStyle = C.phd; g.lineWidth = 1;
  for (let a = Math.floor(hd / 5) * 5 - 40; a <= hd + 40; a += 5) {
    const x = cx + (a - hd) * 4, big = a % 30 === 0;
    g.beginPath(); g.moveTo(x, hy - 8); g.lineTo(x, hy - (big ? 0 : 4)); g.stroke();
    if (big) txt(({ 0: 'N', 90: 'L', 180: 'S', 270: 'O' })[(a + 360) % 360] || String(((a + 360) % 360) / 10).padStart(2, '0'), x, hy + 12, 11, C.phd, 'center');
  }
  g.restore();
  txt(String(Math.round(hd)).padStart(3, '0'), cx, hy - 14, 13, C.ph, 'center');
  // VSI ao lado da altitude e Mach para jatos
  const vs = p.vel.y;
  txt(`${vs >= 0 ? '▲' : '▼'} ${Math.abs(vs).toFixed(0)} m/s`, cx + off + 8, cy + hh / 2 + 22, 12, C.phd, 'right');
  if (p.def.jet) txt(`M ${(p.vel.length() / 340).toFixed(2).replace('.', ',')}`, cx - off - 8, cy + hh / 2 + 22, 12, C.phd, 'left');
}
function tape(x, cy, h, val, step, minor, side, unit, shown, col) {
  const s = side === 'left' ? -1 : 1, ppu = h / (step * 4);
  g.save(); g.beginPath(); g.rect(x + (s < 0 ? -70 : 0), cy - h / 2, 70, h); g.clip();
  g.strokeStyle = C.phd; g.lineWidth = 1;
  for (let v = Math.floor((val - step * 2.2) / minor) * minor; v <= val + step * 2.2; v += minor) {
    const y = cy - (v - val) * ppu, big = Math.abs(v % step) < 1e-6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + s * (big ? 12 : 6), y); g.stroke();
    if (big && v >= 0) txt(String(v), x + s * 16, y + 4, 11, C.phd, side === 'left' ? 'right' : 'left');
  }
  g.restore();
  g.strokeStyle = C.phd; g.beginPath(); g.moveTo(x, cy - h / 2); g.lineTo(x, cy + h / 2); g.stroke();
  // janela com o valor atual
  g.fillStyle = C.ink; g.strokeStyle = col; g.lineWidth = 1.4;
  const bx = side === 'left' ? x - 74 : x + 6;
  g.beginPath(); g.rect(bx, cy - 12, 68, 24); g.fill(); g.stroke();
  txt(String(shown), bx + 34, cy + 5, 15, col, 'center');
  txt(unit, bx + (side === 'left' ? 0 : 68), cy - 18, 10, C.phd, side === 'left' ? 'left' : 'right', UI);
}
const stallV = p => Math.sqrt(2 * p.def.mass * 9.81 / (1.225 * p.def.S * p.def.clmax)) * 0.95;

// ---------- painel de instrumentos (canto inferior esquerdo) ----------
function instruments(p, dt) {
  const x = 18, y = Hh - 170, w = 230, h = 152;
  panel(x, y, w, h, 'INSTRUMENTOS');
  // potência
  const thr = p.def.jet ? p.spool : p.throttle;
  g.fillStyle = 'rgba(233,223,180,.12)'; g.fillRect(x + 12, y + 30, 14, 108);
  g.fillStyle = p.wep ? C.amber : C.ph; g.fillRect(x + 12, y + 30 + 108 * (1 - thr), 14, 108 * thr);
  txt(p.wep ? 'WEP' : `${Math.round(p.throttle * 100)}%`, x + 19, y + 26, 11, p.wep ? C.amber : C.ph, 'center');
  const es = energyHeight(p.pos.y, p.vel.length());
  if ((eT -= dt) <= 0) { eRate = (es - lastE) / 0.5; lastE = es; eT = 0.5; }
  const as = p.def.clmax / p.def.cla;
  const rows = [
    ['G', p.n.toFixed(1).replace('.', ','), Math.abs(p.n) > p.def.glim * 0.8 ? C.enemy : Math.abs(p.n) > 6 ? C.amber : C.ph],
    ['AoA', `${(p.alpha * 57.3).toFixed(0)}°`, Math.abs(p.alpha) > as * 0.85 ? C.amber : C.ph],
    ['ENERGIA', `${(es / 1000).toFixed(2).replace('.', ',')} km ${eRate > 3 ? '▲' : eRate < -3 ? '▼' : '■'}`, eRate < -25 ? C.amber : C.ph],
    ['MOTOR', !p.engineOn ? 'PARADO' : p.fire > 0 ? 'FOGO' : `${Math.round(p.temp)}°C`, !p.engineOn || p.fire > 0 ? C.enemy : p.temp > 110 ? C.amber : C.ph],
    ['TREM', p.gear ? 'BAIXADO' : 'RECOLHIDO', p.gear ? C.amber : C.phd],
    ['FLAPS', p.flaps ? 'BAIXADOS' : p.airbrake ? 'FREIO' : '—', p.flaps || p.airbrake ? C.amber : C.phd],
  ];
  rows.forEach(([k, v, c], i) => { txt(k, x + 40, y + 42 + i * 19, 11, C.phd, 'left', UI); txt(v, x + w - 12, y + 42 + i * 19, 13, c, 'right'); });
}
function panel(x, y, w, h, title) {
  g.shadowBlur = 0; g.fillStyle = C.ink; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(233,223,180,.18)'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  g.fillStyle = C.sky; g.fillRect(x, y, 18, 2);
  txt(title, x + 10, y + 16, 10, C.phd, 'left', UI);
}

// ---------- armas: munição, aquecimento, mísseis ----------
const kb = id => keyName(settings.binds[id] && settings.binds[id][0]);
function weapons(p) {
  const rows = p.guns.length + (p.def.missiles ? 1 : 0) + (p.def.jet ? 1 : 0);
  const w = 320, h = 30 + rows * 20, x = W / 2 - w / 2, y = Hh - h - 16;
  panel(x, y, w, h, `ARMAMENTO · [${kb('a_guns')}] armas`);
  let yy = y + 34;
  for (const gg of p.guns) {
    const col = gg.broken ? C.enemy : C.ph;
    txt(gg.W.name, x + 12, yy, 12, col, 'left', UI);
    txt(gg.broken ? 'INOPERANTE' : String(gg.ammo), x + 200, yy, 13, gg.broken ? C.enemy : gg.ammo < gg.max * 0.15 ? C.amber : C.ph, 'right');
    g.fillStyle = 'rgba(233,223,180,.12)'; g.fillRect(x + 212, yy - 8, 96, 6);
    g.fillStyle = gg.jam ? C.enemy : gg.heat > 0.7 ? C.amber : C.ph; g.fillRect(x + 212, yy - 8, 96 * gg.heat, 6);
    if (gg.jam) txt('SUPERAQUECIDA', x + 260, yy + 9, 9, C.enemy, 'center', UI);
    yy += 20;
  }
  if (p.def.missiles) {
    const M = MISSILES[p.def.missiles.w];
    txt(`[${kb('a_missile')}] ${M.short}`, x + 12, yy, 12, C.ph, 'left', UI);
    for (let i = 0; i < p.def.missiles.n; i++) { g.fillStyle = i < p.missiles ? C.ph : 'rgba(233,223,180,.15)'; g.fillRect(x + 150 + i * 22, yy - 9, 16, 9); }
    yy += 20;
  }
  if (p.def.jet) {
    txt(`[${kb('a_cm')}] CONTRAMEDIDAS`, x + 12, yy, 12, C.ph, 'left', UI);
    txt(`FLARES ${p.flares}  ·  CHAFF ${p.chaff}`, x + w - 12, yy, 12, p.flares ? C.ph : C.amber, 'right');
  }
}
// acertos críticos do jogador, logo abaixo do retículo (somem em 2,5 s)
function crits() {
  const now = S.now; let i = 0;
  for (const c of B.critLog) {
    const age = now - c.at; if (age > 2.5) continue;
    g.globalAlpha = clamp(2.5 - age, 0, 1);
    txt(c.t.toUpperCase(), W / 2, Hh * 0.62 + i * 20, 15, C.amber, 'center', UI); i++;
  }
  g.globalAlpha = 1;
}

// ---------- alertas no centro ----------
function warnings(p) {
  const list = [];
  const inc = incomingTo(p);
  if (inc) list.push([`MÍSSIL · ${fmtD(inc.pos.distanceTo(p.pos))}`, C.enemy, true]);
  const as = p.def.clmax / p.def.cla;
  if (Math.abs(p.alpha) > as * 0.9 || p.ias < stallV(p)) list.push(['ESTOL', C.amber, true]);
  const agl = p.pos.y - H(p.pos.x, p.pos.z);
  if (agl < 220 && p.vel.y < -12) list.push(['ALTITUDE · PUXE', C.enemy, true]);
  if (Math.abs(p.n) > p.def.glim * 0.85) list.push(['SOBRECARGA G', C.enemy, false]);
  if (p.ias > p.def.vne * 0.95) list.push(['VELOCIDADE-LIMITE', C.amber, true]);
  if (p.guns.some(q => q.jam)) list.push(['ARMA SUPERAQUECIDA', C.amber, false]);
  if (p.oobT > 0) list.push([`RETORNE À ÁREA · ${Math.ceil(15 - p.oobT)} s`, C.amber, true]);
  for (const e of planes) {
    if (!e.alive || e.team === p.team) continue;
    _a.copy(p.pos).sub(e.pos); const d = _a.length(); if (d > 800) continue;
    _a.divideScalar(d); _b.set(0, 0, 1).applyQuaternion(e.q);
    if (_b.dot(_a) > 0.96 && _a.dot(_s.set(0, 0, 1).applyQuaternion(p.q)) > 0.3) { list.push(['INIMIGO NA CAUDA', C.enemy, false]); break; }
  }
  list.slice(0, 3).forEach(([t, c, bl], i) => {
    if (bl && Math.sin(blink * 9) < -0.2) return;
    g.font = `600 22px ${UI}`; const tw = g.measureText(t).width + 26, x = W / 2 - tw / 2, y = Hh * 0.27 + i * 34;
    g.fillStyle = 'rgba(8,11,9,.55)'; g.fillRect(x, y - 21, tw, 29); g.strokeStyle = c; g.lineWidth = 1.5; g.strokeRect(x, y - 21, tw, 29);
    txt(t, W / 2, y + 1, 22, c, 'center', UI);
  });
  // tons de alerta e do buscador
  B.warnTone = inc ? 'missile' : list.some(l => l[0] === 'ESTOL') ? 'stall' : null;
}

// ---------- condição da aeronave (vista de cima com os componentes, como o painel de dano do WT) ----------
const fcol = f => (f <= 0 ? '#6b2119' : f < 0.35 ? C.enemy : f < 0.7 ? C.amber : 'rgba(147,207,108,.85)');
function damagePanel(p) {
  const D = p.def, M = p.mods, w = 236, sh = 168, x = W - w - 18;
  const status = [];
  if (p.fire > 0) status.push([`INCÊNDIO · [${kb('a_ext')}] extintor ${p.ext ? '×1' : 'usado'}`, C.enemy]);
  const leak = fuelLeak(p); if (leak > 0 && p.fuel > 0) status.push([`VAZAMENTO · ${leak.toFixed(1).replace('.', ',')} kg/s`, C.amber]);
  if (!p.engineOn) status.push(['MOTOR PARADO', C.enemy]); else if (p.hp.engine < p.maxHp.engine * 0.7) status.push([`MOTOR · ${Math.round(100 * (0.35 + 0.65 * p.hp.engine / p.maxHp.engine))}% de potência`, C.amber]);
  if (p.oil) status.push([D.jet ? 'ÓLEO VAZANDO' : 'RADIADOR VAZANDO', C.amber]);
  if (p.wounded) status.push(['PILOTO FERIDO', C.amber]);
  const dead = ['elev', 'rud', 'ailL', 'ailR', 'cables', 'hyd'].filter(n => M[n] && M[n].dead).map(n => LABEL[n].toUpperCase());
  if (dead.length) status.push([dead.join(' · ') + ' INOPERANTE' + (dead.length > 1 ? 'S' : ''), C.enemy]);
  const h = sh + 50 + status.length * 17, y = Hh - h - 18;
  panel(x, y, w, h, 'CONDIÇÃO DA AERONAVE');
  const s = Math.min((sh - 16) / D.L, (w - 30) / D.span), ox = x + w / 2, oy = y + 22 + sh / 2;
  const P = (lx, lz) => [ox - lx * s, oy - lz * s];
  const sf = k => p.hp[k] / p.maxHp[k];
  g.lineWidth = 1; g.lineJoin = 'round';
  // asas (com enflechamento), fuselagem e empenagem: cor = integridade da estrutura
  const swp = D.span / 2 * Math.tan((D.sweep || 0) * Math.PI / 180);
  for (const [side, k, on] of [[1, 'wingL', p.wingOn.L], [-1, 'wingR', p.wingOn.R]]) {
    const pts = [P(side * D.fuseR, D.wingZ + D.chord * 0.35), P(side * D.span / 2, D.wingZ + D.tipChord * 0.3 - swp), P(side * D.span / 2, D.wingZ - D.tipChord * 0.7 - swp), P(side * D.fuseR, D.wingZ - D.chord * 0.65)];
    g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(...q) : g.moveTo(...q))); g.closePath();
    if (on) { g.fillStyle = fcol(sf(k)); g.globalAlpha = 0.28; g.fill(); g.globalAlpha = 1; g.strokeStyle = 'rgba(233,223,180,.55)'; g.setLineDash([]); }
    else { g.strokeStyle = C.enemy; g.setLineDash([3, 3]); }
    g.stroke(); g.setLineDash([]);
  }
  if (p.tailOn) { const [a, b] = P(D.span * 0.19, -D.L * 0.43); g.fillStyle = fcol(sf('tail')); g.globalAlpha = 0.28; g.fillRect(a, b, D.span * 0.38 * s, D.L * 0.1 * s); g.globalAlpha = 1; g.strokeStyle = 'rgba(233,223,180,.55)'; g.strokeRect(a, b, D.span * 0.38 * s, D.L * 0.1 * s); }
  { const [a, b] = P(D.fuseR, D.L * 0.47); g.fillStyle = fcol(sf('fuse')); g.globalAlpha = 0.28; g.beginPath(); g.roundRect(a, b, D.fuseR * 2 * s, D.L * 0.97 * s, D.fuseR * s); g.fill(); g.globalAlpha = 1; g.strokeStyle = 'rgba(233,223,180,.55)'; g.stroke(); }
  // componentes internos
  for (const m of Object.values(M)) {
    if ((m.name === 'ailL' && !p.wingOn.L) || (m.name === 'ailR' && !p.wingOn.R) || ((m.name === 'elev' || m.name === 'rud') && !p.tailOn)) continue;
    const f = m.kind === 'engine' ? (p.engineOn ? p.hp.engine / p.maxHp.engine : 0) : modFrac(m);
    const [a, b] = P(m.c[0] + m.h[0], m.c[2] + m.h[2]), ww = Math.max(3, m.h[0] * 2 * s), hh = Math.max(3, m.h[2] * 2 * s);
    const flash = S.now - m.hitT < 0.25;
    g.fillStyle = flash ? '#fff' : fcol(f); g.beginPath();
    if (m.kind === 'pilot') g.arc(a + ww / 2, b + hh / 2, Math.min(ww, hh) / 2 + 1, 0, 7); else g.roundRect(a, b, ww, hh, 2);
    g.fill();
    if (f <= 0) { g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(a, b); g.lineTo(a + ww, b + hh); g.moveTo(a + ww, b); g.lineTo(a, b + hh); g.stroke(); g.lineWidth = 1; }
    if (m.leak > 0 && p.fuel > 0) { g.fillStyle = C.sky; g.beginPath(); g.arc(a + ww + 3, b + hh / 2 + Math.sin(blink * 8) * 2, 2, 0, 7); g.fill(); }
  }
  if (p.fire > 0) { const [a, b] = P(p.fireAt[0], p.fireAt[2]); g.fillStyle = `rgba(255,${120 + Math.random() * 80},40,${0.5 + Math.random() * 0.3})`; g.beginPath(); g.arc(a, b, 9 + Math.random() * 3, 0, 7); g.fill(); }
  // combustível
  const fy = y + 22 + sh + 8, burn = p.def.jet ? 0.75 * Math.max(p.spool, 0.3) : (p.wep ? D.wep : D.hp) * 0.000105 * Math.max(p.throttle, 0.3);
  const mins = p.fuel / Math.max(burn + leak, 0.01) / 60;
  txt('COMBUSTÍVEL', x + 10, fy + 9, 10, C.phd, 'left', UI);
  txt(`${Math.round(p.fuel)} kg · ${mins > 99 ? '99+' : Math.floor(mins)} min`, x + w - 10, fy + 9, 12, p.fuel < p.fuelMax * 0.15 ? C.amber : C.ph, 'right');
  g.fillStyle = 'rgba(233,223,180,.12)'; g.fillRect(x + 10, fy + 15, w - 20, 4);
  g.fillStyle = leak > 0 ? C.amber : C.ph; g.fillRect(x + 10, fy + 15, (w - 20) * p.fuel / p.fuelMax, 4);
  status.forEach(([t, c], i) => txt(t, x + 10, fy + 38 + i * 17, 12, c, 'left', UI));
}

// ---------- radar (rumo para cima, 5 km) ----------
function radar(v) {
  const R = 78, x = W - R - 22, y = R + 70, rng = 5000;
  g.shadowBlur = 0; g.fillStyle = 'rgba(8,11,9,.55)'; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
  g.strokeStyle = 'rgba(233,223,180,.2)'; g.lineWidth = 1; for (const k of [1, 0.5]) { g.beginPath(); g.arc(x, y, R * k, 0, 7); g.stroke(); }
  g.beginPath(); g.moveTo(x, y - R); g.lineTo(x, y + R); g.moveTo(x - R, y); g.lineTo(x + R, y); g.stroke();
  const hd = Math.atan2(cam.aimDir.x, cam.aimDir.z), c = Math.cos(hd), s = Math.sin(hd);
  const to = (wx, wz) => { const dx = wx - v.pos.x, dz = wz - v.pos.z; return [x - (dx * c - dz * s) / rng * R, y - (dx * s + dz * c) / rng * R]; };
  const o = B.obj;
  if (o && o.zone) { const [zx, zy] = to(o.zone.x, o.zone.z); g.strokeStyle = C.sky; g.setLineDash([3, 4]); g.beginPath(); g.arc(zx, zy, o.zone.r / rng * R, 0, 7); g.stroke(); g.setLineDash([]); }
  if (o && o.base) { const [bx, by] = to(o.base.x, o.base.z); g.fillStyle = C.ally; g.fillRect(bx - 4, by - 4, 8, 8); }
  g.save(); g.beginPath(); g.arc(x, y, R, 0, 7); g.clip();
  for (const e of planes) {
    if (!e.alive || e === v) continue;
    const [px, py] = to(e.pos.x, e.pos.z), eh = Math.atan2(e.vel.x, e.vel.z) - hd;
    g.save(); g.translate(px, py); g.rotate(-eh); g.fillStyle = e.team === 1 ? C.ally : C.enemy;
    g.beginPath(); g.moveTo(0, -5); g.lineTo(3.5, 4); g.lineTo(-3.5, 4); g.closePath(); g.fill(); g.restore();
  }
  for (const m of missiles) { const [px, py] = to(m.pos.x, m.pos.z); g.fillStyle = '#fff'; g.fillRect(px - 1, py - 1, 2, 2); }
  g.restore();
  g.fillStyle = C.ph; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 4, y + 4); g.lineTo(x - 4, y + 4); g.closePath(); g.fill();
  txt('5 km', x + R - 4, y + R + 12, 10, C.phd, 'right');
}

// ---------- efeitos de tela ----------
function speedLines(p) {
  const k = clamp((p.ias * 3.6 - (p.def.jet ? 750 : 520)) / 250, 0, 1); if (!k) return;
  g.strokeStyle = `rgba(233,223,180,${0.08 * k})`; g.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const a = (i * 2.399 + blink * 0.3) % (Math.PI * 2), r0 = Math.min(W, Hh) * (0.38 + ((i * 37 + blink * 400) % 100) / 400);
    g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * r0, Hh / 2 + Math.sin(a) * r0); g.lineTo(W / 2 + Math.cos(a) * (r0 + 60 * k), Hh / 2 + Math.sin(a) * (r0 + 60 * k)); g.stroke();
  }
}
function cockpitFrame() {
  // armação da capota: arco e montantes, sem desenhar instrumentos por cima da visão
  g.strokeStyle = 'rgba(20,22,18,.92)'; g.lineWidth = 16; g.shadowBlur = 0;
  g.beginPath(); g.moveTo(W * 0.12, Hh); g.quadraticCurveTo(W * 0.2, Hh * 0.2, W * 0.36, -10); g.stroke();
  g.beginPath(); g.moveTo(W * 0.88, Hh); g.quadraticCurveTo(W * 0.8, Hh * 0.2, W * 0.64, -10); g.stroke();
  g.fillStyle = 'rgba(20,22,18,.94)'; g.fillRect(0, Hh * 0.9, W, Hh * 0.1);
}
