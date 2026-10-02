import * as THREE from 'three';
import { planeDecals, camoTexture } from './paint.js';
import { MISSILES } from '../data/vehicles.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hasModel, gltfPlane } from './modelLibrary.js';
import { buildPlaneFx } from './planeFx.js';
import { wingCfg as wingPlan, tailCfg, finCfg, station, SURF } from './planeGeom.js';
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
  const NR = 32, ex = 2 / 2.4, pos = [], uv = [], top = [], bot = [];
  const z0 = rings[0][0], z1 = rings[rings.length - 1][0];
  for (const [z, hw, tp, bt, yc] of rings) for (let k = 0; k <= NR; k++) {
    const a = k / NR * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const x = Math.sign(c) * Math.abs(c) ** ex * Math.max(hw, 0.01), y = (s >= 0 ? tp : bt) * Math.sign(s) * Math.abs(s) ** ex;
    pos.push(x * fr, (y + yc) * fr, z * L); uv.push(k / NR, (z - z0) / (z1 - z0));
  }
  const row = NR + 1;
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < NR; k++) {
    const a = j * row + k, b = a + 1, c = a + row, d = c + 1;
    (k < NR / 2 ? top : bot).push(a, b, c, b, d, c);
  }
  // tampas: cauda sempre; nariz só nos motores a pistão (o jato tem a entrada de ar aberta)
  const cap = (j, flip) => { const ci = pos.length / 3, r = rings[j]; pos.push(0, r[4] * fr, r[0] * L); uv.push(0.5, j ? 1 : 0); for (let k = 0; k < NR; k++) { const a = j * row + k; (k < NR / 2 ? top : bot).push(...(flip ? [ci, a + 1, a] : [ci, a, a + 1])); } };
  if (!D.jet) { cap(0, false); cap(rings.length - 1, true); }
  else if (D.intakes === 'side') cap(rings.length - 1, true); // nariz fechado (radome); entradas de ar nas laterais
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...top, ...bot]); g.addGroup(0, top.length, 0); g.addGroup(top.length, bot.length, 1);
  g.computeVertexNormals();
  // amostra da seção numa fração z (para insígnias e acessórios encostarem na chapa)
  g.userData.at = zf => { let r = rings[0]; for (const q of rings) if (q[0] <= zf) r = q; return { hw: r[1] * fr, h: Math.min(r[2], r[3]) * fr, top: (r[2] + r[4]) * fr, yc: r[4] * fr }; };
  return g;
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
    if (r) return r;
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
  const fuseG = fuselage(D); add(fuseG, pair);
  const sideIn = jet && D.intakes === 'side';
  if (jet) {
    if (!sideIn) add(new THREE.TorusGeometry(D.noseR * 0.9, 0.07, 8, 28), paint, root, 0, 0, L * 0.46); // lábio da entrada de ar
    else {
      // radome cinza-escuro e entradas laterais com placa separadora da camada-limite
      const at = fuseG.userData.at, nz = L * 0.455, an = at(0.44);
      add(new THREE.ConeGeometry(an.hw * 0.92, L * 0.14, 24).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6a6e6a, roughness: .5 }), root, 0, an.yc, nz + L * 0.07);
      // duto lateral: perfil trapezoidal (boca inclinada, afina até a raiz da asa) extrudado para fora
      const zf = L * 0.25, zb = -L * 0.04, a = at(0.12), shp = new THREE.Shape();
      shp.moveTo(-zf, 0.32); shp.lineTo(-zb, 0.12); shp.lineTo(-zb, -0.42); shp.lineTo(-(zf - L * 0.045), -0.78); shp.closePath();
      const duct = new THREE.ExtrudeGeometry(shp, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 }).rotateY(Math.PI / 2);
      const slant = Math.atan2(L * 0.045, 1.1);
      for (const s of [1, -1]) {
        const x0 = s > 0 ? a.hw - 0.2 : -(a.hw - 0.2) - 0.5;
        add(duct, paint, root, x0, a.yc, 0);
        const mouth = add(new THREE.PlaneGeometry(0.42, 0.98), black, root, s * (a.hw + 0.05), a.yc - 0.23, zf - L * 0.022 + 0.07);
        mouth.rotation.x = -slant;
        add(new THREE.BoxGeometry(0.03, 1.15, 0.7), paint, root, s * (a.hw - 0.28), a.yc - 0.22, zf - 0.25); // placa separadora
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
  for (const t of C.frames) add(canopyFrame(C.len, C.w, C.h, t), dark, root, 0, cy, czc);
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
    } else {
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
  const cutSurface = (o, cf, moving, parent, fin) => {
    const gs = [wingGeometry(Object.assign({}, o, { sub: { s0: 0, s1: 1, a: 0, b: cf } }))];
    const sp = moving.map(m => [m[1], m[2]]).sort((p, q) => p[0] - q[0]);
    let s0 = 0;
    for (const [a, b] of [...sp, [1, 1]]) { if (a - s0 > 0.005) gs.push(wingGeometry(Object.assign({}, o, { sub: { s0, s1: a, a: cf, b: 1 }, cap0: true }))); s0 = Math.max(s0, b); }
    const g = mergePair(gs); if (fin) finXf(g, o);
    const mesh = add(g, fin ? paint : pair, parent);
    for (const [name, a, b, max] of moving) hinge(name, o, a, b, cf, parent, max, fin);
    return mesh;
  };
  const wing = side => {
    const grp = new THREE.Group(); root.add(grp);
    const o = wingCfg(side), sd = side > 0 ? 'L' : 'R', A = D.ail || SURF.ail, F = D.flap || SURF.flap;
    cutSurface(o, SURF.cf, [['ail' + sd, A[0], A[1], 20], ['flap' + sd, F[0], F[1], 40]], grp);
    const tipY = -fr * 0.25 + (D.wingBreak ? half * (D.wingBreak[0] * Math.tan(dih) + (1 - D.wingBreak[0]) * Math.tan(D.wingBreak[1] * deg)) : half * Math.tan(dih));
    if (D.stripes) for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.3, 0.02, D.chord * 0.86), i % 2 ? black : white, grp, side * (fr + 1.0 + i * 0.3), -fr * 0.25 - 0.17 + (1 + i * 0.3) * Math.tan(dih), D.wingZ - D.chord * 0.2);
    if (D.key === 'mig15') for (const k of [0.38, 0.7]) { const sx = fr * 0.55 + half * k, sw = half * k * Math.tan(D.sweep * deg); add(new THREE.BoxGeometry(0.03, 0.18, D.chord * 0.85), paint, grp, side * sx, -fr * 0.25 + half * k * Math.tan(dih) + 0.12, D.wingZ - sw - D.chord * 0.2); }
    if (D.key === 'spit9') add(new THREE.BoxGeometry(0.45, 0.22, 1.1), paint, grp, side * (fr + 1.0), -fr * 0.25 - 0.22, D.wingZ - 0.4); // radiadores sob a asa
    add(new THREE.SphereGeometry(0.07, 6, 4), accent, grp, side * (fr * 0.55 + half), tipY, D.wingZ - (D.sweep ? half * Math.tan(D.sweep * deg) : 0) - D.tipChord * 0.2); // luz de navegação
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
  const prop = new THREE.Group(); prop.position.set(0, 0, L * 0.45 + (jet ? 0.05 : 0.3)); root.add(prop);
  if (sideIn) prop.add(new THREE.Group()); // sem boca no nariz: o grupo existe só para o contrato (último filho)
  else if (jet && D.shockCone) {
    // cone de choque do MiG-21 (carrega o radar) na boca circular
    add(new THREE.ConeGeometry(D.noseR * 0.62, D.noseR * 2.2, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a4f4a, roughness: .5, metalness: .3 }), prop, 0, 0, 0.3);
    add(new THREE.CircleGeometry(D.noseR * 0.85, 20), black, prop, 0, 0, -0.35);
  } else if (jet) {
    add(new THREE.CylinderGeometry(D.noseR * 0.25, D.noseR * 0.25, 0.4, 10).rotateX(Math.PI / 2), dark, prop, 0, D.key === 'f86' ? 0 : D.noseR * 0.45, -0.3); // separador/radar
    add(new THREE.CircleGeometry(D.noseR * 0.85, 20), black, prop, 0, 0, -0.35);
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
      let x, y, z;
      if (belly) { const k = Math.floor(i / 2); x = side * fr * 0.5; y = -fr * 0.92; z = D.wingZ + 1.2 - k * (M.len + 0.6); }
      else {
        const k = Math.floor(wk++ / 2), sx = D.span * (0.24 + 0.1 * k);
        x = side * sx; y = -fr * 0.25 + (sx - fr * 0.55) * Math.tan(dih) - 0.32; z = D.wingZ - (D.sweep ? sx * Math.tan(D.sweep * deg) * 0.8 : 0) + 0.4;
        add(new THREE.BoxGeometry(0.05, 0.14, M.len * 0.5), paint, root, x, y + 0.13, z); // pilone
      }
      const m = add(missileGeometry(M), [white, M.seeker === 'sarh' ? white : glass], root, x, y, z);
      missileMeshes.push(m);
    }
  }
  // pitot na ponta da asa esquerda / nariz dos jatos
  add(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 4).rotateX(Math.PI / 2), dark, jet ? root : wingL, jet ? fr * 0.7 : fr * 0.55 + half * 0.82, jet ? 0.3 : -fr * 0.25 + half * 0.82 * Math.tan(dih) - 0.1, jet ? L * 0.47 : D.wingZ + D.chord * 0.25);
  const ws = 0.72, wz = D.wingZ + D.chord * 0.1 - half * ws * Math.tan((D.sweep || 0) * deg);
  planeDecals(D, root, wingL, wingR, { y: -fr * 0.25 + half * ws * Math.tan(dih) + D.chord * 0.075, x: fr * 0.55 + half * ws, z: wz - D.chord * 0.1, size: Math.min(D.chord * 0.7, 1.6), fuseAt: fuseG.userData.at });
  // efeitos presos ao avião (chama da PC, fogo do WEP, cone de vapor) — fora da fusão de malhas
  const fx = buildPlaneFx(D, root, nozzles, stacks);
  // une as peças estáticas por material (menos draw calls); superfícies que se soltam ou somem ficam à parte
  const keep = new Set([...bombMeshes, ...rocketMeshes, ...missileMeshes]);
  for (const grp of [root, wingL, wingR, tail]) mergeStatic(grp, keep);
  root.traverse(o => { if (o.isMesh) o.userData.normalMat = o.material; });
  return { root, wingL, wingR, tail, prop, bombMeshes, rocketMeshes, missileMeshes, mats: [paint, under], fx, surf };
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
function canopyFrame(len, w, h, t) {
  const pts = []; const P = [0, 0, 0];
  for (let j = 0; j <= 12; j++) { canopyPoint(len, w * 1.006, h * 1.006, t, j / 12 * Math.PI, P); pts.push(new THREE.Vector3(...P)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.02, 5, false);
}
