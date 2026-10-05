import { Quaternion } from 'three';
import { camera } from '../core/render.js';
import { S, planes } from '../core/state.js';
import { isDown, settings, keyName } from '../core/settings.js';
import { V3, clamp } from '../core/util.js';
import { drawScore } from '../ui/hud.js';
import { $ } from '../core/util.js';
import { B, needRefit } from './battle.js';
import { homeField } from '../world/terrain.js';
import { LOCK, LOCK_LABEL, leadPoint } from './targeting.js';
import { missiles } from './missiles.js';
import { acam, CAM_MODES } from './camera.js';
import { cam } from '../game/camera.js';
import { cv, g, V, C, MONO, UI, glow, txt, otxt, gstroke, fmtD } from './hud/kit.js';
import { themeOf } from './hud/themes.js';
import { flightPanel, xrayPanel } from './hud/flight.js';
import { deathCard } from './hud/cards.js';
import { leftPanels, tacMap } from './hud/scopes.js';
import { warnings } from './hud/warnings.js';
// =====================================================================
// HUDSystem da Batalha Aérea: um canvas 2D redesenhado por quadro.
// Centro: retículo, marcadores, alertas. Inferior direito: painel da
// aeronave (flight.js). Inferior esquerdo: radar e RWR (scopes.js), só se
// a aeronave tiver. Cada avião tem o próprio tema (themes.js).
// =====================================================================
const _a = new V3(), _b = new V3(), _s = new V3();
export function showAirHud(on) { cv.hidden = !on; $('#hud').classList.toggle('air', on); }

// projeta um ponto do mundo; retorna null se atrás da câmera
function proj(p, out = { x: 0, y: 0, on: false }) {
  _s.copy(p).project(camera);
  if (_s.z > 1) { out.on = false; out.x = -_s.x; out.y = _s.y; return null; }
  out.x = (_s.x + 1) / 2 * V.W; out.y = (1 - _s.y) / 2 * V.H; out.on = Math.abs(_s.x) <= 1 && Math.abs(_s.y) <= 1; return out;
}
const P1 = { x: 0, y: 0, on: false }, P2 = { x: 0, y: 0, on: false };

export function updateAirHUD(dt) {
  if (S.state === 'airmenu' || S.mode !== 'air') return;
  V.dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== innerWidth * V.dpr || cv.height !== innerHeight * V.dpr) { cv.width = innerWidth * V.dpr; cv.height = innerHeight * V.dpr; }
  V.W = innerWidth; V.H = innerHeight; V.blink += dt;
  g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0); g.clearRect(0, 0, V.W, V.H);
  $('#score').hidden = !isDown('score'); if (!$('#score').hidden) drawScore();
  const p = S.player, live = p && p.alive && S.state === 'play';
  const v = live ? p : S.spectate;
  g.lineCap = 'round'; g.lineJoin = 'round';
  topBar(v);
  if (p && !live) deathCard(themeOf(p.def)); // você caiu: quem, com o quê e o que levou
  if (!v) return;
  const T = themeOf(v.def);
  targets(v, live);
  if (live) {
    speedLines(p);
    hurt(p);
    reticle(p);
    flightPanel(p, T);
    leftPanels(p, T);
    warnings(p);
    hitMessages();
    baseHud(p);
    if (isDown('a_xray')) xrayPanel(p, T);
  } else if (S.state === 'spectate' && v) {
    txt(`ASSISTINDO · ${v.who ? v.who.name : ''} · ${v.def.short}`, V.W / 2, V.H - 40, 15, C.ally, 'center', UI);
  }
  tacMap(v, T);
  $('#gdark').style.opacity = live ? Math.max(p.blackout * 0.97, B.fadeK || 0) : 0; // desmaio ou troca de tela pós-reparo
  if (live && p.koT > 0) otxt(`PILOTO DESMAIADO · ${Math.ceil(p.koT)} s`, V.W / 2, V.H / 2 + 6, 22, C.white, 'center');
}

