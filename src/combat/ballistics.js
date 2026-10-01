import * as THREE from 'three';
import { scene, camera } from '../core/render.js';
import { S, tanks, planes, projs, popped } from '../core/state.js';
import { V3, QUAT, clamp, lerp, rand, rv } from '../core/util.js';
import { H, terrainNormal } from '../world/terrain.js';
import { obstNear, HEDGES, addCrater } from '../world/scenery.js';
import { RAPIER, world, COL } from '../world/physics.js';
import { PLANES, prepAmmo, penAt, hePen, DEG, G } from '../data/vehicles.js';
import { spawnP, TEX, fxDust, fxSparks, fxExplosion, fxBigBlast, fxTrail } from '../fx/particles.js';
import { sndBoom, sndPing, sndClank } from '../fx/audio.js';
import { MODS } from '../vehicles/tank.js';
import { hitPlaneModules, blastPlaneModules } from '../vehicles/planeDamage.js';
import { showDmg, shakeCam, shakeAt, flashVign, hitMarker } from '../ui/hud.js';
import { xrayShot, xrayReport } from '../ui/xray.js';
import { onVehicleDestroyed } from '../game/match.js';
// =====================================================================
// Projéteis, colisão, blindagem, penetração e dano
// =====================================================================

// Segmento × AABB (método das placas). d = vetor completo do segmento; retorna t∈[0,1] e a face de entrada.
export function segBox(o, d, mn, mx) {
  let t0 = 0, t1 = 1, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    const oa = o[a], da = d[a];
    if (Math.abs(da) < 1e-9) { if (oa < mn[a] || oa > mx[a]) return null; continue; }
    let ta = (mn[a] - oa) / da, tb = (mx[a] - oa) / da, s = -1;
    if (ta > tb) { const x = ta; ta = tb; tb = x; s = 1; }
    if (ta > t0) { t0 = ta; axis = a; sign = s; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  if (axis < 0) return null;
  return { t: t0, axis, sign };
}
const _o = [0, 0, 0], _d = [0, 0, 0], _lo = new V3(), _lq = new V3();
export function partHit(inv, p, q, mn, mx) {
  _lo.copy(p).applyMatrix4(inv); _lq.copy(q).applyMatrix4(inv);
  const o = [_lo.x, _lo.y, _lo.z], d = [_lq.x - _lo.x, _lq.y - _lo.y, _lq.z - _lo.z];
  const r = segBox(o, d, mn, mx); if (!r) return null;
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  r.lp = [o[0] + d[0] * r.t, o[1] + d[1] * r.t, o[2] + d[2] * r.t];
  r.ld = [d[0] / len, d[1] / len, d[2] / len];
  return r;
}
function nearSeg(c, r, p, dx, dy, dz, len2) {
  const ex = c.x - p.x, ey = c.y - p.y, ez = c.z - p.z;
  const u = clamp((ex * dx + ey * dy + ez * dz) / len2, 0, 1);
  return Math.hypot(ex - dx * u, ey - dy * u, ez - dz * u) < r;
}
const _cen = new V3();
export function segmentHit(p, q, ignore, opts) {
  const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z, len2 = dx * dx + dy * dy + dz * dz || 1e-9;
  let best = 1, hit = null;
  _o[0] = p.x; _o[1] = p.y; _o[2] = p.z; _d[0] = dx; _d[1] = dy; _d[2] = dz;
  for (const b of obstNear(p.x, p.z, q.x, q.z)) { const r = segBox(_o, _d, b.mn, b.mx); if (r && r.t < best) { best = r.t; hit = { type: 'obst' }; } }
  if (opts && opts.hedges) for (const b of HEDGES) { const r = segBox(_o, _d, b.mn, b.mx); if (r && r.t < best) { best = r.t; hit = { type: 'hedge' }; } }
  for (const t of tanks) {
    if (t === ignore) continue;
    if (!nearSeg(_cen.set(t.pos.x, t.pos.y, t.pos.z), t.def.L * 0.8 + 2, p, dx, dy, dz, len2)) continue;
    const r = partHit(t.invRoot, p, q, t.hullMin, t.hullMax);
    if (r && r.t < best) { best = r.t; hit = Object.assign(r, { type: 'tank', tank: t, part: 'hull' }); }
    if (t.turretOn) { const r2 = partHit(t.invTurret, p, q, t.turMin, t.turMax); if (r2 && r2.t < best) { best = r2.t; hit = Object.assign(r2, { type: 'tank', tank: t, part: 'turret' }); } }
  }
  if (!(opts && opts.noPlanes)) for (const pl of planes) {
    if (pl === ignore || pl.gone) continue;
    if (!nearSeg(pl.pos, pl.def.span * 0.6 + 1, p, dx, dy, dz, len2)) continue;
    for (const b of pl.boxes) {
      if (b.off) continue;
      const r = partHit(pl.inv, p, q, b.mn, b.mx);
      if (r && r.t < best) { best = r.t; hit = Object.assign(r, { type: 'plane', plane: pl, box: b.name }); }
    }
  }
  const segLen = Math.sqrt(len2) * best, steps = Math.max(1, Math.ceil(segLen / 2));
  if (!(p.y > 400 && q.y > 400)) for (let i = 1; i <= steps; i++) {
    const tt = best * i / steps;
    if (p.y + dy * tt < H(p.x + dx * tt, p.z + dz * tt)) {
      let a = best * (i - 1) / steps, b = tt;
      for (let k = 0; k < 10; k++) { const m = (a + b) / 2; if (p.y + dy * m < H(p.x + dx * m, p.z + dz * m)) b = m; else a = m; }
      best = b; hit = { type: 'ground' }; break;
    }
  }
  if (!hit) return null;
  hit.t = best; hit.point = new V3(p.x + dx * best, p.y + dy * best, p.z + dz * best);
  return hit;
}
const _rq = new V3();
export function raycast(o, dir, maxD, ignore, opts) { return segmentHit(o, _rq.copy(o).addScaledVector(dir, maxD), ignore, opts); }
// Linha de visada: cercas vivas e construções bloqueiam
export function losPts(p, q, ignore, target) { const h = segmentHit(p, q, ignore, { hedges: true }); return !h || (target && ((h.type === 'tank' && h.tank === target) || (h.type === 'plane' && h.plane === target))); }
export function los(a, b) {
  const p = a.eyePos(new V3()), q = b.type === 'plane' ? b.pos.clone() : b.centerPos(new V3());
  return losPts(p, q, a, b);
}

// =====================================================================
// Blindagem: espessura nominal e normal da chapa no espaço local da peça
// =====================================================================
export function armorAt(t, hit) {
  const A = t.def.armor, D = t.def, lp = hit.lp;
  let ax = hit.axis, sg = hit.sign, th, s;
  if (hit.part === 'hull') {
    if (ax === 1 && sg > 0 && lp[2] > D.L / 2 - D.gRun) { ax = 2; sg = 1; }
    if (ax === 2 && sg > 0) {
      const lower = lp[1] < D.clr + D.Hh * 0.4;
      [th, s] = lower ? A.lfront : A.front; s *= DEG;
      return { t: th, n: [0, lower ? -Math.sin(s) : Math.sin(s), Math.cos(s)], key: lower ? 'placa frontal inferior' : 'glacis' };
    }
    if (ax === 2) { [th, s] = A.rear; s *= DEG; return { t: th, n: [0, Math.sin(s), -Math.cos(s)], key: 'traseira' }; }
    if (ax === 0) { [th, s] = A.side; s *= DEG; return { t: th, n: [sg * Math.cos(s), Math.sin(s), 0], key: 'lateral' }; }
    return sg > 0 ? { t: A.top, n: [0, 1, 0], key: 'teto' } : { t: A.bottom, n: [0, -1, 0], key: 'fundo' };
  }
  if (ax === 2 && sg > 0) { [th, s] = A.tFront; s *= DEG; return { t: th, n: [0, Math.sin(s), Math.cos(s)], key: 'frente da torre' }; }
  if (ax === 2) { [th, s] = A.tRear; s *= DEG; return { t: th, n: [0, Math.sin(s), -Math.cos(s)], key: 'traseira da torre' }; }
  if (ax === 0) { [th, s] = A.tSide; s *= DEG; return { t: th, n: [sg * Math.cos(s), Math.sin(s), 0], key: 'lateral da torre' }; }
  return { t: sg > 0 ? A.tTop : A.tSide[0], n: [0, sg, 0], key: 'teto da torre' };
}
// Ângulo de impacto, normalização, espessura efetiva, ricochete e sobreposição de calibre
export function evalArmor(t, hit, am, speed) {
  const D = t.def, arm = armorAt(t, hit), ld = hit.ld, n = arm.n;
  const cosA = clamp(-(ld[0] * n[0] + ld[1] * n[1] + ld[2] * n[2]), 0.02, 1);
  const ang = Math.acos(cosA) / DEG;
  const norm = am.type === 'APCR' ? 2 : am.type === 'APHE' || am.type === 'AP' ? 5 : 0;
  const angN = Math.max(0, ang - norm);
  let thick = arm.t, track = false;
  if (hit.part === 'hull' && hit.axis === 0 && hit.lp[1] < D.clr + 0.5) { thick += 20; track = true; }
  const eff = thick / Math.cos(angN * DEG);
  const pen = penAt(am, speed) * rand(0.95, 1.05);
  const over = am.cal > 3 * arm.t;
  const [r0, r1] = am.type === 'APCR' ? [60, 68] : am.type === 'MG' || am.type === 'HEF' ? [55, 70] : [70, 80];
  const ricoP = over || ang <= r0 || am.type === 'HE' ? 0 : clamp((ang - r0) / (r1 - r0), 0, 1);
  return { arm, ang, eff, pen, ricoP, track };
}

// =====================================================================
// Projéteis
// =====================================================================
const shellGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 5); shellGeo.rotateX(Math.PI / 2);
const shellMat = new THREE.MeshBasicMaterial({ color: 0xffd08a, fog: false });
const MAXTR = 900;
export const tracerMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc070, fog: false }), MAXTR);
tracerMesh.frustumCulled = false; tracerMesh.count = 0; scene.add(tracerMesh);
const bombGeo = (() => { const b = new THREE.CylinderGeometry(0.5, 0.5, 2.6, 10); b.rotateX(Math.PI / 2); return b; })();
const bombMat = new THREE.MeshStandardMaterial({ color: 0x3d4130, roughness: .7, metalness: .3 });
for (const pd of Object.values(PLANES)) {
  for (const b of pd.bombs) { b.type = 'BOMB'; b.cal = b.d * 1000; prepAmmo(Object.assign(b, { v: 200 }), b.cal, 0.22); }
  if (pd.rockets) { const r = pd.rockets; r.type = 'ROCKET'; r.cal = r.m > 20 ? 127 : 82; prepAmmo(r, r.cal, 0.35); }
}
export function fireProj(owner, pos, vel, am, kind, extra) {
  const pr = Object.assign({ p: pos.clone(), v: vel.clone(), am, owner, kind, life: kind === 'bomb' ? 40 : kind === 'bullet' ? 4 : 8, age: 0, bounced: false, ignore: owner, tracer: false }, extra || {});
  if (kind === 'shell') { pr.mesh = new THREE.Mesh(shellGeo, shellMat); scene.add(pr.mesh); }
  if (kind === 'bomb' || kind === 'rocket') {
    pr.mesh = new THREE.Mesh(bombGeo, bombMat); pr.mesh.scale.setScalar(am.d ? am.d : 0.18); pr.mesh.castShadow = true; scene.add(pr.mesh);
    if (kind === 'rocket') pr.mesh.scale.set(.14, .14, .7);
  }
  projs.push(pr);
  return pr;
}
const _q = new V3(), _n = new V3(), _tm = new THREE.Matrix4(), _tq = new QUAT(), _ts = new V3(), _tp = new V3();
const _zf = new V3(0, 0, 1);
export function updateProjs(dt) {
  let tc = 0;
  for (let i = projs.length - 1; i >= 0; i--) {
    const pr = projs[i]; pr.life -= dt; pr.age += dt; let dead = pr.life <= 0;
    const rate = pr.kind === 'bullet' ? 90 : pr.kind === 'bomb' ? 40 : 120;
    const n = Math.max(1, Math.ceil(dt * rate)), h = dt / n;
    if (pr.ignore && pr.ignore === pr.owner && pr.age > (pr.kind === 'bomb' ? 1.2 : 0.25) && pr.kind !== 'bullet' && pr.kind !== 'shell') pr.ignore = null;
    for (let k = 0; k < n && !dead; k++) {
      const sp = pr.v.length(), kk = pr.am.k * sp;
      pr.v.x += -kk * pr.v.x * h; pr.v.y += (-G - kk * pr.v.y) * h; pr.v.z += -kk * pr.v.z * h;
      if (pr.kind === 'rocket' && pr.age < 1.1) { pr.v.addScaledVector(_n.copy(pr.v).normalize(), 260 * h); }
      _q.copy(pr.p).addScaledVector(pr.v, h);
      const hit = segmentHit(pr.p, _q, pr.ignore, pr.kind === 'bullet' && pr.p.y > 400 ? null : null);
      if (hit) dead = onImpact(pr, hit);
      else pr.p.copy(_q);
      if (pr.p.y < -100) dead = true;
    }
    // espoleta de proximidade/autodestruição das granadas AA no fim do traçante
    if (!dead && pr.am.type === 'HEF' && pr.kind === 'bullet' && pr.age > 3.2) { blast(pr.p, pr.am.tnt, pr.owner, { air: true }); dead = true; }
    if (dead) { if (pr.mesh) scene.remove(pr.mesh); projs.splice(i, 1); continue; }
    _n.copy(pr.v).normalize();
    if (pr.mesh) {
      if (pr.kind === 'shell') { pr.mesh.position.copy(pr.p).addScaledVector(_n, -3); pr.mesh.scale.set(1, 1, 6); }
      else pr.mesh.position.copy(pr.p);
      pr.mesh.lookAt(_tp.copy(pr.mesh.position).add(_n));
      if (pr.kind === 'rocket' && pr.age < 1.4) { spawnP({ pos: pr.p.clone(), life: .12, size: .7, size1: .3, tex: TEX.fire, add: true, color: 0xffa040 }); fxTrail(pr.p.clone(), 0xc8c4bb, .7, 1.6); }
    } else if (pr.tracer && tc < MAXTR) {
      _tq.setFromUnitVectors(_zf, _n); _ts.set(1, 1, Math.min(9, pr.v.length() * 0.012)); _tp.copy(pr.p).addScaledVector(_n, -_ts.z * 0.5);
      _tm.compose(_tp, _tq, _ts); tracerMesh.setMatrixAt(tc++, _tm);
    }
  }
  tracerMesh.count = tc; tracerMesh.instanceMatrix.needsUpdate = true;
}
export function clearProjs() { for (const p of projs) if (p.mesh) scene.remove(p.mesh); projs.length = 0; }

