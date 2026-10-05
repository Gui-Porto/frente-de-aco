import * as THREE from 'three';
import { scene, camera } from '../core/render.js';
import { S, S as ST, planes } from '../core/state.js'; // ST: em physics() `S` é a área da asa
import { V3, QUAT, UP, clamp, lerp, rand, rv } from '../core/util.js';
import { H, AIRLIMIT, activeFields } from '../world/terrain.js';
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
const _gM = [0, 0, 0], _gw = new V3(), _gf = new V3(), _gr = new V3(), _gv = new V3(), _gh = new V3(), _gl = new V3(), _gt = new V3();
// níveis de detalhe: além de d m, piloto e peças com raio < r saem dos passes de desenho (camada 1).
// ~200 malhas por avião × (cor + sombra + AO) era o que derrubava o quadro com muitos aviões
const LOD = [[150, 0.3], [600, 1.0]], _ls = new V3();
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
      this.guns.push({ W, pts: pts.slice(0, g.n), ammo: g.ammo * g.n, max: g.ammo * g.n, acc: 0, k: 0, heat: 0, heatT: clamp(0.25 * g.ammo / (W.rpm / 60), 4, 8), jam: false, beltName, belt: beltRounds(W, beltName) });
    });
    this.bombs = []; this.rockets = 0;
    if (this.ordOn) { for (const b of D.bombs) for (let i = 0; i < b.n; i++) this.bombs.push(b); this.rockets = D.rockets ? D.rockets.n : 0; }
    else for (const m of [...this.bombMeshes, ...this.rocketMeshes]) m.visible = false;
    this.ord0 = { bombs: this.bombs.length, rockets: this.rockets }; // carga de saída (o rearme só faz sentido se gastou)
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
    this.loose = []; this.root.traverse(o => { if (o.userData.loose) this.loose.push(o); }); this.canopyOff = false;
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
    scene.remove(this.root); Object.assign(this, buildPlane(this.def)); scene.add(this.root); this._det = null; this._far = undefined;
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
    if (this.gearMesh) { if (this.gearMesh.userData.anim) this.gearMesh.userData.anim(this.gear, this._legK || (this._legK = n => this.legPos(n))); if (this.gearMesh.userData.squash) this.gearMesh.userData.squash(this.gc || 0); }
    this.animSurfaces();
    this.root.updateMatrixWorld(true); this.inv.copy(this.root.matrixWorld).invert();
    this.lodStep();
  }
  lodStep() {
    const d = this.pos.distanceTo(camera.position), lv = d > LOD[1][0] ? 2 : d > LOD[0][0] ? 1 : 0;
    if (lv === this._far) return; this._far = lv;
    if (!this._det) {
      // fora: hélice, trem (tem a própria regra), efeitos, armamento (visibilidade controlada em outro lugar)
      const skip = new Set([this.prop, this.gearMesh, ...this.bombMeshes, ...this.rocketMeshes, ...this.missileMeshes]), det = this._det = [];
      const walk = (o, all) => {
        if (skip.has(o)) return;
        if (o === this.pilotMesh) all = true;
        if (o.isMesh && (all || !o.userData.fx && !o.userData.door)) {
          const g = o.geometry; g.boundingSphere || g.computeBoundingSphere(); o.getWorldScale(_ls);
          const r = all ? 0 : g.boundingSphere.radius * Math.max(_ls.x, _ls.y, _ls.z);
          if (r < LOD[1][1]) det.push([o, r < LOD[0][1] ? 1 : 2]);
        }
        for (const c of o.children) walk(c, all);
      };
      walk(this.root, false);
    }
    for (const [o, k] of this._det) o.layers.set(lv >= k ? 1 : 0);
  }
  // desmaiado: sem comando nenhum (manche solto, sem disparar); 0..1 para escurecer a tela
  // escurecimento da tela: desmaiado = quase preto (0,85: ainda se vê o vulto; entra em 0,3 s, sai no último 1,2 s);
  // acordado = visão de túnel pela carga, no máximo 0,7 (o centro nunca some antes do desmaio). `gRed`: veio de G negativo (redout)
  // + escurecimento imediato pelo G do momento (de 3 G abaixo do limiar até 2 G acima: 0..0,4): puxando no limite
  // do avião já se sente o G, mesmo sem acumular carga para desmaiar
  get blackout() { const g = Math.max(Math.max(0, (this.gStress - 0.2) / 0.8) ** 1.3 * 0.7, clamp((this.n - (this.gT ?? 6) + 3) / 5, 0, 1) * 0.4); return this.koT > 0 ? Math.max(g, Math.min(0.85, this.koAge / 0.3, this.koT / 1.2)) : g; }
  physics(dt) {
    if (this.gone) return;
    if (this.wreck) return this.wreckStep(dt);
    if (!this.alive && this.pos.y - H(this.pos.x, this.pos.z) > 20) this.shedStep(dt); // abatido, caindo: desmancha no ar
    // desmaiado: o manche vai relaxando sozinho a partir de onde estava (o avião segue suave, sem controle); ao voltar a
    // si, o comando do piloto volta em rampa. Antes ia a zero de uma vez: o nariz desabava e voltava — "quicava"
    const kc = this._koC || (this._koC = [0, 0, 0]);
    if (this.koT > 0) { kc[0] *= Math.exp(-dt * 0.9); kc[1] *= Math.exp(-dt * 2.5); kc[2] *= Math.exp(-dt * 2.5); [this.elev, this.ail, this.rud] = kc; this.firing = false; this.koWake = 1.5; }
    else if (this.koWake > 0) { this.koWake = Math.max(0, this.koWake - dt); const w = 1 - this.koWake / 1.5; this.elev = kc[0] + (this.elev - kc[0]) * w; this.ail = kc[1] + (this.ail - kc[1]) * w; this.rud = kc[2] + (this.rud - kc[2]) * w; }
    else { kc[0] = this.elev; kc[1] = this.ail; kc[2] = this.rud; }
    const n0 = this.n, a0 = this.alpha;
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
    // trem baixado bem acima do limite: o vento arranca as pernas (não recolhe sozinho)
    if (!this.onGround && this.gearOut > 0.3 && this.ias > this.gearV * 1.15) {
      if ((this.overGear = (this.overGear || 0) + dt) > 0.8) { for (const n of ['L', 'R', 'N']) if (this.legPos(n) > 0.3) this.ripLeg(n); if (this.isPlayer) showDmg('Trem arrancado · velocidade acima do limite'); }
    } else this.overGear = 0;
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
      const CD = D.cd0 + CL * CL / (Math.PI * D.e * AR) + CDs + this.flaps * 0.028 + (this.brakeK || 0) * (D.brakeCd || 0.11) + this.gearOut * 0.035 + this.bombs.length * 0.0012 + this.rockets * 0.0004 + this.missiles * 0.0008 + waveDrag(D, mach) + (1 - kW) * 0.02 + (this.tailOn ? 0 : 0.01);
      // forças
      _pF.set(0, -m * G, 0);
      _pt.crossVectors(_pv, _pl); const ln = _pt.length();
      if (ln > 1e-4) _pF.addScaledVector(_pt.divideScalar(ln), qd * S * CL * kW);
      _pF.addScaledVector(_pv, -qd * S * CD);
      _pF.addScaledVector(_pl, -qd * S * 0.9 * beta);
      this.eng.step(h, this.throttle, this.wep, engK, this.engineOn);
      _pF.addScaledVector(_pf, this.eng.force(V, _atm, mach));
      // rodas/patins no chão: força em _pF, momentos (eixos do corpo) em _gM
      _gM[0] = _gM[1] = _gM[2] = 0;
      if (this.gearMesh && this.groundStep(h, m, _pF, _gM)) return;
      this.vel.addScaledVector(_pF, h / m);
      this.pos.addScaledVector(this.vel, h);
      this.n = (qd * S * CL * kW) / (m * G);
      // momentos (coeficientes de estabilidade e controle; eficácia ∝ pressão dinâmica)
      const ctrl = (this.pilot ? 1 : 0) * clamp(1 - (this.ias - (D.vctrl || 215)) / 75, 0.28, 1);
      const tE = this.tailOn ? 0.45 + 0.55 * clamp(this.hp.tail / this.maxHp.tail, 0, 1) : 0.06, Vd = Math.max(V, 20);
      const aE = clamp(alpha, -0.5, 0.5);
      // sopro da hélice na empenagem (pistão): com motor cheio e pouca velocidade o profundor e o leme já mandam —
      // é ele que levanta a cauda na corrida de decolagem; disco de ~3,2 m
      const qe = qd + (this.eng.jet ? 0 : 0.5 * this.eng.thrust / 8);
      let Mp = S * c * (qe * D.kde * (this.elev * ctrl * A.elev + (st('elevL') + st('elevR')) / 2) * tE - qd * 0.9 * aE * (this.tailOn ? 1 : 0.1)) - qd * S * c * c / (2 * Vd) * dmp[0] * this.pr * (this.tailOn ? 1 : 0.15);
      let Mr = qd * S * b * D.kda * (this.ail * A.ail + A.ailBias * 0.15) * ctrl * (this.wingOn.L && this.wingOn.R ? 1 : 0.5) - qd * S * b * b / (2 * Vd) * dmp[1] * this.rr * Math.max(kW, 0.3);
      this._ailAuth = qd * S * b * D.kda * A.ail * ctrl / Ir; // rad/s² por unidade de aileron: o instrutor limita o ganho por ela
      Mr += qd * S * CL * (hpL - hpR) / 2 * b * 0.22;           // assimetria de sustentação
      Mr += qd * S * b * (0.03 * (this.flapP.L - this.flapP.R) + D.kda * 0.5 * (st('ailL') + st('ailR'))); // flap assimétrico / aileron travado
      Mr += qd * S * c * D.kde * 0.25 * tE * (this.elev * ctrl * A.elevBias + (st('elevL') - st('elevR')) / 2) * (D.span * 0.18 / c); // profundor de um lado só também rola
      if (aa > as) Mr += qd * S * b * 0.02 * this.dropSign * Math.min(1, (aa - as) * 8); // queda de asa no estol
      if (!this.eng.jet) Mr -= this.eng.shaft * (this.eng.E.torque || 1) / 280 / Math.max(1, V / 60); // torque da hélice
      Mr += qd * S * b * 0.03 * beta;                             // efeito diedro
      let My = -this.eng.thrust * thrX + S * b * (qe * D.kdr * (this.rud * ctrl * A.rud + st('rud')) * tE + qd * 0.1 * beta * (this.tailOn ? 1 : 0.1)) - qd * S * b * b / (2 * Vd) * dmp[2] * this.yr;
      Mp -= _gM[0]; My += _gM[1]; Mr += _gM[2];
      this.pr += Mp / Ip * h; this.rr += Mr / Ir * h; this.yr += My / Iy * h;
      _pw.set(-this.pr, this.yr, this.rr).applyQuaternion(this.q);
      _pq.set(_pw.x * h * 0.5, _pw.y * h * 0.5, _pw.z * h * 0.5, 0).multiply(this.q);
      this.q.x += _pq.x; this.q.y += _pq.y; this.q.z += _pq.z; this.q.w += _pq.w; this.q.normalize();
    }
    if (Math.random() < dt * 0.3) this.dropSign = Math.random() < .5 ? 1 : -1;
    this.nRate = (this.nRate || 0) * 0.6 + 0.4 * (this.n - n0) / Math.max(dt, 1e-3); // taxa do G (G/s), filtrada: amortece o limitador
    this.aRate = (this.aRate || 0) * 0.6 + 0.4 * (this.alpha - a0) / Math.max(dt, 1e-3); // idem, ângulo de ataque (rad/s)
    // fisiologia do piloto: G SUSTENTADO acima da tolerância acumula carga (gStress 0..1). A tela vai escurecendo das
    // bordas para o centro (visão de túnel, `blackout`) e em 1 o piloto DESMAIA: alguns segundos sem controle, o avião
    // segue solto, depois ele volta a si. Sem texto nenhum — só a tela. Jato tem traje anti-G (+1 G); ferido apaga antes.
    // Limiar 6 G (pistão) / 6,5 G (jato): com 5 G o pistão (que vive a ~5,7 G sustentado em curva) apagava mais que o jato.
    // Só puxada forte acumula: pistão a 8 G ~4,5 s até o desmaio, 7 G ~8 s; jato a 9 G ~3,7 s. Negativo (redout): abaixo de −3 G.
    // Curvas seguidas ainda somam, mas solto o manche recupera em ~3 s.
    const gT = this.gT = (this.eng.jet ? 6.5 : 6) - (this.wounded ? 1 : 0);
    const gx = this.n > gT ? (this.n - gT) * 0.1 + 0.02 : this.n < -3 ? (-3 - this.n) * 0.15 : this.n > gT - 1.5 ? -0.08 : -0.3;
    if (this.n > gT - 2) this.gRed = false; else if (this.n < -3) this.gRed = true;
    // combustível: consumo do motor + vazamentos; seco = motor apaga
    const leak = fuelLeak(this);
    fuelStep(this, this.engineOn ? this.eng.flow : 0, dt);
    if (this.fuel <= 0 && this.engineOn && this.alive) { this.engineStop(); if (this.isPlayer) showDmg('Sem combustível'); }
    if (leak > 0 && this.fuel > 0 && Math.random() < dt * 35) for (const m of modsOf(this, 'fuel')) if (m.leak > 0 && m.left > 0) fxTrail(_pt.set(...m.c).applyMatrix4(this.root.matrixWorld).clone(), 0xf2f0ea, 0.45 + 0.1 * Math.min(m.leak, 4), 3); // névoa de combustível, mais grossa quanto maior o furo
    if (this.koT > 0) {
      this.koT -= dt; this.koAge += dt;
      if (this.koT <= 0) this.gStress = 0.55; // acorda ainda meio apagado: a visão volta aos poucos
    } else {
      this.gStress = clamp(this.gStress + gx * dt, 0, 1);
      if (this.gStress >= 1 && this.alive && this.pilot) { this.koT = 2.5 + Math.random() * 1.5; this.koAge = 0; this.gStress = 1; }
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
    // no chão quem cuida de rodas, barriga e cauda é o groundStep; aqui só a ponta da asa raspando (pouso inclinado)
    const reach = sd => (!this.wingOn[sd] ? this.def.span * 0.1 : this.tipOn[sd] ? this.def.span / 2 : this.tipX);
    const pts = [[0, 0, this.def.L * .45], [reach('L'), 0, 0], [-reach('R'), 0, 0], [0, 0, -this.def.L * .5], [0, -this.def.fuseR, 0]];
    for (let i = 0; i < pts.length; i++) {
      if (this.onGround && i !== 1 && i !== 2) continue;
      const [x, y, z] = pts[i];
      const wx = this.pos.x + _pl.x * x + _pu.x * y + _pf.x * z, wy = this.pos.y + _pl.y * x + _pu.y * y + _pf.y * z, wz = this.pos.z + _pl.z * x + _pu.z * y + _pf.z * z;
      // cauda/barriga encostando devagar não é batida: os patins do groundStep seguram e arrastam (com faísca)
      if (wy < H(wx, wz) + 0.2) { if ((i === 3 || i === 4) && this.gearMesh && -this.vel.y < (i === 3 ? 9 : 7)) continue; this.impact(i); return; }
    }
    // árvores: voo rasante pode bater na copa (asa inclusa: raio ~ 1/3 da envergadura)
    if (!this.onGround && this.pos.y - H(this.pos.x, this.pos.z) < 30 && treeHit(this.pos.x, this.pos.y, this.pos.z, this.def.span * 0.33)) { this.crash(); return; }
    for (const b of obstNear(this.pos.x - 6, this.pos.z - 6, this.pos.x + 6, this.pos.z + 6)) if (this.pos.x > b.mn[0] && this.pos.x < b.mx[0] && this.pos.z > b.mn[2] && this.pos.z < b.mx[2] && this.pos.y < b.mx[1]) { this.crash(); return; }
    // fora da arena conta tempo, exceto no corredor de pouso/decolagem das bases (a cabeceira fica perto do limite)
    const nearBase = activeFields().some(a => Math.abs(this.pos.x - a.x) < 800 && Math.abs(this.pos.z - a.z) < a.len / 2 + 3500);
    if (!nearBase && Math.max(Math.abs(this.pos.x), Math.abs(this.pos.z)) > (ST.airLimit || AIRLIMIT)) this.oobT += dt; else this.oobT = 0;
    if (this.oobT > 15 && this.alive) destroyVehicle(this, null, 'oob');
  }
  // Contato com o chão. Cada roda baixada e travada é uma mola-amortecedor no ponto do pneu (o amortecedor do trem),
  // com atrito de rolagem/freio no sentido da roda e aderência lateral do pneu; a roda do nariz (ou a bequilha)
  // esterça com o leme. Patins na barriga e na cauda pegam quando falta trem ou o nariz sobe demais. Forças e
  // momentos entram no MESMO integrador do voo: o avião afunda nos amortecedores, quica, inclina sobre uma roda,
  // derrapa e para pela física (antes atitude, altura e velocidade lateral eram cravadas no toque — "grudava").
  // Soma a força em F e os momentos (eixos do corpo) em Mo; devolve true se o toque destruiu o avião.
  groundStep(h, m, F, Mo) {
    const U = this.gearMesh.userData, D = this.def, hg = H(this.pos.x, this.pos.z);
    if (this.pos.y > hg + U.lift + 1.5) { this.onGround = false; this.gcv = 0; this.gc = Math.max(0, (this.gc || 0) - h * 3); return false; }
    this.axes();
    // rodas: [x, y, z (corpo), fração do peso, roda principal?, roda do nariz/bequilha?] + patins
    const nz = U.noseZ, mz = U.mainZ, span = Math.abs(nz - mz) || 1, shM = Math.abs(nz) / span, shN = Math.abs(mz) / span;
    const C = [];
    for (const [n, sx] of [['L', 1], ['R', -1]]) if ((this.legPos(n) ?? 0) > 0.98) C.push([sx * U.mainX, -U.lift, mz, shM / 2, 1, 0]);
    if ((this.legPos('N') ?? 0) > 0.98) C.push([0, -U.noseLift, nz, shN, 0, 1]);
    const fr = D.fuseR, L = D.L;
    for (const z of [L * 0.28, 0, -L * 0.22]) C.push([0, -fr * 0.92, z, 0, 0, 0]); // barriga
    C.push([0, -fr * 0.45, -L * 0.47, 0, 0, 0]);                                      // cauda
    const trav = U.travel || 0.2, V = Math.hypot(this.vel.x, this.vel.z), tail = U.pitch > 0;
    const brake = this.airbrake || this.throttle < 0.02;
    // roda do nariz esterça com o leme (menos com a velocidade); bequilha, ao contrário e pouco
    const steer = tail ? -this.rud * 0.3 * clamp(1.2 - V / 25, 0, 1) : this.rud * 0.6 * clamp(1.2 - V / 35, 0.12, 1);
    _gw.set(-this.pr, this.yr, this.rr).applyQuaternion(this.q);
    _gf.copy(_pf).setY(0); if (_gf.lengthSq() < 1e-6) _gf.set(0, 0, 1); _gf.normalize();
    let any = 0, wheel = 0, comp = 0, nm = 0, tailW = 0, bellyW = 0;
    for (const [x, y, z, sh, main, nose] of C) {
      _gr.set(0, 0, 0).addScaledVector(_pl, x).addScaledVector(_pu, y).addScaledVector(_pf, z);
      const px = this.pos.x + _gr.x, py = this.pos.y + _gr.y, pz = this.pos.z + _gr.z, d = H(px, pz) - py;
      if (main) { comp += Math.max(0, d) / trav; nm++; }
      if (d <= 0) continue;
      any++; if (sh > 0) wheel++;
      _gv.crossVectors(_gw, _gr).add(this.vel); // velocidade do ponto
      // mola calibrada para o peso parado afundar 35% do curso; batendo no fim do curso fica 8× mais dura
      // oleopneumático: amortece pouco comprimindo e muito voltando (o orifício segura o retorno — é o que evita o quique)
      const skid = sh === 0, k = skid ? m * G0 / 0.05 : sh * m * G0 / (0.35 * trav), cc = 2 * Math.sqrt(k * Math.max(sh, 0.3) * m);
      const c = cc * (skid ? 0.9 : _gv.y < 0 ? 0.45 : 1.6);
      let Fn = k * d + (d > trav * 1.4 ? k * 7 * (d - trav * 1.4) : 0) - c * _gv.y;
      if (Fn <= 0) continue;
      // sentido da roda no chão (girado pelo esterço) e o lado
      _gh.copy(_gf); if (nose && steer) _gh.applyAxisAngle(UP, steer);
      _gl.crossVectors(UP, _gh);
      const vl = _gv.dot(_gh), vs = _gv.dot(_gl);
      // pneu: deriva com rigidez finita (satura em ~1,2 m/s de escorregamento lateral) antes de patinar
      const mu = skid ? 0.5 : main && brake ? (tail ? 0.32 : 0.45) : 0.02, muL = skid ? 0.5 : 0.6;
      _gt.set(0, Fn, 0)
        .addScaledVector(_gh, -mu * Fn * clamp(vl / 0.3, -1, 1))
        .addScaledVector(_gl, -muL * Fn * clamp(vs / 1.2, -1, 1));
      F.add(_gt);
      // chapa raspando no chão: faísca, guincho de metal e desgaste (carga × velocidade) — cauda no cone, barriga na fuselagem
      const sv = skid ? Math.hypot(_gv.x, _gv.z) : 0;
      if (sv > 4) {
        if (Math.random() < h * (12 + sv)) fxSparks(new V3(px, py + 0.15, pz), 3 + Math.min(6, sv / 15 | 0));
        if (this.isPlayer && sv > 15 && Math.random() < h * 1.5) sndTear(_pt.set(px, py, pz));
        const w = Fn / (m * G0) * sv / 70 * h;
        if (z < -L * 0.4) tailW += w; else bellyW += w;
      }
      _gt.crossVectors(_gr, _gt); // momento no mundo → eixos do corpo (x = asa esq., y = cima, z = nariz)
      Mo[0] += _gt.dot(_pl); Mo[1] += _gt.dot(_pu); Mo[2] += _gt.dot(_pf);
    }
    this.gc = nm ? clamp(comp / nm, 0, 1) : 0; // o modelo afunda o amortecedor do mesmo tanto
    // desgaste do arrasto: raspão de cauda curto só amassa; arrastar muito tempo rápido corta o cone de cauda.
    // De barriga, a fuselagem aguenta parar se o toque não foi violento (pouso de barriga de verdade)
    const bm = this.mods && this.mods.boom;
    if (tailW && bm && !bm.lost && this.tailOn) { bm.hp -= bm.max * 0.5 * tailW; if (bm.hp <= 0) { bm.dead = true; this.loseTail(); } }
    if (bellyW) { this.hp.fuse -= this.maxHp.fuse * 0.06 * bellyW; if (this.hp.fuse <= 0) { if (this.isPlayer) showDmg('Fuselagem partiu no arrasto'); this.toWreck(); return true; } }
    const hasW = C.some(c => c[3] > 0), wasW = this.wheelOn; this.wheelOn = wheel > 0;
    const was = this.onGround; this.onGround = any > 0;
    // avaliação do toque: quando as RODAS tocam (cauda raspando antes não é pouso) ou, sem trem, no primeiro contato
    if (!this.onGround || (hasW ? !this.wheelOn || wasW : was)) return false;
    const belly = !hasW, pitch = Math.asin(clamp(_pf.y, -1, 1)), roll = _pl.y, vs = -this.vel.y, ar = Math.abs(roll);
    const side = roll > 0 ? 'R' : 'L', msg = t => { if (this.isPlayer) showDmg(t); };
    // Pouso forte — o que acontece, por gravidade (vs = razão de descida no toque, m/s):
    //  > 25: bola de fogo · trem: > 16 (barriga: > 12) ou asa > ~52°: a estrutura parte e vira destroço deslizando
    //  trem: > 10, muito rápido ou de nariz: o trem quebra e o avião se ARRASTA de barriga até parar (piloto vivo)
    //  asa > ~32°: a ponta raspa e cai · > 5: pouso duro (estrutura amassada) · abaixo disso: pouso
    if (vs > 25) { msg('Pouso falhou: bateu forte demais'); this.crash(); return true; }
    if (vs > (belly ? 12 : 16) || ar > 0.8 || (belly && this.ias > 380 / 3.6)) {
      msg(`Pouso falhou: ${ar > 0.8 ? 'asa no chão' : vs > 12 ? 'a estrutura partiu' : 'rápido demais de barriga'}`);
      if (ar > 0.55) this.breakTip(side); this.collapseGear(); this.toWreck(); return true;
    }
    this.touchT = ST.now; this.touchV = vs;
    let broke = null;
    if (!belly) {
      const fast = this.ias > this.gearV * 1.15;
      if (vs > 10 || fast) { this.collapseGear(); broke = fast ? `rápido demais (${Math.round(this.ias * 3.6)} km/h): trem quebrou` : 'trem quebrou'; }
      else if (pitch < -0.3) { this.ripLeg('N'); broke = 'de nariz: bequilha do nariz quebrou'; }
    }
    if (ar > 0.55) { this.breakTip(side); if (!belly) this.ripLeg(side); broke = broke || 'ponta da asa raspou'; }
    const hard = vs > 5 || !!broke;
    if (hard) { this.hp.fuse -= this.maxHp.fuse * 0.12 * (1 + Math.max(0, vs - 5) / 4); if (this.hp.fuse <= 0) { msg('Pouso falhou: a estrutura partiu'); this.collapseGear(); this.toWreck(); return true; } }
    if (broke) { msg(`Pouso forte: ${broke} · arrastando`); this.landMsgT = ST.now; }
    if (belly || !this.gearDown) { this.engs.forEach((e, i) => { if (e.on && !D.jet) this.engineOut(i); }); } // hélice bate no chão
    else {
      // o pneu parado no ar esfola na pista (fumaça) e a cabine sente o tranco
      if (V > 25) for (const sx of [1, -1]) { _pt.set(sx * U.mainX, -U.lift, U.mainZ).applyMatrix4(this.root.matrixWorld); for (let i = 0; i < 3; i++) fxTrail(_pt.clone().add(rv(0.3)), 0xdedcd6, 0.35 + Math.min(vs, 6) * 0.06, 1.6 + Math.random()); }
      if (this.isPlayer) shakeAt(this.pos, 0.25 + Math.min(vs, 10) * 0.12, 50);
    }
    if (this.isPlayer && !broke && (hard || belly || ST.now - (this.landMsgT || -9) > 3)) { this.landMsgT = ST.now; showDmg(belly ? 'Pouso de barriga' : hard ? 'Pouso duro · estrutura danificada' : 'Pouso', !hard && !belly); }
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
    let aimRate = 0; // quanto o erro de arfagem anda só porque a MIRA andou (eixos atuais): o amortecimento não freia a curva pedida
    if (opts.lead) {
      if (!this._aimPrev) { this._aimPrev = dir.clone(); this._aimVel = new V3(); this._aimR = 0; }
      const ang = d => Math.atan2(d.dot(_pu), Math.max(d.dot(_pf), 0.05));
      this._aimR += ((ang(dir) - ang(this._aimPrev)) / Math.max(dt, 1e-3) - this._aimR) * (1 - Math.exp(-dt * 10));
      aimRate = clamp(this._aimR, -1.2, 1.2);
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
    // anti-windup: só soma perto da mira (< ~5°) e sem o limitador de G/ângulo de ataque atuando; fora disso esvazia.
    // Antes somava até 17° e em curva puxada enchia (0,3): ao parar o mouse o nariz passava ~6° do círculo e voltava em 3 s
    if (off < 0.09 && !this._elevLim) this.iP = clamp(this.iP + (nose ? eN : pe) * dt, -0.15, 0.15);
    else this.iP *= Math.exp(-dt * 4);
    const trim = this.onGround ? 0 : 0.9 * clamp(this.alpha, -0.5, 0.5) / D.kde; // no chão o ângulo de ataque é da atitude parada, não pede profundor
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
    // círculo ABAIXO do nariz (até ~60°, quase sem desvio lateral; ex.: soltar o S no modo mouse): o jogador empurra
    // o nariz de volta. Antes pedia ±180° de inclinação com o sinal decidido pelo ruído de dl → rolava de dorso
    const push = nose && !this.nearAim && du < 0 && off < 1.05 && Math.abs(dl) < -du;
    let bank = Math.atan2(-dl, this.nearAim ? Math.abs(du) + 0.08 : push ? -du : du);
    // e a inclinação fica limitada ao tamanho do erro: 8° ao lado pedia ~80° de asa e uma puxada que passava do alvo
    // e voltava (MiG-21/F-4 balançavam 40°↔84° depois de a mira parar)
    if (this.nearAim) { const lim = Math.PI / 2 * clamp(off / 0.3, 0.3, 1); bank = clamp(bank, -lim, lim); }
    // no chão não se inclina para virar (tombaria o avião sobre uma roda): aileron só nivela, quem vira é o leme/roda
    const w = this.onGround || opts.level || opts.recover ? 0 : nose ? clamp((off - 0.02) / 0.09, 0, 1) : clamp((off - 0.06) / 0.2, 0, 1);
    // nivelar: ganho 0,6 perto do nível (não balança), mais forte com muita inclinação a desfazer — parando o mouse
    // depois de uma curva o avião desfazia 90° a ~25°/s e o nariz ficava ~3,5° ao lado do círculo por 3 s
    const rollErr = lerp(level * (0.6 + 0.7 * clamp(Math.abs(level) - 0.35, 0, 1)), bank, w);
    // "rola, depois puxa": com muita rolagem pela frente o profundor espera (puxar/empurrar inclinado
    // jogava o nariz para o lado, criava erro lateral e o avião ficava rolando para lá e para cá)
    const rp = lerp(1, clamp(Math.cos(rollErr), 0.15, 1), w);
    // ganhos do instrutor por avião (def.steer = { kp, kd, ka, kr, ky }); padrão = o que serve à maioria
    const SP = D.steer || {}, kp = SP.kp ?? 3.2, kd = SP.kd ?? 0.9, ka = SP.ka ?? 3.1, kr = SP.kr ?? 1.8, ky = SP.ky ?? 1.6;
    let elev = off > 1.4 && du < 0 ? 1 : K * (kp * pe * rp - kd * (this.pr - aimRate)) + trim + (nose ? 1.2 * this.iP : 0);
    // recuperação perto do chão: desvira primeiro, puxa depois — de dorso, "alvo atrás e abaixo → puxa" era um
    // split-S para dentro do chão (medido: IA a 6 G com 100–160° de inclinação até bater)
    if (opts.recover) elev *= clamp((wu - 0.25) / 0.45, 0, 1);
    const elev0 = elev;
    // amortecimento 2.0 (era 0.55): medido em curva contínua de 20°/s, a inclinação oscilava 35°↔120° com aileron batendo ±1
    // o comando fica parado o quadro inteiro (vários passos de física): com muita pressão dinâmica (jato > ~1000 km/h)
    // o amortecimento 2,0 corrigia demais num quadro e a rolagem alternava ±46°/s a cada quadro — asa "tremendo" na
    // tela. O ganho é cortado para que um quadro desfaça no máximo ~70% da taxa de rolagem
    const rk = Math.min(1, 0.7 / (2.0 * K * (this._ailAuth || 0) * Math.max(dt, 1 / 240) + 1e-6));
    this.ail = clamp(K * rk * (ka * rollErr - 2.0 * this.rr), -1, 1);
    // leme: corrige pequenos desvios e anula a derrapagem
    const yawErr = Math.atan2(dl, Math.max(df, 0.05));
    // integral lateral (modo nariz): perto da mira a inclinação quase não age e o leme proporcional era fraco —
    // depois de uma curva o nariz ficava ~3° ao lado do círculo parado por mais de 3 s (Spitfire, medido)
    if (nose && off < 0.09 && !this.onGround) this.iY = clamp((this.iY || 0) + yawErr * dt, -0.1, 0.1);
    else this.iY = (this.iY || 0) * Math.exp(-dt * 4);
    this.rud = clamp(K * kr * yawErr * (1 - w * 0.7) - ky * this.yr + (nose ? 4 * this.iY : 0), -1, 1);
    elev = this.limitElev(elev, opts);
    // no chão: mira no horizonte ou abaixo = fica rolando (sem puxar); mira acima = roda e decola
    // no chão: mira no horizonte ou abaixo = rola sem puxar; bequilha: empurra para levantar a cauda na corrida (decola
    // na atitude certa, não de três pontos perto do estol); triciclo: pouco, senão bate a roda do nariz
    if (this.onGround) elev = dir.y < 0.03 ? clamp(elev, this.def.jet ? -0.2 : -0.8, 0) : Math.min(elev, 0.8);
    this._elevLim = Math.abs(elev - elev0) > 0.02;
    this.elev = clamp(elev, -1, 1);
  }
  // limitadores do instrutor (sem estol, G máximo/mínimo); também valem para W/S no modo mouse
  limitElev(elev, opts = {}) {
    const D = this.def, as = D.clmax / D.cla, aLim = as * (opts.aoa ?? 0.86 + this.flaps * 0.08);
    // sem estol; o termo −pr amortece o limitador (sem ele o F-86 em curva fechada ia de 2,3 a 9,3 G a cada ~0,8 s)
    elev = Math.min(elev, 0.9 * aLim / D.kde + (aLim - this.alpha) * 7 - this.pr - 1.5 * Math.max(0, this.aRate || 0));
    // limite de G com amortecimento pela taxa do G: só proporcional, o G passava, o limitador cortava, caía e voltava
    // (no W direto o F-86 ia 10,6 → 6,3 → 9,8 → 7,5 G — o avião "quicava" no limite)
    elev = Math.min(elev, ((opts.glim || 8.5) - this.n) * 0.6 + 0.25 - 0.09 * Math.max(0, this.nRate || 0));
    elev = Math.max(elev, -0.9 * as * 0.6 / D.kde + (-as * 0.6 - this.alpha) * 7);
    return Math.max(elev, (-(opts.gneg || 2.5) - this.n) * 0.6 - 0.25);                 // limite de G negativo
  }
  // direção de tiro: armas FIXAS no eixo do avião, como no WT (quem aponta é o avião, não o mouse)
  fireDir(out) { this.axes(); return out.copy(_pf); }
  gunsPos(g, i, out) { const p = g.pts[i]; return out.set(p[0], p[1], p[2]).applyMatrix4(this.root.matrixWorld); }
  updateWeapons(dt) {
    if (!this.alive || !this.pilot) return;
    const gunsOK = powered(this, 'guns'); // disparo pneumático (Spitfire) ou elétrico (Fw 190)
    for (const g of this.guns) {
      // aquecimento do cano: trava depois de ~1/4 do pente em rajada contínua (4–8 s; antes 14 s para todas) até esfriar
      const shooting = this.firing && g.ammo > 0 && !g.jam && !g.broken && gunsOK;
      g.heat = clamp(g.heat + (shooting ? dt / g.heatT : -dt / 9), 0, 1);
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
  hitFx(lp, he, ld, blastR, dmg = 1, am = null) {
    if (this.isPlayer) sndHit(he);
    if (lp && blastR) {
      // explosão: as peças soltas no raio levam o estrago (capota, painéis, tanques…) e os rombos
      _pt.set(lp[0], lp[1], lp[2]).applyMatrix4(this.root.matrixWorld);
      for (const o of this.loose.slice()) { const d = o.getWorldPosition(_pw).distanceTo(_pt); if (d < blastR * 1.2) this.hurtPiece(o, dmg * (1 - d / (blastR * 1.2)), true); }
      return fxBlast(this, lp, blastR);
    }
    // explosiva com a estrutura já castigada arranca o painel (aparece o interior)
    const weak = he && this.hp && Object.keys(this.hp).some(k => this.hp[k] < this.maxHp[k] * 0.55);
    const hit = lp && fxHole(this, lp, ld, he, 3, 0, { cal: am && am.cal, inc: am && am.inc > 0.2, pen: am && am.pen, panel: he && (weak || Math.random() < 0.15) });
    if (hit) this.hurtPiece(hit.object, dmg, he);
    const at = hit && hit.point;
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
  // peças soltas (userData.loose: capota, radome, tanques, painéis de acesso, freios): o acerto na malha sobe até a
  // peça e gasta a vida dela; zerou, ela se solta e cai como destroço
  hurtPiece(obj, dmg, he) {
    let o = obj; while (o && o !== this.root && !o.userData.loose) o = o.parent;
    if (!o || o === this.root || o.userData.off) return;
    o.userData.lhp = (o.userData.lhp ?? o.userData.loose.hp) - dmg * (he ? 1.6 : 1);
    if (o.userData.lhp <= 0) this.shedPiece(o);
  }
  shedPiece(o) {
    if (o.userData.off || !o.parent) return; o.userData.off = true;
    const L = o.userData.loose; this.loose = this.loose.filter(x => x !== o);
    if (L.k === 'brake' && this.brakes) this.brakes = this.brakes.filter(b => b.pivot !== o);
    if (L.k === 'canopy') this.canopyOff = true;
    const at = o.getWorldPosition(new V3());
    if (L.k === 'tank' && Math.random() < 0.3) fxBurn(at.clone(), 1.6);
    fxFlakes(this, at, L.k === 'hatch' ? 1 : 2, true);
    const d = this.detach(o, L.mass);
    // a capota e os painéis saem levantados pelo vento relativo
    if (d && d.body && (L.k === 'canopy' || L.k === 'hatch')) { this.axes(); const v = d.body.linvel(); d.body.setLinvel({ x: v.x + _pu.x * 8, y: v.y + _pu.y * 8, z: v.z + _pu.z * 8 }, true); }
  }
  // avião morto ainda no ar: vai soltando pedaços na queda (mais rápido pegando fogo); k = chance de cada peça sair já
  breakup(k = 0.5) {
    for (const o of this.loose.slice()) if (Math.random() < k) this.shedPiece(o);
    for (const n in this.surf || {}) if (Math.random() < k * 0.5 && this.mods[n]) this.ripSurface(this.mods[n]);
  }
  shedStep(dt) {
    if ((this.shedT = (this.shedT ?? rand(0.4, 1)) - dt * (this.fire > 0 ? 2 : 1)) > 0) return;
    this.shedT = rand(0.6, 1.6);
    const opts = this.loose.map(o => () => this.shedPiece(o));
    for (const n in this.surf || {}) opts.push(() => this.mods[n] && this.ripSurface(this.mods[n]));
    for (const sd of ['L', 'R']) if (this.tipOn[sd] && this.wingOn[sd] && Math.random() < 0.3) opts.push(() => this.breakTip(sd));
    if (opts.length) opts[Math.floor(Math.random() * opts.length)]();
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
    if (this.legPos(side) != null) { const m = this.mods['gear' + side]; if (this.legPos(side) > 0.03) this.ripLeg(side); else if (m) { m.lost = m.dead = true; const p = this.gearMesh && this.gearMesh.userData.legs[side]; if (p) p.removeFromParent(); } } // a perna vai com a asa
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
  collapseGear() { for (const n of ['L', 'R', 'N']) if (this.legPos(n) > 0.3) this.ripLeg(n); }
  // posição de cada perna do trem ('L', 'R', 'N'): a comandada; travada fica onde parou; arrancada = null
  // bequilha dos pistão é fixa (Spitfire IX, Fw 190 e Il-2 deixam a roda para fora): sempre baixada, até ser arrancada
  legPos(n) { const m = this.mods && this.mods['gear' + n], k = n === 'N' && !this.def.jet ? 1 : this.gear; return !m ? k : m.lost ? null : m.dead && k !== 1 ? m.stuck : k; }
  // extensão média (arrasto) e trem em condição de pouso (principais — e o do nariz no jato — todo baixados)
  get gearOut() { let s = 0; for (const n of ['L', 'R', 'N']) s += this.legPos(n) || 0; return s / 3; }
  get gearDown() { return ['L', 'R', ...(this.def.jet ? ['N'] : [])].every(n => (this.legPos(n) ?? 0) > 0.98); }
  jamLeg(n) { const m = this.mods['gear' + n]; if (m) { m.dead = true; m.stuck = this.gear; } }
  // perna arrancada: baixada, vira destroço; recolhida, fica presa no alojamento (só não desce mais)
  ripLeg(n) {
    const m = this.mods['gear' + n]; if (!m || m.lost) return;
    const out = this.legPos(n) > 0.03, p = this.gearMesh && this.gearMesh.userData.legs[n];
    if (!out) return this.jamLeg(n);
    m.lost = m.dead = true;
    if (p && p.parent) this.detach(p, n === 'N' ? 40 : 70);
  }
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
