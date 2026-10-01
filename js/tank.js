'use strict';
// =====================================================================
// Blindados: modelo, corpo rígido com suspensão por roda, lagartas, câmbio
// =====================================================================
const CREW = [['driver', 'Motorista', 'MOT'], ['radio', 'Op. de rádio', 'RÁD'], ['gunner', 'Atirador', 'ATI'], ['commander', 'Comandante', 'CMD'], ['loader', 'Municiador', 'MUN']];
const MODS = { engine: ['Motor', 22], transmission: ['Transmissão', 25], tracks: ['Esteira', 11], breech: ['Culatra', 18], drive: ['Giro da torre', 15] };
const GEARS = [0.15, 0.3, 0.5, 0.74, 1.0];

function hullProfile(D) {
  const L = D.L, y0 = D.clr, y1 = D.clr + D.Hh;
  const s = D.armor.front[1] * DEG, ls = D.armor.lfront[1] * DEG, rs = D.armor.rear[1] * DEG;
  const lh = D.Hh * 0.4, gh = D.Hh - lh;
  const gRun = Math.min(gh * Math.tan(s), L * 0.28), lRun = Math.min(lh * Math.tan(ls), L * 0.12), rRun = Math.min(D.Hh * 0.5 * Math.tan(rs), 0.6);
  D.gRun = gRun;
  return [[L / 2 - lRun, y0], [L / 2, y0 + lh], [L / 2 - gRun, y1], [-L / 2 + rRun, y1], [-L / 2, y1 - D.Hh * 0.5], [-L / 2 + 0.3, y0]];
}
function turretShape(T) {
  const w = T.w, l = T.l;
  if (T.shape === 'hex') return [[-w * .3, l / 2], [w * .3, l / 2], [w / 2, l * .12], [w / 2, -l * .35], [w * .38, -l / 2], [-w * .38, -l / 2], [-w / 2, -l * .35], [-w / 2, l * .12]];
  if (T.shape === 'open') { const r = [], n = 9; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + Math.PI / n; r.push([Math.sin(a) * w / 2, Math.cos(a) * l / 2]); } return r; }
  return [[-w * .44, l / 2], [w * .44, l / 2], [w / 2, l * .3], [w / 2, -l * .3], [w * .36, -l / 2], [-w * .36, -l / 2], [-w / 2, -l * .3], [-w / 2, l * .3]];
}
// Textura de elos da lagarta (rolagem com a velocidade de cada lado)
const trackTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 16; const g = c.getContext('2d');
  g.fillStyle = '#26251f'; g.fillRect(0, 0, 64, 16);
  for (let i = 0; i < 4; i++) { g.fillStyle = '#4a4740'; g.fillRect(i * 16 + 2, 1, 11, 14); g.fillStyle = '#18170f'; g.fillRect(i * 16 + 6, 2, 3, 12); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; return t;
})();

// Espessura nominal por face, usada pelo visualizador de blindagem do hangar
function plateThickness(D, part, n, y) {
  const A = D.armor;
  if (part === 'hull') {
    if (n.y > 0.97) return A.top;
    if (n.y < -0.9) return A.bottom;
    if (Math.abs(n.x) > 0.6) return A.side[0];
    if (n.z > 0.2) return y < D.clr + D.Hh * 0.4 ? A.lfront[0] : A.front[0];
    if (n.z < -0.2) return A.rear[0];
    return A.side[0];
  }
  if (part === 'mantlet') return A.tFront[0];
  if (n.y > 0.9) return A.tTop || 1;
  if (n.z > 0.55) return A.tFront[0];
  if (n.z < -0.55) return A.tRear[0];
  return A.tSide[0];
}
const ARMOR_VS = 'attribute float thick; varying float vT; varying vec3 vN; varying vec3 vV; void main(){ vT=thick; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=mv.xyz; gl_Position=projectionMatrix*mv; }';
const ARMOR_FS = 'varying float vT; varying vec3 vN; varying vec3 vV; vec3 ramp(float e){ vec3 c0=vec3(0.75,0.08,0.05), c1=vec3(0.95,0.5,0.08), c2=vec3(0.95,0.85,0.2), c3=vec3(0.35,0.75,0.25), c4=vec3(0.15,0.45,0.85); if(e<30.0) return mix(c0,c1,e/30.0); if(e<70.0) return mix(c1,c2,(e-30.0)/40.0); if(e<120.0) return mix(c2,c3,(e-70.0)/50.0); return mix(c3,c4,clamp((e-120.0)/100.0,0.0,1.0)); } void main(){ float c=abs(dot(normalize(vN),normalize(-vV))); float e=vT/max(c,0.08); vec3 col=ramp(e)*(0.55+0.45*c); gl_FragColor=vec4(col,1.0); }';
const armorMat = new THREE.ShaderMaterial({ vertexShader: ARMOR_VS, fragmentShader: ARMOR_FS });
function tagArmor(mesh, D, part) {
  const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, th = new Float32Array(pos.count), n = new V3(), p = new V3();
  // normais no espaço da peça (hull/turret), considerando rotação/translação local da malha
  const m3 = new THREE.Matrix3().getNormalMatrix(mesh.matrix);
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nor, i).applyMatrix3(m3).normalize();
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
    th[i] = part === 'track' ? 20 : part === 'gun' ? 40 : plateThickness(D, part, n, p.y);
  }
  g.setAttribute('thick', new THREE.BufferAttribute(th, 1));
  mesh.userData.normalMat = mesh.material;
}

