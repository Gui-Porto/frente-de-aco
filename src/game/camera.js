import * as THREE from 'three';
import { camera } from '../core/render.js';
import { S } from '../core/state.js';
import { settings, isDown } from '../core/settings.js';
import { V3, UP, clamp, lerp, rand, REDUCED } from '../core/util.js';
import { H } from '../world/terrain.js';
import { raycast } from '../combat/ballistics.js';

export const cam = {
  yaw: 0, pitch: -0.05, dist: 11, sniper: false, binoc: false, fov: 9, orbit: 0, drag: false,
  rangeT: 0, range: 0, aimDir: new V3(0, 0, 1), hangar: null, pos: new V3(), init: false,
};
const _dir = new V3(), _cp = new V3(), _ca = new V3(), _cb = new V3(), _fwd = new V3();
export function camDir(out) { return out.set(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)); }
function setFov(f) { if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); } }
export function resetCam(yaw) { cam.yaw = yaw; cam.pitch = -0.08; cam.sniper = cam.binoc = false; cam.init = false; }

export function updateCamera(dt) {
  if (S.state === 'menu') {
    camera.setViewOffset(innerWidth, innerHeight, -innerWidth * (innerWidth > 760 ? 0.13 : 0), innerHeight * 0.06, innerWidth, innerHeight);
    cam.orbit += cam.drag ? 0 : dt * 0.12;
    const h = cam.hangar; if (!h) return;
    setFov(38);
    camera.position.set(h.pos.x + Math.sin(cam.orbit) * h.r, h.pos.y + h.r * 0.36, h.pos.z + Math.cos(cam.orbit) * h.r);
    camera.lookAt(h.pos.x, h.pos.y + 1.2, h.pos.z); return;
  }
  camera.clearViewOffset();
  const p = S.player, v = p && (p.alive || S.state === 'play') ? p : S.spectate || p;
  if (!v) { camera.position.set(0, 120, 300); camera.lookAt(0, 0, 0); return; }
  camDir(_dir);
  const k = settings.gameplay.camSmooth ? 1 - Math.exp(-dt * 14) : 1;
  if (v.type === 'plane') {
    const kb = settings.gameplay.flightMode === 'teclado' && v === p && !isDown('freelook');
    if (kb) { // câmera de perseguição presa ao avião
      v.axes(); _fwd.set(0, 0, 1).applyQuaternion(v.q);
      _dir.copy(_fwd).addScaledVector(UP, -0.12).normalize();
      cam.yaw = Math.atan2(_dir.x, _dir.z); cam.pitch = Math.asin(clamp(_dir.y, -1, 1));
    }
    setFov(isDown('a_zoom') ? 34 : 65);
    _cp.copy(v.pos).addScaledVector(_dir, -cam.dist * 1.55).addScaledVector(UP, 3.4);
    if (!cam.init) { cam.pos.copy(_cp); cam.init = true; }
    cam.pos.lerp(_cp, k);
    cam.pos.y = Math.max(cam.pos.y, H(cam.pos.x, cam.pos.z) + 2);
    camera.position.copy(cam.pos);
    camera.lookAt(_cb.copy(camera.position).add(_dir));
    if (!isDown('freelook')) cam.aimDir.copy(_dir);
  } else {
    const t = v, D = t.def;
    const sight = (cam.sniper || cam.binoc) && t.alive && t.turretOn && t === p;
    if (sight) {
      t.turret.localToWorld(_cp.set(D.turret.w * .22, D.turret.h + .1, D.turret.l * .3));
      camera.position.copy(_cp); t.root.visible = false; cam.init = false;
      setFov(cam.binoc ? Math.min(cam.fov, 8) : cam.fov);
      if (!cam.binoc) t.aimPoint.copy(_cp).addScaledVector(_dir, 1500);
      if ((cam.rangeT -= dt) <= 0) { cam.rangeT = .25; const h = raycast(_cp, _dir, 2000, t); cam.range = h ? h.t * 2000 : 0; }
    } else {
      t.root.visible = true;
      setFov(isDown('t_zoom') && t === p ? 32 : 60);
      const pv = t.eyePos(_ca); pv.y += 1.2;
      _cp.copy(pv).addScaledVector(_dir, -cam.dist);
      if (!cam.init) { cam.pos.copy(_cp); cam.init = true; }
      cam.pos.lerp(_cp, settings.gameplay.camSmooth ? 1 - Math.exp(-dt * 20) : 1);
      cam.pos.y = Math.max(cam.pos.y, H(cam.pos.x, cam.pos.z) + 1);
      camera.position.copy(cam.pos);
      if (t.alive && t === p && !isDown('freelook')) { const h = raycast(camera.position, _dir, 1800, t); if (h) t.aimPoint.copy(h.point); else t.aimPoint.copy(camera.position).addScaledVector(_dir, 1800); }
    }
    camera.lookAt(_cb.copy(camera.position).add(_dir));
  }
  if (S.shake > 0 && !REDUCED) { camera.rotation.x += rand(-1, 1) * S.shake * .01; camera.rotation.y += rand(-1, 1) * S.shake * .01; }
  S.shake = Math.max(0, S.shake - dt * 1.5);
}
