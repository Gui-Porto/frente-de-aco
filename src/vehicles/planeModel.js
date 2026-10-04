import * as THREE from 'three';
import { planeDecals, camoTexture } from './paint.js';
import { MISSILES } from '../data/vehicles.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hasModel, gltfPlane } from './modelLibrary.js';
import { buildPlaneFx } from './planeFx.js';
import * as DT from './planeDetail.js';
import { wingCfg as wingPlan, tailCfg, finCfg, station, chordAt, tipBreak, SURF } from './planeGeom.js';
// =====================================================================
// Modelo 3D procedural das aeronaves (só visual; física e caixas de
// colisão vêm dos dados). Asas e empenagem são sólidos de perfil NACA
// gerados estação por estação (elípticas, trapezoidais ou enflechadas),
// com pintura de cima e de baixo diferentes. Eixos: +z nariz, +y cima, +x asa esquerda.
// Retorna { root, wingL, wingR, tail, prop, bombMeshes, rocketMeshes, missileMeshes, mats }.
// =====================================================================
const NP = 9, XS = Array.from({ length: NP }, (_, i) => (1 - Math.cos(Math.PI * i / (NP - 1))) / 2);
const yt = x => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4); // meia espessura, t = 1
const deg = Math.PI / 180, V2 = (x, y) => new THREE.Vector2(x, y);

// Sólido de asa. o: { side, x0, half, c0, c1, zq0, sweep (m de recuo do 1/4 de corda na ponta), t0, t1, dih (rad), y0, ellip }
// o.sub = { s0, s1, a, b }: só o trecho da envergadura s0..s1 e da corda a..b (frações) — a asa sem o bordo de
// fuga (a = 0, b = dobradiça) ou uma superfície de comando (a = dobradiça, b = 1). A superfície tem perfil
// próprio (bordo arredondado na dobradiça) e espessura igual à da asa ali, então as duas se encaixam com a fresta.
// o.cap0 fecha também a raiz. Grupo 0 = extradorso (cor de cima), grupo 1 = intradorso e pontas.
export function wingGeometry(o) {
  const N = 14, R = 2 * NP - 2, pos = [], uv = [], up = [], low = [], sb = o.sub || { s0: 0, s1: 1, a: 0, b: 1 };
  const tHinge = sb.a > 0 ? 2.15 * yt(sb.a) : 1; // superfície: meia-espessura máxima = a da asa na dobradiça (+ folga)
  for (let j = 0; j <= N; j++) {
    const s = sb.s0 + (sb.s1 - sb.s0) * j / N;
    const cw = o.ellip ? Math.max(o.c0 * Math.sqrt(1 - Math.min(s, 0.985) ** 2), o.c1 || 0) : o.c0 + (o.c1 - o.c0) * s;
    const zq = o.zq0 - o.sweep * s, zle = zq + 0.25 * cw - sb.a * cw, c = (sb.b - sb.a) * cw, x = o.side * (o.x0 + s * o.half);
    // quebra de diedro opcional (o.brk = { at: fração da envergadura, dih: rad }), ex.: ponta da asa do F-4
    const t = (o.t0 + (o.t1 - o.t0) * s) * cw * tHinge, y = o.y0 + (o.brk && s > o.brk.at ? o.brk.at * o.half * Math.tan(o.dih) + (s - o.brk.at) * o.half * Math.tan(o.brk.dih) : s * o.half * Math.tan(o.dih));
    const ring = [];
    for (let k = 0; k < NP; k++) ring.push([XS[k], 1]);
    for (let k = NP - 2; k >= 1; k--) ring.push([XS[k], -1]);
    for (const [xc, sg] of ring) {
      pos.push(x, y + sg * yt(xc) * t + (sg > 0 ? 0.012 * c * Math.sin(Math.PI * xc) : 0), zle - xc * c);
      uv.push(x * 0.22, (zle - xc * c) * 0.22);
    }
  }
  const at = (j, k) => j * R + (k % R);
  for (let j = 0; j < N; j++) for (let k = 0; k < R; k++) {
    const a = at(j, k), b = at(j, k + 1), c = at(j + 1, k), d = at(j + 1, k + 1);
    const tri = o.side > 0 ? [a, c, b, b, c, d] : [a, b, c, b, d, c];
    (k < NP - 1 ? up : low).push(...tri);
  }
  // tampa da ponta
  let cx = 0, cy = 0, cz = 0; for (let k = 0; k < R; k++) { const i = at(N, k) * 3; cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2]; }
  const ci = pos.length / 3; pos.push(cx / R, cy / R, cz / R); uv.push(0, 0);
  for (let k = 0; k < R; k++) { const p = at(N, k), q = at(N, k + 1); low.push(...(o.side > 0 ? [ci, q, p] : [ci, p, q])); }
  if (o.cap0) {
    let rx = 0, ry = 0, rz = 0; for (let k = 0; k < R; k++) { const i = at(0, k) * 3; rx += pos[i]; ry += pos[i + 1]; rz += pos[i + 2]; }
    const r0 = pos.length / 3; pos.push(rx / R, ry / R, rz / R); uv.push(0, 0);
    for (let k = 0; k < R; k++) { const p = at(0, k), q = at(0, k + 1); low.push(...(o.side > 0 ? [r0, p, q] : [r0, q, p])); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...up, ...low]); g.addGroup(0, up.length, 0); g.addGroup(up.length, low.length, 1);
  g.computeVertexNormals();
  return g;
}

// junta sólidos de asa preservando os grupos 0 (extradorso) e 1 (intradorso): uma malha, dois draw calls
function mergePair(gs) {
  const P = [], U = [], I = [[], []]; let off = 0;
  for (const g of gs) {
    P.push(...g.attributes.position.array); U.push(...g.attributes.uv.array);
    const idx = g.index.array;
    for (const gr of g.groups) for (let i = gr.start; i < gr.start + gr.count; i++) I[gr.materialIndex].push(idx[i] + off);
    off += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); m.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  m.setIndex([...I[0], ...I[1]]); m.addGroup(0, I[0].length, 0); m.addGroup(I[0].length, I[1].length, 1);
  m.computeVertexNormals(); return m;
}

