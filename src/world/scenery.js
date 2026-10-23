import * as THREE from 'three';
import { scene, camera } from '../core/render.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { V3, QUAT, UP, rand, srand, hash2 } from '../core/util.js';
import { H, LIMIT, INNER, POINTS, SPAWN, FW, FD, roadDist, maskGrass, HMAP, AIRFIELDS, onAirfield } from './terrain.js';
import { addStaticBox } from './physics.js';
import { sndCrack } from '../fx/audio.js';

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
  if (collider) addStaticBox((b.mn[0] + b.mx[0]) / 2, (b.mn[1] + b.mx[1]) / 2, (b.mn[2] + b.mx[2]) / 2, (b.mx[0] - b.mn[0]) / 2, (b.mx[1] - b.mn[1]) / 2, (b.mx[2] - b.mn[2]) / 2);
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
const tileTex = canvasTex(256, 256, (g, w, h) => {
  for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 * 10; x < w + 20; x += 20) { const v = rand(-20, 20); g.fillStyle = `rgb(${120 + v},${58 + v / 2},${42 + v / 2})`; g.fillRect(x, y, 19, 15); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + 13, 19, 3); }
});
const slateTex = canvasTex(256, 256, (g, w, h) => {
  for (let y = 0; y < h; y += 14) for (let x = (y / 14) % 2 * 9; x < w + 18; x += 18) { const v = rand(-12, 12); g.fillStyle = `rgb(${62 + v},${66 + v},${74 + v})`; g.fillRect(x, y, 17, 13); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x, y + 11, 17, 3); }
});
const mat = (map, color = 0xffffff, rough = 0.92) => new THREE.MeshStandardMaterial({ map, color, roughness: rough, metalness: 0 });
const M = {
  stone: mat(stoneTex), plaster: mat(plasterTex), tile: mat(tileTex, 0xffffff, 0.8), slate: mat(slateTex, 0xffffff, 0.7),
  ruin: mat(stoneTex, 0x9a9488), wood: new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: .85 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1a2328, roughness: .15, metalness: .4 }), frame: new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: .8 }),
};
const add = (geo, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
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
  const y0 = groundMin(x, z, W, D) - 0.6, hh = h + 0.6, wallM = srand() < 0.55 ? M.stone : M.plaster;
  add(boxUV(W, hh, D), ruined ? M.ruin : wallM, x, y0 + hh / 2, z);
  regObst({ mn: [x - W / 2, y0, z - D / 2], mx: [x + W / 2, y0 + hh, z + D / 2] });
  if (ruined) { for (let i = 0; i < 6; i++) add(new THREE.DodecahedronGeometry(rand(.3, .8), 0), M.ruin, x + rand(-W, W) * .6, H(x, z) + .2, z + rand(-D, D) * .6); return; }
  const top = y0 + hh, long = Math.max(W, D), short = Math.min(W, D);
  // portas e janelas nas fachadas longas
  for (const s of [1, -1]) for (let k = -1; k <= 1; k++) {
    const isDoor = k === 0 && s === 1, ww = isDoor ? 1.1 : 0.95, wh = isDoor ? 2.1 : 1.15, yy = isDoor ? y0 + 0.6 + 1.05 : top - h * 0.42;
    const off = k * long * 0.28, fx = alongX ? x + off : x + s * (W / 2 + 0.04), fz = alongX ? z + s * (D / 2 + 0.04) : z + off, ry = alongX ? 0 : Math.PI / 2;
    add(new THREE.BoxGeometry(ww + .2, wh + .2, .06), M.frame, fx, yy, fz, ry);
    add(new THREE.BoxGeometry(ww, wh, .08), isDoor ? M.wood : M.glass, fx, yy, fz, ry);
  }
  const roof = gable(long, short, 2.4 + short * 0.12, srand() < 0.6 ? M.tile : M.slate);
  roof.position.set(x, top, z); roof.rotation.y = alongX ? Math.PI / 2 : 0; roof.castShadow = roof.receiveShadow = true; scene.add(roof);
  if (srand() < 0.7) add(boxUV(.7, 2.2, .7, 2), M.stone, x + (alongX ? long * .3 : short * .2), top + 1.4, z + (alongX ? short * .2 : long * .3));
}
// Igreja de pedra no vilarejo B
{
  const x = 34, z = -38, y0 = groundMin(x, z, 12, 24) - 0.6;
  add(boxUV(11, 11, 22), M.stone, x, y0 + 5.5, z); regObst({ mn: [x - 5.5, y0, z - 11], mx: [x + 5.5, y0 + 11, z + 11] });
  const r = gable(22, 11, 5.5, M.slate); r.position.set(x, y0 + 11, z); r.castShadow = true; scene.add(r);
  add(boxUV(5.5, 24, 5.5), M.stone, x, y0 + 12, z + 13); regObst({ mn: [x - 2.75, y0, z + 10.25], mx: [x + 2.75, y0 + 24, z + 15.75] });
  const sp = add(new THREE.ConeGeometry(3.9, 12, 4), M.slate, x, y0 + 30, z + 13); sp.rotation.y = Math.PI / 4;
  for (let i = -3; i <= 3; i += 2) add(new THREE.BoxGeometry(.06, 3, 1.1), M.glass, x + 5.53, y0 + 6, z + i * 2.6);
}
for (const p of POINTS) for (let i = 0; i < (p.id === 'B' ? 16 : 7); i++) { const a = srand() * Math.PI * 2, r = 24 + srand() * (p.id === 'B' ? 42 : 30); house(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, srand() < 0.25); }
for (let i = 0; i < 22; i++) house(srand() * 660 - 330, srand() * 540 - 270, srand() < 0.3);
for (let i = 0; i < 50; i++) house(srand() * 6000 - 3000, srand() * 6000 - 3000, false);
for (let i = 0; i < 22; i++) {
  const x = srand() * 660 - 330, z = srand() * 560 - 280, along = srand() < 0.5, len = 14 + srand() * 22;
  if (!clearSpot(x, z, len / 2)) continue;
  const w = along ? len : 0.9, d = along ? 0.9 : len, y0 = groundMin(x, z, w, d) - 0.6;
  add(boxUV(w, 2.5, d, 2), M.ruin, x, y0 + 1.25, z); regObst({ mn: [x - w / 2, y0, z - d / 2], mx: [x + w / 2, y0 + 2.5, z + d / 2] });
}
for (let i = 0; i < 30; i++) {
  const x = srand() * 680 - 340, z = srand() * 600 - 300, s = 1.6 + srand() * 2.4;
  if (!clearSpot(x, z, s)) continue;
  const g = new THREE.DodecahedronGeometry(s, 1), p = g.attributes.position;
  for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * rand(.85, 1.1), p.getY(k) * rand(.6, .8), p.getZ(k) * rand(.85, 1.1));
  g.computeVertexNormals();
  const y = H(x, z); const o = add(g, M.ruin, x, y + s * 0.25, z); o.rotation.set(0, srand() * 6, 0);
  regObst({ mn: [x - s * 0.8, y - 2, z - s * 0.8], mx: [x + s * 0.8, y + s * 0.8, z + s * 0.8] });
}

