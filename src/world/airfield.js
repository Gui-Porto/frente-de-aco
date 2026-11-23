import * as THREE from 'three';
import { scene } from '../core/render.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIRFIELDS } from './terrain.js';
// =====================================================================
// Bases aéreas (uma por equipe e por era, em AIRFIELDS). Pousar e parar na própria base repara e rearma.
//  · 'prop': campo avançado de 1944 — pista de chapa perfurada (PSP) sobre terra batida, caminho de táxi de terra,
//    baias de dispersão com talude, hangares "blister", barracas, torre de madeira, depósito de tambores, antiaérea
//    em ninho de sacos de areia; nada de luz elétrica (só os potes de querosene do balizamento).
//  · 'jet': base da Guerra Fria — placas de concreto com juntas, acostamento, borracha na zona de toque, sinalização
//    OACI, pista de táxi com eixo amarelo e pontos de espera, pátio com vagas, abrigos reforçados (HAS), hangar de
//    manutenção, torre, bombeiros, tanques de combustível, radar, placas de distância, ALS/PAPI e luzes de táxi.
// Tudo nasce no carregamento e é FUNDIDO por material (um draw call por material e por base): nenhum shader novo
// durante a partida. As camadas rentes ao chão (grama → asfalto/terra → concreto/chapa → borracha → tinta) são
// separadas por polygonOffset, não só por altura: a 1,5 km o z-buffer não distingue 2 cm e a tinta piscava.
// A malha do relevo fica 1,4 m (campo de hélice) ou 6 m (base de jato, anel distante) ABAIXO de H(x, z): a base traz
// o próprio chão de grama na altura da física, com uma saia que mergulha no relevo — antes a pista flutuava.
// =====================================================================
const PI = Math.PI;
// sorteio com semente: bases (e texturas) iguais a cada carregamento
let seed = 20261123;
const rnd = (a = 0, b = 1) => { seed = seed * 16807 % 2147483647; return a + (b - a) * seed / 2147483647; };
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const vn = (x, z) => { const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v); return (hash(i, j) * (1 - a) + hash(i + 1, j) * a) * (1 - b) + (hash(i, j + 1) * (1 - a) + hash(i + 1, j + 1) * a) * b; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- texturas (canvas, criadas no carregamento)
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const speck = (g, w, h, n, a, s = 3) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${rnd() < .5 ? '255,255,255' : '0,0,0'},${rnd(0, a)})`; g.fillRect(rnd(0, w), rnd(0, h), rnd(1, s), rnd(1, s)); } };
// manchas que dão a volta na borda (a textura repete sem emenda)
const blots = (g, w, h, n, rgb, a0, a1, r0, r1) => { for (let i = 0; i < n; i++) { const x = rnd(0, w), y = rnd(0, h), rx = rnd(r0, r1), ry = rx * rnd(.4, 1), ro = rnd(0, 3); g.fillStyle = `rgba(${rgb},${rnd(a0, a1)})`; for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, ro, 0, 7); g.fill(); } } };
const TX = {
  // concreto: atlas de 4×4 placas diferentes (7,5 m cada), junta selada na borda; o tom de cada placa vem da cor do vértice
  slab: canvasTex(1024, 1024, g => {
    const c = 256;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      g.save(); g.translate(i * c, j * c); g.beginPath(); g.rect(0, 0, c, c); g.clip();
      const k = rnd(-4, 4) | 0; g.fillStyle = `rgb(${154 + k},${152 + k},${144 + k})`; g.fillRect(0, 0, c, c);
      for (let n = 0; n < 12; n++) { g.fillStyle = `rgba(${rnd() < .55 ? '70,66,58' : '205,203,195'},${rnd(.03, .08)})`; g.beginPath(); g.ellipse(rnd(0, c), rnd(0, c), rnd(12, 70), rnd(6, 30), rnd(0, 3), 0, 7); g.fill(); }
      speck(g, c, c, 2400, 0.09);
      if (rnd() < 0.22) { // trinca selada com piche
        g.strokeStyle = 'rgba(28,26,23,.8)'; g.lineWidth = rnd(1.2, 2.6); g.beginPath(); let x = rnd(0, c), y = 0; g.moveTo(x, y);
        while (y < c) { x += rnd(-22, 22); y += rnd(14, 40); g.lineTo(x, y); } g.stroke();
      }
      if (rnd() < 0.3) for (let n = 0; n < 3; n++) { g.fillStyle = `rgba(38,34,30,${rnd(.12, .3)})`; g.beginPath(); g.ellipse(rnd(30, c - 30), rnd(30, c - 30), rnd(4, 16), rnd(4, 12), rnd(0, 3), 0, 7); g.fill(); } // óleo
      g.strokeStyle = 'rgba(70,66,60,.16)'; g.lineWidth = 14; g.strokeRect(0, 0, c, c);
      g.strokeStyle = 'rgba(30,28,25,.9)'; g.lineWidth = 3.4; g.strokeRect(0, 0, c, c);
      g.restore();
    }
  }),
  asph: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#44433f'; g.fillRect(0, 0, w, h); blots(g, w, h, 20, '20,20,18', .02, .05, 30, 90); blots(g, w, h, 16, '120,118,110', .015, .04, 30, 80); speck(g, w, h, 9000, 0.1); }),
  dirt: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#857559'; g.fillRect(0, 0, w, h); blots(g, w, h, 22, '60,48,32', .025, .07, 24, 80); blots(g, w, h, 18, '190,172,140', .025, .07, 20, 70);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${rnd() < .5 ? '50,40,28' : '200,184,150'},${rnd(.02, .06)})`; g.fillRect(rnd(0, w), 0, rnd(1, 4), h); } // sulcos de roda
    speck(g, w, h, 9000, 0.1);
  }),
  grass: canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#64743f'; g.fillRect(0, 0, w, h); blots(g, w, h, 60, '48,66,30', .02, .06, 30, 120); blots(g, w, h, 50, '140,140,78', .02, .055, 30, 110); speck(g, w, h, 36000, 0.085, 2.4); }),
  // chapa perfurada (PSP / Marston mat): chapas de 3,05 × 0,38 m em fiada amarrada, três fileiras de furos, ferrugem e barro
  psp: canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#3a3229'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 8; r++) for (let q = -1; q < 2; q++) {
      const x = q * 256 + (r % 2 ? 128 : 0), y = r * 32, k = (hash(r, (q + 2) % 2) - 0.5) * 9 | 0, ru = hash(r + 7, (q + 2) % 2) < 0.3 ? 1 : 0;
      g.fillStyle = `rgb(${124 + k + ru * 5},${106 + k - ru * 1},${86 + k - ru * 5})`; g.fillRect(x + 1, y + 1, 254, 30);
      g.fillStyle = 'rgba(255,255,255,.11)'; g.fillRect(x + 1, y + 9, 254, 2); g.fillRect(x + 1, y + 20, 254, 2);
      g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x + 1, y + 11, 254, 1.5); g.fillRect(x + 1, y + 22, 254, 1.5);
      g.fillStyle = '#2b251e'; for (let n = 0; n < 29; n++) for (let m = 0; m < 3; m++) { g.beginPath(); g.arc(x + 4.4 + n * 8.83, y + 5.5 + m * 10.5, 2.5, 0, 7); g.fill(); }
    }
    speck(g, w, h, 9000, 0.08, 2);
  }),
  tin: canvasTex(256, 64, (g, w, h) => { for (let x = 0; x < w; x += 8) { const k = x % 16 ? 0 : 26; g.fillStyle = `rgb(${168 + k},${170 + k},${164 + k})`; g.fillRect(x, 0, 8, h); } speck(g, w, h, 2500, 0.1); for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(110,60,30,${rnd(.04, .13)})`; g.fillRect(rnd(0, w), rnd(0, h), rnd(4, 14), rnd(10, 60)); } }),
  // parede de alvenaria com uma fiada de janelas (8 m de largura × 3,5 m de pé-direito por repetição)
  wall: canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#c9c4b4'; g.fillRect(0, 0, w, h); speck(g, w, h, 2200, 0.06); g.fillStyle = 'rgba(60,56,48,.25)'; g.fillRect(0, h - 5, w, 5);
    for (const x of [22, 86, 150, 214]) { g.fillStyle = '#e4e0d4'; g.fillRect(x - 3, 30, 42, 60); g.fillStyle = '#26323a'; g.fillRect(x, 33, 36, 54); g.fillStyle = '#e4e0d4'; g.fillRect(x + 17, 33, 2, 54); g.fillRect(x, 58, 36, 2); g.fillStyle = 'rgba(120,150,170,.35)'; g.fillRect(x, 33, 17, 25); g.fillStyle = 'rgba(40,36,30,.3)'; g.fillRect(x - 3, 90, 42, 3); }
  }),
  // borracha de pneu na zona de toque: riscos concentrados nas duas trilhas das rodas, sumindo nas pontas
  rubber: canvasTex(128, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 800; i++) {
      const tr = rnd() < .5 ? -1 : 1, x = w / 2 + tr * (15 + rnd(-1, 1) * rnd(0, 1) * 20) + rnd(-3, 3), y = h * (0.04 + 0.96 * Math.pow(rnd(), 1.3)), l = rnd(30, 190);
      g.fillStyle = `rgba(16,15,13,${rnd(.03, .13)})`; g.fillRect(x, y, rnd(1, 3.2), l);
    }
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.2, 'rgba(0,0,0,0)'); gr.addColorStop(0.75, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }),
  // algarismos 1–8 (número da pista e placas de distância)
  glyph: canvasTex(1024, 256, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 236px Impact, "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; for (let i = 0; i < 8; i++) g.fillText(String(i + 1), i * 128 + 64, h / 2 + 10, 112); }),
};

// ---------------------------------------------------------------- materiais (todos já na cena no carregamento)
const layer = (L, o) => Object.assign({ roughness: .95, polygonOffset: L > 0, polygonOffsetFactor: -L, polygonOffsetUnits: -L * 2 }, o);
const M = {
  ground: new THREE.MeshStandardMaterial(layer(0, { map: TX.grass, vertexColors: true, roughness: 1 })),
  asph: new THREE.MeshStandardMaterial(layer(1, { map: TX.asph, vertexColors: true })),
  dirt: new THREE.MeshStandardMaterial(layer(1, { map: TX.dirt, vertexColors: true, roughness: 1 })),
  conc: new THREE.MeshStandardMaterial(layer(2, { map: TX.slab, vertexColors: true, roughness: .9 })),
  psp: new THREE.MeshStandardMaterial(layer(2, { map: TX.psp, vertexColors: true, roughness: .85 })),
  rubber: new THREE.MeshStandardMaterial(layer(3, { map: TX.rubber, transparent: true, depthWrite: false, roughness: 1 })),
  paint: new THREE.MeshStandardMaterial(layer(4, { vertexColors: true, roughness: .8 })),
  glyph: new THREE.MeshStandardMaterial(layer(4, { map: TX.glyph, alphaTest: .5, color: 0xe6e4dc, roughness: .8 })),
  flat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85 }),                       // tudo que é cor chapada: prédios, viaturas, tambores, postes
  tin: new THREE.MeshStandardMaterial({ map: TX.tin, vertexColors: true, roughness: .65, metalness: .3, side: THREE.DoubleSide }),
  wall: new THREE.MeshStandardMaterial({ map: TX.wall, vertexColors: true, roughness: .85 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x2c3b44, roughness: .1, metalness: .8 }),
  sock: new THREE.MeshStandardMaterial({ color: 0xe8662a, roughness: .7, side: THREE.DoubleSide }),
  // luzes: uma malha só, cor por vértice, sem névoa (furam a bruma como as reais e mostram a pista de longe)
  lite: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }),
  red: new THREE.MeshStandardMaterial({ color: 0xff9d90, emissive: 0xff2a10, emissiveIntensity: 2.2, fog: false }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 2.4, fog: false }),
};
M.lite.color.setScalar(2.3);
const CAST = new Set(['flat', 'tin', 'wall', 'glass']);
const C = { white: 0xe6e4dc, yellow: 0xd6a416, olive: 0x4f5638, khaki: 0x8a8460, steel: 0x5d6259, dark: 0x1b1b18, wood: 0x6f5a3e, earth: 0x5c6a3a, sand: 0xa89c78, concw: 0xb5b0a2, red: 0xa82a1c, tyre: 0x191917,
  lamp: 0xfff0c4, green: 0x30ff70, redl: 0xff2a10, blue: 0x2a55ff, flare: 0xff9330 };

// ---------------------------------------------------------------- geometria
const _c = new THREE.Color();
// cor por vértice; f(x, y, z) → fator (ou [r, g, b]) calculado pela POSIÇÃO (vértices repetidos saem iguais)
function tint(g, c, f) {
  const p = g.attributes.position, a = new Float32Array(p.count * 3); _c.set(c);
  for (let i = 0; i < p.count; i++) { const k = f ? f(p.getX(i), p.getY(i), p.getZ(i)) : 1, v = k.length ? k : [k, k, k]; a[i * 3] = _c.r * v[0]; a[i * 3 + 1] = _c.g * v[1]; a[i * 3 + 2] = _c.b * v[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
const worldUV = (g, su, sv = su) => { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / su, p.getZ(i) / sv); return g; };
// UV de caixa em metros nas faces laterais; tampa e fundo num canto liso da textura
const boxUV = (g, w, h, d, su, sv) => { const uv = g.attributes.uv; for (let i = 0; i < 24; i++) { const f = i >> 2; if (f === 2 || f === 3) uv.setXY(i, 0.02, 0.97); else uv.setXY(i, uv.getX(i) * (f < 2 ? d : w) / su, uv.getY(i) * h / sv); } return g; };
// triângulos soltos com normal chapada. P: pontos de 3 em 3; U: uv de cada um
function tris(P, U) {
  const n = P.length, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.set(...P[i]); b.set(...P[i + 1]).sub(a); c.set(...P[i + 2]).sub(a); b.cross(c).normalize();
    for (let k = 0; k < 3; k++) { pos.set(P[i + k], (i + k) * 3); nor.set([b.x, b.y, b.z], (i + k) * 3); if (U) uv.set(U[i + k], (i + k) * 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// prisma deitado ao longo de x: telhado de duas águas, barraca (t = 0) ou talude de terra (t = largura do topo)
function prism(w, h, l, t = 0, s = 4) {
  const A0 = [-l / 2, 0, -w / 2], A1 = [l / 2, 0, -w / 2], C0 = [-l / 2, h, -t / 2], C1 = [l / 2, h, -t / 2], D0 = [-l / 2, h, t / 2], D1 = [l / 2, h, t / 2], B0 = [-l / 2, 0, w / 2], B1 = [l / 2, 0, w / 2];
  const P = [A0, C1, A1, A0, C0, C1, C0, D1, C1, C0, D0, D1, B0, B1, D1, B0, D1, D0, A0, B0, D0, A0, D0, C0, A1, D1, B1, A1, C1, D1], sl = Math.hypot(h, (w - t) / 2);
  return tris(P, P.map((p, i) => i < 18 ? [p[0] / s, (i < 6 ? (p[1] ? sl : 0) : i < 12 ? p[2] : (p[1] ? sl : 0)) / s] : [p[2] / s, p[1] / s]));
}
// balde de geometrias por material; build() funde cada balde numa malha
function kit(grp) {
  const B = {}; let T = null;
  const K = {
    raw(k, g) { if (T) g.applyMatrix4(T); (B[k] || (B[k] = [])).push(g); return g; },
    put(k, g, c = 0xffffff, f) { if (g.index) g = g.toNonIndexed(); if (T) g.applyMatrix4(T); (B[k] || (B[k] = [])).push(tint(g, c, f)); return g; },
    // conjunto montado em eixos próprios e posto em (x, z) girado de ry
    at(x, z, ry, fn) { T = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z); fn(); T = null; },
    box(k, w, h, d, x, y, z, c, ry = 0, f) { const g = new THREE.BoxGeometry(w, h, d); if (k === 'wall') boxUV(g, w, h, d, 8, 3.5); else if (k === 'tin') boxUV(g, w, h, d, 4, 4); if (ry) g.rotateY(ry); return K.put(k, g.translate(x, y + h / 2, z), c, f); },
    cyl(k, r0, r1, h, x, y, z, c, n = 10, f) { return K.put(k, new THREE.CylinderGeometry(r0, r1, h, n).translate(x, y + h / 2, z), c, f); },
    prism(k, w, h, l, t, x, y, z, c, ry = 0, f) { const g = prism(w, h, l, t); if (ry) g.rotateY(ry); return K.put(k, g.translate(x, y, z), c, f); },
    // retângulo rente ao chão; o.uv = metros por repetição da textura
    flat(k, w, l, x, z, y, c, o = {}) { const g = new THREE.PlaneGeometry(w, l, o.sx || 1, o.sz || 1).rotateX(-PI / 2); if (o.ry) g.rotateY(o.ry); g.translate(x, y, z); if (o.uv) worldUV(g, o.uv, o.uv2 || o.uv); return K.put(k, g, c, o.f); },
    // faixa ao longo de uma linha quebrada (eixos de táxi, curvas, setas)
    ribbon(k, pts, w, y, c) {
      const P = [];
      for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l * w / 2, nz = (bx - ax) / l * w / 2; const A = [ax + nx, y, az + nz], Bq = [ax - nx, y, az - nz], Cq = [bx - nx, y, bz - nz], D = [bx + nx, y, bz + nz]; P.push(A, D, Cq, A, Cq, Bq); }
      return K.put(k, tris(P), c);
    },
    // placas de concreto: cada uma com variante do atlas, giro e tom próprios (sem padrão repetido visto do ar)
    slabs(x0, x1, z0, z1, y, f, size = 7.5) {
      const nx = Math.max(1, Math.round((x1 - x0) / size)), nz = Math.max(1, Math.round((z1 - z0) / size)), dx = (x1 - x0) / nx, dz = (z1 - z0) / nz, n = nx * nz * 6;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3), Q = [[0, 0], [0, 1], [1, 1], [1, 0]], e = 0.004; let o = 0;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const xa = x0 + i * dx, za = z0 + j * dz, xc = xa + dx / 2, zc = za + dz / 2, h1 = hash(xc * 0.731, zc * 0.519), h2 = hash(zc * 0.377, xc * 0.913), cu = Math.floor(h1 * 4), cv = Math.floor(h2 * 4), r = Math.floor(h1 * 16) % 4, k = f ? f(xc, zc) : 1;
        const P = [[xa, za], [xa, za + dz], [xa + dx, za + dz], [xa + dx, za]];
        for (const q of [0, 1, 3, 1, 2, 3]) { const [u, v] = Q[(q + r) % 4]; pos.set([P[q][0], y, P[q][1]], o * 3); nor.set([0, 1, 0], o * 3); uv.set([(cu + e + u * (1 - 2 * e)) / 4, (cv + e + v * (1 - 2 * e)) / 4], o * 2); col.set([k, k, k * 0.985], o * 3); o++; }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return K.raw('conc', g);
    },
    // chão da base: grama aparada na altura da física, com manchas, e uma saia que desce até sumir dentro do relevo
    ground(x0, x1, z0, z1, f) {
      const ax = [x0 - 55, x0], az = [z0 - 55, z0]; for (let i = 1, n = Math.ceil((x1 - x0) / 16); i <= n; i++) ax.push(x0 + (x1 - x0) * i / n); for (let i = 1, n = Math.ceil((z1 - z0) / 16); i <= n; i++) az.push(z0 + (z1 - z0) * i / n); ax.push(x1 + 55); az.push(z1 + 55);
      const nx = ax.length, nz = az.length, pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3), idx = [];
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const o = j * nx + i, x = ax[i], z = az[j], out = i === 0 || j === 0 || i === nx - 1 || j === nz - 1, dry = sstep(.42, .8, vn(x / 70, z / 70)), m = (0.86 + 0.26 * vn(x / 47 + 3, z / 47 + 8)) * (out ? 0.8 : 1), k = f ? f(x, z) : 0;
        pos.set([x, out ? -13 : 0, z], o * 3); nor.set([0, 1, 0], o * 3); uv.set([(x * .848 + z * .53) / 33, (z * .848 - x * .53) / 33], o * 2); // textura girada: a repetição não alinha com a pista
        col.set([m * (1 + .26 * dry + .5 * k), m * (1 + .1 * dry + .28 * k), m * (1 - .06 * dry + .1 * k)], o * 3);
        if (i && j) idx.push(o - nx - 1, o - 1, o - nx, o - 1, o, o - nx);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
      return K.raw('ground', g.toNonIndexed());
    },
    light(x, y, z, c, s = 0.5) { return K.put('lite', new THREE.BoxGeometry(s, s * 0.7, s).translate(x, y, z), c); },
    // algarismo do atlas: deitado na pista (up = false, topo para −z) ou em pé virado para +z
    digit(d, w, h, x, y, z, ry, up) { const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv; for (let i = 0; i < 4; i++) uv.setX(i, (d - 1 + 0.04 + uv.getX(i) * 0.92) / 8); if (!up) g.rotateX(-PI / 2); if (ry) g.rotateY(ry); return K.put('glyph', g.translate(x, y, z)); },
    build() { for (const k in B) { const m = new THREE.Mesh(mergeGeometries(B[k]), M[k]); m.receiveShadow = true; m.castShadow = CAST.has(k); grp.add(m); } },
  };
  return K;
}
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k);
const camo = (s, a = 0.72, b = 1.2) => (x, y, z) => a + (b - a) * sstep(.42, .58, vn(x / s + y / s * .7, z / s + 11));

// ---------------------------------------------------------------- viaturas (frente = +z)
const wheels = (K, pts, r = 0.48) => { for (const [x, z] of pts) K.put('flat', new THREE.CylinderGeometry(r, r, 0.36, 10).rotateZ(PI / 2).translate(x, r, z), C.tyre); };
const VEH = {
  truck(K, c = C.olive, load = C.khaki) { K.box('flat', 2.2, 0.35, 6.4, 0, 0.75, 0, C.dark); K.box('flat', 2.2, 1.55, 1.6, 0, 1.1, 1.9, c); K.box('flat', 1.9, 0.95, 1.3, 0, 1.1, 3.1, c); K.box('flat', 2.3, 0.6, 3.9, 0, 1.1, -1.25, c); K.prism('flat', 2.3, 1.5, 3.9, 1.5, 0, 1.7, -1.25, load, PI / 2); wheels(K, [[-1, 2.9], [1, 2.9], [-1, -1.1], [1, -1.1], [-1, -2.3], [1, -2.3]]); },
  bowser(K, c = C.olive, tank = c) { K.box('flat', 2.2, 0.35, 7, 0, 0.75, 0, C.dark); K.box('flat', 2.2, 1.6, 1.7, 0, 1.1, 2.3, c); K.box('flat', 1.9, 0.95, 1.2, 0, 1.1, 3.4, c); K.put('flat', new THREE.CylinderGeometry(1.1, 1.1, 4.6, 12).rotateX(PI / 2).translate(0, 2.2, -1.1), tank); wheels(K, [[-1, 3], [1, 3], [-1, -1.2], [1, -1.2], [-1, -2.5], [1, -2.5]]); },
  jeep(K, c = C.olive) { K.box('flat', 1.55, 0.55, 3.3, 0, 0.5, 0, c); K.box('flat', 1.5, 0.35, 1.1, 0, 1.05, 1.0, c); K.box('flat', 1.45, 0.55, 0.06, 0, 1.4, 0.45, C.dark); K.box('flat', 1.3, 0.5, 0.5, 0, 1.05, -0.5, C.dark); wheels(K, [[-0.75, 1.1], [0.75, 1.1], [-0.75, -1.1], [0.75, -1.1]], 0.38); },
  fire(K) { K.box('flat', 2.5, 0.4, 8, 0, 0.8, 0, C.dark); K.box('flat', 2.5, 2.0, 2.3, 0, 1.2, 2.8, C.red); K.box('flat', 2.5, 1.8, 5.2, 0, 1.2, -1.2, C.red); K.box('flat', 0.5, 0.5, 1.6, 0, 3.0, -0.6, C.steel); wheels(K, [[-1.15, 2.8], [1.15, 2.8], [-1.15, -1.3], [1.15, -1.3], [-1.15, -2.7], [1.15, -2.7]], 0.6); },
  tug(K) { K.box('flat', 1.8, 0.9, 3.2, 0, 0.35, 0, C.yellow); K.box('flat', 1.5, 0.9, 1.1, 0, 1.25, -0.6, C.yellow); wheels(K, [[-0.85, 1], [0.85, 1], [-0.85, -1], [0.85, -1]], 0.42); },
  gpu(K) { K.box('flat', 1.5, 1.2, 2.5, 0, 0.45, 0, C.yellow); K.box('flat', 0.08, 0.08, 1.4, 0, 0.6, 1.9, C.dark); wheels(K, [[-0.75, 0.8], [0.75, 0.8], [-0.75, -0.8], [0.75, -0.8]], 0.3); },
};
const park = (K, type, x, z, ry, ...arg) => K.at(x, z, ry, () => VEH[type](K, ...arg));

const papis = [], socks = [], spins = [];
// biruta: mastro e manga (a manga gira devagar com o vento)
function windsock(K, grp, x, z, wood) {
  K.cyl('flat', 0.1, 0.14, 8, x, 0, z, wood ? C.wood : 0xdedbd0, 6);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.2, 10, 1, true).rotateZ(PI / 2).translate(1.6, 0, 0), M.sock); sock.position.set(x, 7.6, z); grp.add(sock); socks.push(sock);
}

// ================================================================ base de jato (Guerra Fria)
function jetBase(a, K, grp, side) {
  const hw = a.w / 2, L2 = a.len / 2, S = x => side * x, rot = side > 0 ? 0 : PI, X0 = hw + a.pad;
  const span = (xa, xb) => [Math.min(S(xa), S(xb)), Math.max(S(xa), S(xb))];
  const TX0 = 93.75, TX1 = 116.25, TXC = 105, AP1 = 206.25, APZ = 255, ZC = L2 - 25;   // táxi paralelo, fundo e meia-extensão do pátio, eixo das ligações de cabeceira
  K.ground(...span(-X0, X0 + 44), -L2 - 60, L2 + 60);
  // ---- concreto: pista (na altura que a física usa, +8 cm), táxi, ligações, pátio ----
  const tone = (x, z) => (0.93 + 0.1 * hash(x * .37, z * .41)) * (0.9 + 0.2 * vn(x / 60, z / 60 + 5)) * (hash(z * .9, x * .7) < 0.03 ? 1.1 : 1);
  K.slabs(-hw, hw, -L2, L2, 0.08, (x, z) => tone(x, z) * (1 - 0.12 * Math.exp(-x * x / 70)));
  K.slabs(...span(TX0, TX1), -L2 + 10, L2 - 10, 0.03, tone);
  const LINKS = [ZC, -ZC, 400, -400];
  for (const z of LINKS) { const hl = Math.abs(z) === ZC ? 15 : 11.25; K.slabs(...span(hw, TX0), z - hl, z + hl, 0.03, tone); }
  K.slabs(...span(TX1, AP1), -APZ, APZ, 0.03, (x, z) => tone(x, z) * 0.97);
  // ---- asfalto: acostamentos, áreas de sopro, estrada de perímetro e acessos ----
  const an = (x, y, z) => 0.8 + 0.4 * vn(x / 23, z / 23), asph = (xa, xb, za, zb, c = 0xffffff) => K.flat('asph', Math.abs(xb - xa), Math.abs(zb - za), (xa + xb) / 2, (za + zb) / 2, 0.015, c, { uv: 12, sx: Math.ceil(Math.abs(xb - xa) / 30), sz: Math.ceil(Math.abs(zb - za) / 30), f: an });
  for (const sx of [1, -1]) asph(sx * hw, sx * (hw + 7.5), -L2, L2);
  for (const e of [1, -1]) asph(-hw - 7.5, hw + 7.5, e * L2, e * (L2 + 42), 0xdcdcdc);
  asph(S(TX0 - 4), S(TX0), -L2 + 10, L2 - 10); asph(S(TX1), S(TX1 + 4), -L2 + 10, -APZ); asph(S(TX1), S(TX1 + 4), APZ, L2 - 10);
  const RD = X0 + 30, RF = -X0 + 12, RZ = L2 + 51;                                   // estrada de perímetro
  asph(S(RD - 3), S(RD + 3), -RZ + 3, RZ - 3); asph(S(RF - 3), S(RF + 3), -RZ + 3, RZ - 3); for (const e of [1, -1]) asph(S(RF - 3), S(RD + 3), e * RZ - 3, e * RZ + 3);
  asph(S(TX1 + 4), S(RD - 3), -295.5, -288.5); for (const z of [300, 430]) asph(S(AP1 + 2), S(RD - 3), z - 3.5, z + 3.5);
  asph(S(150), S(AP1 + 2), 262, 520);                                                // pátio de serviço (bombeiros, torre, combustível)
  asph(S(RD + 3), S(X0 + 44), 426.5, 433.5);                                         // portão: guarita e cancela, a estrada sai da base
  K.box('flat', 3, 2.6, 3, S(RD + 9), 0, 438, C.concw); K.box('flat', 3.6, 0.25, 3.6, S(RD + 9), 2.6, 438, 0x3a3a36); K.box('flat', 0.14, 0.14, 7.4, S(RD + 8), 1, 430, C.red);
  // ---- sinalização da pista (OACI), tudo numa malha de tinta ----
  const W = (w, l, x, z, c = C.white) => K.flat('paint', w, l, x, z, 0.1, c), Yl = (pts, w = 0.5, y = 0.05) => K.ribbon('paint', pts.map(p => [S(p[0]), p[1]]), w, y, C.yellow);
  for (const sx of [1, -1]) W(0.9, a.len - 10, sx * (hw - 1.2), 0);                                          // bordas
  for (let z = -L2 + 120; z < L2 - 120; z += 50) W(0.9, 30, 0, z + 15);                                      // eixo
  for (const e of [1, -1]) {
    const z0 = e * (L2 - 6), nb = 16, bw = 1.8, gap = (a.w - 6 - nb * bw) / (nb + 1);
    for (let k = 0; k < nb; k++) W(bw, 30, -hw + 3 + bw / 2 + k * (bw + gap) + (k >= nb / 2 ? gap * 2 : 0), z0 - e * 15); // cabeceira: "piano"
    W(a.w - 4, 1.8, 0, z0 - e * 36);
    // zona de toque: pares de faixas a 150/450/600 m; ponto de visada (dois blocos largos) a 300 m
    for (const [d, n] of [[150, 3], [450, 2], [600, 1], [750, 1]]) for (const sx of [1, -1]) for (let k = 0; k < n; k++) W(1.8, 22, sx * (6 + k * 3.2), z0 - e * d);
    for (const sx of [1, -1]) W(8, 45, sx * 9.5, z0 - e * 300);
    // número (18/36), deitado e virado para quem chega
    const ry = e > 0 ? 0 : PI, zn = z0 - e * 64; K.digit(e > 0 ? 1 : 3, 4.6, 14, -e * 2.7, 0.1, zn, ry); K.digit(e > 0 ? 8 : 6, 4.6, 14, e * 2.7, 0.1, zn, ry);
    // borracha de quem pousa nesta cabeceira
    const rb = new THREE.PlaneGeometry(26, 680).rotateX(-PI / 2); if (e > 0) rb.rotateY(PI); K.put('rubber', rb.translate(0, 0.09, z0 - e * 400));
    // área de sopro: setas amarelas apontando para a cabeceira
    for (let k = 0; k < 3; k++) { const za = e * (L2 + 4 + k * 12); for (const sx of [1, -1]) K.ribbon('paint', [[0, za], [sx * 33, za + e * 16.5]], 1.1, 0.035, C.yellow); }
    // placas de distância restante (milhares de pés), à direita de quem corre a pista a partir desta cabeceira
    for (let n = 1; n <= 7; n++) { const z = -e * L2 + e * n * 304.8, x = e * (hw + 10.5); K.box('flat', 1.5, 1.4, 0.14, x, 0.7, z, C.dark); K.box('flat', 0.1, 0.7, 0.1, x - 0.5, 0, z, C.steel); K.box('flat', 0.1, 0.7, 0.1, x + 0.5, 0, z, C.steel); K.digit(n, 1.0, 1.25, x, 1.4, z + e * 0.09, ry, true); }
  }
  // ---- sinalização de táxi (amarela): eixo, curvas de entrada, pontos de espera, pátio ----
  const arc = (cx, cz, r, a0, a1, n = 8) => Array.from({ length: n + 1 }, (_, i) => { const t = a0 + (a1 - a0) * i / n; return [cx + r * Math.cos(t), cz + r * Math.sin(t)]; });
  Yl([[TXC, -ZC + 20], [TXC, ZC - 20]]);
  for (const z of LINKS) {
    const e = Math.sign(z), end = Math.abs(z) === ZC, hl = end ? 15 : 11.25;
    Yl([[TXC - 20, z], [hw, z]]); Yl([[hw, z], [20, z]], 0.5, 0.12);                                           // sobre a pista a tinta sobe com ela (+8 cm)
    if (end) Yl(arc(TXC - 20, z - e * 20, 20, 0, e * PI / 2));                                             // do táxi para a ligação
    else for (const d of [1, -1]) Yl(arc(TXC - 20, z + d * 20, 20, 0, -d * PI / 2));
    Yl(arc(20, z - e * 20, 20, e * PI / 2, PI), 0.5, 0.12);                                                   // da ligação para o eixo da pista
    // ponto de espera a 75 m do eixo: duas linhas cheias (lado do táxi) e duas tracejadas (lado da pista)
    for (let k = 0; k < 4; k++) { const x = 75 - k * 0.9; if (k < 2) Yl([[x, z - hl + 1], [x, z + hl - 1]], 0.4); else for (let q = z - hl + 1; q < z + hl - 1.5; q += 1.8) Yl([[x, q], [x, q + 0.9]], 0.4); }
    K.box('flat', 1.6, 0.9, 0.14, S(77), 0.5, z + hl + 2.5, C.red, PI / 2); K.box('flat', 1.6, 0.9, 0.14, S(77), 0.5, z - hl - 2.5, C.red, PI / 2);
  }
  // pátio: faixa de rolagem, vagas com linha de entrada e "T" de parada, limite branco
  const LX = TX1 + 24, PX = AP1 - 34;
  Yl([[LX, -APZ + 14], [LX, APZ - 14]]);
  for (const z of [APZ - 34, 0, -APZ + 34]) Yl([[TXC, z], [LX, z]]);
  for (let z = -APZ + 45; z <= APZ - 45; z += 42) {
    Yl([...arc(LX + 14, z - 14, 14, PI, PI / 2, 6), [PX + 6, z]], 0.4);
    K.flat('paint', 0.5, 9, S(PX + 6), z, 0.05, C.yellow); K.flat('paint', 12, 0.35, S(PX - 4), z - 9, 0.05, C.white); K.flat('paint', 12, 0.35, S(PX - 4), z + 9, 0.05, C.white);
  }
  K.flat('paint', 0.45, APZ * 2 - 6, S(AP1 - 3), 0, 0.05, C.white);
  // cobertura da linha de voo (quatro vagas à sombra): telha sobre pórticos de aço
  K.at(S(PX - 2), 147, rot, () => {
    K.box('tin', 26, 0.35, 172, 0, 8, 0, 0xb4b8ae); K.box('flat', 26.4, 0.5, 0.5, 0, 7.6, -86, C.steel); K.box('flat', 26.4, 0.5, 0.5, 0, 7.6, 86, C.steel);
    for (let z = -86; z <= 86; z += 21.5) { for (const x of [-12.5, 12.5]) K.box('flat', 0.45, 8, 0.45, x, 0, z, C.steel); K.box('flat', 25, 0.7, 0.3, 0, 7.3, z, C.steel); }
  });
  // material de pista em cada vaga: extintor sobre rodas, calços, carreta de bombas aqui e ali
  for (let z = -APZ + 45, k = 0; z <= APZ - 45; z += 42, k++) {
    K.box('flat', 0.5, 1.0, 0.5, S(PX + 9), 0, z - 7, C.red); K.box('flat', 0.9, 0.3, 0.4, S(PX + 3), 0, z + 3, C.yellow);
    if (k % 4 === 1) K.at(S(PX - 12), z + 14, rot + 0.3, () => { K.box('flat', 1.6, 0.25, 4.2, 0, 0.5, 0, C.yellow); for (const x of [-0.4, 0.4]) K.put('flat', new THREE.CylinderGeometry(0.2, 0.2, 2.6, 8).rotateX(PI / 2).translate(x, 0.95, 0), 0x3d4230); wheels(K, [[-0.8, 1.5], [0.8, 1.5], [-0.8, -1.5], [0.8, -1.5]], 0.28); });
  }
  // ---- luzes: borda, cabeceira (verde), ALS em postes, táxi (azul) ----
  for (let z = -L2; z <= L2 + 1; z += 60) for (const sx of [1, -1]) K.light(sx * (hw + 2), 0.3, z, C.lamp, 0.6);
  for (const e of [1, -1]) {
    const zt = e * (L2 + 2);
    for (let x = -hw; x <= hw; x += 3) K.light(x, 0.3, zt, C.green, 0.6);
    // ALS: barras a cada 30 m até 600 m antes da cabeceira, barra cruzada aos 300 m; em postes (o terreno ali fica abaixo)
    for (let d = 60; d <= 600; d += 30) {
      const y = 0.6 + d * 0.004, n = d === 300 ? 7 : 2;
      for (let k = -n; k <= n; k++) K.light(k * (n > 2 ? 1.5 : 1.2), y, zt + e * d, C.lamp, 0.55);
      K.box('flat', n * 3 + 1, 0.12, 0.12, 0, y - 0.4, zt + e * d, C.steel); K.box('flat', 0.18, 16, 0.18, 0, y - 16.4, zt + e * d, C.steel);
    }
    // PAPI à esquerda de quem pousa, a 300 m da cabeceira
    const ps = -e, pz = e * (L2 - 300);
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.8), M.white); b.position.set(ps * (hw + 15 + k * 9), 0.6, pz); grp.add(b); papis.push({ m: b, a, k, z: pz, e }); }
  }
  for (let z = -L2 + 10; z <= L2 - 10; z += 40) { K.light(S(TX0 - 1), 0.2, z, C.blue, 0.32); if (Math.abs(z) > APZ) K.light(S(TX1 + 1), 0.2, z, C.blue, 0.32); }
  for (const z of LINKS) { const hl = Math.abs(z) === ZC ? 15 : 11.25; for (let x = hw + 12; x < TX0 - 5; x += 13) for (const d of [1, -1]) K.light(S(x), 0.2, z + d * (hl + 1), C.blue, 0.32); }

  // ---- abrigos reforçados (HAS): arco de concreto camuflado, portal com portas de correr, saída de gases atrás ----
  const has = () => {
    const R = 10.5, Lh = 30, sy = 0.78, hc = 0x6f7460, cm = camo(7, 0.7, 1.15);
    K.put('flat', new THREE.CylinderGeometry(R, R, Lh, 18, 6, true, -PI / 2, PI).rotateX(-PI / 2).rotateY(PI / 2).scale(1, sy, 1), hc, cm);
    K.put('flat', new THREE.CircleGeometry(R, 18, 0, PI).rotateY(-PI / 2).scale(1, sy, 1).translate(-Lh / 2, 0, 0), hc, cm);
    K.put('flat', new THREE.CircleGeometry(R, 18, 0, PI).rotateY(PI / 2).scale(1, sy, 1).translate(Lh / 2, 0, 0), hc, cm);
    K.box('flat', 0.5, 5.6, 13, -Lh / 2 - 0.1, 0, 0, 0x0f0f0d);                                              // vão aberto
    for (const d of [1, -1]) K.box('flat', 0.45, 5.8, 4.6, -Lh / 2 - 0.55, 0, d * 8.8, C.steel);              // folhas recolhidas
    K.box('flat', 1.0, 0.8, 23.5, -Lh / 2 - 0.4, 5.8, 0, C.concw); for (const d of [1, -1]) K.box('flat', 1.0, 5.8, 0.8, -Lh / 2 - 0.4, 0, d * 11.4, C.concw);
    K.box('flat', 5, 4.2, 5, Lh / 2 + 2.4, 0, 0, hc, 0, cm); K.box('flat', 0.4, 3.2, 3.6, Lh / 2 + 5, 0.4, 0, 0x0f0f0d);
  };
  for (let z = -130; z <= 220; z += 70) { K.at(S(AP1 + 17.5), z, rot, has); K.slabs(...span(AP1, AP1 + 2.5), z - 7.5, z + 7.5, 0.03, tone); }
  // dispersão na ponta sul: três abrigos soltos, cada um com o seu acesso
  for (const z of [-560, -680, -800]) { K.slabs(...span(TX1, TX1 + 22.5), z - 7.5, z + 7.5, 0.03, tone); K.at(S(TX1 + 22.5 + 15.5), z, rot, has); Yl([...arc(TXC + 14, z - 14, 14, PI, PI / 2, 6), [TX1 + 20, z]], 0.4); }
  // ---- hangar de manutenção: galpão de chapa com duas águas, portão aberto pela metade ----
  K.at(S(AP1 + 21), -215, rot, () => {
    const c = 0xaeb4a6; K.box('tin', 38, 11, 50, 0, 0, 0, c); K.put('tin', prism(50, 4.5, 39).translate(0, 11, 0), shade(c, 0.9));
    K.box('flat', 0.5, 8.6, 30, -19.1, 0, 4, 0x11110f); for (const [z, w] of [[-17, 12], [-9, 10]]) K.box('tin', 0.4, 9, w, -19.5 - (z === -9 ? 0.4 : 0), 0, z, shade(c, 0.82));
    K.box('flat', 0.5, 1.2, 44, -19.05, 11.3, 0, shade(c, 0.6)); K.light(0, 16, 0, C.redl, 0.5);
    K.box('wall', 20, 7, 12, 0, 0, 32, 0xffffff); K.box('flat', 20.6, 0.35, 12.6, 0, 7, 32, 0x3a3a36);
  });
  K.slabs(...span(AP1, AP1 + 2.5), -235, -191, 0.03, tone);
  // ---- torre de controle com bloco de operações ----
  K.at(S(182), 338, rot, () => {
    K.box('wall', 13, 7, 26, 9, 0, 6, 0xffffff); K.box('flat', 13.6, 0.4, 26.6, 9, 7, 6, 0x3a3a36); K.box('flat', 3, 1.3, 4, 10, 7.4, 10, C.steel);
    K.box('flat', 6.4, 20, 6.4, 0, 0, 0, C.concw);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) { const o = -2.4375 + i * 1.625, c = (i + j) % 2 ? 0xd8d4c8 : C.red; K.box('flat', 1.625, 0.7, 6.52, o, 17.2 + j * 0.7, 0, c); K.box('flat', 6.52, 0.7, 1.625, 0, 17.2 + j * 0.7, o, c); } // faixa xadrez
    K.cyl('flat', 5.6, 5.2, 0.45, 0, 20, 0, 0x4a4a45, 8); K.cyl('glass', 4.7, 3.9, 3.3, 0, 20.45, 0, 0xffffff, 8); K.cyl('flat', 5.2, 5.2, 0.5, 0, 23.75, 0, 0x33332f, 8);
    for (let k = 0; k < 8; k++) { const t = k * PI / 4 + PI / 8; K.put('flat', new THREE.BoxGeometry(0.18, 3.4, 0.18).translate(Math.sin(t) * 4.32, 22.1, Math.cos(t) * 4.32), 0x33332f); }
    for (const [x, z, h] of [[1.5, 1, 5], [-2, -1.5, 3.4], [2.2, -2, 2.4]]) K.cyl('flat', 0.05, 0.07, h, x, 24.2, z, 0xd0d0d0, 5);
    K.light(0, 24.6, 0, C.redl, 0.45);
  });
  { // farol rotativo no teto da torre (branco e verde, base militar)
    const bg = mergeGeometries([tint(new THREE.BoxGeometry(0.5, 0.45, 0.9).translate(0, 0, 0.55).toNonIndexed(), C.lamp), tint(new THREE.BoxGeometry(0.5, 0.45, 0.9).translate(0, 0, -0.55).toNonIndexed(), C.green)]);
    const b = new THREE.Mesh(bg, M.lite); b.position.set(S(182 - 2.5), 24.7, 338 + (side > 0 ? 2.5 : -2.5)); grp.add(b); spins.push({ m: b, w: 2.5 });
  }
  // ---- bombeiros: garagem com três portões e os carros na frente ----
  K.at(S(190), 284, rot, () => { K.box('flat', 14, 6, 26, 2, 0, 0, C.concw); K.box('flat', 14.6, 0.4, 26.6, 2, 6, 0, 0x3a3a36); for (const z of [-8, 0, 8]) K.box('flat', 0.3, 4.6, 6, -5.1, 0, z, C.red); });
  park(K, 'fire', S(172), 276, side * PI / 2 + PI); park(K, 'fire', S(170), 292, side * PI / 2 + PI + 0.12);
  // ---- combustível: tanques dentro de uma bacia de contenção, caminhões-tanque ----
  for (const [x, z] of [[176, 452], [196, 452], [176, 474], [196, 474]]) { K.cyl('flat', 7.5, 7.5, 9, S(x), 0, z, 0xd9d7cc, 20, (px, py) => 0.92 + 0.1 * vn(px, py * 0.4)); K.put('flat', new THREE.ConeGeometry(7.6, 1.3, 20).translate(S(x), 9.65, z), 0xc4c2b8); K.light(S(x), 10.5, z, C.redl, 0.35); }
  for (const [w, d, x, z] of [[44, 1, 186, 439.5], [44, 1, 186, 486.5], [1, 46, 164.5, 463], [1, 46, 207.5, 463]]) K.box('flat', w, 1.3, d, S(x), 0, z, C.concw);
  park(K, 'bowser', S(160), 420, 0.2, C.olive, 0xb8b8ae); park(K, 'bowser', S(166), 408, 0.1, C.olive, 0xb8b8ae);
  // ---- radar de vigilância (antena girando) do outro lado da pista; radomo de aproximação ao sul ----
  K.at(S(-150), 240, rot, () => {
    for (const x of [-2, 2]) for (const z of [-2, 2]) K.box('flat', 0.3, 11, 0.3, x, 0, z, C.steel);
    for (const y of [3.5, 7.2]) { K.box('flat', 4.3, 0.2, 0.2, 0, y, 2, C.steel); K.box('flat', 4.3, 0.2, 0.2, 0, y, -2, C.steel); K.box('flat', 0.2, 0.2, 4.3, 2, y, 0, C.steel); K.box('flat', 0.2, 0.2, 4.3, -2, y, 0, C.steel); }
    K.box('flat', 5.4, 0.3, 5.4, 0, 11, 0, C.steel); K.box('flat', 5, 3.2, 9, 8, 0, 0, 0x8d927f); K.box('flat', 5.4, 0.3, 9.4, 8, 3.2, 0, 0x3a3a36);
  });
  { const rg = new THREE.BoxGeometry(7.5, 2.8, 0.2, 8, 1, 1), p = rg.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + p.getX(i) * p.getX(i) * 0.05); rg.computeVertexNormals();
    const an = new THREE.Mesh(mergeGeometries([tint(rg.translate(0, 2, 0).toNonIndexed(), 0xa9aea6), tint(new THREE.BoxGeometry(0.5, 1.2, 0.5).translate(0, 0.6, 0.4).toNonIndexed(), C.steel)]), M.flat);
    an.position.set(S(-150), 11.3, 240); an.castShadow = true; grp.add(an); spins.push({ m: an, w: 1.5 }); }
  K.at(S(160), -330, rot, () => { K.box('wall', 10, 7, 12, 0, 0, 0, 0xffffff); K.box('flat', 10.6, 0.4, 12.6, 0, 7, 0, 0x3a3a36); K.put('flat', new THREE.SphereGeometry(5, 18, 12).translate(0, 10.6, 0), 0xe4e2da); });
  // ---- postes de iluminação do pátio, entre os abrigos ----
  for (let z = -95; z <= 255; z += 70) { const x = S(AP1 + 4); K.cyl('flat', 0.16, 0.24, 17, x, 0, z, C.steel, 6); K.box('flat', 0.5, 0.6, 3.4, x - side * 0.3, 16.6, z, 0x33332f); for (const d of [-1.2, -0.4, 0.4, 1.2]) K.light(x - side * 0.62, 16.9, z + d, C.lamp, 0.45); }
  // ---- viaturas no pátio: tratores, unidades de partida, caminhão-tanque, carga, jipe "follow-me" ----
  for (let z = -APZ + 45, k = 0; z <= APZ - 45; z += 42, k++) { if (k % 2) park(K, 'gpu', S(PX + 12), z + 12, rnd(0, 6)); if (k % 3 === 0) park(K, 'tug', S(PX + 16), z - 13, rnd(0, 6)); }
  park(K, 'bowser', S(PX - 6), 60, side * PI / 2, C.olive, C.olive); park(K, 'truck', S(AP1 - 6), -170, 0.1); park(K, 'truck', S(AP1 - 6), -160, 0.05); park(K, 'jeep', S(LX + 6), 236, PI, C.yellow); park(K, 'jeep', S(168), 322, 0.4);
  park(K, 'truck', S(RD - 12), 300, PI / 2); park(K, 'jeep', S(196), 366, 1.2);
  windsock(K, grp, S(hw + 30), -L2 + 330, false); windsock(K, grp, S(-(hw + 30)), L2 - 330, false);
}

// ================================================================ campo avançado de 1944
function propBase(a, K, grp, side) {
  const hw = a.w / 2, L2 = a.len / 2, S = x => side * x, rot = side > 0 ? 0 : PI, X0 = hw + a.pad;
  const span = (xa, xb) => [Math.min(S(xa), S(xb)), Math.max(S(xa), S(xb))];
  const TR = 95, ZC = L2 - 30;                                                        // eixo do caminho de táxi e das ligações de cabeceira
  K.ground(...span(-X0, X0 + 22), -L2 - 60, L2 + 60, (x, z) => 0.5 * sstep(46, 30, Math.abs(x)) + 0.35 * sstep(.55, .8, vn(x / 31 + 7, z / 31)) * sstep(60, 110, side * x) * sstep(330, 250, Math.abs(z)));
  // ---- terra batida: leito da pista (aparece nas bordas e nas pontas), caminho de táxi, pátio, acessos ----
  const dt = (x, y, z) => { const k = 0.74 + 0.44 * vn(x / 17, z / 17), gr = 0.5 * sstep(.45, .85, vn(x / 26 + 4, z / 26)); return [k * (1 - .2 * gr), k * (1 - .04 * gr), k * (1 - .3 * gr)]; }, dirt = (xa, xb, za, zb, c = 0xffffff, o = {}) => K.flat('dirt', Math.abs(xb - xa), Math.abs(zb - za), (xa + xb) / 2, (za + zb) / 2, 0.015, c, Object.assign({ uv: 13, sx: Math.ceil(Math.abs(xb - xa) / 7), sz: Math.ceil(Math.abs(zb - za) / 7), f: dt }, o));
  dirt(-hw - 6, hw + 6, -L2 - 40, L2 + 40, 0xfff6e6);
  dirt(S(TR - 7), S(TR + 7), -ZC - 9, ZC + 9); for (const z of [ZC, -ZC, 0]) dirt(S(hw + 6), S(TR - 7), z - 9, z + 9);
  dirt(S(TR + 7), S(152), -128, 128, 0xf2ece0); dirt(S(152), S(X0 + 22), 118, 125); dirt(S(152), S(192), -128, 20, 0xe6dccc);
  // ---- chapa perfurada: pista (+8 cm, a altura que a física usa), pátio de serviço e baias ----
  const pt = (x, z) => (0.78 + 0.3 * vn(x / 21, z / 43)) * (0.9 + 0.2 * hash(Math.floor(x / 6.1), Math.floor(z / 14))), psp = (xa, xb, za, zb, y, f = (x, y, z) => pt(x, z)) => K.flat('psp', Math.abs(xb - xa), Math.abs(zb - za), (xa + xb) / 2, (za + zb) / 2, y, 0xffffff, { uv: 6.1, uv2: 3.05, sx: Math.ceil(Math.abs(xb - xa) / 6), sz: Math.ceil(Math.abs(zb - za) / 14), f });
  // meio da pista empoeirado (mais claro), barro e ferrugem nas bordas, pontas mais gastas
  psp(-hw, hw, -L2, L2, 0.08, (x, y, z) => { const k = pt(x, z) * (1 - 0.25 * sstep(hw - 7, hw, Math.abs(x)) * vn(x, z / 9)), d = Math.exp(-x * x / 70) * (0.45 + 0.55 * vn(x / 5, z / 37)); return [k * (1 + 0.5 * d), k * (1 + 0.4 * d), k * (1 + 0.24 * d)]; });
  psp(S(108), S(142), -72, 72, 0.03);
  // ---- marcas: eixo e cabeceiras caiados (gastos), painéis de canto ----
  const wc = 0xcfcaba, Wm = (w, l, x, z, y = 0.1) => K.flat('paint', w, l, x, z, y, wc, { f: (px, py, pz) => 0.72 + 0.4 * vn(px * 1.3, pz / 3) });
  for (let z = -L2 + 60; z < L2 - 60; z += 60) Wm(0.7, 22, 0, z + 11);
  for (const e of [1, -1]) { Wm(a.w - 6, 1.6, 0, e * (L2 - 4)); for (const sx of [1, -1]) { K.flat('paint', 7, 1.4, sx * (hw + 5), e * (L2 + 1), 0.03, C.white); K.flat('paint', 1.4, 7, sx * (hw + 7.8), e * (L2 - 1.8), 0.03, C.white); } }
  // marcos de borda (cavaletes brancos) e potes de querosene do balizamento noturno
  for (let z = -L2; z <= L2 + 1; z += 60) for (const sx of [1, -1]) { K.prism('flat', 0.5, 0.42, 1.3, 0, sx * (hw + 3.2), 0, z + 6, 0xdad6c8, PI / 2); K.light(sx * (hw + 2.2), 0.24, z, C.flare, 0.42); }
  // ---- baias de dispersão: placa de PSP, acesso de terra e talude em U aberto para o táxi ----
  const bf = (x, y, z) => 0.82 + 0.36 * vn(x / 5, z / 5) + y * 0.05;                    // talude: grama mais rala no topo
  const bay = () => {
    K.prism('flat', 9, 2.3, 42, 1.4, 18, 0, 0, C.earth, PI / 2, bf); for (const d of [1, -1]) K.prism('flat', 9, 2.3, 30, 1.4, 4, 0, d * 17, C.earth, 0, bf);
  };
  const BAYS = [-705, -560, -415, -270, 270, 415, 560, 705];
  for (const z of BAYS) {
    psp(S(TR + 16), S(TR + 42), z - 13, z + 13, 0.03); dirt(S(TR + 7), S(TR + 16), z - 6, z + 6); K.at(S(TR + 29), z, rot, bay);
    // tambores e caixotes de munição encostados no talude
    K.at(S(TR + 40), z + 9, rot, () => { for (let i = 0; i < 5; i++) K.cyl('flat', 0.29, 0.29, 0.88, rnd(-1, 1), 0, i * 0.7 - 1.4, i % 3 ? C.olive : 0x7a3b22, 8); K.box('flat', 1.2, 0.6, 2.2, -2.5, 0, -4, C.wood); K.box('flat', 1.2, 0.6, 2.2, -2.5, 0.6, -4.2, shade(C.wood, 1.15)); });
  }
  // ---- hangares "blister": arco baixo de chapa ondulada camuflada, aberto nas duas pontas ----
  for (const z of [-160, -205]) {
    K.at(S(170), z, rot, () => {
      const g = new THREE.CylinderGeometry(13, 13, 18, 16, 4, true, -PI / 2, PI).rotateX(-PI / 2).rotateY(PI / 2).scale(1, 0.5, 1), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 18 / 4, uv.getX(i) * 30 / 4);
      K.put('tin', g, 0x768064, camo(6, 0.55, 1.1)); for (const d of [1, -1]) K.box('flat', 18, 0.5, 0.5, 0, 0, d * 13, C.dark);
    });
    psp(S(134), S(160), z - 12, z + 12, 0.03);
  }
  dirt(S(TR + 7), S(134), -217, -128, 0xf2ece0);
  // ---- torre de vigia de madeira com cabana, e o quadrado de sinais (o "T" de pouso) ao pé dela ----
  K.at(S(64), 34, rot, () => {
    for (const x of [-1.8, 1.8]) for (const z of [-1.8, 1.8]) K.box('flat', 0.26, 7, 0.26, x, 0, z, C.wood);
    for (const d of [1, -1]) for (const r of [0, PI / 2]) { const g = new THREE.BoxGeometry(5.6, 0.14, 0.14).rotateZ(d * 0.72).translate(0, 3.4, 1.8); K.put('flat', g.rotateY(r), C.wood); K.put('flat', new THREE.BoxGeometry(5.6, 0.14, 0.14).rotateZ(d * 0.72).translate(0, 3.4, -1.8).rotateY(r), C.wood); }
    K.box('flat', 5.4, 0.2, 5.4, 0, 7, 0, shade(C.wood, 1.1)); K.box('flat', 3.6, 2.2, 3.6, 0.4, 7.2, 0, 0x6a6f52); K.box('flat', 3.66, 0.8, 3.0, 0.4, 8.2, 0, 0x1c2428); K.box('flat', 3.0, 0.8, 3.66, 0.4, 8.2, 0, 0x1c2428);
    K.prism('flat', 4.6, 1.2, 4.6, 0, 0.4, 9.4, 0, 0x4d4a3a);
    for (const [x, z, w, d] of [[-2.6, 0, 0.1, 5.4], [0, 2.6, 5.4, 0.1], [0, -2.6, 5.4, 0.1]]) K.box('flat', w, 0.1, d, x, 8.1, z, C.wood);
    K.put('flat', new THREE.BoxGeometry(0.7, 8.4, 0.12).rotateZ(-0.42).translate(4.2, 3.6, 0), C.wood);
    K.cyl('flat', 0.04, 0.05, 3.5, 0.4, 10.6, 0, 0xcfcfcf, 5);
  });
  { const x = 48, z = 62; for (const [w, l, ox, oz] of [[12, 0.6, 0, 6], [12, 0.6, 0, -6], [0.6, 12, 6, 0], [0.6, 12, -6, 0], [1.1, 8, 0, 0], [5.5, 1.1, 0, -3.5]]) K.flat('paint', w, l, S(x + ox), z + oz, 0.03, C.white); }
  windsock(K, grp, S(58), 86, true);
  // ---- barracas: duas ruas de barracas de praça e as grandes (rancho, sala de instrução) ----
  for (let z = 30; z <= 102; z += 9) for (const x of [166, 180]) K.prism('flat', 4.6, 2.5, 6.2, 0, S(x), 0, z + (x > 170 ? 3 : 0), shade(0x77734f, rnd(.85, 1.12)));
  for (const [x, z] of [[200, 48], [200, 78]]) { K.box('flat', 9, 1.7, 15, S(x), 0, z, shade(0x77734f, 0.95)); K.prism('flat', 9.6, 2.4, 15.4, 0, S(x), 1.7, z, 0x6c6947, PI / 2); }
  K.box('flat', 6, 2.6, 12, S(198), 0, 108, 0x5b5f47); K.prism('flat', 6.6, 1.3, 12.6, 0, S(198), 2.6, 108, 0x44463a, PI / 2);          // barracão de madeira
  // ---- depósito de combustível: tambores em pilhas dentro de um talude, caminhões-tanque ----
  K.at(S(174), -62, rot, () => {
    K.prism('flat', 8, 2.2, 36, 1.2, 15, 0, 0, C.earth, PI / 2, bf); for (const d of [1, -1]) K.prism('flat', 8, 2.2, 28, 1.2, 1, 0, d * 14.5, C.earth, 0, bf);
    for (let i = 0; i < 9; i++) for (let j = 0; j < 14; j++) { if (hash(i, j) < 0.2) continue; const x = -6 + i * 0.66 + (i > 4 ? 3 : 0), z = -9 + j * 0.66 + (j > 6 ? 4 : 0), c = shade(hash(j, i) < 0.25 ? 0x7a3b22 : C.olive, 0.85 + 0.3 * hash(i * 3, j)); K.cyl('flat', 0.29, 0.29, 0.88, x, 0, z, c, 8); if (hash(i + 9, j) < 0.3) K.cyl('flat', 0.29, 0.29, 0.88, x, 0.88, z, c, 8); }
  });
  park(K, 'bowser', S(160), -38, 0.3); park(K, 'bowser', S(156), -84, -0.2);
  // ---- depósito de bombas, longe de tudo, do outro lado da pista ----
  for (const z of [-330, -370]) K.at(S(-140), z, PI - rot, () => {
    K.prism('flat', 8, 2.2, 32, 1.2, 12, 0, 0, C.earth, PI / 2, bf); for (const d of [1, -1]) K.prism('flat', 8, 2.2, 22, 1.2, 1, 0, d * 12.5, C.earth, 0, bf);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 9; j++) K.put('flat', new THREE.CylinderGeometry(0.2, 0.2, 1.5, 7).rotateZ(PI / 2).translate(-3 + i * 2.2, 0.3, -8 + j * 2), 0x3d4230);
  });
  dirt(S(-126), S(-hw - 6), -353, -347);
  // ---- antiaérea: ninhos de sacos de areia com um canhão de 40 mm ----
  for (const [x, z] of [[-78, L2 - 140], [-78, -L2 + 140], [160, L2 - 70], [160, -L2 + 70], [-150, 60]]) K.at(S(x), z, hash(x, z) * 6, () => {
    K.put('flat', new THREE.LatheGeometry([[3.4, 0], [3.5, 1.05], [4.3, 1.05], [4.6, 0]].map(p => new THREE.Vector2(...p)), 14), C.sand, (px, py, pz) => 0.85 + 0.25 * vn(px * 2, pz * 2 + py * 5));
    K.cyl('flat', 0.9, 1.1, 0.5, 0, 0, 0, C.olive, 8); K.box('flat', 1.3, 0.9, 1.6, 0, 0.5, 0, C.olive); K.put('flat', new THREE.CylinderGeometry(0.06, 0.09, 3.4, 6).rotateX(PI / 2 - 0.75).translate(0, 2.2, 1.5), 0x30332a);
  });
  // ---- furgão xadrez de controle de pista, ao lado de cada cabeceira ----
  for (const e of [1, -1]) K.at(S(-(hw + 17)), e * (L2 - 28), 0, () => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) K.box('flat', 2.2, 1.05, 1.1, 0, 0.7 + j * 1.05, -1.65 + i * 1.1, (i + j) % 2 ? 0xe0ddd2 : 0x18181a);
    K.box('flat', 1.2, 0.7, 1.2, 0, 2.8, 0, 0x1c2428); wheels(K, [[-1.1, 1.2], [1.1, 1.2], [-1.1, -1.2], [1.1, -1.2]], 0.4);
  });
  // ---- viaturas: caminhões no pátio, ambulância e carro de bombeiros perto da torre, jipes ----
  for (let i = 0; i < 4; i++) park(K, 'truck', S(180 + (i % 2) * 2), 0 - i * 5.2 + 12, side * PI / 2 + PI + rnd(-.08, .08));
  park(K, 'truck', S(78), 22, 0.1, 0xd8d5c8, 0xd8d5c8); park(K, 'truck', S(79), 12, -0.05, C.red, C.red); park(K, 'jeep', S(70), 46, 2.2); park(K, 'jeep', S(158), 100, 0.6); park(K, 'jeep', S(120), -150, 1.9); park(K, 'truck', S(150), -230, 0.3);
  // material no pátio: carretas de bomba, caixotes, tambores, lonas e a talha de trocar motor
  for (let z = -64, k = 0; z <= 64; z += 16, k++) {
    const x = 144 + hash(z, 3) * 3;
    if (k % 3 === 0) K.at(S(x), z, rot + hash(z, 1) - 0.5, () => { K.box('flat', 1.5, 0.2, 3.6, 0, 0.45, 0, C.olive); for (const q of [-0.35, 0.35]) K.put('flat', new THREE.CylinderGeometry(0.18, 0.18, 2.2, 8).rotateX(PI / 2).translate(q, 0.83, 0), 0x3d4230); wheels(K, [[-0.75, 1.2], [0.75, 1.2], [-0.75, -1.2], [0.75, -1.2]], 0.26); });
    else if (k % 3 === 1) { for (let i = 0; i < 4; i++) K.box('flat', 1.1, 0.55, 1.9, S(x + (i % 2) * 1.3), (i >> 1) * 0.55, z + (i % 2) * 0.3, shade(C.wood, 0.9 + 0.3 * hash(i, z)), hash(z, i) * 0.3); }
    else { K.box('flat', 3.2, 1.1, 2.4, S(x), 0, z, 0x6f6c4c, 0.3); for (let i = 0; i < 6; i++) K.cyl('flat', 0.29, 0.29, 0.88, S(x - 2.6 + (i % 3) * 0.64), 0, z + 2.4 + (i > 2 ? 0.64 : 0), i % 4 ? C.olive : 0x7a3b22, 8); }
  }
  K.at(S(126), 58, rot + 0.5, () => { for (const [x, z] of [[-1.6, -1.2], [1.6, -1.2], [0, 1.8]]) K.put('flat', new THREE.CylinderGeometry(0.06, 0.08, 5.4, 6).translate(0, 2.6, 0).rotateZ(x * 0.19).rotateX(-z * 0.2).translate(x, 0, z), C.wood); K.box('flat', 0.9, 0.9, 1.3, 0, 0, 0, 0x3a3d38); });
}

// ---------------------------------------------------------------- montagem
for (const a of AIRFIELDS) {
  const grp = new THREE.Group(); grp.position.set(a.x, a.h, a.z); scene.add(grp); a.grp = grp; grp.visible = a.set === 'prop';
  const K = kit(grp), side = a.team === 1 ? 1 : -1;                                   // pátio e instalações do lado de dentro
  (a.set === 'jet' ? jetBase : propBase)(a, K, grp, side);
  K.build(); a.group = grp;
}
let t = 0;
// pl: avião do jogador — o PAPI mostra a rampa dele (caixa k fica vermelha abaixo de 2,5°+0,33°·k)
export function updateAirfields(dt, pl) {
  t += dt; for (const s of socks) s.rotation.y = 0.6 + Math.sin(t * 0.3) * 0.35 + Math.sin(t * 1.7) * 0.05;
  for (const s of spins) s.m.rotation.y = t * s.w;
  if (!pl) return;
  for (const P of papis) {
    const a = P.a, along = (pl.pos.z - (a.z + P.z)) * P.e, up = pl.pos.y - a.h;
    const ang = along > 0 ? Math.atan2(up, along) * 180 / Math.PI : 0;
    P.m.material = ang > 2.5 + 0.33 * (3 - P.k) ? M.white : M.red;
  }
}