function buildTank(D) {
  const root = new THREE.Group();
  const camo = new THREE.MeshStandardMaterial({ color: lin(D.color), roughness: .82, metalness: .2 });
  const dark = new THREE.MeshStandardMaterial({ color: lin(0x1c1c19), roughness: .95, metalness: .1 });
  const steel = new THREE.MeshStandardMaterial({ color: lin(D.color).multiplyScalar(0.6), roughness: .7, metalness: .3 });
  const trackL = new THREE.MeshStandardMaterial({ map: trackTex.clone(), roughness: .95, metalness: .2 });
  const trackR = new THREE.MeshStandardMaterial({ map: trackTex.clone(), roughness: .95, metalness: .2 });
  for (const m of [trackL, trackR]) { m.map.needsUpdate = true; m.map.repeat.set(D.L * 2.6, 1); }
  const meshes = [];
  const add = (geo, mat, parent, x = 0, y = 0, z = 0, part) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    if (part) { m.updateMatrix(); tagArmor(m, D, part); meshes.push(m); }
    return m;
  };
  const it = D.W - 2 * D.trackW + 0.06, y1 = D.clr + D.Hh;
  const sh = new THREE.Shape(); hullProfile(D).forEach(([z, y], i) => i ? sh.lineTo(z, y) : sh.moveTo(z, y));
  const hg = new THREE.ExtrudeGeometry(sh, { depth: it, bevelEnabled: false }); hg.rotateY(-Math.PI / 2); hg.translate(it / 2, 0, 0);
  add(hg, camo, root, 0, 0, 0, 'hull');
  const deckH = D.Hh * 0.42;
  add(new THREE.BoxGeometry(D.W, deckH, D.L - D.gRun - 0.25), camo, root, 0, y1 - deckH / 2, (0.25 - D.gRun) / 2, 'hull');
  // detalhes: escapamentos, ganchos, caixa de ferramentas
  for (const s of [1, -1]) add(new THREE.CylinderGeometry(.09, .09, .5, 8).rotateX(Math.PI / 2), dark, root, s * D.W * .25, y1 - .25, -D.L / 2 - .15);
  add(new THREE.BoxGeometry(D.W * .5, .25, .5), steel, root, 0, y1 + .12, -D.L * .38);
  const th = D.clr + 0.42, wheels = [];
  for (const sd of [1, -1]) {
    add(new THREE.BoxGeometry(D.trackW, th, D.L * 0.95), sd > 0 ? trackL : trackR, root, sd * (D.W / 2 - D.trackW / 2), th / 2 + 0.03, 0, 'track');
    const r = th * 0.36;
    for (let i = 0; i < D.wheels; i++) {
      const z = -D.L * 0.4 + i * (D.L * 0.8 / (D.wheels - 1));
      const w = add(new THREE.CylinderGeometry(r, r, 0.08, 14), steel, root, sd * (D.W / 2 + 0.03), r + 0.07, z); w.rotation.z = Math.PI / 2;
      const hub = add(new THREE.BoxGeometry(.1, r * 1.2, .08), dark, w, 0, 0, 0); hub.rotation.x = 0;
      wheels.push({ m: w, side: sd, r });
    }
    // roda motriz e tensora
    for (const zz of [D.L * 0.46, -D.L * 0.46]) { const w = add(new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.12, 12), dark, root, sd * (D.W / 2 + 0.02), th * 0.62, zz); w.rotation.z = Math.PI / 2; wheels.push({ m: w, side: sd, r: r * 1.05 }); }
  }
  const T = D.turret, turret = new THREE.Group(); turret.position.set(0, y1, T.z); root.add(turret);
  let tm;
  if (T.shape === 'round') { tm = new THREE.CylinderGeometry(T.w / 2 * 0.86, T.w / 2, T.h, 16); tm.scale(1, 1, T.l / T.w); tm.translate(0, T.h / 2, 0); }
  else {
    const s2 = new THREE.Shape(); turretShape(T).forEach(([x, z], i) => i ? s2.lineTo(x, -z) : s2.moveTo(x, -z));
    if (T.shape === 'open') { const hole = new THREE.Path(); turretShape({ w: T.w - .12, l: T.l - .12, shape: 'open' }).forEach(([x, z], i) => i ? hole.lineTo(x, -z) : hole.moveTo(x, -z)); s2.holes.push(hole); }
    tm = new THREE.ExtrudeGeometry(s2, { depth: T.h, bevelEnabled: T.shape !== 'open', bevelThickness: .05, bevelSize: .06, bevelSegments: 1 }); tm.rotateX(-Math.PI / 2);
  }
  add(tm, camo, turret, 0, 0, 0, 'turret');
  if (T.shape !== 'open') add(new THREE.CylinderGeometry(.32, .34, .28, 12), camo, turret, T.w * .22, T.h + .12, -T.l * .22);
  const gunPivot = new THREE.Group(); gunPivot.position.set(0, T.h * .5, T.shape === 'open' ? 0.1 : T.l / 2 - 0.05); turret.add(gunPivot);
  const g = D.gun, muzzles = [];
  if (g.auto) {
    add(new THREE.BoxGeometry(.9, .5, .9), steel, gunPivot, 0, 0, 0, 'gun');
    for (const [bx, by] of [[-.26, .14], [.26, .14], [-.26, -.14], [.26, -.14]]) {
      const bg = new THREE.CylinderGeometry(.03, .045, g.len, 8); bg.rotateX(Math.PI / 2);
      add(bg, dark, gunPivot, bx, by, g.len / 2 + .3);
      const mz = new THREE.Object3D(); mz.position.set(bx, by, g.len + .35); gunPivot.add(mz); muzzles.push(mz);
    }
  } else {
    add(new THREE.BoxGeometry(T.w * (D.key === 'tiger' ? .62 : .45), T.h * .78, .32), camo, gunPivot, 0, 0, .12, 'mantlet');
    const r = g.cal / 1000 * 0.75 + 0.03;
    const bg = new THREE.CylinderGeometry(r, r * 1.35, g.len, 12); bg.rotateX(Math.PI / 2);
    add(bg, steel, gunPivot, 0, 0, g.len / 2 + .2);
    if (g.brake) { const mb = new THREE.CylinderGeometry(r * 1.9, r * 1.9, .42, 10); mb.rotateX(Math.PI / 2); add(mb, steel, gunPivot, 0, 0, g.len + .1); }
    const mz = new THREE.Object3D(); mz.position.set(0, 0, g.len + .4); gunPivot.add(mz); muzzles.push(mz);
    const co = new THREE.CylinderGeometry(.02, .02, .4, 6); co.rotateX(Math.PI / 2); add(co, dark, gunPivot, T.w * .14, .05, .45);
  }
  const mgMuzzle = new THREE.Object3D(); mgMuzzle.position.set(T.w * .14, .05, .7); gunPivot.add(mgMuzzle);
  return { root, turret, gunPivot, muzzles, mgMuzzle, mats: [camo, dark, steel, trackL, trackR], wheels, armorMeshes: meshes, trackL, trackR };
}
function setArmorView(v, on) { for (const m of v.armorMeshes) m.material = on ? armorMat : m.userData.normalMat; }

