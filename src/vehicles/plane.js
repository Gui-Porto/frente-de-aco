import * as THREE from 'three';
import { scene } from '../core/render.js';
import { S, S as ST, planes } from '../core/state.js'; // ST: em physics() `S` é a área da asa
import { V3, QUAT, UP, clamp, lerp, rand, rv } from '../core/util.js';
import { H, AIRLIMIT } from '../world/terrain.js';
import { obstNear, addCrater } from '../world/scenery.js';
import { PLANES, GUNS, MISSILES, RHO, G } from '../data/vehicles.js';
import { EngineSet, ENGINES } from '../air/systems/engine.js';
import { isa } from '../air/systems/atmosphere.js';
import { Radar } from '../air/systems/radar.js';
import { Rwr, Maw } from '../air/systems/rwr.js';
import { fxBurn, fxTrail, fxSmallFlash, fxExplosion, fxBigBlast } from '../fx/particles.js';
import { sndMG, sndShot, sndBoom } from '../fx/audio.js';
import { fireProj, destroyVehicle, spawnDebris, blast } from '../combat/ballistics.js';
import { makeLabel, showDmg, flashVign, shakeAt } from '../ui/hud.js';
import { nextId } from './tank.js';
import { buildPlane } from './planeModel.js';
import { stepHeat } from './engineHeat.js';
import { planeModules, fuelOf, ctrlAuthority, fuelLeak, fuelInit, fuelStep, applyMod, powered, modsOf } from './planeDamage.js';
export { buildPlane };
// =====================================================================
// Aeronaves: dinâmica de voo 6DOF, instrutor de mira, armas, dano.
// O modelo 3D fica em planeModel.js.
// Eixos do corpo: +z nariz, +y para cima, +x asa esquerda
// =====================================================================
// recuo da ponta da asa pelo enflechamento (m)
export const sweepOf = D => (D.span / 2 - D.fuseR * 0.6) * Math.tan((D.sweep || 0) * Math.PI / 180);