// Fuselagem em loft: cada estação tem meia-largura, altura do dorso, profundidade do ventre e
// deslocamento da linha central (frações de fuseR; z em fração de L). Seção superelíptica (um pouco
// "quadrada" como chapa sobre cavernas); o dorso segue quase reto até a cauda e o ventre sobe,
// deixando a cauda em lâmina vertical. Grupo 0 = metade de cima (camuflagem), 1 = ventre.
const FUSE = {
  inline: [[-0.5, .05, .1, .08, .4], [-0.44, .14, .22, .2, .34], [-0.32, .34, .46, .42, .24], [-0.16, .6, .74, .7, .1], [0, .8, .96, .9, 0], [0.12, .88, 1, .98, 0], [0.24, .84, .94, 1.02, -.02], [0.34, .74, .84, .96, -.04], [0.41, 'n.9', 'n.92', 'n.98', -.04], [0.46, 'n.5', 'n.5', 'n.55', -.04]],
  radial: [[-0.5, .05, .1, .08, .4], [-0.44, .16, .24, .22, .32], [-0.32, .38, .5, .48, .2], [-0.16, .68, .8, .8, .08], [0, .9, .98, .98, 0], [0.14, .98, 1, 1.02, 0], [0.27, 'n1.02', 'n1.02', 'n1.02', 0], [0.38, 'n1', 'n1', 'n1', 0], [0.43, 'n.94', 'n.94', 'n.94', 0], [0.455, 'n.6', 'n.6', 'n.6', 0]],
  intake: [[-0.53, .44, .46, .44, .06], [-0.46, .52, .56, .52, .08], [-0.34, .68, .76, .7, .06], [-0.18, .86, .96, .9, .03], [0, .98, 1.06, 1, 0], [0.14, 1, 1.06, 1, 0], [0.28, .92, .98, .94, -.02], [0.38, 'n1.04', 'n1.06', 'n1.04', -.02], [0.46, 'n.98', 'n.98', 'n.98', -.02]],
};
function fuselage(D) {
  const L = D.L, fr = D.fuseR, nr = D.noseR / fr, kind = D.jet ? 'intake' : D.cowl === 'radial' ? 'radial' : 'inline';
  const belly = D.key === 'p47' ? 1.18 : D.key === 'mig15' ? 1.06 : 1, tall = D.key === 'f86' ? 1.06 : 1;
  const st = (D.fuse || FUSE[kind]).map(r => r.map((v, i) => (typeof v === 'string' ? nr * +v.slice(1) : v) * (i === 3 ? (r[0] < 0.3 ? belly : 1) : i === 2 ? tall : 1)));
  // Catmull-Rom entre estações (suaviza o perfil sem precisar de dezenas de pontos à mão)
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const SEG = 5, rings = [];
  for (let i = 0; i < st.length - 1; i++) for (let k = 0; k < (i === st.length - 2 ? SEG + 1 : SEG); k++) {
    const t = k / SEG, P = j => st[Math.max(0, Math.min(st.length - 1, j))];
    rings.push([0, 1, 2, 3, 4].map(c => cr(P(i - 1)[c], P(i)[c], P(i + 1)[c], P(i + 2)[c], t)));
  }
  // entrada de ar no nariz: o loft continua PARA DENTRO — lábio arredondado e fino que vira o duto
  // (grupo 2, escuro). Antes era um toro grosso encostado num cilindro aberto ("lata").
  const nOut = rings.length, noseIn = D.jet && D.intakes !== 'side';
  if (noseIn) {
    const e = rings[nOut - 1], z = e[0], dz = 0.045 / L * 1;
    for (const [k, sc] of [[0.4, 0.985], [0.2, 0.95], [-0.15, 0.92], [-1, 0.9], [-3, 0.87], [-7, 0.84], [-14, 0.82], [-30, 0.8]])
      rings.push([z + k * dz, e[1] * sc, e[2] * sc, e[3] * sc, e[4]]);
  }
  // jatos: seção elíptica (chapa lisa, arredondada) e mais segmentos; pistão: superelipse de cantos vivos
  const NR = D.jet ? 44 : 32, ex = D.jet ? 1 : 2 / 2.4, pos = [], uv = [], top = [], bot = [], duct = [];
  const z0 = rings[0][0], z1 = rings[nOut - 1][0];
  // UV em metros (como a asa): v ao longo do eixo, u = arco a partir do ventre, espelhado dos dois lados — sem
  // costura, e camuflagem/painéis na mesma escala da asa (antes um só quadro esticava na fuselagem inteira)
  for (const [z, hw, tp, bt, yc] of rings) {
    const per = Math.PI * (Math.max(hw, 0.01) + (tp + bt) / 2) * fr; // perímetro (aprox.) da seção
    for (let k = 0; k <= NR; k++) {
      const a = k / NR * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const x = Math.sign(c) * Math.abs(c) ** ex * Math.max(hw, 0.01), y = (s >= 0 ? tp : bt) * Math.sign(s) * Math.abs(s) ** ex;
      pos.push(x * fr, (y + yc) * fr, z * L); uv.push(Math.acos(Math.max(-1, Math.min(1, -s))) / Math.PI * per * 0.5 * 0.22, z * L * 0.22);
    }
  }
  const row = NR + 1;
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < NR; k++) {
    const a = j * row + k, b = a + 1, c = a + row, d = c + 1;
    (j >= nOut + 1 ? duct : k < NR / 2 ? top : bot).push(a, b, c, b, d, c);
  }
  // tampas: cauda sempre; nariz só nos motores a pistão (o jato tem a entrada de ar aberta)
  const cap = (j, flip) => { const ci = pos.length / 3, r = rings[j]; pos.push(0, r[4] * fr, r[0] * L); uv.push(0.5, j ? 1 : 0); for (let k = 0; k < NR; k++) { const a = j * row + k; (k < NR / 2 ? top : bot).push(...(flip ? [ci, a + 1, a] : [ci, a, a + 1])); } };
  if (!D.jet) { cap(0, false); cap(nOut - 1, true); }
  else if (D.intakes === 'side') cap(nOut - 1, true); // nariz fechado (radome); entradas de ar nas laterais
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...top, ...bot, ...duct]); g.addGroup(0, top.length, 0); g.addGroup(top.length, bot.length, 1); if (duct.length) g.addGroup(top.length + bot.length, duct.length, 2);
  g.computeVertexNormals();
  // fundo do duto (onde fica a face do compressor), em z e meia-largura
  if (noseIn) { const r = rings[rings.length - 1]; g.userData.duct = { z: r[0] * L, hw: r[1] * fr, h: Math.max(r[2], r[3]) * fr, yc: r[4] * fr, lip: rings[nOut - 1][0] * L }; }
  // amostra da seção numa fração z (para insígnias e acessórios encostarem na chapa)
  g.userData.at = zf => { let r = rings[0]; for (const q of rings.slice(0, nOut)) if (q[0] <= zf) r = q; return { hw: r[1] * fr, h: Math.min(r[2], r[3]) * fr, top: (r[2] + r[4]) * fr, yc: r[4] * fr }; };
  return g;
}
// Carenagem da raiz da asa: concordância côncava entre a fuselagem e o dorso (grupo 0) e o ventre (grupo 1) da
// asa, ao longo da corda da raiz e um pouco além do bordo de fuga. o = planta da asa (wingCfg), fa = seção da
// fuselagem (userData.at), R = raio máximo. Cada estação é uma Bézier quadrática fuselagem → canto → asa.
function filletGeometry(o, fa, L, R) {
  const c0 = o.c0, zle = o.zq0 + 0.25 * c0, z0 = zle + 0.06 * c0, z1 = zle - c0 * 1.22, NZ = 18, NU = 7, pos = [], uv = [], up = [], low = [], sd = o.side;
  // meia-largura da fuselagem na altura y (seção ~elíptica)
  const fx = (a, y) => { const hh = y >= a.yc ? a.top - a.yc : a.h; return a.hw * Math.sqrt(Math.max(0, 1 - ((y - a.yc) / Math.max(hh, 0.05)) ** 2)); };
  for (const [g, sgn, kR] of [[up, 1, 1], [low, -1, 0.55]]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NZ; i++) {
      const z = z0 + (z1 - z0) * i / NZ, xc = Math.min(1, Math.max(0, (zle - z) / c0)), a = fa(z / L);
      const t = i / NZ, r = R * kR * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.55 + 0.004; // cresce do bordo de ataque e some depois do de fuga
      const yw = o.y0 + sgn * (yt(xc) * o.t0 * c0 + (sgn > 0 ? 0.012 * c0 * Math.sin(Math.PI * xc) : 0)) * (xc < 1 ? 1 : 0);
      const xw = fx(a, yw), A = [fx(a, yw + sgn * r) - 0.02, yw + sgn * r], C = [xw, yw], B = [xw + r * 1.3, yw - sgn * 0.004];
      for (let k = 0; k <= NU; k++) {
        const u = k / NU, w0 = (1 - u) ** 2, w1 = 2 * u * (1 - u), w2 = u * u;
        const x = w0 * A[0] + w1 * C[0] + w2 * B[0], y = w0 * A[1] + w1 * C[1] + w2 * B[1];
        pos.push(sd * x, y, z); uv.push((y + x) * 0.22, z * 0.22);
      }
    }
    for (let i = 0; i < NZ; i++) for (let k = 0; k < NU; k++) {
      const a = base + i * (NU + 1) + k, b = a + 1, c = a + NU + 1, d = c + 1;
      g.push(...((sd * sgn > 0) ? [a, b, c, b, d, c] : [a, c, b, b, c, d]));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...up, ...low]); g.addGroup(0, up.length, 0); g.addGroup(up.length, low.length, 1); g.computeVertexNormals();
  return g;
}
// tubo em loft de seções superelípticas: secs = [[z, cx, cy, hw, hh]]; ex < 1 deixa a seção "quadrada"
// de cantos redondos (duto de entrada de ar). UV em metros, como o da asa (a camuflagem não estica).
function tubeLoft(secs, ex) {
  const NR = 20, pos = [], uv = [], idx = [];
  for (const [z, cx, cy, hw, hh] of secs) for (let k = 0; k <= NR; k++) {
    const a = k / NR * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), x = cx + Math.sign(c) * Math.abs(c) ** ex * hw, y = cy + Math.sign(s) * Math.abs(s) ** ex * hh;
    pos.push(x, y, z); uv.push((y + x) * 0.22, z * 0.22);
  }
  const row = NR + 1;
  for (let j = 0; j < secs.length - 1; j++) for (let k = 0; k < NR; k++) { const a = j * row + k, b = a + 1, c = a + row, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// pá de hélice: haste redonda na raiz, corda máxima a ~40% (pá "remo" dos anos 40), ponta arredondada;
// seção em perfil (NACA, bordo de ataque no sentido do giro) torcida de ~50° na raiz a ~15° na ponta. Raiz em y = 0.
// t0: começa nessa fração do comprimento (a ponta pintada é o trecho 0,93..1, um pouco mais grossa)
function bladeGeometry(len, cmax = 0.3, t0 = 0, grow = 1) {
  const NS = 16, pos = [], idx = [], R = 2 * NP - 2;
  for (let j = 0; j <= NS; j++) {
    const t = t0 + (1 - t0) * j / NS, y = t * len;
    const c = t < 0.1 ? 0.07 + (cmax * 0.55 - 0.07) * t / 0.1 : t < 0.4 ? cmax * (0.55 + 0.45 * Math.sin((t - 0.1) / 0.3 * Math.PI / 2)) : cmax * Math.sqrt(Math.max(0.02, 1 - ((t - 0.4) / 0.6) ** 2.4));
    const th = t < 0.1 ? 1 : Math.max(0.09, 0.22 - 0.16 * t), tw = 0.9 - 0.65 * t, ct = Math.cos(tw), sn = Math.sin(tw);
    for (let k = 0; k < R; k++) {
      const up = k < NP, xc = up ? XS[k] : XS[R - k], sg = up ? 1 : -1;
      const u = (xc - 0.3) * c, v = t < 0.1 ? sg * Math.sqrt(Math.max(0, 0.25 - (xc - 0.5) ** 2)) * c : sg * yt(xc) * th * c; // raiz: seção redonda
      pos.push((u * ct + v * sn) * grow, y, (v * ct - u * sn) * grow); // bordo de ataque para −x (sentido do giro) e à frente (+z)
    }
  }
  for (let j = 0; j < NS; j++) for (let k = 0; k < R; k++) { const a = j * R + k, b = j * R + (k + 1) % R, c2 = a + R, d = b + R; idx.push(a, c2, b, b, c2, d); }
  const tip = pos.length / 3; pos.push(0, len, 0); for (let k = 0; k < R; k++) idx.push(NS * R + k, tip, NS * R + (k + 1) % R);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
// chapa metálica com painéis e rebites (jatos sem pintura)
let metalTex = null;
// chapa de alumínio: painéis em fiadas desencontradas (como chapas reais), cada painel com tom e
// rugosidade levemente diferentes (o reflexo "quebra" painel a painel), juntas finas e rebites
function metalTexture() {
  if (metalTex) return metalTex;
  const N = 1024, c = document.createElement('canvas'), r = document.createElement('canvas'); c.width = c.height = r.width = r.height = N;
  const g = c.getContext('2d'), q = r.getContext('2d');
  g.fillStyle = '#c3c6c8'; g.fillRect(0, 0, N, N); q.fillStyle = '#5a5a5a'; q.fillRect(0, 0, N, N);
  const rows = 22, rh = N / rows;
  for (let y = 0; y < rows; y++) {
    let x = -Math.random() * 90;
    while (x < N) {
      const w = 70 + Math.random() * 110, t = (Math.random() - 0.5) * 6 | 0, b = Math.random() < 0.15 ? 3 : 0;
      g.fillStyle = `rgb(${195 + t},${198 + t + b},${200 + t + b})`; g.fillRect(x, y * rh, w, rh);
      const rr = 78 + Math.random() * 22 | 0; q.fillStyle = `rgb(${rr},${rr},${rr})`; q.fillRect(x, y * rh, w, rh);
      x += w;
    }
  }
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * .035})`; g.fillRect(Math.random() * N, Math.random() * N, 3, 1); }
  drawPanels(g, N, 'rgba(50,55,60,.26)', 1.2, null); // juntas na mesma planta do relevo
  metalTex = new THREE.CanvasTexture(c); metalTex.colorSpace = THREE.SRGBColorSpace;
  metalRough = new THREE.CanvasTexture(r);
  for (const t of [metalTex, metalRough]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(PANEL_REP, PANEL_REP); }
  return metalTex;
}
let metalRough = null, panelTex = null;
// Painéis da chapa: um só desenho (frações 0..1 do quadro) usado no relevo (bumpMap) e nas juntas pintadas da
// camuflagem, então sulco e linha escura coincidem. O quadro cobre o mesmo que a camuflagem (repeat 0,35 sobre
// UV de 0,22/m ≈ 13 m): fiadas de ~0,55 m, painéis de 0,8–1,6 m, tampas de inspeção com parafusos.
const PANEL_REP = 0.35;
let panelPlan = null;
function panels() {
  if (panelPlan) return panelPlan;
  const rows = 24, out = { rows, segs: [], hatch: [] };
  for (let y = 0; y < rows; y++) {
    let x = -Math.random() * 0.1;
    while (x < 1) {
      const w = 0.06 + Math.random() * 0.06; out.segs.push([x, y / rows]);
      if (Math.random() < 0.16) { const hw = 0.012 + Math.random() * 0.016, hh = 0.25 / rows + Math.random() * 0.3 / rows; out.hatch.push([x + 0.01 + Math.random() * (w - hw - 0.02), y / rows + 0.15 / rows + Math.random() * (0.85 / rows - hh - 0.15 / rows), hw, hh]); }
      x += w;
    }
  }
  return (panelPlan = out);
}
// desenha as juntas num canvas de lado N: col = cor da linha, rivet = cor dos rebites (null = sem), lw = largura
export function drawPanels(g, N, col, lw, rivet) {
  const P = panels(), rh = N / P.rows;
  g.fillStyle = col;
  for (let y = 0; y < P.rows; y++) g.fillRect(0, y * rh, N, lw);
  for (const [x, y] of P.segs) g.fillRect(x * N, y * N, lw, rh);
  g.strokeStyle = col; g.lineWidth = lw;
  for (const [x, y, w, h] of P.hatch) g.strokeRect(x * N, y * N, w * N, h * N);
  if (!rivet) return;
  g.fillStyle = rivet; const rs = Math.max(1.5, N / 900), st = N / 160;
  for (let y = 0; y < P.rows; y++) for (let k = st / 2; k < N; k += st) g.fillRect(k, y * rh + lw * 2.5, rs, rs);
  for (const [x, y] of P.segs) for (let k = st / 2; k < rh - 2; k += st) g.fillRect(x * N + lw * 2.5, y * N + k, rs, rs);
  for (const [x, y, w, h] of P.hatch) for (const [a, b] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) g.fillRect(a * N - rs, b * N - rs, rs * 1.6, rs * 1.6);
}
// relevo (bumpMap): cinza médio = chapa, juntas em sulco, rebites em ressalto
function panelBump() {
  if (panelTex) return panelTex;
  const N = 2048, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
  drawPanels(g, N, '#262626', 3, '#b4b4b4');
  panelTex = new THREE.CanvasTexture(c); panelTex.wrapS = panelTex.wrapT = THREE.RepeatWrapping; panelTex.anisotropy = 8; panelTex.repeat.set(PANEL_REP, PANEL_REP);
  return panelTex;
}

export function buildPlane(D) {
  // modelo glTF carregado para esta aeronave? (modelLibrary.js) — senão, procedural
  if (hasModel(D)) {
    const r = gltfPlane(D, id => missileMesh(MISSILES[id]));
    if (r) { r.gearMesh = buildGear(D, r.root, null, new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: .45, metalness: .5 })); return r; }
  }
  const root = new THREE.Group(), L = D.L, fr = D.fuseR, jet = !!D.jet;
  // jato sem pintura (metal) a menos que a ficha peça camuflagem (def.finish = 'camo')
  const metal = jet && D.finish !== 'camo';
  const paint = metal
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, map: metalTexture(), roughnessMap: metalRough, bumpMap: panelBump(), bumpScale: 1.2, roughness: 0.7, metalness: 0.82 })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, map: camoTexture(D, (g, n) => drawPanels(g, n, 'rgba(20,18,12,.32)', 1, null)), bumpMap: panelBump(), bumpScale: 1.6, roughness: 0.58, metalness: 0.18 });
  const under = metal ? paint : new THREE.MeshStandardMaterial({ color: D.underColor || (D.key === 'il2' ? 0x6f8aa0 : D.key === 'fw190' ? 0x9aa3a6 : D.key === 'spit9' ? 0x9ea19a : 0x8d8c80), bumpMap: panelBump(), bumpScale: 1.6, roughness: .6, metalness: .2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: .45, metalness: .5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x3a4c58, roughness: .05, metalness: .9, transparent: true, opacity: .62 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: .7 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: .7 });
  const accent = new THREE.MeshStandardMaterial({ color: D.nation === 'URSS' ? 0xa8231b : D.nation === 'Alemanha' ? 0xc9b440 : D.nation === 'Reino Unido' ? 0xc9c2a8 : 0x23305a, roughness: .55, metalness: .2 });
  const pair = [paint, under];
  // materiais dos detalhes (planeDetail.js): todos MeshStandard sem textura — mesmo programa dos de cima
  const lamp = (c, e) => new THREE.MeshStandardMaterial({ color: c, emissive: e, emissiveIntensity: 1.6, roughness: .3 });
  const DM = { dark, glass, skin: paint, tank: paint, steel: new THREE.MeshStandardMaterial({ color: 0x5b5d5f, roughness: .35, metalness: .85 }),
    heat: new THREE.MeshStandardMaterial({ color: 0x6e6152, roughness: .42, metalness: .85 }), soot: new THREE.MeshStandardMaterial({ color: 0x141312, roughness: .9, metalness: .2 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xd8b21c, roughness: .55 }), dial: new THREE.MeshStandardMaterial({ color: 0xc9c9bd, roughness: .4 }),
    red: lamp(0xff3020, 0xc01008), green: lamp(0x30ff60, 0x08b030), white: lamp(0xffffff, 0x9a9a9a) };
  const nozzles = [], stacks = [];
  const add = (g, m, p = root, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; p.add(o); return o; };
  // fuselagem, coberta inferior e nariz
  const ductM = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: .55, metalness: .6 });
  const fuseG = fuselage(D); add(fuseG, [paint, under, ductM]);
  const sideIn = jet && D.intakes === 'side', duct = fuseG.userData.duct;
  if (jet) {
    if (duct) {
      // fundo do duto: face do compressor (as pás giram no grupo `prop`), divisória do MiG-15, radar telemétrico do F-86
      add(new THREE.CircleGeometry(duct.hw * 1.04, 24), ductM, root, 0, duct.yc, duct.z + 0.01);
      if (D.key === 'mig15') { const sl = duct.lip - 0.12 - duct.z; add(new THREE.BoxGeometry(0.03, duct.h * 1.9, sl), paint, root, 0, duct.yc, duct.z + sl / 2); }
      if (D.key === 'f86') { const r = add(new THREE.CapsuleGeometry(0.1, 0.35, 4, 10).rotateX(Math.PI / 2), paint, root, 0, duct.yc + duct.h * 0.72, duct.z + 0.75); r.scale.y = 0.8; }
    } else {
      // radome em ogiva (curto, como o do APQ-120) e entradas laterais em loft, com placa separadora da camada-limite
      const at = fuseG.userData.at, an = at(0.449), R = an.hw * 0.97, RL = L * 0.1, prof = [];
      for (let i = 0; i <= 14; i++) { const t = i / 14; prof.push(new THREE.Vector2(Math.max(R * Math.pow(1 - t, 0.6) * (1 + 0.12 * Math.sin(Math.PI * t)), 0.001), t * RL)); } // ogiva com ponta
      add(new THREE.LatheGeometry(prof, 28).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6a6e66, roughness: .55 }), root, 0, an.yc, L * 0.45 - 0.02);
      const zf = L * 0.2, zb = -L * 0.07;
      for (const s of [1, -1]) {
        const secs = [];
        for (let i = 0; i <= 10; i++) {
          const t = i / 10, z = zf + (zb - zf) * t, fa = at(z / L), hw = 0.36 - 0.2 * t ** 1.4, hh = 0.56 - 0.2 * t;
          secs.push([z, s * (fa.hw + hw - 0.16 - 0.12 * t), fa.yc - 0.16 + 0.08 * t, hw, hh]);
        }
        add(tubeLoft(secs, 0.38), paint, root);
        const m = secs[0];
        add(new THREE.PlaneGeometry(m[3] * 1.7, m[4] * 1.8), ductM, root, m[1], m[2], m[0] - 0.08);           // boca (fundo escuro)
        add(new THREE.BoxGeometry(0.035, m[4] * 2.15, 0.9), paint, root, s * (at(zf / L).hw + 0.03), m[2], zf + 0.12); // placa separadora
      }
    }
    // tubeiras: uma central ou várias lado a lado (def.nozzles)
    const nn = D.nozzles || 1, tailR = fuseG.userData.at(-0.52).hw, nr = nn > 1 ? fr * 0.36 : tailR * 0.9;
    for (let i = 0; i < nn; i++) {
      const nx = nn > 1 ? (i - (nn - 1) / 2) * nr * 2.1 : 0;
      const ny = nn > 1 ? -fr * 0.15 : 0, ze = -L * 0.53 - 0.3;
      DT.nozzle(add, DM, root, nx, ny, ze, nr, D.nozzle);
      nozzles.push({ x: nx, y: ny, z: ze, r: nr * 0.85 });
    }
  } else {
    if (D.cowl === 'radial') { add(new THREE.TorusGeometry(D.noseR * 0.93, 0.06, 8, 28), dark, root, 0, 0, L * 0.43); add(new THREE.CylinderGeometry(D.noseR * 0.92, D.noseR * 0.98, 0.25, 28, 1, true).rotateX(Math.PI / 2), dark, root, 0, 0, L * 0.22); }
    else for (const s of [1, -1]) for (let i = 0; i < 6; i++) { add(new THREE.BoxGeometry(0.12, 0.09, 0.2), dark, root, s * fr * 0.88, fr * 0.42, L * 0.36 - i * 0.24); stacks.push({ x: s * fr * 0.98, y: fr * 0.42, z: L * 0.36 - i * 0.24 - 0.08, dir: -s * 0.75 }); } // escapamentos
    if (D.cowl === 'radial') for (const s of [1, -1]) for (let i = 0; i < 4; i++) stacks.push({ x: s * fr * 0.9, y: -fr * 0.35 + i * 0.16, z: L * 0.2, dir: -s * 0.3 });
    add(new THREE.CylinderGeometry(fr * 0.25, fr * 0.32, 0.6, 12).rotateX(Math.PI / 2), dark, root, 0, -fr * 0.95, D.key === 'p47' ? L * 0.2 : -L * 0.08); // radiador/tomada de ar ventral
  }
  // cabine: bolha de vidro com montantes
  const cz = jet ? L * 0.24 : D.key === 'il2' ? L * 0.08 : -L * 0.02;
  // capota em gota (perfil próprio por aeronave em def.canopy), assentada no dorso da fuselagem
  const C = Object.assign({ z: cz / L, len: jet ? 2.6 : 2.3, w: 0.5, h: jet ? 0.55 : 0.42, frames: jet ? [0.24] : [0.24, 0.62] }, D.canopy);
  const cAt = fuseG.userData.at(C.z), cy = cAt.top - 0.06, czc = C.z * L;
  add(canopyGeometry(C.len, C.w, C.h, C.flat), glass, root, 0, cy, czc);
  for (const t of C.frames) add(canopyFrame(C.len, C.w, C.h, t, jet ? 0.014 : 0.02, C.flat), jet ? paint : dark, root, 0, cy, czc); // montantes finos, da cor da chapa no jato
  add(new THREE.BoxGeometry(C.w * 1.9, 0.035, 0.04), dark, root, 0, cy + 0.01, czc - C.len / 2 + 0.02); // trilho traseiro
  // piloto sob a capota (capacete branco no jato, de couro no pistão); a hitbox 'pilot' é alinhada a ele (plane.js)
  const pilot = new THREE.Group(), suit = new THREE.MeshStandardMaterial({ color: jet ? 0x5b5f45 : 0x6b5a3e, roughness: .9 });
  const helm = new THREE.MeshStandardMaterial({ color: jet ? 0xd9d8d0 : 0x4a3424, roughness: jet ? .35 : .8 });
  // C.seats: posição de cada tripulante (fração do comprimento da capota, da frente); o primeiro é o piloto
  const visor = jet ? new THREE.MeshStandardMaterial({ color: 0x2e3a40, roughness: .2, metalness: .6 }) : dark;
  const crew = (g, t, dy = 0) => {
    const y = cy + C.h * 0.62 + dy, z = czc + C.len / 2 - t * C.len; g.position.set(0, y, z); root.add(g);
    add(new THREE.SphereGeometry(0.135, 16, 12), helm, g, 0, 0, 0);                                         // capacete
    add(new THREE.BoxGeometry(0.2, 0.06, 0.03), visor, g, 0, 0.0, 0.125);                                   // viseira / óculos
    if (jet) add(new THREE.CylinderGeometry(0.035, 0.05, 0.1, 8).rotateX(Math.PI / 2), black, g, 0, -0.09, 0.12); // máscara de oxigênio
    add(new THREE.CapsuleGeometry(0.17, 0.32, 4, 10), suit, g, 0, -0.42, -0.04);                           // tronco
    // jato: assento ejetável, painel com mostradores e mira; pistão: encosto blindado simples
    if (jet) { DT.seat(add, DM, g, { face: C.face !== false }); DT.panel(add, DM, g, 0.78, 0, C.w * 1.5); if (g === pilot) DT.gunsight(add, DM, g, 0.7, 0); }
    else add(new THREE.BoxGeometry(0.36, 0.55, 0.06), dark, g, 0, -0.2, -0.24);
    for (const o of g.children) o.userData.fx = true; // marcas de bala não grudam no piloto
    return g;
  };
  const seats = C.seats || [0.58];
  crew(pilot, seats[0]);
  for (let i = 1; i < seats.length; i++) crew(new THREE.Group(), seats[i], C.rearDy || 0);
  if (jet) {
    const at = fuseG.userData.at, olive = new THREE.MeshStandardMaterial({ color: 0x3d4130, roughness: .8 });
    // carenagem dorsal só para quem não tem perfil próprio (o perfil def.fuse já desenha o dorso)
    if (!D.fuse) {
      const z0 = cz - 1.25, z1 = -L * 0.36, zm = (z0 + z1) / 2, spine = add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), paint, root, 0, at(zm / L).top - 0.08, zm);
      spine.scale.set(0.2, 0.26, (z0 - z1) / 2);
    }
    if (D.key === 'f86') {
      add(new THREE.BoxGeometry(0.62, 0.02, 1.5), olive, root, 0, at((cz + 1.6) / L).top + 0.005, cz + 1.6); // painel antirreflexo
    }
  }
  // asas (grupos separados para poder perdê-las)
  const ellip = D.key === 'spit9' || D.key === 'p47';
  const dih = (D.dih ?? (jet ? (D.key === 'mig15' ? -2 : 3) : 5.5)) * deg;
  const half = D.span / 2 - fr * 0.55;
  const wingCfg = wingPlan.bind(null, D);
  // superfícies de comando articuladas (fora da fusão de malhas): { pivot, axis, max }
  const surf = {};
  // leva a geometria da deriva (desenhada no plano da asa) para o lugar: gira 90° e sobe até o dorso
  const finXf = (g, o) => g.rotateZ(Math.PI / 2).translate(0, o.lift, 0);
  const hinge = (name, o, s0, s1, cf, parent, max, fin) => {
    const g = wingGeometry(Object.assign({}, o, { sub: { s0, s1, a: cf, b: 1 }, cap0: true }));
    const P0 = new THREE.Vector3(...station(o, s0, cf)), P1 = new THREE.Vector3(...station(o, s1, cf));
    if (fin) { finXf(g, o); for (const P of [P0, P1]) P.set(-P.y, P.x + o.lift, P.z); }
    g.translate(-P0.x, -P0.y, -P0.z);
    const pivot = new THREE.Group(); pivot.position.copy(P0); parent.add(pivot);
    add(g, fin ? paint : pair, pivot);
    const axis = P1.sub(P0).normalize(); if ((fin ? axis.y : axis.x) < 0) axis.negate();
    surf[name] = { pivot, axis, max: max * deg, base: new THREE.Quaternion() };
  };
  // superfície fixa sem o bordo de fuga onde há comando: a parte da frente inteira + os trechos de bordo de fuga
  // fixos entre os comandos, tudo numa malha; cada comando vira uma peça articulada (hinge)
  // r0..r1: trecho da envergadura (a asa vem em dois pedaços: raiz e ponta, que se solta sozinha)
  const cutSurface = (o, cf, moving, parent, fin, r0 = 0, r1 = 1) => {
    const gs = [wingGeometry(Object.assign({}, o, { sub: { s0: r0, s1: r1, a: 0, b: cf }, cap0: r0 > 0 }))];
    const sp = moving.map(m => [m[1], m[2]]).sort((p, q) => p[0] - q[0]);
    let s0 = r0;
    for (const [a, b] of [...sp, [r1, r1]]) { if (a - s0 > 0.005) gs.push(wingGeometry(Object.assign({}, o, { sub: { s0, s1: a, a: cf, b: 1 }, cap0: true }))); s0 = Math.max(s0, b); }
    const g = mergePair(gs); if (fin) finXf(g, o);
    const mesh = add(g, fin ? paint : pair, parent);
    for (const [name, a, b, max] of moving) hinge(name, o, a, b, cf, parent, max, fin);
    return mesh;
  };
  // asa = raiz (grupo da asa) + ponta (filho dela: quebra sozinha ou vai junto com a asa inteira)
  const sB = tipBreak(D);
  const wing = side => {
    const grp = new THREE.Group(); root.add(grp);
    const tip = new THREE.Group(); grp.add(tip); grp.userData.tip = tip;
    const o = wingCfg(side), sd = side > 0 ? 'L' : 'R', A = D.ail || SURF.ail, F = D.flap || SURF.flap;
    const mv = [['ail' + sd, A[0], A[1], 20], ['flap' + sd, F[0], F[1], 40]], inner = m => (m[1] + m[2]) / 2 < sB;
    cutSurface(o, SURF.cf, mv.filter(inner), grp, false, 0, sB);
    cutSurface(o, SURF.cf, mv.filter(m => !inner(m)), tip, false, sB, 1);
    if (D.stripes) for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.3, 0.02, D.chord * 0.86), i % 2 ? black : white, grp, side * (fr + 1.0 + i * 0.3), -fr * 0.25 - 0.17 + (1 + i * 0.3) * Math.tan(dih), D.wingZ - D.chord * 0.2);
    if (D.key === 'mig15') for (const k of [0.38, 0.7]) { const p = station(o, k, 0.5); add(new THREE.BoxGeometry(0.03, 0.18, chordAt(o, k) * 0.9), paint, k < sB ? grp : tip, p[0], p[1] + 0.1, p[2]); } // cercas aerodinâmicas
    if (D.key === 'spit9') add(new THREE.BoxGeometry(0.45, 0.22, 1.1), paint, grp, side * (fr + 1.0), -fr * 0.25 - 0.22, D.wingZ - 0.4); // radiadores sob a asa
    DT.navLight(add, DM, tip, station(o, 1, 0.3), side); // luz de navegação (vermelha à esquerda, verde à direita)
    return grp;
  };
  const wingL = wing(1), wingR = wing(-1);
  // carenagem da raiz (fica na fuselagem: a asa que cai deixa a carenagem)
  for (const sd of [1, -1]) add(filletGeometry(wingCfg(sd), fuseG.userData.at, L, Math.min(0.55, Math.max(0.18, D.chord * (jet ? 0.1 : 0.14)))), pair, root);
  // ---- canhões (def.guns[i].mount): canos, carenagens, casulos, calhas; a boca é o ponto de tiro (gunPts) ----
  const at = fuseG.userData.at, steel = new THREE.MeshStandardMaterial({ color: 0x2b2c2d, roughness: .4, metalness: .8 });
  const secY = (a, ay) => (ay >= 0 ? a.yc + ay * (a.top - a.yc) : a.yc + ay * a.h);
  const tube = (r0, r1, len, m, x, y, zTip) => add(new THREE.CylinderGeometry(r1, r0, len, 12).rotateX(Math.PI / 2), m, root, x, y, zTip - len / 2); // r1 = ponta
  const gunPts = (D.guns || []).map(g => {
    const M = g.mount; if (!M) return null;
    const a = at(M.zf), z = M.zf * L;
    return M.b.map(([ax, ay]) => {
      let x = ax * a.hw, y = secY(a, ay);
      if (M.pod) { // casulo sob a fuselagem: corpo, ponta afinando e boca escura
        y = a.yc - a.h - M.pod.r * 0.55;
        tube(M.pod.r * 0.85, M.pod.r, M.pod.len, paint, x, y, z - 0.25);
        tube(M.pod.r, M.pod.r * 0.7, 0.25, paint, x, y, z);
        add(new THREE.CircleGeometry(M.pod.r * 0.66, 16), black, root, x, y, z + 0.002);
        add(new THREE.BoxGeometry(0.06, a.yc - a.h - y + 0.05, M.pod.len * 0.7), paint, root, x, (y + a.yc - a.h) / 2 + 0.02, z - M.pod.len * 0.55); // pilone
      }
      if (M.fair) tube(M.fair.r * 0.9, M.fair.r * 0.7, M.fair.len, paint, x, y, z);       // carenagem do cano
      if (M.port) add(new THREE.BoxGeometry(0.07, 0.09, 0.5), black, root, x - Math.sign(x) * 0.02, y, z - 0.2); // calha escura
      const tip = z + M.len, bl = Math.max(M.len, 0) + 0.45;
      if (M.cluster) for (let i = 0; i < M.cluster; i++) { const t = i / M.cluster * Math.PI * 2; tube(M.r, M.r, bl, steel, x + Math.cos(t) * M.rr, y + Math.sin(t) * M.rr, tip); }
      else for (const dx of M.twin ? [-M.twin / 2, M.twin / 2] : [0]) {
        tube(M.r * 1.25, M.r, bl, steel, x + dx, y, tip);
        if (M.brake) tube(M.r * 1.5, M.r * 1.5, 0.2, steel, x + dx, y, tip);           // freio de boca
        add(new THREE.CircleGeometry(M.r * 0.6, 10), black, root, x + dx, y, tip + 0.002);
      }
      if (M.blast) add(new THREE.BoxGeometry(0.012, 0.62, 1.1), steel, root, x - Math.sign(x) * 0.03, a.yc + 0.05, z - 0.45); // painel anti-sopro
      return [x, y, tip + 0.1];
    });
  });
  // ---- freios aerodinâmicos (def.brake): painel articulado na borda dianteira + vão escuro por baixo ----
  const brakes = [];
  for (const b of D.brake || []) {
    const sd = Math.sign(b.ax) || 0, side = b.open === 'side';
    let x, y, z, par = root;
    if (b.ws != null) { const o = wingCfg(sd), p = station(o, b.ws, b.cf), c = chordAt(o, b.ws); x = p[0]; z = p[2] + b.len / 2; y = p[1] - (o.t0 + (o.t1 - o.t0) * b.ws) * c * 0.5 - 0.02; par = sd > 0 ? wingL : wingR; }
    else { const a = at(b.zf); x = b.ax * a.hw; y = secY(a, b.ay); z = b.zf * L + b.len / 2; }
    const piv = new THREE.Group(); piv.position.set(x, y, z); par.add(piv);
    const dims = side ? [0.03, b.w, b.len] : [b.w, 0.03, b.len];
    add(new THREE.BoxGeometry(...dims).translate(0, 0, -b.len / 2), side ? paint : under, piv);
    add(new THREE.BoxGeometry(...dims), ductM, par, x - (side ? sd * 0.03 : 0), y + (side ? 0 : 0.03), z - b.len / 2); // vão
    brakes.push({ pivot: piv, axis: side ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), max: -(side ? sd : 1) * b.deg * deg });
  }
  // empenagem: estabilizador e deriva também com perfil
  const tail = new THREE.Group(); root.add(tail);
  const finH = L * 0.17;
  for (const s of [1, -1]) {
    const o = tailCfg(D, s), sd = s > 0 ? 'L' : 'R';
    if (D.stab === 'all') {
      // estabilizador todo móvel: a metade inteira gira num eixo lateral a ~40% da corda da raiz
      const P0 = new THREE.Vector3(...station(o, 0, 0.4)), pivot = new THREE.Group(); pivot.position.copy(P0); tail.add(pivot);
      add(wingGeometry(o).translate(-P0.x, -P0.y, -P0.z), pair, pivot);
      surf['elev' + sd] = { pivot, axis: new THREE.Vector3(1, 0, 0), max: 12 * deg, base: new THREE.Quaternion() };
    } else cutSurface(o, 0.68, [['elev' + sd, 0.04, 0.95, 25]], tail);
  }
  cutSurface(finCfg(D), 0.7, [['rud', 0.1, 0.95, 25]], tail, true);
  add(new THREE.BoxGeometry(0.06, finH * 0.32, 0.04), accent, tail, 0, fr * 0.6 + finH * 0.82, -L * 0.43 - finH * Math.tan((jet ? 45 : 18) * deg) * 0.85); // faixa da deriva
  // hélice / entrada de ar (a física gira este grupo; o último filho some com o motor parado)
  const prop = new THREE.Group(); prop.position.set(0, duct ? duct.yc : 0, duct ? duct.z + 0.04 : L * 0.45 + (jet ? 0.05 : 0.3)); root.add(prop);
  if (jet && D.shockCone) {
    // cone de choque (radome do RP-22): base dentro do duto, degrau do cone móvel e ponta em ogiva
    const R = D.noseR * 0.64, z0 = L * 0.45 - 0.45, pts = [V2(0.001, z0 - 0.02), V2(R * 0.98, z0), V2(R, z0 + 0.3), V2(R * 0.93, z0 + 0.62), V2(R * 0.86, z0 + 0.64)];
    for (let i = 1; i <= 10; i++) { const t = i / 10; pts.push(V2(Math.max(R * 0.86 * (1 - t) ** 1.15, 0.001), z0 + 0.64 + t * 1.15)); }
    add(DT.latheZ(pts, 32), new THREE.MeshStandardMaterial({ color: 0x4a4f4a, roughness: .5, metalness: .3 }), root, 0, 0, 0);
  }
  if (sideIn) prop.add(new THREE.Group()); // sem boca no nariz: o grupo existe só para o contrato (último filho)
  else if (jet) {
    // compressor: cubo e pás (giram com o motor); o último filho é vazio — a pá não some com o motor parado
    const r = duct.hw, fan = new THREE.MeshStandardMaterial({ color: 0x5c5f61, roughness: .35, metalness: .85 });
    add(new THREE.ConeGeometry(r * 0.3, r * 0.55, 18).rotateX(Math.PI / 2), D.shockCone ? dark : paint, prop, 0, 0, r * 0.28);
    const bl = [];
    for (let i = 0; i < 17; i++) bl.push(new THREE.BoxGeometry(r * 0.16, r * 0.72, 0.02).rotateY(0.5).translate(0, r * 0.62, 0).rotateZ(i / 17 * Math.PI * 2));
    add(mergeGeometries(bl), fan, prop);
    prop.add(new THREE.Group());
  } else {
    // spinner em ogiva com prato traseiro (antes um cone pequeno sumia dentro do capô)
    const sr = Math.min(D.noseR * 0.62, fr * 0.5), sl = sr * 2.3, sp = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; sp.push(V2(Math.max(sr * Math.cos(t * Math.PI / 2) ** 0.75, 0.001), t * sl)); }
    const spin = D.nation === 'Alemanha' ? black : accent;
    add(DT.latheZ(sp, 28), spin, prop, 0, 0, -0.05);
    add(new THREE.CylinderGeometry(sr * 1.04, sr * 1.04, 0.07, 28).rotateX(Math.PI / 2), dark, prop, 0, 0, -0.07); // prato
    const nb = D.key === 'p47' ? 4 : D.key === 'spit9' ? 4 : 3, len = D.key === 'p47' ? 1.95 : 1.65, cmax = D.key === 'p47' ? 0.36 : 0.3;
    // pá preto-fosco com a ponta pintada (amarela; vermelha na URSS), que nasce dentro do spinner
    const bl = len - sr * 0.4, bg = bladeGeometry(bl, cmax), tipG = bladeGeometry(bl, cmax, 0.93, 1.03);
    for (let i = 0; i < nb; i++) { const b = add(bg, dark, prop); b.rotation.z = i / nb * Math.PI * 2; b.translateY(sr * 0.4); add(tipG, D.nation === 'URSS' ? accent : DM.yellow, b); }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(len + 0.05, 32), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
    prop.add(disc);
  }
  // pontos duros: bombas, foguetes e mísseis
  const bombMeshes = [];
  for (const b of D.bombs) for (let i = 0; i < b.n; i++) {
    const m = add(new THREE.CylinderGeometry(b.d / 2, b.d / 2, b.d * 4.5, 12).rotateX(Math.PI / 2), dark, root, b.x[i] || 0, -fr - b.d / 2 - .05, D.wingZ - .2);
    add(new THREE.ConeGeometry(b.d / 2, b.d, 12).rotateX(Math.PI / 2), dark, m, 0, 0, b.d * 2.7);
    bombMeshes.push(m);
  }
  const rocketMeshes = [];
  if (D.rockets) for (let i = 0; i < D.rockets.n; i++) {
    const side = i % 2 ? -1 : 1, k = Math.floor(i / 2);
    rocketMeshes.push(add(new THREE.CylinderGeometry(.06, .06, 1.4, 8).rotateX(Math.PI / 2), dark, root, side * (D.span * 0.22 + k * 0.45), -.3, D.wingZ + .2));
  }
  // mísseis por estante (def.missiles = [{ w, n, belly? }]); dimensões do próprio míssil.
  // belly: semiembutidos sob a fuselagem (Sparrow do F-4); senão pilones sob a asa, de dentro para fora
  const missileMeshes = []; let wk = 0;
  for (const rk of D.missiles || []) {
    const M = MISSILES[rk.w], r = M.d / 2, belly = rk.belly ?? (M.mass > 150 && D.L > 15);
    for (let i = 0; i < rk.n; i++) {
      const side = i % 2 ? -1 : 1;
      let x, y, z, par = root;
      if (belly) { const k = Math.floor(i / 2); x = side * fr * 0.5; y = -fr * 0.92; z = D.wingZ + 1.2 - k * (M.len + 0.6); }
      else {
        // pilone + trilho presos ao intradorso na estação da asa (antes ficavam flutuando à frente do bordo de ataque)
        const k = Math.floor(wk++ / 2), o = wingCfg(side), sw = Math.min(Math.max((D.span * (0.24 + 0.1 * k) - o.x0) / o.half, 0.15), 0.8);
        const c = chordAt(o, sw), p0 = station(o, sw, 0.42), tw = (o.t0 + (o.t1 - o.t0) * sw) * c * 0.5, ph = 0.1 + r * 0.6;
        par = sw > sB ? (side > 0 ? wingL : wingR).userData.tip : side > 0 ? wingL : wingR;
        x = p0[0]; y = p0[1] - tw - ph - r; z = p0[2] + M.len * 0.06;
        add(new THREE.BoxGeometry(0.07, ph + 0.04, Math.min(c * 0.55, M.len * 0.5)), paint, par, x, p0[1] - tw - ph / 2 + 0.02, p0[2]);     // pilone
        add(new THREE.BoxGeometry(0.09, 0.05, M.len * 0.62), dark, par, x, y + r + 0.02, z);                                              // trilho de lançamento
      }
      const m = add(missileGeometry(M), MSL_MATS, par, x, y, z);
      missileMeshes.push(m);
    }
  }
  // pitot: ponta da asa (pistão: esquerda; F-86/MiG-15: direita) ou haste sobre o nariz (MiG-21); o F-4 tem o dele no radome
  const pit = new THREE.CylinderGeometry(0.015, 0.02, 0.9, 5).rotateX(Math.PI / 2);
  if (D.shockCone) { const a = fuseG.userData.at(0.44); add(new THREE.CylinderGeometry(0.022, 0.04, 1.5, 6).rotateX(Math.PI / 2), paint, root, 0, a.top - 0.1, L * 0.46 + 0.55); }
  else if (!sideIn) { const sd = jet ? -1 : 1, q = station(wingCfg(sd), 0.97, 0); add(pit, dark, (sd > 0 ? wingL : wingR).userData.tip, q[0], q[1], q[2] + 0.35); }
  // insígnias assentadas no extradorso (estação da asa + meia espessura), no pedaço da asa onde caem
  const ws = 0.68, oL = wingCfg(1), cw = chordAt(oL, ws), wp = station(oL, ws, 0.45), wt = (oL.t0 + (oL.t1 - oL.t0) * ws) * cw;
  const wg = ws > sB ? [wingL.userData.tip, wingR.userData.tip] : [wingL, wingR];
  planeDecals(D, root, wg[0], wg[1], { y: wp[1] + wt * 0.5 + 0.012 * cw + 0.012, x: wp[0], z: wp[2], size: Math.min(cw * 0.62, 1.6), fuseAt: fuseG.userData.at });
  // trem de pouso (aparece com o trem baixado; o hangar também usa)
  // detalhes por dados (planeDetail.js): luz da cauda, anticolisão, antenas, tanques externos, gancho
  DT.tailLight(add, DM, tail, D); DT.beacons(add, DM, root, D, at); DT.antennas(add, DM, root, tail, D, at);
  DT.drops(add, DM, root, D, at, wingCfg, wingL, wingR, sB); DT.hook(add, DM, root, D, at);
  const gear = buildGear(D, root, wingCfg, dark, under);
  // efeitos presos ao avião (chama da PC, fogo do WEP, cone de vapor) — fora da fusão de malhas
  const fx = buildPlaneFx(D, root, nozzles, stacks);
  // une as peças estáticas por material (menos draw calls); superfícies que se soltam ou somem ficam à parte
  const keep = new Set([...bombMeshes, ...rocketMeshes, ...missileMeshes]);
  for (const grp of [root, wingL, wingR, wingL.userData.tip, wingR.userData.tip, tail]) mergeStatic(grp, keep);
  root.traverse(o => { if (o.isMesh) o.userData.normalMat = o.material; });
  return { root, wingL, wingR, tipL: wingL.userData.tip, tipR: wingR.userData.tip, tail, prop, bombMeshes, rocketMeshes, missileMeshes, mats: [paint, under], fx, surf, gearMesh: gear, fuseAt: fuseG.userData.at, gunPts, brakes, pilotMesh: pilot };
}
// Trem de pouso: pernas principais na asa, bequilha (pistão) ou trem do nariz (jato). userData.lift = altura
// do CG ao chão com o trem baixado; userData.pitch = atitude parado (cauda baixa no pistão).
export function buildGear(D, root, wingCfg, mat, doorM = mat) {
  const g = new THREE.Group(); g.visible = false; root.add(g);
  const lift = D.fuseR + 1.35, tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: .9 });
  // cada perna é um pivô no ponto de fixação: recolhe girando (principais para dentro, nariz para a frente,
  // bequilha para trás); userData.anim(k) põe o trem em k (0 recolhido, 1 baixado)
  const mk = (geo, m, par, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; par.add(o); return o; };
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: .18, metalness: 1 }), hubM = new THREE.MeshStandardMaterial({ color: 0x8d8f8c, roughness: .5, metalness: .7 });
  // tubo entre dois pontos (braço de arrasto, tesoura)
  const rod = (par, a, b, rr, m) => { const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(); const o = mk(new THREE.CylinderGeometry(rr, rr, L, 6), m, par, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return o; };
  // roda: pneu com perfil redondo (toro), aro, disco de freio e calota
  const wheel = (par, x, y, z, r, w) => {
    const tb = Math.min(w / 2, r * 0.32);
    mk(new THREE.TorusGeometry(r - tb, tb, 10, 28).rotateY(Math.PI / 2), tire, par, x, y, z);
    mk(new THREE.CylinderGeometry(r - tb * 1.2, r - tb * 1.2, w * 0.8, 20).rotateZ(Math.PI / 2), hubM, par, x, y, z);           // aro
    mk(new THREE.CylinderGeometry(r * 0.3, r * 0.3, w + 0.03, 12).rotateZ(Math.PI / 2), mat, par, x, y, z);                     // cubo
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; mk(new THREE.BoxGeometry(w * 0.84, 0.025, 0.025), mat, par, x, y + Math.sin(a) * r * 0.45, z + Math.cos(a) * r * 0.45); } // parafusos/raios
  };
  // perna oleopneumática: cilindro fixo + haste cromada e roda num grupo que sobe quando o amortecedor comprime
  const slides = [];
  const strut = (x, z, len, rad, r, w, door, fork) => {
    const p = new THREE.Group(); p.position.set(x, 0, z); g.add(p);
    const ol = len * 0.4, cyl = len - ol * 0.55, wy = -len - r * 0.9;
    mk(new THREE.CylinderGeometry(rad, rad * 1.15, cyl, 10), mat, p, 0, -cyl / 2, 0);                          // cilindro
    mk(new THREE.CylinderGeometry(rad * 1.35, rad * 1.35, 0.06, 10), mat, p, 0, -cyl + 0.03, 0);               // colar do retentor
    rod(p, [0, -len * 0.12, 0], [0, -len * 0.02, -len * 0.5], rad * 0.45, mat);                                // braço de arrasto
    const s = new THREE.Group(); p.add(s); slides.push([s, ol * 0.5]);
    mk(new THREE.CylinderGeometry(rad * 0.62, rad * 0.62, ol, 10), chrome, s, 0, -len + ol / 2, 0);            // haste cromada
    // tesoura de torque: dois braços em V na frente da perna
    rod(p, [0, -cyl + 0.02, 0], [0, -cyl - ol * 0.25, rad * 2.6], rad * 0.3, mat);
    rod(s, [0, -cyl - ol * 0.25, rad * 2.6], [0, -len + 0.03, rad * 0.4], rad * 0.3, mat);
    if (fork) { // garfo do trem do nariz: duas placas dos lados da roda
      for (const sx of [1, -1]) mk(new THREE.BoxGeometry(0.03, r * 1.3, r * 0.5), mat, s, sx * (w / 2 + 0.03), wy + r * 0.55, 0);
      mk(new THREE.BoxGeometry(w + 0.1, 0.05, r * 0.5), mat, s, 0, wy + r * 1.2, 0);
    } else mk(new THREE.CylinderGeometry(rad * 0.7, rad * 0.7, w * 0.7, 8).rotateZ(Math.PI / 2), mat, s, Math.sign(x) * w * 0.35, wy, 0); // eixo
    wheel(s, 0, wy, 0, r, w);
    if (door) mk(new THREE.BoxGeometry(0.025, len * 0.62, Math.max(0.5, r * 1.9)), doorM, p, door * (rad + 0.12), -len * 0.36, 0); // porta presa à perna (cor da barriga)
    return p;
  };
  const mz = D.wingZ + 0.4, mx = D.span * 0.16, mr = D.jet ? 0.36 : 0.4, legs = [];
  for (const s of [1, -1]) legs.push([strut(s * mx, mz, lift - mr * 1.9, 0.07, mr, 0.2, s), 'z', -s]);
  const nz = D.jet ? D.L * 0.33 : -D.L * 0.46, nl = D.jet ? lift : lift * 0.45, nr = D.jet ? 0.28 : 0.17;
  legs.push([strut(0, nz, nl - nr * 1.9, 0.06, nr, 0.14, 0, D.jet), 'x', D.jet ? -1 : 1]);
  g.userData.anim = k => { const a = (1 - k) * Math.PI / 2; for (const [p, ax, sg] of legs) p.rotation[ax] = sg * a; };
  // c: compressão do amortecedor 0..1 (peso parado ≈ 0,35; toque forte → 1)
  g.userData.squash = c => { for (const [s, t] of slides) s.position.y = c * t; };
  g.userData.travel = slides[0][1]; // curso do trem principal: o corpo desce isso com o amortecedor todo comprimido
  g.userData.lift = lift; g.userData.pitch = D.jet ? 0 : Math.atan2(lift - nl, D.L * 0.46 + mz) * 0.9;
  g.userData.mainZ = mz; g.userData.noseZ = nz;
  return g;
}
// Funde filhos diretos de `grp` que são malhas simples (sem filhos, material único, sem espelhamento)
// em uma malha por material. Reduz ~70 malhas de um jato para ~20 (e o mesmo na passada de sombra).
const _MERGE_ATTR = ['position', 'normal', 'uv'];
function mergeStatic(grp, keep) {
  const buckets = new Map();
  for (const o of grp.children) {
    if (!o.isMesh || keep.has(o) || o.userData.fx || o.children.length || Array.isArray(o.material) || !o.geometry.index) continue;
    o.updateMatrix(); if (o.matrix.determinant() < 0) continue;
    const g = o.geometry.clone().applyMatrix4(o.matrix);
    if (!_MERGE_ATTR.every(k => g.attributes[k])) continue;
    for (const k of Object.keys(g.attributes)) if (!_MERGE_ATTR.includes(k)) g.deleteAttribute(k);
    g.clearGroups();
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push([o, g]);
  }
  for (const [mat, list] of buckets) {
    if (list.length < 2) continue;
    const merged = mergeGeometries(list.map(x => x[1]));
    if (!merged) continue;
    for (const [o] of list) grp.remove(o);
    const m = new THREE.Mesh(merged, mat); m.castShadow = m.receiveShadow = true; grp.add(m);
  }
}
// ---------- mísseis ----------
// Materiais ÚNICOS para todo míssil (no pilone e em voo), sem textura: mesmos parâmetros dos materiais lisos
// dos aviões, então reaproveitam programas já compilados — nenhum shader novo aparece no disparo.
// Índices: 0 corpo, 1 domo de vidro (IR), 2 faixa amarela (ogiva), 3 faixa marrom (motor), 4 bocal escuro, 5 radome
export const MSL_MATS = [
  new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: .55, metalness: .1 }),
  new THREE.MeshStandardMaterial({ color: 0x3a4c58, roughness: .05, metalness: .9, transparent: true, opacity: .62 }),
  new THREE.MeshStandardMaterial({ color: 0xd9a514, roughness: .6, metalness: .1 }),
  new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: .7, metalness: .1 }),
  new THREE.MeshStandardMaterial({ color: 0x1d1c1a, roughness: .45, metalness: .6 }),
  new THREE.MeshStandardMaterial({ color: 0xb9b6a8, roughness: .5, metalness: .05 }),
];
// forma padrão para míssil sem `form` (proporções de um AIM-9)
const formOf = M => M.form || { nose: { kind: M.seeker === 'sarh' ? 'ogive' : 'ir', len: M.len * 0.1, dome: 0.55 }, canards: { at: M.len * 0.1, root: M.len * 0.09, tip: M.len * 0.015, span: M.d * 3.5 },
  wings: { at: M.len * 0.84, root: M.len * 0.14, tip: M.len * 0.05, span: M.d * 4.4 }, bands: {}, nozzle: { len: M.len * 0.02, r: 0.8 } };
// superfície em X (4 aletas a 45°): planta trapezoidal com bordo de fuga reto; z0 = bordo de ataque na raiz
function finSet(r, z0, f, t, out) {
  const s = f.span / 2, te = z0 - f.root, sh = new THREE.Shape();
  sh.moveTo(r * 0.9, z0); sh.lineTo(s, te + f.tip); sh.lineTo(s, te); sh.lineTo(r * 0.9, te); sh.closePath();
  // forma no plano (radial, axial) → extrusão na espessura; rotateX(90°) leva y (axial) para +z
  const one = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: true, bevelThickness: t * 0.3, bevelSize: t * 0.3, bevelSegments: 1 }).translate(0, 0, -t / 2).rotateX(Math.PI / 2);
  // rolleron: rodinha na ponta do bordo de fuga, eixo perpendicular à aleta
  const parts = [one];
  if (f.roller) { const rr = f.roller / 2; parts.push(new THREE.CylinderGeometry(rr, rr, t * 3, 14).translate(s - rr * 0.6, 0, te + rr * 0.9)); }
  for (let k = 0; k < 4; k++) for (const p of parts) out.push(p.clone().rotateZ(Math.PI / 4 + k * Math.PI / 2));
}
// míssil inteiro numa geometria só por tipo, com grupos por material (MSL_MATS); centro no meio do comprimento, nariz em +z
const _mslGeo = new Map();
export function missileGeometry(M) {
  if (_mslGeo.has(M)) return _mslGeo.get(M);
  const F = formOf(M), r = M.d / 2, L = M.len, tip = L / 2, tail = -L / 2, nz = F.nozzle || { len: 0.05, r: 0.8 };
  const G = [[], [], [], [], [], []], V = (x, y) => new THREE.Vector2(x, y);
  // corpo torneado: perfis (raio, z) do bocal para o nariz; LatheGeometry gira em y e rotateX(90°) leva y → +z
  const lathe = (pts, seg = 18) => new THREE.LatheGeometry(pts, seg).rotateX(Math.PI / 2);
  const noseL = F.nose.len, body = [V(r * 0.96, tail), V(r, tail + 0.01)];
  if (F.nose.kind === 'ogive') {
    // ogiva tangente: ρ = (r² + l²)/2r; raio a x da ponta = √(ρ² − (l − x)²) + r − ρ
    const rho = (r * r + noseL * noseL) / (2 * r), pts = [];
    for (let i = 0; i <= 12; i++) { const x = noseL * (1 - i / 12); pts.push(V(Math.max(r * 0.04, Math.sqrt(Math.max(0, rho * rho - (noseL - x) ** 2)) + r - rho), tip - x)); }
    pts.push(V(0, tip));
    G[5].push(lathe(pts)); body.push(V(r, tip - noseL));
  } else {
    // buscador IR: cone curto até o domo de vidro hemisférico na ponta
    const rd = r * (F.nose.dome || 0.55), zc = tip - rd, dome = [];
    for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; dome.push(V(Math.max(1e-4, rd * Math.cos(a)), zc + rd * Math.sin(a))); }
    G[1].push(lathe(dome)); body.push(V(r, tip - noseL), V(rd * 1.03, zc - 0.005), V(rd * 0.9, zc));
  }
  G[0].push(lathe(body));
  // faixas pintadas: anéis um pouco acima da pele
  for (const [k, gi] of [['warhead', 2], ['motor', 3]]) { const b = F.bands && F.bands[k]; if (b) G[gi].push(lathe([V(r * 1.006, tip - b.at - b.w), V(r * 1.006, tip - b.at)])); }
  // bocal: tubo escuro com a garganta para dentro
  const rn = r * nz.r;
  G[4].push(lathe([V(rn * 0.55, tail + 0.02), V(rn * 0.85, tail - nz.len * 0.6), V(rn, tail - nz.len), V(rn * 1.04, tail - nz.len), V(r * 0.96, tail + 0.002)]));
  // superfícies: canards (AIM-9/R-3), asas (rollerons nas traseiras do AIM-9/R-3; no meio do corpo no Sparrow), aletas traseiras
  const t = Math.max(0.006, M.d * 0.06);
  for (const k of ['canards', 'wings', 'tails']) if (F[k]) finSet(r, tip - F[k].at, F[k], t, G[0]);
  // une cada grupo e depois todos, com o índice de material certo em cada grupo
  const used = [], list = [];
  G.forEach((arr, i) => {
    if (!arr.length) return;
    const g = mergeGeometries(arr.map(q => { q = q.index ? q.toNonIndexed() : q; q.deleteAttribute('uv'); return q; }));
    used.push(i); list.push(g);
  });
  const g = mergeGeometries(list, true);
  g.groups.forEach((gr, j) => (gr.materialIndex = used[j]));
  g.computeBoundingSphere();
  _mslGeo.set(M, g); return g;
}
export const missileMesh = M => new THREE.Mesh(missileGeometry(M), MSL_MATS);
// distância do centro ao fim do bocal (chama e fumaça saem daí)
export const missileTail = M => M.len / 2 + (formOf(M).nozzle?.len || 0.05);
// ---------- capota ----------
// perfil ao longo do comprimento (t: 0 = para-brisa, 1 = traseira): sobe rápido no para-brisa,
// platô sobre o piloto e afina em gota até a traseira
// f = fim do platô (0,55 na gota; capota longa de dois lugares vai mais longe)
const canProf = (t, f = 0.55) => (t < 0.28 ? Math.sin(t / 0.28 * Math.PI / 2) ** 0.8 : t < f ? 1 : Math.cos((t - f) / (1 - f) * Math.PI / 2) ** 0.7);
function canopyPoint(len, w, h, t, a, out, f) {
  const k = canProf(t, f), wk = Math.max(0.05, 0.55 + 0.45 * Math.min(1, k * 1.4)), c = Math.cos(a), s = Math.sin(a), ex = 0.75;
  out[0] = Math.sign(c) * Math.abs(c) ** ex * w * wk; out[1] = Math.abs(s) ** ex * h * k; out[2] = len / 2 - t * len;
  return out;
}
function canopyGeometry(len, w, h, f) {
  const NL = 18, NA = 14, pos = [], idx = [], P = [0, 0, 0];
  for (let i = 0; i <= NL; i++) for (let j = 0; j <= NA; j++) { canopyPoint(len, w, h, i / NL, j / NA * Math.PI, P, f); pos.push(...P); }
  for (let i = 0; i < NL; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + 1, c = a + NA + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2)); g.computeVertexNormals();
  return g;
}
// montante: tubo fino seguindo a seção da capota na fração t do comprimento
function canopyFrame(len, w, h, t, r = 0.02, f) {
  const pts = []; const P = [0, 0, 0];
  for (let j = 0; j <= 12; j++) { canopyPoint(len, w * 1.006, h * 1.006, t, j / 12 * Math.PI, P, f); pts.push(new THREE.Vector3(...P)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, r, 5, false);
}