function onImpact(pr, hit) {
  const sp = pr.v.length(), dir = pr.v.clone().normalize(), am = pr.am;
  if (pr.kind === 'bomb') {
    if (pr.age < 1.0) { fxDust(hit.point, 10, 1); sndClank(hit.point); return true; } // espoleta não armada
    blast(hit.point, am.tnt, pr.owner, { bomb: true, direct: hit.type === 'tank' ? hit.tank : null }); return true;
  }
  if (pr.kind === 'rocket') { blast(hit.point, am.tnt, pr.owner, { direct: hit.type === 'tank' ? hit.tank : null, kinetic: am.m > 20 ? 30 : 12 }); return true; }
  if (hit.type === 'ground') {
    terrainNormal(hit.point.x, hit.point.z, _n);
    const cosI = -dir.dot(_n);
    if (cosI < 0.12 && sp > 300 && !pr.bounced && pr.kind === 'shell' && am.type !== 'HE') {
      pr.v.addScaledVector(_n, -2 * pr.v.dot(_n)).multiplyScalar(0.7);
      pr.p.copy(hit.point).addScaledVector(_n, 0.1); pr.bounced = true; pr.ignore = null;
      fxDust(hit.point, 4, .7); return false;
    }
    if (pr.kind === 'bullet') {
      if (Math.random() < 0.35) spawnP({ pos: hit.point, vel: new V3(rand(-1, 1), rand(2, 5), rand(-1, 1)), life: rand(.6, 1.2), size: .5, size1: 1.8, color: 0x9c8a68, op: .7 });
      if (am.type === 'HEF') blast(hit.point, am.tnt, pr.owner, {});
      return true;
    }
    fxDust(hit.point, 10, 1);
    if (am.type === 'HE') blast(hit.point, am.tnt, pr.owner, {}); else if (am.type === 'APHE') fxExplosion(hit.point, .45);
    sndBoom(hit.point, false); addCrater(hit.point, am.type === 'HE' ? 1.6 : 0.9);
    return true;
  }
  if (hit.type === 'obst') {
    if (pr.kind === 'bullet') { if (Math.random() < .5) fxSparks(hit.point, 2); if (am.type === 'HEF') blast(hit.point, am.tnt, pr.owner, {}); return true; }
    fxDust(hit.point, 8, .9); fxSparks(hit.point, 4); sndBoom(hit.point, false);
    if (am.type === 'HE') blast(hit.point, am.tnt, pr.owner, {});
    return true;
  }
  if (hit.type === 'plane') return impactPlane(pr, hit, sp, dir);
  return impactTank(pr, hit, sp, dir);
}