let VID = 0;
const _m4 = new THREE.Matrix4(), _ax = new V3(), _ay = new V3(), _az = new V3(), _wp = new V3(), _rr = new V3(), _vp = new V3(), _F = new V3(), _T = new V3(), _tn = new V3(), _tf = new V3(), _tl = new V3(), _fi = new V3(), _tmp = new V3();
class Tank {
  constructor(key, team, who, x, z, yaw) {
    this.id = ++VID; this.def = TANKS[key]; const D = this.def;
    this.type = D.type; this.team = team; this.who = who; this.name = who ? who.name : D.name; this.isPlayer = !!(who && who.isPlayer);
    Object.assign(this, buildTank(D)); scene.add(this.root);
    // ---- corpo rígido ----
    this.mass = D.mass; this.comY = D.clr + D.Hh * 0.45;
    const Hh2 = D.clr + D.Hh + D.turret.h;
    this.Ib = new V3(D.mass / 12 * (Hh2 * Hh2 + D.L * D.L), D.mass / 12 * (D.W * D.W + D.L * D.L), D.mass / 12 * (D.W * D.W + Hh2 * Hh2));
    this.q = new QUAT().setFromAxisAngle(UP, yaw);
    this.pos = new V3(x, H(x, z) + this.comY + 0.05, z); this.vel = new V3(); this.w = new V3();
    this.contacts = [];
    const n = D.wheels;
    for (const s of [1, -1]) for (let i = 0; i < n; i++) this.contacts.push({ x: s * (D.W / 2 - D.trackW / 2), z: -D.L * 0.41 + i * (D.L * 0.82 / (n - 1)), side: s });
    const nc = this.contacts.length;
    this.kSpr = D.mass * G / (nc * 0.12); this.cSpr = 2 * 0.55 * Math.sqrt(this.kSpr * D.mass / nc);
    this.gear = 1; this.rpm = 700; this.shiftT = 0; this.trackV = [0, 0]; this.trackOff = [0, 0];
    this.vFwd = 0;
    // ---- torre e armas ----
    this.turretYaw = 0; this.gunPitch = 0; this.aimPoint = new V3(x + Math.sin(yaw) * 200, H(x, z) + 2, z + Math.cos(yaw) * 200);
    this.compensate = false; this.aimErr = 1;
    this.ammoLeft = D.gun.ammo.map(a => a.count);
    this.sel = 0; this.loaded = 0; this.reload = 0; this.clip = D.gun.clip || 0; this.fireAcc = 0; this.barrel = 0;
    this.mgAmmo = D.mg ? D.mg.total : 0; this.mgBelt = D.mg ? D.mg.belt : 0; this.mgReload = 0; this.mgAcc = 0; this.mgN = 0; this.mgFiring = false;
    this.throttle = 0; this.steer = 0; this.firing = false;
    this.crew = CREW.map(([role, label, short]) => ({ role, label, short, alive: true }));
    this.mods = {}; for (const k in MODS) this.mods[k] = { broken: false, rep: 0, label: MODS[k][0] };
    this.fire = 0; this.fireTick = 0; this.ext = 0; this.extCd = 0; this.replace = {};
    this.alive = true; this.turretOn = true; this.lastHitBy = null; this.deadT = 0; this.spottedUntil = 0; this.oobT = 0; this.flipT = 0;
    this.dustT = 0; this.smokeT = 0; this.burnT = 0;
    this.hullMin = [-D.W / 2, 0.15, -D.L / 2]; this.hullMax = [D.W / 2, D.clr + D.Hh, D.L / 2];
    const T = D.turret; this.turMin = [-T.w / 2, 0, -T.l / 2]; this.turMax = [T.w / 2, T.h, T.l / 2 + 0.3];
    this.invRoot = new THREE.Matrix4(); this.invTurret = new THREE.Matrix4();
    this.brain = null;
    this.label = makeLabel(this);
    this.applyTransform();
    tanks.push(this);
  }
  get gun() { return this.def.gun; }
  get ammo() { return this.def.gun.ammo[this.loaded >= 0 ? this.loaded : this.sel]; }
  seat(role) { return this.crew.find(c => c.role === role); }
  aliveCount() { return this.crew.filter(c => c.alive).length; }
  ammoFrac() { const tot = this.def.gun.ammo.reduce((s, a) => s + a.count, 0); return this.ammoLeft.reduce((s, a) => s + a, 0) / tot; }
  canFire() { return this.alive && this.turretOn && this.loaded >= 0 && !this.mods.breech.broken && this.seat('gunner').alive; }
  canDrive() { return this.alive && !this.mods.transmission.broken && !this.mods.tracks.broken && this.seat('driver').alive; }
  axes() { _m4.makeRotationFromQuaternion(this.q); _ax.setFromMatrixColumn(_m4, 0); _ay.setFromMatrixColumn(_m4, 1); _az.setFromMatrixColumn(_m4, 2); }
  centerPos(out) { return out.set(0, this.def.clr + this.def.Hh * 0.6, 0).applyMatrix4(this.root.matrixWorld); }
  eyePos(out) { return out.set(0, this.def.clr + this.def.Hh + this.def.turret.h + 0.4, this.def.turret.z).applyMatrix4(this.root.matrixWorld); }
  groundSpeed() { return Math.hypot(this.vel.x, this.vel.z); }

