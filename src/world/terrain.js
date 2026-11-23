import * as THREE from 'three';
import { scene } from '../core/render.js';
import { clamp, lerp, sstep, hash2, rand } from '../core/util.js';

// =====================================================================
// Terreno analítico: a física consulta H(x,z) diretamente
// =====================================================================
export const LIMIT = 720, INNER = 1800, OUTER = 9000, AIRLIMIT = 3600; // campo dos tanques: 1,44 km de lado (era 720 m: o dono achou pequeno)
export const POINTS = [{ id: 'A', x: -400, z: 60 }, { id: 'B', x: 0, z: 0 }, { id: 'C', x: 400, z: -60 }];
export const SPAWN = { 1: { x: 0, z: 620, yaw: Math.PI }, '-1': { x: 0, z: -620, yaw: 0 } };
export const AIRSPAWN = { 1: { x: 0, z: 2400, y: 1300, yaw: Math.PI }, '-1': { x: 0, z: -2400, y: 1300, yaw: 0 } };

// ruído de valor suave (hash nos cantos, interpolação quíntica) e somas fractais: relevo sem a cara periódica dos senos
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(x, z, n) { let s = 0, a = 1, t = 0; for (let k = 0; k < n; k++) { s += a * vnoise(x, z); t += a; a *= 0.5; const nx = x * 1.97 + z * 0.31, nz = z * 1.97 - x * 0.31; x = nx + 17.3; z = nz + 9.1; } return s / t; }
// cristas: 1 − |ruído|, ao quadrado, com cada oitava pesada pela anterior (serras com vales em V)
function ridged(x, z, n) { let s = 0, a = 1, w = 1, t = 0; for (let k = 0; k < n; k++) { let r = 1 - Math.abs(vnoise(x, z)); r *= r * w; w = clamp(r * 1.6, 0, 1); s += r * a; t += a; a *= 0.5; const nx = x * 2.03 + z * 0.27, nz = z * 2.03 - x * 0.27; x = nx + 5.7; z = nz + 31.3; } return s / t; }
function baseH(x, z) {
  let h = 9 * Math.sin(x * 0.009 + 0.5) * Math.cos(z * 0.011) + 4 * Math.sin(x * 0.023 + 1.3) * Math.sin(z * 0.027 + 0.7)
    + 1.3 * Math.sin(x * 0.061 + z * 0.047) + 0.6 * Math.sin(x * 0.13 - z * 0.11)
    + 22 * Math.sin(x * 0.0019 + 1.1) * Math.cos(z * 0.0023 + 0.4) + 10 * Math.sin(x * 0.0041 + z * 0.0033);
  // o campo dos tanques (até 1150 m) fica como era; fora dele, colinas e vales de verdade na arena aérea e, depois
  // de ~5 km, serras que fecham o horizonte (dão escala e profundidade vistas de cima)
  const r = Math.max(Math.abs(x), Math.abs(z)) - 1150;
  if (r > 0) {
    const k = sstep(0, 900, r), R = Math.hypot(x, z);
    h += k * (85 * fbm(x / 1400, z / 1400, 5) + 40 * (fbm(x / 520 + 3.1, z / 520, 3) * 0.5 + 0.5) - 25 * Math.max(0, 1 - Math.abs(fbm(x / 2600 - 7, z / 2600, 3)) * 6));
    h += sstep(4200, 13000, R) * (1300 * ridged(x / 5200, z / 5200, 6) + 300 * fbm(x / 9000 + 11, z / 9000, 3) + 120);
  }
  return h;
}
const FLATS = [...POINTS.map(p => ({ x: p.x, z: p.z, r: 48 })), ...[1, -1].map(t => ({ x: SPAWN[t].x, z: SPAWN[t].z, r: 60 }))];
for (const f of FLATS) f.h = baseH(f.x, f.z);
// Pistas da Batalha Aérea (uma por equipe, atrás do spawn): platô retangular com rampa até o relevo.
// `pad` = largura extra plana ao lado da pista (pátio e hangares). Rumo de decolagem: yaw (0 = +z).
// set: 'prop' (hélice) ou 'jet' (jato e radar: pista mais longa e bases bem mais afastadas — ~12 km entre elas)
export const AIRFIELDS = [
  { team: 1, x: -260, z: 3450, len: 1700, w: 50, pad: 170, yaw: Math.PI, set: 'prop' },
  { team: -1, x: 260, z: -3450, len: 1700, w: 50, pad: 170, yaw: 0, set: 'prop' },
  { team: 1, x: -420, z: 5600, len: 2400, w: 60, pad: 190, yaw: Math.PI, set: 'jet' },
  { team: -1, x: 420, z: -5600, len: 2400, w: 60, pad: 190, yaw: 0, set: 'jet' },
];
// bases em uso na batalha atual (a Batalha Aérea escolhe pela era)
let fieldSet = 'prop';
export const setFieldSet = s => { fieldSet = s; };
export const activeFields = () => AIRFIELDS.filter(a => a.set === fieldSet);
export const homeField = team => AIRFIELDS.find(a => a.team === team && a.set === fieldSet);
for (const a of AIRFIELDS) { let s = 0; for (let i = -4; i <= 4; i++) s += baseH(a.x, a.z + i * a.len / 8); a.h = s / 9; }
// a pista de hélice fica dentro do vale achatado da base de jato do mesmo lado (o relevo ali é puxado para a altura da pista
// de jato): com altura própria ela ficava soterrada — 28 m abaixo do chão no lado aliado, ~75 m no inimigo, e o avião
// nascia num pasto sem pista. As duas bases do lado dividem o mesmo platô.
for (const a of AIRFIELDS) if (a.set === 'prop') a.h = AIRFIELDS.find(b => b.team === a.team && b.set === 'jet').h;
const RAMP = 320;
export const onAirfield = (a, x, z, m = 0) => Math.abs(x - a.x) < a.w / 2 + a.pad + m && Math.abs(z - a.z) < a.len / 2 + 60 + m;
export function H(x, z) {
  let h = baseH(x, z);
  for (const f of FLATS) {
    const dx = x - f.x, dz = z - f.z, d2 = dx * dx + dz * dz;
    if (d2 < f.r * f.r) { const t = Math.sqrt(d2) / f.r, k = t * t * (3 - 2 * t); h = f.h * (1 - k) + h * k; }
  }
  for (const a of AIRFIELDS) {
    // bases de jato ficam onde começam as serras: um vale largo em volta da pista e do corredor de aproximação
    // (o relevo vai sendo achatado até 15% da diferença para a altura da pista) — sem cânion na reta final
    if (a.set === 'jet') {
      const dv = Math.hypot(Math.max(Math.abs(x - a.x) - a.w / 2 - 300, 0), Math.max(Math.abs(z - a.z) - a.len / 2 - 3200, 0));
      if (dv < 2600) { const t = dv / 2600, k = t * t * (3 - 2 * t); h = a.h + (h - a.h) * (0.15 + 0.85 * k); }
    }
    const d = Math.hypot(Math.max(Math.abs(x - a.x) - a.w / 2 - a.pad, 0), Math.max(Math.abs(z - a.z) - a.len / 2 - 60, 0));
    if (d < RAMP) { const t = d / RAMP, k = t * t * (3 - 2 * t); h = a.h * (1 - k) + h * k; }
    // corredor de aproximação nas duas cabeceiras: o relevo não passa de uma rampa de ~2,3° (sem morro na reta final)
    const out = Math.abs(z - a.z) - a.len / 2 - 60, lat = Math.abs(x - a.x);
    if (out > 0 && out < 3000 && lat < 320) { const cap = a.h + out * 0.04; if (h > cap) { const t = Math.max(0, (lat - 200) / 120), k = t * t * (3 - 2 * t); h = cap * (1 - k) + h * k; } }
  }
  return h;
}
export function terrainNormal(x, z, out) { const e = 0.8; return out.set(H(x - e, z) - H(x + e, z), 2 * e, H(x, z - e) - H(x, z + e)).normalize(); }