function impactTank(pr, hit, sp, dir) {
  const t = hit.tank, am = pr.am, sh = pr.owner, shell = pr.kind === 'shell', isP = sh && sh.isPlayer;
  if (sh && sh.team !== t.team) t.lastHitBy = sh;
  if (am.type === 'HE') { blast(hit.point, am.tnt, sh, { direct: t, hit }); return true; }
  const E = evalArmor(t, hit, am, sp * (pr.bounced ? 0.6 : 1));
  const mat = hit.part === 'hull' ? t.root.matrixWorld : t.turret.matrixWorld;
  const nW = new V3(...E.arm.n).transformDirection(mat);
  if (E.track && t.alive && (shell ? Math.random() < 0.75 : E.pen > 15 && Math.random() < 0.1)) { t.breakMod('tracks'); if (t.isPlayer) showDmg('Esteira rompida'); }
  if (isP && shell) S.stats.hits++;
  if (Math.random() < E.ricoP) {
    pr.v.addScaledVector(nW, -2 * pr.v.dot(nW)).multiplyScalar(0.55).add(rv(30));
    pr.p.copy(hit.point).addScaledVector(nW, 0.08); pr.bounced = true; pr.ignore = t;
    if (shell) { fxSparks(hit.point, 10); sndPing(hit.point); }
    else if (Math.random() < .3) fxSparks(hit.point, 2);
    if (shell && isP) xrayShot(t, hit, dir, E, am, 'RICOCHETE', `${Math.round(E.ang)}° na ${E.arm.key}`, 'amber', null);
    return false;
  }
  if (am.type === 'HEF') blast(hit.point, am.tnt, sh, { direct: t, hit, small: true });
  if (E.pen < E.eff) {
    if (shell) {
      fxSparks(hit.point, 8); sndClank(hit.point);
      if (am.type === 'APHE') fxExplosion(hit.point, .35);
      if (isP) xrayShot(t, hit, dir, E, am, 'NÃO PENETROU', `${Math.round(E.eff)} mm efetivos · ${Math.round(E.pen)} mm de perfuração`, 'enemy', null);
      if (t.isPlayer) { showDmg(`Impacto na ${E.arm.key} · sem penetração`, true); shakeCam(.25); }
    } else if (Math.random() < .25) fxSparks(hit.point, 2);
    return true;
  }
  postPen(t, pr, hit, dir, E);
  return true;
}

