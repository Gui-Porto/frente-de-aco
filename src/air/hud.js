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
import { LOCK, LOCK_LABEL, leadPoint } from './targeting.js';
import { HEAT_LIMITS } from '../vehicles/engineHeat.js';
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
const C = { green: '#6cff7a', greenD: 'rgba(108,255,122,.6)', white: '#eef1ec', out: 'rgba(0,0,0,.8)', ink: 'rgba(8,11,9,.62)', ph: '#e9dfb4', phd: 'rgba(233,223,180,.55)', amber: '#efa53c', enemy: '#e65a42', ally: '#6db4e3', sky: '#8fb7cf', ok: '#93cf6c' };
const MONO = '"IBM Plex Mono", ui-monospace, monospace', UI = '"Barlow Condensed", "Arial Narrow", sans-serif';
const _a = new V3(), _b = new V3(), _s = new V3();
let W = 0, Hh = 0, dpr = 1, blink = 0;
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
// texto do HUD do WT: claro com contorno escuro (legível no céu claro e no chão)
function otxt(s, x, y, size = 15, col = C.white, align = 'left', font = UI, weight = 600) {
  g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.shadowBlur = 0;
  g.lineWidth = 3; g.strokeStyle = C.out; g.strokeText(s, x, y); g.fillStyle = col; g.fillText(s, x, y);
}
// traço verde com contorno (retículo)
function gstroke(w = 1.6, col = C.green) { g.shadowBlur = 0; g.lineWidth = w + 2.2; g.strokeStyle = C.out; g.stroke(); g.lineWidth = w; g.strokeStyle = col; g.stroke(); }

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
    hurt(p);
    reticle(p);
    damagePanel(p, flightInfo(p));
    warnings(p);
    hitMessages();
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
// rótulos de alvo: fogem da mira e não se empilham uns sobre os outros
const placed = [];
function placeLabel(t, x, y, r, col, rx, ry) {
  g.font = `500 11px ${MONO}`; const w = g.measureText(t).width + 6, h = 13;
  // perto da mira o rótulo sobe para cima do colchete (a mira fica livre embaixo)
  let ly = Math.hypot(x - rx, y - ry) < 90 ? y - r - 10 : y + r + 14;
  const hit = yy => placed.some(b => Math.abs(b.x - x) < (b.w + w) / 2 && Math.abs(b.y - yy) < h) || Math.hypot(x - rx, yy - ry) < 46;
  for (let i = 0; i < 6 && hit(ly); i++) ly += ly < y ? -h : h;
  placed.push({ x, y: ly, w });
  otxt(t, x, ly, 11, col, 'center', MONO, 500);
}
function targets(v, live) {
  const mk = B.marked;
  placed.length = 0;
  _a.set(0, 0, 400).applyMatrix4(v.root.matrixWorld); const rp = proj(_a, P2), rx = rp ? rp.x : W / 2, ry = rp ? rp.y : Hh / 2;
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
    if (en || d < 1500) placeLabel(lab, pr.x, pr.y, r, col, rx, ry);
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
  const fpx = Hh / 2 / Math.tan(camera.fov * Math.PI / 360);
  if (pr) {
    const x = pr.x, y = pr.y, R = 15, inR = mk && d < 1200;
    // anel partido: quatro arcos com folga nos pontos cardeais, traços para fora e ponto central
    g.beginPath();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.moveTo(x + Math.cos(a - 0.5) * R, y + Math.sin(a - 0.5) * R); g.arc(x, y, R, a - 0.5, a + 0.5); }
    gstroke(1.5);
    g.beginPath();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a); g.moveTo(x + c * (R + 3), y + s * (R + 3)); g.lineTo(x + c * (R + 10), y + s * (R + 10)); }
    gstroke(1.8);
    g.beginPath(); g.arc(x, y, 1.7, 0, 7); g.fillStyle = C.out; g.fill(); g.beginPath(); g.arc(x, y, 1.2, 0, 7); g.fillStyle = C.green; g.fill();
    // régua de alcance (como a barra do K-14): arco de 1200 m que encolhe até a distância do alvo marcado;
    // a marca branca é a convergência das armas (400 m) — o alvo está no alcance ideal quando o arco passa dela
    const RR = 30, a0 = -Math.PI / 2;
    g.beginPath(); g.arc(x, y, RR, a0, a0 + Math.PI * 2); gstroke(0.8, 'rgba(108,255,122,.22)');
    if (inR) {
      const k = clamp(d / 1200, 0, 1), close = d < 450;
      g.beginPath(); g.arc(x, y, RR, a0, a0 + Math.PI * 2 * k); gstroke(close ? 3 : 2.2, close ? C.green : C.greenD);
      const ac = a0 + Math.PI * 2 * k; g.beginPath(); g.moveTo(x + Math.cos(ac) * (RR - 4), y + Math.sin(ac) * (RR - 4)); g.lineTo(x + Math.cos(ac) * (RR + 4), y + Math.sin(ac) * (RR + 4)); gstroke(1.6, C.green);
      otxt(fmtD(d), x + RR + 10, y + 5, 13, close ? C.green : C.greenD, 'left', MONO, 500);
    }
    const ac = a0 + Math.PI * 2 / 3; g.beginPath(); g.moveTo(x + Math.cos(ac) * (RR - 3), y + Math.sin(ac) * (RR - 3)); g.lineTo(x + Math.cos(ac) * (RR + 3), y + Math.sin(ac) * (RR + 3)); gstroke(1.4, C.white);
    // marcador de acerto: X que abre e some (branco; âmbar se foi forte)
    const ha = S.now - B.hitT;
    if (ha < 0.2) {
      const k = 1 - ha / 0.2, r1 = 7 + 7 * (1 - k), r2 = r1 + 8;
      g.globalAlpha = k; g.beginPath();
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { g.moveTo(x + sx * r1, y + sy * r1); g.lineTo(x + sx * r2, y + sy * r2); }
      gstroke(2.4, B.hitBig ? C.amber : C.white); g.globalAlpha = 1;
    }
    // lock do míssil: cone do buscador ao redor do eixo
    if (B.seeker && p.missiles > 0) {
      const M = B.seeker.M, st = B.seeker.state, rc = Math.tan((M.acq || M.fov * 2.5) * Math.PI / 180) * fpx;
      const col = st === LOCK.LOCKED ? C.enemy : st === LOCK.TRACK ? C.amber : st === LOCK.LOST ? C.enemy : 'rgba(108,255,122,.35)';
      g.setLineDash(st === LOCK.SEARCH ? [3, 7] : []); g.beginPath(); g.arc(x, y, rc, 0, 7); gstroke(1.2, col); g.setLineDash([]);
      otxt(LOCK_LABEL[st], x, y + rc + 18, 14, col, 'center', UI, 600);
      const tg = B.seeker.target;
      if (tg) { const tp = proj(tg.pos, P2); if (tp) { const s = st === LOCK.LOCKED ? 15 : 12 + Math.sin(blink * 18) * 3; g.beginPath(); g.moveTo(tp.x, tp.y - s); g.lineTo(tp.x + s, tp.y); g.lineTo(tp.x, tp.y + s); g.lineTo(tp.x - s, tp.y); g.closePath(); gstroke(2, col); if (st === LOCK.TRACK) { g.fillStyle = col; g.fillRect(tp.x - s, tp.y + s + 5, s * 2 * clamp(B.seeker.t / M.lockT, 0, 1), 3); } } }
    }
  }
  // círculo do mouse (para onde o instrutor leva o nariz); some quando o nariz já está nele
  _b.copy(p.pos).addScaledVector(cam.aimDir, 1000);
  const ap = proj(_b, P2);
  if (ap && acam.mode !== 3) {
    const near = pr ? Math.hypot(ap.x - pr.x, ap.y - pr.y) : 99;
    g.globalAlpha = clamp((near - 6) / 20, 0.25, 1);
    g.beginPath(); g.arc(ap.x, ap.y, 8, 0, 7); gstroke(1.3, C.white);
    g.globalAlpha = 1;
  }
}

