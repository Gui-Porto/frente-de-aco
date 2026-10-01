import * as THREE from 'three';
import { scene } from '../core/render.js';
import { S, planes } from '../core/state.js';
import { V3, clamp, rand, rv } from '../core/util.js';
import { H } from '../world/terrain.js';
import { MISSILES, G, RHO } from '../data/vehicles.js';
import { spawnP, TEX, fxExplosion, fxTrail } from '../fx/particles.js';
import { sndBoom, sndLaunch } from '../fx/audio.js';
import { nearestPlanePart } from '../combat/ballistics.js';
import { blastPlaneModules } from '../vehicles/planeDamage.js';
import { sndCm } from '../fx/audio.js';
import { shakeAt } from '../ui/hud.js';
import { pnAccel, fwdOf } from './targeting.js';
// =====================================================================
// Mísseis ar-ar: motor-foguete com queima curta, arrasto, navegação
// proporcional limitada em G, gimbal do buscador e espoleta de proximidade.
// O míssil perde o alvo se ele sair do cone do buscador; aí segue balístico.
// =====================================================================
export const missiles = [];
// material com os mesmos parâmetros dos aviões: reaproveita o programa já compilado
const geo = new THREE.CylinderGeometry(1, 1, 1, 8).rotateX(Math.PI / 2);
const mat = new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: .7 });
const _a = new V3(), _f = new V3(), _q = new V3(), _rel = new V3(), _cp = new V3();