// Estradas: polilinhas [ax, az, bx, bz, meia-largura] com curvas suaves (desvio lateral que zera nas pontas, então
// continuam passando pelos pontos e spawns). Estrada principal L–O (A–B–C) e N–S (spawns–B); caminhos de roça nas diagonais.
export const ROADS = [];
function road(ax, az, bx, bz, w, bend, k, step = 26) {
  const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / step)), nx = -(bz - az) / L, nz = (bx - ax) / L; let px = ax, pz = az;
  for (let i = 1; i <= n; i++) {
    const t = i / n, o = Math.sin(t * Math.PI) ** 2 * bend * (Math.sin(t * 5.1 + k) * 0.6 + Math.sin(t * 11.3 + k * 2.3) * 0.4), x = ax + (bx - ax) * t + nx * o, z = az + (bz - az) * t + nz * o;
    ROADS.push([px, pz, x, z, w]); px = x; pz = z;
  }
}
{
  const [A, B, C] = POINTS, S1 = SPAWN[1], S2 = SPAWN[-1];
  road(A.x, A.z, B.x, B.z, 3.2, 11, 0.4); road(B.x, B.z, C.x, C.z, 3.2, 11, 2.9); road(S1.x, S1.z, B.x, B.z, 3.2, 13, 1.7); road(S2.x, S2.z, B.x, B.z, 3.2, 13, 4.1);
  road(S1.x, S1.z, A.x, A.z, 1.9, 16, 0.9); road(S1.x, S1.z, C.x, C.z, 1.9, 16, 3.3); road(S2.x, S2.z, A.x, A.z, 1.9, 16, 5.2); road(S2.x, S2.z, C.x, C.z, 1.9, 16, 2.2);
  road(-2600, 60, A.x, A.z, 3.2, 70, 1.1, 120); road(C.x, C.z, 2600, -80, 3.2, 70, 3.9, 120); road(S1.x, S1.z, 40, 2600, 3.2, 70, 0.2, 120); road(S2.x, S2.z, -60, -2600, 3.2, 70, 4.6, 120);
}
function segDist2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
// distância até a BORDA da estrada mais próxima (negativa dentro do leito), exata até 40 m; grade de 32 m com os trechos vizinhos
const RGRID = new Map(), RC = 32;
export function roadEdge(x, z) {
  const i = Math.floor(x / RC), j = Math.floor(z / RC), k = (i + 2048) * 4096 + j + 2048; let l = RGRID.get(k);
  if (!l) { const cx = (i + .5) * RC, cz = (j + .5) * RC; l = ROADS.filter(r => segDist2D(cx, cz, r[0], r[1], r[2], r[3]) < 44 + RC * .71); RGRID.set(k, l); }
  let d = 40; for (const r of l) d = Math.min(d, segDist2D(x, z, r[0], r[1], r[2], r[3]) - r[4]);
  return d;
}
export const roadDist = (x, z) => roadEdge(x, z) + 2;