// ---------- coluna esquerda (como no WT): voo, motor, armas e dano numa só coluna ----------
const FLAP_TXT = ['', 'COMBATE', 'DECOLAGEM', 'POUSO'];
const COL_X = 22, LBL = 'rgba(238,241,236,.62)';
function label(t, x, y) { g.letterSpacing = '1px'; otxt(t, x, y, 11, LBL, 'left', UI, 600); g.letterSpacing = '0px'; }
function value(t, x, y, col = C.white, size = 18) { otxt(t, x, y, size, col, 'right', MONO, 500); }
function unit(t, x, y, col = LBL) { otxt(t, x + 4, y, 12, col, 'left', UI, 500); }
function chip(t, x, y, col) {
  g.font = `600 11px ${UI}`; g.letterSpacing = '1px'; const w = g.measureText(t).width + 12;
  g.fillStyle = C.out; g.fillRect(x, y - 11, w, 15); g.strokeStyle = col; g.lineWidth = 1; g.strokeRect(x + .5, y - 10.5, w - 1, 14);
  g.fillStyle = col; g.textAlign = 'left'; g.fillText(t, x + 6, y); g.letterSpacing = '0px';
  return x + w + 6;
}
function divider(y) { const gr = g.createLinearGradient(COL_X, 0, COL_X + 230, 0); gr.addColorStop(0, 'rgba(238,241,236,.35)'); gr.addColorStop(1, 'rgba(238,241,236,0)'); g.fillStyle = gr; g.fillRect(COL_X, y, 230, 1); }
function flightInfo(p) {
  const D = p.def, x = COL_X + 12, vx = x + 128;
  // fundo: só um degradê para dar leitura sobre o céu claro (sem caixa)
  const bh0 = Math.min(Hh, (flightInfo.h || 520) + 40);
  g.save(); g.scale(1, bh0 / 340);
  const bg = g.createRadialGradient(0, 120, 0, 0, 120, 360); bg.addColorStop(0, 'rgba(6,9,8,.42)'); bg.addColorStop(0.6, 'rgba(6,9,8,.22)'); bg.addColorStop(1, 'rgba(6,9,8,0)');
  g.fillStyle = bg; g.fillRect(0, 0, 360, 480); g.restore();
  let y = 34;
  const row = (lb, v, u, col = C.white) => { label(lb, x, y); value(v, vx, y, col); if (u) unit(u, vx, y, col === C.white ? LBL : col); y += 25; };
  // potência: barra vertical à esquerda das linhas (âmbar no WEP)
  const thr = D.jet ? p.spool : p.throttle, bh = 4 * 25 - 8, by = y - 14;
  g.fillStyle = C.out; g.fillRect(COL_X - 1, by - 1, 6, bh + 2);
  g.fillStyle = 'rgba(238,241,236,.14)'; g.fillRect(COL_X, by, 4, bh);
  g.fillStyle = p.wep ? C.amber : C.white; g.fillRect(COL_X, by + bh * (1 - thr), 4, bh * thr);
  row(D.jet ? 'EMPUXO' : 'MOTOR', String(Math.round(thr * 100)), '%', p.wep ? C.amber : C.white);
  if (p.wep) chip('WEP', vx + 26, y - 25, C.amber);
  row('VEL', String(Math.round(p.ias * 3.6)), D.jet ? `km/h  M${(p.vel.length() / 340).toFixed(2).replace('.', ',')}` : 'km/h', p.ias < stallV(p) * 1.15 ? C.amber : C.white);
  const agl = p.pos.y - H(p.pos.x, p.pos.z);
  row('ALT', String(Math.round(p.pos.y)), `m  ${p.vel.y >= 0 ? '▲' : '▼'}${Math.abs(p.vel.y).toFixed(0)}`, agl < 150 ? C.amber : C.white);
  row('G', p.n.toFixed(1).replace('.', ','), '', Math.abs(p.n) > D.glim * 0.8 ? C.enemy : Math.abs(p.n) > 7 ? C.amber : C.white);
  // temperaturas (água e óleo, como no WT): âmbar acima do limite, vermelho piscando no crítico
  if (!p.engineOn) { label('MOTOR', x, y); otxt('PARADO', vx, y, 16, C.enemy, 'right', UI, 700); y += 25; }
  else {
    const L = HEAT_LIMITS[p.cooling], hc = (v, lim) => (v > lim + 10 ? (Math.sin(blink * 10) > 0 ? C.enemy : C.white) : v > lim ? C.amber : C.white);
    if (L.water) { label('ÁGUA', x, y); value(`${Math.round(p.heat.water)}°`, x + 82, y, hc(p.heat.water, L.water), 16); label('ÓLEO', x + 100, y); value(`${Math.round(p.heat.oil)}°`, x + 178, y, hc(p.heat.oil, L.oil), 16); }
    else { label(D.jet ? 'TURBINA' : 'ÓLEO', x, y); value(`${Math.round(p.heat.oil)}°`, vx, y, hc(p.heat.oil, L.oil), 16); }
    y += 25;
  }
  // estados mecânicos em etiquetas
  let cx = x;
  if (p.flapStage || p.flaps > 0.02) cx = chip(`FLAPS ${FLAP_TXT[p.flapStage] || '↑'}`, cx, y - 2, C.green);
  if (p.gear) cx = chip('TREM', cx, y - 2, C.amber);
  if (p.airbrake) cx = chip('FREIO', cx, y - 2, C.amber);
  if (cx !== x) y += 22;
  // armas
  divider(y - 8); y += 12;
  for (const gg of p.guns) {
    const col = gg.broken || gg.jam ? C.enemy : gg.ammo < gg.max * 0.15 ? C.amber : C.white;
    otxt(gg.W.name, x, y, 14, gg.broken ? C.enemy : 'rgba(238,241,236,.85)', 'left', UI, 500);
    value(gg.broken ? '—' : String(gg.ammo), x + 214, y, col, 16);
    // aquecimento do cano: traço fino sob o nome
    g.fillStyle = 'rgba(238,241,236,.12)'; g.fillRect(x, y + 4, 150, 2);
    if (gg.heat > 0.02) { g.fillStyle = gg.jam ? C.enemy : gg.heat > 0.7 ? C.amber : 'rgba(238,241,236,.7)'; g.fillRect(x, y + 4, 150 * gg.heat, 2); }
    if (gg.jam || gg.broken) otxt(gg.broken ? 'INOPERANTE' : 'SUPERAQUECIDA', x + 156, y + 8, 10, C.enemy, 'left', UI, 600);
    y += 23;
  }
  if (D.missiles) {
    otxt(MISSILES[D.missiles.w].short, x, y, 14, 'rgba(238,241,236,.85)', 'left', UI, 500);
    for (let i = 0; i < D.missiles.n; i++) { const mx = x + 214 - (D.missiles.n - i) * 16; g.fillStyle = C.out; g.fillRect(mx - 1, y - 12, 12, 14); g.fillStyle = i < p.missiles ? C.white : 'rgba(238,241,236,.15)'; g.fillRect(mx, y - 11, 10, 12); }
    label(kb('a_missile').toUpperCase(), x, y + 14); y += 34;
  }
  if (D.jet) { otxt('Flares · chaff', x, y, 14, 'rgba(238,241,236,.85)', 'left', UI, 500); value(`${p.flares} · ${p.chaff}`, x + 214, y, p.flares ? C.white : C.amber, 16); y += 23; }
  divider(y - 8);
  return y + 6;
}

