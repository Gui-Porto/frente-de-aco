import * as THREE from 'three';
import { scene, camera } from '../core/render.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { V3, QUAT, UP, rand, srand, hash2 } from '../core/util.js';
import { H, LIMIT, INNER, POINTS, SPAWN, FW, FD, roadDist, maskGrass, HMAP, AIRFIELDS, onAirfield, stampGround } from './terrain.js';
import { addStaticBox, world } from './physics.js';
import { sndCrack, sndBoom } from '../fx/audio.js';
import { fxDust, spawnP } from '../fx/particles.js';
// Instâncias em blocos espaciais (células de `cell` m): cada bloco tem a própria esfera envolvente, então o corte por
// frustum funciona nos três passes (cor, sombra, normais do GTAO). Um InstancedMesh único com milhares de árvores
// espalhadas por 9 km era desenhado INTEIRO em todos eles.
function chunked(geo, mat, items, cell, place) {
  const by = new Map(), out = [];
  for (const it of items) { const k = Math.floor(it[0] / cell) + ',' + Math.floor(it[1] / cell); if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
  for (const list of by.values()) { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((it, i) => place(it, i, im)); im.computeBoundingSphere(); scene.add(im); out.push(im); }
  return out;
}

// =====================================================================
// Obstáculos (AABB para balística/IA) com grade espacial + colisores Rapier
// =====================================================================
export const OBST = [], HEDGES = [], TREES = [];
const OGRID = new Map(), GCELL = 24;
let stamp = 0;
const gk = (i, j) => (i + 512) * 1024 + (j + 512);
function regObst(b, collider = true) {
  b.stamp = 0; OBST.push(b);
  for (let i = Math.floor(b.mn[0] / GCELL); i <= Math.floor(b.mx[0] / GCELL); i++)
    for (let j = Math.floor(b.mn[2] / GCELL); j <= Math.floor(b.mx[2] / GCELL); j++) {
      const k = gk(i, j); if (!OGRID.has(k)) OGRID.set(k, []); OGRID.get(k).push(b);
    }
  if (collider) b.col = addStaticBox((b.mn[0] + b.mx[0]) / 2, (b.mn[1] + b.mx[1]) / 2, (b.mn[2] + b.mx[2]) / 2, (b.mx[0] - b.mn[0]) / 2, (b.mx[1] - b.mn[1]) / 2, (b.mx[2] - b.mn[2]) / 2);
  if (Math.abs(b.mn[0]) < INNER / 2 && Math.abs(b.mn[2]) < INNER / 2) maskGrass(b.mn[0] - 1, b.mn[2] - 1, b.mx[0] + 1, b.mx[2] + 1);
}
const _cand = [];
export function obstNear(x0, z0, x1, z1) {
  _cand.length = 0; stamp++;
  const i0 = Math.floor(Math.min(x0, x1) / GCELL), i1 = Math.floor(Math.max(x0, x1) / GCELL);
  const j0 = Math.floor(Math.min(z0, z1) / GCELL), j1 = Math.floor(Math.max(z0, z1) / GCELL);
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > 900) { for (const b of OBST) _cand.push(b); return _cand; }
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const l = OGRID.get(gk(i, j)); if (!l) continue;
    for (const b of l) if (b.stamp !== stamp) { b.stamp = stamp; _cand.push(b); }
  }
  return _cand;
}