export function compLabel(c) { return c.kind === 'crew' ? c.ref.label : c.name === 'ammo' ? 'Munição' : c.name === 'fuel' ? 'Combustível' : MODS[c.name][0]; }
function postPen(t, pr, hit, dir, E) {
  const am = pr.am, D = t.def, shell = pr.kind === 'shell';
  const lp = hit.point.clone().applyMatrix4(t.invRoot);
  const ld = dir.clone().transformDirection(t.invRoot);
  const comps = t.components(), hits = new Set(), frags = [];
  const dist = (c, x, y, z) => Math.hypot(c.p[0] - x, c.p[1] - y, c.p[2] - z);
  let blastL = null, end = null;
  if (am.type === 'APHE' && E.eff >= 12) {
    // espoleta com retardo: detona ~1,2 m depois da chapa
    const f = 1.0 + Math.random() * 0.8;
    const ex = clamp(lp.x + ld.x * f, -D.W / 2 + .3, D.W / 2 - .3), ey = clamp(lp.y + ld.y * f, D.clr + .2, D.clr + D.Hh + D.turret.h - .1), ez = clamp(lp.z + ld.z * f, -D.L / 2 + .3, D.L / 2 - .3);
    const R = 1.6 + am.filler * 12;
    for (const c of comps) { const d = dist(c, ex, ey, ez); if (d < R + c.r && Math.random() < 1 - d / (R + c.r) * 0.75) hits.add(c); }
    for (const c of comps) { const vx = c.p[0] - ex, vy = c.p[1] - ey, vz = c.p[2] - ez, d = Math.hypot(vx, vy, vz); if (d < R * 1.9 && (vx * ld.x + vy * ld.y + vz * ld.z) / d > 0.93 && Math.random() < 0.7) hits.add(c); }
    for (let i = 0; i < 26; i++) { const v = rv(1).normalize().multiplyScalar(R * rand(.5, 1.1)).addScaledVector(ld, R * .6); frags.push([[ex, ey, ez], [ex + v.x, ey + v.y, ez + v.z]]); }
    blastL = [ex, ey, ez]; end = blastL;
  } else {
    // munição sólida: trajetória interna + estilhaços da chapa (cone)
    const len = shell ? Math.min(4, 0.8 + (E.pen - E.eff) / 35) : Math.min(1.2, 0.3 + (E.pen - E.eff) / 20);
    const spall = shell ? (am.type === 'APCR' ? 0.18 : 0.35) : 0.05;
    const bx = lp.x + ld.x * len, by = lp.y + ld.y * len, bz = lp.z + ld.z * len;
    end = [bx, by, bz];
    for (const c of comps) {
      const sx = bx - lp.x, sy = by - lp.y, sz = bz - lp.z, L2 = sx * sx + sy * sy + sz * sz;
      const u = clamp(((c.p[0] - lp.x) * sx + (c.p[1] - lp.y) * sy + (c.p[2] - lp.z) * sz) / L2, 0, 1);
      const d = Math.hypot(c.p[0] - lp.x - sx * u, c.p[1] - lp.y - sy * u, c.p[2] - lp.z - sz * u);
      if (d < c.r + spall && Math.random() < (d < c.r ? (shell ? 1 : 0.5) : 0.6)) hits.add(c);
      if (!shell) continue;
      const vx = c.p[0] - lp.x, vy = c.p[1] - lp.y, vz = c.p[2] - lp.z, dd = Math.hypot(vx, vy, vz);
      if (dd < 2.8 && (vx * ld.x + vy * ld.y + vz * ld.z) / dd > 0.95 && Math.random() < (am.type === 'APCR' ? .25 : .45)) hits.add(c);
    }
    if (shell) for (let i = 0; i < (am.type === 'APCR' ? 8 : 16); i++) { const v = ld.clone().add(rv(.28)).normalize().multiplyScalar(rand(1.2, 2.8)); frags.push([[lp.x, lp.y, lp.z], [lp.x + v.x, lp.y + v.y, lp.z + v.z]]); }
  }
  const before = comps.map(c => c.kind === 'crew' ? c.ref.alive : !(c.name in t.mods) || !t.mods[c.name].broken);
  const names = applyCompHits(t, hits, am.type === 'APHE' ? 0.45 : 0.28);
  if (shell) { fxSparks(hit.point, 12); sndClank(hit.point); }
  if (blastL) { const w = new V3(...blastL).applyMatrix4(t.root.matrixWorld); fxExplosion(w, .5); sndBoom(w, false); }
  const sh = pr.owner, wasAlive = t.alive;
  if (names.detonate) destroyVehicle(t, sh, 'ammo');
  else if (t.alive && t.aliveCount() < 2) destroyVehicle(t, sh, 'crew');
  if (sh && sh.isPlayer && shell) S.stats.pens++;
  if (sh && sh.who && wasAlive && sh.team !== t.team) sh.who.score += 15;
  const det = names.list.length ? names.list.join(' · ') : 'sem dano crítico';
  const killed = wasAlive && !t.alive;
  if (sh && sh.isPlayer && shell) xrayShot(t, hit, dir, E, am, killed ? 'DESTRUÍDO' : 'PENETROU', `${Math.round(E.eff)} mm na ${E.arm.key} · ${det}`, killed ? 'amber' : 'ok',
    { lp: [lp.x, lp.y, lp.z], end, frags, blast: blastL, comps, before });
  if (t.isPlayer && t.alive) { showDmg(`Penetração na ${E.arm.key}: ${det}`); shakeCam(.6); flashVign(); }
}
// Efeito de componentes atingidos; retorna nomes e se a munição detonou
export function applyCompHits(t, hits, detChance) {
  const list = []; let detonate = false;
  for (const c of hits) {
    if (c.kind === 'crew') { if (c.ref.alive) { c.ref.alive = false; list.push(c.ref.label); } continue; }
    if (c.name === 'ammo') {
      // quanto menos munição a bordo, menor a chance de detonar
      const frac = t.ammoFrac ? t.ammoFrac() : 1;
      if (Math.random() < detChance * (0.35 + 0.65 * frac)) detonate = true; else if (Math.random() < 0.4) t.setFire();
      list.push('Munição');
    } else if (c.name === 'fuel') { if (Math.random() < 0.55) t.setFire(); list.push('Combustível'); }
    else { t.breakMod(c.name); list.push(MODS[c.name][0]); if (c.name === 'engine' && Math.random() < 0.3) t.setFire(); }
  }
  return { list, detonate };
}