  applyTransform() {
    this.root.quaternion.copy(this.q);
    this.root.position.copy(this.pos).sub(_tmp.set(0, this.comY, 0).applyQuaternion(this.q));
    if (this.turretOn) { this.turret.rotation.y = this.turretYaw; this.gunPivot.rotation.x = -this.gunPitch; }
    this.root.updateMatrixWorld(true);
    this.invRoot.copy(this.root.matrixWorld).invert();
    if (this.turretOn) this.invTurret.copy(this.turret.matrixWorld).invert();
  }

  // Motor e câmbio automático: potência pela curva de RPM, troca com corte de tração
  drive(dt) {
    const D = this.def, can = this.canDrive();
    const thr = can ? this.throttle : 0, st = can ? this.steer : 0;
    this.axes();
    this.vFwd = this.vel.dot(_az);
    const spin = Math.abs(this.w.dot(_ay)) * D.W / 2;
    const vTrack = Math.max(Math.abs(this.vFwd), spin);
    // câmbio
    if (thr < -0.05 && this.vFwd < 0.6) this.gear = -1;
    else if (this.gear === -1 && (thr > 0.05 || this.vFwd > 0.3)) this.gear = 1;
    if (this.gear > 0) {
      const top = D.vmax * GEARS[this.gear - 1];
      if (vTrack > top * 0.96 && this.gear < 5 && thr > 0.05 && this.shiftT <= 0) { this.gear++; this.shiftT = 0.35; }
      else if (this.gear > 1 && vTrack < D.vmax * GEARS[this.gear - 2] * 0.55 && this.shiftT <= 0) { this.gear--; this.shiftT = 0.3; }
    }
    this.shiftT -= dt;
    const top = this.gear > 0 ? D.vmax * GEARS[this.gear - 1] : D.vrev;
    const x = clamp(vTrack / top, 0, 1.05);
    const busy = Math.abs(thr) + Math.abs(st) > 0.05;
    const tgtRpm = 700 + (D.rpm - 700) * (busy ? Math.max(x, 0.55 * Math.max(Math.abs(thr), Math.abs(st))) : x * 0.6);
    this.rpm += (tgtRpm - this.rpm) * Math.min(1, dt * 6);
    const xr = this.rpm / D.rpm;
    const P = D.hp * 745.7 * 0.7 * clamp(1.9 * xr - 0.9 * xr * xr, 0.3, 1) * (this.mods.engine.broken ? 0.22 : 1);
    let Fe = this.shiftT > 0 ? 0 : P / Math.max(vTrack, 0.8);
    Fe = Math.min(Fe, 0.8 * D.mass * G);
    if (x >= 1 && Math.abs(this.vFwd) >= top * 0.98) Fe = 0; // regulador de velocidade
    // mistura de comandos por lagarta (+1 = esquerda, local +x)
    let cl, cr;
    if (Math.abs(thr) < 0.05) { cl = -st; cr = st; }
    else if (st > 0) { cl = thr * (1 - 1.6 * st); cr = thr; }
    else if (st < 0) { cl = thr; cr = thr * (1 + 1.6 * st); }
    else { cl = cr = thr; }
    this.cmd = [clamp(cl, -1, 1), clamp(cr, -1, 1)];
    this.Fside = [this.cmd[0] * Fe / 2, this.cmd[1] * Fe / 2];
  }