// ---------- Texturas procedurais de construção ----------
function canvasTex(w, h, draw, rep = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.repeat.set(...rep); return t;
}
const stoneTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#7d7466'; g.fillRect(0, 0, w, h);
  let y = 0;
  while (y < h) {
    const rh = rand(14, 26); let x = -rand(0, 30);
    while (x < w) { const rw = rand(22, 46), v = rand(-22, 22); g.fillStyle = `rgb(${125 + v},${117 + v},${104 + v})`; g.fillRect(x + 1.5, y + 1.5, rw - 3, rh - 3); x += rw; }
    y += rh;
  }
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${rand(0, .12)})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
});
const plasterTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c4b79c'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '60,50,30'},${rand(0, .08)})`; g.fillRect(Math.random() * w, Math.random() * h, rand(1, 4), rand(1, 4)); }
  const gr = g.createLinearGradient(0, h, 0, h * 0.7); gr.addColorStop(0, 'rgba(70,60,40,.45)'); gr.addColorStop(1, 'rgba(70,60,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
// enxaimel normando (colombage): reboco claro entre vigas escuras — 1 repetição = 4 m de parede (boxUV), postes a cada 1 m
const timberTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#d8ccb0'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '70,55,30'},${rand(0, .07)})`; g.fillRect(Math.random() * w, Math.random() * h, rand(1, 4), rand(1, 4)); }
  g.fillStyle = '#3d2c1e'; g.strokeStyle = '#3d2c1e'; g.lineWidth = 9;
  for (let x = 0; x < w; x += 64) g.fillRect(x - 5, 0, 10, h);
  for (const y of [0, 118, 246]) g.fillRect(0, y, w, 10);
  for (const [c, r, s] of [[0, 0, 1], [3, 0, -1], [1, 1, 1], [2, 1, -1]]) { g.beginPath(); g.moveTo(c * 64 + (s > 0 ? 5 : 59), r * 128 + 123); g.lineTo(c * 64 + (s > 0 ? 59 : 5), r * 128 + 15); g.stroke(); }
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(0,0,0,${rand(0, .1)})`; g.fillRect(Math.random() * w, Math.random() * h, 2, rand(4, 12)); }
});
const tileTex = canvasTex(256, 256, (g, w, h) => {
  for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 * 10; x < w + 20; x += 20) { const v = rand(-20, 20); g.fillStyle = `rgb(${120 + v},${58 + v / 2},${42 + v / 2})`; g.fillRect(x, y, 19, 15); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + 13, 19, 3); }
});
const slateTex = canvasTex(256, 256, (g, w, h) => {
  for (let y = 0; y < h; y += 14) for (let x = (y / 14) % 2 * 9; x < w + 18; x += 18) { const v = rand(-12, 12); g.fillStyle = `rgb(${62 + v},${66 + v},${74 + v})`; g.fillRect(x, y, 17, 13); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x, y + 11, 17, 3); }
});
const mat = (map, color = 0xffffff, rough = 0.92) => new THREE.MeshStandardMaterial({ map, color, roughness: rough, metalness: 0 });
const M = {
  stone: mat(stoneTex), plaster: mat(plasterTex), timber: mat(timberTex), shutter: new THREE.MeshStandardMaterial({ color: 0x4f6b66, roughness: .8 }), tile: mat(tileTex, 0xffffff, 0.8), slate: mat(slateTex, 0xffffff, 0.7),
  ruin: mat(stoneTex, 0x9a9488), wood: new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: .85 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1a2328, roughness: .15, metalness: .4 }), frame: new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: .8 }),
};
// Construções demolíveis: enquanto `cur` aponta para uma, toda malha criada entra nela. Na fusão por material (abaixo)
// cada construção guarda os trechos de vértices que são dela; demolir = baixar a parede a um toco e enterrar o resto.
export const BUILDS = [];
let cur = null;
function building(x, z, W, D, y0, hh, hp, ram = false) {
  const ob = { mn: [x - W / 2, y0, z - D / 2], mx: [x + W / 2, y0 + hh, z + D / 2] }; regObst(ob);
  cur = ob.b = { x, z, W, D, y0, top: y0 + hh, hp, hp0: hp, ram, ob, parts: [], dead: false }; BUILDS.push(cur); return cur;
}
const add = (geo, m, x, y, z, ry = 0, wall = false) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; o.userData.b = cur; o.userData.wall = wall; scene.add(o); return o; };
function boxUV(w, h, d, scale = 4) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) { const ax = Math.abs(n.getX(i)) > .5 ? d : w; uv.setXY(i, uv.getX(i) * ax / scale, uv.getY(i) * (Math.abs(n.getY(i)) > .5 ? d : h) / scale); }
  return g;
}
function groundMin(x, z, w, d) { return Math.min(H(x - w / 2, z - d / 2), H(x + w / 2, z - d / 2), H(x - w / 2, z + d / 2), H(x + w / 2, z + d / 2), H(x, z)); }
function clearSpot(x, z, rad) {
  if (roadDist(x, z) < rad + 5) return false;
  for (const p of POINTS) if (Math.hypot(x - p.x, z - p.z) < 18 + rad) return false;
  for (const s of [SPAWN[1], SPAWN[-1]]) if (Math.hypot(x - s.x, z - s.z) < 48) return false;
  for (const b of obstNear(x - rad - 3, z - rad - 3, x + rad + 3, z + rad + 3)) if (x + rad > b.mn[0] - 3 && x - rad < b.mx[0] + 3 && z + rad > b.mn[2] - 3 && z - rad < b.mx[2] + 3) return false;
  return true;
}
function gable(len, span, rise, m) {
  const s = new THREE.Shape(); s.moveTo(-span / 2 - .45, 0); s.lineTo(span / 2 + .45, 0); s.lineTo(0, rise); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len + .6, bevelEnabled: false }); g.translate(0, 0, -(len + .6) / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
  return new THREE.Mesh(g, m);
}
// Casa normanda: alvenaria, portas, janelas com caixilho, telhado de duas águas, chaminé
function house(x, z, ruined) {
  const alongX = srand() < 0.5, w = 6 + srand() * 4, d = 8 + srand() * 4, h = ruined ? 2 + srand() * 2 : 4 + srand() * 2.4;
  const W = alongX ? d : w, D = alongX ? w : d;
  if (!clearSpot(x, z, Math.max(W, D) / 2)) return;
  const y0 = groundMin(x, z, W, D) - 0.6, hh = h + 0.6, wr = srand(), wallM = wr < 0.45 ? M.stone : wr < 0.8 ? M.timber : M.plaster;
  building(x, z, W, D, y0, hh, ruined ? 60 : 110);
  add(boxUV(W, hh, D), ruined ? M.ruin : wallM, x, y0 + hh / 2, z, 0, true);
  if (ruined) { for (let i = 0; i < 6; i++) add(new THREE.DodecahedronGeometry(rand(.3, .8), 0), M.ruin, x + rand(-W, W) * .6, H(x, z) + .2, z + rand(-D, D) * .6); cur = null; return; }
  const top = y0 + hh, long = Math.max(W, D), short = Math.min(W, D);
  if (wallM !== M.stone) add(boxUV(W + .16, 1.5, D + .16), M.stone, x, y0 + 0.75, z); // embasamento de pedra
  // portas e janelas nas fachadas longas
  for (const s of [1, -1]) for (let k = -1; k <= 1; k++) {
    const isDoor = k === 0 && s === 1, ww = isDoor ? 1.1 : 0.95, wh = isDoor ? 2.1 : 1.15, yy = isDoor ? y0 + 0.6 + 1.05 : top - h * 0.42;
    const off = k * long * 0.28, fx = alongX ? x + off : x + s * (W / 2 + 0.04), fz = alongX ? z + s * (D / 2 + 0.04) : z + off, ry = alongX ? 0 : Math.PI / 2;
    add(new THREE.BoxGeometry(ww + .2, wh + .2, .06), M.frame, fx, yy, fz, ry);
    add(new THREE.BoxGeometry(ww, wh, .08), isDoor ? M.wood : M.glass, fx, yy, fz, ry);
    if (isDoor) continue;
    add(new THREE.BoxGeometry(ww + .5, .1, .22), M.stone, fx, yy - wh / 2 - .13, fz, ry); // peitoril
    for (const e of [1, -1]) { const o = e * (ww / 2 + .3); add(new THREE.BoxGeometry(.46, wh + .1, .07), M.shutter, fx + (alongX ? o : 0), yy, fz + (alongX ? 0 : o), ry); } // venezianas abertas
  }
  const roof = gable(long, short, 2.4 + short * 0.12, srand() < 0.6 ? M.tile : M.slate);
  roof.position.set(x, top, z); roof.rotation.y = alongX ? Math.PI / 2 : 0; roof.castShadow = roof.receiveShadow = true; roof.userData.b = cur; scene.add(roof);
  if (srand() < 0.7) add(boxUV(.7, 2.2, .7, 2), M.stone, x + (alongX ? long * .3 : short * .2), top + 1.4, z + (alongX ? short * .2 : long * .3));
  cur = null;
}
// Igreja de pedra no vilarejo B
{
  const x = 34, z = -38, y0 = groundMin(x, z, 12, 24) - 0.6;
  building(x, z, 11, 22, y0, 11, 500); add(boxUV(11, 11, 22), M.stone, x, y0 + 5.5, z, 0, true);
  const r = gable(22, 11, 5.5, M.slate); r.position.set(x, y0 + 11, z); r.castShadow = true; r.userData.b = cur; scene.add(r);
  for (let i = -3; i <= 3; i += 2) add(new THREE.BoxGeometry(.06, 3, 1.1), M.glass, x + 5.53, y0 + 6, z + i * 2.6);
  building(x, z + 13, 5.5, 5.5, y0, 24, 400); add(boxUV(5.5, 24, 5.5), M.stone, x, y0 + 12, z + 13, 0, true);
  const sp = add(new THREE.ConeGeometry(3.9, 12, 4), M.slate, x, y0 + 30, z + 13); sp.rotation.y = Math.PI / 4;
  cur = null;
}
// lugarejos entre os pontos (o campo dobrou de tamanho: sem eles sobrava pasto aberto entre A, B e C)
for (const [hx, hz, n] of [[-210, 310, 7], [210, -310, 7], [-470, -330, 6], [470, 330, 6], [-190, -250, 5], [190, 250, 5], [20, 340, 6], [-20, -340, 6], [-610, 300, 4], [610, -300, 4]])
  for (let i = 0; i < n; i++) { const a = srand() * Math.PI * 2, r = 10 + srand() * 34; house(hx + Math.cos(a) * r, hz + Math.sin(a) * r, srand() < 0.2); }
for (const p of POINTS) for (let i = 0; i < (p.id === 'B' ? 16 : 7); i++) { const a = srand() * Math.PI * 2, r = 24 + srand() * (p.id === 'B' ? 42 : 30); house(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, srand() < 0.25); }
for (let i = 0; i < 46; i++) house((srand() * 2 - 1) * (LIMIT - 30), (srand() * 2 - 1) * (LIMIT - 90), srand() < 0.3);
for (let i = 0; i < 50; i++) house(srand() * 6000 - 3000, srand() * 6000 - 3000, false);
for (let i = 0; i < 60; i++) {
  const x = (srand() * 2 - 1) * (LIMIT - 30), z = (srand() * 2 - 1) * (LIMIT - 80), along = srand() < 0.5, len = 14 + srand() * 22;
  if (!clearSpot(x, z, len / 2)) continue;
  const w = along ? len : 0.9, d = along ? 0.9 : len, y0 = groundMin(x, z, w, d) - 0.6;
  building(x, z, w, d, y0, 2.5, 40, true); add(boxUV(w, 2.5, d, 2), M.ruin, x, y0 + 1.25, z, 0, true); cur = null; // muro: tanque derruba passando por cima
}
for (let i = 0; i < 80; i++) {
  const x = (srand() * 2 - 1) * (LIMIT - 20), z = (srand() * 2 - 1) * (LIMIT - 60), s = 1.6 + srand() * 2.4;
  if (!clearSpot(x, z, s)) continue;
  const g = new THREE.DodecahedronGeometry(s, 1), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) { const f = 0.8 + 0.35 * hash2(Math.round(p.getX(k) * 23 + p.getZ(k) * 11), Math.round(p.getY(k) * 19 + i)); p.setXYZ(k, p.getX(k) * f, p.getY(k) * f * 0.7, p.getZ(k) * f); } // deformação pela posição: sorteio por vértice rasgava a malha em lascas
  g.computeVertexNormals();
  const y = H(x, z); const o = add(g, M.ruin, x, y + s * 0.25, z); o.rotation.set(0, srand() * 6, 0);
  regObst({ mn: [x - s * 0.8, y - 2, z - s * 0.8], mx: [x + s * 0.8, y + s * 0.8, z + s * 0.8] });
}

// prédios/ruínas: centenas de malhas estáticas viram uma por material (cada malha era 1 draw call × cor/sombra/AO)
{
  const mats = new Set(Object.values(M)), by = new Map(), off = new Map();
  for (const o of [...scene.children]) if (o.isMesh && !o.isInstancedMesh && mats.has(o.material)) {
    o.updateMatrix(); const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix);
    const s = off.get(o.material) || 0, n = g.attributes.position.count; off.set(o.material, s + n);
    if (o.userData.b) o.userData.b.parts.push({ m: o.material, s, n, wall: o.userData.wall });
    if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push(g); scene.remove(o); o.geometry.dispose();
  }
  for (const [m, gs] of by) { const o = new THREE.Mesh(mergeGeometries(gs), m); o.castShadow = o.receiveShadow = true; scene.add(o); m.userData.pos = o.geometry.attributes.position; m.userData.p0 = m.userData.pos.array.slice(); }
}
// entulho: um InstancedMesh só (já na cena desde o carregamento — nenhum shader novo na hora da demolição)
const RUB = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), M.ruin, 2400); RUB.castShadow = RUB.receiveShadow = true; RUB.frustumCulled = false; scene.add(RUB);
let rubI = 0;
{ const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < 2400; i++) RUB.setMatrixAt(i, z); }
const _rm = new THREE.Matrix4(), _rq = new QUAT(), _rs = new V3(), _rp = new V3(), _re = new THREE.Euler();
export function demolish(B) {
  if (B.dead) return; B.dead = true; B.ob.mx[1] = B.y0 + 0.3; // caixa abaixo do chão: tiro, IA e avião deixam de enxergar a construção
  if (B.ob.col) { world.removeCollider(B.ob.col, false); B.ob.col = null; }
  for (const pt of B.parts) {
    const a = pt.m.userData.pos;
    for (let i = pt.s; i < pt.s + pt.n; i++) a.setY(i, pt.wall ? Math.min(a.getY(i), B.y0 + 0.7 + 0.35 * hash2(Math.round(a.getX(i) * 7), Math.round(a.getZ(i) * 7))) : B.y0 - 4);
    a.needsUpdate = true;
  }
  const n = Math.min(44, 5 + Math.round(B.W * B.D / 2.2)), g = H(B.x, B.z);
  for (let i = 0; i < n; i++) {
    const s = rand(.3, 1.15), u = rand(-.62, .62), v = rand(-.62, .62); _rp.set(B.x + u * B.W, 0, B.z + v * B.D); _rp.y = H(_rp.x, _rp.z) + s * 0.2 + (Math.abs(u) < .5 && Math.abs(v) < .5 ? rand(.1, .9) : 0); // monte mais alto no meio
    _rs.set(s * rand(.8, 1.5), s * rand(.45, .8), s * rand(.8, 1.5)); _rq.setFromEuler(_re.set(rand(-.3, .3), rand(0, 6), rand(-.3, .3)));
    RUB.setMatrixAt(rubI, _rm.compose(_rp, _rq, _rs)); rubI = (rubI + 1) % 2400;
  }
  RUB.instanceMatrix.needsUpdate = true;
  const R = Math.max(B.W, B.D) * 0.6 + 2, k = Math.min(3, R / 4);
  stampGround(2, B.x, B.z, R, t => 0.9 * (1 - t * t));
  for (let i = 0; i < 5; i++) fxDust(new V3(B.x + rand(-.4, .4) * B.W, g + rand(.5, 2.5), B.z + rand(-.4, .4) * B.D), 10, 1.2 + k * 0.5);
  for (let i = 0; i < 6; i++) spawnP({ pos: new V3(B.x + rand(-.4, .4) * B.W, g + rand(1, Math.min(6, B.top - B.y0)), B.z + rand(-.4, .4) * B.D), vel: new V3(rand(-1.5, 1.5), rand(.5, 2), rand(-1.5, 1.5)), life: rand(3, 5.5), size: 2 + k, size1: 7 + k * 4, color: 0xb9ad98, op: .55, drag: 1.5 });
  sndCrack(_rp.set(B.x, g, B.z)); if (B.hp0 > 50) sndBoom(_rp, B.hp0 > 300);
}
export function damageObst(ob, dmg) { const B = ob && ob.b; if (B && !B.dead && (B.hp -= dmg) <= 0) demolish(B); }
// explosão: dano cai com a distância até a caixa da construção (granada HE de 85 mm ≈ 60, bomba de 250 kg derruba o quarteirão)
export function blastBuildings(pos, tnt) {
  if (tnt < 0.01) return;
  const R = 2 + 3 * Math.cbrt(tnt), k = 70 * Math.pow(tnt, 2 / 3);
  for (const b of [...obstNear(pos.x - R, pos.z - R, pos.x + R, pos.z + R)]) {
    if (!b.b || b.b.dead) continue;
    const d = Math.hypot(Math.max(b.mn[0] - pos.x, 0, pos.x - b.mx[0]), Math.max(b.mn[1] - pos.y, 0, pos.y - b.mx[1]), Math.max(b.mn[2] - pos.z, 0, pos.z - b.mx[2]));
    if (d < R) damageObst(b, k * (1 - d / R) ** 2);
  }
}
export function resetBuildings() {
  for (const B of BUILDS) {
    B.hp = B.hp0; if (!B.dead) continue; B.dead = false; B.ob.mx[1] = B.top;
    const b = B.ob; b.col = addStaticBox((b.mn[0] + b.mx[0]) / 2, (b.mn[1] + b.mx[1]) / 2, (b.mn[2] + b.mx[2]) / 2, (b.mx[0] - b.mn[0]) / 2, (b.mx[1] - b.mn[1]) / 2, (b.mx[2] - b.mn[2]) / 2);
    for (const pt of B.parts) { const a = pt.m.userData.pos; a.array.set(pt.m.userData.p0.subarray(pt.s * 3, (pt.s + pt.n) * 3), pt.s * 3); a.needsUpdate = true; }
  }
  const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < 2400; i++) RUB.setMatrixAt(i, z); RUB.instanceMatrix.needsUpdate = true;
}

// ---------- Vegetação instanciada ----------
function mergeColored(parts) {
  const geos = parts.map(([g]) => (g.index ? g.toNonIndexed() : g));
  let n = 0; geos.forEach(g => (n += g.attributes.position.count));
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3); let o = 0;
  geos.forEach((g, k) => {
    P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < g.attributes.position.count; i++) C.set(parts[k][1], (o + i) * 3);
    o += g.attributes.position.count;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return geo;
}
// Cercas vivas (bocage): bloqueiam a visão; tanques atravessam com perda de velocidade
{
  // arbusto: esfera deformada com normais de esfera (macio); a deformação sai da POSIÇÃO do vértice — com sorteio por
  // vértice a malha (não indexada) abria em triângulos soltos e espetados
  const bush = new THREE.IcosahedronGeometry(1, 1), bp = bush.attributes.position, bn = bush.attributes.normal;
  for (let k = 0; k < bp.count; k++) { const x = bp.getX(k), y = bp.getY(k), z = bp.getZ(k), f = 0.82 + 0.36 * hash2(Math.round(x * 31 + z * 17), Math.round(y * 29 - z * 13)); bn.setXYZ(k, x, y * 0.7 + 0.3, z); bp.setXYZ(k, x * f, y * f, z * f); }
  const list = [];
  const seg = (pts) => { const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]), y0 = Math.min(...pts.map(p => H(p[0], p[1]))); return { mn: [Math.min(...xs) - 0.8, y0 - 1, Math.min(...zs) - 0.8], mx: [Math.max(...xs) + 0.8, y0 + 2.9, Math.max(...zs) + 0.8], stamp: 0 }; };
  for (let i = -Math.ceil(LIMIT / FW) - 2; i <= Math.ceil(LIMIT / FW) + 2; i++) for (let j = -Math.ceil(LIMIT / FD) - 2; j <= Math.ceil(LIMIT / FD) + 2; j++) for (const horiz of [true, false]) {
    if (hash2(i * 7 + (horiz ? 1 : 2), j * 13) > 0.42) continue;
    const x0 = i * FW - 13, z0 = j * FD - 7, len = horiz ? FW : FD, cx = horiz ? x0 + FW / 2 : x0, cz = horiz ? z0 : z0 + FD / 2;
    if (Math.abs(cx) > LIMIT + 120 || Math.abs(cz) > LIMIT + 120) continue;
    const pts = [];
    for (let s = -len / 2; s <= len / 2; s += 2.3) {
      const x = horiz ? cx + s : cx + rand(-.3, .3), z = horiz ? cz + rand(-.3, .3) : cz + s;
      if (roadDist(x, z) < 7 || POINTS.some(p => Math.hypot(x - p.x, z - p.z) < 26) || [SPAWN[1], SPAWN[-1]].some(p => Math.hypot(x - p.x, z - p.z) < 50)) { if (pts.length > 2) HEDGES.push(seg(pts)); pts.length = 0; continue; }
      if (obstNear(x - 2, z - 2, x + 2, z + 2).some(b => x > b.mn[0] - 1 && x < b.mx[0] + 1 && z > b.mn[2] - 1 && z < b.mx[2] + 1)) continue;
      pts.push([x, z]); list.push([x, z]);
    }
    if (pts.length > 2) HEDGES.push(seg(pts));
  }
  const m = new THREE.Matrix4(), q = new QUAT(), s = new V3(), p = new V3(), c = new THREE.Color();
  for (const mesh of chunked(bush, new THREE.MeshStandardMaterial({ roughness: 1 }), list, 160, ([x, z], i, mesh) => {
    const sc = rand(1.35, 1.95); p.set(x, H(x, z) + sc * 0.6, z); q.setFromEuler(new THREE.Euler(0, rand(0, 6), 0)); s.set(sc, sc * rand(0.9, 1.35), sc);
    m.compose(p, q, s); mesh.setMatrixAt(i, m); c.setRGB(rand(.045, .075), rand(.085, .125), rand(.028, .042)); mesh.setColorAt(i, c);
    maskGrass(x - 1.5, z - 1.5, x + 1.5, z + 1.5);
  })) mesh.castShadow = mesh.receiveShadow = true;
}
// Árvores da área de combate (derrubáveis) e florestas distantes
// Colisão das árvores com aviões: grade de células de 32 m com { x, z, r (copa), top (altura do topo) }
const TGRID = new Map(), TCELL = 32;
const regTree = (x, z, r, top) => { const k = gk(Math.floor(x / TCELL), Math.floor(z / TCELL)); if (!TGRID.has(k)) TGRID.set(k, []); TGRID.get(k).push({ x, z, r, top }); };
// algo de raio `rad` em (x, y, z) bate numa árvore?
export function treeHit(x, y, z, rad) {
  const i0 = Math.floor((x - rad - 4) / TCELL), i1 = Math.floor((x + rad + 4) / TCELL), j0 = Math.floor((z - rad - 4) / TCELL), j1 = Math.floor((z + rad + 4) / TCELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const t of TGRID.get(gk(i, j)) || []) if (y < t.top && Math.hypot(x - t.x, z - t.z) < t.r + rad) return true;
  return false;
}
// pista e corredor de aproximação ficam livres de árvores
const runwayClear = (x, z) => AIRFIELDS.some(a => onAirfield(a, x, z, 40) || (Math.abs(x - a.x) < 140 && Math.abs(z - a.z) < a.len / 2 + 1600));
// copa: esfera deformada com normais "de esfera" (sombreado macio em vez de facetas) — o dono achou o mapa feio e as
// árvores/cercas de triângulos chapados eram o que mais pesava
function blob(r, det, cx, cy, cz, sy = 0.8) {
  const g = new THREE.IcosahedronGeometry(r, det), P = g.attributes.position, N = g.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), f = 0.8 + 0.4 * hash2(Math.round(x * 31 + z * 17), Math.round(y * 29 - z * 13));
    N.setXYZ(i, x / r, y / r * 0.8 + 0.2, z / r); P.setXYZ(i, x * f + cx, y * f * sy + cy, z * f + cz);
  }
  return g;
}
// folhagem (y > y0): mais escura por baixo e perto do tronco, clara nas pontas de cima (oclusão falsa, de graça)
function shade(geo, y0, y1) {
  const P = geo.attributes.position, C = geo.attributes.color;
  for (let i = 0; i < P.count; i++) if (P.getY(i) > y0) { const k = 0.5 + 0.55 * Math.min(1, (P.getY(i) - y0) / (y1 - y0)) + 0.1 * Math.min(1.5, Math.hypot(P.getX(i), P.getZ(i))); C.setXYZ(i, C.getX(i) * k, C.getY(i) * k, C.getZ(i) * k); }
  return geo;
}
function broadleaf(det, hue) {
  const trunk = new THREE.CylinderGeometry(0.2, 0.42, 4.4, 7); trunk.translate(0, 2.2, 0);
  const parts = [[trunk, [0.13, 0.095, 0.065]], [blob(2.7, det, 0, 6.6, 0), [0.075 + hue, 0.125, 0.04]]];
  for (let k = 0; k < 4; k++) { const a = k * 1.57 + rand(-.4, .4), d = rand(1.5, 2.2); parts.push([blob(rand(1.5, 2.1), det, Math.cos(a) * d, rand(4.6, 6.2), Math.sin(a) * d), [0.065 + hue + k * .004, 0.11 + k * .004, 0.036]]); }
  return shade(mergeColored(parts), 3.4, 9);
}
const leafMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
{
  const trunk = new THREE.CylinderGeometry(0.18, 0.3, 3.2, 7); trunk.translate(0, 1.6, 0);
  // abeto: 6 saias de galhos, cada uma com a borda em estrela (ponta sim, ponta não) e caída
  const tiers = [[trunk, [0.16, 0.11, 0.07]]];
  for (let k = 0; k < 6; k++) {
    const f = k / 5, r = 2.6 - 1.9 * f, hgt = 2.6 - 0.9 * f, g = new THREE.ConeGeometry(r, hgt, 14), gp = g.attributes.position;
    for (let i = 0; i < gp.count; i++) if (gp.getY(i) < 0) { const a = Math.round(Math.atan2(gp.getZ(i), gp.getX(i)) / (Math.PI / 7)), long = ((a % 2) + 2) % 2 === 0, m = long ? 1.1 : 0.78; gp.setXYZ(i, gp.getX(i) * m, gp.getY(i) - (long ? 0.4 : 0), gp.getZ(i) * m); }
    g.rotateY(k * 0.9); g.translate(0, 3.3 + k * 1.15 + hgt / 2 - 0.4, 0); g.computeVertexNormals();
    tiers.push([g, [0.04 + 0.02 * f, 0.08 + 0.03 * f, 0.035 + 0.012 * f]]);
  }
  const pine = shade(mergeColored(tiers), 3.25, 11);
  const GEO = [pine, broadleaf(1, 0), broadleaf(1, 0.03)], TOP = [10.3, 9.2, 9.2], RAD = [1.6, 2.8, 2.8], lists = [[], [], []];
  for (let i = 0, n = 0; i < 16000 && n < 2000; i++) {
    const cx = (srand() * 2 - 1) * (LIMIT + 40), cz = (srand() * 2 - 1) * (LIMIT + 10);
    const k = Math.sin(cx * 0.02) * Math.cos(cz * 0.017) + Math.sin(cx * 0.051 + 2) * 0.4;
    if (k < 0.38) continue;
    // espécies em manchas: capões de abeto e bosques de folha larga, não tudo misturado
    const kind = Math.sin(cx * 0.0061 + 1.3) + Math.cos(cz * 0.0074) > 0.5 ? 0 : srand() < 0.5 ? 1 : 2;
    if (clearSpot(cx, cz, 1.2)) { lists[kind].push([cx, cz, 0.8 + srand() * 0.6]); n++; }
  }
  const m = new THREE.Matrix4(), q = new QUAT(), s = new V3(), p = new V3(), col = new THREE.Color();
  lists.forEach((list, kind) => {
    const mesh = new THREE.InstancedMesh(GEO[kind], leafMat(), list.length); mesh.castShadow = mesh.receiveShadow = true;
    list.forEach(([x, z, sc], i) => {
      p.set(x, H(x, z) - 0.2, z); q.setFromAxisAngle(UP, srand() * 6); s.set(sc, sc * rand(.9, 1.15), sc);
      m.compose(p, q, s); mesh.setMatrixAt(i, m); col.setRGB(rand(.8, 1.2), rand(.85, 1.15), rand(.8, 1.1)); mesh.setColorAt(i, col);
      TREES.push({ x, z, sc, down: false, i, rot: q.clone(), m: mesh }); regTree(x, z, RAD[kind] * sc, H(x, z) + TOP[kind] * sc);
      maskGrass(x - 1, z - 1, x + 1, z + 1);
    });
    mesh.computeBoundingSphere(); scene.add(mesh);
  });
  const far = [], oak = broadleaf(0, 0.01);
  for (let i = 0; i < 40000 && far.length < 5200; i++) {
    const x = srand() * 9000 - 4500, z = srand() * 9000 - 4500;
    if (Math.max(Math.abs(x), Math.abs(z)) < INNER / 2 || runwayClear(x, z)) continue;
    if (Math.sin(x * 0.004) * Math.cos(z * 0.0035) + Math.sin(x * 0.011 + z * 0.007) * 0.5 < 0.55) continue;
    far.push([x, z, 0.9 + srand() * 0.7]);
  }
  for (const fm of chunked(oak, leafMat(), far, 1125, ([x, z, sc], i, fm) => { p.set(x, H(x, z) - 1.6, z); q.setFromAxisAngle(UP, srand() * 6); s.set(sc * 1.4, sc * 1.4, sc * 1.4); m.compose(p, q, s); fm.setMatrixAt(i, m); col.setScalar(rand(.75, 1.2)); fm.setColorAt(i, col); regTree(x, z, 2.6 * sc, H(x, z) - 1.6 + 9 * sc * 1.4); })) fm.castShadow = true;
}
export function resetTrees() {
  const m = new THREE.Matrix4(), s = new V3(), p = new V3();
  for (const t of TREES) if (t.down) { t.down = false; s.set(t.sc, t.sc, t.sc); p.set(t.x, H(t.x, t.z) - 0.2, t.z); m.compose(p, t.rot, s); t.m.setMatrixAt(t.i, m); t.m.instanceMatrix.needsUpdate = true; }
}
export function fellTree(t, dirx, dirz) {
  t.down = true;
  const axis = new V3(dirz, 0, -dirx).normalize();
  const q = new QUAT().setFromAxisAngle(axis, Math.PI / 2 * 0.95).multiply(t.rot);
  t.m.setMatrixAt(t.i, new THREE.Matrix4().compose(new V3(t.x, H(t.x, t.z) + 0.2, t.z), q, new V3(t.sc, t.sc, t.sc)));
  t.m.instanceMatrix.needsUpdate = true;
  sndCrack(new V3(t.x, H(t.x, t.z), t.z));
}

// ---------- Grama: tufos instanciados na GPU, com vento; posição e altura vêm do mapa de altura ----------
export const grass = (() => {
  const tex = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { const x = rand(8, w - 8), hh = rand(h * .45, h * .98), bend = rand(-14, 14); g.strokeStyle = `rgba(255,255,255,${rand(.75, 1)})`; g.lineWidth = rand(2, 4.5); g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + bend * .3, h - hh * .5, x + bend, h - hh); g.stroke(); }
  });
  tex.colorSpace = THREE.NoColorSpace;
  const base = new THREE.PlaneGeometry(1.2, 0.9); base.translate(0, 0.45, 0);
  const b2 = base.clone().rotateY(Math.PI / 2);
  const g = new THREE.InstancedBufferGeometry();
  const merged = mergeColored([[base, [1, 1, 1]], [b2, [1, 1, 1]]]);
  g.setAttribute('position', merged.attributes.position); g.setAttribute('normal', merged.attributes.normal);
  const uv = new Float32Array(merged.attributes.position.count * 2), pa = merged.attributes.position;
  for (let i = 0; i < pa.count; i++) { const isX = i < pa.count / 2; uv[i * 2] = (isX ? pa.getX(i) : pa.getZ(i)) / 1.2 + 0.5; uv[i * 2 + 1] = pa.getY(i) / 0.9; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const MAX = 26000, side = 120;
  const off = new Float32Array(MAX * 3);
  for (let i = 0; i < MAX; i++) { off[i * 3] = Math.random() * side; off[i * 3 + 1] = Math.random() * side; off[i * 3 + 2] = Math.random(); }
  g.setAttribute('offs', new THREE.InstancedBufferAttribute(off, 3));
  g.instanceCount = 0;
  const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide });
  const uni = { uCam: { value: new THREE.Vector2() }, uHM: { value: HMAP.tex }, uTime: { value: 0 } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 offs; uniform vec2 uCam; uniform sampler2D uHM; uniform float uTime; varying float vShade;
        vec4 hm(vec2 p){ vec2 g = (p + ${(INNER / 2).toFixed(1)}) / ${HMAP.step.toFixed(4)} - 0.5; ivec2 i = ivec2(clamp(floor(g), vec2(0.0), vec2(${HMAP.N - 2}.0))); vec2 f = clamp(g - vec2(i), 0.0, 1.0);
          vec4 a = texelFetch(uHM, i, 0), b = texelFetch(uHM, i + ivec2(1,0), 0), c = texelFetch(uHM, i + ivec2(0,1), 0), d = texelFetch(uHM, i + ivec2(1,1), 0);
          return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }`)
      .replace('#include <begin_vertex>', `
        vec2 wp = uCam - ${side / 2}.0 + mod(offs.xy - uCam + ${side / 2}.0, ${side}.0);
        vec4 hd = hm(wp);
        float dens = hd.y, dist = length(wp - uCam);
        float keep = step(offs.z, dens * 0.9) * (1.0 - smoothstep(${(side * 0.32).toFixed(1)}, ${(side * 0.5).toFixed(1)}, dist));
        float sc = (0.7 + offs.z * 0.7) * keep;
        vec3 transformed = position * sc;
        float ang = offs.z * 40.0; float cs = cos(ang), sn = sin(ang);
        transformed.xz = mat2(cs, -sn, sn, cs) * transformed.xz;
        float sway = sin(uTime * 1.7 + wp.x * 0.15 + wp.y * 0.11) * 0.18 * position.y;
        transformed.x += sway; transformed.z += sway * 0.6;
        transformed += vec3(wp.x, hd.x - 0.05, wp.y);
        vShade = 0.55 + position.y * 0.6;`)
      .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(transformed, 1.0); gl_Position = projectionMatrix * mvPosition;')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(transformed, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vec3(0.16, 0.24, 0.07) * vShade * 1.6;');
  };
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.receiveShadow = false; scene.add(mesh);
  return {
    set count(n) { g.instanceCount = Math.min(MAX, n); },
    update(dt) { uni.uCam.value.set(camera.position.x, camera.position.z); uni.uTime.value += dt; mesh.visible = Math.max(Math.abs(camera.position.x), Math.abs(camera.position.z)) < INNER / 2 && camera.position.y - H(camera.position.x, camera.position.z) < 120; },
  };
})();

