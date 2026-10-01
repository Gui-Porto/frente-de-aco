import * as THREE from 'three';
import { scene } from '../core/render.js';
import { S, planes } from '../core/state.js';
import { V3, QUAT, UP, clamp, lerp, rand, rv } from '../core/util.js';
import { H, AIRLIMIT } from '../world/terrain.js';
import { obstNear, addCrater } from '../world/scenery.js';
import { PLANES, GUNS, RHO, G } from '../data/vehicles.js';
import { fxBurn, fxTrail, fxSmallFlash, fxExplosion, fxBigBlast } from '../fx/particles.js';
import { sndMG, sndShot, sndBoom } from '../fx/audio.js';
import { fireProj, destroyVehicle, spawnDebris, blast } from '../combat/ballistics.js';
import { makeLabel, showDmg, flashVign, shakeAt } from '../ui/hud.js';
import { nextId } from './tank.js';
import { planeDecals } from './paint.js';
// =====================================================================
// Aeronaves: modelo, dinâmica de voo 6DOF, instrutor de mira, armas, dano
// Eixos do corpo: +z nariz, +y para cima, +x asa esquerda
// =====================================================================
export function buildPlane(D) {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: D.color, roughness: .6, metalness: .25 });
  const under = new THREE.MeshStandardMaterial({ color: D.key === 'il2' ? 0x6f8aa0 : D.key === 'fw190' ? 0x8e979b : 0x8d8c80, roughness: .6, metalness: .2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: .5, metalness: .4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2b3a44, roughness: .1, metalness: .6, transparent: true, opacity: .85 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: .7 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: .7 });
  const add = (g, m, p = root, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; };
  const L = D.L, fr = D.fuseR;
  // fuselagem por revolução
  const prof = [];
  const zs = [-0.55, -0.48, -0.3, -0.1, 0.1, 0.28, 0.4, 0.45];
  const rs = [0.08, 0.2, 0.55, 0.9, 1.0, 1.0 * D.noseR / fr, D.noseR / fr * 0.95, D.noseR / fr * 0.6];
  zs.forEach((z, i) => prof.push(new THREE.Vector2(rs[i] * fr, z * L)));
  const fg = new THREE.LatheGeometry(prof, 18); fg.rotateX(Math.PI / 2);
  fg.scale(1, D.key === 'il2' ? 1.05 : 1.12, 1);
  const fuse = add(fg, paint);
  add(new THREE.ConeGeometry(fr * .38, .6, 12).rotateX(Math.PI / 2), dark, root, 0, 0, L * 0.45 + .3);
  if (D.cowl === 'radial') { const c = add(new THREE.TorusGeometry(D.noseR * 0.92, 0.08, 6, 20), dark, root, 0, 0, L * 0.42); }
  // cabine
  const can = add(new THREE.SphereGeometry(0.55, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, root, 0, fr * 0.95, D.key === 'il2' ? L * 0.08 : -L * 0.02);
  can.scale.set(0.95, 0.9, 2.1);
  // asas trapezoidais (malhas separadas para poder perdê-las)
  const wing = (side) => {
    const s = new THREE.Shape(), half = D.span / 2, c0 = D.chord, c1 = D.tipChord;
    s.moveTo(fr * 0.6, c0 * 0.35); s.lineTo(half, c1 * 0.3); s.lineTo(half, -c1 * 0.7); s.lineTo(fr * 0.6, -c0 * 0.65); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
    g.rotateX(Math.PI / 2); g.translate(0, 0.08, D.wingZ);
    if (side < 0) g.scale(-1, 1, 1);
    const grp = new THREE.Group(); root.add(grp);
    const m = add(g, paint, grp); m.rotation.z = side * 0.06; // diedro
    if (D.stripes) for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.32, 0.04, c0 * 0.92), i % 2 ? black : white, grp, side * (fr + 1.0 + i * 0.32), -0.06, D.wingZ - c0 * 0.15);
    return grp;
  };
  const wingL = wing(1), wingR = wing(-1);
  // cauda
  const tail = new THREE.Group(); root.add(tail);
  add(new THREE.BoxGeometry(D.span * 0.36, 0.08, 1.3), paint, tail, 0, 0.1, -L * 0.48);
  const fin = add(new THREE.BoxGeometry(0.1, 1.6, 1.4), paint, tail, 0, 0.9, -L * 0.49); fin.rotation.x = -0.25;
  // hélice
  const prop = new THREE.Group(); prop.position.set(0, 0, L * 0.45 + 0.35); root.add(prop);
  const nb = D.key === 'p47' ? 4 : 3;
  for (let i = 0; i < nb; i++) { const b = add(new THREE.BoxGeometry(0.22, 1.85, 0.05), dark, prop, 0, 0, 0); b.geometry.translate(0, 0.95, 0); b.rotation.z = i / nb * Math.PI * 2; }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.95, 24), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  prop.add(disc);
  // pontos duros: bombas
  const bombMeshes = [];
  for (const b of D.bombs) for (let i = 0; i < b.n; i++) {
    const m = add(new THREE.CylinderGeometry(b.d / 2, b.d / 2, b.d * 4.5, 10).rotateX(Math.PI / 2), dark, root, b.x[i] || 0, -fr - b.d / 2 - .05, D.wingZ - .2);
    bombMeshes.push(m);
  }
  const rocketMeshes = [];
  if (D.rockets) for (let i = 0; i < D.rockets.n; i++) {
    const side = i % 2 ? -1 : 1, k = Math.floor(i / 2);
    rocketMeshes.push(add(new THREE.CylinderGeometry(.06, .06, 1.4, 6).rotateX(Math.PI / 2), dark, root, side * (D.span * 0.22 + k * 0.45), -.25, D.wingZ + .2));
  }
  planeDecals(D, root, wingL, wingR);
  root.traverse(o => { if (o.isMesh) o.userData.normalMat = o.material; });
  return { root, wingL, wingR, tail, prop, bombMeshes, rocketMeshes, mats: [paint, under] };
}