  physics(dt) {
    const D = this.def, n = Math.max(1, Math.ceil(dt / 0.0045)), h = dt / n;
    if (this.alive) this.drive(dt); else { this.cmd = [0, 0]; this.Fside = [0, 0]; }
    const m = D.mass, nc = this.contacts.length, cLat = m / nc * 7, mu = 0.75, muS = 0.6;
    for (let s = 0; s < n; s++) {
      this.axes();
      _F.set(0, -m * G, 0); _T.set(0, 0, 0);
      terrainNormal(this.pos.x, this.pos.z, _tn);
      _tf.copy(_az).addScaledVector(_tn, -_az.dot(_tn)).normalize();
      _tl.copy(_ax).addScaledVector(_tn, -_ax.dot(_tn)).normalize();
      let gl = 0, gr = 0;
      for (const c of this.contacts) { c.on = false; }
      for (const c of this.contacts) {
        _rr.set(c.x, -0.12 - this.comY, c.z).applyQuaternion(this.q);
        _wp.copy(this.pos).add(_rr);
        const d = H(_wp.x, _wp.z) - _wp.y;
        if (d <= 0) continue;
        c.on = true; c.d = d; c.side > 0 ? gl++ : gr++;
      }
      this.trackV[0] = this.trackV[1] = 0;
      for (const c of this.contacts) {
        if (!c.on) continue;
        _rr.set(c.x, -0.12 - this.comY, c.z).applyQuaternion(this.q);
        _vp.copy(this.w).cross(_rr).add(this.vel);
        const vn = _vp.dot(_ay);
        let N = this.kSpr * Math.min(c.d, 0.6) - this.cSpr * vn;
        if (c.d > 0.22) N += this.kSpr * 12 * (c.d - 0.22) - this.cSpr * 3 * Math.min(vn, 0);
        N = Math.max(N, 0);
        const vl = _vp.dot(_tf), vs = _vp.dot(_tl), si = c.side > 0 ? 0 : 1;
        const cmd = this.cmd[si], cnt = c.side > 0 ? gl : gr;
        let Fl;
        if (Math.abs(cmd) > 0.02 && Math.sign(cmd) === Math.sign(vl || cmd)) Fl = this.Fside[si] / cnt;
        else if (Math.abs(cmd) > 0.02) Fl = clamp(-vl * m / nc * 4, -0.7 * mu * N, 0.7 * mu * N) + this.Fside[si] / cnt * 0.3; // freio da lagarta
        else Fl = clamp(-vl * m / nc * (Math.abs(vl) < 0.7 ? 6 : 1.2), -(Math.abs(vl) < 0.7 ? 0.9 : 0.18) * mu * N, (Math.abs(vl) < 0.7 ? 0.9 : 0.18) * mu * N); // freio-motor / estacionamento
        Fl -= Math.sign(vl) * Math.min(0.035 * N, Math.abs(vl) * m / nc * 3); // resistência ao rolamento
        Fl = clamp(Fl, -mu * N, mu * N);
        const Fs = clamp(-vs * cLat, -muS * N, muS * N);
        _fi.copy(_ay).multiplyScalar(N).addScaledVector(_tf, Fl).addScaledVector(_tl, Fs);
        _F.add(_fi); _T.add(_tmp.copy(_rr).cross(_fi));
        this.trackV[si] += vl / cnt;
      }
      // casco tocando o solo (fundo)
      for (const lz of [-D.L / 2, D.L / 2]) for (const lx of [-D.W / 2, D.W / 2]) {
        _rr.set(lx, D.clr * 0.5 - this.comY, lz).applyQuaternion(this.q); _wp.copy(this.pos).add(_rr);
        const d = H(_wp.x, _wp.z) - _wp.y; if (d <= 0) continue;
        _vp.copy(this.w).cross(_rr).add(this.vel);
        const N = Math.max(0, this.kSpr * 6 * d - this.cSpr * 4 * _vp.y);
        _fi.set(0, N, 0).addScaledVector(_vp, -m * 0.5 / dt * 0.02);
        _F.add(_fi); _T.add(_tmp.copy(_rr).cross(_fi));
      }
      // integração (Euler semi-implícito); dinâmica angular no referencial do corpo
      this.vel.addScaledVector(_F, h / m);
      const qi = _tq2.copy(this.q).invert();
      const wb = _wb.copy(this.w).applyQuaternion(qi), tb = _tb.copy(_T).applyQuaternion(qi), I = this.Ib;
      const gx = wb.y * wb.z * (I.z - I.y), gy = wb.z * wb.x * (I.x - I.z), gz = wb.x * wb.y * (I.y - I.x);
      wb.x += (tb.x - gx) / I.x * h; wb.y += (tb.y - gy) / I.y * h; wb.z += (tb.z - gz) / I.z * h;
      this.w.copy(wb).applyQuaternion(this.q);
      this.pos.addScaledVector(this.vel, h);
      _dq.set(this.w.x * h * 0.5, this.w.y * h * 0.5, this.w.z * h * 0.5, 0).multiply(this.q);
      this.q.x += _dq.x; this.q.y += _dq.y; this.q.z += _dq.z; this.q.w += _dq.w; this.q.normalize();
    }
    // animação das lagartas e rodas
    for (let i = 0; i < 2; i++) {
      this.trackOff[i] += this.trackV[i] * dt;
      (i === 0 ? this.trackL : this.trackR).map.offset.x = -this.trackOff[i] * 0.9;
    }
    for (const w of this.wheels) w.m.rotation.x += (w.side > 0 ? this.trackV[0] : this.trackV[1]) / w.r * dt;
    // poeira
    const gs = this.groundSpeed();
    if (gs > 3 && (this.dustT -= dt) < 0) {
      this.dustT = 0.09; this.axes();
      const b = _tmp.copy(this.pos).addScaledVector(_az, -D.L * 0.5);
      spawnP({ pos: new V3(b.x + rand(-1, 1), H(b.x, b.z) + 0.4, b.z), vel: new V3(rand(-1, 1), rand(.5, 1.5), rand(-1, 1)), life: rand(1.5, 2.5), size: 1.4, size1: 4.5, color: 0xa08f6c, op: .35, drag: 1 });
    }
  }