// ---------- Pontos de captura e crateras ----------
for (const p of POINTS) {
  p.r = 22; p.owner = 0; p.prog = 0; p.contested = false;
  const y = H(p.x, p.z);
  p.ring = new THREE.Mesh(new THREE.RingGeometry(p.r - 1, p.r, 64), new THREE.MeshBasicMaterial({ color: 0xddd6b7, transparent: true, opacity: .55, depthWrite: false }));
  p.ring.rotation.x = -Math.PI / 2; p.ring.position.set(p.x, y + 0.12, p.z); scene.add(p.ring);
  add(new THREE.CylinderGeometry(0.06, 0.06, 9, 6), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: .6, roughness: .4 }), p.x, y + 4.5, p.z);
  p.flag = add(new THREE.PlaneGeometry(2.4, 1.5, 8, 1), new THREE.MeshStandardMaterial({ color: 0xddd6b7, side: THREE.DoubleSide, roughness: 1 }), p.x + 1.25, y + 8.1, p.z);
}
export function waveFlags(t) {
  for (const p of POINTS) { const a = p.flag.geometry.attributes.position; for (let i = 0; i < a.count; i++) { const x = a.getX(i) + 1.2; a.setZ(i, Math.sin(t * 4 + x * 2.2) * 0.12 * x); } a.needsUpdate = true; }
}
const CRATERS = [];
{
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(20,16,12,.95)'); gr.addColorStop(.55, 'rgba(45,36,25,.75)'); gr.addColorStop(1, 'rgba(60,50,35,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1 }));
    m.rotation.x = -Math.PI / 2; m.visible = false; m.receiveShadow = true; scene.add(m); CRATERS.push(m);
  }
}
let craterI = 0;
export function addCrater(p, r) {
  if (Math.abs(p.y - H(p.x, p.z)) > 2) return;
  const m = CRATERS[craterI]; craterI = (craterI + 1) % CRATERS.length;
  m.visible = true; m.position.set(p.x, H(p.x, p.z) + 0.08, p.z); m.scale.setScalar(r); m.rotation.z = Math.random() * 6;
}
export function hideCraters() { CRATERS.forEach(m => (m.visible = false)); }