// ---------- base aérea: marcador da pista e barra de reparo/rearme ----------
function baseHud(p) {
  const a = homeField(p.team), R = B.refit; if (!a) return;
  _b.set(a.x, a.h + 6, a.z); const d = _b.distanceTo(p.pos);
  const need = needRefit(p);
  if (d > 900) {
    const pr = proj(_b, P1);
    if (pr && pr.on) {
      g.strokeStyle = C.ally; g.lineWidth = 1.6; glow(C.ally, 4);
      g.beginPath(); g.moveTo(pr.x - 4, pr.y - 9); g.lineTo(pr.x - 7, pr.y + 9); g.moveTo(pr.x + 4, pr.y - 9); g.lineTo(pr.x + 7, pr.y + 9); g.stroke(); g.shadowBlur = 0;
      otxt(`BASE  ${fmtD(d)}`, pr.x, pr.y + 24, 12, need ? C.amber : C.ally, 'center', MONO, 500);
    } else if (need) edgeArrow({ pos: _b }, C.ally, d, true);
  }
  if (!R.onField) {
    // aproximação: dica do trem (com o limite de velocidade) e do pouso
    const agl = p.pos.y - a.h;
    if (p.gearCmd && d < 4000 && !p.onGround) otxt('TREM BAIXADO · pouse na pista para reparar e rearmar', V.W / 2, V.H * 0.72, 14, C.ally, 'center');
    else if (!p.gearCmd && d < 3000 && agl < 500) otxt(`Para pousar: abaixo de ${Math.round(p.gearV * 3.6)} km/h baixe o trem (${keyName(settings.binds.a_gear[0])}) e os flaps (${keyName(settings.binds.a_flaps[0])})`, V.W / 2, V.H * 0.72, 14, p.ias > p.gearV ? C.amber : C.ally, 'center');
    return;
  }
  const y = V.H * 0.7, w = 320, x = V.W / 2 - w / 2;
  if (R.done) { otxt('PRONTO · acelere para decolar e recolha o trem (G)', V.W / 2, y, 16, C.ok, 'center'); return; }
  if (!R.parked) { otxt('Pare na pista para reparar e rearmar · freio: H (ou manete no zero)', V.W / 2, y, 15, C.ally, 'center'); return; }
  const k = clamp(R.t / R.dur, 0, 1);
  otxt(`REPARO E REARME · ${Math.ceil(R.dur - R.t)} s`, V.W / 2, y - 12, 15, C.white, 'center');
  g.fillStyle = C.ink; g.fillRect(x, y, w, 8); g.fillStyle = C.ally; g.fillRect(x + 1, y + 1, (w - 2) * k, 6);
}

// ---------- barra superior: objetivo, tempo, câmera ----------
function topBar(v) {
  const o = B.obj, t = B.t, m = Math.floor(t / 60), s = Math.floor(t % 60);
  g.shadowBlur = 0;
  const w = 420, x = V.W / 2 - w / 2;
  g.fillStyle = C.ink; g.fillRect(x, 12, w, 30);
  g.fillStyle = C.sky; g.fillRect(x, 12, 3, 30);
  txt(B.mode ? B.mode.label.toUpperCase() : '', x + 12, 32, 13, C.sky, 'left', UI);
  txt(o ? o.status(B) : '', V.W / 2 + 10, 32, 13, C.ph, 'center', MONO);
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
  _a.set(0, 0, 400).applyMatrix4(v.root.matrixWorld); const rp = proj(_a, P2), rx = rp ? rp.x : V.W / 2, ry = rp ? rp.y : V.H / 2;
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
  for (const m of missiles) { const pr = proj(m.pos, P1); if (pr && pr.on) { g.fillStyle = C.ph; g.fillRect(pr.x - 2, pr.y - 2, 4, 4); } }
}
function edgeArrow(e, col, d, big) {
  _a.copy(e.pos).sub(camera.position).applyQuaternion(_q.copy(camera.quaternion).invert());
  const ang = Math.atan2(-_a.y, _a.x), R = Math.min(V.W, V.H) * 0.42;
  const x = V.W / 2 + Math.cos(ang) * R, y = V.H / 2 + Math.sin(ang) * R;
  g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = col; g.globalAlpha = big ? 1 : 0.7;
  g.beginPath(); g.moveTo(big ? 14 : 10, 0); g.lineTo(-6, big ? 8 : 6); g.lineTo(-6, big ? -8 : -6); g.closePath(); g.fill(); g.restore();
  if (big) txt(fmtD(d), x - Math.cos(ang) * 26, y - Math.sin(ang) * 26 + 4, 11, col, 'center');
}
const _q = new Quaternion();