// Mosaico de lotes cultivados (Normandia)
export const FW = 64, FD = 52;
export const fieldCell = (x, z) => [Math.floor((x + 13) / FW), Math.floor((z + 7) / FD)];
const CROPS = [[0.085, 0.13, 0.04], [0.30, 0.24, 0.10], [0.15, 0.105, 0.06], [0.12, 0.165, 0.05], [0.22, 0.21, 0.085]];
const CROP_AVG = [0, 1, 2].map(k => CROPS.reduce((a, c) => a + c[k], 0) / CROPS.length);
export function cropAt(x, z) { const [i, j] = fieldCell(x, z); return Math.floor(hash2(i, j) * CROPS.length); }
// cor macro + pesos (grama, terra, rocha)
// macro = true: sem o lote de lavoura (cor média) — fora do campo dos tanques o shader pinta lotes, cercas e mata por pixel
// noRoad: a malha do campo dos tanques não leva a estrada na cor do vértice (3 m por vértice borrava) — o shader pinta por pixel
export function groundSample(x, z, col, w, macro = false, noRoad = false) {
  const ci = macro ? 0 : cropAt(x, z), c = macro ? CROP_AVG : CROPS[ci];
  const n = 0.5 + 0.5 * (Math.sin(x * 0.045) * Math.sin(z * 0.038) * 0.6 + 0.4 * Math.sin(x * 0.11 + z * 0.083));
  let r = c[0] * (0.85 + n * 0.3), g = c[1] * (0.85 + n * 0.3), b = c[2] * (0.85 + n * 0.3);
  let wg = ci === 2 && !macro ? 0.25 : 1, wd = ci === 2 && !macro ? 0.75 : 0, wr = 0;
  const slope = Math.hypot(H(x + 1, z) - H(x - 1, z), H(x, z + 1) - H(x, z - 1)) / 2;
  if (slope > 0.3) { const k = clamp((slope - 0.3) * 3, 0, 0.85); r = lerp(r, 0.17, k); g = lerp(g, 0.155, k); b = lerp(b, 0.12, k); wr = k; wg *= 1 - k; }
  const rd = noRoad ? 99 : roadDist(x, z);
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

// Mapa de detalhe do campo dos tanques (1024², ~0,9 m por texel), lido por pixel no shader do terreno:
// R = borda da estrada (−4..12 m), G = cratera (0,5 neutro; menos = queimado, mais = terra revirada da borda),
// B = lama/terra batida (pátios), A = sulcos de lavoura (0,5 neutro; mais = fileiras ao longo de x, menos = ao longo de z)
export const DMAP = (() => {
  const N = 1024, step = INNER / N, data = new Uint8Array(N * N * 4), FUR = [0, 0.45, 1, 0, 0.6];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -INNER / 2 + (i + 0.5) * step, z = -INNER / 2 + (j + 0.5) * step, o = (j * N + i) * 4, [ci, cj] = fieldCell(x, z), f = FUR[cropAt(x, z)] * (hash2(ci + 31, cj) < 0.5 ? 1 : -1);
    data[o] = clamp((roadEdge(x, z) + 4) / 16, 0, 1) * 255; data[o + 1] = 128; data[o + 2] = 0; data[o + 3] = 128 + f * 127;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = 4; tex.needsUpdate = true;
  return { tex, N, step, data };
})();
// carimbo circular num canal do mapa de detalhe: f(t) com t = 0 no centro e 1 na borda devolve 0..1 (fica o valor mais longe do neutro)
export function stampGround(ch, x, z, r, f) {
  const { N, step, data, tex } = DMAP, mid = ch === 1 ? 128 : 0;
  const i0 = Math.max(0, Math.floor((x - r + INNER / 2) / step)), i1 = Math.min(N - 1, Math.floor((x + r + INNER / 2) / step)), j0 = Math.max(0, Math.floor((z - r + INNER / 2) / step)), j1 = Math.min(N - 1, Math.floor((z + r + INNER / 2) / step));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const t = Math.hypot(-INNER / 2 + (i + 0.5) * step - x, -INNER / 2 + (j + 0.5) * step - z) / r; if (t >= 1) continue;
    const v = f(t) * 255, o = (j * N + i) * 4 + ch; if (Math.abs(v - mid) > Math.abs(data[o] - mid)) data[o] = v;
  }
  tex.needsUpdate = true;
}