// =====================================================================
// Explosivos: sobrepressão e fragmentação (granadas HE, foguetes, bombas, AA)
// =====================================================================
const _bl = new V3();
export function blast(pos, tnt, owner, opts = {}) {
  const R = 1.2 + 2.6 * Math.cbrt(tnt), pen0 = hePen(tnt) + (opts.kinetic || 0);
  const sc = Math.cbrt(tnt);
  if (tnt >= 20) { fxBigBlast(pos, Math.min(2.6, sc / 3)); sndBoom(pos, true); addCrater(pos, 2 + sc * 1.2); shakeAt(pos, 1.6, 140); }
  else if (tnt > 0.2) { fxExplosion(pos, clamp(sc * .9, .5, 1.6)); sndBoom(pos, tnt > 2); addCrater(pos, 1 + sc); shakeAt(pos, .5, 40); }
  else { spawnP({ pos, life: .12, size: .8 + sc * 4, size1: .3, tex: TEX.fire, add: true, color: 0xffc070 }); spawnP({ pos, life: rand(.8, 1.4), size: .6 + sc * 5, size1: 2 + sc * 10, color: 0x3a3631, op: .7, drag: 2 }); }
  let report = null;
  for (const t of tanks) {
    if (!t.alive && t.popped) continue;
    _bl.copy(pos).applyMatrix4(t.invRoot);
    const cx = clamp(_bl.x, t.hullMin[0], t.hullMax[0]), cy = clamp(_bl.y, t.hullMin[1], t.hullMax[1] + t.def.turret.h), cz = clamp(_bl.z, t.hullMin[2], t.hullMax[2]);
    const d = Math.hypot(_bl.x - cx, _bl.y - cy, _bl.z - cz);
    if (d > R) continue;
    const f = 1 - d / R, pen = pen0 * f * f;
    // face exposta à explosão
    const A = t.def.armor, D = t.def, yH = D.clr + D.Hh;
    let th, key, onTurret = _bl.y > yH - 0.1 && Math.abs(_bl.z - D.turret.z) < D.turret.l * 0.8 && Math.abs(_bl.x) < D.turret.w * 0.8;
    if (_bl.y > yH + (onTurret ? D.turret.h - 0.2 : -0.1)) { th = onTurret ? A.tTop : A.top; key = onTurret ? 'teto da torre' : 'teto'; }
    else {
      const ax = Math.abs(_bl.x) / (D.W / 2), az = Math.abs(_bl.z) / (D.L / 2);
      if (onTurret && _bl.y > yH) { th = az > ax ? (_bl.z > D.turret.z ? A.tFront[0] : A.tRear[0]) : A.tSide[0]; key = 'torre'; }
      else if (az > ax) { th = _bl.z > 0 ? A.front[0] : A.rear[0]; key = _bl.z > 0 ? 'frente' : 'traseira'; }
      else { th = A.side[0] + (_bl.y < D.clr + .5 ? 20 : 0); key = 'lateral'; }
    }
    if (owner && owner.team !== t.team) t.lastHitBy = owner;
    if (_bl.y < D.clr + 0.8 && f > 0.55 && t.alive && Math.random() < f) { t.breakMod('tracks'); if (t.isPlayer) showDmg('Esteira rompida pela explosão'); }
    if (t.alive && f > 0.2) {
      const J = Math.sqrt(tnt) * 2000 * f, dir = _bl.set(t.pos.x - pos.x, 2, t.pos.z - pos.z).normalize();
      t.impulse(dir.multiplyScalar(J));
    }
    if (pen < th || !t.alive) {
      if (owner && owner.isPlayer && (opts.direct === t || f > .6) && !report) report = { t, w: 'NÃO PENETROU', s: `HE · ${Math.round(pen)} mm contra ${th} mm (${key})`, c: 'enemy' };
      continue;
    }
    // penetração por sobrepressão: dano interno ao redor do ponto de entrada
    const comps = t.components(), hits = new Set();
    const ix = clamp(_bl.x, -D.W / 2 + .4, D.W / 2 - .4), iy = clamp(_bl.y, D.clr + .3, yH + D.turret.h - .2), iz = clamp(_bl.z, -D.L / 2 + .4, D.L / 2 - .4);
    const Ri = 1.0 + 0.9 * Math.cbrt(tnt * f);
    for (const c of comps) { const dd = Math.hypot(c.p[0] - ix, c.p[1] - iy, c.p[2] - iz); if (dd < Ri + c.r && Math.random() < 1 - dd / (Ri + c.r) * 0.7) hits.add(c); }
    if (tnt * f > 1.2) for (const c of comps) if (c.kind === 'crew' && Math.random() < clamp(tnt * f / 6, 0.3, 0.9)) hits.add(c);
    const before = comps.map(c => c.kind === 'crew' ? c.ref.alive : !(c.name in t.mods) || !t.mods[c.name].broken);
    const wasAlive = t.alive;
    const res = applyCompHits(t, hits, 0.5);
    if (res.detonate) destroyVehicle(t, owner, 'ammo');
    else if (t.alive && t.aliveCount() < 2) destroyVehicle(t, owner, 'crew');
    if (owner && owner.who && wasAlive && owner.team !== t.team) owner.who.score += 15;
    const killed = wasAlive && !t.alive, det = res.list.length ? res.list.join(' · ') : 'sem dano crítico';
    if (owner && owner.isPlayer) {
      report = { t, w: killed ? 'DESTRUÍDO' : 'PENETROU', s: `HE · ${Math.round(pen)} mm contra ${th} mm (${key}) · ${det}`, c: killed ? 'amber' : 'ok', x: { lp: [ix, iy, iz], end: [ix, iy, iz], frags: Array.from({ length: 22 }, () => { const v = rv(1).normalize().multiplyScalar(Ri * rand(.6, 1.2)); return [[ix, iy, iz], [ix + v.x, iy + v.y, iz + v.z]]; }), blast: [ix, iy, iz], comps, before } };
      if (opts.direct === t || opts.bomb) S.stats.pens++;
    }
    if (t.isPlayer && t.alive) { showDmg(`Explosão no ${key}: ${det}`); shakeCam(.8); flashVign(); }
  }
  if (report) xrayReport(report);
  // aeronaves próximas: fragmentos
  const Ra = 2 + 3 * sc;
  for (const pl of planes) {
    if (pl.gone || pl === opts.skipPlane) continue;
    const d = pl.pos.distanceTo(pos);
    if (d > Ra) continue;
    const f = 1 - d / Ra;
    pl.damage(nearestPlanePart(pl, pos), 40 * Math.sqrt(tnt) * f + 1, owner, true);
    if (pl.mods && !pl.gone) { const l = pos.clone().applyMatrix4(pl.inv); blastPlaneModules(pl, l.x, l.y, l.z, Ra * 0.8, 20 * Math.sqrt(tnt) * f, owner); }
  }
}
export function nearestPlanePart(pl, pos) {
  const l = pos.clone().applyMatrix4(pl.inv);
  if (l.z < -pl.def.L * 0.32) return 'tail';
  if (Math.abs(l.x) > 1.4) return l.x > 0 ? 'wingL' : 'wingR';
  if (l.z > pl.def.L * 0.22) return 'engine';
  return Math.random() < .5 ? 'fuse' : 'fuel';
}
function impactPlane(pr, hit, sp, dir) {
  const pl = hit.plane, am = pr.am, sh = pr.owner;
  if (sh && sh.team === pl.team && sh !== pl) { /* fogo amigo também causa dano */ }
  const D = pl.def;
  // a casca atingida (estrutura) e, por dentro, os componentes no caminho do projétil
  const shell = hit.box === 'wingL' ? 'wingL' : hit.box === 'wingR' ? 'wingR' : hit.box === 'tail' || hit.box === 'fin' ? 'tail' : 'fuse';
  const pen = am.type === 'HE' ? hePen(am.tnt) : penAt(am, sp);
  let dmg = am.dmg || (pr.kind === 'shell' ? 60 : 1);
  // casco blindado (Il-2): balas que não perfuram quase não fazem estrago
  const plate = shell === 'fuse' && D.armor ? Math.max(D.armor.engine || 0, D.armor.fuel || 0) : 0;
  if (plate && pen < plate) { dmg *= 0.08; if (Math.random() < .3) fxSparks(hit.point, 2); }
  if (Math.random() < .5) fxSparks(hit.point, 2);
  hitPlaneModules(pl, hit.lp, hit.ld, am, dmg, pen, sh, shell);
  if (am.type === 'HEF' || am.type === 'HE') blast(hit.point, am.tnt || 0.01, sh, { skipPlane: pl });
  if (sh && sh.type === 'plane' && sh.team !== pl.team) sh.hitsN++;
  if (sh && sh.isPlayer) hitMarker();
  return true;
}