export const _pf = new V3(), _pt = new V3();
// limites de flap (km/h) por estágio; cada avião pode trazer os seus em def.flapV
const FLAP_POS = [0, 0.33, 0.66, 1], FLAP_V = [480, 360, 290], FLAP_NAME = ['Recolhidos', 'Combate', 'Decolagem', 'Pouso'];
// amortecimento aerodinâmico padrão [arfagem, rolagem, guinada]; def.damp sobrescreve
const DAMP = [24, 0.45, 0.18], _atm = {}, _pd = new THREE.Vector3(), _pdl = new THREE.Vector3();
// arrasto de onda: jatos subsônicos (sem def.wave) crescem sem parar além do Mach crítico;
// supersônicos têm pico transônico e depois cedem um pouco
const waveDrag = (D, M) => {
  const w = D.wave;
  if (!w) { const mcr = D.mcrit || 0.68; return M > mcr ? 2.5 * (M - mcr) ** 2 : 0; }
  if (M <= w.mcr) return 0;
  return M < w.mpk ? w.peak * ((M - w.mcr) / (w.mpk - w.mcr)) ** 2 : w.peak * Math.max(0.6, 1 - 0.35 * (M - w.mpk));
};
const flapLim = (D, st) => st ? (D.flapV || FLAP_V)[st - 1] / 3.6 : Infinity;
const _pm = new THREE.Matrix4(), _pfx = new V3(), _pu = new V3(), _pl = new V3(), _pv = new V3(), _pF = new V3(), _pw = new V3(), _pq = new QUAT();
export class Plane {
  constructor(key, team, who, pos, yaw, speed, opts = {}) {
    this.id = nextId(); this.def = PLANES[key]; const D = this.def;
    this.type = 'plane'; this.team = team; this.who = who; this.name = who ? who.name : D.name; this.isPlayer = !!(who && who.isPlayer);
    Object.assign(this, buildPlane(D)); scene.add(this.root);
    this.pos = pos.clone(); this.q = new QUAT().setFromAxisAngle(UP, yaw);
    this.vel = new V3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(speed);
    this.pr = 0; this.rr = 0; this.yr = 0; // arfagem (nariz para cima +), rolagem (direita +), guinada (esquerda +)
    this.elev = 0; this.ail = 0; this.rud = 0; this.throttle = 1; this.wep = false;
    this.flaps = 0; this.flapStage = 0; this.airbrake = false; this.iP = 0; this.gear = 0; this.shotsN = 0; this.hitsN = 0;
    this.hp = Object.assign({}, D.hpParts); this.maxHp = D.hpParts;
    this.wingOn = { L: true, R: true }; this.tailOn = true; this.engineOn = true; this.pilot = true;
    this.alive = true; this.gone = false; this.fire = 0; this.temp = 80; this.heat = { water: 85, oil: 70 }; this.eng = new EngineSet(D.engine, D.engines); this.cooling = ENGINES[D.engine].cooling || 'jet'; this.oil = 0; this.lastHitBy = null; this.lastHitT = -99;
    this.gStress = 0; this.overG = 0; this.n = 1; this.alpha = 0; this.ias = speed; this.dropSign = 1; this.spottedUntil = 0; this.oobT = 0;
    this.firing = false; this.guns = [];
    for (const g of D.guns) {
      const W = GUNS[g.w], pts = [];
      for (const s of g.span) { pts.push([s, -0.1, g.z]); if (g.n > 1) pts.push([-s, -0.1, g.z]); }
      while (pts.length < g.n) pts.push(...pts.slice(0, g.n - pts.length));
      this.guns.push({ W, pts: pts.slice(0, g.n), ammo: g.ammo * g.n, max: g.ammo * g.n, acc: 0, k: 0, heat: 0, jam: false });
    }
    this.bombs = []; this.rockets = 0;
    if (opts.ord !== false) { for (const b of D.bombs) for (let i = 0; i < b.n; i++) this.bombs.push(b); this.rockets = D.rockets ? D.rockets.n : 0; }
    else for (const m of [...this.bombMeshes, ...this.rocketMeshes]) m.visible = false;
    // estantes de mísseis (uma por tipo) e o selecionado; malhas na mesma ordem do modelo
    let mi = 0;
    this.racks = (D.missiles || []).map(r => ({ w: r.w, M: MISSILES[r.w], n: r.n, max: r.n, meshes: this.missileMeshes.slice(mi, mi += r.n) }));
    this.sel = 0;
    // aviônicos: só existe o que a ficha da aeronave traz
    this.sys = {};
    if (D.radar) this.sys.radar = new Radar(D.radar, H);
    if (D.rwr) this.sys.rwr = new Rwr(D.rwr);
    if (D.maw) this.sys.maw = new Maw(D.maw);
    // componentes internos, combustível, contramedidas e extintor
    this.mods = planeModules(D); this.fuel = this.fuelMax = fuelOf(D); fuelInit(this, this.fuelMax); this.wounded = false;
    // cada motor com a própria integridade (o F-4 volta com um só); hp.engine = média, para HUD/fumaça
    this.engs = Array.from({ length: D.engines || 1 }, (_, i) => ({ hp: D.hpParts.engine, on: true, x: this.mods['eng' + i] ? this.mods['eng' + i].c[0] : 0 }));
    this.flapP = { L: 0, R: 0 }; this.flapGone = { L: false, R: false }; this.brakeOn = false;
    this.flares = this.chaff = D.jet ? 20 : 0; this.ext = 1; this.fireAt = [0, 0, D.jet ? -D.L * 0.15 : D.L * 0.3];
    this.flareUntil = 0; this.chaffUntil = 0;
    this.inv = new THREE.Matrix4();
    const fr = D.fuseR, L = D.L;
    this.boxes = [
      { name: 'fuse', mn: [-fr, -fr, -L * .55], mx: [fr, fr + .35, L * .45] },
      { name: 'wingL', mn: [fr, -.2, D.wingZ - D.chord * .65 - sweepOf(D)], mx: [D.span / 2, .3, D.wingZ + D.chord * .35] },
      { name: 'wingR', mn: [-D.span / 2, -.2, D.wingZ - D.chord * .65 - sweepOf(D)], mx: [-fr, .3, D.wingZ + D.chord * .35] },
      { name: 'tail', mn: [-D.span * .18, -.1, -L * .55], mx: [D.span * .18, .2, -L * .42] },
      { name: 'fin', mn: [-.1, 0, -L * .56], mx: [.1, 1.8, -L * .42] }];
    this.label = makeLabel(this);
    this.applyTransform();
    planes.push(this);
  }
  // fração de potência/empuxo entregue (HUD, som, temperatura): >1 com WEP/pós-combustão
  get spool() { return this.eng.output; }
  // WEP (pistão) ou pós-combustão (jato que tenha)
  get missiles() { let n = 0; for (const r of this.racks) n += r.n; return n; }
  // estante selecionada (pula para a próxima com míssil quando a atual esvazia)
  get rack() { const R = this.racks; if (!R.length) return null; if (R[this.sel].n <= 0) { const i = R.findIndex(r => r.n > 0); if (i >= 0) this.sel = i; } return R[this.sel]; }
  cycleRack() { const R = this.racks; for (let k = 1; k <= R.length; k++) { const i = (this.sel + k) % R.length; if (R[i].n > 0) { this.sel = i; break; } } return this.rack; }
  get canBoost() { return !this.eng.jet || this.eng.hasAB; }
  axes() { _pm.makeRotationFromQuaternion(this.q); _pl.setFromMatrixColumn(_pm, 0); _pu.setFromMatrixColumn(_pm, 1); _pf.setFromMatrixColumn(_pm, 2); }
  centerPos(out) { return out.copy(this.pos); }
  eyePos(out) { return out.copy(this.pos); }
  applyTransform() {
    this.root.position.copy(this.pos); this.root.quaternion.copy(this.q);
    this.animSurfaces();
    this.root.updateMatrixWorld(true); this.inv.copy(this.root.matrixWorld).invert();
  }
  physics(dt) {
    if (this.gone) return;
    const D = this.def, n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    const S = D.S, b = D.span, c = S / b, AR = b * b / S, m = D.mass + this.bombs.reduce((s, x) => s + x.m, 0) + this.rockets * (D.rockets ? D.rockets.m : 0) + this.racks.reduce((s, r) => s + r.n * r.M.mass, 0) - (this.fuelMax - this.fuel);
    const A = ctrlAuthority(this);
    // flaps e freio dependem do sistema que os move (hidráulico, pneumático ou elétrico, conforme o avião): sem ele, travam onde estão
    const flapsOK = powered(this, 'flaps');
    if (powered(this, 'brake')) this.brakeOn = this.airbrake;
    // flaps por estágio (como no WT): acima do limite do estágio eles sobem um degrau sozinhos; o painel se move devagar
    if (flapsOK && this.flapStage && this.ias > flapLim(D, this.flapStage)) { this.flapStage--; if (this.isPlayer) showDmg(`Flaps: ${FLAP_NAME[this.flapStage]} · velocidade alta`, true); }
    for (const sd of ['L', 'R']) {
      const m = this.mods['flap' + sd];
      if (flapsOK && !m.dead && !this.flapGone[sd]) this.flapP[sd] += clamp(FLAP_POS[this.flapStage] - this.flapP[sd], -dt * 0.5, dt * 0.5);
      // flap travado baixado acima do limite: o vento arranca o painel
      if (!this.flapGone[sd] && this.flapP[sd] > 0.1 && this.ias > flapLim(D, Math.max(1, Math.round(this.flapP[sd] * 3))) * 1.15) {
        this.flapGone[sd] = true; this.flapP[sd] = 0; m.dead = true; m.hp = -m.max;
        if (this.isPlayer) showDmg(`${m.label} arrancado pelo vento`);
      }
    }
    this.flaps = (this.flapP.L + this.flapP.R) / 2;
    // motor danificado rende menos; dinâmica de rotação/potência fica em EngineSet
    const ek = this.engs.map(e => (e.on ? 0.35 + 0.65 * clamp(e.hp / this.maxHp.engine, 0, 1) : 0)), ekSum = ek.reduce((a, b) => a + b, 0);
    const engK = ekSum / ek.length, thrX = ekSum > 0 ? this.engs.reduce((a, e, i) => a + e.x * ek[i], 0) / ekSum : 0;
    if (this.mods.turbo) this.eng.altCrit = this.mods.turbo.dead ? 1200 : undefined;
    // superfície travada pelo dano fica na deflexão em que estava (m.stuck)
    const st = n => (this.mods[n].dead ? this.mods[n].stuck || 0 : 0);
    const I = D.inertia, Ip = I ? I[0] * m / D.mass : m * Math.pow(D.L * 0.27, 2), Ir = I ? I[1] * m / D.mass : m * Math.pow(b * 0.2, 2), Iy = I ? I[2] * m / D.mass : Ip * 1.25;
    const dmp = D.damp || DAMP;
    const as = D.clmax / D.cla;
    for (let s = 0; s < n; s++) {
      this.axes();
      const V = this.vel.length() + 1e-6;
      _pv.copy(this.vel).divideScalar(V);
      isa(this.pos.y, _atm); _atm.alt = Math.max(0, this.pos.y);
      const rho = _atm.rho;
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
      const mach = V / _atm.a; this.mach = mach;
      CL += this.flaps * 0.38 * (aa <= as ? 1 : 0.5);
      const CD = D.cd0 + CL * CL / (Math.PI * D.e * AR) + CDs + this.flaps * 0.028 + (this.brakeOn ? 0.06 : 0) + this.gear * 0.035 + this.bombs.length * 0.0012 + this.rockets * 0.0004 + this.missiles * 0.0008 + waveDrag(D, mach) + (1 - kW) * 0.02 + (this.tailOn ? 0 : 0.01);
      // forças
      _pF.set(0, -m * G, 0);
      _pt.crossVectors(_pv, _pl); const ln = _pt.length();
      if (ln > 1e-4) _pF.addScaledVector(_pt.divideScalar(ln), qd * S * CL * kW);
      _pF.addScaledVector(_pv, -qd * S * CD);
      _pF.addScaledVector(_pl, -qd * S * 0.9 * beta);
      this.eng.step(h, this.throttle, this.wep, engK, this.engineOn);
      _pF.addScaledVector(_pf, this.eng.force(V, _atm, mach));
      this.vel.addScaledVector(_pF, h / m);
      this.pos.addScaledVector(this.vel, h);
      this.n = (qd * S * CL * kW) / (m * G);
      // momentos (coeficientes de estabilidade e controle; eficácia ∝ pressão dinâmica)
      const ctrl = (this.pilot ? 1 : 0) * clamp(1 - (this.ias - (D.vctrl || 215)) / 75, 0.28, 1) * (this.gStress > 1 ? 0.3 : 1);
      const tE = this.tailOn ? 0.45 + 0.55 * clamp(this.hp.tail / this.maxHp.tail, 0, 1) : 0.06, Vd = Math.max(V, 20);
      const aE = clamp(alpha, -0.5, 0.5);
      let Mp = qd * S * c * (D.kde * (this.elev * ctrl * A.elev + st('elev')) * tE -0.9 * aE * (this.tailOn ? 1 : 0.1)) - qd * S * c * c / (2 * Vd) * dmp[0] * this.pr * (this.tailOn ? 1 : 0.15);
      let Mr = qd * S * b * D.kda * (this.ail * A.ail + A.ailBias * 0.15) * ctrl * (this.wingOn.L && this.wingOn.R ? 1 : 0.5) - qd * S * b * b / (2 * Vd) * dmp[1] * this.rr * Math.max(kW, 0.3);
      Mr += qd * S * CL * (hpL - hpR) / 2 * b * 0.22;           // assimetria de sustentação
      Mr += qd * S * b * (0.03 * (this.flapP.L - this.flapP.R) + D.kda * 0.5 * (st('ailL') + st('ailR'))); // flap assimétrico / aileron travado
      if (aa > as) Mr += qd * S * b * 0.02 * this.dropSign * Math.min(1, (aa - as) * 8); // queda de asa no estol
      if (!this.eng.jet) Mr -= this.eng.shaft * (this.eng.E.torque || 1) / 280 / Math.max(1, V / 60); // torque da hélice
      Mr += qd * S * b * 0.03 * beta;                             // efeito diedro
      let My = -this.eng.thrust * thrX + qd * S * b * (D.kdr * (this.rud * ctrl * A.rud + st('rud')) * tE +0.1 * beta * (this.tailOn ? 1 : 0.1)) - qd * S * b * b / (2 * Vd) * dmp[2] * this.yr;
      this.pr += Mp / Ip * h; this.rr += Mr / Ir * h; this.yr += My / Iy * h;
      _pw.set(-this.pr, this.yr, this.rr).applyQuaternion(this.q);
      _pq.set(_pw.x * h * 0.5, _pw.y * h * 0.5, _pw.z * h * 0.5, 0).multiply(this.q);
      this.q.x += _pq.x; this.q.y += _pq.y; this.q.z += _pq.z; this.q.w += _pq.w; this.q.normalize();
    }
    if (Math.random() < dt * 0.3) this.dropSign = Math.random() < .5 ? 1 : -1;
    // fisiologia do piloto: blecaute com G sustentado
    const gT = this.wounded ? 5 : 6.5; // piloto ferido apaga antes
    const gx = this.n > gT ? (this.n - gT) * 0.35 : this.n < -2.5 ? (-2.5 - this.n) * 0.5 : -0.5;
    // combustível: consumo do motor + vazamentos; seco = motor apaga
    const leak = fuelLeak(this);
    fuelStep(this, this.engineOn ? this.eng.flow : 0, dt);
    if (this.fuel <= 0 && this.engineOn && this.alive) { this.engineStop(); if (this.isPlayer) showDmg('Sem combustível'); }
    if (leak > 0 && this.fuel > 0 && Math.random() < dt * 18) for (const m of modsOf(this, 'fuel')) if (m.leak > 0 && m.left > 0) fxTrail(_pt.set(...m.c).applyMatrix4(this.root.matrixWorld).clone(), 0xe8e6e0, 0.6, 1.6);
    this.gStress = clamp(this.gStress + gx * dt, 0, 1.6);
    // limites estruturais
    if (this.alive) {
      // asa quebrando por excesso de G só nos aviões a pistão; jato não quebra em curva (pedido do jogador)
      if (!this.eng.jet && Math.abs(this.n) > this.def.glim) this.overG += dt; else this.overG = 0;
      if (this.overG > 0.12) this.breakWing(Math.random() < .5 ? 'L' : 'R', 'g');
      if (this.ias > this.def.vne * 1.07) { this.overG += dt * 2; if (this.overG > 0.4) this.breakWing('L', 'vne'); }
    }
    // temperatura do motor
    // água → óleo → desgaste (engineHeat.js). Antes um só número chegava a 142 °C no WEP e o motor morria em ~30 s.
    const wear = stepHeat(this.heat, this.cooling, this.engineOn ? Math.min(1, this.spool) : 0, this.wep, this.ias, this.oil > 0, dt);
    this.temp = this.heat.oil;
    if (wear > 0 && this.engineOn) { this.engs.forEach((e, i) => { if (!e.on) return; e.hp -= wear * this.maxHp.engine; if (e.hp <= 0) { this.engineOut(i); if (this.isPlayer) showDmg('Motor fundido por superaquecimento'); } }); this.syncEng(); }
    if (this.fire > 0) {
      this.fire += dt;
      if (Math.random() < dt * 30) fxBurn(_pt.set(...this.fireAt).applyMatrix4(this.root.matrixWorld).clone(), 1.2);
      if (this.fire > 4 && Math.random() < dt * 0.08) { const w = this.fireAt[0] > 1 ? 'wingL' : this.fireAt[0] < -1 ? 'wingR' : 'fuse'; this.damage(w, 6, this.lastHitBy, true); } // o fogo consome a estrutura
      if (this.fire > 22 && this.alive) destroyVehicle(this, this.lastHitBy, 'fire');
    } else if (this.hp.engine < this.maxHp.engine * 0.5 || this.oil > 0) {
      if (Math.random() < dt * 14) fxTrail(this.pos.clone(), this.oil > 0 ? 0x5e5952 : 0xb8b4ac, 1, 3);
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
    if (Math.max(Math.abs(this.pos.x), Math.abs(this.pos.z)) > (ST.airLimit || AIRLIMIT)) this.oobT += dt; else this.oobT = 0;
    if (this.oobT > 15 && this.alive) destroyVehicle(this, null, 'oob');
  }
  // Instrutor (estilo "mouse aim" do WT): leva o VETOR VELOCIDADE à direção pedida.
  // Limites de AoA (sem estol) e de G; proteção opcional perto do solo.
  steerTo(dir, dt, opts = {}) {
    if (!this.pilot) { this.elev = this.ail = this.rud = 0; return; }
    this.axes();
    const D = this.def;
    // antecipação (opts.lead s): mira onde o círculo ESTARÁ — sem isso o nariz andava sempre atrás de um
    // mouse em movimento. Velocidade da mira filtrada e limitada (um puxão brusco não vira salto).
    if (opts.lead) {
      if (!this._aimPrev) { this._aimPrev = dir.clone(); this._aimVel = new V3(); }
      _pd.copy(dir).sub(this._aimPrev).divideScalar(Math.max(dt, 1e-3)); this._aimPrev.copy(dir);
      this._aimVel.lerp(_pd, 1 - Math.exp(-dt * 3.5));
      // só antecipa movimento intencional: abaixo de ~3°/s (tremor da mão) não há avanço; antes o tremor de ±0,5° virava ±3° de comando
      const sp = this._aimVel.length(), kL = clamp((sp - 0.05) / 0.12, 0, 1);
      _pd.copy(this._aimVel).multiplyScalar(opts.lead * kL); if (_pd.length() > 0.14) _pd.setLength(0.14);
      dir = _pdl.copy(dir).add(_pd).normalize();
    }
    const dl = dir.dot(_pl), du = dir.dot(_pu), df = dir.dot(_pf);
    const off = Math.acos(clamp(df, -1, 1));
    // arfagem: erro do vetor velocidade (nariz + AoA) com termo integral pequeno contra erro estacionário.
    // opts.nose (Batalha Aérea, como no WT): quem vai ao círculo do mouse é o NARIZ/linha das armas;
    // o integral segura o nariz no alvo apesar do ângulo de ataque. opts.gain deixa a resposta mais viva.
    const nose = !!opts.nose, K = opts.gain || 1;
    const pe = Math.atan2(du, Math.max(df, 0.05)) + this.alpha * (nose ? 0.25 : 0.9);
    this.iP = clamp(this.iP + pe * dt * (off < 0.3 ? 1 : 0), -0.3, 0.3) * (off < 0.3 ? 1 : 0.95);
    const trim = 0.9 * clamp(this.alpha, -0.5, 0.5) / D.kde;
    // rolagem: inclina para colocar o alvo no plano de sustentação; perto do nariz, nivela as asas.
    // PERTO da mira (até ~17°) a inclinação usa só o desvio LATERAL: atan2(−dl, |du|); "acima/abaixo" fica
    // com o profundor (pe). Antes, com o alvo poucos graus abaixo do nariz, atan2(−dl, du) pedia ±170° e o
    // sinal trocava cada vez que dl cruzava zero → o avião balançava (em subida, em curva, em tudo).
    // Em du = 0 as duas fórmulas coincidem (sem salto); longe, abaixo → rola de dorso e puxa, como antes.
    const NEAR = 0.3, wl = UP.dot(_pl), wu = UP.dot(_pu), level = Math.atan2(-wl, wu);
    if (this.nearAim) { if (off > NEAR * 1.5) this.nearAim = false; } else if (off < NEAR) this.nearAim = true;
    // perto da mira, o + 0.08 (~5°) deixa a inclinação proporcional ao desvio lateral: sem ele, dl e du quase zero
    // davam atan2 de ruído (±90°) e o jato balançava as asas com qualquer tremor da mira
    let bank = Math.atan2(-dl, this.nearAim ? Math.abs(du) + 0.08 : du);
    // e a inclinação fica limitada ao tamanho do erro: 8° ao lado pedia ~80° de asa e uma puxada que passava do alvo
    // e voltava (MiG-21/F-4 balançavam 40°↔84° depois de a mira parar)
    if (this.nearAim) { const lim = Math.PI / 2 * clamp(off / 0.3, 0.3, 1); bank = clamp(bank, -lim, lim); }
    const w = nose ? clamp((off - 0.035) / 0.14, 0, 1) : clamp((off - 0.06) / 0.2, 0, 1);
    const rollErr = lerp(level * 0.6, bank, w);
    // "rola, depois puxa": com muita rolagem pela frente o profundor espera (puxar/empurrar inclinado
    // jogava o nariz para o lado, criava erro lateral e o avião ficava rolando para lá e para cá)
    const rp = lerp(1, clamp(Math.cos(rollErr), 0.15, 1), w);
    let elev = off > 1.4 && du < 0 ? 1 : K * (3.2 * pe * rp - 0.9 * this.pr) + trim + (nose ? 1.2 * this.iP : 0);
    // amortecimento 2.0 (era 0.55): medido em curva contínua de 20°/s, a inclinação oscilava 35°↔120° com aileron batendo ±1
    this.ail = clamp(K * (2.6 * rollErr - 2.0 * this.rr), -1, 1);
    // leme: corrige pequenos desvios e anula a derrapagem
    const yawErr = Math.atan2(dl, Math.max(df, 0.05));
    this.rud = clamp(K * 1.8 * yawErr * (1 - w * 0.7) - 0.5 * this.yr, -1, 1);
    const as = D.clmax / D.cla, aLim = as * (0.86 + this.flaps * 0.08);
    // sem estol; o termo −pr amortece o limitador (sem ele o F-86 em curva fechada ia de 2,3 a 9,3 G a cada ~0,8 s)
    elev = Math.min(elev, 0.9 * aLim / D.kde + (aLim - this.alpha) * 7 - this.pr);
    elev = Math.min(elev, ((opts.glim || 8.5) - this.n) * 0.6 + 0.25);                    // limite de G
    elev = Math.max(elev, -0.9 * as * 0.6 / D.kde + (-as * 0.6 - this.alpha) * 7);
    elev = Math.max(elev, (-(opts.gneg || 2.5) - this.n) * 0.6 - 0.25);                 // limite de G negativo
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
    const gunsOK = powered(this, 'guns'); // disparo pneumático (Spitfire) ou elétrico (Fw 190)
    for (const g of this.guns) {
      // aquecimento do cano: ~14 s de rajada contínua travam a arma até esfriar
      const shooting = this.firing && g.ammo > 0 && !g.jam && !g.broken && gunsOK;
      g.heat = clamp(g.heat + (shooting ? dt / 14 : -dt / 9), 0, 1);
      if (g.heat >= 1) g.jam = true; else if (g.jam && g.heat < 0.35) g.jam = false;
      if (!shooting) { g.acc = Math.min(g.acc, 1); continue; }
      g.acc += dt * g.W.rpm / 60 * g.pts.length;
      while (g.acc >= 1 && g.ammo > 0) {
        g.acc -= 1; g.ammo--; g.k++; this.shotsN++;
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
  // F desce um estágio; do pouso volta para recolhido
  cycleFlaps() {
    if (!powered(this, 'flaps')) { if (this.isPlayer) showDmg('Flaps sem acionamento'); return; }
    const nx = (this.flapStage + 1) % FLAP_POS.length, lim = flapLim(this.def, nx);
    if (nx && this.ias > lim) { if (this.isPlayer) showDmg(`Flaps de ${FLAP_NAME[nx].toLowerCase()}: abaixo de ${Math.round(lim * 3.6)} km/h`, true); return; }
    this.flapStage = nx; if (this.isPlayer) showDmg(`Flaps: ${FLAP_NAME[nx]}`, true);
  }
  engineStop() { for (const e of this.engs) { e.on = false; e.hp = 0; } this.syncEng(); if (this.isPlayer) showDmg('Motor parou'); }
  // um motor só (bimotor segue voando com o outro)
  engineOut(i) {
    const e = this.engs[i]; e.on = false; e.hp = 0;
    if (!this.engs.some(q => q.on)) return this.engineStop();
    this.syncEng(); if (this.isPlayer) showDmg(`${this.mods['eng' + i].label} parou`);
  }
  syncEng() { this.hp.engine = Math.max(0, this.engs.reduce((a, e) => a + e.hp, 0) / this.engs.length); this.engineOn = this.engs.some(e => e.on); }
  // superfícies de comando seguem o comando (ou ficam onde travaram) e somem quando arrancadas
  animSurfaces() {
    const M = this.mods, sv = this.surf; if (!sv) return;
    const cmd = n => (M[n].dead ? M[n].stuck || 0 : null);
    const ang = { ailL: -(cmd('ailL') ?? this.ail), ailR: cmd('ailR') ?? this.ail, flapL: -this.flapP.L, flapR: -this.flapP.R, elevL: cmd('elev') ?? this.elev, elevR: cmd('elev') ?? this.elev, rud: -(cmd('rud') ?? this.rud) };
    for (const n in sv) {
      const s = sv[n], m = M[n.startsWith('elev') ? 'elev' : n];
      s.pivot.visible = !(m.hp <= -m.max) && !(n.startsWith('flap') && this.flapGone[n[4]]);
      _pq.setFromAxisAngle(s.axis, ang[n] * s.max); s.pivot.quaternion.copy(s.base).multiply(_pq);
    }
  }
  ignite(at) { if (this.fire <= 0) { this.fire = 0.01; this.fireAt = at.slice(); } }
  extinguish() { if (this.fire > 0 && this.ext > 0) { this.ext--; this.fire = 0; if (this.isPlayer) showDmg('Incêndio extinto', true); return true; } return false; }
  damage(part, dmg, by, isBlast, penetrated = true, idx) {
    if (this.gone || !isFinite(dmg)) return;
    if (by && by.team !== this.team) { this.lastHitBy = by; this.lastHitT = S.now; }
    if (S.air) S.air.onDamage(this, dmg, by);
    if (part === 'pilot') {
      if (penetrated && Math.random() < 0.3 * Math.min(1.5, dmg)) { this.pilot = false; if (this.alive) destroyVehicle(this, by, 'pilot'); }
      else part = 'fuse';
    }
    if (part === 'pilot') return;
    if (part === 'engine') {
      const i = idx ?? Math.floor(Math.random() * this.engs.length), e = this.engs[i];
      e.hp -= dmg; if (Math.random() < 0.05 * dmg) this.oil = 1;
      if (Math.random() < 0.035 * dmg && this.fire <= 0) this.ignite(this.mods['eng' + i] ? this.mods['eng' + i].c : this.fireAt);
      if (e.hp <= 0 && e.on) this.engineOut(i); else this.syncEng();
      if (this.isPlayer && !isBlast && Math.random() < .4) flashVign();
      return;
    }
    if (part === 'fuel') { const T = modsOf(this, 'fuel'), t = T[Math.floor(Math.random() * T.length)]; if (t) applyMod(this, t, dmg, by, isBlast ? { tnt: 1 } : null); return; }
    this.hp[part] -= dmg;
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