// ---------- retículo giroscópico + círculo do mouse + lock do míssil ----------
// branco e fino como no WT: contorno escuro leve só para ler contra céu claro
const RW = 'rgba(255,255,255,.85)', RWD = 'rgba(255,255,255,.5)';
function rstroke(w, col = RW) { g.shadowBlur = 0; g.lineWidth = w + 1.2; g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke(); g.lineWidth = w; g.strokeStyle = col; g.stroke(); }
function reticle(p) {
  // para onde as balas vão (eixo fixo das armas — plane.fireDir), a 400 m
  p.fireDir(_a).multiplyScalar(400).add(p.pos);
  const pr = proj(_a, P1);
  // distância da régua: radar telemétrico (F-86/MiG-15) mede quem está no cone; sem ele, o alvo marcado
  const rr = p.sys.radar && p.sys.radar.ranging ? p.sys.radar : null;
  const mk = rr ? rr.target : B.marked, d = rr ? rr.range : mk ? mk.pos.distanceTo(p.pos) : 0;
  const fpx = V.H / 2 / Math.tan(camera.fov * Math.PI / 360);
  if (pr) {
    const x = pr.x, y = pr.y, R = 11, inR = mk && d < 1200;
    // anel partido: quatro arcos com folga nos pontos cardeais, traços para fora e ponto central
    g.beginPath();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.moveTo(x + Math.cos(a - 0.5) * R, y + Math.sin(a - 0.5) * R); g.arc(x, y, R, a - 0.5, a + 0.5); }
    rstroke(1.1);
    g.beginPath();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a); g.moveTo(x + c * (R + 3), y + s * (R + 3)); g.lineTo(x + c * (R + 7), y + s * (R + 7)); }
    rstroke(1.1);
    g.beginPath(); g.arc(x, y, 1.1, 0, 7); g.fillStyle = RW; g.fill();
    // régua de alcance (como a barra do K-14): arco de 1200 m que encolhe até a distância do alvo marcado;
    // a marca branca é a convergência das armas (400 m) — o alvo está no alcance ideal quando o arco passa dela
    const RR = 24, a0 = -Math.PI / 2;
    g.beginPath(); g.arc(x, y, RR, a0, a0 + Math.PI * 2); g.lineWidth = 0.7; g.strokeStyle = 'rgba(255,255,255,.14)'; g.stroke();
    if (inR) {
      const k = clamp(d / 1200, 0, 1), close = d < 450;
      g.beginPath(); g.arc(x, y, RR, a0, a0 + Math.PI * 2 * k); rstroke(close ? 1.8 : 1.2, close ? RW : RWD);
      const ac = a0 + Math.PI * 2 * k; g.beginPath(); g.moveTo(x + Math.cos(ac) * (RR - 3), y + Math.sin(ac) * (RR - 3)); g.lineTo(x + Math.cos(ac) * (RR + 3), y + Math.sin(ac) * (RR + 3)); rstroke(1.1);
      otxt((rr ? 'RADAR ' : '') + fmtD(d), x + RR + 8, y + 4, 11, close ? RW : RWD, 'left', MONO, 500);
    }
    const ac = a0 + Math.PI * 2 / 3; g.beginPath(); g.moveTo(x + Math.cos(ac) * (RR - 3), y + Math.sin(ac) * (RR - 3)); g.lineTo(x + Math.cos(ac) * (RR + 3), y + Math.sin(ac) * (RR + 3)); rstroke(1, RWD);
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
      const col = st === LOCK.LOCKED ? C.enemy : st === LOCK.TRACK ? C.amber : st === LOCK.LOST ? C.enemy : 'rgba(255,255,255,.3)';
      g.setLineDash(st === LOCK.SEARCH ? [3, 7] : []); g.beginPath(); g.arc(x, y, rc, 0, 7); gstroke(1.2, col); g.setLineDash([]);
      otxt(LOCK_LABEL[st], x, y + rc + 18, 14, col, 'center', UI, 600);
      const tg = B.seeker.target;
      if (tg) { const tp = proj(tg.pos, P2); if (tp) { const s = st === LOCK.LOCKED ? 15 : 12 + Math.sin(V.blink * 18) * 3; g.beginPath(); g.moveTo(tp.x, tp.y - s); g.lineTo(tp.x + s, tp.y); g.lineTo(tp.x, tp.y + s); g.lineTo(tp.x - s, tp.y); g.closePath(); gstroke(2, col); if (st === LOCK.TRACK) { g.fillStyle = col; g.fillRect(tp.x - s, tp.y + s + 5, s * 2 * clamp(B.seeker.t / M.lockT, 0, 1), 3); } } }
    }
  }
  // círculo do mouse (para onde o instrutor leva o nariz); some quando o nariz já está nele
  // mesma distância do eixo das armas (400 m): com a câmera atrás/acima, distâncias diferentes davam paralaxe
  // e o retículo parava fora do círculo mesmo com o nariz no lugar (pior na mira com FOV fechado)
  _b.copy(p.pos).addScaledVector(cam.aimDir, 400);
  const ap = proj(_b, P2);
  if (ap && acam.mode !== 3) {
    const near = pr ? Math.hypot(ap.x - pr.x, ap.y - pr.y) : 99;
    g.globalAlpha = clamp((near - 6) / 20, 0.25, 1);
    g.beginPath(); g.arc(ap.x, ap.y, 8, 0, 7); gstroke(1.3, C.white);
    g.globalAlpha = 1;
  }
}

