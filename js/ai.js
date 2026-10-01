'use strict';
// =====================================================================
// IA: blindados, antiaéreos e aeronaves (usam a mesma física do jogador)
// =====================================================================
function yawOf(t) { t.axes(); return Math.atan2(_az.x, _az.z); }

class TankBrain {
  constructor(t) {
    this.t = t; this.think = Math.random() * .4; this.target = null; this.aimT = 0; this.err = new V3();
    this.stuck = 0; this.rev = 0; this.revSteer = 1; this.hold = false; this.goal = null;
    this.style = Math.random() < .45 ? 'sniper' : 'brawler'; this.side = Math.random() < .5 ? 1 : -1;
    this.offset = Math.random() * Math.PI * 2; this.pref = Math.floor(Math.random() * 3); this.extAt = rand(2.5, 6);
    this.part = 'hull'; this.avoid = 0; this.spaa = t.type === 'spaa';
  }
  decide() {
    const t = this.t; let best = null, bd = 1e9;
    if (this.spaa) {
      for (const p of planes) {
        if (!p.alive || p.team === t.team) continue;
        const d = t.pos.distanceTo(p.pos);
        if (d < 2000 && d < bd && losPts(t.eyePos(new V3()), p.pos, t, p)) { best = p; bd = d; }
      }
    }
    if (!best) for (const e of tanks) {
      if (!e.alive || e.team === t.team) continue;
      const d = t.pos.distanceTo(e.pos);
      if (d < (this.spaa ? 500 : 650) && los(t, e)) { e.spottedUntil = now + 4; if (d < bd) { best = e; bd = d; } }
    }
    if (best !== this.target) {
      this.target = best; this.aimT = 0;
      this.err.set(rand(-1, 1), rand(-.4, 1), rand(-1, 1)).multiplyScalar(bd * 0.012);
      this.part = Math.random() < .5 ? 'hull' : 'turret';
      if (best && !this.spaa && best.type !== 'plane') {
        const am = t.gun.ammo, thick = best.def.armor.front[0] >= 100;
        let s = 0;
        if (best.type === 'spaa' && am[2]) s = 2;
        else if (thick && am[0].pen < 170 && t.ammoLeft[1] > 0) s = 1;
        if (t.ammoLeft[s] > 0) t.selectAmmo(s);
      }
    }
    const open = POINTS.filter(p => p.owner !== t.team || p.contested);
    const list = open.length && !this.spaa ? open : POINTS;
    let gp = list[0], gs = 1e9;
    for (const p of list) { const s = Math.hypot(p.x - t.pos.x, p.z - t.pos.z) - (POINTS.indexOf(p) === this.pref ? 120 : 0); if (s < gs) { gs = s; gp = p; } }
    const back = this.spaa ? (t.team === 1 ? 70 : -70) : 0;
    this.goal = { x: gp.x + Math.cos(this.offset) * 11, z: gp.z + Math.sin(this.offset) * 11 + back };
    this.hold = !!best && (best.type === 'plane' || bd < (this.style === 'sniper' ? 520 : 170));
  }
  update(dt) {
    const t = this.t; if (!t.alive) { t.firing = false; return; }
    if ((this.think -= dt) <= 0) { this.think = .4 + Math.random() * .25; this.decide(); }
    if (this.target && !this.target.alive) this.target = null;
    const yaw = yawOf(t);
    let thr = 0, st = 0;
    if (this.rev > 0) { this.rev -= dt; thr = -1; st = this.revSteer; }
    else if (this.hold && this.target && this.target.type !== 'plane') {
      const b = Math.atan2(this.target.pos.x - t.pos.x, this.target.pos.z - t.pos.z);
      const ang = t.def.key === 't34' ? 0 : t.def.key === 'tiger' ? .5 * this.side : .3 * this.side; // inclinar o casco
      const e = angDiff(yaw, b + ang); st = Math.abs(e) > 0.05 ? clamp(e * 3, -1, 1) : 0;
    } else if (this.goal) {
      const dx = this.goal.x - t.pos.x, dz = this.goal.z - t.pos.z, d = Math.hypot(dx, dz);
      let diff = angDiff(yaw, Math.atan2(dx, dz));
      const ax = t.pos.x + Math.sin(yaw) * 11, az = t.pos.z + Math.cos(yaw) * 11;
      let blocked = false;
      for (const b of obstNear(ax - 3, az - 3, ax + 3, az + 3)) if (ax > b.mn[0] - 2.5 && ax < b.mx[0] + 2.5 && az > b.mn[2] - 2.5 && az < b.mx[2] + 2.5 && b.mx[1] > t.pos.y - 1) { blocked = true; break; }
      if (blocked) { if (!this.avoid) this.avoid = diff > 0 ? 1 : -1; diff += this.avoid * 1.1; } else this.avoid = 0;
      st = clamp(diff * 2.5, -1, 1);
      thr = d < 6 ? 0 : Math.abs(diff) > 1.2 ? 0 : Math.abs(diff) > .5 ? .5 : 1;
    }
    if (thr > .4 && t.groundSpeed() < .5 && t.canDrive()) { if ((this.stuck += dt) > 2.5) { this.rev = 1.6 + Math.random(); this.revSteer = Math.random() < .5 ? -1 : 1; this.stuck = 0; } }
    else this.stuck = Math.max(0, this.stuck - dt);
    t.throttle = thr; t.steer = st;
    const tg = this.target;
    t.firing = false; t.mgFiring = false;
    if (tg && tg.type === 'plane') {
      // tiro antiaéreo com avanço e queda balística
      const am = t.ammo, d = t.pos.distanceTo(tg.pos), tof = d / (am.v * 0.85);
      t.aimPoint.copy(tg.pos).addScaledVector(tg.vel, tof * 1.02); t.aimPoint.y += 0.5 * G * tof * tof * 0.8;
      t.aimPoint.add(_tmp.copy(this.err).multiplyScalar(0.02 * Math.exp(-this.aimT)));
      this.aimT += dt; t.compensate = false;
      t.firing = this.aimT > 0.6 && t.aimErr < 0.04 && d < 1600;
    } else if (tg) {
      this.aimT += dt;
      const D2 = tg.def, y = this.part === 'hull' ? D2.clr + D2.Hh * .55 : D2.clr + D2.Hh + D2.turret.h * .5;
      const aim = _tmp.set(0, y, 0).applyMatrix4(tg.root.matrixWorld);
      const d = t.pos.distanceTo(tg.pos), tof = d / t.ammo.v * 1.06;
      aim.addScaledVector(tg.vel, tof);
      const e = Math.exp(-this.aimT / 2.2) + .07 + (t.groundSpeed() > 1 ? .5 : 0);
      aim.addScaledVector(this.err, e);
      t.aimPoint.copy(aim); t.compensate = true;
      if (t.gun.auto) t.firing = this.aimT > 1 && t.aimErr < .02;
      else if (this.aimT > 1.1 && t.canFire() && t.aimErr < .006 && Math.random() < dt * 3) t.shoot();
    } else {
      t.compensate = false;
      t.aimPoint.set(t.pos.x + Math.sin(yaw) * 200, t.pos.y + 2.5, t.pos.z + Math.cos(yaw) * 200);
      if (this.spaa) t.aimPoint.y += 120;
    }
  }
}