function terrainMaterial(size, macro) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  // relevo miúdo no campo dos tanques: o chão era liso como uma mesa pintada
  if (!macro) { const b = TX.grass.clone(); b.repeat.set(size / 2.6, size / 2.6); b.needsUpdate = true; m.bumpMap = b; m.bumpScale = 1.6; }
  m.onBeforeCompile = sh => {
    sh.uniforms.tGrass = { value: TX.grass }; sh.uniforms.tDirt = { value: TX.dirt }; sh.uniforms.tRock = { value: TX.rock }; sh.uniforms.tMap = { value: DMAP.tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 splat; varying vec3 vSplat; varying vec3 vWP; varying float vNy;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = splat; vNy = normal.y; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tRock; uniform sampler2D tMap; varying vec3 vSplat; varying vec3 vWP; varying float vNy;\nfloat det(sampler2D t, vec2 p){ return texture2D(t, p * 0.33).r * 0.6 + texture2D(t, p * 0.047).r * 0.4; }\nfloat hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), f.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + 1.0), f.x), f.y); }\nfloat fb(vec2 p){ float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s / 0.9375; }\nvec2 hsh2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }\nvec3 voro(vec2 p){ vec2 n = floor(p), f = fract(p), mg = vec2(0.0), mr = vec2(0.0); float md = 8.0;\n  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)), r = g + hsh2(n + g) * 0.7 + 0.15 - f; float dd = dot(r, r); if (dd < md) { md = dd; mr = r; mg = g; } }\n  md = 8.0;\n  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { vec2 g = mg + vec2(float(i), float(j)), r = g + hsh2(n + g) * 0.7 + 0.15 - f; if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr))); }\n  return vec3(md, n + mg); }')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dg = det(tGrass, vWP.xz), dd = det(tDirt, vWP.xz), dr = det(tRock, vWP.xz * 0.6);
        float d = dg * vSplat.x + dd * vSplat.y + dr * vSplat.z;
        diffuseColor.rgb *= clamp(1.0 + (d - 0.5) * 2.4, 0.5, 1.6);
        // ---- fora do campo dos tanques: paisagem por pixel (nítida de qualquer altura) ----
        float mac = smoothstep(${(INNER / 2 - 40).toFixed(1)}, ${(INNER / 2 + 10).toFixed(1)}, max(abs(vWP.x), abs(vWP.z)));
        if (mac > 0.0) {
          float px = max(fwidth(vWP.x), fwidth(vWP.z)), far = smoothstep(2.0, 9.0, px);
          // lotes: células de Voronoi sobre coordenadas entortadas (divisas irregulares como no bocage, nada de tabuleiro)
          vec2 wp = vWP.xz + (vec2(fb(vWP.xz / 310.0), fb(vWP.xz / 310.0 + 31.7)) - 0.5) * 150.0;
          vec3 vo = voro(wp / vec2(118.0, 92.0));
          vec2 cell = vo.yz; float hc = hsh(cell), ar = smoothstep(0.35, 0.65, fb(vWP.xz / 2300.0 + 4.0)); // região de pasto ou de lavoura
          vec3 crop = hc < mix(0.5, 0.22, ar) ? mix(vec3(0.085, 0.135, 0.04), vec3(0.14, 0.19, 0.06), hsh(cell + 3.0))
            : hc < mix(0.68, 0.5, ar) ? vec3(0.07, 0.115, 0.04) : hc < mix(0.84, 0.78, ar) ? vec3(0.30, 0.25, 0.105) : hc < 0.95 ? vec3(0.16, 0.115, 0.07) : vec3(0.34, 0.30, 0.06);
          crop *= 0.82 + 0.36 * hsh(cell + 17.0);
          float ang = hsh(cell + 23.0) * 3.14159, furrow = 1.0 + 0.07 * sin(dot(vWP.xz, vec2(cos(ang), sin(ang))) * 2.2) * (1.0 - smoothstep(0.3, 1.2, px));
          // de muito longe o lote some na cor média (sem cintilar)
          vec3 c = mix(crop, vec3(0.135, 0.16, 0.058), smoothstep(25.0, 70.0, px)) * furrow * (0.55 + d * 0.9) * (0.84 + 0.32 * fb(vWP.xz / 37.0));
          // cercas-vivas na divisa dos lotes; afinam até sumir quando ficam menores que um pixel
          float hedge = (1.0 - smoothstep(1.8, 1.8 + px, vo.x * 92.0)) * clamp(4.0 / max(px, 0.001), 0.0, 1.0) * step(0.15, hsh(cell + 5.0));
          c = mix(c, vec3(0.04, 0.07, 0.028) * (0.6 + dg * 0.8), hedge * 0.85);
          // estradas vicinais (bordas de um Voronoi grande) e vilas ao longo delas: telhados de telha e ardósia
          float rd = voro((vWP.xz + (vec2(fb(vWP.xz / 700.0 + 2.0), fb(vWP.xz / 700.0 + 13.0)) - 0.5) * 500.0) / 1150.0).x * 1150.0;
          float vil = smoothstep(0.62, 0.68, fb(vWP.xz / 1100.0 + 50.0)) * (1.0 - smoothstep(45.0, 90.0, rd));
          vec2 bq = vWP.xz / 15.0, bc = floor(bq), bf = fract(bq) - 0.5; float bh = hsh(bc + 71.0);
          float roof = step(abs(bf.x), 0.2 + 0.18 * hsh(bc + 3.0)) * step(abs(bf.y), 0.15 + 0.12 * hsh(bc + 9.0)) * step(0.45, bh);
          c = mix(c, vec3(0.19, 0.18, 0.14) * (0.6 + dd * 0.8), vil * 0.55);
          c = mix(c, (bh > 0.8 ? vec3(0.27, 0.28, 0.30) : vec3(0.33, 0.15, 0.09)) * (0.75 + 0.5 * step(bf.y, 0.0)), roof * vil * (1.0 - smoothstep(5.0, 16.0, px)));
          c = mix(c, vec3(0.26, 0.22, 0.16) * (0.55 + dd * 0.9), (1.0 - smoothstep(3.0, 3.0 + px, rd)) * clamp(6.0 / max(px, 0.001), 0.12, 1.0));
          c = mix(c, vec3(0.2, 0.16, 0.105) * (0.45 + dd * 1.15), vSplat.y); // estradas que saem do campo dos tanques
          // matas: ruído fractal em duas escalas (bosques grandes com borda recortada e capões), copas de perto
          vec3 wood = vec3(0.036, 0.064, 0.027) * (0.45 + 1.1 * mix(fb(vWP.xz / 6.5), 0.5, far));
          float fo = fb(vWP.xz / 900.0) * 0.75 + fb(vWP.xz / 160.0 + 3.7) * 0.35;
          c = mix(c, wood, smoothstep(0.66, 0.7, fo) * (1.0 - vil));
          // serras: mata na encosta até ~900 m, capim de altitude acima, rocha no que é íngreme
          float sl = 1.0 - vNy + 0.05 * (fb(vWP.xz / 45.0) - 0.5);
          float hi = smoothstep(230.0, 480.0, vWP.y + 110.0 * (fb(vWP.xz / 300.0) - 0.5));
          float tl = smoothstep(820.0, 1060.0, vWP.y + 160.0 * (fb(vWP.xz / 230.0 + 9.0) - 0.5));
          vec3 mc = mix(wood * 1.15, vec3(0.16, 0.175, 0.08) * (0.6 + dg * 0.8), max(tl, smoothstep(0.5, 0.62, fb(vWP.xz / 420.0 + 77.0)) * 0.8));
          mc = mix(mc, vec3(0.2, 0.185, 0.16) * (0.55 + dr * 0.9) * (0.8 + 0.4 * fb(vWP.xz / 60.0)), smoothstep(0.1, 0.2, sl));
          c = mix(c, mc, hi);
          diffuseColor.rgb = mix(diffuseColor.rgb, c, mac);
        }
        // ---- campo dos tanques: estradas com trilhos, lama, sulcos de lavoura, manchas de pasto e crateras por pixel ----
        if (mac < 1.0) {
          vec4 dm = texture2D(tMap, (vWP.xz + ${(INNER / 2).toFixed(1)}) / ${INNER.toFixed(1)});
          float px = max(fwidth(vWP.x), fwidth(vWP.z)), nz = fb(vWP.xz * 0.21), pv = fb(vWP.xz / 26.0 + 5.0), dry = smoothstep(0.5, 0.75, fb(vWP.xz / 61.0 + 11.0));
          vec3 c = diffuseColor.rgb * (0.78 + 0.44 * pv) * (0.86 + 0.28 * fb(vWP.xz * 1.9 + 3.0)) * mix(vec3(1.0), vec3(1.12, 1.04, 0.82), smoothstep(0.55, 0.8, fb(vWP.xz / 7.0 + 21.0)) * vSplat.x); // manchas miúdas e capim seco: o pasto era um verde chapado
          c = mix(c, c * vec3(1.5, 1.25, 0.8), dry * 0.55 * vSplat.x);
          float fa = dm.a * 2.0 - 1.0, fc = fa > 0.0 ? vWP.z : vWP.x;
          c *= 1.0 + 0.16 * abs(fa) * sin(fc * 6.98) * (1.0 - smoothstep(0.05, 0.16, px)); // sulcos somem antes de virar moiré (de longe eram faixas largas)
          float e = dm.r * 16.0 - 4.0 + (nz - 0.5) * 1.6;
          vec3 dirt = vec3(0.2, 0.16, 0.105) * (0.45 + dd * 1.15);
          c = mix(c, dirt * 0.8, max(dm.b, (1.0 - smoothstep(0.0, 3.2, e)) * (0.3 + 0.6 * nz)) * 0.85);
          vec3 bed = vec3(0.27, 0.215, 0.145) * (0.5 + dd) * (0.85 + 0.3 * pv);
          float er = dm.r * 16.0 - 4.0 + (nz - 0.5) * 0.25; // trilhos seguem o eixo da estrada: só um tremor leve (com o ruído da borda ziguezagueavam)
          float rut = (1.0 - smoothstep(0.16, 0.42, abs(er + 0.8))) + (1.0 - smoothstep(0.16, 0.42, abs(er + 2.35)));
          bed *= 1.0 - 0.32 * rut * clamp(0.4 / max(px, 0.001), 0.0, 1.0);
          c = mix(c, bed, 1.0 - smoothstep(-0.5, 0.25, e));
          float cr = dm.g * 2.0 - 1.0;
          c = cr < 0.0 ? mix(c, vec3(0.035, 0.03, 0.026) * (0.6 + dd), -cr) : mix(c, dirt * 1.3, cr);
          diffuseColor.rgb = mix(c, diffuseColor.rgb, mac);
        }
        float fade = smoothstep(80.0, 600.0, length(vWP - cameraPosition));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.97, fade);`);
  };
  return m;
}
function terrainMesh(size, seg, drop, holeR, macro = false) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3), sp = new Float32Array(pos.count * 3), c = new THREE.Color(), w = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const ed = holeR ? 0 : sstep(INNER / 2 - 50, INNER / 2, Math.max(Math.abs(x), Math.abs(z))) * 1.4;
    pos.setY(i, H(x, z) - drop - ed);
    groundSample(x, z, c, w, macro, !macro);
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
  const m = new THREE.Mesh(g, terrainMaterial(size, macro)); m.receiveShadow = true; scene.add(m);
  return m;
}
terrainMesh(INNER, 420, 0, 0);
terrainMesh(OUTER, 260, 1.4, INNER / 2 - 24, true);
// anel distante até o horizonte (56 km, 200 m por quadrado): as serras fecham a vista e não há mais borda nem vazio
// no fim do mapa; afundado e por baixo da malha externa na emenda
terrainMesh(56000, 280, 6, OUTER / 2 - 250, true);

// Mapa de altura + densidade de grama em textura (usado pela grama instanciada na GPU)
export const HMAP = (() => {
  const N = 640, step = INNER / N, data = new Float32Array(N * N * 4);
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
