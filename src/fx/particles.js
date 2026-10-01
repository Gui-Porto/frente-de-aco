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
// Fumaça: ruído fractal (fBm) com borda suave — parece nuvem, não bola
function smokeTex() {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  const img = g.createImageData(N, N), d = img.data;
  const grid = (f) => { const a = []; for (let i = 0; i <= f; i++) { a.push([]); for (let j = 0; j <= f; j++) a[i].push(Math.random()); } return a; };
  const oct = [grid(4), grid(8), grid(16), grid(32)];
  const vn = (gr, f, x, y) => { const X = x * f, Y = y * f, i = Math.floor(X), j = Math.floor(Y), u = X - i, v = Y - j, s = t => t * t * (3 - 2 * t);
    const a = gr[i][j], b = gr[i + 1][j], cc = gr[i][j + 1], dd = gr[i + 1][j + 1]; return (a + (b - a) * s(u)) + ((cc + (dd - cc) * s(u)) - (a + (b - a) * s(u))) * s(v); };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    let n = 0, amp = 0.5, tot = 0; [4, 8, 16, 32].forEach((f, k) => { n += vn(oct[k], f, u, v) * amp; tot += amp; amp *= 0.5; });
    n /= tot;
    const r = Math.hypot(u - 0.5, v - 0.5) * 2, fall = Math.max(0, 1 - r * r) ** 1.6;
    const a = Math.max(0, Math.min(1, (n - 0.28) * 1.9)) * fall;
    const o = (y * N + x) * 4; d[o] = d[o + 1] = d[o + 2] = 200 + n * 55; d[o + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
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
  const m = p.s.material; m.map = o.tex || TEX.smoke; m.color.set(o.color ?? 0xffffff); if (o.add) m.color.multiplyScalar(o.hdr ?? 1.3);
  p.spin = o.spin ?? (Math.random() - 0.5) * 0.6;
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
    p.s.material.rotation += p.spin * dt;
    const fin = Math.min(1, k * (p.s.material.blending === THREE.AdditiveBlending ? 12 : 5));
    p.s.material.opacity = p.op * fin * Math.pow(1 - k, 1.4);
  }
}
export function clearParts() { for (const p of PARTS) { p.life = 0; p.s.visible = false; } }
const flash = (pos, i) => flashAt(pos, i, S);
export function fxDust(pos, n = 8, s = 1) {
  for (let i = 0; i < n; i++) spawnP({ pos: pos.clone().add(rv(0.6 * s)), vel: rv(2.5 * s).setY(rand(1, 4) * s), life: rand(1.6, 3), size: 1.4 * s, size1: 5 * s, color: 0x7a6a50, op: .45, rise: 0.15, drag: 1.8 });
}
export function fxSparks(pos, n = 7) {
  for (let i = 0; i < n; i++) spawnP({ pos, vel: rv(9), life: rand(.15, .35), size: .35, size1: .1, tex: TEX.fire, add: true, color: 0xffd080, grav: 9, drag: .5 });
}
export function fxExplosion(pos, s = 1) {
  for (let i = 0; i < 10 * s; i++) spawnP({ pos: pos.clone().add(rv(.4 * s)), vel: rv(7 * s), life: rand(.25, .55), size: 1.5 * s, size1: 4.5 * s, tex: TEX.fire, add: true, color: 0xffb060 });
  for (let i = 0; i < 14 * s; i++) spawnP({ pos: pos.clone().add(rv(.8 * s)), vel: rv(4 * s).setY(rand(1, 6) * s), life: rand(2.5, 4.5), size: 2 * s, size1: 8 * s, color: 0x2a2724, op: .7, rise: .5, drag: 1.2 });
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
  for (let i = 0; i < 9; i++) spawnP({ pos: pos.clone(), vel: dir.clone().multiplyScalar(rand(6, 18)).add(rv(3)), life: rand(1.8, 3.2), size: 1.1 * s, size1: 5.5 * s, color: 0x8d8a83, op: .38, rise: .35, drag: 2.2 });
  const gp = pos.clone(); gp.y = H(gp.x, gp.z) + 0.3;
  if (pos.y - gp.y < 4) for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28; spawnP({ pos: gp, vel: new V3(Math.cos(a) * 9, rand(.3, 1.2), Math.sin(a) * 9), life: rand(1.2, 2.2), size: 1.3, size1: 4.5, color: 0x7a6a50, op: .3, drag: 2.5 }); }
  flash(pos, 4 * s);
}
export function fxSmallFlash(pos, dir) { spawnP({ pos: pos.clone().addScaledVector(dir, .3), vel: dir.clone().multiplyScalar(10), life: .05, size: .5, size1: .8, tex: TEX.fire, add: true, color: 0xffc070, drag: 8 }); }
export function fxBurn(pos, s) {
  spawnP({ pos: pos.clone().add(rv(.4)), vel: new V3(rand(-.4, .4), rand(1.5, 3), rand(-.4, .4)), life: rand(.35, .7), size: 1.0 * s, size1: .3, tex: TEX.fire, add: true, color: 0xff8a30, hdr: 1.2, drag: .5 });
  spawnP({ pos: pos.clone().add(new V3(0, 1, 0)), vel: new V3(rand(-.4, .4) + 0.6, rand(2, 3.2), rand(-.4, .4)), life: rand(5, 8), size: 1.8 * s, size1: 9 * s, color: 0x1a1816, op: .55, drag: .25, spin: (Math.random() - .5) * .3 });
}
export function fxTrail(pos, color, s = 1, life = 2.5) { spawnP({ pos, life, size: .8 * s, size1: 3.5 * s, color, op: .55, drag: 1 }); }
