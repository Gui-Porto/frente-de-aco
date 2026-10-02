import * as THREE from 'three';
import { planeDecals, camoTexture } from './paint.js';
import { MISSILES } from '../data/vehicles.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hasModel, gltfPlane } from './modelLibrary.js';
import { buildPlaneFx } from './planeFx.js';
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
const deg = Math.PI / 180;

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
  const NR = 32, ex = 2 / 2.4, pos = [], uv = [], top = [], bot = [], duct = [];
  const z0 = rings[0][0], z1 = rings[nOut - 1][0];
  for (const [z, hw, tp, bt, yc] of rings) for (let k = 0; k <= NR; k++) {
    const a = k / NR * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const x = Math.sign(c) * Math.abs(c) ** ex * Math.max(hw, 0.01), y = (s >= 0 ? tp : bt) * Math.sign(s) * Math.abs(s) ** ex;
    pos.push(x * fr, (y + yc) * fr, z * L); uv.push(k / NR, (z - z0) / (z1 - z0));
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
  if (noseIn) { const r = rings[rings.length - 1]; g.userData.duct = { z: r[0] * L, hw: r[1] * fr, h: Math.max(r[2], r[3]) * fr, yc: r[4] * fr }; }
  // amostra da seção numa fração z (para insígnias e acessórios encostarem na chapa)
  g.userData.at = zf => { let r = rings[0]; for (const q of rings.slice(0, nOut)) if (q[0] <= zf) r = q; return { hw: r[1] * fr, h: Math.min(r[2], r[3]) * fr, top: (r[2] + r[4]) * fr, yc: r[4] * fr }; };
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
// lâmina de hélice afinando para a ponta e torcida
function bladeGeometry(len) {
  const g = new THREE.BoxGeometry(0.26, len, 0.05, 1, 6, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = (y + len / 2) / len, w = 1 - 0.45 * t, tw = (0.55 - 0.45 * t);
    const x = p.getX(i) * w, z = p.getZ(i);
    p.setXYZ(i, x * Math.cos(tw) - z * Math.sin(tw), y + len / 2, x * Math.sin(tw) + z * Math.cos(tw));
  }
  g.computeVertexNormals(); return g;
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
      g.fillStyle = 'rgba(55,60,66,.32)'; g.fillRect(x, y * rh, 1, rh);          // junta vertical
      g.fillStyle = 'rgba(70,74,78,.22)'; for (let k = 6; k < rh - 3; k += 9) g.fillRect(x + 4, y * rh + k, 1.6, 1.6); // rebites
      x += w;
    }
    g.fillStyle = 'rgba(55,60,66,.28)'; g.fillRect(0, y * rh, N, 1);              // junta horizontal
  }
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * .035})`; g.fillRect(Math.random() * N, Math.random() * N, 3, 1); }
  metalTex = new THREE.CanvasTexture(c); metalTex.colorSpace = THREE.SRGBColorSpace;
  metalRough = new THREE.CanvasTexture(r);
  for (const t of [metalTex, metalRough]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return metalTex;
}
let metalRough = null;

export function buildPlane(D) {
  // modelo glTF carregado para esta aeronave? (modelLibrary.js) — senão, procedural
  if (hasModel(D)) {
    const w = new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: .7 }), gl = new THREE.MeshStandardMaterial({ color: 0x3a4c58, roughness: .05, metalness: .9, transparent: true, opacity: .62 });
    const r = gltfPlane(D, id => { const M = MISSILES[id]; return new THREE.Mesh(missileGeometry(M), [w, M.seeker === 'sarh' ? w : gl]); });
    if (r) { r.gearMesh = buildGear(D, r.root, null, new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: .45, metalness: .5 })); return r; }
  }
  const root = new THREE.Group(), L = D.L, fr = D.fuseR, jet = !!D.jet;
  // jato sem pintura (metal) a menos que a ficha peça camuflagem (def.finish = 'camo')
  const metal = jet && D.finish !== 'camo';
  const paint = metal
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, map: metalTexture(), roughnessMap: metalRough, roughness: 0.7, metalness: 0.82 })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, map: camoTexture(D), roughness: 0.58, metalness: 0.18 });
  const under = metal ? paint : D.underColor ? new THREE.MeshStandardMaterial({ color: D.underColor, roughness: .6, metalness: .2 }) : new THREE.MeshStandardMaterial({ color: D.key === 'il2' ? 0x6f8aa0 : D.key === 'fw190' ? 0x9aa3a6 : D.key === 'spit9' ? 0x9ea19a : 0x8d8c80, roughness: .6, metalness: .2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: .45, metalness: .5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x3a4c58, roughness: .05, metalness: .9, transparent: true, opacity: .62 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: .7 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: .7 });
  const accent = new THREE.MeshStandardMaterial({ color: D.nation === 'URSS' ? 0xa8231b : D.nation === 'Alemanha' ? 0xc9b440 : D.nation === 'Reino Unido' ? 0xc9c2a8 : 0x23305a, roughness: .55, metalness: .2 });
  const pair = [paint, under];
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
      if (D.key === 'mig15') add(new THREE.BoxGeometry(0.035, duct.h * 1.75, 1.6), paint, root, 0, duct.yc, duct.z + 0.95);
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
      add(new THREE.CylinderGeometry(nr, nr * 0.9, 0.7, 18, 1, true).rotateX(Math.PI / 2), dark, root, nx, nn > 1 ? -fr * 0.15 : 0, -L * 0.53);
      nozzles.push({ x: nx, y: nn > 1 ? -fr * 0.15 : 0, z: -L * 0.53 - 0.3, r: nr * 0.85 });
      add(new THREE.CircleGeometry(nr * 0.9, 18).rotateY(Math.PI), black, root, nx, nn > 1 ? -fr * 0.15 : 0, -L * 0.52);
    }
    if (D.gunPod) { const g0 = add(new THREE.CylinderGeometry(0.16, 0.2, L * 0.16, 12).rotateX(Math.PI / 2), paint, root, 0, -fr * 0.72, L * 0.31); g0.scale.x = 1.3; add(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6).rotateX(Math.PI / 2), black, root, 0, -fr * 0.72, L * 0.39); } // carenagem do Vulcan sob o queixo
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
  add(canopyGeometry(C.len, C.w, C.h), glass, root, 0, cy, czc);
  for (const t of C.frames) add(canopyFrame(C.len, C.w, C.h, t, jet ? 0.014 : 0.02), jet ? paint : dark, root, 0, cy, czc); // montantes finos, da cor da chapa no jato
  add(new THREE.BoxGeometry(C.w * 1.9, 0.035, 0.04), dark, root, 0, cy + 0.01, czc - C.len / 2 + 0.02); // trilho traseiro
  if (jet) {
    const at = fuseG.userData.at, olive = new THREE.MeshStandardMaterial({ color: 0x3d4130, roughness: .8 });
    // carenagem dorsal só para quem não tem perfil próprio (o perfil def.fuse já desenha o dorso)
    if (!D.fuse) {
      const z0 = cz - 1.25, z1 = -L * 0.36, zm = (z0 + z1) / 2, spine = add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), paint, root, 0, at(zm / L).top - 0.08, zm);
      spine.scale.set(0.2, 0.26, (z0 - z1) / 2);
    }
    if (D.key === 'f86') {
      add(new THREE.BoxGeometry(0.62, 0.02, 1.5), olive, root, 0, at((cz + 1.6) / L).top + 0.005, cz + 1.6); // painel antirreflexo
      for (const sd of [1, -1]) for (let i = 0; i < 3; i++) { const z = L * 0.34, a = at(z / L); add(new THREE.BoxGeometry(0.05, 0.07, 0.28), dark, root, sd * (a.hw * 0.97), a.yc + 0.22 - i * 0.16, z); } // 3 M3 de cada lado
    } else if (D.key === 'mig15') {
      for (const [sd, r, k, dz] of [[1, 0.11, 0.45, 0], [-1, 0.09, 0.35, 0.2], [-1, 0.09, 0.62, -0.3]]) { const a = at(0.3); add(new THREE.CylinderGeometry(r, r * 0.8, 1.6, 10).rotateX(Math.PI / 2), paint, root, sd * a.hw * k, a.yc - a.h * 0.85, L * 0.3 + dz); } // carenagens: N-37 à direita, dois NR-23 à esquerda
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8).rotateX(Math.PI / 2), dark, root, D.noseR * 0.45, -D.noseR * 0.7, L * 0.42); // boca do N-37
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
    const tipY = station(o, 1, 0)[1];
    if (D.stripes) for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.3, 0.02, D.chord * 0.86), i % 2 ? black : white, grp, side * (fr + 1.0 + i * 0.3), -fr * 0.25 - 0.17 + (1 + i * 0.3) * Math.tan(dih), D.wingZ - D.chord * 0.2);
    if (D.key === 'mig15') for (const k of [0.38, 0.7]) { const p = station(o, k, 0.5); add(new THREE.BoxGeometry(0.03, 0.18, chordAt(o, k) * 0.9), paint, k < sB ? grp : tip, p[0], p[1] + 0.1, p[2]); } // cercas aerodinâmicas
    if (D.key === 'spit9') add(new THREE.BoxGeometry(0.45, 0.22, 1.1), paint, grp, side * (fr + 1.0), -fr * 0.25 - 0.22, D.wingZ - 0.4); // radiadores sob a asa
    const nl = station(o, 1, 0.25); add(new THREE.SphereGeometry(0.07, 6, 4), accent, tip, nl[0], tipY, nl[2]); // luz de navegação
    return grp;
  };
  const wingL = wing(1), wingR = wing(-1);
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
  if (jet && D.shockCone) add(new THREE.ConeGeometry(D.noseR * 0.62, D.noseR * 2.2, 24).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a4f4a, roughness: .5, metalness: .3 }), root, 0, 0, L * 0.45 + 0.35); // cone de choque (radar)
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
    add(new THREE.ConeGeometry(fr * 0.36, 0.75, 20).rotateX(Math.PI / 2), D.nation === 'Alemanha' ? black : accent, prop, 0, 0, 0.12); // spinner
    const nb = D.key === 'p47' ? 4 : D.key === 'spit9' ? 4 : 3, len = D.key === 'p47' ? 1.95 : 1.65;
    for (let i = 0; i < nb; i++) { const b = add(bladeGeometry(len), dark, prop); b.rotation.z = i / nb * Math.PI * 2; add(new THREE.BoxGeometry(0.27, 0.12, 0.06), accent, b, 0, len - 0.06, 0); }
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
      const m = add(missileGeometry(M), [white, M.seeker === 'sarh' ? white : glass], par, x, y, z);
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
  const gear = buildGear(D, root, wingCfg, dark);
  // efeitos presos ao avião (chama da PC, fogo do WEP, cone de vapor) — fora da fusão de malhas
  const fx = buildPlaneFx(D, root, nozzles, stacks);
  // une as peças estáticas por material (menos draw calls); superfícies que se soltam ou somem ficam à parte
  const keep = new Set([...bombMeshes, ...rocketMeshes, ...missileMeshes]);
  for (const grp of [root, wingL, wingR, wingL.userData.tip, wingR.userData.tip, tail]) mergeStatic(grp, keep);
  root.traverse(o => { if (o.isMesh) o.userData.normalMat = o.material; });
  return { root, wingL, wingR, tipL: wingL.userData.tip, tipR: wingR.userData.tip, tail, prop, bombMeshes, rocketMeshes, missileMeshes, mats: [paint, under], fx, surf, gearMesh: gear, fuseAt: fuseG.userData.at };
}
// Trem de pouso: pernas principais na asa, bequilha (pistão) ou trem do nariz (jato). userData.lift = altura
// do CG ao chão com o trem baixado; userData.pitch = atitude parado (cauda baixa no pistão).
export function buildGear(D, root, wingCfg, mat) {
  const g = new THREE.Group(); g.visible = false; root.add(g);
  const lift = D.fuseR + 1.35, tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: .9 });
  const wheel = (r, w, x, y, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2), tire); m.position.set(x, y, z); g.add(m); const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.02, 12).rotateZ(Math.PI / 2), mat); h.position.copy(m.position); g.add(h); };
  const leg = (x, z, len, rad) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.2, len, 8), mat); m.position.set(x, -len / 2, z); g.add(m); };
  const mz = D.wingZ + 0.4, mx = D.span * 0.16, mr = D.jet ? 0.36 : 0.4;
  for (const s of [1, -1]) { leg(s * mx, mz, lift - mr, 0.07); wheel(mr, 0.2, s * mx, -lift + mr, mz); const door = new THREE.Mesh(new THREE.BoxGeometry(0.03, lift * 0.55, 0.7), mat); door.position.set(s * (mx + 0.14), -lift * 0.35, mz); g.add(door); }
  const nz = D.jet ? D.L * 0.33 : -D.L * 0.46, nl = D.jet ? lift : lift * 0.45, nr = D.jet ? 0.28 : 0.17;
  leg(0, nz, nl - nr, 0.06); wheel(nr, 0.14, 0, -nl + nr, nz);
  for (const o of g.children) o.castShadow = true;
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
// míssil inteiro (corpo + aletas + nariz) numa geometria só, por tipo; grupo 0 = corpo, 1 = nariz
const _mslGeo = new Map();
export function missileGeometry(M) {
  if (_mslGeo.has(M)) return _mslGeo.get(M);
  const r = M.d / 2, parts = [new THREE.CylinderGeometry(r, r, M.len, 12).rotateX(Math.PI / 2)];
  for (const ro of [Math.PI / 4, -Math.PI / 4]) {
    parts.push(new THREE.BoxGeometry(r * 8, .015, M.len * 0.11).rotateZ(ro).translate(0, 0, -M.len * 0.42));
    parts.push(new THREE.BoxGeometry(r * 5, .015, M.len * 0.06).rotateZ(ro).translate(0, 0, M.len * (M.seeker === 'sarh' ? 0.05 : 0.36)));
  }
  for (const q of parts) q.deleteAttribute('uv');
  const body = mergeGeometries(parts.map(q => q.toNonIndexed()));
  const nose = new THREE.ConeGeometry(r, r * 4, 12).rotateX(Math.PI / 2).translate(0, 0, M.len / 2 + r * 2).toNonIndexed(); nose.deleteAttribute('uv');
  const g = mergeGeometries([body, nose], true);
  _mslGeo.set(M, g); return g;
}
// ---------- capota ----------
// perfil ao longo do comprimento (t: 0 = para-brisa, 1 = traseira): sobe rápido no para-brisa,
// platô sobre o piloto e afina em gota até a traseira
const canProf = t => (t < 0.28 ? Math.sin(t / 0.28 * Math.PI / 2) ** 0.8 : t < 0.55 ? 1 : Math.cos((t - 0.55) / 0.45 * Math.PI / 2) ** 0.7);
function canopyPoint(len, w, h, t, a, out) {
  const k = canProf(t), wk = Math.max(0.05, 0.55 + 0.45 * Math.min(1, k * 1.4)), c = Math.cos(a), s = Math.sin(a), ex = 0.75;
  out[0] = Math.sign(c) * Math.abs(c) ** ex * w * wk; out[1] = Math.abs(s) ** ex * h * k; out[2] = len / 2 - t * len;
  return out;
}
function canopyGeometry(len, w, h) {
  const NL = 18, NA = 14, pos = [], idx = [], P = [0, 0, 0];
  for (let i = 0; i <= NL; i++) for (let j = 0; j <= NA; j++) { canopyPoint(len, w, h, i / NL, j / NA * Math.PI, P); pos.push(...P); }
  for (let i = 0; i < NL; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + 1, c = a + NA + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2)); g.computeVertexNormals();
  return g;
}
// montante: tubo fino seguindo a seção da capota na fração t do comprimento
function canopyFrame(len, w, h, t, r = 0.02) {
  const pts = []; const P = [0, 0, 0];
  for (let j = 0; j <= 12; j++) { canopyPoint(len, w * 1.006, h * 1.006, t, j / 12 * Math.PI, P); pts.push(new THREE.Vector3(...P)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, r, 5, false);
}