const _bp = new V3(), _bv = new V3();
class PlaneBrain {
  constructor(p) {
    this.p = p; this.corr = new V3(); this.think = 0; this.air = null; this.gt = null; this.state = 'approach'; this.t = 0; this.simT = 0; this.dropT = 0; this.rockT = 0;
    this.role = p.def.key === 'fw190' && Math.random() < .4 ? 'fighter' : 'attack';
  }
  bombImpact() {
    const p = this.p, b = p.bombs[p.bombs.length - 1];
    _bp.copy(p.pos); _bv.copy(p.vel);
    for (let i = 0; i < 400; i++) {
      const sp = _bv.length(), h = 0.05;
      _bv.x += -b.k * sp * _bv.x * h; _bv.y += (-G - b.k * sp * _bv.y) * h; _bv.z += -b.k * sp * _bv.z * h;
      _bp.addScaledVector(_bv, h);
      if (_bp.y < H(_bp.x, _bp.z)) return _bp;
    }
    return null;
  }
  hasOrd() { const p = this.p; return p.bombs.length > 0 || p.rockets > 0; }
  update(dt) {
    const p = this.p; if (!p.alive) { p.firing = false; return; }
    this.t += dt;
    if ((this.think -= dt) <= 0) {
      this.think = .4;
      let best = null, bd = 1e9;
      for (const e of planes) { if (!e.alive || e.team === p.team) continue; const d = e.pos.distanceTo(p.pos); if (d < 2400 && d < bd) { bd = d; best = e; } }
      this.air = best;
      if (!this.gt || !this.gt.alive) {
        let g = null, gd = 1e9;
        for (const t of tanks) { if (!t.alive || t.team === p.team) continue; const d = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) + (t.type === 'spaa' ? -300 : 0); if (d < gd) { gd = d; g = t; } }
        this.gt = g; if (this.state !== 'pull') this.state = 'approach';
      }
    }
    const agl = p.pos.y - H(p.pos.x, p.pos.z);
    // altitude mínima para recuperar do mergulho: perda ≈ R(1−cosθ), R = v²/(g(n−1))
    const V = p.vel.length(), sinD = clamp(-p.vel.y / Math.max(V, 1), 0, 1);
    const pullAlt = V * V / (G * 3.5) * (1 - Math.sqrt(1 - sinD * sinD)) + 140;
    p.axes();
    const fwdFlat = _pt.set(_pf.x, 0, _pf.z).normalize();
    let dir = new V3(), fire = false, glim = 7.5;
    p.throttle = 1; p.wep = false;
    const gunsLeft = p.guns.some(g => g.ammo > 0);
    const dog = this.air && (this.role === 'fighter' || this.air.pos.distanceTo(p.pos) < 900 || !this.hasOrd());
    if (dog && gunsLeft) {
      const a = this.air, d = a.pos.distanceTo(p.pos), tof = d / 780;
      const aim = a.pos.clone().addScaledVector(a.vel, tof); aim.y += 0.5 * G * tof * tof;
      dir.copy(aim).sub(p.pos).normalize();
      fire = d < 650 && dir.dot(_pf) > 0.9994;
      p.wep = d < 1500; glim = 9;
    } else if (this.gt && (this.hasOrd() || gunsLeft)) {
      const tp = this.gt.pos, hd = Math.hypot(tp.x - p.pos.x, tp.z - p.pos.z), gh = H(tp.x, tp.z);
      if (this.state === 'approach') {
        const alt = gh + 750;
        // subida limitada (~10°) e nivelando se a velocidade cair
        dir.set(tp.x - p.pos.x, clamp((alt - p.pos.y) * 1.2, -hd * .3, p.ias < 75 ? 0 : hd * .18), tp.z - p.pos.z).normalize();
        glim = clamp((p.ias - 55) / 12, 2, 6); // curva suave na aproximação: preserva energia
        const ahead = ((tp.x - p.pos.x) * fwdFlat.x + (tp.z - p.pos.z) * fwdFlat.z) / Math.max(hd, 1);
        if (hd < Math.max(agl, 300) * 1.05 + 220 && p.ias > 70) {
          if (ahead > 0.85) { this.state = 'dive'; this.corr = new V3(); this.dropping = false; }
          else if (hd < 700) { this.state = 'pull'; this.t = 0; } // passou do alvo: sai, ganha distância e volta
        }
      } else if (this.state === 'dive') {
        // ponto de mira corrigido pelo impacto simulado da bomba (a bomba cai abaixo da linha de visada)
        const aim = _bp.set(tp.x, gh + 1, tp.z);
        if (p.bombs.length) aim.add(this.corr);
        dir.copy(aim).sub(p.pos).normalize();
        const d = p.pos.distanceTo(tp), ang = dir.dot(_pf);
        if (dir.dot(_pf) < 0.2 && !this.dropping) { this.state = 'pull'; this.t = 0; }
        if (p.bombs.length && (this.simT -= dt) < 0) {
          this.simT = .1;
          const imp = this.bombImpact();
          if (imp) {
            const mx = tp.x - imp.x, mz = tp.z - imp.z, miss = Math.hypot(mx, mz);
            this.corr.x += mx * 0.25; this.corr.z += mz * 0.25;
            if (this.corr.length() > 700) this.corr.setLength(700);
            if (miss < 22 || (agl < pullAlt + 70 && miss < 90)) this.dropping = true;
          }
        }
        if (this.dropping && (this.dropT -= dt) < 0) { this.dropT = .12; if (!p.dropBomb()) { this.dropping = false; this.state = 'pull'; this.t = 0; } }
        if (!p.bombs.length && p.rockets > 0 && d < 1000 && ang > 0.9995 && (this.rockT -= dt) < 0) { this.rockT = .25; p.fireRocket(); p.fireRocket(); }
        if (!p.bombs.length && d < 750 && ang > 0.9996) fire = true;
        if (agl < pullAlt || (d < 260 && !p.bombs.length)) { if (this.dropping) while (p.dropBomb()); this.state = 'pull'; this.t = 0; this.dropping = false; }
      } else if (this.state === 'pull') {
        dir.copy(fwdFlat).addScaledVector(UP, p.ias < 90 ? 0.15 : 0.6).normalize(); glim = 7;
        if (agl > 520 && this.t > 4 && this.gt && Math.hypot(this.gt.pos.x - p.pos.x, this.gt.pos.z - p.pos.z) > 1100) this.state = 'approach';
        if (hdFar(p)) this.state = 'approach';
      }
    } else {
      // sem munição: volta para o aeródromo
      const home = AIRSPAWN[p.team];
      dir.set(home.x - p.pos.x, (home.y - p.pos.y) * 0.3, home.z - p.pos.z).normalize();
      if (Math.hypot(home.x - p.pos.x, home.z - p.pos.z) < 300) p.returned = true;
    }
    // segurança: evitar o solo e o limite do mapa
    if (agl < pullAlt && (this.state !== 'dive' || agl < pullAlt * 0.8)) { dir.copy(fwdFlat).addScaledVector(UP, 1.0).normalize(); glim = 7.5; }
    if (Math.max(Math.abs(p.pos.x), Math.abs(p.pos.z)) > AIRLIMIT - 400) dir.set(-p.pos.x, 0, -p.pos.z).normalize().addScaledVector(UP, .2).normalize();
    p.firing = fire;
    p.steerTo(dir, dt, { glim });
  }
}
function hdFar(p) { return Math.hypot(p.pos.x, p.pos.z) > 2600; }