// ---------- silhueta de dano (vista de cima com os componentes, como a do WT) ----------
const fcol = f => (f <= 0 ? '#1d1d1d' : f < 0.35 ? C.enemy : f < 0.7 ? C.amber : 'rgba(238,241,236,.75)');
function damagePanel(p, top) {
  const D = p.def, M = p.mods, w = 214, sh = 132, x = COL_X + 12, y = top + 4;
  const status = [];
  if (p.fire > 0) status.push([`INCÊNDIO · [${kb('a_ext')}] extintor ${p.ext ? '×1' : 'usado'}`, C.enemy]);
  const leak = fuelLeak(p); if (leak > 0 && p.fuel > 0) status.push([`VAZAMENTO · ${leak.toFixed(1).replace('.', ',')} kg/s`, C.amber]);
  if (!p.engineOn) status.push(['MOTOR PARADO', C.enemy]); else if (p.hp.engine < p.maxHp.engine * 0.7) status.push([`MOTOR · ${Math.round(100 * (0.35 + 0.65 * p.hp.engine / p.maxHp.engine))}% de potência`, C.amber]);
  if (p.oil) status.push([D.jet ? 'ÓLEO VAZANDO' : 'RADIADOR VAZANDO', C.amber]);
  if (p.wounded) status.push(['PILOTO FERIDO', C.amber]);
  const dead = ['elev', 'rud', 'ailL', 'ailR', 'cables', 'hyd'].filter(n => M[n] && M[n].dead).map(n => LABEL[n].toUpperCase());
  if (dead.length) status.push([dead.join(' · ') + ' INOPERANTE' + (dead.length > 1 ? 'S' : ''), C.enemy]);
  const s = Math.min(sh / D.L, w / D.span), ox = x + w / 2, oy = y + sh / 2;
  const P = (lx, lz) => [ox - lx * s, oy - lz * s];
  const sf = k => p.hp[k] / p.maxHp[k];
  const OUT = 'rgba(0,0,0,.7)', LINE = 'rgba(238,241,236,.55)';
  g.lineJoin = 'round';
  const shape = (fill, f, drawPath, broken) => {
    drawPath(); g.lineWidth = 3; g.strokeStyle = OUT; g.stroke();
    if (broken) { g.lineWidth = 1.2; g.strokeStyle = C.enemy; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]); return; }
    g.fillStyle = fill; g.globalAlpha = f >= 0.7 ? 0.16 : 0.42; g.fill(); g.globalAlpha = 1; g.lineWidth = 1; g.strokeStyle = f >= 0.7 ? LINE : fill; g.stroke();
  };
  // asas (com enflechamento), fuselagem e empenagem: cor = integridade da estrutura
  const swp = D.span / 2 * Math.tan((D.sweep || 0) * Math.PI / 180);
  for (const [side, k, on] of [[1, 'wingL', p.wingOn.L], [-1, 'wingR', p.wingOn.R]]) {
    const pts = [P(side * D.fuseR, D.wingZ + D.chord * 0.35), P(side * D.span / 2, D.wingZ + D.tipChord * 0.3 - swp), P(side * D.span / 2, D.wingZ - D.tipChord * 0.7 - swp), P(side * D.fuseR, D.wingZ - D.chord * 0.65)];
    shape(fcol(sf(k)), sf(k), () => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(...q) : g.moveTo(...q))); g.closePath(); }, !on);
  }
  { const [a, b] = P(D.span * 0.19, -D.L * 0.43); shape(fcol(sf('tail')), sf('tail'), () => { g.beginPath(); g.rect(a, b, D.span * 0.38 * s, D.L * 0.1 * s); }, !p.tailOn); }
  { const [a, b] = P(D.fuseR, D.L * 0.47); shape(fcol(sf('fuse')), sf('fuse'), () => { g.beginPath(); g.roundRect(a, b, D.fuseR * 2 * s, D.L * 0.97 * s, D.fuseR * s); }, false); }
  // componentes internos: só aparecem coloridos quando danificados (como no WT); intactos ficam discretos
  for (const m of Object.values(M)) {
    if ((m.name === 'ailL' && !p.wingOn.L) || (m.name === 'ailR' && !p.wingOn.R) || ((m.name === 'elev' || m.name === 'rud') && !p.tailOn)) continue;
    const f = m.kind === 'engine' ? (p.engineOn ? p.hp.engine / p.maxHp.engine : 0) : modFrac(m);
    const [a, b] = P(m.c[0] + m.h[0], m.c[2] + m.h[2]), ww = Math.max(3, m.h[0] * 2 * s), hh = Math.max(3, m.h[2] * 2 * s);
    const flash = S.now - m.hitT < 0.25;
    g.fillStyle = flash ? '#fff' : f >= 0.7 ? 'rgba(238,241,236,.3)' : fcol(f); g.beginPath();
    if (m.kind === 'pilot') g.arc(a + ww / 2, b + hh / 2, Math.min(ww, hh) / 2 + 1, 0, 7); else g.roundRect(a, b, ww, hh, 1.5);
    g.fill();
    if (f <= 0) { g.strokeStyle = C.enemy; g.lineWidth = 1.3; g.beginPath(); g.moveTo(a, b); g.lineTo(a + ww, b + hh); g.moveTo(a + ww, b); g.lineTo(a, b + hh); g.stroke(); }
    if (m.leak > 0 && p.fuel > 0) { g.fillStyle = C.sky; g.beginPath(); g.arc(a + ww + 3, b + hh / 2 + Math.sin(blink * 8) * 2, 2, 0, 7); g.fill(); }
  }
  if (p.fire > 0) { const [a, b] = P(p.fireAt[0], p.fireAt[2]); g.fillStyle = `rgba(255,${120 + Math.random() * 80},40,${0.5 + Math.random() * 0.3})`; g.beginPath(); g.arc(a, b, 8 + Math.random() * 3, 0, 7); g.fill(); }
  // combustível
  let fy = y + sh + 22;
  const burn = Math.max(p.eng.flow, 0.05);
  const mins = p.fuel / Math.max(burn + leak, 0.01) / 60, low = p.fuel < p.fuelMax * 0.15;
  label('COMBUSTÍVEL', x, fy);
  otxt(`${mins > 99 ? '99+' : Math.floor(mins)} min`, x + w, fy, 14, low ? C.amber : C.white, 'right', MONO, 500);
  g.fillStyle = C.out; g.fillRect(x - 1, fy + 5, w + 2, 5);
  g.fillStyle = 'rgba(238,241,236,.14)'; g.fillRect(x, fy + 6, w, 3);
  g.fillStyle = leak > 0 || low ? C.amber : C.white; g.fillRect(x, fy + 6, w * p.fuel / p.fuelMax, 3);
  fy += 28;
  for (const [t, c] of status) { otxt(t, x, fy, 13, c, 'left', UI, 600); fy += 18; }
  flightInfo.h = fy;
}