export const _pf = new V3(), _pt = new V3();
const _pm = new THREE.Matrix4(), _pfx = new V3(), _pu = new V3(), _pl = new V3(), _pv = new V3(), _pF = new V3(), _pw = new V3(), _pq = new QUAT();
export class Plane {
  constructor(key, team, who, pos, yaw, speed) {
    this.id = nextId(); this.def = PLANES[key]; const D = this.def;
    this.type = 'plane'; this.team = team; this.who = who; this.name = who ? who.name : D.name; this.isPlayer = !!(who && who.isPlayer);
    Object.assign(this, buildPlane(D)); scene.add(this.root);
    this.pos = pos.clone(); this.q = new QUAT().setFromAxisAngle(UP, yaw);
    this.vel = new V3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(speed);
    this.pr = 0; this.rr = 0; this.yr = 0; // arfagem (nariz para cima +), rolagem (direita +), guinada (esquerda +)
    this.elev = 0; this.ail = 0; this.rud = 0; this.throttle = 1; this.wep = false;
    this.flaps = 0; this.airbrake = false; this.iP = 0;
    this.hp = Object.assign({}, D.hpParts); this.maxHp = D.hpParts;
    this.wingOn = { L: true, R: true }; this.tailOn = true; this.engineOn = true; this.pilot = true;
    this.alive = true; this.gone = false; this.fire = 0; this.temp = 80; this.oil = 0; this.lastHitBy = null; this.lastHitT = -99;
    this.gStress = 0; this.overG = 0; this.n = 1; this.alpha = 0; this.ias = speed; this.dropSign = 1; this.spottedUntil = 0; this.oobT = 0;
    this.firing = false; this.guns = [];
    for (const g of D.guns) {
      const W = GUNS[g.w], pts = [];
      for (const s of g.span) { pts.push([s, -0.1, g.z]); if (g.n > 1) pts.push([-s, -0.1, g.z]); }
      while (pts.length < g.n) pts.push(...pts.slice(0, g.n - pts.length));
      this.guns.push({ W, pts: pts.slice(0, g.n), ammo: g.ammo * g.n, max: g.ammo * g.n, acc: 0, k: 0 });
    }
    this.bombs = []; for (const b of D.bombs) for (let i = 0; i < b.n; i++) this.bombs.push(b);
    this.rockets = D.rockets ? D.rockets.n : 0;
    this.inv = new THREE.Matrix4();
    const fr = D.fuseR, L = D.L;
    this.boxes = [
      { name: 'fuse', mn: [-fr, -fr, -L * .55], mx: [fr, fr + .35, L * .45] },
      { name: 'wingL', mn: [fr, -.2, D.wingZ - D.chord * .65], mx: [D.span / 2, .3, D.wingZ + D.chord * .35] },
      { name: 'wingR', mn: [-D.span / 2, -.2, D.wingZ - D.chord * .65], mx: [-fr, .3, D.wingZ + D.chord * .35] },
      { name: 'tail', mn: [-D.span * .18, -.1, -L * .55], mx: [D.span * .18, .2, -L * .42] },
      { name: 'fin', mn: [-.1, 0, -L * .56], mx: [.1, 1.8, -L * .42] }];
    this.label = makeLabel(this);
    this.applyTransform();
    planes.push(this);
  }
  axes() { _pm.makeRotationFromQuaternion(this.q); _pl.setFromMatrixColumn(_pm, 0); _pu.setFromMatrixColumn(_pm, 1); _pf.setFromMatrixColumn(_pm, 2); }
  centerPos(out) { return out.copy(this.pos); }
  eyePos(out) { return out.copy(this.pos); }
  applyTransform() {
    this.root.position.copy(this.pos); this.root.quaternion.copy(this.q);
    this.root.updateMatrixWorld(true); this.inv.copy(this.root.matrixWorld).invert();
  }
  physics(dt) {
    if (this.gone) return;
    const D = this.def, n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    const S = D.S, b = D.span, c = S / b, AR = b * b / S, m = D.mass + this.bombs.reduce((s, x) => s + x.m, 0) + this.rockets * (D.rockets ? D.rockets.m : 0);
    const Ip = m * Math.pow(D.L * 0.27, 2), Ir = m * Math.pow(b * 0.2, 2), Iy = Ip * 1.25;
    const as = D.clmax / D.cla;
    for (let s = 0; s < n; s++) {
      this.axes();
      const V = this.vel.length() + 1e-6;
      _pv.copy(this.vel).divideScalar(V);
      const rho = RHO * Math.exp(-Math.max(0, this.pos.y) / 8500);
      const qd = 0.5 * rho * V * V;
      this.ias = Math.sqrt(2 * qd / RHO);
      const vf = this.vel.dot(_pf), vu = this.vel.dot(_pu), vl = this.vel.dot(_pl);
      const alpha = Math.atan2(-vu, vf), beta = Math.asin(clamp(vl / V, -1, 1));
      this.alpha = alpha;
      let CL, CDs = 0;
      const aa = Math.abs(alpha);
      if (aa <= as) CL = D.cla * alpha;
      else { CL = Math.sign(alpha) * D.clmax * Math.max(0.42, 1 - (aa - as) * 2.2); CDs = 1.1 * Math.pow(Math.sin(aa), 2); }
      if (aa > Math.PI / 2) CL = -CL * 0.3;
      const hpL = this.wingOn.L ? 0.6 + 0.4 * this.hp.wingL / this.maxHp.wingL : 0, hpR = this.wingOn.R ? 0.6 + 0.4 * this.hp.wingR / this.maxHp.wingR : 0;
      const kW = (hpL + hpR) / 2;
      const mach = V / 340;
      CL += this.flaps * 0.38 * (aa <= as ? 1 : 0.5);
      const CD = D.cd0 + CL * CL / (Math.PI * D.e * AR) + CDs + this.flaps * 0.028 + (this.airbrake ? 0.06 : 0) + this.bombs.length * 0.0012 + this.rockets * 0.0004 + (mach > 0.68 ? 2.5 * Math.pow(mach - 0.68, 2) : 0) + (1 - kW) * 0.02 + (this.tailOn ? 0 : 0.01);
      // forças
      _pF.set(0, -m * G, 0);
      _pt.crossVectors(_pv, _pl); const ln = _pt.length();
      if (ln > 1e-4) _pF.addScaledVector(_pt.divideScalar(ln), qd * S * CL * kW);
      _pF.addScaledVector(_pv, -qd * S * CD);
      _pF.addScaledVector(_pl, -qd * S * 0.9 * beta);
      const alt = Math.max(0, this.pos.y), altF = alt < 2200 ? 1 : Math.exp(-(alt - 2200) / 9000);
      const P = this.engineOn ? (this.wep ? D.wep : D.hp) * 745.7 * this.throttle * altF : 0;
      _pF.addScaledVector(_pf, P * D.eta / Math.max(V, 28));
      this.vel.addScaledVector(_pF, h / m);
      this.pos.addScaledVector(this.vel, h);
      this.n = (qd * S * CL * kW) / (m * G);
      // momentos (coeficientes de estabilidade e controle; eficácia ∝ pressão dinâmica)
      const ctrl = (this.pilot ? 1 : 0) * clamp(1 - (this.ias - 215) / 75, 0.28, 1) * (this.gStress > 1 ? 0.3 : 1);
      const tE = this.tailOn ? 1 : 0.06, Vd = Math.max(V, 20);
      const aE = clamp(alpha, -0.5, 0.5);
      let Mp = qd * S * c * (D.kde * this.elev * ctrl * tE - 0.9 * aE * (this.tailOn ? 1 : 0.1)) - qd * S * c * c / (2 * Vd) * 24 * this.pr * (this.tailOn ? 1 : 0.15);
      let Mr = qd * S * b * D.kda * this.ail * ctrl * (this.wingOn.L && this.wingOn.R ? 1 : 0.5) - qd * S * b * b / (2 * Vd) * 0.45 * this.rr * Math.max(kW, 0.3);
      Mr += qd * S * CL * (hpL - hpR) / 2 * b * 0.22;           // assimetria de sustentação
      if (aa > as) Mr += qd * S * b * 0.02 * this.dropSign * Math.min(1, (aa - as) * 8); // queda de asa no estol
      Mr -= this.throttle * P / 140 * 0.5 / Math.max(1, V / 60);   // torque da hélice
      Mr += qd * S * b * 0.03 * beta;                             // efeito diedro
      let My = qd * S * b * (D.kdr * this.rud * ctrl * tE + 0.1 * beta * (this.tailOn ? 1 : 0.1)) - qd * S * b * b / (2 * Vd) * 0.18 * this.yr;
      this.pr += Mp / Ip * h; this.rr += Mr / Ir * h; this.yr += My / Iy * h;
      _pw.set(-this.pr, this.yr, this.rr).applyQuaternion(this.q);
      _pq.set(_pw.x * h * 0.5, _pw.y * h * 0.5, _pw.z * h * 0.5, 0).multiply(this.q);
      this.q.x += _pq.x; this.q.y += _pq.y; this.q.z += _pq.z; this.q.w += _pq.w; this.q.normalize();
    }
    if (Math.random() < dt * 0.3) this.dropSign = Math.random() < .5 ? 1 : -1;
    // fisiologia do piloto: blecaute com G sustentado
    const gx = this.n > 6.5 ? (this.n - 6.5) * 0.35 : this.n < -2.5 ? (-2.5 - this.n) * 0.5 : -0.5;
    this.gStress = clamp(this.gStress + gx * dt, 0, 1.6);
    // limites estruturais
    if (this.alive) {
      if (Math.abs(this.n) > this.def.glim) this.overG += dt; else this.overG = 0;
      if (this.overG > 0.12) this.breakWing(Math.random() < .5 ? 'L' : 'R', 'g');
      if (this.ias > this.def.vne * 1.07) { this.overG += dt * 2; if (this.overG > 0.4) this.breakWing('L', 'vne'); }
    }
    // temperatura do motor
    const tgt = 75 + 45 * this.throttle + (this.wep ? 40 : 0) - clamp(this.ias / 140, 0, 1.4) * 22 + (this.oil > 0 ? 50 : 0);
    this.temp += (tgt - this.temp) * dt * 0.06;
    if (this.temp > 118 && this.engineOn) { this.hp.engine -= dt * 0.8; if (this.hp.engine <= 0) this.engineStop(); }
    if (this.fire > 0) {
      this.fire += dt;
      if (Math.random() < dt * 30) fxBurn(this.pos.clone().addScaledVector(_pf.set(0, 0, 1).applyQuaternion(this.q), 1), 1.2);
      if (this.fire > 22 && this.alive) destroyVehicle(this, this.lastHitBy, 'fire');
    } else if (this.hp.engine < this.maxHp.engine * 0.5 || this.oil > 0) {
      if (Math.random() < dt * 14) fxTrail(this.pos.clone(), this.oil > 0 ? 0x2a2622 : 0x9a968c, 1, 3);
    }
    this.prop.rotation.z += (this.engineOn ? 60 : Math.min(this.ias / 4, 20)) * dt;
    this.prop.children[this.prop.children.length - 1].visible = this.engineOn;
    // colisão com o solo
    this.axes();
    const pts = [[0, 0, this.def.L * .45], [this.def.span / 2 * (this.wingOn.L ? 1 : .2), 0, 0], [-this.def.span / 2 * (this.wingOn.R ? 1 : .2), 0, 0], [0, 0, -this.def.L * .5], [0, -this.def.fuseR, 0]];
    for (const [x, y, z] of pts) {
      const wx = this.pos.x + _pl.x * x + _pu.x * y + _pf.x * z, wy = this.pos.y + _pl.y * x + _pu.y * y + _pf.y * z, wz = this.pos.z + _pl.z * x + _pu.z * y + _pf.z * z;
      if (wy < H(wx, wz) + 0.2) { this.crash(); return; }
    }
    for (const b of obstNear(this.pos.x - 6, this.pos.z - 6, this.pos.x + 6, this.pos.z + 6)) if (this.pos.x > b.mn[0] && this.pos.x < b.mx[0] && this.pos.z > b.mn[2] && this.pos.z < b.mx[2] && this.pos.y < b.mx[1]) { this.crash(); return; }
    if (Math.max(Math.abs(this.pos.x), Math.abs(this.pos.z)) > AIRLIMIT) this.oobT += dt; else this.oobT = 0;
    if (this.oobT > 15 && this.alive) destroyVehicle(this, null, 'oob');
  }
  // Instrutor (estilo "mouse aim" do WT): leva o VETOR VELOCIDADE à direção pedida.
  // Limites de AoA (sem estol) e de G; proteção opcional perto do solo.
  steerTo(dir, dt, opts = {}) {
    if (!this.pilot) { this.elev = this.ail = this.rud = 0; return; }
    this.axes();
    const D = this.def;
    const dl = dir.dot(_pl), du = dir.dot(_pu), df = dir.dot(_pf);
    const off = Math.acos(clamp(df, -1, 1));
    // arfagem: erro do vetor velocidade (nariz + AoA) com termo integral pequeno contra erro estacionário
    const pe = Math.atan2(du, Math.max(df, 0.05)) + this.alpha * 0.9;
    this.iP = clamp(this.iP + pe * dt * (off < 0.3 ? 1 : 0), -0.3, 0.3) * (off < 0.3 ? 1 : 0.95);
    const trim = 0.9 * clamp(this.alpha, -0.5, 0.5) / D.kde;
    let elev = off > 1.4 && du < 0 ? 1 : 3.2 * pe + trim - 0.9 * this.pr;
    // rolagem: inclina para colocar o alvo no plano de sustentação; perto do nariz, nivela as asas
    const bank = Math.atan2(-dl, du);
    const wl = UP.dot(_pl), wu = UP.dot(_pu), level = Math.atan2(-wl, wu);
    const w = clamp((off - 0.06) / 0.2, 0, 1);
    const rollErr = lerp(level * 0.6, bank, w);
    this.ail = clamp(2.6 * rollErr - 0.55 * this.rr, -1, 1);
    // leme: corrige pequenos desvios e anula a derrapagem
    const yawErr = Math.atan2(dl, Math.max(df, 0.05));
    this.rud = clamp(1.8 * yawErr * (1 - w * 0.7) - 0.5 * this.yr, -1, 1);
    const as = D.clmax / D.cla, aLim = as * (0.86 + this.flaps * 0.08);
    elev = Math.min(elev, 0.9 * aLim / D.kde + (aLim - this.alpha) * 7);                  // sem estol
    elev = Math.min(elev, ((opts.glim || 8.5) - this.n) * 0.6 + 0.25);                    // limite de G
    elev = Math.max(elev, -0.9 * as * 0.6 / D.kde + (-as * 0.6 - this.alpha) * 7);
    // proteção perto do solo (assistência arcade): não deixa mergulhar abaixo de ~60 m sem querer
    if (opts.groundAssist) {
      const agl = this.pos.y - H(this.pos.x, this.pos.z), sink = -this.vel.y;
      if (agl < 40 + sink * 2.2 && _pf.y < 0.1) elev = Math.max(elev, 0.6);
    }
    this.elev = clamp(elev, -1, 1);
  }
  gunsPos(g, i, out) { const p = g.pts[i]; return out.set(p[0], p[1], p[2]).applyMatrix4(this.root.matrixWorld); }
  updateWeapons(dt) {
    if (!this.alive || !this.pilot) return;
    for (const g of this.guns) {
      if (!this.firing || g.ammo <= 0) { g.acc = Math.min(g.acc, 1); continue; }
      g.acc += dt * g.W.rpm / 60 * g.pts.length;
      while (g.acc >= 1 && g.ammo > 0) {
        g.acc -= 1; g.ammo--; g.k++;
        const i = g.k % g.pts.length, lp = g.pts[i];
        const pos = this.gunsPos(g, i, new V3());
        // convergência a 350 m
        const aim = new V3(0, 0, 350).applyMatrix4(this.root.matrixWorld);
        const dir = aim.sub(pos).normalize().add(rv(0.0022)).normalize();
        fireProj(this, pos, dir.multiplyScalar(g.W.v).add(this.vel), g.W, 'bullet', { tracer: g.k % g.W.tracer === 0 });
        if (g.k % 3 === 0) fxSmallFlash(pos, _pf.set(0, 0, 1).applyQuaternion(this.q));
        sndMG(pos, g.W.cal);
      }
    }
  }
  dropBomb() {
    if (!this.bombs.length || !this.alive) return false;
    const b = this.bombs.pop(), mesh = this.bombMeshes[this.bombs.length];
    const pos = mesh ? mesh.getWorldPosition(new V3()) : this.pos.clone();
    if (mesh) mesh.visible = false;
    fireProj(this, pos, this.vel.clone().add(rv(0.3)), b, 'bomb');
    return true;
  }
  fireRocket() {
    if (this.rockets <= 0 || !this.alive) return false;
    this.rockets--;
    const mesh = this.rocketMeshes[this.rockets]; const pos = mesh ? mesh.getWorldPosition(new V3()) : this.pos.clone();
    if (mesh) mesh.visible = false;
    const am = this.def.rockets, dir = new V3(0, 0, 1).applyQuaternion(this.q).add(rv(0.006)).normalize();
    fireProj(this, pos, dir.multiplyScalar(am.v * 0.45).add(this.vel), am, 'rocket');
    sndShot(pos, 30);
    return true;
  }
  engineStop() { this.engineOn = false; this.hp.engine = 0; if (this.isPlayer) showDmg('Motor parou'); }
  damage(part, dmg, by, isBlast, penetrated = true) {
    if (this.gone || !isFinite(dmg)) return;
    if (by && by.team !== this.team) { this.lastHitBy = by; this.lastHitT = S.now; }
    if (part === 'pilot') {
      if (penetrated && Math.random() < 0.3 * Math.min(1.5, dmg)) { this.pilot = false; if (this.alive) destroyVehicle(this, by, 'pilot'); }
      else part = 'fuse';
    }
    if (part === 'pilot') return;
    this.hp[part] -= dmg;
    if (part === 'engine') { if (Math.random() < 0.05 * dmg) this.oil = 1; if (Math.random() < 0.035 * dmg) this.fire = Math.max(this.fire, 0.01); if (this.hp.engine <= 0 && this.engineOn) this.engineStop(); }
    if (part === 'fuel' && Math.random() < 0.06 * dmg) { this.fire = Math.max(this.fire, 0.01); if (this.isPlayer) showDmg('Incêndio no tanque de combustível'); }
    if ((part === 'wingL' || part === 'wingR') && this.hp[part] <= 0) this.breakWing(part === 'wingL' ? 'L' : 'R', 'wing');
    if (part === 'tail' && this.hp.tail <= 0 && this.tailOn) { this.tailOn = false; this.tail.visible = false; this.boxes[3].off = this.boxes[4].off = true; if (this.alive) destroyVehicle(this, by || this.lastHitBy, 'tail'); }
    if (part === 'fuse' && this.hp.fuse <= 0 && this.alive) destroyVehicle(this, by || this.lastHitBy, 'structure');
    if (this.isPlayer && !isBlast && Math.random() < .4) { flashVign(); }
  }
  breakWing(side, why) {
    if (!this.wingOn[side]) return;
    this.wingOn[side] = false;
    const w = side === 'L' ? this.wingL : this.wingR;
    scene.attach(w); spawnDebris(w, this.vel.clone().add(rv(6)), rv(4), [this.def.span / 4, 0.12, this.def.chord / 2], [(side === 'L' ? 1 : -1) * this.def.span / 4, 0.08, this.def.wingZ], 180);
    this.boxes[side === 'L' ? 1 : 2].off = true;
    fxExplosion(this.pos.clone(), .4);
    if (this.alive) destroyVehicle(this, this.lastHitT > S.now - 10 ? this.lastHitBy : null, why === 'g' ? 'overg' : why === 'vne' ? 'vne' : 'wing');
  }
  onDestroyed(cause) { this.firing = false; if (cause === 'pilot') { this.throttle = 0; } }
  crash() {
    if (this.gone) return;
    if (this.alive) destroyVehicle(this, this.lastHitT > S.now - 15 ? this.lastHitBy : null, 'crash');
    this.gone = true;
    fxBigBlast(this.pos.clone(), 1); sndBoom(this.pos, true); addCrater(this.pos, 4); shakeAt(this.pos, 1, 60);
    this.root.visible = false; this.burnAt = this.pos.clone(); this.burnT = 25;
    if (this.bombs.length) blast(this.pos.clone(), this.bombs.reduce((s, b) => s + b.tnt, 0) * 0.5, this.lastHitBy, { skipPlane: this });
  }
  remove() { scene.remove(this.root); this.label.remove(); const i = planes.indexOf(this); if (i >= 0) planes.splice(i, 1); }
}
