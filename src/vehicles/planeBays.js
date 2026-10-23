import * as THREE from 'three';
import { station, chordAt, SURF } from './planeGeom.js';
// =====================================================================
// Alojamentos do trem (só visual). A planta vem de gearPlan (planeGeom.js): retângulo em planta onde a perna e a
// roda deitam recolhidas. A chapa é recortada exatamente nesse contorno — no intradorso da asa (wingGeometry
// com o.bay) e, onde a roda entra na fuselagem, no ventre (fuselage com bays) — e o pedaço tirado vira a porta.
// Aqui ficam a conta da planta e a cavidade: paredes do contorno até o teto (que segue o extradorso por dentro),
// nervuras, longarina, tubulação hidráulica e o suporte da perna.
// Eixos: +z nariz, +y cima, +x asa esquerda.
// =====================================================================
const yt = x => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);

// altura da chapa da asa (corpo principal, perfil comprimido até a dobradiça como em wingGeometry) em (x, z); sg −1 = intradorso
export function wingY(o, x, z, sg) {
  const s = Math.min(1, Math.max(0, (Math.abs(x) - o.x0) / o.half)), cw = chordAt(o, s), cf = SURF.cf;
  const zle = o.zq0 - o.sweep * s + 0.25 * cw, y = station(o, s, 0)[1], t = (o.t0 + (o.t1 - o.t0) * s) * cw;
  const xc = Math.min(1, Math.max(0, (zle - z) / (cf * cw)));
  return y + sg * yt(xc) * t + (sg > 0 ? 0.012 * cf * cw * Math.sin(Math.PI * xc) : 0);
}
// ventre da fuselagem em (x, z), ou null fora da largura; sec = fuseG.userData.sec
export function fuseBottom(sec, x, z) {
  const S = sec(z), W = S.hw; if (Math.abs(x) >= W) return null;
  const c = (Math.abs(x) / W) ** (1 / S.ex); return S.yc - S.bt * Math.sqrt(Math.max(0, 1 - c * c)) ** S.ex;
}
// planta final: main (lado +x), xj = onde a asa encontra o ventre; fuse = retângulos a cortar na fuselagem com o nome
export function gearBays(D, GP, o, sec) {
  const B = GP.bay, main = { ...B, xi: Math.max(0.03, B.xi) }, zs = [B.za, (B.za + B.zb) / 2, B.zb];
  // largura da fuselagem na altura do intradorso da raiz (o pior caso ao longo do vão): dali para dentro a boca é no ventre
  let xj = Infinity;
  for (const z of zs) {
    const S = sec(z), yl = wingY(o, o.x0, z, -1), d = (S.yc - yl) / S.bt;
    xj = Math.min(xj, d <= 0 ? S.hw : d >= 1 ? 0 : S.hw * (1 - d ** (2 / S.ex)) ** (S.ex / 2));
  }
  main.xj = xj > main.xi + 0.04 && xj < main.xo ? xj : null;
  main.wxi = main.xj ? xj : main.xi; // trecho da asa: de xj (ou xi) até xo
  const fuse = [], names = [];
  if (main.xj) for (const sd of [1, -1]) { fuse.push({ za: B.za, zb: B.zb, xa: sd > 0 ? main.xi : -main.xj, xb: sd > 0 ? main.xj : -main.xi }); names.push(sd > 0 ? 'L' : 'R'); }
  // bequilha fixa (pistão): sem alojamento — antes o recorte caía no fim do cone de cauda e a cauda ficava oca
  const nb = D.jet ? GP.nbay : null; if (nb) { fuse.push({ za: nb.za, zb: nb.zb, xa: -nb.w, xb: nb.w }); names.push('N'); }
  return { main, nose: nb, fuse, names };
}

// cor do interior do alojamento: cromato de zinco (EUA, anos 40), cinza-verde (RAF), RLM 02 (Luftwaffe),
// cinza-azulado (VVS), alumínio (jatos) e branco (F-4)
export function bayColor(D) {
  if (D.key === 'f4e') return 0xc4c3bb;
  if (D.jet) return 0x7f8382;
  return { EUA: 0x9aa05a, 'Reino Unido': 0x8c9486, Alemanha: 0x7d7e6c, URSS: 0x93a3a6 }[D.nation] || 0x8c9486;
}

// faces para dentro: confere a normal média contra o vetor até o centro e inverte se preciso
function orient(g, cx, cy, cz) {
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal; let acc = 0;
  for (let i = 0; i < p.count; i++) acc += n.getX(i) * (cx - p.getX(i)) + n.getY(i) * (cy - p.getY(i)) + n.getZ(i) * (cz - p.getZ(i));
  if (acc < 0) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } g.computeVertexNormals(); }
  return g;
}
const mesh = (pos, idx) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2)); g.setIndex(idx); return g; };