// =====================================================================
// Destruição
// =====================================================================
export function destroyVehicle(v, killer, cause) {
  if (!v.alive) return;
  v.alive = false;
  const k = killer && killer !== v && killer.team !== v.team ? killer : (v.lastHitBy && v.lastHitBy.team !== v.team ? v.lastHitBy : null);
  if (v.type === 'plane') v.onDestroyed(cause); else onTankDestroyed(v, cause);
  onVehicleDestroyed(v, k, cause);
}
function onTankDestroyed(t, cause) {
  t.throttle = 0; t.steer = 0; t.fire = 0; t.deadT = 0; t.burnT = cause === 'ammo' ? 45 : 28;
  for (const m of t.mats) m.color.multiplyScalar(0.28);
  const center = t.centerPos(new V3());
  if (cause === 'ammo') {
    fxExplosion(center, 2.2); sndBoom(center, true); shakeAt(center, 1.2, 80);
    const obj = t.turret; scene.attach(obj); t.turretOn = false;
    const T = t.def.turret;
    t.popped = spawnDebris(obj, new V3(rand(-3, 3), rand(9, 15), rand(-3, 3)).add(t.vel), rv(3), [T.w / 2, T.h / 2, T.l / 2], [0, T.h / 2, 0], 4000);
  } else { fxExplosion(center, 1); sndBoom(center, true); }
}
// Destroço como corpo rígido do Rapier (quica, rola e colide com veículos e construções)
const _dq = new QUAT();
export function spawnDebris(obj, vel, angVel, half, offset = [0, 0, 0], mass = 500) {
  obj.updateMatrixWorld(true);
  const p = new V3(), q = new QUAT(); obj.matrixWorld.decompose(p, q, new V3());
  const off = new V3(...offset).applyQuaternion(q);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x + off.x, p.y + off.y, p.z + off.z).setRotation(q).setLinvel(vel.x, vel.y, vel.z).setAngvel(angVel).setLinearDamping(0.05).setAngularDamping(0.3));
  world.createCollider(RAPIER.ColliderDesc.cuboid(...half).setMass(mass).setFriction(0.8).setRestitution(0.15).setCollisionGroups(COL.debris), body);
  const d = { obj, body, offset: new V3(...offset), hit: false };
  popped.push(d);
  return d;
}
export function updatePopped() {
  for (const d of popped) {
    if (!d.body) continue;
    const t = d.body.translation(), r = d.body.rotation();
    _dq.set(r.x, r.y, r.z, r.w);
    d.obj.quaternion.copy(_dq);
    d.obj.position.set(t.x, t.y, t.z).sub(d.offset.clone().applyQuaternion(_dq));
    const v = d.body.linvel();
    if (!d.hit && v.y > -1 && t.y < H(t.x, t.z) + 2) { d.hit = true; fxDust(new V3(t.x, t.y, t.z), 6, 1); sndClank(d.obj.position); }
  }
}
export function clearDebris() {
  for (const d of popped) { scene.remove(d.obj); if (d.body) world.removeRigidBody(d.body); }
  popped.length = 0;
}
