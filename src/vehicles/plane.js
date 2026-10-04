import * as THREE from 'three';
import { scene } from '../core/render.js';
import { S, S as ST, planes } from '../core/state.js'; // ST: em physics() `S` é a área da asa
import { V3, QUAT, UP, clamp, lerp, rand, rv } from '../core/util.js';
import { H, AIRLIMIT, AIRFIELDS } from '../world/terrain.js';
import { obstNear, addCrater, treeHit } from '../world/scenery.js';
import { PLANES, GUNS, MISSILES, RHO, G, beltRounds } from '../data/vehicles.js';
import { EngineSet, ENGINES } from '../air/systems/engine.js';
import { isa } from '../air/systems/atmosphere.js';
import { Radar } from '../air/systems/radar.js';
import { Rwr, Maw } from '../air/systems/rwr.js';
import { fxBurn, fxTrail, fxSmallFlash, fxExplosion, fxBigBlast, fxDust, fxSparks } from '../fx/particles.js';
import { sndMG, sndShot, sndBoom, sndTear, sndHit } from '../fx/audio.js';
import { fxFlakes, fxHole, fxBlast } from './planeFx.js';
import { fireProj, destroyVehicle, spawnDebris, blast } from '../combat/ballistics.js';
import { makeLabel, showDmg, flashVign, shakeAt } from '../ui/hud.js';
import { nextId } from './tank.js';
import { buildPlane } from './planeModel.js';
import { tipBreak, tipArea, wingCfg, station } from './planeGeom.js';
import { stepHeat } from './engineHeat.js';
import { planeModules, fuelOf, ctrlAuthority, fuelLeak, fuelInit, fuelStep, applyMod, powered, modsOf, sparFrac } from './planeDamage.js';
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
const _pe = new THREE.Euler(), G0 = 9.81, _pm = new THREE.Matrix4(), _pfx = new V3(), _pu = new V3(), _pl = new V3(), _pv = new V3(), _pF = new V3(), _pw = new V3(), _pq = new QUAT();
export class Plane {
  constructor(key, team, who, pos, yaw, speed, opts = {}) {
    this.id = nextId(); this.def = PLANES[key]; const D = this.def;
    this.type = 'plane'; this.team = team; this.who = who; this.name = who ? who.name : D.name; this.isPlayer = !!(who && who.isPlayer);
    Object.assign(this, buildPlane(D)); scene.add(this.root);
    this.pos = pos.clone(); this.q = new QUAT().setFromAxisAngle(UP, yaw);
    this.vel = new V3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(speed);
    this.pr = 0; this.rr = 0; this.yr = 0; // arfagem (nariz para cima +), rolagem (direita +), guinada (esquerda +)
    this.elev = 0; this.ail = 0; this.rud = 0; this.throttle = 1; this.wep = false;
    this.flaps = 0; this.flapStage = 0; this.airbrake = false; this.iP = 0; this.gear = 0; this.gearCmd = 0; this.shotsN = 0; this.hitsN = 0;
    this.gStress = 0; this.koT = 0; this.koAge = 0; this.overG = 0; this.n = 1; this.alpha = 0; this.ias = speed; this.dropSign = 1; this.spottedUntil = 0; this.oobT = 0;
    this.firing = false; this.ordOn = opts.ord !== false; this.beltSel = opts.belts || null; this.onGround = false;
    this.inv = new THREE.Matrix4();
    this.outfit();
    this.label = makeLabel(this);
    this.applyTransform();
    planes.push(this);
  }
  // tudo que o reparo na pista devolve ao estado de fábrica: estrutura, módulos, combustível, armas, sistemas
  outfit() {
    const D = this.def;
    this.hp = Object.assign({}, D.hpParts); this.maxHp = D.hpParts;
    this.wingOn = { L: true, R: true }; this.tipOn = { L: true, R: true }; this.tailOn = true;
    // ponta da asa: onde se solta (x no corpo) e quanto da sustentação de uma asa ela carrega
    this.tipX = station(wingCfg(D, 1), tipBreak(D), 0)[0]; this.tipFrac = tipArea(D); this.hitLx = null; this.engineOn = true; this.pilot = true;
    this.alive = true; this.gone = false; this.fire = 0; this.temp = 80; this.heat = { water: 85, oil: 70 }; this.eng = new EngineSet(D.engine, D.engines); this.cooling = ENGINES[D.engine].cooling || 'jet'; this.oil = 0; this.water = 0; this.oilQ = 1; this.waterQ = 1; this.sparG = {}; // oil/water: vazamento (fração/s); oilQ/waterQ: quanto resta this.lastHitBy = null; this.lastHitT = -99;
    this.guns = [];
    D.guns.forEach((g, gi) => {
      const W = GUNS[g.w], mp = this.gunPts && this.gunPts[gi], pts = mp ? mp.map(q => q.slice()) : []; // boca do cano modelado
      if (!mp) for (const s of g.span) { pts.push([s, -0.1, g.z]); if (g.n > 1) pts.push([-s, -0.1, g.z]); }
      while (pts.length < g.n) pts.push(...pts.slice(0, g.n - pts.length));
      // cinta escolhida no hangar (jogador) ou padrão/ar-ar (IA)
      const beltName = (this.beltSel && this.beltSel[gi]) || (this.isPlayer ? 'Padrão' : Math.random() < 0.5 ? 'Padrão' : 'Ar-ar');
      this.guns.push({ W, pts: pts.slice(0, g.n), ammo: g.ammo * g.n, max: g.ammo * g.n, acc: 0, k: 0, heat: 0, jam: false, beltName, belt: beltRounds(W, beltName) });
    });
    this.bombs = []; this.rockets = 0;
    if (this.ordOn) { for (const b of D.bombs) for (let i = 0; i < b.n; i++) this.bombs.push(b); this.rockets = D.rockets ? D.rockets.n : 0; }
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
    this.mods = planeModules(D); this.fitPilot(); this.fitGuns(); this.fuel = this.fuelMax = fuelOf(D); fuelInit(this, this.fuelMax); this.wounded = false;
    // cada motor com a própria integridade (o F-4 volta com um só); hp.engine = média, para HUD/fumaça
    this.engs = Array.from({ length: D.engines || 1 }, (_, i) => ({ hp: D.hpParts.engine, on: true, x: this.mods['eng' + i] ? this.mods['eng' + i].c[0] : 0 }));
    this.flapP = { L: 0, R: 0 }; this.flapGone = { L: false, R: false }; this.brakeOn = false;
    this.flares = this.chaff = D.jet ? 20 : 0; this.ext = 1; this.fireAt = [0, 0, D.jet ? -D.L * 0.15 : D.L * 0.3];
    this.flareUntil = 0; this.chaffUntil = 0;
    const fr = D.fuseR, L = D.L;
    this.boxes = [
      { name: 'fuse', mn: [-fr, -fr, -L * .55], mx: [fr, fr + .35, L * .45] },
      { name: 'wingL', mn: [fr, -.2, D.wingZ - D.chord * .65 - sweepOf(D)], mx: [D.span / 2, .3, D.wingZ + D.chord * .35] },
      { name: 'wingR', mn: [-D.span / 2, -.2, D.wingZ - D.chord * .65 - sweepOf(D)], mx: [-fr, .3, D.wingZ + D.chord * .35] },
      { name: 'tail', mn: [-D.span * .18, -.1, -L * .55], mx: [D.span * .18, .2, -L * .42] },
      { name: 'fin', mn: [-.1, 0, -L * .56], mx: [.1, 1.8, -L * .42] }];
  }
  // reparo + rearme (parado na própria pista): modelo novo (as peças arrancadas voltam) e estado de fábrica
  refit() {
    const keep = { gear: this.gear, gearCmd: this.gearCmd, throttle: this.throttle, flapStage: this.flapStage };
    scene.remove(this.root); Object.assign(this, buildPlane(this.def)); scene.add(this.root);
    this.outfit(); Object.assign(this, keep); this.doomed = null;
    if (this.onGround) this.gear = this.gearCmd = 1; // pousou de barriga: a equipe de solo baixa o trem
    this.applyTransform();
  }
  // fração de potência/empuxo entregue (HUD, som, temperatura): >1 com WEP/pós-combustão
  get spool() { return this.eng.output; }
  // WEP (pistão) ou pós-combustão (jato que tenha)
  get missiles() { let n = 0; for (const r of this.racks) n += r.n; return n; }
  // estante selecionada (pula para a próxima com míssil quando a atual esvazia)
  get rack() { const R = this.racks; if (!R.length) return null; if (R[this.sel].n <= 0) { const i = R.findIndex(r => r.n > 0); if (i >= 0) this.sel = i; } return R[this.sel]; }
  cycleRack() { const R = this.racks; for (let k = 1; k <= R.length; k++) { const i = (this.sel + k) % R.length; if (R[i].n > 0) { this.sel = i; break; } } return this.rack; }
  get canBoost() { return this.eng.hasBoost; }
  axes() { _pm.makeRotationFromQuaternion(this.q); _pl.setFromMatrixColumn(_pm, 0); _pu.setFromMatrixColumn(_pm, 1); _pf.setFromMatrixColumn(_pm, 2); }
  centerPos(out) { return out.copy(this.pos); }
  eyePos(out) { return out.copy(this.pos); }
  applyTransform() {
    this.root.position.copy(this.pos); this.root.quaternion.copy(this.q);
    if (this.gearMesh) { this.gearMesh.visible = this.gear > 0.01; if (this.gearMesh.userData.anim) this.gearMesh.userData.anim(this.gear); if (this.gearMesh.userData.squash) this.gearMesh.userData.squash(this.gc || 0); }
    this.animSurfaces();
    this.root.updateMatrixWorld(true); this.inv.copy(this.root.matrixWorld).invert();
  }
  // desmaiado: sem comando nenhum (manche solto, sem disparar); 0..1 para escurecer a tela
  get blackout() { return this.koT > 0 ? Math.min(1, this.koAge / 0.3, this.koT / 1.2) : 0; }
  physics(dt) {
    if (this.gone) return;
    if (this.wreck) return this.wreckStep(dt);
    if (this.koT > 0) { this.elev = this.ail = this.rud = 0; this.firing = false; }
    const D = this.def, n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    const S = D.S, b = D.span, c = S / b, AR = b * b / S, m = D.mass + this.bombs.reduce((s, x) => s + x.m, 0) + this.rockets * (D.rockets ? D.rockets.m : 0) + this.racks.reduce((s, r) => s + r.n * r.M.mass, 0) - (this.fuelMax - this.fuel);
    const A = ctrlAuthority(this);
    // flaps e freio dependem do sistema que os move (hidráulico, pneumático ou elétrico, conforme o avião): sem ele, travam onde estão
    const flapsOK = powered(this, 'flaps');
    if (powered(this, 'brake')) this.brakeOn = this.airbrake && !!this.def.brake; // só quem tem freio aerodinâmico (jatos)
    // flaps por estágio (como no WT): acima do limite do estágio eles sobem um degrau sozinhos; o painel se move devagar
    if (flapsOK && this.flapStage && this.ias > flapLim(D, this.flapStage)) { this.flapStage--; if (this.isPlayer) showDmg(`Flaps: ${FLAP_NAME[this.flapStage]} · velocidade alta`, true); }
    for (const sd of ['L', 'R']) {
      const m = this.mods['flap' + sd];
      if (flapsOK && !m.dead && !this.flapGone[sd]) this.flapP[sd] += clamp(FLAP_POS[this.flapStage] - this.flapP[sd], -dt * 0.5, dt * 0.5);
      // flap travado baixado acima do limite: o vento arranca o painel
      if (!this.flapGone[sd] && this.flapP[sd] > 0.1 && this.ias > flapLim(D, Math.max(1, Math.round(this.flapP[sd] * 3))) * 1.15) {
        this.flapGone[sd] = true; this.flapP[sd] = 0; m.dead = true; m.hp = -m.max; this.ripSurface(m);
      }
    }
    this.flaps = (this.flapP.L + this.flapP.R) / 2;
    // trem: comando (gearCmd) e posição real (gear 0..1), ~4 s para descer ou subir
    this.gear = clamp(this.gear + (this.gearCmd ? 1 : -1) * dt / (this.def.gearT || 4), 0, 1);
    if (this.gearCmd && !this.onGround && this.ias > this.gearV * 1.12) { this.gearCmd = 0; if (this.isPlayer) showDmg('Trem recolhido: velocidade acima do limite', true); }
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
      const hpL = this.wingOn.L ? (0.6 + 0.4 * Math.max(0, this.hp.wingL) / this.maxHp.wingL) * (this.tipOn.L ? 1 : 1 - this.tipFrac) : 0, hpR = this.wingOn.R ? (0.6 + 0.4 * Math.max(0, this.hp.wingR) / this.maxHp.wingR) * (this.tipOn.R ? 1 : 1 - this.tipFrac) : 0;
      const kW = (hpL + hpR) / 2;
      const mach = V / _atm.a; this.mach = mach;
      CL += this.flaps * 0.38 * (aa <= as ? 1 : 0.5);
      const CD = D.cd0 + CL * CL / (Math.PI * D.e * AR) + CDs + this.flaps * 0.028 + (this.brakeK || 0) * (D.brakeCd || 0.11) + this.gear * 0.035 + this.bombs.length * 0.0012 + this.rockets * 0.0004 + this.missiles * 0.0008 + waveDrag(D, mach) + (1 - kW) * 0.02 + (this.tailOn ? 0 : 0.01);
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
      const ctrl = (this.pilot ? 1 : 0) * clamp(1 - (this.ias - (D.vctrl || 215)) / 75, 0.28, 1);
      const tE = this.tailOn ? 0.45 + 0.55 * clamp(this.hp.tail / this.maxHp.tail, 0, 1) : 0.06, Vd = Math.max(V, 20);
      const aE = clamp(alpha, -0.5, 0.5);
      let Mp = qd * S * c * (D.kde * (this.elev * ctrl * A.elev + (st('elevL') + st('elevR')) / 2) * tE -0.9 * aE * (this.tailOn ? 1 : 0.1)) - qd * S * c * c / (2 * Vd) * dmp[0] * this.pr * (this.tailOn ? 1 : 0.15);
      let Mr = qd * S * b * D.kda * (this.ail * A.ail + A.ailBias * 0.15) * ctrl * (this.wingOn.L && this.wingOn.R ? 1 : 0.5) - qd * S * b * b / (2 * Vd) * dmp[1] * this.rr * Math.max(kW, 0.3);
      Mr += qd * S * CL * (hpL - hpR) / 2 * b * 0.22;           // assimetria de sustentação
      Mr += qd * S * b * (0.03 * (this.flapP.L - this.flapP.R) + D.kda * 0.5 * (st('ailL') + st('ailR'))); // flap assimétrico / aileron travado
      Mr += qd * S * c * D.kde * 0.25 * tE * (this.elev * ctrl * A.elevBias + (st('elevL') - st('elevR')) / 2) * (D.span * 0.18 / c); // profundor de um lado só também rola
      if (aa > as) Mr += qd * S * b * 0.02 * this.dropSign * Math.min(1, (aa - as) * 8); // queda de asa no estol
      if (!this.eng.jet) Mr -= this.eng.shaft * (this.eng.E.torque || 1) / 280 / Math.max(1, V / 60); // torque da hélice
      Mr += qd * S * b * 0.03 * beta;                             // efeito diedro
      let My = -this.eng.thrust * thrX + qd * S * b * (D.kdr * (this.rud * ctrl * A.rud + st('rud')) * tE +0.1 * beta * (this.tailOn ? 1 : 0.1)) - qd * S * b * b / (2 * Vd) * dmp[2] * this.yr;
      this.pr += Mp / Ip * h; this.rr += Mr / Ir * h; this.yr += My / Iy * h;
      _pw.set(-this.pr, this.yr, this.rr).applyQuaternion(this.q);
      _pq.set(_pw.x * h * 0.5, _pw.y * h * 0.5, _pw.z * h * 0.5, 0).multiply(this.q);
      this.q.x += _pq.x; this.q.y += _pq.y; this.q.z += _pq.z; this.q.w += _pq.w; this.q.normalize();
      if (this.gearMesh && (this.gear > 0.98 || this.onGround || this.pos.y < H(this.pos.x, this.pos.z) + this.def.fuseR) && this.groundStep(h, this.gear < 0.98)) return;
    }
    if (Math.random() < dt * 0.3) this.dropSign = Math.random() < .5 ? 1 : -1;
    // fisiologia do piloto: nada abaixo de G muito alto; acima de 17 G (ou −3,5 G) SUSTENTADO a carga acumula
    // e o piloto DESMAIA: alguns segundos sem controle (o avião segue solto), depois volta a si
    const gT = this.wounded ? 15 : 17; // piloto ferido apaga antes
    const gx = this.n > gT ? (this.n - gT) * 0.3 : this.n < -3.5 ? (-3.5 - this.n) * 0.3 : -0.4; // 19,5 G: ~1,3 s; 18 G: ~3 s
    // combustível: consumo do motor + vazamentos; seco = motor apaga
    const leak = fuelLeak(this);
    fuelStep(this, this.engineOn ? this.eng.flow : 0, dt);
    if (this.fuel <= 0 && this.engineOn && this.alive) { this.engineStop(); if (this.isPlayer) showDmg('Sem combustível'); }
    if (leak > 0 && this.fuel > 0 && Math.random() < dt * 35) for (const m of modsOf(this, 'fuel')) if (m.leak > 0 && m.left > 0) fxTrail(_pt.set(...m.c).applyMatrix4(this.root.matrixWorld).clone(), 0xf2f0ea, 0.45 + 0.1 * Math.min(m.leak, 4), 3); // névoa de combustível, mais grossa quanto maior o furo
    if (this.koT > 0) {
      this.koT -= dt; this.koAge += dt;
      if (this.koT <= 0 && this.isPlayer) showDmg('Piloto recobrou a consciência', true);
    } else {
      this.gStress = clamp(this.gStress + gx * dt, 0, 1);
      if (this.gStress >= 1 && this.alive && this.pilot) { this.koT = 3.5 + Math.random() * 1.5; this.koAge = 0; this.gStress = 0; if (this.isPlayer) showDmg('Piloto desmaiou · G excessivo'); }
    }
    // limites estruturais
    if (this.alive) {
      // asa quebrando por excesso de G só nos aviões a pistão; jato não quebra em curva (pedido do jogador)
      if (!this.eng.jet && Math.abs(this.n) > this.def.glim) this.overG += dt; else this.overG = 0;
      if (this.overG > 0.12) this.breakWing(Math.random() < .5 ? 'L' : 'R', 'g');
      // longarina danificada aguenta menos G: puxar demais termina de quebrar (raiz → asa, externa → ponta)
      for (const seg of ['L0', 'R0', 'L1', 'R1']) {
        const k = sparFrac(this, seg); if (k >= 0.999) continue;
        if (Math.abs(this.n) > this.def.glim * (0.3 + 0.7 * k)) { if ((this.sparG[seg] = (this.sparG[seg] || 0) + dt) > 0.15) this.cutSpar(seg, this.lastHitBy); } else this.sparG[seg] = 0;
      }
      if (this.ias > this.def.vne * 1.07) { this.overG += dt * 2; if (this.overG > 0.4) this.breakWing('L', 'vne'); }
    }
    // temperatura do motor
    // água → óleo → desgaste (engineHeat.js). Antes um só número chegava a 142 °C no WEP e o motor morria em ~30 s.
    this.oilQ = Math.max(0, this.oilQ - this.oil * dt); this.waterQ = Math.max(0, this.waterQ - this.water * dt);
    const wear = stepHeat(this.heat, this.cooling, this.engineOn ? Math.min(1, this.spool) : 0, this.wep, this.ias, { oil: 1 - this.oilQ, water: 1 - this.waterQ }, dt);
    this.temp = this.heat.oil;
    if (wear > 0 && this.engineOn) { this.engs.forEach((e, i) => { if (!e.on) return; e.hp -= wear * this.maxHp.engine; if (e.hp <= 0) { this.engineOut(i); } }); this.syncEng(); }
    if (this.fire > 0) {
      this.fire += dt;
      if (Math.random() < dt * 30) fxBurn(_pt.set(...this.fireAt).applyMatrix4(this.root.matrixWorld).clone(), 1.2);
      // o fogo consome a estrutura: longarina da asa que queima (ou o cone de cauda, se for na fuselagem)
      if (this.fire > 4 && Math.random() < dt * 0.3) { const sd = this.fireAt[0] > 1 ? 'L' : this.fireAt[0] < -1 ? 'R' : null, M = Object.values(this.mods).filter(m => !m.lost && (sd ? m.kind === 'spar' && m.seg === sd + '0' : m.kind === 'boom')); if (M.length) applyMod(this, M[Math.floor(Math.random() * M.length)], 2.5, this.lastHitBy, null); }
      if (this.fire > 22 && this.alive) destroyVehicle(this, this.lastHitBy, 'fire');
    } else if (this.hp.engine < this.maxHp.engine * 0.5 || (this.engineOn && this.heat.oil > 125)) {
      if (Math.random() < dt * 14) fxTrail(this.pos.clone(), 0xb8b4ac, 1, 3); // motor danificado/fervendo: fumaça clara
    }
    // vazamentos saindo de onde furou: óleo = rastro marrom fino (marrom médio, nunca quase-preto); água = névoa branca
    const at = m => (m ? _pt.set(...m.c).applyMatrix4(this.root.matrixWorld) : _pt.copy(this.pos)).clone(), hurt = k => modsOf(this, k).find(m => m.hp < m.max);
    if (this.oil > 0 && this.oilQ > 0 && Math.random() < dt * 30) fxTrail(at(hurt('oil') || hurt('cool') || this.mods.eng0 || this.mods.engine), 0x7a6650, 0.4, 3.5);
    if (this.water > 0 && this.waterQ > 0 && Math.random() < dt * 30) fxTrail(at(hurt('cool')), 0xf4f4f2, 0.5, 2.2);
    this.prop.rotation.z += (this.engineOn ? 60 : Math.min(this.ias / 4, 20)) * dt;
    this.prop.children[this.prop.children.length - 1].visible = this.engineOn;
    // colisão com o solo
    this.axes();
    if (this.onGround) return; // no chão quem cuida é o groundStep
    const reach = sd => (!this.wingOn[sd] ? this.def.span * 0.1 : this.tipOn[sd] ? this.def.span / 2 : this.tipX);
    const pts = [[0, 0, this.def.L * .45], [reach('L'), 0, 0], [-reach('R'), 0, 0], [0, 0, -this.def.L * .5], [0, -this.def.fuseR, 0]];
    for (let i = 0; i < pts.length; i++) {
      const [x, y, z] = pts[i];
      const wx = this.pos.x + _pl.x * x + _pu.x * y + _pf.x * z, wy = this.pos.y + _pl.y * x + _pu.y * y + _pf.y * z, wz = this.pos.z + _pl.z * x + _pu.z * y + _pf.z * z;
      if (wy < H(wx, wz) + 0.2) { this.impact(i); return; }
    }
    // árvores: voo rasante pode bater na copa (asa inclusa: raio ~ 1/3 da envergadura)
    if (!this.onGround && this.pos.y - H(this.pos.x, this.pos.z) < 30 && treeHit(this.pos.x, this.pos.y, this.pos.z, this.def.span * 0.33)) { this.crash(); return; }
    for (const b of obstNear(this.pos.x - 6, this.pos.z - 6, this.pos.x + 6, this.pos.z + 6)) if (this.pos.x > b.mn[0] && this.pos.x < b.mx[0] && this.pos.z > b.mn[2] && this.pos.z < b.mx[2] && this.pos.y < b.mx[1]) { this.crash(); return; }
    // fora da arena conta tempo, exceto no corredor de pouso/decolagem das bases (a cabeceira fica perto do limite)
    const nearBase = AIRFIELDS.some(a => Math.abs(this.pos.x - a.x) < 800 && Math.abs(this.pos.z - a.z) < a.len / 2 + 3500);
    if (!nearBase && Math.max(Math.abs(this.pos.x), Math.abs(this.pos.z)) > (ST.airLimit || AIRLIMIT)) this.oobT += dt; else this.oobT = 0;
    if (this.oobT > 15 && this.alive) destroyVehicle(this, null, 'oob');
  }
  // Trem baixado tocando o chão: pouso (ou quebra, se veio rápido/inclinado/de nariz), rolagem com atrito e
  // freio, direção pelo leme/bequilha e rotação até o limite que não arrasta a cauda. A sustentação tira o
  // avião do chão sozinha na decolagem. Retorna true se o toque destruiu o avião.
  groundStep(h, belly) {
    const G = this.gearMesh.userData, hg = H(this.pos.x, this.pos.z), D = this.def, lift = belly ? D.fuseR * 0.95 : G.lift;
    // amortecedor: mola-amortecedor em direção ao peso parado (0,35) no chão ou estendido (0) no ar
    this.gc = this.gc || 0; this.gcv = this.gcv || 0;
    this.gcv += (140 * ((this.onGround && !belly ? 0.35 : 0) - this.gc) - 15 * this.gcv) * h;
    this.gc = clamp(this.gc + this.gcv * h, 0, 1); if (this.gc === 1 && this.gcv > 0) this.gcv = 0;
    if (this.pos.y > hg + lift + 0.05 || (this.onGround && this.vel.y > 0.4) || (!this.onGround && this.vel.y > 0)) { this.onGround = false; return false; } // no ar / decolou (subindo não "re-pousa")
    this.axes();
    const pitch = Math.asin(clamp(_pf.y, -1, 1)), roll = _pl.y;
    if (!this.onGround) {
      // tolerante como no WT: só explode se vier MUITO errado; no meio do caminho é pouso duro (estraga a estrutura)
      const vs = -this.vel.y, why = vs > (belly ? 7 : 13) ? 'descendo rápido demais' : Math.abs(roll) > (belly ? 0.35 : 0.6) ? 'asa no chão (inclinado demais)' : pitch < -0.35 ? 'de nariz no chão' : this.ias > (belly ? 330 / 3.6 : this.gearV * 1.2) ? `rápido demais (${Math.round(this.ias * 3.6)} km/h)` : null;
      if (why) { if (this.isPlayer) showDmg(`Pouso falhou: ${why}`); if (vs > 25) this.crash(); else { if (Math.abs(roll) > 0.35) this.breakTip(roll > 0 ? 'R' : 'L'); this.collapseGear(); this.toWreck(); } return true; }
      this.onGround = true; this.touchT = ST.now; this.touchV = vs;
      const hard = vs > 5 || this.ias > this.gearV;
      if (hard) { this.hp.fuse -= this.maxHp.fuse * 0.12 * (1 + Math.max(0, vs - 5) / 4); if (this.hp.fuse <= 0) { this.collapseGear(); this.toWreck(); return true; } }
      if (belly) { this.engs.forEach((e, i) => { if (e.on && !D.jet) this.engineOut(i); }); } // hélice bate no chão
      else {
        // toque: o amortecedor afunda, o pneu parado no ar esfola na pista (fumaça) e um toque firme quica
        this.gcv += 0.5 + vs * 0.55;
        const Vg = Math.hypot(this.vel.x, this.vel.z);
        if (Vg > 25) for (const sx of [1, -1]) { _pt.set(sx * D.span * 0.16, -G.lift, G.mainZ).applyMatrix4(this.root.matrixWorld); for (let i = 0; i < 3; i++) fxTrail(_pt.clone().add(rv(0.3)), 0xdedcd6, 0.35 + Math.min(vs, 6) * 0.06, 1.6 + Math.random()); }
        if (vs > 3.2) this.vel.y = vs * 0.2;
        if (this.isPlayer) shakeAt(this.pos, 0.25 + Math.min(vs, 10) * 0.12, 50);
      }
      if (this.isPlayer && (hard || belly || ST.now - (this.landMsgT || -9) > 3)) { this.landMsgT = ST.now; showDmg(belly ? 'Pouso de barriga' : hard ? 'Pouso duro · estrutura danificada' : 'Pouso', !hard && !belly); }
    }
    // atitude: rumo livre, asas niveladas, arfagem entre a de repouso (cauda/bequilha no chão) e o limite de rotação
    const tail = !belly && G.pitch > 0, rest = belly ? 0 : G.pitch, maxRot = Math.min(0.26, Math.asin(clamp((G.lift - 0.45) / (D.L * 0.5), 0, 1)));
    let pit = clamp(pitch, 0, belly ? 0 : tail ? rest : maxRot);
    pit += (rest - pit) * (1 - Math.exp(-h * 3 * clamp(1 - this.ias / 55, 0, 1))); // devagar, o peso assenta o avião
    let yaw = Math.atan2(_pf.x, _pf.z);
    const V = Math.hypot(this.vel.x, this.vel.z);
    yaw += this.rud * 0.55 * clamp(V / 6, 0, 1) * clamp(1.2 - V / 70, 0.2, 1) * h; // bequilha/freio diferencial
    this.q.setFromEuler(_pe.set(-pit, yaw, 0, 'YXZ'));
    // o profundor gira o nariz sobre as rodas (decolagem do piloto); a arfagem só trava no limite (cauda/bequilha no chão ou rotação máxima)
    this.pr = Math.abs(pit - pitch) > 1e-4 ? 0 : this.pr * 0.98; this.rr = 0; this.yr = 0;
    this.pos.y = hg + lift - (belly ? 0 : this.gc * G.travel); if (this.vel.y < 0) this.vel.y = 0;
    // rodas: sem derrapagem lateral; atrito de rolagem ou freio (H, ou manete no zero parado/lento)
    const fx = Math.sin(yaw), fz = Math.cos(yaw), vf = this.vel.x * fx + this.vel.z * fz;
    const brake = this.airbrake || this.throttle < 0.02, mu = belly ? 0.6 : brake ? 0.55 : 0.025;
    const vf2 = Math.sign(vf) * Math.max(0, Math.abs(vf) - mu * G0 * h);
    this.vel.x = fx * vf2; this.vel.z = fz * vf2;
    return false;
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
    const eN = Math.atan2(du, Math.max(df, 0.05)), pe = eN + this.alpha * (nose ? 0.25 : 0.9);
    // no modo nariz o integral soma só o erro do NARIZ: somando pe, parava com o nariz 0,25·α fora do círculo
    this.iP = clamp(this.iP + (nose ? eN : pe) * dt * (off < 0.3 ? 1 : 0), -0.3, 0.3) * (off < 0.3 ? 1 : 0.95);
    const trim = 0.9 * clamp(this.alpha, -0.5, 0.5) / D.kde;
    // rolagem: inclina para colocar o alvo no plano de sustentação; perto do nariz, nivela as asas.
    // PERTO da mira (até ~17°) a inclinação usa só o desvio LATERAL: atan2(−dl, |du|); "acima/abaixo" fica
    // com o profundor (pe). Antes, com o alvo poucos graus abaixo do nariz, atan2(−dl, du) pedia ±170° e o
    // sinal trocava cada vez que dl cruzava zero → o avião balançava (em subida, em curva, em tudo).
    // Em du = 0 as duas fórmulas coincidem (sem salto); longe, abaixo → rola de dorso e puxa, como antes.
    // perto da mira o "nivelar" mira a inclinação de curva coordenada da mira em movimento (tan φ = V·ω/g);
    // nivelando para 0°, em curva ele brigava com a inclinação para o círculo e o nariz parava ~5° ao lado
    const om = this._aimVel ? _pd.crossVectors(this._aimPrev, this._aimVel).dot(UP) : 0;
    const NEAR = 0.3, wl = UP.dot(_pl), wu = UP.dot(_pu), level = Math.atan2(-wl, wu) - clamp(Math.atan(this.vel.length() * om / 9.81), -1.4, 1.4);
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
    // no chão: mira no horizonte ou abaixo = fica rolando (sem puxar); mira acima = roda e decola
    if (this.onGround) elev = dir.y < 0.03 ? clamp(elev, -0.2, 0) : Math.min(elev, 0.8);
    this.elev = clamp(elev, -1, 1);
  }
  // direção de tiro: armas FIXAS no eixo do avião, como no WT (quem aponta é o avião, não o mouse)
  fireDir(out) { this.axes(); return out.copy(_pf); }
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
        const aim = this.fireDir(_pfx).multiplyScalar(350).add(this.pos); // convergência a 350 m na direção de tiro
        const dir = aim.sub(pos).normalize().add(rv(0.0022)).normalize();
        const am = g.belt[g.k % g.belt.length]; // próximo projétil da cinta
        fireProj(this, pos, dir.multiplyScalar(g.W.v).add(this.vel), am, 'bullet', { tracer: am.tracer });
        if (g.k % 3 === 0) fxSmallFlash(pos, _pf.set(0, 0, 1).applyQuaternion(this.q));
        sndMG(pos, g.W.cal, this.isPlayer);
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
  // trem de pouso (G): só baixa abaixo do limite de operação; acima dele, avisa em vez de falhar calado
  // (antes recolhia no mesmo quadro acima de 380 km/h e a tecla parecia não funcionar)
  get gearV() { return (this.def.gearV || (this.def.jet ? 460 : 380)) / 3.6; }
  toggleGear() {
    if (this.onGround) { if (this.isPlayer) showDmg('Trem travado: avião no chão', true); return; }
    if (!this.gearCmd && this.ias > this.gearV) { if (this.isPlayer) showDmg(`Trem: reduza abaixo de ${Math.round(this.gearV * 3.6)} km/h (agora ${Math.round(this.ias * 3.6)})`, true); return; }
    this.gearCmd = this.gearCmd ? 0 : 1; if (this.isPlayer) showDmg(this.gearCmd ? 'Baixando o trem' : 'Recolhendo o trem', true);
  }
  // F desce um estágio; do pouso volta para recolhido
  cycleFlaps() {
    if (!powered(this, 'flaps')) { if (this.isPlayer) showDmg('Flaps sem acionamento'); return; }
    const nx = (this.flapStage + 1) % FLAP_POS.length, lim = flapLim(this.def, nx);
    if (nx && this.ias > lim) { if (this.isPlayer) showDmg(`Flaps de ${FLAP_NAME[nx].toLowerCase()}: abaixo de ${Math.round(lim * 3.6)} km/h`, true); return; }
    this.flapStage = nx; if (this.isPlayer) showDmg(`Flaps: ${FLAP_NAME[nx]}`, true);
  }
  engineStop() { for (const e of this.engs) { e.on = false; e.hp = 0; } this.syncEng(); }
  // um motor só (bimotor segue voando com o outro)
  engineOut(i) {
    const e = this.engs[i]; e.on = false; e.hp = 0;
    if (!this.engs.some(q => q.on)) return this.engineStop();
    this.syncEng();
  }
  syncEng() { this.hp.engine = Math.max(0, this.engs.reduce((a, e) => a + e.hp, 0) / this.engs.length); this.engineOn = this.engs.some(e => e.on); }
  // armas e munição onde os canos foram modelados (def.guns[i].mount → gunPts): culatra ~1,2 m atrás da boca,
  // cofre de munição logo atrás da arma — acertar ali é acertar a arma de verdade
  fitGuns() {
    const set = (m, c, h) => Object.assign(m, { c, h, mn: [c[0] - h[0], c[1] - h[1], c[2] - h[2]], mx: [c[0] + h[0], c[1] + h[1], c[2] + h[2]] });
    (this.gunPts || []).forEach((pts, gi) => {
      if (!pts) return;
      for (const tag of ['L', 'R', '']) {
        const g = this.mods[`gun${gi}${tag}`], a = this.mods[`ammo${gi}${tag}`]; if (!g) continue;
        const sd = g.sd, P = pts.filter(q => (sd ? Math.sign(q[0]) === sd : true)); if (!P.length) continue;
        const x0 = Math.min(...P.map(q => q[0])), x1 = Math.max(...P.map(q => q[0])), y0 = Math.min(...P.map(q => q[1])), y1 = Math.max(...P.map(q => q[1])), z = Math.max(...P.map(q => q[2]));
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2 + 0.1, hy = (y1 - y0) / 2 + 0.1;
        set(g, [cx, cy, z - 1.0], [hx, hy, 0.7]);
        if (a) set(a, [cx, cy, z - 2.2], [hx + 0.08, hy + 0.06, 0.45]);
      }
    });
  }
  // hitbox do piloto exatamente onde o boneco está sentado (cabeça + tronco)
  fitPilot() {
    const m = this.mods.pilot, P = this.pilotMesh; if (!m || !P) return;
    const c = [0, P.position.y - 0.25, P.position.z - 0.03], h = [0.24, 0.4, 0.28];
    Object.assign(m, { c, h, mn: [c[0] - h[0], c[1] - h[1], c[2] - h[2]], mx: [c[0] + h[0], c[1] + h[1], c[2] + h[2]] });
  }
  // superfícies de comando seguem o comando (ou ficam onde travaram) e somem quando arrancadas
  animSurfaces() {
    // freios aerodinâmicos abrem/fecham em ~0,8 s (hidráulico)
    if (this.brakes) { this.brakeK = clamp((this.brakeK || 0) + (this.brakeOn ? 1 : -1) / 96, 0, 1); for (const b of this.brakes) b.pivot.quaternion.setFromAxisAngle(b.axis, b.max * this.brakeK); }
    const M = this.mods, sv = this.surf; if (!sv) return;
    const cmd = n => (M[n].dead ? M[n].stuck || 0 : null);
    const ang = { ailL: -(cmd('ailL') ?? this.ail), ailR: cmd('ailR') ?? this.ail, flapL: -this.flapP.L, flapR: -this.flapP.R, elevL: cmd('elevL') ?? this.elev, elevR: cmd('elevR') ?? this.elev, rud: -(cmd('rud') ?? this.rud) };
    for (const n in sv) {
      const s = sv[n], m = M[n];
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
      if (penetrated && Math.random() < 0.3 * Math.min(1.5, dmg)) { this.pilot = false; if (this.pilotMesh) this.pilotMesh.rotation.x = 0.55; if (this.alive) destroyVehicle(this, by, 'pilot'); } // cabeça tomba
      else part = 'fuse';
    }
    if (part === 'pilot') return;
    if (part === 'engine') {
      const i = idx ?? Math.floor(Math.random() * this.engs.length), e = this.engs[i];
      e.hp -= dmg;
      // linhas de óleo e (motor a líquido) camisa d'água: um tiro no bloco costuma vazar
      if (Math.random() < 0.08 * dmg) this.oil = Math.min(0.06, this.oil + 0.006 + dmg * 0.004);
      if (this.cooling === 'liquid' && Math.random() < 0.1 * dmg) this.water = Math.min(0.08, this.water + 0.008 + dmg * 0.005);
      if (Math.random() < 0.035 * dmg && this.fire <= 0) this.ignite(this.mods['eng' + i] ? this.mods['eng' + i].c : this.fireAt);
      if (e.hp <= 0 && e.on) this.engineOut(i); else this.syncEng();
      if (this.isPlayer && !isBlast && Math.random() < .4) flashVign();
      return;
    }
    if (part === 'fuel') { const T = modsOf(this, 'fuel'), t = T[Math.floor(Math.random() * T.length)]; if (t) applyMod(this, t, dmg, by, isBlast ? { tnt: 1 } : null); return; }
    // revestimento (casca): furado tira sustentação/efetividade; NÃO derruba sozinho — quem segura a peça são
    // as longarinas (módulos 'spar'/'boom'). Só um estrago enorme (explosões seguidas) arranca a peça inteira.
    this.hp[part] = Math.max(this.hp[part] - dmg, -this.maxHp[part]);
    this.hitLx = null;
    if ((part === 'wingL' || part === 'wingR') && isBlast && this.hp[part] <= -this.maxHp[part] * 0.7) this.breakWing(part === 'wingL' ? 'L' : 'R', 'wing');
    if (part === 'tail' && isBlast && this.hp.tail <= -this.maxHp.tail * 0.8) this.loseTail(by);
    if (part === 'fuse' && this.hp.fuse <= -this.maxHp.fuse * 0.95 && this.alive) destroyVehicle(this, by || this.lastHitBy, 'structure');
    if (this.isPlayer && !isBlast && Math.random() < .4) { flashVign(); }
  }
  // acerto: o piloto ouve cada impacto na chapa; lascas saem do ponto de entrada (granada arranca mais)
  // explosão (blastR): rombos e painéis grandes arrancados (fxBlast); tiro: furo exato onde entrou
  hitFx(lp, he, ld, blastR) {
    if (this.isPlayer) sndHit(he);
    if (lp && blastR) return fxBlast(this, lp, blastR);
    const at = lp && fxHole(this, lp, ld, he);
    if (at && he && Math.random() < 0.3) fxFlakes(this, at, 1, true);
    if (lp && (he || Math.random() < 0.4)) fxFlakes(this, _pt.set(lp[0], lp[1], lp[2]).applyMatrix4(this.root.matrixWorld), he ? 2 + Math.floor(Math.random() * 3) : 1);
  }
  // solta um pedaço do modelo como destroço físico (caixa pelo tamanho real da peça); o ar freia e ele cai rodando
  detach(obj, mass) {
    scene.attach(obj); obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    sndTear(bb.getCenter(new V3()));
    const c = obj.worldToLocal(bb.getCenter(new V3())), h = bb.getSize(new V3()).multiplyScalar(0.5);
    const d = spawnDebris(obj, this.vel.clone().add(rv(5)), rv(5), [Math.max(h.x, 0.05), Math.max(h.y, 0.05), Math.max(h.z, 0.05)], [c.x, c.y, c.z], mass);
    d.body.setLinearDamping(mass < 100 ? 1.4 : 0.7); // arrasto: peça leve freia rápido e fica para trás
    return d;
  }
  // superfícies articuladas que estão dentro de `grp` deixam de ser animadas (vão embora com ele)
  dropSurfIn(grp) { for (const n in this.surf || {}) { let o = this.surf[n].pivot; while (o && o !== grp) o = o.parent; if (o) delete this.surf[n]; } }
  // aileron/flap/profundor/leme arrancado
  ripSurface(m) {
    if (m.ripped || !this.surf) return; m.ripped = true; m.stuck = 0;
    const names = [m.name].filter(n => this.surf[n]);
    if (!names.length) return;
    const n = names[Math.floor(Math.random() * names.length)], piv = this.surf[n].pivot; delete this.surf[n];
    fxSmallFlash(piv.getWorldPosition(new V3()), _pf.set(0, 1, 0));
    this.detach(piv, 15);
  }
  // longarina cortada: segmento da raiz leva a asa inteira; o externo, só a ponta
  cutSpar(seg, by) { if (seg[1] === '0') this.breakWing(seg[0], 'wing'); else this.breakTip(seg[0], by); }
  // cone de cauda cortado: a empenagem inteira se solta (estabilizador, profundor e leme)
  loseTail(by) {
    if (!this.tailOn) return;
    this.tailOn = false;
    for (const n of ['elevL', 'elevR', 'rud', 'boom']) if (this.mods[n]) Object.assign(this.mods[n], { lost: true, dead: true, stuck: 0 });
    this.dropSurfIn(this.tail); this.detach(this.tail, 90); this.boxes[3].off = this.boxes[4].off = true;
    this.doom(by || this.lastHitBy, 'tail');
  }
  // ponta da asa: perde sustentação daquele lado (e o aileron, se estava nela) mas o avião continua voando
  breakTip(side, by) {
    const t = side === 'L' ? this.tipL : this.tipR, sg = side === 'L' ? 1 : -1;
    if (!t || !this.tipOn[side] || !this.wingOn[side]) return;
    this.tipOn[side] = false;
    for (const m of Object.values(this.mods)) if (Math.sign(m.c[0]) === sg && Math.abs(m.c[0]) > this.tipX - 0.05) { m.lost = m.dead = true; m.hp = Math.min(m.hp, 0); m.stuck = 0; }
    this.dropSurfIn(t);
    const at = t.localToWorld(new V3(sg * (this.tipX + 0.4), 0, this.def.wingZ));
    this.detach(t, 60);
    const b = this.boxes[side === 'L' ? 1 : 2]; if (sg > 0) b.mx[0] = this.tipX; else b.mn[0] = -this.tipX;
    fxExplosion(at, .3);
    if (by && by.isPlayer && S.air) S.air.crit('Ponta da asa arrancada');
  }
  breakWing(side, why) {
    if (!this.wingOn[side]) return;
    this.wingOn[side] = false;
    const w = side === 'L' ? this.wingL : this.wingR, sg = side === 'L' ? 1 : -1;
    for (const m of Object.values(this.mods)) if (Math.sign(m.c[0]) === sg && Math.abs(m.c[0]) > this.def.fuseR * 1.2) { m.lost = m.dead = true; m.stuck = 0; }
    this.dropSurfIn(w);
    this.detach(w, 180);
    this.boxes[side === 'L' ? 1 : 2].off = true;
    fxExplosion(this.pos.clone(), .4);
    this.doom(this.lastHitT > S.now - 10 ? this.lastHitBy : null, why === 'g' ? 'overg' : why === 'vne' ? 'vne' : 'wing');
  }
  // jogador sem asa/cauda continua no comando até bater (o abate vai para quem causou); IA cai abatida na hora
  doom(by, cause) {
    if (!this.alive) return;
    if (!this.isPlayer) return destroyVehicle(this, by, cause);
    if (!this.doomed) { this.doomed = cause; this.doomBy = by; }
  }
  onDestroyed(cause) { this.firing = false; if (cause === 'pilot') { this.throttle = 0; } }
  // Batida no chão fora do pouso. Só vira bola de fogo entrando de frente/mergulhando; de raspão arranca a
  // peça que tocou (ponta → asa, cauda) e, quando é a fuselagem, o avião vira destroço que desliza e se
  // desmancha (wreckStep). i: 0 nariz, 1 asa esq., 2 asa dir., 3 cauda, 4 barriga
  impact(i) {
    const vn = -this.vel.y;
    if (vn > 30 || (i === 0 && vn > 16)) return this.crash();
    const sd = i === 1 ? 'L' : i === 2 ? 'R' : null, sg = sd === 'L' ? 1 : -1;
    if (sd && this.wingOn[sd]) {
      if (this.tipOn[sd]) this.breakTip(sd, this.lastHitBy); else this.breakWing(sd, 'crash');
      this.yr += sg * Math.min(1.2, this.vel.length() / 80); this.rr -= sg * 0.6; this.vel.multiplyScalar(0.9); // a asa que pega puxa o avião para aquele lado
      fxDust(_pt.copy(this.pos).addScaledVector(_pl, sg * this.def.span * 0.4), 8, 1.5);
    } else if (i === 3 && this.tailOn) { this.loseTail(this.lastHitBy); this.pr -= 0.5; fxDust(this.pos.clone(), 8, 1.5); }
    else this.toWreck();
    this.pos.y += 0.15; // o pedaço que bateu já foi; não re-toca no mesmo passo
  }
  // trem arrancado: as pernas viram destroço
  collapseGear() { const g = this.gearMesh; if (!g || !g.visible) return; this.gearMesh = null; this.detach(g, 120); }
  // fuselagem no chão: morto, mas o corpo continua inteiro na cena, deslizando, pegando fogo e soltando pedaços
  toWreck() {
    if (this.wreck || this.gone) return;
    this.wreck = true; this.engineOn = false; this.firing = false;
    if (this.alive) destroyVehicle(this, this.doomed ? this.doomBy : this.lastHitT > S.now - 15 ? this.lastHitBy : null, this.doomed || 'crash');
    const V = Math.hypot(this.vel.x, this.vel.z);
    fxExplosion(this.pos.clone(), 0.5 + Math.min(V, 120) / 200); sndBoom(this.pos, V > 60); shakeAt(this.pos, 0.9, 90); fxDust(this.pos.clone(), 14, 2.5);
    this.yr = rand(-1, 1) * Math.min(1.6, V / 45); this.wreckRoll = rand(-0.35, 0.35); this.wreckT = 0;
    this.vel.y = Math.max(0, -this.vel.y * 0.2); // quica um pouco e desce
    if (this.fire <= 0) this.ignite([0, 0, this.def.jet ? -this.def.L * 0.15 : this.def.L * 0.3]);
  }
  wreckStep(dt) {
    const D = this.def, rest = D.fuseR * 0.75;
    this.wreckT += dt;
    this.vel.y -= G0 * dt; this.pos.addScaledVector(this.vel, dt);
    const hg = H(this.pos.x, this.pos.z), V = Math.hypot(this.vel.x, this.vel.z), down = this.pos.y <= hg + rest + 0.05;
    if (down) {
      this.pos.y = hg + rest; if (this.vel.y < 0) this.vel.y = this.vel.y < -6 ? -this.vel.y * 0.25 : 0;
      const k = Math.max(0, 1 - (0.9 * G0 + 0.0015 * V * V) * dt / Math.max(V, 1e-3)); this.vel.x *= k; this.vel.z *= k; // chapa arrastando e arando a terra
      if (V > 8 && Math.random() < dt * 14) fxDust(this.pos.clone().add(rv(1.5)), 3, 1 + V / 60);
      if (V > 15 && Math.random() < dt * 8) fxSparks(this.pos.clone().add(rv(1)), 4);
      // o que ainda está preso vai sendo arrancado no arrasto (mais rápido = mais pedaço)
      if (V > 18 && Math.random() < dt * V / 70) {
        const opts = [];
        for (const s of ['L', 'R']) { if (this.wingOn[s] && this.tipOn[s]) opts.push(() => this.breakTip(s)); else if (this.wingOn[s]) opts.push(() => this.breakWing(s, 'crash')); }
        if (this.tailOn) opts.push(() => this.loseTail());
        for (const n in this.surf || {}) opts.push(() => this.mods[n] && this.ripSurface(this.mods[n]));
        if (opts.length) opts[Math.floor(Math.random() * opts.length)]();
      }
    }
    // atitude: gira no chão perdendo rotação; arfagem e rolagem assentam na pose de repouso
    this.axes();
    let yaw = Math.atan2(_pf.x, _pf.z), pit = Math.asin(clamp(_pf.y, -1, 1)), rl = Math.asin(clamp(_pl.y, -1, 1));
    this.yr *= Math.exp(-dt * (down ? 1.2 : 0.2)); yaw += this.yr * dt;
    if (down) { const a = 1 - Math.exp(-dt * 4); pit += (0 - pit) * a; rl += (this.wreckRoll - rl) * a; }
    this.q.setFromEuler(_pe.set(-pit, yaw, rl, 'YXZ'));
    if (Math.random() < dt * 25) fxBurn(this.pos.clone().add(rv(1.2)), 1.3);
    // parou: vira o destroço queimando de sempre (combustível que sobrou ainda estoura)
    if (down && V < 1.2 && this.wreckT > 1) {
      this.gone = true; this.burnAt = this.pos.clone(); this.burnT = 30;
      for (const m of this.mats || []) m.color.multiplyScalar(0.3);
      if (this.fuel > this.fuelMax * 0.15) { fxExplosion(this.pos.clone(), 1); sndBoom(this.pos, true); }
    }
  }
  crash() {
    if (this.gone) return;
    if (this.alive) destroyVehicle(this, this.doomed ? this.doomBy : this.lastHitT > S.now - 15 ? this.lastHitBy : null, this.doomed || 'crash');
    this.gone = true;
    fxBigBlast(this.pos.clone(), 1); sndBoom(this.pos, true); addCrater(this.pos, 4); shakeAt(this.pos, 1, 60);
    this.root.visible = false; this.burnAt = this.pos.clone(); this.burnT = 25;
    if (this.bombs.length) blast(this.pos.clone(), this.bombs.reduce((s, b) => s + b.tnt, 0) * 0.5, this.lastHitBy, { skipPlane: this });
  }
  remove() { scene.remove(this.root); this.label.remove(); const i = planes.indexOf(this); if (i >= 0) planes.splice(i, 1); }
}