// prédios/ruínas: centenas de malhas estáticas viram uma por material (cada malha era 1 draw call × cor/sombra/AO)
{
  const mats = new Set(Object.values(M)), by = new Map();
  for (const o of [...scene.children]) if (o.isMesh && !o.isInstancedMesh && mats.has(o.material)) {
    o.updateMatrix(); const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix);
    if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push(g); scene.remove(o); o.geometry.dispose();
  }
  for (const [m, gs] of by) { const o = new THREE.Mesh(mergeGeometries(gs), m); o.castShadow = o.receiveShadow = true; scene.add(o); }
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
const vegMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
// Cercas vivas (bocage): bloqueiam a visão; tanques atravessam com perda de velocidade
{
  const bush = new THREE.IcosahedronGeometry(1, 1);
  const bp = bush.attributes.position; for (let k = 0; k < bp.count; k++) { const f = rand(.85, 1.15); bp.setXYZ(k, bp.getX(k) * f, bp.getY(k) * f, bp.getZ(k) * f); } bush.computeVertexNormals();
  const list = [];
  const seg = (pts) => { const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]), y0 = Math.min(...pts.map(p => H(p[0], p[1]))); return { mn: [Math.min(...xs) - 0.8, y0 - 1, Math.min(...zs) - 0.8], mx: [Math.max(...xs) + 0.8, y0 + 2.9, Math.max(...zs) + 0.8], stamp: 0 }; };
  for (let i = -6; i <= 6; i++) for (let j = -7; j <= 7; j++) for (const horiz of [true, false]) {
    if (hash2(i * 7 + (horiz ? 1 : 2), j * 13) > 0.42) continue;
    const x0 = i * FW - 13, z0 = j * FD - 7, len = horiz ? FW : FD, cx = horiz ? x0 + FW / 2 : x0, cz = horiz ? z0 : z0 + FD / 2;
    if (Math.abs(cx) > LIMIT + 120 || Math.abs(cz) > LIMIT + 120) continue;
    const pts = [];
    for (let s = -len / 2; s <= len / 2; s += 2.0) {
      const x = horiz ? cx + s : cx + rand(-.3, .3), z = horiz ? cz + rand(-.3, .3) : cz + s;
      if (roadDist(x, z) < 7 || POINTS.some(p => Math.hypot(x - p.x, z - p.z) < 26) || [SPAWN[1], SPAWN[-1]].some(p => Math.hypot(x - p.x, z - p.z) < 50)) { if (pts.length > 2) HEDGES.push(seg(pts)); pts.length = 0; continue; }
      if (obstNear(x - 2, z - 2, x + 2, z + 2).some(b => x > b.mn[0] - 1 && x < b.mx[0] + 1 && z > b.mn[2] - 1 && z < b.mx[2] + 1)) continue;
      pts.push([x, z]); list.push([x, z]);
    }
    if (pts.length > 2) HEDGES.push(seg(pts));
  }
  const mesh = new THREE.InstancedMesh(bush, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), list.length);
  const m = new THREE.Matrix4(), q = new QUAT(), s = new V3(), p = new V3(), c = new THREE.Color();
  list.forEach(([x, z], i) => {
    const sc = rand(1.2, 1.8); p.set(x, H(x, z) + sc * 0.6, z); q.setFromEuler(new THREE.Euler(rand(0, 3), rand(0, 3), 0)); s.set(sc, sc * rand(0.9, 1.35), sc);
    m.compose(p, q, s); mesh.setMatrixAt(i, m); c.setRGB(rand(.05, .08), rand(.09, .13), rand(.03, .045)); mesh.setColorAt(i, c);
    maskGrass(x - 1.5, z - 1.5, x + 1.5, z + 1.5);
  });
  mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
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
export let treeMesh;
{
  const trunk = new THREE.CylinderGeometry(0.18, 0.3, 3.2, 7); trunk.translate(0, 1.6, 0);
  const c1 = new THREE.ConeGeometry(2.4, 4.5, 8); c1.translate(0, 4.6, 0);
  const c2 = new THREE.ConeGeometry(1.9, 3.8, 8); c2.translate(0, 6.6, 0);
  const c3 = new THREE.ConeGeometry(1.2, 2.8, 8); c3.translate(0, 8.4, 0);
  const pine = mergeColored([[trunk, [0.16, 0.11, 0.07]], [c1, [0.05, 0.09, 0.035]], [c2, [0.055, 0.1, 0.04]], [c3, [0.06, 0.11, 0.045]]]);
  const oakParts = [[trunk, [0.15, 0.1, 0.065]]];
  for (let k = 0; k < 5; k++) { const b = new THREE.IcosahedronGeometry(rand(1.6, 2.4), 0); b.translate(rand(-1.2, 1.2), rand(4.8, 7), rand(-1.2, 1.2)); oakParts.push([b, [0.07 + k * .006, 0.115, 0.04]]); }
  const oak = mergeColored(oakParts);
  const list = [];
  for (let i = 0; i < 3500 && list.length < 560; i++) {
    const cx = srand() * 720 - 360, cz = srand() * 660 - 330;
    const k = Math.sin(cx * 0.02) * Math.cos(cz * 0.017) + Math.sin(cx * 0.051 + 2) * 0.4;
    if (k < 0.38) continue;
    if (clearSpot(cx, cz, 1.2)) list.push([cx, cz, 0.8 + srand() * 0.6]);
  }
  treeMesh = new THREE.InstancedMesh(pine, vegMat(), list.length);
  treeMesh.castShadow = treeMesh.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new QUAT(), s = new V3(), p = new V3(), col = new THREE.Color();
  list.forEach(([x, z, sc], i) => {
    p.set(x, H(x, z) - 0.2, z); q.setFromAxisAngle(UP, srand() * 6); s.set(sc, sc, sc);
    m.compose(p, q, s); treeMesh.setMatrixAt(i, m); col.setScalar(rand(.8, 1.2)); treeMesh.setColorAt(i, col);
    TREES.push({ x, z, sc, down: false, i, rot: q.clone() }); regTree(x, z, 1.6 * sc, H(x, z) + 9 * sc);
    maskGrass(x - 1, z - 1, x + 1, z + 1);
  });
  scene.add(treeMesh);
  const far = [];
  for (let i = 0; i < 160000 && far.length < 12000; i++) {
    const x = srand() * 14800 - 7400, z = srand() * 14800 - 7400;
    if (Math.max(Math.abs(x), Math.abs(z)) < INNER / 2 || runwayClear(x, z)) continue;
    if (Math.sin(x * 0.004) * Math.cos(z * 0.0035) + Math.sin(x * 0.011 + z * 0.007) * 0.5 < 0.55) continue;
    far.push([x, z, 0.9 + srand() * 0.7]);
  }
  // árvore de longe barata (tronco de 5 faces + duas copas, ~50 triângulos): com o carvalho de perto (~115) as 13 mil
  // dobravam os triângulos da cena
  const lo = mergeColored([[new THREE.CylinderGeometry(0.2, 0.32, 3.4, 5).translate(0, 1.7, 0), [0.15, 0.1, 0.065]], [new THREE.IcosahedronGeometry(2.4, 0).scale(1, 0.85, 1).translate(0, 5.6, 0), [0.075, 0.115, 0.04]], [new THREE.IcosahedronGeometry(1.7, 0).translate(0.6, 7.1, -0.4), [0.085, 0.12, 0.045]]]);
  const fm = new THREE.InstancedMesh(lo, vegMat(), far.length);
  far.forEach(([x, z, sc], i) => { p.set(x, H(x, z) - 0.3, z); q.setFromAxisAngle(UP, srand() * 6); s.set(sc * 1.4, sc * 1.4, sc * 1.4); m.compose(p, q, s); fm.setMatrixAt(i, m); col.setScalar(rand(.75, 1.2)); fm.setColorAt(i, col); regTree(x, z, 2.6 * sc, H(x, z) - 0.3 + 9 * sc * 1.4); });
  fm.castShadow = false; scene.add(fm); // sem sombra: o passe de sombra desenhava as milhares de árvores de fora inteiras
}
// Sítios fora do campo de batalha (Normandia): casa de pedra e celeiro, às vezes um galpão, espalhados pelo mapa
// inteiro. Dão escala no voo baixo (antes, fora do campo dos tanques, só havia chão pintado). Colisão com avião
// (obstNear), sem colisor Rapier (os tanques não vão até lá).
{
  const prism = (w, h, l) => { const g = new THREE.CylinderGeometry(1, 1, l, 3).rotateX(Math.PI / 2).rotateZ(Math.PI); g.scale(w / 1.732, h / 1.5, 1); return g; };
  const wall = [0.56, 0.52, 0.45], roof = [0.28, 0.13, 0.09], slate = [0.22, 0.23, 0.25], wood = [0.25, 0.18, 0.12];
  const house = mergeColored([[new THREE.BoxGeometry(7, 4.6, 10).translate(0, 2.3, 0), wall], [prism(7.6, 3.4, 10.6).translate(0, 4.6 + 1.13, 0), slate], [new THREE.BoxGeometry(0.8, 2.2, 0.8).translate(1.8, 6.6, 3), wall]]);
  const barn = mergeColored([[new THREE.BoxGeometry(10, 5.5, 18).translate(0, 2.75, 0), wood], [prism(11, 4.2, 18.6).translate(0, 5.5 + 1.4, 0), roof]]);
  const kinds = [[house, 5.2, 8.5], [barn, 9.5, 11]], lists = [[], []];
  const free = (x, z) => Math.max(Math.abs(x), Math.abs(z)) > INNER / 2 + 60 && !runwayClear(x, z) && !AIRFIELDS.some(a => onAirfield(a, x, z, 260));
  for (let i = 0; i < 9000 && lists[0].length < 560; i++) {
    const x = srand() * 14800 - 7400, z = srand() * 14800 - 7400, yaw = srand() * 6.28;
    if (!free(x, z) || Math.abs(H(x + 8, z) - H(x - 8, z)) + Math.abs(H(x, z + 8) - H(x, z - 8)) > 4) continue;
    lists[0].push([x, z, yaw]);
    if (srand() < 0.7) { const d = 16 + srand() * 10, a = yaw + 1.2 + srand(); lists[1].push([x + Math.cos(a) * d, z + Math.sin(a) * d, yaw + (srand() < 0.5 ? 0 : Math.PI / 2)]); }
  }
  const m = new THREE.Matrix4(), q = new QUAT(), s = new V3(1, 1, 1), p = new V3(), col = new THREE.Color();
  kinds.forEach(([geo, r, top], k) => {
    const L = lists[k], im = new THREE.InstancedMesh(geo, vegMat(), L.length);
    L.forEach(([x, z, yaw], i) => {
      const y0 = Math.min(H(x - r, z - r), H(x + r, z - r), H(x - r, z + r), H(x + r, z + r)) - 0.4;
      p.set(x, y0, z); q.setFromAxisAngle(UP, yaw); m.compose(p, q, s); im.setMatrixAt(i, m); col.setScalar(rand(0.82, 1.15)); im.setColorAt(i, col);
      regObst({ mn: [x - r, y0, z - r], mx: [x + r, y0 + top, z + r] }, false);
    });
    im.receiveShadow = true; scene.add(im);
  });
}
export function resetTrees() {
  const m = new THREE.Matrix4(), s = new V3(), p = new V3();
  for (const t of TREES) if (t.down) { t.down = false; s.set(t.sc, t.sc, t.sc); p.set(t.x, H(t.x, t.z) - 0.2, t.z); m.compose(p, t.rot, s); treeMesh.setMatrixAt(t.i, m); }
  treeMesh.instanceMatrix.needsUpdate = true;
}
export function fellTree(t, dirx, dirz) {
  t.down = true;
  const axis = new V3(dirz, 0, -dirx).normalize();
  const q = new QUAT().setFromAxisAngle(axis, Math.PI / 2 * 0.95).multiply(t.rot);
  treeMesh.setMatrixAt(t.i, new THREE.Matrix4().compose(new V3(t.x, H(t.x, t.z) + 0.2, t.z), q, new V3(t.sc, t.sc, t.sc)));
  treeMesh.instanceMatrix.needsUpdate = true;
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
