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
// Partículas instanciadas: um draw call por modo de mistura e um único shader compilado no carregamento
// (sprites individuais custavam ~1 draw call cada e compilavam shader novo no meio do jogo → travadas).
const MAXP = 2400;
const VS = `
attribute vec3 iPos; attribute vec4 iData; attribute vec4 iCol;
varying vec2 vUv; varying vec4 vCol; varying float vKind; varying float vFog; varying float vH;
void main(){
  vUv = uv; vCol = iCol; vKind = iData.w;
  float c = cos(iData.y), s = sin(iData.y);
  vec2 q = mat2(c, -s, s, c) * position.xy;
  vH = position.y + 0.5;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  mv.xy += q * iData.x;
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform sampler2D tSmoke; uniform sampler2D tFire; uniform vec3 fogColor; uniform float fogDensity; uniform vec3 sunTint;
varying vec2 vUv; varying vec4 vCol; varying float vKind; varying float vFog; varying float vH;
void main(){
  vec4 t = vKind > 0.5 ? texture2D(tFire, vUv) : texture2D(tSmoke, vUv);
  float a = t.a * vCol.a;
  if (a < 0.004) discard;
  vec3 col = vCol.rgb;
  if (vKind < 0.5) col *= sunTint * mix(0.78, 1.12, vH) * (0.85 + 0.15 * t.r);
  float f = 1.0 - exp(-fogDensity * fogDensity * vFog * vFog);
  col = mix(col, fogColor, f * (vKind > 0.5 ? 0.6 : 1.0));
  gl_FragColor = vec4(col, a);
}`;
export function makeLayer(additive) {
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const dat = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPos', pos); g.setAttribute('iData', dat); g.setAttribute('iCol', col);
  g.instanceCount = 0;
  const m = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { tSmoke: { value: TEX.smoke }, tFire: { value: TEX.fire }, fogColor: { value: scene.fog.color }, fogDensity: { value: 0 }, sunTint: { value: new THREE.Color(1.0, 0.97, 0.92) } },
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = additive ? 3 : 2; scene.add(mesh);
  return { g, pos, dat, col, mesh, list: [] };
}
const LAY = [makeLayer(false), makeLayer(true)];
const _c = new THREE.Color();
export function spawnP(o) {
  const L = LAY[o.add ? 1 : 0];
  if (L.list.length >= MAXP) L.list.shift();
  _c.set(o.color ?? 0xffffff); if (o.add) _c.multiplyScalar(o.hdr ?? 1.3);
  L.list.push({
    pos: o.pos.clone(), vel: o.vel ? o.vel.clone() : new V3(), life: o.life, max: o.life,
    s0: o.size, s1: o.size1 ?? o.size * 2.2, op: o.op ?? 1, drag: o.drag ?? 1.5, rise: o.rise ?? 0, grav: o.grav ?? 0,
    rot: Math.random() * 6.28, spin: o.spin ?? (Math.random() - 0.5) * 0.5, r: _c.r, g: _c.g, b: _c.b, kind: o.tex === TEX.fire ? 1 : 0, add: !!o.add,
  });
}
export function updateParts(dt) {
  for (const L of LAY) {
    let n = 0;
    const P = L.pos.array, D = L.dat.array, C = L.col.array, keep = [];
    for (const p of L.list) {
      p.life -= dt; if (p.life <= 0) continue;
      keep.push(p);
      const k = 1 - p.life / p.max;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt)); p.vel.y += (p.rise - p.grav) * dt;
      p.pos.addScaledVector(p.vel, dt); p.rot += p.spin * dt;
      const size = lerp(p.s0, p.s1, 1 - (1 - k) * (1 - k));
      const fin = Math.min(1, k * (p.add ? 12 : 4));
      P[n * 3] = p.pos.x; P[n * 3 + 1] = p.pos.y; P[n * 3 + 2] = p.pos.z;
      D[n * 4] = size; D[n * 4 + 1] = p.rot; D[n * 4 + 2] = 0; D[n * 4 + 3] = p.kind;
      C[n * 4] = p.r; C[n * 4 + 1] = p.g; C[n * 4 + 2] = p.b; C[n * 4 + 3] = p.op * fin * Math.pow(1 - k, 1.5);
      n++;
    }
    L.list = keep;
    L.g.instanceCount = n;
    L.pos.needsUpdate = L.dat.needsUpdate = L.col.needsUpdate = true;
    L.pos.clearUpdateRanges(); L.pos.addUpdateRange(0, n * 3);
    L.dat.clearUpdateRanges(); L.dat.addUpdateRange(0, n * 4);
    L.col.clearUpdateRanges(); L.col.addUpdateRange(0, n * 4);
    L.mesh.material.uniforms.fogDensity.value = scene.fog.density;
  }
}
export function clearParts() { for (const L of LAY) { L.list = []; L.g.instanceCount = 0; } }
const flash = (pos, i) => flashAt(pos, i, S);
export function fxDust(pos, n = 8, s = 1) {
  for (let i = 0; i < n; i++) spawnP({ pos: pos.clone().add(rv(0.6 * s)), vel: rv(2.5 * s).setY(rand(1, 4) * s), life: rand(1.2, 2.2), size: 1.0 * s, size1: 3.2 * s, color: 0xa89a7c, op: .3, rise: 0.1, drag: 2.2 });
}
export function fxSparks(pos, n = 7) {
  for (let i = 0; i < n; i++) spawnP({ pos, vel: rv(9), life: rand(.15, .35), size: .35, size1: .1, tex: TEX.fire, add: true, color: 0xffd080, grav: 9, drag: .5 });
}
export function fxExplosion(pos, s = 1) {
  for (let i = 0; i < 10 * s; i++) spawnP({ pos: pos.clone().add(rv(.4 * s)), vel: rv(7 * s), life: rand(.25, .55), size: 1.5 * s, size1: 4.5 * s, tex: TEX.fire, add: true, color: 0xffb060 });
  for (let i = 0; i < 9 * s; i++) spawnP({ pos: pos.clone().add(rv(.8 * s)), vel: rv(3.5 * s).setY(rand(1, 5) * s), life: rand(2, 3.5), size: 1.6 * s, size1: 5.5 * s, color: 0x8a847c, op: .32, rise: .45, drag: 1.4 });
  flash(pos, 6 * s);
}
export function fxBigBlast(pos, s) {
  fxExplosion(pos, s * 0.8);
  for (let i = 0; i < 26; i++) spawnP({ pos: pos.clone().add(rv(s)), vel: new V3(rand(-1, 1) * 6 * s, rand(10, 26) * s, rand(-1, 1) * 6 * s), life: rand(2.5, 4.5), size: 2.5 * s, size1: 8 * s, color: 0x8c7a5e, op: .6, grav: 9, drag: .4 });
  for (let i = 0; i < 18; i++) { const a = Math.random() * 6.28; spawnP({ pos: pos.clone().setY(pos.y + .5), vel: new V3(Math.cos(a) * 22 * s, rand(.5, 2), Math.sin(a) * 22 * s), life: rand(2, 3.5), size: 3 * s, size1: 10 * s, color: 0xbcae92, op: .35, drag: 1.4 }); }
}
export function fxMuzzle(pos, dir, cal) {
  const s = cal / 80;
  for (let i = 0; i < 5; i++) spawnP({ pos: pos.clone().addScaledVector(dir, i * 0.6 * s), vel: dir.clone().multiplyScalar(18 + i * 4), life: .09, size: 1.6 * s, size1: 2.4 * s, tex: TEX.fire, add: true, color: 0xffc070, drag: 8 });
  for (let i = 0; i < 6; i++) spawnP({ pos: pos.clone(), vel: dir.clone().multiplyScalar(rand(6, 16)).add(rv(2.5)), life: rand(1.4, 2.4), size: .9 * s, size1: 3.6 * s, color: 0xd2cec6, op: .2, rise: .3, drag: 2.6 });
  const gp = pos.clone(); gp.y = H(gp.x, gp.z) + 0.3;
  if (pos.y - gp.y < 4) for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28; spawnP({ pos: gp, vel: new V3(Math.cos(a) * 9, rand(.3, 1.2), Math.sin(a) * 9), life: rand(1, 1.8), size: 1.0, size1: 3.2, color: 0xb4a588, op: .16, drag: 2.8 }); }
  flash(pos, 4 * s);
}
export function fxSmallFlash(pos, dir) { spawnP({ pos: pos.clone().addScaledVector(dir, .3), vel: dir.clone().multiplyScalar(10), life: .05, size: .5, size1: .8, tex: TEX.fire, add: true, color: 0xffc070, drag: 8 }); }
export function fxBurn(pos, s) {
  spawnP({ pos: pos.clone().add(rv(.4)), vel: new V3(rand(-.4, .4), rand(1.5, 3), rand(-.4, .4)), life: rand(.35, .7), size: 1.0 * s, size1: .3, tex: TEX.fire, add: true, color: 0xff8a30, hdr: 1.2, drag: .5 });
  spawnP({ pos: pos.clone().add(new V3(0, 1, 0)), vel: new V3(rand(-.4, .4) + 0.6, rand(2, 3.2), rand(-.4, .4)), life: rand(4, 6), size: 1.2 * s, size1: 5 * s, color: 0x7c766e, op: .24, drag: .35, spin: (Math.random() - .5) * .3 });
}
export function fxTrail(pos, color, s = 1, life = 2.5) { spawnP({ pos, life, size: .8 * s, size1: 3.5 * s, color, op: .4, drag: 1 }); }