// ---------- dano recebido: borda vermelha + arco na direção de quem atirou ----------
function hurt(p) {
  const age = S.now - B.hurtT; if (age > 1.2) return;
  const k = (1 - age / 1.2) * B.hurtK;
  const gr = g.createRadialGradient(W / 2, Hh / 2, Math.min(W, Hh) * 0.35, W / 2, Hh / 2, Math.max(W, Hh) * 0.72);
  gr.addColorStop(0, 'rgba(200,20,10,0)'); gr.addColorStop(1, `rgba(200,20,10,${0.45 * k})`);
  g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
  _a.copy(B.hurtFrom).sub(camera.position).applyQuaternion(_q.copy(camera.quaternion).invert());
  if (_a.lengthSq() > 1) {
    const ang = Math.atan2(-_a.y, _a.x), R = Math.min(W, Hh) * 0.3;
    g.beginPath(); g.arc(W / 2, Hh / 2, R, ang - 0.32, ang + 0.32); g.lineWidth = 9; g.strokeStyle = `rgba(230,40,25,${0.9 * k})`; g.stroke();
  }
  if (age < 0.9) otxt('ATINGIDO', W / 2, Hh * 0.7, 20, C.enemy, 'center');
}
// ---------- mensagens de acerto (ACERTO / ACERTO CRÍTICO / ABATIDO) e lista de críticos ----------
function hitMessages() {
  const m = B.hitMsg;
  if (m) {
    const age = S.now - m.at, life = m.lvl >= 3 ? 2.2 : 1.1;
    if (age < life) {
      const col = [C.white, C.amber, C.amber, C.enemy][m.lvl], size = [20, 22, 24, 30][m.lvl] * (1 + Math.max(0, 0.25 - age) * 1.2);
      g.globalAlpha = clamp((life - age) * 3, 0, 1); otxt(m.t, W / 2, Hh * 0.2, size, col, 'center', UI, 700); g.globalAlpha = 1;
    }
  }
  let i = 0;
  for (const c of B.critLog) {
    const age = S.now - c.at; if (age > 2.5) continue;
    g.globalAlpha = clamp(2.5 - age, 0, 1); otxt(c.t, W / 2, Hh * 0.2 + 26 + i * 20, 15, C.amber, 'center'); i++;
  }
  g.globalAlpha = 1;
}

const stallV = p => Math.sqrt(2 * p.def.mass * 9.81 / (1.225 * p.def.S * p.def.clmax)) * 0.95;

function panel(x, y, w, h, title) {
  g.shadowBlur = 0; g.fillStyle = C.ink; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(233,223,180,.18)'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  g.fillStyle = C.sky; g.fillRect(x, y, 18, 2);
  txt(title, x + 10, y + 16, 10, C.phd, 'left', UI);
}

// ---------- armas: munição, aquecimento, mísseis ----------
const kb = id => (settings.binds[id] || []).map(keyName).join(' / ');
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
