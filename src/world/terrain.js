import * as THREE from 'three';
import { scene } from '../core/render.js';
import { clamp, lerp, sstep, hash2, rand } from '../core/util.js';

// =====================================================================
// Terreno analítico: a física consulta H(x,z) diretamente
// =====================================================================
export const LIMIT = 360, INNER = 900, OUTER = 9000, AIRLIMIT = 3200;
export const POINTS = [{ id: 'A', x: -190, z: 25 }, { id: 'B', x: 0, z: 0 }, { id: 'C', x: 190, z: -25 }];
export const SPAWN = { 1: { x: 0, z: 300, yaw: Math.PI }, '-1': { x: 0, z: -300, yaw: 0 } };
export const AIRSPAWN = { 1: { x: 0, z: 2400, y: 1300, yaw: Math.PI }, '-1': { x: 0, z: -2400, y: 1300, yaw: 0 } };

function baseH(x, z) {
  let h = 9 * Math.sin(x * 0.009 + 0.5) * Math.cos(z * 0.011) + 4 * Math.sin(x * 0.023 + 1.3) * Math.sin(z * 0.027 + 0.7)
    + 1.3 * Math.sin(x * 0.061 + z * 0.047) + 0.6 * Math.sin(x * 0.13 - z * 0.11)
    + 22 * Math.sin(x * 0.0019 + 1.1) * Math.cos(z * 0.0023 + 0.4) + 10 * Math.sin(x * 0.0041 + z * 0.0033);
  const r = Math.max(Math.abs(x), Math.abs(z)) - 700;
  if (r > 0) h += Math.min(r * 0.05, 110) * (0.55 + 0.45 * Math.sin(x * 0.0031) * Math.cos(z * 0.0027 + 1));
  return h;
}
const FLATS = [...POINTS.map(p => ({ x: p.x, z: p.z, r: 48 })), { x: 0, z: 300, r: 55 }, { x: 0, z: -300, r: 55 }];
for (const f of FLATS) f.h = baseH(f.x, f.z);
export function H(x, z) {
  let h = baseH(x, z);
  for (const f of FLATS) {
    const dx = x - f.x, dz = z - f.z, d2 = dx * dx + dz * dz;
    if (d2 < f.r * f.r) { const t = Math.sqrt(d2) / f.r, k = t * t * (3 - 2 * t); h = f.h * (1 - k) + h * k; }
  }
  return h;
}
export function terrainNormal(x, z, out) { const e = 0.8; return out.set(H(x - e, z) - H(x + e, z), 2 * e, H(x, z - e) - H(x, z + e)).normalize(); }

export const ROADS = [];
for (const p of POINTS) { ROADS.push([SPAWN[1].x, SPAWN[1].z, p.x, p.z]); ROADS.push([SPAWN[-1].x, SPAWN[-1].z, p.x, p.z]); }
ROADS.push([POINTS[0].x, POINTS[0].z, POINTS[1].x, POINTS[1].z], [POINTS[1].x, POINTS[1].z, POINTS[2].x, POINTS[2].z]);
ROADS.push([-2600, 60, -190, 25], [190, -25, 2600, -80], [0, 300, 40, 2600], [0, -300, -60, -2600]);
function segDist2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
export const roadDist = (x, z) => { let d = 1e9; for (const r of ROADS) d = Math.min(d, segDist2D(x, z, r[0], r[1], r[2], r[3])); return d; };

// Mosaico de lotes cultivados (Normandia)
export const FW = 64, FD = 52;
export const fieldCell = (x, z) => [Math.floor((x + 13) / FW), Math.floor((z + 7) / FD)];
const CROPS = [[0.085, 0.13, 0.04], [0.30, 0.24, 0.10], [0.15, 0.105, 0.06], [0.12, 0.165, 0.05], [0.22, 0.21, 0.085]];
export function cropAt(x, z) { const [i, j] = fieldCell(x, z); return Math.floor(hash2(i, j) * CROPS.length); }
// cor macro + pesos (grama, terra, rocha)
export function groundSample(x, z, col, w) {
  const ci = cropAt(x, z), c = CROPS[ci];
  const n = 0.5 + 0.5 * (Math.sin(x * 0.045) * Math.sin(z * 0.038) * 0.6 + 0.4 * Math.sin(x * 0.11 + z * 0.083));
  let r = c[0] * (0.85 + n * 0.3), g = c[1] * (0.85 + n * 0.3), b = c[2] * (0.85 + n * 0.3);
  let wg = ci === 2 ? 0.25 : 1, wd = ci === 2 ? 0.75 : 0, wr = 0;
  if (ci === 2) { const s = 0.5 + 0.5 * Math.sin(x * 1.6); r *= 0.85 + s * 0.2; g *= 0.85 + s * 0.2; }
  const slope = Math.hypot(H(x + 1, z) - H(x - 1, z), H(x, z + 1) - H(x, z - 1)) / 2;
  if (slope > 0.3) { const k = clamp((slope - 0.3) * 3, 0, 0.85); r = lerp(r, 0.17, k); g = lerp(g, 0.155, k); b = lerp(b, 0.12, k); wr = k; wg *= 1 - k; }
  const rd = roadDist(x, z);
  if (rd < 6.5) { const k = clamp((6.5 - rd) / 3, 0, 1) * 0.95; r = lerp(r, 0.17, k); g = lerp(g, 0.13, k); b = lerp(b, 0.075, k); wd = Math.max(wd, k); wg *= 1 - k; }
  for (const p of POINTS) { const d = Math.hypot(x - p.x, z - p.z); if (d < 30) { const k = (1 - d / 30) * 0.65; r = lerp(r, 0.16, k); g = lerp(g, 0.13, k); b = lerp(b, 0.085, k); wd = Math.max(wd, k); wg *= 1 - k; } }
  if (col) col.setRGB(r, g, b);
  if (w) { const s = wg + wd + wr || 1; w[0] = wg / s; w[1] = wd / s; w[2] = wr / s; }
  return wg;
}