// cavidade de [x0, x1] × [za, zb(x)]: paredes do fundo (bot(x, z), a chapa) até o teto (top(x, z)) e o teto em grade.
// zb pode ser número ou função de |x| (a borda da frente acompanha o bordo de ataque enflechado)
function cavity(x0, x1, za, zb0, bot, top) {
  const zb = typeof zb0 === 'function' ? x => zb0(Math.abs(x)) : () => zb0;
  const per = [], step = 0.05;
  const seg = (ax, az, bx, bz) => { const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / step)); for (let i = 0; i < n; i++) per.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]); };
  { const n = Math.max(2, Math.ceil((x1 - x0) / step)); for (let i = 0; i < n; i++) { const x = x0 + (x1 - x0) * i / n; per.push([x, zb(x)]); } }
  seg(x1, zb(x1), x1, za); seg(x1, za, x0, za); seg(x0, za, x0, zb(x0));
  const pos = [], idx = [], n = per.length;
  for (const [x, z] of per) { pos.push(x, bot(x, z) - 0.004, z, x, Math.max(top(x, z), bot(x, z) + 0.05), z); }
  for (let i = 0; i < n; i++) { const a = 2 * i, b = 2 * ((i + 1) % n); idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const cx = (x0 + x1) / 2, cz = (za + zb(cx)) / 2, cy = (bot(cx, cz) + top(cx, cz)) / 2;
  const walls = orient(mesh(pos, idx), cx, cy, cz);
  const NX = Math.max(4, Math.ceil((x1 - x0) / 0.12)), NZ = Math.max(3, Math.ceil((zb(x0) - za) / 0.12)), cp = [], ci = [];
  for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) { const x = x0 + (x1 - x0) * i / NX, z = za + (zb(x) - za) * j / NZ; cp.push(x, Math.max(top(x, z), bot(x, z) + 0.05), z); }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) { const a = i * (NZ + 1) + j, b = a + NZ + 1; ci.push(a, b, a + 1, b, b + 1, a + 1); }
  const ceil = orient(mesh(cp, ci), cx, cy - 1, cz);
  return { walls, ceil, cx, cy, cz };
}

// monta os alojamentos: os principais em cada asa (pars = [asa +x, asa −x]: caem junto com ela) e o do nariz/bequilha
// em `root`; add(geo, mat, par)
// duct = duto de ar do nariz (fuselage userData.duct): o teto do alojamento do nariz passa por baixo dele
export function buildBays(add, root, pars, D, BAY, o, sec, M, duct = null) {
  const bayM = M.bay, line = M.steel, dark = M.dark, m = BAY.main;
  // principal (lado +x; o −x é o espelho): fundo = ventre até xj e intradorso daí para fora; teto = extradorso por
  // dentro (3 cm) sem passar de 18 cm acima do pivô — a roda deitada (±10 cm) cabe com folga
  const bot = (x, z) => (m.xj && x < m.xj ? fuseBottom(sec, x, z) ?? wingY(o, x, z, -1) : wingY(o, x, z, -1));
  const top = (x, z) => Math.min(wingY(o, x, z, 1) - 0.03, m.y0 + 0.18);
  const zbx = m.zbx || (() => m.zb), C = cavity(m.xi, m.xo, m.za, zbx, bot, top), parts = [];
  parts.push([C.walls, bayM], [C.ceil, bayM]);
  // nervuras no teto (ao longo da envergadura) e a alma da longarina na parede de trás; tubos hidráulicos na da frente
  const rib = (pts, r, mat) => parts.push([new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), Math.max(4, pts.length * 2), r, 5), mat]);
  for (let k = 1; k <= 3; k++) { const P = []; for (let i = 0; i <= 8; i++) { const x = m.xi + 0.04 + (m.xo - m.xi - 0.08) * i / 8, z = m.za + (zbx(x) - m.za) * k / 4; P.push([x, top(x, z) - 0.012, z]); } rib(P, 0.012, bayM); }
  for (let i = 1; i < 6; i++) { const x = m.xi + (m.xo - m.xi) * i / 6, z = m.za + 0.015, y0 = bot(x, z) + 0.02, y1 = top(x, z) - 0.01; if (y1 > y0 + 0.03) rib([[x, y0, z], [x, y1, z]], 0.01, bayM); }
  for (const [dy, r] of [[0.35, 0.008], [0.55, 0.006]]) { const P = []; for (let i = 0; i <= 8; i++) { const x = m.xi + 0.05 + (m.xo - m.xi - 0.1) * i / 8, z = zbx(x) - 0.025; P.push([x, bot(x, z) + (top(x, z) - bot(x, z)) * dy, z]); } rib(P, r, line); }
  // suporte da perna (munhão) no teto junto ao pivô
  const px = m.ret === 'out' ? m.xi + 0.08 : m.xo - 0.08, mz = (m.za + m.zb) / 2;
  parts.push([new THREE.BoxGeometry(0.1, 0.06, 0.24).translate(px, top(px, mz) - 0.03, mz), dark]);
  for (const sd of [1, -1]) for (const [g, mat] of parts) {
    const q = g.clone(), par = pars[sd > 0 ? 0 : 1]; if (sd < 0) { q.scale(-1, 1, 1); const ix = q.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } q.computeVertexNormals(); }
    add(q, mat, par);
  }
  // nariz/bequilha: só ventre; teto acima da roda em pé (pivô ny + roda), sem passar do meio da fuselagem
  const N = BAY.nose, nr = 0.28; if (!N) return;
  const nbot = (x, z) => fuseBottom(sec, x, z) ?? sec(z).yc - sec(z).bt, ntop = (x, z) => Math.min(N.y0 + nr + 0.06, sec(z).yc + sec(z).tp * 0.2, duct && z > duct.z - 0.08 ? duct.yc - duct.h - 0.02 : 9);
  const CN = cavity(-N.w, N.w, N.za, N.zb, nbot, ntop);
  add(CN.walls, bayM, root); add(CN.ceil, bayM, root);
  for (let k = 1; k <= 3; k++) { const z = N.za + (N.zb - N.za) * k / 4, P = []; for (let i = 0; i <= 4; i++) { const x = -N.w + 0.03 + (2 * N.w - 0.06) * i / 4; P.push(new THREE.Vector3(x, ntop(x, z) - 0.01, z)); } add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(P), 8, 0.01, 5), bayM, root); }
}