// ---------- dano recebido: borda vermelha + arco na direção de quem atirou ----------
function hurt(p) {
  const age = S.now - B.hurtT; if (age > 1.2) return;
  const k = (1 - age / 1.2) * B.hurtK;
  const gr = g.createRadialGradient(V.W / 2, V.H / 2, Math.min(V.W, V.H) * 0.35, V.W / 2, V.H / 2, Math.max(V.W, V.H) * 0.72);
  gr.addColorStop(0, 'rgba(200,20,10,0)'); gr.addColorStop(1, `rgba(200,20,10,${0.45 * k})`);
  g.fillStyle = gr; g.fillRect(0, 0, V.W, V.H);
  _a.copy(B.hurtFrom).sub(camera.position).applyQuaternion(_q.copy(camera.quaternion).invert());
  if (_a.lengthSq() > 1) {
    const ang = Math.atan2(-_a.y, _a.x), R = Math.min(V.W, V.H) * 0.3;
    g.beginPath(); g.arc(V.W / 2, V.H / 2, R, ang - 0.32, ang + 0.32); g.lineWidth = 9; g.strokeStyle = `rgba(230,40,25,${0.9 * k})`; g.stroke();
  }
  if (age < 0.9) otxt('ATINGIDO', V.W / 2, V.H * 0.7, 20, C.enemy, 'center');
}
// ---------- mensagens de acerto (ACERTO / ACERTO CRÍTICO / ABATIDO) e lista de críticos ----------
function hitMessages() {
  const m = B.hitMsg;
  if (m) {
    const age = S.now - m.at, life = m.lvl >= 3 ? 2.2 : 1.1;
    if (age < life) {
      const col = [C.white, C.amber, C.amber, C.enemy][m.lvl], size = [20, 22, 24, 30][m.lvl] * (1 + Math.max(0, 0.25 - age) * 1.2);
      g.globalAlpha = clamp((life - age) * 3, 0, 1); otxt(m.t, V.W / 2, V.H * 0.2, size, col, 'center', UI, 700); g.globalAlpha = 1;
    }
  }
  let i = 0;
  for (const c of B.critLog) {
    const age = S.now - c.at; if (age > 2.5) continue;
    g.globalAlpha = clamp(2.5 - age, 0, 1); otxt(c.t, V.W / 2, V.H * 0.2 + 26 + i * 20, 15, C.amber, 'center'); i++;
  }
  g.globalAlpha = 1;
}

// ---------- efeitos de tela ----------
function speedLines(p) {
  const k = clamp((p.ias * 3.6 - (p.def.jet ? 750 : 520)) / 250, 0, 1); if (!k) return;
  g.strokeStyle = `rgba(233,223,180,${0.08 * k})`; g.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const a = (i * 2.399 + V.blink * 0.3) % (Math.PI * 2), r0 = Math.min(V.W, V.H) * (0.38 + ((i * 37 + V.blink * 400) % 100) / 400);
    g.beginPath(); g.moveTo(V.W / 2 + Math.cos(a) * r0, V.H / 2 + Math.sin(a) * r0); g.lineTo(V.W / 2 + Math.cos(a) * (r0 + 60 * k), V.H / 2 + Math.sin(a) * (r0 + 60 * k)); g.stroke();
  }
}