export class Missile {
  constructor(owner, target, M, pos, vel) {
    this.owner = owner; this.target = target; this.M = M;
    this.pos = pos.clone(); this.vel = vel.clone(); this.t = 0; this.tracking = !!target; this.dead = false; this.seen = new Set();
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.scale.set(M.d / 2, M.d / 2, M.len); scene.add(this.mesh);
    missiles.push(this);
  }
  update(dt) {
    const M = this.M; this.t += dt;
    const n = Math.max(1, Math.ceil(dt / 0.01)), h = dt / n;
    for (let s = 0; s < n && !this.dead; s++) {
      const V = Math.max(this.vel.length(), 1);
      _f.copy(this.vel).divideScalar(V);
      // flares: cada flare novo dentro do campo do buscador tem uma chance de roubar o míssil
      if (this.tracking && this.target && !this.target.isFlare) for (const fl of flares) {
        if (this.seen.has(fl)) continue; this.seen.add(fl);
        _rel.copy(fl.pos).sub(this.pos); const d = _rel.length();
        if (d < 3000 && _rel.dot(_f) / d > Math.cos(M.gimbal * Math.PI / 180) && Math.random() < (M.flareRes ?? 0.55)) { this.target = fl; break; }
      }
      const tg = this.target;
      // buscador: precisa ver o alvo dentro do gimbal, em relação ao eixo do míssil
      if (this.tracking && tg) {
        _rel.copy(tg.pos).sub(this.pos);
        const d = _rel.length();
        if (!tg.alive || _rel.dot(_f) / d < Math.cos(M.gimbal * Math.PI / 180) || d > M.range * 1.4) this.tracking = false;
      }
      _a.set(0, -G, 0);
      if (this.tracking && tg) {
        pnAccel(this.pos, this.vel, tg.pos, tg.vel, M.nav, _q);
        _q.y += G; // compensa a gravidade
        _q.addScaledVector(_f, -_q.dot(_f)); // só aceleração lateral
        const lim = M.maxG * G * clamp((V / 320) ** 2, 0.15, 1); // pouca autoridade em baixa velocidade
        if (_q.length() > lim) _q.setLength(lim);
        _a.add(_q);
      }
      const rho = RHO * Math.exp(-Math.max(0, this.pos.y) / 8500);
      const A = Math.PI * (M.d / 2) ** 2, drag = 0.5 * rho * V * V * M.cd * A / M.mass;
      _a.addScaledVector(_f, (this.t < M.burn ? M.thrust / M.mass : 0) - drag);
      this.vel.addScaledVector(_a, h);
      _q.copy(this.pos).addScaledVector(this.vel, h);
      // espoleta de proximidade: menor distância ao alvo dentro do passo
      if (tg && tg.alive) {
        const cpa = closest(this.pos, _q, tg.pos, _cp);
        if (cpa < M.fuse && this.t > 0.4) { this.detonate(_cp, cpa); return; }
      }
      // colisão com outro avião (passa raspando por quem não era o alvo)
      for (const p of planes) if (p !== tg && p !== this.owner && p.alive && p.pos.distanceTo(_q) < p.def.span * 0.4) { this.detonate(_q, 0, p); return; }
      this.pos.copy(_q);
      if (this.pos.y < H(this.pos.x, this.pos.z)) { this.detonate(this.pos, 99); return; }
    }
    if (this.t > M.life) { this.detonate(this.pos, 99); return; }
    // visual: corpo alinhado à velocidade, chama e fumaça do motor
    _f.copy(this.vel).normalize();
    this.mesh.position.copy(this.pos); this.mesh.lookAt(_q.copy(this.pos).add(_f));
    if (this.t < M.burn) {
      spawnP({ pos: _q.copy(this.pos).addScaledVector(_f, -M.len * 0.6), life: .07, size: .9, size1: .3, tex: TEX.fire, add: true, color: 0xffb060 });
      fxTrail(this.pos.clone(), 0xe4e1da, 0.8, 5.5);
    } else if (Math.random() < 0.35) fxTrail(this.pos.clone(), 0xd8d5ce, 0.4, 2.5);
  }
  detonate(at, miss, hitPlane) {
    this.dead = true; scene.remove(this.mesh);
    const M = this.M, p = at.clone();
    fxExplosion(p, 1.1); sndBoom(p, false); shakeAt(p, 0.6, 120);
    for (let i = 0; i < 10; i++) spawnP({ pos: p.clone(), vel: rv(40), life: rand(.3, .7), size: .25, size1: .1, tex: TEX.fire, add: true, color: 0xffd080, grav: 9, drag: .4 });
    // estilhaços: dano cai com a distância; quem estiver a < 2× espoleta sofre
    const R = M.fuse * 2.2;
    for (const pl of planes) {
      if (pl.gone) continue;
      const d = pl === hitPlane ? 0 : pl.pos.distanceTo(p);
      if (d > R) continue;
      const f = 1 - d / R, k = M.warhead * 14 * f * f;
      pl.damage(nearestPlanePart(pl, p), k, this.owner, true);
      if (pl.mods && !pl.gone) { const l = p.clone().applyMatrix4(pl.inv); blastPlaneModules(pl, l.x, l.y, l.z, R * 0.7, k * 0.8, this.owner); }
      for (let i = 0; i < 2; i++) if (Math.random() < f) pl.damage(['wingL', 'wingR', 'fuse', 'engine', 'tail', 'fuel'][Math.floor(Math.random() * 6)], k * 0.45, this.owner, true);
    }
  }
}
// distância mínima entre o segmento a→b e o ponto c (ponto mais próximo em `out`)
function closest(a, b, c, out) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L2 = dx * dx + dy * dy + dz * dz || 1e-9;
  const u = clamp(((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / L2, 0, 1);
  out.set(a.x + dx * u, a.y + dy * u, a.z + dz * u);
  return out.distanceTo(c);
}

// Dispara o próximo míssil do avião contra o alvo travado (ou sem guiamento, se não houver)
export function launchMissile(plane, target) {
  const D = plane.def;
  if (!D.missiles || plane.missiles <= 0 || !plane.alive) return null;
  const M = MISSILES[D.missiles.w];
  plane.missiles--;
  const mesh = plane.missileMeshes[plane.missiles];
  const pos = mesh ? mesh.getWorldPosition(new V3()) : plane.pos.clone();
  if (mesh) mesh.visible = false;
  const vel = fwdOf(plane.q, new V3()).multiplyScalar(25).add(plane.vel);
  sndLaunch(pos);
  return new Missile(plane, target, M, pos, vel);
}
export function updateMissiles(dt) {
  updateFlares(dt);
  for (let i = missiles.length - 1; i >= 0; i--) { const m = missiles[i]; if (!m.dead) m.update(dt); if (m.dead) missiles.splice(i, 1); }
}
export function clearMissiles() { for (const m of missiles) scene.remove(m.mesh); missiles.length = 0; flares.length = 0; }

// ---------- contramedidas ----------
// Flares: iscas quentes que caem e queimam ~4 s (enganam buscadores IR).
// Chaff: nuvem de tiras metálicas; quebra a mira/ranging de quem está atrás (a IA perde o alvo).
export const flares = [];
export function dropCM(p) {
  if (!p.alive || (p.flares <= 0 && p.chaff <= 0) || S.now - (p.cmT ?? -9) < 0.4) return false;
  p.cmT = S.now; sndCm(p.pos);
  if (p.flares > 0) {
    p.flares--; p.flareUntil = S.now + 2.5;
    for (const s of [1, -1]) {
      _a.set(s * 14, -10, 0).applyQuaternion(p.q);
      flares.push({ pos: p.pos.clone(), vel: p.vel.clone().multiplyScalar(0.55).add(_a), alive: true, t: 0, team: p.team, isFlare: true });
    }
  }
  if (p.chaff > 0) {
    p.chaff--; p.chaffUntil = S.now + 3;
    for (let i = 0; i < 14; i++) spawnP({ pos: p.pos.clone().add(rv(2)), vel: p.vel.clone().multiplyScalar(0.3).add(rv(10)), life: rand(1.5, 3), size: 1.2, size1: 5, color: 0xc9ccd0, op: 0.35, drag: 2.5 });
  }
  return true;
}
export function updateFlares(dt) {
  for (let i = flares.length - 1; i >= 0; i--) {
    const f = flares[i]; f.t += dt;
    f.vel.multiplyScalar(Math.exp(-dt * 1.4)); f.vel.y -= 9.81 * dt * 0.5; f.pos.addScaledVector(f.vel, dt);
    spawnP({ pos: f.pos.clone(), life: 0.08, size: 1.6, size1: 0.6, tex: TEX.fire, add: true, color: 0xfff0c0, hdr: 2 });
    if (Math.random() < 0.6) fxTrail(f.pos.clone(), 0xe8e6e2, 0.7, 2.5);
    if (f.t > 4) { f.alive = false; flares.splice(i, 1); }
  }
}
// mísseis guiados vindo atrás deste avião (alerta e IA)
export function incomingTo(p) { let best = null, bd = 1e9; for (const m of missiles) if (m.tracking && m.target === p) { const d = m.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = m; } } return best; }