// ---------- Texturas de detalhe procedurais (tons de cinza, média ≈ 0,5) ----------
function detailTex(kind, size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  for (let i = 0; i < size * size; i++) { const v = 128 + (Math.random() - 0.5) * (kind === 'rock' ? 70 : 50); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  if (kind === 'grass') for (let i = 0; i < 9000; i++) { const x = Math.random() * size, y = Math.random() * size, l = rand(3, 9); g.strokeStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${rand(.05, .14)})`; g.lineWidth = rand(.6, 1.4); g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-2, 2), y - l); g.stroke(); }
  if (kind === 'dirt') for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${rand(.06, .2)})`; g.beginPath(); g.arc(Math.random() * size, Math.random() * size, rand(.6, 3.2), 0, 7); g.fill(); }
  if (kind === 'rock') for (let i = 0; i < 260; i++) { g.strokeStyle = `rgba(0,0,0,${rand(.15, .35)})`; g.lineWidth = rand(.5, 1.6); g.beginPath(); let x = Math.random() * size, y = Math.random() * size; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += rand(-14, 14); y += rand(-14, 14); g.lineTo(x, y); } g.stroke(); }
  // borrões grandes para quebrar a repetição
  for (let i = 0; i < 70; i++) { const x = Math.random() * size, y = Math.random() * size, r = rand(20, 70), gr = g.createRadialGradient(x, y, 0, x, y, r); const a = rand(.04, .1); gr.addColorStop(0, `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true;
  return t;
}
const TX = { grass: detailTex('grass'), dirt: detailTex('dirt'), rock: detailTex('rock') };

function terrainMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.tGrass = { value: TX.grass }; sh.uniforms.tDirt = { value: TX.dirt }; sh.uniforms.tRock = { value: TX.rock };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 splat; varying vec3 vSplat; varying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = splat; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tRock; varying vec3 vSplat; varying vec3 vWP;\nfloat det(sampler2D t, vec2 p){ return texture2D(t, p * 0.33).r * 0.6 + texture2D(t, p * 0.047).r * 0.4; }')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dg = det(tGrass, vWP.xz), dd = det(tDirt, vWP.xz), dr = det(tRock, vWP.xz * 0.6);
        float d = dg * vSplat.x + dd * vSplat.y + dr * vSplat.z;
        diffuseColor.rgb *= 0.45 + d * 1.15;
        float fade = smoothstep(80.0, 600.0, length(vWP - cameraPosition));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.97, fade);`);
  };
  return m;
}
function terrainMesh(size, seg, drop, holeR) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3), sp = new Float32Array(pos.count * 3), c = new THREE.Color(), w = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const ed = holeR ? 0 : sstep(INNER / 2 - 50, INNER / 2, Math.max(Math.abs(x), Math.abs(z))) * 1.4;
    pos.setY(i, H(x, z) - drop - ed);
    groundSample(x, z, c, w);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; sp[i * 3] = w[0]; sp[i * 3 + 1] = w[1]; sp[i * 3 + 2] = w[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('splat', new THREE.BufferAttribute(sp, 3));
  if (holeR) {
    const idx = g.index.array, keep = [];
    for (let t = 0; t < idx.length; t += 3) {
      let inside = true;
      for (let k = 0; k < 3; k++) { const v = idx[t + k]; if (Math.max(Math.abs(pos.getX(v)), Math.abs(pos.getZ(v))) > holeR) { inside = false; break; } }
      if (!inside) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    g.setIndex(keep);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, terrainMaterial()); m.receiveShadow = true; scene.add(m);
  return m;
}
terrainMesh(INNER, 300, 0, 0);
terrainMesh(OUTER, 260, 1.4, INNER / 2 - 24);

// Mapa de altura + densidade de grama em textura (usado pela grama instanciada na GPU)
export const HMAP = (() => {
  const N = 450, step = INNER / N, data = new Float32Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -INNER / 2 + (i + 0.5) * step, z = -INNER / 2 + (j + 0.5) * step, o = (j * N + i) * 4;
    data[o] = H(x, z); data[o + 1] = groundSample(x, z, null, null);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
  t.needsUpdate = true; t.magFilter = t.minFilter = THREE.NearestFilter;
  return { tex: t, N, step, data };
})();
// grama não cresce embaixo de construções: zera a densidade nas células cobertas
export function maskGrass(mnx, mnz, mxx, mxz) {
  const { N, step, data, tex } = HMAP;
  const i0 = Math.max(0, Math.floor((mnx + INNER / 2) / step)), i1 = Math.min(N - 1, Math.floor((mxx + INNER / 2) / step));
  const j0 = Math.max(0, Math.floor((mnz + INNER / 2) / step)), j1 = Math.min(N - 1, Math.floor((mxz + INNER / 2) / step));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) data[(j * N + i) * 4 + 1] = 0;
  tex.needsUpdate = true;
}
