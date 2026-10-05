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
import { missileMesh, missileTail } from '../vehicles/planeModel.js';
import { smokeOf } from './missileSpec.js';
import { Trail, updateTrails, clearTrails } from '../fx/trails.js';
// chama do motor: sprite aditivo único (compilado na decolagem pelo míssil-fantasma)
const glowC = document.createElement('canvas'); glowC.width = glowC.height = 64;
{ const g = glowC.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.25, 'rgba(255,220,140,.95)'); gr.addColorStop(0.55, 'rgba(255,140,50,.45)'); gr.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }
const FLARE = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowC), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
// =====================================================================
// Mísseis ar-ar: motor-foguete com queima curta, arrasto, navegação
// proporcional limitada em G, gimbal do buscador e espoleta de proximidade.
// O míssil perde o alvo se ele sair do cone do buscador; aí segue balístico.
// =====================================================================
export const missiles = [];
const _a = new V3(), _f = new V3(), _q = new V3(), _rel = new V3(), _cp = new V3();

export class Missile {
  constructor(owner, target, M, pos, vel) {
    this.owner = owner; this.target = target; this.M = M;
    this.pos = pos.clone(); this.vel = vel.clone(); this.t = 0; this.tracking = !!target; this.dead = false; this.seen = new Set();
    this.mesh = missileMesh(M); scene.add(this.mesh);
    // chama na cauda e rastro de fumaça contínuo
    // chama no bocal e rastro do tamanho do motor (Sparrow deixa fumaça mais grossa que o Sidewinder)
    this.sm = smokeOf(M); this.tailZ = missileTail(M);
    this.flame = new THREE.Sprite(FLARE); this.flame.position.set(0, 0, -this.tailZ - this.sm.flame * 0.2); this.flame.scale.setScalar(1e-4); this.mesh.add(this.flame);
    this.trail = new Trail({ life: this.sm.life, w0: this.sm.w0, w1: this.sm.w1, alpha: 0.92, step: 4, color: 0xd6d2ca });
    // semiativos (Sparrow/R-3R) são EJETADOS e acendem ~0,35 s depois; IR sai acesa do trilho
    this.ign = M.seeker === 'sarh' ? 0.35 : 0; this.burning = !this.ign; this.spin = Math.random() * 6;
    if (!this.ign && owner) for (let i = 0; i < 6; i++) spawnP({ pos: this.pos.clone().add(rv(0.4)), vel: owner.vel.clone().multiplyScalar(0.6).add(rv(4)), life: rand(1.2, 2.2), size: 1.2, size1: 4, color: 0xdedbd4, op: 0.5, drag: 2 });
    missiles.push(this);
  }
  update(dt) {
    const M = this.M; this.t += dt;
    const n = Math.max(1, Math.ceil(dt / 0.01)), h = dt / n;
    for (let s = 0; s < n && !this.dead; s++) {
      const V = Math.max(this.vel.length(), 1);
      _f.copy(this.vel).divideScalar(V);
      // flares: cada SALVA nova dentro do campo do buscador tem uma chance (M.flareRes) de roubar o míssil
      const sarh = M.seeker === 'sarh';
      // o alvo quente (pós-combustão) se destaca da flare; em marcha lenta ela rouba mais fácil
      const tg0 = this.target, heat = tg0 && tg0.eng ? (tg0.eng.ab > 0.1 ? 0.55 : tg0.throttle < 0.4 ? 1.4 : 1) : 1;
      if (this.tracking && tg0 && !tg0.isFlare && !sarh) for (const fl of flares) {
        if (this.seen.has(fl.grp)) continue; this.seen.add(fl.grp);
        _rel.copy(fl.pos).sub(this.pos); const d = _rel.length();
        if (d < 3000 && _rel.dot(_f) / d > Math.cos(M.gimbal * Math.PI / 180) && Math.random() < (M.flareRes ?? 0.3) * heat) { this.target = fl; break; }
      }
      // semiativo: notch e chaff. Velocidade radial do alvo em relação ao CHÃO na linha de visada (é o que o filtro
      // Doppler mede): de través (~90°) ela vai a zero e o alvo some no meio do eco do solo. Mantido ~0,4 s, o
      // buscador Doppler (AIM-7E) perde; o chaff (nuvem quase parada) só engana o Doppler perto do notch, e o
      // pulsado (R-3R) sempre um pouco
      if (sarh && this.tracking && tg0 && tg0.vel) {
        _rel.copy(tg0.pos).sub(this.pos); const d = _rel.length(), vr = tg0.vel.dot(_rel) / Math.max(d, 1);
        if (M.doppler && Math.abs(vr) < (M.notch || 25)) { this.notchT = (this.notchT || 0) + h; if (this.notchT > 0.4) this.tracking = false; }
        else this.notchT = Math.max(0, (this.notchT || 0) - h * 0.5);
        const beam = M.doppler ? clamp(1 - Math.abs(vr) / 150, 0.08, 1) : 1;
        for (const c of chaffs) {
          if (this.seen.has(c.grp)) continue; this.seen.add(c.grp);
          _rel.copy(c.pos).sub(this.pos); const dc = _rel.length();
          if (dc < 5000 && _rel.dot(_f) / dc > Math.cos(M.gimbal * Math.PI / 180) && Math.random() < (M.chaffRes ?? 0.25) * beam) { this.tracking = false; this.target = c; break; }
        }
      }
      const tg = this.target;
      // buscador: precisa ver o alvo dentro do gimbal, em relação ao eixo do míssil
      if (this.tracking && tg) {
        _rel.copy(tg.pos).sub(this.pos);
        const d = _rel.length();
        if (!tg.alive || _rel.dot(_f) / d < Math.cos(M.gimbal * Math.PI / 180) || d > M.range * 1.4) this.tracking = false;
        // semiativo: só segue enquanto o radar do lançador ilumina o alvo (o RWR do alvo ouve isso)
        if (sarh && this.tracking) {
          const rd = this.owner.sys && this.owner.sys.radar;
          if (!this.owner.alive || !rd || rd.target !== tg || !rd.locked) this.tracking = false;
          else { rd.guideUntil = S.now + 0.3; rd.guideTgt = tg; }
        }
      }
      _a.set(0, -G, 0);
      if (this.tracking && tg) {
        pnAccel(this.pos, this.vel, tg.pos, tg.vel, M.nav, _q);
        _q.y += G; // compensa a gravidade
        _q.addScaledVector(_f, -_q.dot(_f)); // só aceleração lateral
        const lim = M.maxG * G * clamp((V / 290) ** 2, 0.22, 1); // pouca autoridade em baixa velocidade
        if (_q.length() > lim) _q.setLength(lim);
        _a.add(_q);
      }
      const rho = RHO * Math.exp(-Math.max(0, this.pos.y) / 8500);
      const A = Math.PI * (M.d / 2) ** 2, drag = 0.5 * rho * V * V * M.cd * A / M.mass;
      const burn = this.t >= this.ign && this.t < this.ign + M.burn;
      if (burn && !this.burning) { this.burning = true; sndLaunch(this.pos); for (let i = 0; i < 8; i++) spawnP({ pos: this.pos.clone(), vel: rv(6), life: rand(.15, .3), size: 1.4, size1: .4, tex: TEX.fire, add: true, color: 0xffd090 }); }
      if (!burn && this.burning && this.t > this.ign) { this.burning = false; this.trail.close(); }
      _a.addScaledVector(_f, (burn ? M.thrust / M.mass : 0) - drag);
      this.vel.addScaledVector(_a, h);
      _q.copy(this.pos).addScaledVector(this.vel, h);
      // espoleta de proximidade: dentro do raio, espera a máxima aproximação (o ponto mais próximo cair DENTRO do
      // passo); antes detonava no primeiro passo que entrava no raio e o erro típico ficava em 7–9 m
      if (tg && tg.alive) {
        const cpa = closest(this.pos, _q, tg.pos, _cp);
        if (cpa < M.fuse && this.t > 0.4 && _cu < 1) { this.detonate(_cp, cpa); return; }
      }
      // colisão com outro avião (passa raspando por quem não era o alvo)
      for (const p of planes) if (p !== tg && p !== this.owner && p.alive && p.pos.distanceTo(_q) < p.def.span * 0.4) { this.detonate(_q, 0, p); return; }
      this.pos.copy(_q);
      if (this.pos.y < H(this.pos.x, this.pos.z)) { this.detonate(this.pos, 99); return; }
    }
    if (this.t > M.life) { this.detonate(this.pos, 99); return; }
    // visual: corpo alinhado à velocidade e girando devagar; chama tremendo; fita de fumaça só com motor aceso
    _f.copy(this.vel).normalize();
    this.mesh.position.copy(this.pos); this.mesh.lookAt(_q.copy(this.pos).add(_f)); this.mesh.rotateZ(this.spin += dt * 3);
    if (this.burning) {
      const k = 1 + (Math.random() - 0.5) * 0.35; this.flame.scale.setScalar(this.sm.flame * k);
      this.trail.push(_q.copy(this.pos).addScaledVector(_f, -this.tailZ - 0.3), S.now);
    } else this.flame.scale.setScalar(1e-4);
  }
  detonate(at, miss, hitPlane) {
    this.dead = true; scene.remove(this.mesh); this.trail.close();
    const M = this.M, p = at.clone();
    // explosão: bola de fogo, nuvem escura que fica no céu e estilhaços incandescentes
    fxExplosion(p, 1.1 + M.warhead / 9); sndBoom(p, false); shakeAt(p, 0.6, 120);
    for (let i = 0; i < 7; i++) spawnP({ pos: p.clone().add(rv(2)), vel: rv(5).add(this.vel.clone().multiplyScalar(0.05)), life: rand(5, 8), size: 3, size1: 9, color: 0x3c3a37, op: 0.55, drag: 1.2, rise: 0.2 });
    for (let i = 0; i < 10; i++) spawnP({ pos: p.clone(), vel: rv(40), life: rand(.3, .7), size: .25, size1: .1, tex: TEX.fire, add: true, color: 0xffd080, grav: 9, drag: .4 });
    // estilhaços: dano cai com a distância; quem estiver a < 2,4× espoleta sofre
    const R = M.fuse * 2.4;
    for (const pl of planes) {
      if (pl.gone) continue;
      const d = pl === hitPlane ? 0 : pl.pos.distanceTo(p);
      if (d > R) continue;
      const f = 1 - d / R, k = M.warhead * 14 * f * f;
      pl.damage(nearestPlanePart(pl, p), k, this.owner, true);
      if (pl.mods && !pl.gone) { const l = p.clone().applyMatrix4(pl.inv); blastPlaneModules(pl, l.x, l.y, l.z, R * 0.7, k * 0.8, this.owner, { name: M.name, tnt: M.warhead }); }
      for (let i = 0; i < 2; i++) if (Math.random() < f) pl.damage(['wingL', 'wingR', 'fuse', 'engine', 'tail', 'fuel'][Math.floor(Math.random() * 6)], k * 0.45, this.owner, true);
    }
  }
}
// distância mínima entre o segmento a→b e o ponto c (ponto mais próximo em `out`; fração do segmento em _cu)
let _cu = 0;
function closest(a, b, c, out) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L2 = dx * dx + dy * dy + dz * dz || 1e-9;
  const u = _cu = clamp(((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / L2, 0, 1);
  out.set(a.x + dx * u, a.y + dy * u, a.z + dz * u);
  return out.distanceTo(c);
}

// Dispara o próximo míssil do avião contra o alvo travado (ou sem guiamento, se não houver)
export function launchMissile(plane, target, rack = plane.rack) {
  if (!rack || rack.n <= 0 || !plane.alive) return null;
  const M = rack.M;
  rack.n--;
  const mesh = rack.meshes[rack.n];
  const pos = mesh ? mesh.getWorldPosition(new V3()) : plane.pos.clone();
  if (mesh) mesh.visible = false;
  // IR sai do trilho já empurrando; semiativo é ejetado para baixo e acende depois (som na ignição)
  const sarh = M.seeker === 'sarh';
  const vel = sarh ? new V3(0, -7, 0).applyQuaternion(plane.q).add(plane.vel) : fwdOf(plane.q, new V3()).multiplyScalar(25).add(plane.vel);
  if (!sarh) sndLaunch(pos);
  const m = new Missile(plane, target, M, pos, vel);
  if (S.air && S.air.onLaunch) S.air.onLaunch(m);
  return m;
}
export function updateMissiles(dt) {
  updateFlares(dt);
  updateTrails(S.now, dt);
  for (let i = missiles.length - 1; i >= 0; i--) { const m = missiles[i]; if (!m.dead) m.update(dt); if (m.dead) missiles.splice(i, 1); }
}
export function clearMissiles() { for (const m of missiles) scene.remove(m.mesh); missiles.length = 0; flares.length = 0; chaffs.length = 0; clearTrails(); }

// ---------- contramedidas ----------
// Flares: iscas quentes que caem e queimam ~4 s (enganam buscadores IR).
// Chaff: nuvem de tiras metálicas; quebra a mira/ranging de quem está atrás (a IA perde o alvo).
export const flares = [], chaffs = [];
// kind: 'both' (padrão), 'flare' ou 'chaff'
export function dropCM(p, kind = 'both') {
  const fl = kind !== 'chaff' && p.flares > 0, ch = kind !== 'flare' && p.chaff > 0;
  if (!p.alive || (!fl && !ch) || S.now - (p.cmT ?? -9) < 0.4) return false;
  p.cmT = S.now; sndCm(p.pos);
  if (fl) {
    p.flares--; p.flareUntil = S.now + 2.5;
    const grp = {};
    for (const s of [1, -1]) {
      _a.set(s * 14, -10, 0).applyQuaternion(p.q);
      flares.push({ pos: p.pos.clone(), vel: p.vel.clone().multiplyScalar(0.55).add(_a), alive: true, t: 0, team: p.team, isFlare: true, grp });
    }
  }
  if (ch) {
    p.chaff--; p.chaffUntil = S.now + 3;
    // nuvem: sai com o avião e para em segundos (é isso que a deixa no notch do Doppler)
    chaffs.push({ pos: p.pos.clone(), vel: p.vel.clone().multiplyScalar(0.4), alive: true, t: 0, team: p.team, isChaff: true, grp: {} });
    for (let i = 0; i < 14; i++) spawnP({ pos: p.pos.clone().add(rv(2)), vel: p.vel.clone().multiplyScalar(0.3).add(rv(10)), life: rand(1.5, 3), size: 1.2, size1: 5, color: 0xc9ccd0, op: 0.35, drag: 2.5 });
  }
  return true;
}
export function updateFlares(dt) {
  for (let i = chaffs.length - 1; i >= 0; i--) { const c = chaffs[i]; c.t += dt; c.vel.multiplyScalar(Math.exp(-dt * 2.5)); c.vel.y -= 2 * dt; c.pos.addScaledVector(c.vel, dt); if (c.t > 4) { c.alive = false; chaffs.splice(i, 1); } }
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