  collide() {
    const D = this.def; this.axes();
    const r = 0.9;
    let hitWall = false;
    for (const lz of [-D.L * 0.45, -D.L * 0.15, D.L * 0.15, D.L * 0.45]) for (const lx of [-D.W * 0.32, D.W * 0.32]) {
      const cx = this.pos.x + _ax.x * lx + _az.x * lz, cz = this.pos.z + _ax.z * lx + _az.z * lz;
      for (const b of obstNear(cx - r, cz - r, cx + r, cz + r)) {
        if (b.mx[1] < this.pos.y - this.comY + 0.5) continue;
        const qx = clamp(cx, b.mn[0], b.mx[0]), qz = clamp(cz, b.mn[2], b.mx[2]);
        let dx = cx - qx, dz = cz - qz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d < 1e-4) { // centro dentro da caixa: sai pela menor penetração
          const px = Math.min(cx - b.mn[0], b.mx[0] - cx), pz = Math.min(cz - b.mn[2], b.mx[2] - cz);
          if (px < pz) { dx = cx - b.mn[0] < b.mx[0] - cx ? -1 : 1; dz = 0; d = -px; } else { dz = cz - b.mn[2] < b.mx[2] - cz ? -1 : 1; dx = 0; d = -pz; }
        } else { dx /= d; dz /= d; }
        const push = r - d;
        this.pos.x += dx * push; this.pos.z += dz * push;
        const vn = this.vel.x * dx + this.vel.z * dz;
        if (vn < 0) { this.vel.x -= dx * vn * 1.05; this.vel.z -= dz * vn * 1.05; hitWall = true; }
      }
    }
    if (hitWall) { this.w.multiplyScalar(0.9); }
    const R = D.W * 0.5 + 0.3;
    for (const t of TREES) {
      if (t.down) continue;
      const dx = this.pos.x - t.x, dz = this.pos.z - t.z; if (Math.abs(dx) > D.L || Math.abs(dz) > D.L) continue;
      for (const k of [-0.35, 0, 0.35]) {
        const cx = this.pos.x + _az.x * D.L * k, cz = this.pos.z + _az.z * D.L * k, ex = cx - t.x, ez = cz - t.z, d = Math.hypot(ex, ez);
        if (d < R) {
          const gs = this.groundSpeed();
          if (gs * D.mass > 40000) { fellTree(t, this.vel.x / (gs || 1), this.vel.z / (gs || 1)); this.vel.multiplyScalar(0.85); }
          else if (d > 1e-3) { this.pos.x += ex / d * (R - d); this.pos.z += ez / d * (R - d); const vn = (this.vel.x * ex + this.vel.z * ez) / d; if (vn < 0) { this.vel.x -= ex / d * vn; this.vel.z -= ez / d * vn; } }
          break;
        }
      }
    }
    // cercas vivas: atravessáveis, mas com resistência
    for (const h of HEDGES) if (this.pos.x > h.mn[0] && this.pos.x < h.mx[0] && this.pos.z > h.mn[2] && this.pos.z < h.mx[2]) { this.vel.x *= 0.985; this.vel.z *= 0.985; }
    // fora da área de combate / capotado
    const out = Math.abs(this.pos.x) > LIMIT || Math.abs(this.pos.z) > LIMIT;
    this.oobT = out && this.alive ? this.oobT + 1 / 60 : 0;
    this.flipT = _ay.y < 0.3 && this.alive ? this.flipT + 1 / 60 : 0;
    if (this.oobT > 12) destroyVehicle(this, null, 'oob');
    if (this.flipT > 12) destroyVehicle(this, null, 'flip');
  }

  updateTurret(dt) {
    if (!this.alive || !this.turretOn) return;
    const D = this.def, g = D.gun, T = D.turret;
    // alvo no referencial da torre (casco inclinado é considerado)
    const p = _tmp.copy(this.aimPoint).applyMatrix4(this.invRoot);
    p.x -= 0; p.y -= D.clr + D.Hh + T.h * 0.5; p.z -= T.z;
    const want = Math.atan2(p.x, p.z), hd = Math.hypot(p.x, p.z);
    const gunner = this.seat('gunner').alive;
    let trav = g.trav * DEG * (gunner ? 1 : 0) * (this.mods.drive.broken ? 0.25 : 1);
    if (D.rpmTraverse) trav *= 0.35 + 0.65 * clamp((this.rpm - 700) / (D.rpm - 700), 0, 1);
    this.turretYaw += clamp(angDiff(this.turretYaw, want), -trav * dt, trav * dt);
    let elev = Math.atan2(p.y, hd);
    if (this.compensate) elev += ballistic(this.ammo, hd).ang;
    const tgt = clamp(elev, -g.dep * DEG, g.elev * DEG);
    if (gunner) this.gunPitch += clamp(tgt - this.gunPitch, -g.elevRate * DEG * dt, g.elevRate * DEG * dt);
    this.aimErr = Math.abs(angDiff(this.turretYaw, want)) + Math.abs(tgt - this.gunPitch) + (Math.abs(elev - tgt) > 0.01 ? 1 : 0);
  }

  updateSystems(dt) {
    const g = this.gun;
    if (this.alive && this.loaded < 0 && this.turretOn) {
      if (this.ammoLeft[this.sel] <= 0) { const i = this.ammoLeft.findIndex(a => a > 0); if (i >= 0) this.sel = i; }
      if (this.ammoLeft[this.sel] > 0) {
        this.reload -= dt * (this.seat('loader').alive ? 1 : 0.6);
        if (this.reload <= 0) { this.reload = 0; this.loaded = this.sel; if (g.auto) this.clip = Math.min(g.clip, this.ammoLeft[this.sel]); if (this.isPlayer) sndClick(); }
      }
    }
    if (this.mgReload > 0 && (this.mgReload -= dt) <= 0) this.mgBelt = Math.min(this.def.mg.belt, this.mgAmmo);
    if (!this.alive) return;
    // disparo contínuo (armas automáticas e metralhadora coaxial)
    if (g.auto && this.firing && this.canFire()) {
      this.fireAcc += dt * g.rpm / 60;
      while (this.fireAcc >= 1 && this.canFire()) { this.fireAcc -= 1; this.shootAuto(); }
    } else this.fireAcc = Math.min(this.fireAcc, 1);
    if (this.def.mg && this.mgFiring && this.seat('gunner').alive && this.turretOn && this.mgBelt > 0 && this.mgReload <= 0) {
      this.mgAcc += dt * this.def.mg.rpm / 60;
      while (this.mgAcc >= 1 && this.mgBelt > 0) { this.mgAcc -= 1; this.shootMG(); }
      if (this.mgBelt <= 0 && this.mgAmmo > 0) this.mgReload = 6;
    } else this.mgAcc = Math.min(this.mgAcc, 1);
    // substituição de tripulantes essenciais
    for (const role of ['driver', 'gunner']) {
      const seat = this.seat(role);
      if (seat.alive) { delete this.replace[role]; continue; }
      if (!this.replace[role]) {
        const spare = ['radio', 'loader', 'commander'].map(r => this.seat(r)).find(c => c.alive && !Object.values(this.replace).some(x => x.spare === c));
        if (spare) this.replace[role] = { spare, t: 4 };
      } else if ((this.replace[role].t -= dt) <= 0) {
        const sp = this.replace[role].spare; delete this.replace[role];
        if (sp.alive && this.aliveCount() >= 2) { sp.alive = false; seat.alive = true; }
      }
    }
    for (const k in this.mods) {
      const m = this.mods[k];
      if (m.broken && this.fire <= 0 && this.aliveCount() >= 2 && (m.rep -= dt) <= 0) { m.broken = false; if (this.isPlayer) showDmg(m.label + ' reparado', true); }
    }
    if (this.extCd > 0) this.extCd -= dt;
    if (this.fire > 0) {
      this.fire += dt; this.fireTick += dt;
      if (this.ext > 0 && (this.ext -= dt) <= 0) { this.fire = 0; if (this.isPlayer) showDmg('Incêndio extinto', true); }
      if (this.brain && this.fire > this.brain.extAt && this.ext <= 0 && this.extCd <= 0) this.extinguish();
      if (this.fireTick > 4) {
        this.fireTick = 0;
        if (Math.random() < 0.3) { const c = this.crew.filter(c => c.alive); const v = c[Math.floor(Math.random() * c.length)]; if (v) { v.alive = false; if (this.isPlayer) showDmg(v.label + ' morto pelo fogo'); } }
        if (Math.random() < 0.05 * this.ammoFrac()) { destroyVehicle(this, this.lastHitBy, 'ammo'); return; }
        if (this.aliveCount() < 2) { destroyVehicle(this, this.lastHitBy, 'fire'); return; }
      }
      if ((this.smokeT -= dt) < 0) { this.smokeT = 0.07; fxBurn(this.centerPos(new V3()).add(rv(.8)), 0.8); }
    }
  }
  extinguish() { if (this.fire > 0 && this.ext <= 0 && this.extCd <= 0) { this.ext = 2.5; this.extCd = 14; if (this.isPlayer) showDmg('Extinguindo…', true); } }
  breakMod(k) { const m = this.mods[k]; m.broken = true; m.rep = MODS[k][1]; }
  setFire() { if (this.fire <= 0) { this.fire = 0.01; this.fireTick = 0; } }
  selectAmmo(i) {
    if (i >= this.gun.ammo.length || this.ammoLeft[i] <= 0) return;
    if (this.sel !== i) { this.sel = i; if (this.loaded >= 0 && this.loaded !== i) { this.loaded = -1; this.reload = this.gun.reload; } }
  }
  recoil(dir, J, at) {
    this.vel.addScaledVector(dir, -J / this.mass);
    const r = _rr.copy(at).sub(this.pos), imp = _tmp.copy(dir).multiplyScalar(-J);
    const tq = r.cross(imp), qi = _tq2.copy(this.q).invert();
    tq.applyQuaternion(qi); tq.x /= this.Ib.x; tq.y /= this.Ib.y; tq.z /= this.Ib.z; tq.applyQuaternion(this.q);
    this.w.add(tq);
  }
  shoot() {
    if (this.gun.auto) return;
    if (!this.canFire()) return;
    const am = this.gun.ammo[this.loaded];
    const pos = this.muzzles[0].getWorldPosition(new V3());
    const dir = new V3(0, 0, 1).transformDirection(this.gunPivot.matrixWorld).add(rv(0.0007)).normalize();
    fireProj(this, pos, dir.clone().multiplyScalar(am.v), am, 'shell');
    this.ammoLeft[this.loaded]--;
    this.loaded = -1; this.reload = this.gun.reload;
    this.recoil(dir, am.m * am.v * 1.6, pos);
    fxMuzzle(pos, dir, this.gun.cal); sndShot(pos, this.gun.cal);
    if (this.isPlayer) { shakeCam(0.35); stats.shots++; }
  }
  shootAuto() {
    const am = this.gun.ammo[this.loaded], g = this.gun;
    const mz = this.muzzles[this.barrel++ % this.muzzles.length];
    const pos = mz.getWorldPosition(new V3());
    const dir = new V3(0, 0, 1).transformDirection(this.gunPivot.matrixWorld).add(rv(0.0035)).normalize();
    fireProj(this, pos, dir.clone().multiplyScalar(am.v), am, 'bullet', { tracer: (this.barrel % am.tracer) === 0 });
    this.ammoLeft[this.loaded]--; this.clip--;
    if (this.barrel % 2 === 0) fxSmallFlash(pos, dir);
    sndMG(pos, 26);
    if (this.clip <= 0 || this.ammoLeft[this.loaded] <= 0) { this.loaded = -1; this.reload = g.reload; }
  }
  shootMG() {
    const mg = this.def.mg;
    const pos = this.mgMuzzle.getWorldPosition(new V3());
    const dir = new V3(0, 0, 1).transformDirection(this.gunPivot.matrixWorld).add(rv(0.003)).normalize();
    fireProj(this, pos, dir.clone().multiplyScalar(mg.v), mg, 'bullet', { tracer: (++this.mgN % mg.tracer) === 0 });
    this.mgBelt--; this.mgAmmo--;
    sndMG(pos, 8);
  }
  components() {
    const D = this.def, T = D.turret, it = D.W - 2 * D.trackW, y0 = D.clr, yH = D.clr + D.Hh, L = D.L;
    const out = [
      { kind: 'crew', ref: this.seat('driver'), p: [it * .27, y0 + .5, L * .3], r: .4 },
      { kind: 'crew', ref: this.seat('radio'), p: [-it * .27, y0 + .5, L * .3], r: .4 },
      { kind: 'mod', name: 'engine', p: [0, y0 + .6, -L * .33], r: .75 },
      { kind: 'mod', name: 'transmission', p: [0, y0 + .35, D.transFront ? L * .43 : -L * .46], r: .5 },
      { kind: 'mod', name: 'ammo', p: [it * .36, y0 + .4, -L * .02], r: .42 },
      { kind: 'mod', name: 'ammo', p: [-it * .36, y0 + .4, -L * .02], r: .42 },
      { kind: 'mod', name: 'fuel', p: [it * .36, y0 + .65, -L * .2], r: .38 },
      { kind: 'mod', name: 'fuel', p: [-it * .36, y0 + .65, -L * .2], r: .38 },
      { kind: 'mod', name: 'drive', p: [0, yH - .25, T.z], r: .35 }
    ];
    if (this.turretOn) {
      const c = Math.cos(this.turretYaw), s = Math.sin(this.turretYaw);
      const tp = (x, y, z) => [x * c + z * s, yH + y, -x * s + z * c + T.z];
      out.push(
        { kind: 'crew', ref: this.seat('gunner'), p: tp(-T.w * .22, .05, T.l * .12), r: .4 },
        { kind: 'crew', ref: this.seat('commander'), p: tp(-T.w * .22, .15, -T.l * .28), r: .4 },
        { kind: 'crew', ref: this.seat('loader'), p: tp(T.w * .24, -.05, -T.l * .05), r: .4 },
        { kind: 'mod', name: 'breech', p: tp(0, T.h * .5, T.l * .18), r: .35 });
    }
    return out;
  }
  remove() { scene.remove(this.root); if (this.popped) scene.remove(this.popped.obj); this.label.remove(); const i = tanks.indexOf(this); if (i >= 0) tanks.splice(i, 1); }
}
const _tq2 = new QUAT(), _dq = new QUAT(), _wb = new V3(), _tb = new V3();
