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
  // o campo dos tanques (até 700 m) fica como era; fora dele, colinas e vales de verdade na arena aérea e, depois
  // de ~5 km, serras que fecham o horizonte (dão escala e profundidade vistas de cima)
  const r = Math.max(Math.abs(x), Math.abs(z)) - 700;
  if (r > 0) {
    const k = sstep(0, 900, r), R = Math.hypot(x, z);
    h += k * (85 * fbm(x / 1400, z / 1400, 5) + 40 * (fbm(x / 520 + 3.1, z / 520, 3) * 0.5 + 0.5) - 25 * Math.max(0, 1 - Math.abs(fbm(x / 2600 - 7, z / 2600, 3)) * 6));
    h += sstep(4200, 13000, R) * (1300 * ridged(x / 5200, z / 5200, 6) + 300 * fbm(x / 9000 + 11, z / 9000, 3) + 120);
  }
  return h;
}
const FLATS = [...POINTS.map(p => ({ x: p.x, z: p.z, r: 48 })), { x: 0, z: 300, r: 55 }, { x: 0, z: -300, r: 55 }];
for (const f of FLATS) f.h = baseH(f.x, f.z);
// Pistas da Batalha Aérea (uma por equipe, atrás do spawn): platô retangular com rampa até o relevo.
// `pad` = largura extra plana ao lado da pista (pátio e hangares). Rumo de decolagem: yaw (0 = +z).
// set: 'prop' (hélice) ou 'jet' (jato e radar: pista mais longa e bases bem mais afastadas — ~12 km entre elas)
// As de hélice ficam 3,5 km para o lado: no eixo, o vale e o corredor de aproximação da base de jato (logo atrás)
// passavam por cima delas e a pista ficava enterrada 25–75 m — o avião aparecia no meio do mato
export const AIRFIELDS = [
  { team: 1, x: -3500, z: 3450, len: 1700, w: 50, pad: 170, yaw: Math.PI, set: 'prop' },
  { team: -1, x: 3500, z: -3450, len: 1700, w: 50, pad: 170, yaw: 0, set: 'prop' },
  { team: 1, x: -420, z: 5600, len: 2400, w: 60, pad: 190, yaw: Math.PI, set: 'jet' },
  { team: -1, x: 420, z: -5600, len: 2400, w: 60, pad: 190, yaw: 0, set: 'jet' },
];
// bases em uso na batalha atual (a Batalha Aérea escolhe pela era)
let fieldSet = 'prop';
export const setFieldSet = s => { fieldSet = s; };
export const activeFields = () => AIRFIELDS.filter(a => a.set === fieldSet);
export const homeField = team => AIRFIELDS.find(a => a.team === team && a.set === fieldSet);
for (const a of AIRFIELDS) { let s = 0; for (let i = -4; i <= 4; i++) s += baseH(a.x, a.z + i * a.len / 8); a.h = s / 9; }
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
const CROP_AVG = [0, 1, 2].map(k => CROPS.reduce((a, c) => a + c[k], 0) / CROPS.length);
export function cropAt(x, z) { const [i, j] = fieldCell(x, z); return Math.floor(hash2(i, j) * CROPS.length); }
// cor macro + pesos (grama, terra, rocha)
// macro = true: sem o lote de lavoura (cor média) — fora do campo dos tanques o shader pinta lotes, cercas e mata por pixel
export function groundSample(x, z, col, w, macro = false) {
  const ci = macro ? 0 : cropAt(x, z), c = macro ? CROP_AVG : CROPS[ci];
  const n = 0.5 + 0.5 * (Math.sin(x * 0.045) * Math.sin(z * 0.038) * 0.6 + 0.4 * Math.sin(x * 0.11 + z * 0.083));
  let r = c[0] * (0.85 + n * 0.3), g = c[1] * (0.85 + n * 0.3), b = c[2] * (0.85 + n * 0.3);
  let wg = ci === 2 && !macro ? 0.25 : 1, wd = ci === 2 && !macro ? 0.75 : 0, wr = 0;
  if (ci === 2 && !macro) { const s = 0.5 + 0.5 * Math.sin(x * 1.6); r *= 0.85 + s * 0.2; g *= 0.85 + s * 0.2; }
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
      .replace('#include <common>', '#include <common>\nuniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tRock; varying vec3 vSplat; varying vec3 vWP;\nfloat det(sampler2D t, vec2 p){ return texture2D(t, p * 0.33).r * 0.6 + texture2D(t, p * 0.047).r * 0.4; }\nfloat hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), f.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + 1.0), f.x), f.y); }\nfloat fb(vec2 p){ float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s / 0.9375; }')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dg = det(tGrass, vWP.xz), dd = det(tDirt, vWP.xz), dr = det(tRock, vWP.xz * 0.6);
        float d = dg * vSplat.x + dd * vSplat.y + dr * vSplat.z;
        diffuseColor.rgb *= 0.45 + d * 1.15;
        // ---- fora do campo dos tanques: paisagem por pixel (nítida de qualquer altura) ----
        float mac = smoothstep(${(INNER / 2 - 40).toFixed(1)}, ${(INNER / 2 + 10).toFixed(1)}, max(abs(vWP.x), abs(vWP.z)));
        if (mac > 0.0) {
          vec2 q = vWP.xz + vec2(13.0, 7.0);
          // lotes: fileiras deslocadas e larguras variando por quarteirão (não é grade perfeita)
          float row = floor(q.y / ${FD.toFixed(1)});
          q.x += hsh(vec2(row, 3.0)) * ${FW.toFixed(1)};
          vec2 cell = floor(q / vec2(${FW.toFixed(1)}, ${FD.toFixed(1)}));
          // alguns lotes divididos ao meio (tamanhos variados)
          vec2 fq0 = fract(q / vec2(${FW.toFixed(1)}, ${FD.toFixed(1)}));
          if (hsh(cell + 9.0) > 0.6) cell += vec2(0.5 * step(0.5, fq0.x), 0.0);
          float hc = hsh(cell);
          vec3 crop = hc < 0.2 ? vec3(0.085, 0.13, 0.04) : hc < 0.4 ? vec3(0.30, 0.24, 0.10) : hc < 0.6 ? vec3(0.15, 0.105, 0.06) : hc < 0.8 ? vec3(0.12, 0.165, 0.05) : vec3(0.22, 0.21, 0.085);
          crop *= 0.85 + 0.3 * hsh(cell + 17.0);
          // sulcos de arado/linhas de plantio dentro do lote, em direção sorteada; e a cor só puxa 60% (não vira tabuleiro)
          float ang = hsh(cell + 23.0) * 3.14159, furrow = 0.94 + 0.06 * sin(dot(vWP.xz, vec2(cos(ang), sin(ang))) * 2.2);
          vec3 cm = diffuseColor.rgb * crop / vec3(${CROP_AVG.map(v => v.toFixed(4)).join(', ')});
          vec3 c = mix(diffuseColor.rgb, cm, 0.6) * mix(1.0, furrow, clamp(1.5 / max(fwidth(vWP.x), 0.01), 0.0, 1.0));
          // cercas-vivas na divisa dos lotes (o bocage normando); afinam até sumir quando ficam menores que um pixel
          vec2 fq = fract(q / vec2(${FW.toFixed(1)}, ${FD.toFixed(1)})) * vec2(${FW.toFixed(1)}, ${FD.toFixed(1)});
          float e = min(min(fq.x, ${FW.toFixed(1)} - fq.x), min(fq.y, ${FD.toFixed(1)} - fq.y)), px = max(fwidth(vWP.x), fwidth(vWP.z));
          float hedge = (1.0 - smoothstep(1.6, 1.6 + px, e)) * clamp(3.0 / max(px, 0.001), 0.25, 1.0) * step(0.18, hsh(cell + 5.0));
          c = mix(c, vec3(0.045, 0.075, 0.03) * (0.6 + dg * 0.8), hedge * 0.85);
          // matas (mesma máscara das árvores distantes de scenery.js) com copa irregular
          // matas: ruído fractal em duas escalas (bosques grandes com borda recortada e capões espalhados)
          float fo = fb(vWP.xz / 900.0) * 0.75 + fb(vWP.xz / 160.0 + 3.7) * 0.35;
          c = mix(c, vec3(0.04, 0.065, 0.028) * (0.55 + dg * 0.9), smoothstep(0.66, 0.7, fo));
          // encosta forte e altitude: rocha e capim ralo nas serras
          float hi = smoothstep(260.0, 700.0, vWP.y);
          c = mix(c, diffuseColor.rgb * vec3(0.95, 0.92, 0.85), hi * 0.7);
          diffuseColor.rgb = mix(diffuseColor.rgb, c, mac);
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
    // malha de fora: afunda só na emenda com a de dentro (onde as duas se sobrepõem). Afundada inteira (1,4 m), o
    // chão desenhado ficava abaixo do que a física usa: o avião rodava "flutuando" e batia antes de tocar o chão
    const ed = holeR ? 0 : sstep(INNER / 2 - 50, INNER / 2, Math.max(Math.abs(x), Math.abs(z))) * 1.4, M = Math.max(Math.abs(x), Math.abs(z));
    pos.setY(i, H(x, z) - (holeR && drop < 3 ? drop * (1 - sstep(holeR + 30, holeR + 90, M)) : drop) - ed);
    groundSample(x, z, c, w, macro);
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
terrainMesh(OUTER, 460, 1.4, INNER / 2 - 24, true); // ~20 m por quadrado: com 35 m os morros cortavam por cima do avião rente
// anel distante até o horizonte (56 km, 200 m por quadrado): as serras fecham a vista e não há mais borda nem vazio
// no fim do mapa; afundado e por baixo da malha externa na emenda
terrainMesh(56000, 280, 6, OUTER / 2 - 250, true);

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
