import * as THREE from 'three';
import { planeDecals, camoTexture } from './paint.js';
import { MISSILES } from '../data/vehicles.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hasModel, gltfPlane } from './modelLibrary.js';
import { buildPlaneFx } from './planeFx.js';
import * as DT from './planeDetail.js';
import { buildCockpit } from './planeCockpit.js';
import { gearBays, buildBays, bayColor, fuseBottom, wingY } from './planeBays.js';
import { wingCfg as wingPlan, tailCfg, finCfg, finStation, station, chordAt, tipBreak, SURF, gearPlan } from './planeGeom.js';
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
  const sb = o.sub || { s0: 0, s1: 1, a: 0, b: 1 };
  const tHinge = sb.a > 0 ? 2.15 * yt(sb.a) : 1; // superfície: meia-espessura máxima = a da asa na dobradiça (+ folga)
  // alojamento do trem (o.bay = { xi, xo, za, zb } em |x| e z): estações extras nas bordas da envergadura e, no
  // intradorso, três trechos de corda (frente / vão / trás) com as bordas EXATAMENTE em z = zb e z = za — o furo
  // sai um retângulo limpo em planta; o pedaço tirado vira a porta (userData.bayDoor)
  const bay = o.bay && sb.a === 0 ? o.bay : null, sOf = x => (x - o.x0) / o.half;
  const ss = [];
  for (let j = 0; j <= 14; j++) ss.push(sb.s0 + (sb.s1 - sb.s0) * j / 14);
  let bs0 = 1, bs1 = 0;
  if (bay) {
    bs0 = Math.max(sb.s0, sOf(bay.xi)); bs1 = Math.min(sb.s1, sOf(bay.xo));
    if (bs1 > bs0) {
      for (const v of [bs0, bs1]) { // estação uniforme muito perto da borda vai para a borda (sem tira fininha); as pontas ficam
        const n = ss.reduce((b, q, k) => (Math.abs(q - v) < Math.abs(ss[b] - v) ? k : b), 0);
        if (Math.abs(ss[n] - v) < 0.012 && n > 0 && n < ss.length - 1) ss[n] = v; else if (Math.abs(ss[n] - v) > 1e-6) ss.push(v);
      }
      ss.sort((a, b) => a - b);
    }
  }
  const N = ss.length - 1, NA = 3, NB = 4, NC = 3, NL = bay ? NA + NB - 1 + NC : NP - 2; // pontos internos do intradorso
  const R = NP + NL, pos = [], uv = [], up = [], low = [], door = [];
  const cosSeg = (a, b, n, k) => a + (b - a) * (1 - Math.cos(Math.PI * k / n)) / 2;
  for (let j = 0; j <= N; j++) {
    const s = ss[j];
    const cw = o.ellip ? Math.max(o.c0 * Math.sqrt(1 - Math.min(s, 0.985) ** 2), o.c1 || 0) : o.c0 + (o.c1 - o.c0) * s;
    const zq = o.zq0 - o.sweep * s, zle = zq + 0.25 * cw - sb.a * cw, c = (sb.b - sb.a) * cw, x = o.side * (o.x0 + s * o.half);
    // quebra de diedro opcional (o.brk = { at: fração da envergadura, dih: rad }), ex.: ponta da asa do F-4
    const t = (o.t0 + (o.t1 - o.t0) * s) * cw * tHinge, y = o.y0 + (o.brk && s > o.brk.at ? o.brk.at * o.half * Math.tan(o.dih) + (s - o.brk.at) * o.half * Math.tan(o.brk.dih) : s * o.half * Math.tan(o.dih));
    const ring = [];
    for (let k = 0; k < NP; k++) ring.push([XS[k], 1]);
    if (bay) {
      // do bordo de fuga para a frente: trás (até za), vão (za → zb), frente (zb → bordo de ataque)
      const xa = Math.min(0.97, Math.max(0.04, (zle - bay.za) / c)), xb = Math.min(xa - 0.02, Math.max(0.02, (zle - bay.zb) / c));
      for (let k = 1; k <= NC; k++) ring.push([cosSeg(1, xa, NC, k), -1]);
      for (let k = 1; k < NB; k++) ring.push([xa + (xb - xa) * k / NB, -1]);
      for (let k = 0; k < NA; k++) ring.push([cosSeg(xb, 0, NA, k), -1]);
    } else for (let k = NP - 2; k >= 1; k--) ring.push([XS[k], -1]);
    for (const [xc, sg] of ring) {
      pos.push(x, y + sg * yt(xc) * t + (sg > 0 ? 0.012 * c * Math.sin(Math.PI * xc) : 0), zle - xc * c);
      uv.push(x * 0.22, (zle - xc * c) * 0.22);
    }
  }
  const at = (j, k) => j * R + (k % R), kA = NP - 1 + NC, kB = kA + NB; // quadriláteros do vão: k em [kA, kB)
  for (let j = 0; j < N; j++) for (let k = 0; k < R; k++) {
    const a = at(j, k), b = at(j, k + 1), c = at(j + 1, k), d = at(j + 1, k + 1);
    const tri = o.side > 0 ? [a, c, b, b, c, d] : [a, b, c, b, d, c];
    if (bay && k >= kA && k < kB && ss[j] >= bs0 - 1e-6 && ss[j + 1] <= bs1 + 1e-6) door.push(...tri);
    else (k < NP - 1 ? up : low).push(...tri);
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
  if (door.length) { const d = new THREE.BufferGeometry(); d.setAttribute('position', g.attributes.position.clone()); d.setAttribute('uv', g.attributes.uv.clone()); d.setIndex(door); d.computeVertexNormals(); g.userData.bayDoor = d; }
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
// hole (opcional) = abertura da cabine { z0, z1 (m), hw(z) }: dentro dela os vértices do dorso vão para a borda e
// os quadriláteros todos dentro somem — a chapa termina exatamente no contorno da capota e por baixo fica a cabine
// bays (opcional) = alojamentos do trem no ventre [{ za, zb, xa, xb }] (m, x com sinal): mesma ideia, por baixo — os
// vértices do ventre dentro do retângulo vão para a borda mais próxima e os quadriláteros de dentro viram a porta
// (userData.bayDoors[i])
function fuselage(D, hole, bays = []) {
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
  // seção exata na fração zf (interpolação linear entre anéis), em metros
  let R0 = rings;
  const ringAt = zf => { let i = 0; while (i < R0.length - 2 && R0[i + 1][0] < zf) i++; const a = R0[i], b = R0[i + 1], t = Math.max(0, Math.min(1, (zf - a[0]) / (b[0] - a[0] || 1))); return a.map((v, c) => v + (b[c] - v) * t); };
  // anéis extras nas bordas das aberturas (um fora e um dentro, a 2 mm): borda dianteira/traseira reta
  const edges = [...(hole ? [hole.z0, hole.z1] : []), ...bays.flatMap(b => [b.za, b.zb])];
  for (const zc of edges) for (const e of [-0.002, 0.002]) { const zf = (zc + e) / L; if (zf <= rings[0][0] || zf >= rings[rings.length - 1][0]) continue; const r = ringAt(zf); r[0] = zf; rings.push(r); }
  rings.sort((a, b) => a[0] - b[0]);
  R0 = rings.slice(); // só a parte externa (o duto do nariz é acrescentado depois, voltando em z)
  // entrada de ar no nariz: o loft continua PARA DENTRO — lábio arredondado e fino que vira o duto
  // (grupo 2, escuro). Antes era um toro grosso encostado num cilindro aberto ("lata").
  const nOut = rings.length, noseIn = D.jet && D.intakes !== 'side';
  if (noseIn) {
    const e = rings[nOut - 1], z = e[0], dz = 0.045 / L * 1;
    for (const [k, sc] of [[0.4, 0.985], [0.2, 0.95], [-0.15, 0.92], [-1, 0.9], [-3, 0.87], [-7, 0.84], [-14, 0.82], [-22, 0.8], [-34, 0.78], [-48, 0.76]])
      rings.push([z + k * dz, e[1] * sc, e[2] * sc, e[3] * sc, e[4]]);
  }
  // jatos: seção elíptica (chapa lisa, arredondada) e mais segmentos; pistão: superelipse de cantos vivos
  const NR = D.jet ? 44 : 32, ex = D.jet ? 1 : 2 / 2.4, pos = [], uv = [], top = [], bot = [], duct = [], deep = [];
  const z0 = rings[0][0], z1 = rings[nOut - 1][0];
  // UV em metros (como a asa): v ao longo do eixo, u = arco a partir do ventre, espelhado dos dois lados — sem
  // costura, e camuflagem/painéis na mesma escala da asa (antes um só quadro esticava na fuselagem inteira)
  const inH = [], inB = [];
  rings.forEach(([z, hw, tp, bt, yc], jr) => {
    const per = Math.PI * (Math.max(hw, 0.01) + (tp + bt) / 2) * fr; // perímetro (aprox.) da seção
    const zz = z * L, he = hole && zz > hole.z0 && zz < hole.z1 ? hole.hw(zz) : 0;
    const ringV = [];
    for (let k = 0; k <= NR; k++) {
      const a = k / NR * Math.PI * 2; let c = Math.cos(a), s = Math.sin(a);
      let x = Math.sign(c) * Math.abs(c) ** ex * Math.max(hw, 0.01), y = (s >= 0 ? tp : bt) * Math.sign(s) * Math.abs(s) ** ex;
      const f = he > 0 && s > 0 && Math.abs(x * fr) < he;
      if (f) { // leva o vértice para a borda da abertura, sobre a chapa
        const sg = c < 1e-9 && k * 2 > NR / 2 ? -1 : 1; c = sg * Math.min(1, (he / (Math.max(hw, 0.01) * fr)) ** (1 / ex)); s = Math.sqrt(Math.max(0, 1 - c * c));
        x = Math.sign(c) * Math.abs(c) ** ex * Math.max(hw, 0.01); y = tp * s ** ex;
      }
      ringV.push([x, y, c, s, f]);
    }
    // alojamentos: no ventre, o vértice de dentro mais perto de cada borda vai PARA a borda (os outros ficam onde
    // estão — o pedaço de dentro é a porta e precisa da forma da chapa); todos de dentro marcados com o alojamento
    const W = Math.max(hw, 0.01) * fr, mark = ringV.map(() => -1);
    if (jr < nOut) bays.forEach((B, bi) => {
      if (zz <= B.za || zz >= B.zb) return;
      const ins = []; ringV.forEach((v, k) => { if (v[3] < 0 && v[0] * fr > B.xa && v[0] * fr < B.xb && mark[k] < 0) ins.push(k); });
      if (!ins.length) return;
      ins.sort((a, b) => ringV[a][0] - ringV[b][0]);
      const put = (k, e) => { if (Math.abs(e) >= W) return; const cc = Math.sign(e) * (Math.abs(e) / W) ** (1 / ex), sn = -Math.sqrt(Math.max(0, 1 - cc * cc)); ringV[k] = [Math.sign(cc) * Math.abs(cc) ** ex * Math.max(hw, 0.01), -bt * Math.abs(sn) ** ex, cc, sn, false]; };
      const k0 = ins[0], k1 = ins[ins.length - 1];
      if (k0 === k1) put(k0, ringV[k0][0] * fr - B.xa < B.xb - ringV[k0][0] * fr ? B.xa : B.xb); else { put(k0, B.xa); put(k1, B.xb); }
      for (const k of ins) mark[k] = bi;
    });
    ringV.forEach(([x, y, c, s, f], k) => {
      inH.push(f); inB.push(mark[k]);
      pos.push(x * fr, (y + yc) * fr, z * L); uv.push(Math.acos(Math.max(-1, Math.min(1, -s))) / Math.PI * per * 0.5 * 0.22, z * L * 0.22);
    });
  });
  const row = NR + 1, doors = bays.map(() => []);
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < NR; k++) {
    const a = j * row + k, b = a + 1, c = a + row, d = c + 1;
    if (inH[a] && inH[b] && inH[c] && inH[d]) continue;
    if (inB[a] >= 0 && inB[a] === inB[b] && inB[a] === inB[c] && inB[a] === inB[d]) { doors[inB[a]].push(a, b, c, b, d, c); continue; }
    (j >= nOut + 7 ? deep : j >= nOut + 1 ? duct : k < NR / 2 ? top : bot).push(a, b, c, b, d, c); // duto: claro na boca, escuro no fundo
  }
  // tampas: cauda sempre; nariz só nos motores a pistão (o jato tem a entrada de ar aberta)
  const cap = (j, flip) => { const ci = pos.length / 3, r = rings[j]; pos.push(0, r[4] * fr, r[0] * L); uv.push(0.5, j ? 1 : 0); for (let k = 0; k < NR; k++) { const a = j * row + k; (k < NR / 2 ? top : bot).push(...(flip ? [ci, a + 1, a] : [ci, a, a + 1])); } };
  if (!D.jet) { cap(0, false); cap(nOut - 1, true); }
  else if (D.intakes === 'side') cap(nOut - 1, true); // nariz fechado (radome); entradas de ar nas laterais
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...top, ...bot, ...duct, ...deep]); g.addGroup(0, top.length, 0); g.addGroup(top.length, bot.length, 1);
  if (duct.length) { g.addGroup(top.length + bot.length, duct.length, 2); g.addGroup(top.length + bot.length + duct.length, deep.length, 3); }
  g.computeVertexNormals();
  g.userData.bayDoors = doors.map(ix => { if (!ix.length) return null; const d = new THREE.BufferGeometry(); d.setAttribute('position', g.attributes.position.clone()); d.setAttribute('uv', g.attributes.uv.clone()); d.setIndex(ix); d.computeVertexNormals(); return d; });
  // fundo do duto (onde fica a face do compressor), em z e meia-largura
  if (noseIn) { const r = rings[rings.length - 1]; g.userData.duct = { z: r[0] * L, hw: r[1] * fr, h: Math.max(r[2], r[3]) * fr, yc: r[4] * fr, lip: rings[nOut - 1][0] * L }; }
  // amostra da seção numa fração z (para insígnias e acessórios encostarem na chapa)
  // seção exata em z (m): meia-largura, alturas de cima/baixo e centro, em metros; ex = expoente da superelipse
  g.userData.sec = z => { const r = ringAt(z / L); return { hw: r[1] * fr, tp: r[2] * fr, bt: r[3] * fr, yc: r[4] * fr, ex }; };
  g.userData.at = zf => { const r = ringAt(Math.max(R0[0][0], Math.min(R0[R0.length - 1][0], zf))); return { hw: r[1] * fr, h: Math.min(r[2], r[3]) * fr, top: (r[2] + r[4]) * fr, yc: r[4] * fr }; };
  return g;
}
// Carenagem da raiz da asa: concordância côncava entre a fuselagem e o dorso (grupo 0) e o ventre (grupo 1) da
// asa, ao longo da corda da raiz e um pouco além do bordo de fuga. o = planta da asa (wingCfg), fa = seção da
// fuselagem (userData.at), R = raio máximo. Cada estação é uma Bézier quadrática fuselagem → canto → asa.
// skip = [za, zb]: sem a parte de baixo nesse trecho (boca do alojamento do trem)
function filletGeometry(o, fa, L, R, cfEnd = 0.72, skip = null) {
  const c0 = o.c0, zle = o.zq0 + 0.25 * c0, z0 = zle + 0.06 * c0, z1 = zle - c0 * cfEnd, NZ = 18, NU = 7, pos = [], uv = [], up = [], low = [], sd = o.side;
  // meia-largura da fuselagem na altura y (seção ~elíptica)
  const fx = (a, y) => { const hh = y >= a.yc ? a.top - a.yc : a.h; return a.hw * Math.sqrt(Math.max(0, 1 - ((y - a.yc) / Math.max(hh, 0.05)) ** 2)); };
  for (const [g, sgn, kR] of [[up, 1, 1], [low, -1, 0.55]]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NZ; i++) {
      const z = z0 + (z1 - z0) * i / NZ, xc = Math.min(1, Math.max(0, (zle - z) / c0)), a = fa(z / L);
      // cresce do bordo de ataque e some na dobradiça do flap (o flap defletido não pode bater na carenagem)
      const t = i / NZ, r = R * kR * Math.sin(Math.PI * Math.min(1, Math.max(0, (zle + 0.06 * c0 - z) / (c0 * (cfEnd + 0.06))))) ** 0.55 + 0.004;
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
      if (skip && sgn < 0) { const za = z0 + (z1 - z0) * i / NZ, zb = z0 + (z1 - z0) * (i + 1) / NZ; if (Math.max(za, zb) > skip[0] - 0.05 && Math.min(za, zb) < skip[1] + 0.05) continue; }
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
// como tubeLoft, mas cada seção leva o próprio expoente (secs = [[z, cx, cy, hw, hh, ex]]): retângulo arredondado → círculo
function tubeLoftV(secs) {
  const NR = 24, pos = [], uv = [], idx = [];
  for (const [z, cx, cy, hw, hh, ex] of secs) for (let k = 0; k <= NR; k++) {
    const a = k / NR * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(cx + Math.sign(c) * Math.abs(c) ** ex * hw, cy + Math.sign(s) * Math.abs(s) ** ex * hh, z); uv.push(k / NR, z * 0.22);
  }
  const row = NR + 1;
  for (let j = 0; j < secs.length - 1; j++) for (let k = 0; k < NR; k++) { const a = j * row + k, b = a + 1, c = a + row, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// inverte as faces (o mesmo loft visto por dentro: duto)
function flipLoft(g) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } g.computeVertexNormals(); return g; }
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
    if (r) { r.gearMesh = buildGear(D, r.root, new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: .45, metalness: .5 })); return r; }
  }
  const root = new THREE.Group(), L = D.L, fr = D.fuseR, jet = !!D.jet;
  // jato sem pintura (metal) a menos que a ficha peça camuflagem (def.finish = 'camo')
  const metal = jet && D.finish !== 'camo';
  const paint = metal
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, map: metalTexture(), roughnessMap: metalRough, bumpMap: panelBump(), bumpScale: 1.2, roughness: 0.7, metalness: 0.82 })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, map: camoTexture(D, (g, n) => drawPanels(g, n, 'rgba(20,18,12,.32)', 1, null)), bumpMap: panelBump(), bumpScale: 1.6, roughness: 0.58, metalness: 0.18 });
  const under = metal ? paint : new THREE.MeshStandardMaterial({ color: D.underColor || (D.key === 'il2' ? 0x6f8aa0 : D.key === 'fw190' ? 0x9aa3a6 : D.key === 'spit9' ? 0x9ea19a : 0x8d8c80), bumpMap: panelBump(), bumpScale: 1.6, roughness: .6, metalness: .2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: .45, metalness: .5 });
  // vidro: quase incolor, reflexo pelo ambiente (o metálico escuro de antes virava espelho e escondia a cabine)
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xd6e2e8, roughness: .04, metalness: 0, transparent: true, opacity: .2, clearcoat: 1, clearcoatRoughness: .05, envMapIntensity: 1.6, depthWrite: false });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: .7 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: .7 });
  const accent = new THREE.MeshStandardMaterial({ color: D.nation === 'URSS' ? 0xa8231b : D.nation === 'Alemanha' ? 0xc9b440 : D.nation === 'Reino Unido' ? 0xc9c2a8 : 0x23305a, roughness: .55, metalness: .2 });
  const pair = [paint, under];
  // materiais dos detalhes (planeDetail.js): todos MeshStandard sem textura — mesmo programa dos de cima
  const lamp = (c, e) => new THREE.MeshStandardMaterial({ color: c, emissive: e, emissiveIntensity: 1.6, roughness: .3 });
  const DM = { dark, glass, skin: paint, tank: paint, bay: new THREE.MeshStandardMaterial({ color: bayColor(D), roughness: .62, metalness: .25 }), bare: new THREE.MeshStandardMaterial({ color: 0xb4b7b8, roughness: .3, metalness: .75 }), steel: new THREE.MeshStandardMaterial({ color: 0x5b5d5f, roughness: .35, metalness: .85 }),
    heat: new THREE.MeshStandardMaterial({ color: 0x6e6152, roughness: .42, metalness: .85 }), soot: new THREE.MeshStandardMaterial({ color: 0x141312, roughness: .9, metalness: .2 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xd8b21c, roughness: .55 }), dial: new THREE.MeshStandardMaterial({ color: 0xc9c9bd, roughness: .4 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x3b3e38, roughness: .7, metalness: .3 }), cushion: new THREE.MeshStandardMaterial({ color: 0x4d4536, roughness: .95 }),
    red: lamp(0xff3020, 0xc01008), green: lamp(0x30ff60, 0x08b030), white: lamp(0xffffff, 0x9a9a9a) };
  const nozzles = [], stacks = [];
  const add = (g, m, p = root, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; p.add(o); return o; };
  // fuselagem, coberta inferior e nariz
  const ductM = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: .55, metalness: .6 });
  // capota em gota (perfil próprio por aeronave em def.canopy); a abertura da cabine sai dela: da frente do painel
  // do piloto até atrás do último assento, na largura da borda da capota
  const cz = jet ? L * 0.24 : D.key === 'il2' ? L * 0.08 : -L * 0.02;
  const C = Object.assign({ z: cz / L, len: jet ? 2.6 : 2.3, w: 0.5, h: jet ? 0.55 : 0.42, frames: jet ? [0.24] : [0.24, 0.62] }, D.canopy);
  const czc = C.z * L, seats = C.seats || [0.58], headZ = t => czc + C.len / 2 - t * C.len;
  const hole = { z0: Math.max(headZ(seats[seats.length - 1]) - 0.42, czc - C.len * 0.4), z1: Math.min(headZ(seats[0]) + 0.86, czc + C.len * 0.38),
    hw: z => { const P = [0, 0, 0]; canopyPoint(C.len, C.w, C.h, Math.min(1, Math.max(0, (czc + C.len / 2 - z) / C.len)), 0, P, C.flat, null); return Math.abs(P[0]) * 0.9; } };
  // alojamentos do trem: a fuselagem sai uma vez sem eles só para dar a seção (onde a asa encontra o ventre)
  const GP = gearPlan(D), BAY = gearBays(D, GP, wingPlan(D, 1), fuselage(D, hole).userData.sec);
  const fuseG = fuselage(D, hole, BAY.fuse), fuseMesh = add(fuseG, [paint, under, ductM, DM.soot]);
  const sideIn = jet && D.intakes === 'side', duct = fuseG.userData.duct;
  if (jet) {
    if (duct) {
      // fundo do duto: face do compressor (as pás giram no grupo `prop`), divisória do MiG-15, radar telemétrico do F-86
      add(new THREE.CircleGeometry(duct.hw * 1.04, 24), ductM, root, 0, duct.yc, duct.z + 0.01);
      // MiG-15: divisória vertical do duto (real: separa o ar dos dois lados da cabine) — recuada da boca, fina, na cor do duto
      if (D.key === 'mig15') { const z1 = duct.lip - 0.45, sl = z1 - duct.z, hh = duct.h * 1.86; add(new THREE.BoxGeometry(0.022, hh, sl), ductM, root, 0, duct.yc, duct.z + sl / 2); add(new THREE.CylinderGeometry(0.016, 0.016, hh, 8), ductM, root, 0, duct.yc, z1); }
      if (D.key === 'f86') { const r = add(new THREE.CapsuleGeometry(0.1, 0.35, 4, 10).rotateX(Math.PI / 2), paint, root, 0, duct.yc + duct.h * 0.78, duct.lip - 0.32); r.scale.y = 0.8; }
    } else {
      // radome em ogiva (curto, como o do APQ-120) e entradas laterais em loft, com placa separadora da camada-limite
      const at = fuseG.userData.at, an = at(0.449), R = an.hw * 0.97, RL = L * 0.1, prof = [];
      for (let i = 0; i <= 14; i++) { const t = i / 14; prof.push(new THREE.Vector2(Math.max(R * Math.pow(1 - t, 0.6) * (1 + 0.12 * Math.sin(Math.PI * t)), 0.001), t * RL)); } // ogiva com ponta
      add(new THREE.LatheGeometry(prof, 28).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6a6e66, roughness: .55 }), root, 0, an.yc, L * 0.45 - 0.02);
      // entradas laterais: carenagem externa em loft afastada da chapa (fresta da placa separadora), lábio
      // arredondado de 5 cm e o duto POR DENTRO (paredes com face para dentro) que desce e vai para o eixo do
      // motor, de seção retangular arredondada a circular, até a face do compressor com cubo e pás
      const zf = L * 0.2, zb = -L * 0.07, soot = DM.soot, fanM = new THREE.MeshStandardMaterial({ color: 0x5c5f61, roughness: .35, metalness: .85 });
      for (const s of [1, -1]) {
        const secs = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12, z = zf + (zb - zf) * t, fa = at(z / L), hw = 0.34 - 0.17 * t ** 1.2, hh = 0.56 - 0.22 * t;
          const xin = fa.hw + 0.075 * (1 - t) ** 2 - 0.3 * t ** 1.5; // borda de dentro: fresta de 7,5 cm na boca, depois afunda na fuselagem
          secs.push([z, s * (xin + hw), fa.yc - 0.12 + 0.07 * t, hw, hh]);
        }
        add(tubeLoft(secs, 0.38), paint, root);
        const [z0, cx0, cy0, hw0, hh0] = secs[0], th = 0.05, lip = [];
        for (let k = 0; k <= 6; k++) { const a = Math.PI * k / 6, f = (1 - Math.cos(a)) / 2; lip.push([z0 + 0.03 * Math.sin(a), cx0, cy0, hw0 - th * f, hh0 - th * f]); }
        add(tubeLoft(lip, 0.38), paint, root);
        // duto: do lábio para trás e para dentro (centro do motor), seção ficando redonda; os primeiros 40% claros
        const ex = s * (fr * 0.36 * 1.05), ey = -fr * 0.15, R = fr * 0.33, duct = [];
        for (let k = 0; k <= 12; k++) {
          const t = k / 12, e = t * t * (3 - 2 * t), hw = (hw0 - th) * (1 - e) + R * e, hh = (hh0 - th) * (1 - e) + R * e, z = z0 - t * 3.0;
          // o duto vai para o eixo do motor, mas sem entrar na fuselagem: dentro dele a chapa clara de fora aparecia
          const cx = s * Math.max(Math.abs(cx0 + (ex - cx0) * e), at(z / L).hw + hw + 0.012);
          duct.push([z, cx, cy0 + (ey - cy0) * e, hw, hh, 0.38 + 0.62 * e]);
        }
        const dl = (a, b) => flipLoft(tubeLoftV(duct.slice(a, b)));
        add(dl(0, 6), ductM, root); add(dl(5, 13), soot, root);
        const fz = z0 - 3.0, fc = new THREE.Vector3(duct[12][1], duct[12][2], fz);
        add(new THREE.CircleGeometry(R * 1.02, 24), soot, root, fc.x, fc.y, fz - 0.05);
        add(new THREE.ConeGeometry(R * 0.32, R * 0.6, 18).rotateX(Math.PI / 2), fanM, root, fc.x, fc.y, fz + R * 0.2);
        const bl = [];
        for (let i = 0; i < 21; i++) bl.push(new THREE.BoxGeometry(R * 0.15, R * 0.72, 0.02).rotateY(0.5).translate(0, R * 0.62, 0).rotateZ(i / 21 * Math.PI * 2));
        add(mergeGeometries(bl), fanM, root, fc.x, fc.y, fz);
        // placa separadora: chapa vertical na fresta, um pouco à frente da boca, com os montantes até a fuselagem
        const fa0 = at(zf / L), px = s * (fa0.hw + 0.04);
        add(new RoundedBoxGeometry(0.03, hh0 * 2.08, 1.15, 2, 0.012), paint, root, px, cy0, zf - 0.3);
        for (const dy of [-0.6, 0, 0.6]) add(new THREE.BoxGeometry(0.05, 0.03, 0.5), ductM, root, s * (fa0.hw + 0.012), cy0 + dy * hh0, zf - 0.45);
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
    // tomada de ar ventral: só P-47 (radiador de óleo/intercooler na frente) e Il-2 (radiador sob a fuselagem); Spitfire tem os da asa e o Fw 190 é radial
    if (D.key === 'p47' || D.key === 'il2') add(new THREE.CylinderGeometry(fr * 0.25, fr * 0.32, 0.6, 12).rotateX(Math.PI / 2), dark, root, 0, -fr * 0.95, D.key === 'p47' ? L * 0.2 : -L * 0.08);
  }
  // cabine: bolha de vidro assentada na chapa, trilhos; por baixo, a cabine (planeCockpit.js)
  const fat = fuseG.userData.at, cAt = fat(C.z), cy = cAt.top - 0.06, fex = jet ? 1 : 2 / 2.4;
  // altura da chapa (seção superelíptica da fuselagem) sob o ponto (x, z) da capota, no referencial dela
  const sf = (x, z) => { const a = fat((czc + z) / L), c = Math.min(1, Math.abs(x) / a.hw) ** (1 / fex); return a.yc + (a.top - a.yc) * Math.sqrt(Math.max(0, 1 - c * c)) ** fex - cy - 0.012; };
  add(canopyGeometry(C.len, C.w, C.h, C.flat, sf), glass, root, 0, cy, czc);
  const frameM = jet ? paint : dark;
  for (const t of C.frames) add(canopyFrame(C.len, C.w, C.h, t, jet ? 0.016 : 0.02, C.flat, sf), frameM, root, 0, cy, czc);
  for (const sd of [1, -1]) add(canopySill(C.len, C.w, C.h, C.flat, sf, sd, jet ? 0.022 : 0.026), frameM, root, 0, cy, czc);
  // cabeças dos tripulantes: a cabine (banheira, painéis, manche, pedais, assentos, mira) se arranja em volta delas
  const heads = seats.map((t, i) => ({ y: cy + C.h * 0.62 + (i ? C.rearDy || 0 : 0), z: headZ(t) }));
  const canopyH = z => { const P = [0, 0, 0]; canopyPoint(C.len, C.w, C.h, Math.min(1, Math.max(0, (czc + C.len / 2 - z) / C.len)), Math.PI / 2, P, C.flat, sf); return P[1]; };
  // meia-largura do vidro na altura y (absoluta) da estação z: o que fica dentro dela não fura a capota
  const canopyW = (z, y) => {
    const t = Math.min(1, Math.max(0, (czc + C.len / 2 - z) / C.len)), P = [0, 0, 0]; let px = 0, py = -1e9;
    for (let j = 0; j <= 24; j++) {
      canopyPoint(C.len, C.w, C.h, t, j / 24 * Math.PI / 2, P, C.flat, sf); const yy = P[1] + cy;
      if (yy >= y) return j ? px + (Math.abs(P[0]) - px) * (y - py) / (yy - py || 1) : Math.abs(P[0]);
      px = Math.abs(P[0]); py = yy;
    }
    return 0;
  };
  buildCockpit({ add, root, D, M: DM, sec: fuseG.userData.sec, hole, crew: heads, jet, face: C.face, cy, canopyH, canopyW });
  // piloto sob a capota (capacete branco no jato, de couro no pistão); a hitbox 'pilot' é alinhada a ele (plane.js)
  const pilot = new THREE.Group(), suit = new THREE.MeshStandardMaterial({ color: jet ? 0x5b5f45 : 0x6b5a3e, roughness: .9 });
  const helm = new THREE.MeshStandardMaterial({ color: jet ? 0xdedcd2 : 0x4a3424, roughness: jet ? .3 : .8 });
  const vest = new THREE.MeshStandardMaterial({ color: jet ? (D.nation === 'URSS' ? 0x4b3a2a : 0x6f6a3a) : 0x5a4630, roughness: .85 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x2b241d, roughness: .8 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: .08, metalness: .9 });
  const rb = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, r);
  // membro (braço) como cápsula entre dois pontos
  const limb = (g, a, b, r, m) => { const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), l = d.length(); const o = add(new THREE.CapsuleGeometry(r, Math.max(0.01, l - 2 * r), 4, 10), m, g, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return o; };
  // C.seats: posição de cada tripulante (fração do comprimento da capota, da frente); o primeiro é o piloto
  const crew = (g, t, dy = 0) => {
    const y = cy + C.h * 0.62 + dy, z = czc + C.len / 2 - t * C.len; g.position.set(0, y, z); root.add(g);
    // capacete
    const hm = add(new THREE.SphereGeometry(0.128, 22, 16), helm, g, 0, 0.012, -0.012); hm.scale.set(1, 1.07, 1.13);
    if (jet) {
      // viseira (calota escura na frente, na altura dos olhos), máscara de oxigênio e mangueira até o peito
      const vz = add(new THREE.SphereGeometry(0.134, 22, 10, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.34, Math.PI * 0.24), visor, g, 0, 0.012, -0.012); vz.scale.set(1, 1.07, 1.13);
      add(new THREE.BoxGeometry(0.03, 0.03, 0.05), helm, g, 0, 0.13, 0.1);                                      // trilho da viseira
      const mk2 = add(new THREE.CapsuleGeometry(0.042, 0.04, 4, 12).rotateX(Math.PI / 2), black, g, 0, -0.085, 0.11); mk2.scale.set(1, 0.9, 1);
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.01, -0.11, 0.15), new THREE.Vector3(0.06, -0.2, 0.17), new THREE.Vector3(0.11, -0.3, 0.11)]), 10, 0.016, 6), black, g);
    } else {
      // capacete de couro: óculos (aros e lentes) com a tira
      for (const sx of [1, -1]) { add(new THREE.CylinderGeometry(0.034, 0.034, 0.03, 14).rotateX(Math.PI / 2), black, g, sx * 0.046, 0.03, 0.118); add(new THREE.CircleGeometry(0.028, 14), visor, g, sx * 0.046, 0.03, 0.134); }
      const st = add(new THREE.TorusGeometry(0.13, 0.008, 4, 24), black, g, 0, 0.03, -0.01); st.rotation.x = Math.PI / 2; st.scale.set(1, 1.13, 1);
    }
    // pescoço, tronco de ombros largos, colete/arreios e braços indo ao manche e à manete
    add(new THREE.CylinderGeometry(0.052, 0.06, 0.1, 12), suit, g, 0, -0.15, -0.025);
    add(rb(0.44, 0.5, 0.26, 0.09), suit, g, 0, -0.43, -0.05);
    add(rb(0.46, 0.26, 0.29, 0.08), vest, g, 0, -0.32, -0.04);
    for (const sx of [1, -1]) add(new THREE.BoxGeometry(0.045, 0.3, 0.02), black, g, sx * 0.1, -0.33, 0.105); // arreios
    // braços: mão direita (−x) no manche, esquerda (+x) na manete — pontos que a cabine devolveu (referencial da cabeça)
    const hd = heads[seats.indexOf(t)], loc = p => [p[0], p[1] - y, p[2] - z];
    const hR = hd.stick ? loc(hd.stick) : [-0.02, -0.57, 0.35], hL = hd.throttle ? loc(hd.throttle) : [0.16, -0.53, 0.35];
    for (const [sx, hnd] of [[-1, hR], [1, hL]]) {
      const sh = [sx * 0.2, -0.27, -0.03], el = [(sh[0] + hnd[0]) / 2 + sx * 0.05, Math.min(sh[1], hnd[1]) - 0.1, (sh[2] + hnd[2]) / 2 - 0.02];
      limb(g, sh, el, 0.055, suit); limb(g, el, hnd, 0.048, suit); add(new THREE.SphereGeometry(0.045, 10, 8), glove, g, ...hnd);
    }
    // quadril, coxas e pernas até os pedais (a cabine agora é aberta: o corpo inteiro aparece pelo vidro)
    add(rb(0.38, 0.16, 0.3, 0.06), suit, g, 0, -0.7, 0.0);
    for (const sx of [1, -1]) {
      const hip = [sx * 0.1, -0.7, 0.02], knee = [sx * 0.12, -0.62, 0.44], foot = [sx * 0.13, -1.0, 0.78];
      limb(g, hip, knee, 0.075, suit); limb(g, knee, foot, 0.06, suit);
      add(rb(0.09, 0.08, 0.22, 0.03), black, g, foot[0], foot[1] - 0.02, foot[2] + 0.04);              // bota
    }
    for (const o of g.children) o.userData.fx = true; // marcas de bala não grudam no piloto
    return g;
  };
  crew(pilot, seats[0]);
  for (let i = 1; i < seats.length; i++) crew(new THREE.Group(), seats[i], C.rearDy || 0);
  if (jet) {
    const at = fuseG.userData.at;
    // carenagem dorsal só para quem não tem perfil próprio (o perfil def.fuse já desenha o dorso)
    if (!D.fuse) {
      const z0 = cz - 1.25, z1 = -L * 0.36, zm = (z0 + z1) / 2, spine = add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), paint, root, 0, at(zm / L).top - 0.08, zm);
      spine.scale.set(0.2, 0.26, (z0 - z1) / 2);
    }
  }
  // asas (grupos separados para poder perdê-las)
  const ellip = D.key === 'spit9' || D.key === 'p47';
  const dih = (D.dih ?? (jet ? (D.key === 'mig15' ? -2 : 3) : 5.5)) * deg;
  const half = D.span / 2 - fr * 0.55;
  const wingCfg = wingPlan.bind(null, D);
  // superfícies de comando articuladas (fora da fusão de malhas): { pivot, axis, max }
  const surf = {};
  // primeira fração da envergadura em que a superfície fica toda FORA da chapa (folga gap): a raiz de flap,
  // profundor e leme começava dentro da fuselagem e atravessava a chapa ao defletir
  const fat0 = fuseG.userData.at, skinW = (z, y) => { const a = fat0(z / L), hh = y >= a.yc ? a.top - a.yc : a.h; return z < -0.53 * L ? 0 : a.hw * Math.sqrt(Math.max(0, 1 - ((y - a.yc) / Math.max(hh, 0.05)) ** 2)); };
  const clearS = (o, cf, fin, gap = 0.035) => {
    for (let s = 0; s < 0.6; s += 0.005) {
      let ok = true;
      for (const c of [cf, (cf + 1) / 2, 1]) {
        if (fin) { const p = finStation(o, s, c), a = fat0(p[2] / L); if (p[2] > -0.53 * L && p[1] < a.top + gap) ok = false; }
        else { const p = station(o, s, c); if (Math.abs(p[0]) < skinW(p[2], p[1]) + gap) ok = false; }
      }
      if (ok) return s;
    }
    return 0.6;
  };
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
    if (gs[0].userData.bayDoor) wingDoors[o.side > 0 ? 'L' : 'R'] = gs[0].userData.bayDoor;
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
  // radiador sob a asa (Spitfire): carenagem em loft colada ao intradorso — boca com lábio, colmeia escura recuada,
  // corpo que engorda e a aba de saída articulada atrás (antes era uma caixa)
  const radM = new THREE.MeshStandardMaterial({ color: 0x1d1e1c, roughness: .8, metalness: .4 });
  const radiator = (o, x, zc, par) => {
    const len = 1.35, secs = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, z = zc + len / 2 - t * len, hw = 0.2 + 0.06 * Math.sin(Math.PI * Math.min(1, t * 1.3)), hh = 0.09 + 0.07 * Math.sin(Math.PI * Math.min(1, t * 1.15)) - 0.05 * t * t;
      secs.push([z, x, wingY(o, x, z, -1) - hh + 0.03, hw, Math.max(0.04, hh)]);
    }
    add(tubeLoft(secs, 0.45), under, par);
    const [z0, , y0, hw0, hh0] = secs[0];
    const lip = []; for (let k = 0; k <= 5; k++) { const a = Math.PI * k / 5, f = (1 - Math.cos(a)) / 2; lip.push([z0 + 0.025 * Math.sin(a), x, y0, hw0 - 0.03 * f, hh0 - 0.03 * f]); }
    add(tubeLoft(lip, 0.45), under, par);
    // colmeia: placa escura recuada com aletas finas
    const core = add(new THREE.BoxGeometry(hw0 * 1.8, hh0 * 1.7, 0.04), radM, par, x, y0, z0 - 0.18);
    for (let k = -4; k <= 4; k++) add(new THREE.BoxGeometry(0.008, hh0 * 1.7, 0.06), radM, par, x + k * hw0 * 0.2, y0, z0 - 0.15);
    // aba de saída levemente aberta
    const e = secs[10], flap = add(new THREE.BoxGeometry(e[3] * 2.1, 0.012, 0.28), under, par, x, e[2] - e[4] * 0.6, e[0] - 0.1); flap.rotation.x = 0.18;
    return core;
  };
  const wing = side => {
    const grp = new THREE.Group(); root.add(grp);
    const tip = new THREE.Group(); grp.add(tip); grp.userData.tip = tip;
    const o = wingCfg(side), sd = side > 0 ? 'L' : 'R', A = D.ail || SURF.ail, F = D.flap || SURF.flap;
    const mv = [['ail' + sd, A[0], A[1], 20], ['flap' + sd, Math.max(F[0], clearS(o, SURF.cf)), F[1], 40]], inner = m => (m[1] + m[2]) / 2 < sB;
    // a raiz leva o alojamento do trem (furo no intradorso; o pedaço tirado é a porta presa à perna)
    const m = BAY.main, skin0 = cutSurface(Object.assign({}, o, { bay: { xi: m.wxi, xo: m.xo, za: m.za, zb: m.zb } }), SURF.cf, mv.filter(inner), grp, false, 0, sB);
    grp.userData.skins = [skin0, cutSurface(o, SURF.cf, mv.filter(m => !inner(m)), tip, false, sB, 1)]; // chapa da raiz e da ponta (insígnias)
    if (D.stripes) for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.3, 0.02, D.chord * 0.86), i % 2 ? black : white, grp, side * (fr + 1.0 + i * 0.3), -fr * 0.25 - 0.17 + (1 + i * 0.3) * Math.tan(dih), D.wingZ - D.chord * 0.2);
    if (D.key === 'mig15') for (const k of [0.38, 0.7]) { const p = station(o, k, 0.5); add(new THREE.BoxGeometry(0.03, 0.18, chordAt(o, k) * 0.9), paint, k < sB ? grp : tip, p[0], p[1] + 0.1, p[2]); } // cercas aerodinâmicas
    if (D.key === 'spit9') radiator(o, side * (fr + 1.0), D.wingZ - 0.35, grp); // radiadores sob a asa
    DT.navLight(add, DM, tip, station(o, 1, 0.3), side); // luz de navegação (vermelha à esquerda, verde à direita)
    return grp;
  };
  const wingDoors = {}, wingL = wing(1), wingR = wing(-1);
  buildBays(add, root, [wingL, wingR], D, BAY, wingPlan(D, 1), fuseG.userData.sec, DM, fuseG.userData.duct);
  // carenagem da raiz (fica na fuselagem: a asa que cai deixa a carenagem)
  for (const sd of [1, -1]) add(filletGeometry(wingCfg(sd), fuseG.userData.at, L, Math.min(0.55, Math.max(0.18, D.chord * (jet ? 0.1 : 0.14))), 0.72, BAY.main ? [BAY.main.za, BAY.main.zb] : null), pair, root);
  // ---- canhões (def.guns[i].mount): canos, carenagens, casulos, fendas; a boca é o ponto de tiro (gunPts) ----
  const at = fuseG.userData.at, steel = new THREE.MeshStandardMaterial({ color: 0x2b2c2d, roughness: .4, metalness: .8 });
  const secY = (a, ay) => (ay >= 0 ? a.yc + ay * (a.top - a.yc) : a.yc + ay * a.h);
  // ponto da chapa (seção elíptica) na altura y e a normal ali
  const hullX = (a, y) => { const hh = y >= a.yc ? a.top - a.yc : a.h; return a.hw * Math.sqrt(Math.max(0, 1 - ((y - a.yc) / hh) ** 2)); };
  const hullN = (a, x, y) => { const hh = y >= a.yc ? a.top - a.yc : a.h; return new THREE.Vector3(x / (a.hw * a.hw), (y - a.yc) / (hh * hh), 0).normalize(); };
  // peça rente à chapa: eixo y local = normal, z local = ao longo da fuselagem
  const _bm = new THREE.Matrix4(), _zA = new THREE.Vector3(0, 0, 1);
  const flush = (geo, m, x, y, z, n) => { const o = add(geo, m, root, x + n.x * 0.004, y + n.y * 0.004, z); const r = new THREE.Vector3().crossVectors(n, _zA).normalize(); o.quaternion.setFromRotationMatrix(_bm.makeBasis(r, n, _zA)); return o; };
  const slotG = (w, len) => new THREE.CapsuleGeometry(w / 2, len, 4, 12).rotateX(Math.PI / 2).scale(1, 0.12, 1);
  const sootM = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: .95, transparent: true, opacity: .45, depthWrite: false });
  const tube = (r0, r1, len, m, x, y, zTip) => add(new THREE.CylinderGeometry(r1, r0, len, 14).rotateX(Math.PI / 2), m, root, x, y, zTip - len / 2); // r1 = ponta
  // carenagem torneada: cauda afinando, corpo, frente arredondada até a boca (raio rf) em zf; comprimento len
  const fairing = (R, len, rf, x, y, zf, m) => { const P = [], z0 = zf - len; for (let i = 0; i <= 16; i++) { const t = i / 16, z = z0 + t * len; const r = t < 0.3 ? R * Math.sin(t / 0.3 * Math.PI / 2) ** 0.7 : t > 0.85 ? R - (R - rf) * ((t - 0.85) / 0.15) ** 1.6 : R; P.push(V2(Math.max(r, 0.004), z)); } return add(DT.latheZ(P, 20), m, root, x, y, 0); };
  const hullPatch = (th0, th1, z0, z1, off) => { // pedaço da chapa entre os ângulos th0..th1 e z0..z1, afastado `off` da chapa
    const NU = 8, NV = 6, pos = [], idx = [];
    for (let v = 0; v <= NV; v++) { const z = z0 + (z1 - z0) * v / NV, a = at(z / L); for (let u = 0; u <= NU; u++) { const th = th0 + (th1 - th0) * u / NU, c = Math.cos(th), sn = Math.sin(th), hh = sn >= 0 ? a.top - a.yc : a.h; const px = a.hw * c, py = a.yc + hh * sn, n = hullN(a, px, py); pos.push(px + n.x * off, py + n.y * off, z); } }
    for (let v = 0; v < NV; v++) for (let u = 0; u < NU; u++) { const p0 = v * (NU + 1) + u, p1 = p0 + 1, p2 = p0 + NU + 1, p3 = p2 + 1; idx.push(p0, p1, p2, p1, p3, p2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  };
  const flipG = g => { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } g.computeVertexNormals(); return g; };
  const gunPts = (D.guns || []).map(g => {
    const M = g.mount; if (!M) return null;
    const a = at(M.zf), z = M.zf * L;
    return M.b.map(([ax, ay]) => {
      let x = ax * a.hw, y = secY(a, ay);
      if (M.pod) {
        // gôndola/carenagem do canhão: corpo torneado; M.pod.blend = integrada ao ventre (queixo do F-4E), senão com pilone
        const R = M.pod.r; y = a.yc - a.h - R * (M.pod.blend ? 0.25 : 0.62);
        fairing(R, M.pod.len + 0.25, R * 0.72, x, y, z, paint);
        add(new THREE.CircleGeometry(R * 0.66, 18), black, root, x, y, z - 0.03);                         // boca escura
        if (!M.pod.blend) add(new RoundedBoxGeometry(0.07, a.yc - a.h - y + 0.05, M.pod.len * 0.6, 2, 0.02), paint, root, x, (y + a.yc - a.h) / 2 + 0.02, z - M.pod.len * 0.55); // pilone
        for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(R * 0.5, 0.012, 0.05), black, root, x, y - R * 0.98, z - 0.6 - k * 0.12); // fendas de ventilação
      }
      if (M.fair) {
        // carenagem do canhão sob o nariz: encostada na chapa (antes um tubo solto abaixo dela)
        y = a.yc - a.h * Math.sqrt(Math.max(0, 1 - (x / a.hw) ** 2)) - M.fair.r * 0.4;
        fairing(M.fair.r, M.fair.len, M.r * 1.6, x, y, z, paint);
      }
      if (M.port) {
        // calha do F-86: fenda escura rente à chapa, cano lá dentro e fuligem dos disparos para trás
        x = Math.sign(ax) * hullX(a, y); const n = hullN(a, x, y);
        flush(slotG(0.085, 0.34), black, x, y, z - 0.14, n);
        flush(slotG(0.11, 0.9), sootM, x, y, z - 0.75, n).position.addScaledVector(n, 0.002);
        // o cano deitado na calha, a meia altura da chapa: visível de fora (antes ficava 2 cm para dentro, sumia)
        x -= n.x * 0.006; y -= n.y * 0.006;
      }
      const tip = z + M.len, bl = M.port ? 0.36 : Math.max(M.len, 0) + 0.45; // F-86: só o trecho do cano dentro da calha
      if (M.cluster) for (let i = 0; i < M.cluster; i++) { const t = i / M.cluster * Math.PI * 2; tube(M.r, M.r, bl, steel, x + Math.cos(t) * M.rr, y + Math.sin(t) * M.rr, tip); }
      else for (const dx of M.twin ? [-M.twin / 2, M.twin / 2] : [0]) {
        tube(M.r, M.r, bl, steel, x + dx, y, tip);
        if (M.port) tube(M.r * 1.35, M.r * 1.35, 0.05, steel, x + dx, y, tip); // anel da boca
        if (M.brake) { tube(M.r * 1.7, M.r * 1.7, 0.22, steel, x + dx, y, tip); for (const yy of [-1, 1]) add(new THREE.BoxGeometry(M.r * 3.6, 0.02, 0.05), black, root, x + dx, y + yy * M.r * 0.6, tip - 0.08); } // freio de boca com janelas
        add(new THREE.CircleGeometry(M.r * 0.6, 10), black, root, x + dx, y, tip + 0.002);
      }
      return [x, y, tip + 0.1];
    });
  });
  // F-86: placa antichama de aço sem pintura em volta das três bocas de cada lado (bem visível no avião real)
  (D.guns || []).forEach(g => {
    const M = g.mount; if (!M || !M.port || !M.blast) return;
    const a = at(M.zf), z = M.zf * L, ys = M.b.map(b => b[1]), th = ay => Math.asin(Math.max(-1, Math.min(1, ay)));
    const t0 = th(Math.min(...ys) - 0.16), t1 = th(Math.max(...ys) + 0.16);
    for (const sd of new Set(M.b.map(b => Math.sign(b[0])))) {
      const pg = hullPatch(sd > 0 ? t0 : Math.PI - t1, sd > 0 ? t1 : Math.PI - t0, z - 0.42, z + 0.16, 0.008);
      add(sd > 0 ? pg : flipG(pg), DM.bare, root);
    }
  });
  // ---- freios aerodinâmicos (def.brake) ----
  // Na fuselagem: casca curva recortada da própria chapa (acompanha a seção), por dentro nervuras e o atuador; o
  // vão escuro fica no lugar. Na asa: placa com nervuras. Articulados no bordo dianteiro.
  const brakes = [];
  for (const b of D.brake || []) {
    const sd = Math.sign(b.ax) || 0, side = b.open === 'side', piv = new THREE.Group();
    if (b.ws != null) {
      // asa (F-4E): placa sob o intradorso, nervuras e atuador
      const o = wingCfg(sd), p = station(o, b.ws, b.cf), c = chordAt(o, b.ws), x = p[0], z = p[2] + b.len / 2, y = p[1] - (o.t0 + (o.t1 - o.t0) * b.ws) * c * 0.5 - 0.02, par = sd > 0 ? wingL : wingR;
      piv.position.set(x, y, z); par.add(piv);
      add(new RoundedBoxGeometry(b.w, 0.03, b.len, 2, 0.01).translate(0, 0, -b.len / 2), under, piv);
      for (const k of [-0.3, 0, 0.3]) add(new THREE.BoxGeometry(0.02, 0.05, b.len * 0.9), ductM, piv, k * b.w, 0.035, -b.len / 2);
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 6), steel, piv, 0, 0.15, -b.len * 0.55);
      add(new THREE.BoxGeometry(b.w, 0.01, b.len), ductM, par, x, y + 0.025, z - b.len / 2);                 // vão
      brakes.push({ pivot: piv, axis: new THREE.Vector3(1, 0, 0), max: -b.deg * deg });
      continue;
    }
    // fuselagem: ângulo do centro do painel na seção (lado: ±x com ay de altura; ventre: −90° deslocado por ax)
    const a = at(b.zf), dth = b.w / (2 * Math.max(a.hw, 0.3)), z0 = b.zf * L + b.len / 2, z1 = b.zf * L - b.len / 2;
    const thM = side ? (b.ax > 0 ? Math.atan2(b.ay, 1) : Math.PI - Math.atan2(b.ay, 1)) : -Math.PI / 2 + b.ax * 0.9;
    const t0 = thM - dth, t1 = thM + dth, cth = Math.cos(thM), sth = Math.sin(thM), hhM = sth >= 0 ? a.top - a.yc : a.h;
    const P0 = new THREE.Vector3(a.hw * cth, a.yc + hhM * sth, z0);
    piv.position.copy(P0); root.add(piv);
    const outer = flipG(hullPatch(t0, t1, z0, z1, 0.012)), inner = hullPatch(t0, t1, z0, z1, -0.008); // o loft sai com a face para dentro
    for (const g of [outer, inner]) g.translate(-P0.x, -P0.y, -P0.z);
    add(outer, side ? paint : under, piv); add(inner, ductM, piv);
    // nervuras por dentro e o atuador (gira com o painel: aparece entre a chapa e o painel aberto)
    const nI = hullN(a, P0.x, P0.y);
    for (const k of [-0.5, 0, 0.5]) { const th = thM + k * dth, sn = Math.sin(th), qx = a.hw * Math.cos(th), qy = a.yc + (sn >= 0 ? a.top - a.yc : a.h) * sn; add(new THREE.BoxGeometry(0.02, 0.02, b.len * 0.9), steel, piv, qx - P0.x - nI.x * 0.03, qy - P0.y - nI.y * 0.03, -b.len / 2); }
    const act = add(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 6), steel, piv, -nI.x * 0.17, -nI.y * 0.17, -b.len * 0.6); act.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nI);
    add(flipG(hullPatch(t0, t1, z0, z1, -0.02)), ductM, root);                                                 // vão
    brakes.push({ pivot: piv, axis: side ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), max: -(side ? sd : 1) * b.deg * deg });
  }
  // empenagem: estabilizador e deriva também com perfil
  const tail = new THREE.Group(); root.add(tail);
  const finH = L * 0.17;
  for (const s of [1, -1]) {
    const o = tailCfg(D, s), sd = s > 0 ? 'L' : 'R';
    if (D.stab === 'all') {
      // estabilizador todo móvel: a metade inteira gira num eixo lateral a ~40% da corda da raiz. A raiz fica fora da
      // chapa com folga para o giro (a fuselagem afina para trás: vale a maior largura ao longo da corda da raiz),
      // a ponta no mesmo lugar — antes a raiz nascia no eixo do avião e varria a fuselagem ao defletir
      let xr = 0; for (let k = 0; k <= 8; k++) { const p = station(o, 0, k / 8); for (const dy of [-0.18, 0, 0.18]) xr = Math.max(xr, skinW(p[2], p[1] + dy * o.c0)); }
      const k0 = Math.max(0, (xr + 0.03 - o.x0) / o.half), c0 = chordAt(o, k0); // mesma planta, só sem o trecho de dentro
      Object.assign(o, { x0: o.x0 + k0 * o.half, zq0: o.zq0 - o.sweep * k0, y0: o.y0 + k0 * o.half * Math.tan(o.dih), c0, sweep: o.sweep * (1 - k0), half: o.half * (1 - k0) });
      const P0 = new THREE.Vector3(...station(o, 0, 0.4)), pivot = new THREE.Group(); pivot.position.copy(P0); tail.add(pivot);
      add(wingGeometry(o).translate(-P0.x, -P0.y, -P0.z), pair, pivot);
      surf['elev' + sd] = { pivot, axis: new THREE.Vector3(1, 0, 0), max: 12 * deg, base: new THREE.Quaternion() };
    } else cutSurface(o, 0.68, [['elev' + sd, Math.max(0.04, clearS(o, 0.68)), 0.95, 25]], tail);
  }
  const fc = finCfg(D), finMesh = cutSurface(fc, 0.7, [['rud', Math.max(0.1, clearS(fc, 0.7, true)), 0.95, 25]], tail, true);
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
  // insígnias projetadas na chapa (paint.js): asa na estação 0,68 (no pedaço onde cai: raiz ou ponta), fuselagem, deriva
  const ws = 0.68, oL = wingCfg(1), cw = chordAt(oL, ws), wp = station(oL, ws, 0.45), wdih = oL.brk && ws > oL.brk.at ? oL.brk.dih : oL.dih;
  const wi = { x: wp[0], z: wp[2], y: wingY(oL, wp[0], wp[2], 1), yl: wingY(oL, wp[0], wp[2], -1), size: Math.min(cw * 0.62, 1.6), dih: wdih, th: 0.5 };
  const fp = finStation(fc, 0.5, 0.3), mk = D.marks || {};
  planeDecals(D, { fuse: fuseMesh, fuseAt: fuseG.userData.at, wings: [wingL, wingR].map((g, i) => [g.userData.skins[ws > sB ? 1 : 0], wi, i ? -1 : 1]),
    fin: { mesh: finMesh, p: { y: fp[1], z: fp[2], size: chordAt(fc, 0.5) * 0.62 } }, serial: mk.serial || String(40000 + (D.key.charCodeAt(0) * 97) % 9999), nose: mk.nose && { zf: 0.36, n: mk.nose }, buzz: mk.buzz && { zf: 0.2, txt: mk.buzz }, decalZ: mk.decalZ });
  // trem de pouso (aparece com o trem baixado; o hangar também usa)
  // detalhes por dados (planeDetail.js): luz da cauda, anticolisão, antenas, tanques externos, gancho
  DT.tailLight(add, DM, tail, D); DT.beacons(add, DM, root, D, at); DT.antennas(add, DM, root, tail, D, at);
  DT.drops(add, DM, root, D, at, wingCfg, wingL, wingR, sB); DT.hook(add, DM, root, D, at);
  const gear = buildGear(D, root, dark, under, { ...BAY, wingDoors, fuseDoors: fuseG.userData.bayDoors, sec: fuseG.userData.sec, bayM: DM.bay });
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
// Cada perna tem portas: abertas (presas à perna) com o trem baixado e FECHADAS rentes à chapa com ele recolhido —
// o trem não some, fica no alojamento (e pode ser atingido lá: módulos gearL/gearR/gearN em planeDamage.js).
// userData.anim(k, legK): legK(nome) dá a posição de cada perna (travada/arrancada); userData.legs: os pivôs.
// bays = alojamentos (gearBays + portas recortadas da chapa); sem eles (glTF) não há portas.
export function buildGear(D, root, mat, doorM = mat, bays = null) {
  const g = new THREE.Group(); root.add(g);
  const GP = gearPlan(D), lift = GP.lift, tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: .9 });
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
  const strut = (x, y0, z, len, rad, r, w, door, fork) => {
    const p = new THREE.Group(); p.position.set(x, y0, z); g.add(p);
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
  const { mz, mx, mr, nz, nl, nr } = GP, legs = [], doors = [];
  // porta = o pedaço de chapa recortado do alojamento (fuselage/wingGeometry), com a face de dentro na cor do
  // alojamento 1 cm para dentro. Fechada fica exatamente no lugar da chapa (sem fresta nem "tampa" por cima).
  const doorMesh = (geo, par, M4) => {
    const out = geo.clone(); if (M4) out.applyMatrix4(M4);
    const inner = out.clone(), p = inner.attributes.position, n = inner.attributes.normal;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) - n.getX(i) * 0.012, p.getY(i) - n.getY(i) * 0.012, p.getZ(i) - n.getZ(i) * 0.012);
    const ix = inner.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
    inner.computeVertexNormals();
    mk(out, doorM, par, 0, 0, 0); mk(inner, bays.bayM, par, 0, 0, 0);
  };
  // porta de dobradiça na fuselagem: gira em torno de z na linha (hx, hy); ang = ângulo aberta (rad)
  const hingeDoor = (geo, hx, hy, ang) => {
    const piv = new THREE.Group(); piv.position.set(hx, hy, 0); g.add(piv);
    doorMesh(geo, piv, new THREE.Matrix4().makeTranslation(-hx, -hy, 0));
    doors.push({ piv, ang }); return piv;
  };
  const fd = name => bays && bays.fuseDoors[bays.names.indexOf(name)];
  for (const s of [1, -1]) {
    // pivô na linha média da asa naquela estação: recolhida, a perna fica DENTRO da asa
    const out = GP.ret === 'out', y0 = GP.bay.y0, len = GP.bay.len;
    const p = strut(s * mx, y0, mz, len, 0.07, mr, 0.2, 0);
    const sg = out ? s : -s;
    // porta da asa presa à perna: desenhada na posição recolhida, então fecha rente quando a perna deita
    const wd = bays && bays.wingDoors[s > 0 ? 'L' : 'R'];
    if (wd) { p.rotation.z = sg * Math.PI / 2; p.updateMatrix(); doorMesh(wd, p, p.matrix.clone().invert()); p.rotation.z = 0; }
    // porta do ventre (roda dentro da fuselagem): dobradiça na borda de dentro, abre para baixo
    const fg = fd(s > 0 ? 'L' : 'R'), m = bays && bays.main;
    if (fg) { const hx = s * m.xi; hingeDoor(fg, hx, fuseBottom(bays.sec, hx, (m.za + m.zb) / 2) ?? y0, -s * Math.PI * 0.5); }
    legs.push({ name: s > 0 ? 'L' : 'R', p, ax: 'z', sg });
  }
  const ny = GP.nbay.y0, pn = strut(0, ny, nz, GP.nbay.len, 0.06, nr, 0.14, 0, D.jet);
  // nariz/bequilha: duas portas laterais (a chapa partida no eixo), dobradiça na borda de fora
  const ng = fd('N');
  if (ng) {
    const w = GP.nbay.w, zc = (GP.nbay.za + GP.nbay.zb) / 2;
    for (const sd of [1, -1]) {
      const h = ng.clone(), ix = h.index.array, p = h.attributes.position, keep = [];
      for (let k = 0; k < ix.length; k += 3) { const cx = p.getX(ix[k]) + p.getX(ix[k + 1]) + p.getX(ix[k + 2]); if (cx * sd > 0) keep.push(ix[k], ix[k + 1], ix[k + 2]); }
      h.setIndex(keep);
      hingeDoor(h, sd * w, fuseBottom(bays.sec, sd * w * 0.999, zc) ?? ny, sd * Math.PI * 0.5);
    }
  }
  legs.push({ name: 'N', p: pn, ax: 'x', sg: 1 }); // nariz e bequilha recolhem para trás, para dentro da fuselagem
  // k: posição comandada; legK(nome) → posição daquela perna (null = arrancada). As portas do ventre abrem no
  // primeiro quarto do curso (e fecham no último, recolhendo)
  g.userData.anim = (k, legK) => {
    for (const L of legs) {
      const kk = legK ? legK(L.name, k) : k;
      if (kk == null) { L.p.visible = false; continue; }
      L.p.rotation[L.ax] = L.sg * (1 - kk) * Math.PI / 2;
      L.p.visible = true;
    }
    rk = 1 - k; slide();
    const u = Math.min(1, k / 0.25);
    for (const d of doors) d.piv.rotation.z = d.ang * u;
  };
  g.userData.legs = Object.fromEntries(legs.map(L => [L.name, L.p]));
  // c: compressão do amortecedor 0..1 (peso parado ≈ 0,35; toque forte → 1)
  // amortecedor (squash) + encolhimento da perna ao recolher (a roda cabe no alojamento): as duas somam
  let sq = 0, rk = 0; const slide = () => { slides.forEach(([s, t], i) => (s.position.y = sq * t + (i < 2 ? rk * (GP.bay.shrink || 0) : 0))); };
  g.userData.squash = c => { sq = c; slide(); };
  g.userData.travel = slides[0][1]; // curso do trem principal: o corpo desce isso com o amortecedor todo comprimido
  g.userData.lift = lift; g.userData.pitch = D.jet ? 0 : Math.atan2(lift - nl, D.L * 0.46 + mz) * 0.9;
  g.userData.mainZ = mz; g.userData.mainX = mx; g.userData.noseZ = nz; g.userData.noseLift = nl; // nl: CG → chão pela roda do nariz/bequilha
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
// sf(x, z): altura da chapa da fuselagem sob a capota (no referencial da capota). Com ela, a borda de baixo da
// bolha desce até a chapa em cada estação — antes a borda era reta e ficava uma fresta onde a fuselagem curva.
function canopyPoint(len, w, h, t, a, out, f, sf) {
  const k = canProf(t, f), wk = Math.max(0.05, 0.55 + 0.45 * Math.min(1, k * 1.4)), c = Math.cos(a), s = Math.sin(a), ex = 0.75;
  out[0] = Math.sign(c) * Math.abs(c) ** ex * w * wk; out[2] = len / 2 - t * len;
  const yb = sf ? Math.min(0, sf(out[0], out[2])) : 0, sk = Math.abs(s) ** ex;
  out[1] = yb + (h * k - yb) * sk;
  return out;
}
function canopyGeometry(len, w, h, f, sf) {
  const NL = 24, NA = 18, pos = [], idx = [], P = [0, 0, 0];
  for (let i = 0; i <= NL; i++) for (let j = 0; j <= NA; j++) { canopyPoint(len, w, h, i / NL, j / NA * Math.PI, P, f, sf); pos.push(...P); }
  for (let i = 0; i < NL; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + 1, c = a + NA + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2)); g.computeVertexNormals();
  return g;
}
// montante: tubo fino seguindo a seção da capota na fração t do comprimento
function canopyFrame(len, w, h, t, r = 0.02, f, sf) {
  const pts = []; const P = [0, 0, 0];
  for (let j = 0; j <= 14; j++) { canopyPoint(len, w * 1.006, h * 1.006, t, j / 14 * Math.PI, P, f, sf); pts.push(new THREE.Vector3(...P)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, r, 5, false);
}
// trilho da capota: tubo ao longo da borda de baixo (lado sd), assentado na chapa
function canopySill(len, w, h, f, sf, sd, r) {
  const pts = [], P = [0, 0, 0];
  for (let i = 0; i <= 20; i++) { canopyPoint(len, w * 1.01, h, 0.02 + 0.96 * i / 20, sd > 0 ? 0 : Math.PI, P, f, sf); pts.push(new THREE.Vector3(P[0], P[1] + r * 0.5, P[2])); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, r, 6, false);
}
