import * as THREE from 'three';
import { scene, flashAt } from '../core/render.js';
import { S } from '../core/state.js';
import { V3, rand, rv, lerp } from '../core/util.js';
import { H } from '../world/terrain.js';

function spriteTex(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); stops.forEach(([o, s]) => gr.addColorStop(o, s));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
// fumaça com textura irregular (vários lóbulos) parece menos "bola"
function smokeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 14; i++) { const x = 64 + rand(-26, 26), y = 64 + rand(-26, 26), r = rand(18, 34), gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  return new THREE.CanvasTexture(c);
}
export const TEX = {
  smoke: smokeTex(),
  fire: spriteTex([[0, 'rgba(255,250,220,1)'], [.35, 'rgba(255,170,60,.9)'], [1, 'rgba(255,80,0,0)']]),
};
const PARTS = [];
for (let i = 0; i < 1400; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.smoke, transparent: true, depthWrite: false }));
  s.visible = false; s.frustumCulled = true; scene.add(s); PARTS.push({ s, life: 0, vel: new V3() });
}
let partI = 0;
export function spawnP(o) {
  const p = PARTS[partI]; partI = (partI + 1) % PARTS.length;
  p.s.visible = true; p.s.position.copy(o.pos);
  if (o.vel) p.vel.copy(o.vel); else p.vel.set(0, 0, 0);
  p.life = p.max = o.life; p.size0 = o.size; p.size1 = o.size1 ?? o.size * 2.2; p.op = o.op ?? 1;
  const m = p.s.material; m.map = o.tex || TEX.smoke; m.color.set(o.color ?? 0xffffff);
  m.blending = o.add ? THREE.AdditiveBlending : THREE.NormalBlending;
  p.drag = o.drag ?? 1.5; p.rise = o.rise ?? 0; p.grav = o.grav ?? 0;
  p.s.scale.setScalar(o.size); m.opacity = 0; m.rotation = Math.random() * 6.28;
}
export function updateParts(dt) {
  for (const p of PARTS) {
    if (p.life <= 0) continue;
    p.life -= dt; if (p.life <= 0) { p.s.visible = false; continue; }
    const k = 1 - p.life / p.max;
    p.vel.multiplyScalar(Math.exp(-p.drag * dt)); p.vel.y += (p.rise - p.grav) * dt;
    p.s.position.addScaledVector(p.vel, dt);
    p.s.scale.setScalar(lerp(p.size0, p.size1, 1 - (1 - k) * (1 - k)));
    p.s.material.opacity = p.op * Math.min(1, k * 10) * (1 - k);
  }
}
export function clearParts() { for (const p of PARTS) { p.life = 0; p.s.visible = false; } }
const flash = (pos, i) => flashAt(pos, i, S);
export function fxDust(pos, n = 8, s = 1) {
  for (let i = 0; i < n; i++) spawnP({ pos: pos.clone().add(rv(0.6 * s)), vel: rv(3 * s).setY(rand(1, 5) * s), life: rand(1.2, 2.4), size: 1.2 * s, size1: 4 * s, color: 0x9c8a68, op: .7, rise: 0.4 });
}
export function fxSparks(pos, n = 7) {
  for (let i = 0; i < n; i++) spawnP({ pos, vel: rv(9), life: rand(.15, .35), size: .35, size1: .1, tex: TEX.fire, add: true, color: 0xffd080, grav: 9, drag: .5 });
}
export function fxExplosion(pos, s = 1) {
  for (let i = 0; i < 10 * s; i++) spawnP({ pos: pos.clone().add(rv(.4 * s)), vel: rv(7 * s), life: rand(.25, .55), size: 1.5 * s, size1: 4.5 * s, tex: TEX.fire, add: true, color: 0xffb060 });
  for (let i = 0; i < 14 * s; i++) spawnP({ pos: pos.clone().add(rv(.8 * s)), vel: rv(4 * s).setY(rand(1, 6) * s), life: rand(2, 4), size: 2 * s, size1: 7 * s, color: 0x2b2722, op: .85, rise: .6 });
  flash(pos, 6 * s);
}
export function fxBigBlast(pos, s) {
  fxExplosion(pos, s * 0.8);
  for (let i = 0; i < 26; i++) spawnP({ pos: pos.clone().add(rv(s)), vel: new V3(rand(-1, 1) * 6 * s, rand(10, 26) * s, rand(-1, 1) * 6 * s), life: rand(2.5, 4.5), size: 2.5 * s, size1: 8 * s, color: 0x5b4c38, op: .9, grav: 9, drag: .4 });
  for (let i = 0; i < 18; i++) { const a = Math.random() * 6.28; spawnP({ pos: pos.clone().setY(pos.y + .5), vel: new V3(Math.cos(a) * 22 * s, rand(.5, 2), Math.sin(a) * 22 * s), life: rand(2, 3.5), size: 3 * s, size1: 10 * s, color: 0x9c8a68, op: .55, drag: 1.4 }); }
}
export function fxMuzzle(pos, dir, cal) {
  const s = cal / 80;
  for (let i = 0; i < 5; i++) spawnP({ pos: pos.clone().addScaledVector(dir, i * 0.6 * s), vel: dir.clone().multiplyScalar(18 + i * 4), life: .09, size: 1.6 * s, size1: 2.4 * s, tex: TEX.fire, add: true, color: 0xffc070, drag: 8 });
  for (let i = 0; i < 9; i++) spawnP({ pos: pos.clone(), vel: dir.clone().multiplyScalar(rand(6, 18)).add(rv(3)), life: rand(1.5, 3), size: 1 * s, size1: 5 * s, color: 0xb0aba0, op: .55, rise: .4, drag: 2 });
  const gp = pos.clone(); gp.y = H(gp.x, gp.z) + 0.3;
  if (pos.y - gp.y < 4) for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28; spawnP({ pos: gp, vel: new V3(Math.cos(a) * 9, rand(.5, 2), Math.sin(a) * 9), life: rand(1, 2), size: 1.2, size1: 4, color: 0x9c8a68, op: .45, drag: 2.5 }); }
  flash(pos, 4 * s);
}
export function fxSmallFlash(pos, dir) { spawnP({ pos: pos.clone().addScaledVector(dir, .3), vel: dir.clone().multiplyScalar(10), life: .05, size: .5, size1: .8, tex: TEX.fire, add: true, color: 0xffc070, drag: 8 }); }
export function fxBurn(pos, s) {
  spawnP({ pos, vel: new V3(rand(-.5, .5), rand(2, 4), rand(-.5, .5)), life: rand(.4, .8), size: 1.2 * s, size1: .4, tex: TEX.fire, add: true, color: 0xff9a40, drag: .5 });
  spawnP({ pos, vel: new V3(rand(-.6, .6) + 0.8, rand(2.5, 4), rand(-.6, .6)), life: rand(3, 5), size: 1.5 * s, size1: 7 * s, color: 0x1e1b18, op: .7, drag: .3 });
}
export function fxTrail(pos, color, s = 1, life = 2.5) { spawnP({ pos, life, size: .8 * s, size1: 3.5 * s, color, op: .55, drag: 1 }); }
