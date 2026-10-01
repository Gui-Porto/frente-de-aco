import * as THREE from 'three';
import { planeDecals, camoTexture } from './paint.js';
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
// Grupo 0 = extradorso (cor de cima), grupo 1 = intradorso e ponta.
export function wingGeometry(o) {
  const N = 14, R = 2 * NP - 2, pos = [], uv = [], up = [], low = [];
  for (let j = 0; j <= N; j++) {
    const s = j / N;
    const c = o.ellip ? Math.max(o.c0 * Math.sqrt(1 - Math.min(s, 0.985) ** 2), o.c1 || 0) : o.c0 + (o.c1 - o.c0) * s;
    const zq = o.zq0 - o.sweep * s, zle = zq + 0.25 * c, x = o.side * (o.x0 + s * o.half);
    const t = (o.t0 + (o.t1 - o.t0) * s) * c, y = o.y0 + s * o.half * Math.tan(o.dih);
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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...up, ...low]); g.addGroup(0, up.length, 0); g.addGroup(up.length, low.length, 1);
  g.computeVertexNormals();
  return g;
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
  const st = FUSE[kind].map(r => r.map((v, i) => (typeof v === 'string' ? nr * +v.slice(1) : v) * (i === 3 ? (r[0] < 0.3 ? belly : 1) : i === 2 ? tall : 1)));
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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...top, ...bot]); g.addGroup(0, top.length, 0); g.addGroup(top.length, bot.length, 1);
  g.computeVertexNormals();
  // amostra da seção numa fração z (para insígnias e acessórios encostarem na chapa)
  g.userData.at = zf => { let r = rings[0]; for (const q of rings) if (q[0] <= zf) r = q; return { hw: r[1] * fr, h: Math.min(r[2], r[3]) * fr, yc: r[4] * fr }; };
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
function metalTexture() {
  if (metalTex) return metalTex;
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#c4c7c8'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 46; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '40,45,50'},${Math.random() * .08})`; g.fillRect(Math.floor(Math.random() * 8) * 64, Math.floor(Math.random() * 16) * 32, 64, 32); }
  g.strokeStyle = 'rgba(60,64,68,.2)'; g.lineWidth = 1.2;
  for (let x = 0; x <= 512; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  for (let y = 0; y <= 512; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  g.fillStyle = 'rgba(70,74,78,.25)'; for (let x = 0; x < 512; x += 64) for (let y = 4; y < 512; y += 8) g.fillRect(x + 3, y, 1.4, 1.4);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * .05})`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 1); }
  metalTex = new THREE.CanvasTexture(c); metalTex.colorSpace = THREE.SRGBColorSpace; metalTex.wrapS = metalTex.wrapT = THREE.RepeatWrapping; metalTex.anisotropy = 8;
  return metalTex;
}

export function buildPlane(D) {
  const root = new THREE.Group(), L = D.L, fr = D.fuseR, jet = !!D.jet;
  const paint = jet
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, map: metalTexture(), roughness: 0.32, metalness: 0.78 })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, map: camoTexture(D), roughness: 0.58, metalness: 0.18 });
  const under = jet ? paint : new THREE.MeshStandardMaterial({ color: D.key === 'il2' ? 0x6f8aa0 : D.key === 'fw190' ? 0x9aa3a6 : D.key === 'spit9' ? 0x9ea19a : 0x8d8c80, roughness: .6, metalness: .2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: .45, metalness: .5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x3a4c58, roughness: .05, metalness: .9, transparent: true, opacity: .62 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: .7 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: .7 });
  const accent = new THREE.MeshStandardMaterial({ color: D.nation === 'URSS' ? 0xa8231b : D.nation === 'Alemanha' ? 0xc9b440 : D.nation === 'Reino Unido' ? 0xc9c2a8 : 0x23305a, roughness: .55, metalness: .2 });
  const pair = [paint, under];
  const add = (g, m, p = root, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; p.add(o); return o; };
  // fuselagem, coberta inferior e nariz
  const fuseG = fuselage(D); add(fuseG, pair);
  if (jet) {
    add(new THREE.TorusGeometry(D.noseR * 0.9, 0.07, 8, 28), paint, root, 0, 0, L * 0.46);           // lábio da entrada de ar
    add(new THREE.CylinderGeometry(fr * 0.5, fr * 0.46, 0.5, 18, 1, true).rotateX(Math.PI / 2), dark, root, 0, 0, -L * 0.53); // tubeira
    add(new THREE.CircleGeometry(fr * 0.46, 18).rotateY(Math.PI), black, root, 0, 0, -L * 0.52);
  } else {
    if (D.cowl === 'radial') { add(new THREE.TorusGeometry(D.noseR * 0.93, 0.06, 8, 28), dark, root, 0, 0, L * 0.43); add(new THREE.CylinderGeometry(D.noseR * 0.92, D.noseR * 0.98, 0.25, 28, 1, true).rotateX(Math.PI / 2), dark, root, 0, 0, L * 0.22); }
    else for (const s of [1, -1]) for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.12, 0.09, 0.2), dark, root, s * fr * 0.88, fr * 0.42, L * 0.36 - i * 0.24); // escapamentos
    add(new THREE.CylinderGeometry(fr * 0.25, fr * 0.32, 0.6, 12).rotateX(Math.PI / 2), dark, root, 0, -fr * 0.95, D.key === 'p47' ? L * 0.2 : -L * 0.08); // radiador/tomada de ar ventral
  }
  // cabine: bolha de vidro com montantes
  const cz = jet ? L * 0.24 : D.key === 'il2' ? L * 0.08 : -L * 0.02;
  const can = add(new THREE.SphereGeometry(0.55, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass, root, 0, fr * 0.92, cz);
  can.scale.set(0.95, jet ? 0.95 : 0.72, jet ? 2.4 : 2.1);
  for (const dz of jet ? [0.5] : [0.55, -0.15]) { const r = add(new THREE.TorusGeometry(0.52, 0.035, 6, 16, Math.PI), dark, root, 0, fr * 0.92, cz + dz); r.scale.set(0.95, jet ? 0.95 : 0.72, 1); }
  add(new THREE.BoxGeometry(0.04, 0.05, 1.9), dark, root, 0, fr * 0.92 + 0.52 * (jet ? 1 : 0.72), cz);
  // asas (grupos separados para poder perdê-las)
  const ellip = D.key === 'spit9' || D.key === 'p47';
  const dih = (D.dih ?? (jet ? (D.key === 'mig15' ? -2 : 3) : 5.5)) * deg;
  const half = D.span / 2 - fr * 0.55;
  const wingCfg = side => ({ side, x0: fr * 0.55, half, c0: D.chord, c1: ellip ? D.tipChord * 0.35 : D.tipChord, zq0: D.wingZ + D.chord * 0.1, sweep: half * Math.tan((D.sweep || 0) * deg) + (ellip ? 0 : (D.chord - D.tipChord) * 0.1), t0: jet ? 0.1 : 0.15, t1: jet ? 0.08 : 0.09, dih, y0: -fr * 0.25, ellip });
  const wing = side => {
    const grp = new THREE.Group(); root.add(grp);
    add(wingGeometry(wingCfg(side)), pair, grp);
    const tipY = -fr * 0.25 + half * Math.tan(dih);
    if (D.stripes) for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.3, 0.02, D.chord * 0.86), i % 2 ? black : white, grp, side * (fr + 1.0 + i * 0.3), -fr * 0.25 - 0.17 + (1 + i * 0.3) * Math.tan(dih), D.wingZ - D.chord * 0.2);
    if (D.key === 'mig15') for (const k of [0.38, 0.7]) { const sx = fr * 0.55 + half * k, sw = half * k * Math.tan(D.sweep * deg); add(new THREE.BoxGeometry(0.03, 0.18, D.chord * 0.85), paint, grp, side * sx, -fr * 0.25 + half * k * Math.tan(dih) + 0.12, D.wingZ - sw - D.chord * 0.2); }
    if (D.key === 'spit9') add(new THREE.BoxGeometry(0.45, 0.22, 1.1), paint, grp, side * (fr + 1.0), -fr * 0.25 - 0.22, D.wingZ - 0.4); // radiadores sob a asa
    add(new THREE.SphereGeometry(0.07, 6, 4), accent, grp, side * (fr * 0.55 + half), tipY, D.wingZ - (D.sweep ? half * Math.tan(D.sweep * deg) : 0) - D.tipChord * 0.2); // luz de navegação
    return grp;
  };
  const wingL = wing(1), wingR = wing(-1);
  // empenagem: estabilizador e deriva também com perfil
  const tail = new THREE.Group(); root.add(tail);
  const tsw = jet ? 38 : 4, th = D.span * 0.19, tc = L * 0.13, finH = L * 0.17;
  const stabY = D.key === 'mig15' ? finH * 0.55 : 0.08;
  for (const s of [1, -1]) add(wingGeometry({ side: s, x0: 0.05, half: th, c0: tc, c1: tc * 0.5, zq0: -L * 0.44, sweep: th * Math.tan(tsw * deg), t0: 0.1, t1: 0.08, dih: 0, y0: stabY, ellip: !jet }), pair, tail);
  const fin = add(wingGeometry({ side: 1, x0: 0, half: finH, c0: tc * 1.25, c1: tc * 0.55, zq0: -L * 0.43, sweep: finH * Math.tan((jet ? 45 : 18) * deg), t0: 0.1, t1: 0.08, dih: 0, y0: 0, ellip: false }), paint, tail);
  fin.rotation.z = Math.PI / 2; fin.position.y = fr * 0.6;
  add(new THREE.BoxGeometry(0.06, finH * 0.32, 0.04), accent, tail, 0, fr * 0.6 + finH * 0.82, -L * 0.43 - finH * Math.tan((jet ? 45 : 18) * deg) * 0.85); // faixa da deriva
  // hélice / entrada de ar (a física gira este grupo; o último filho some com o motor parado)
  const prop = new THREE.Group(); prop.position.set(0, 0, L * 0.45 + (jet ? 0.05 : 0.3)); root.add(prop);
  if (jet) {
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
  const missileMeshes = [];
  if (D.missiles) for (let i = 0; i < D.missiles.n; i++) {
    const side = i % 2 ? -1 : 1, x = side * D.span * 0.3, y = -fr * 0.25 + (D.span * 0.3 - fr * 0.55) * Math.tan(dih) - 0.32, z = D.wingZ - (D.sweep ? (D.span * 0.3) * Math.tan(D.sweep * deg) : 0) + 0.4;
    add(new THREE.BoxGeometry(0.06, 0.18, 1.6), dark, root, x, y + 0.14, z); // pilone
    const m = add(new THREE.CylinderGeometry(.064, .064, 2.6, 12).rotateX(Math.PI / 2), white, root, x, y, z);
    add(new THREE.ConeGeometry(.064, .25, 12).rotateX(Math.PI / 2), glass, m, 0, 0, 1.42);
    for (const r of [0, Math.PI / 2]) { const f = add(new THREE.BoxGeometry(.5, .015, .28), white, m, 0, 0, -1.1); f.rotation.z = r; const c = add(new THREE.BoxGeometry(.3, .015, .14), white, m, 0, 0, 0.95); c.rotation.z = r; }
    missileMeshes.push(m);
  }
  // pitot na ponta da asa esquerda / nariz dos jatos
  add(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 4).rotateX(Math.PI / 2), dark, jet ? root : wingL, jet ? fr * 0.7 : fr * 0.55 + half * 0.82, jet ? 0.3 : -fr * 0.25 + half * 0.82 * Math.tan(dih) - 0.1, jet ? L * 0.47 : D.wingZ + D.chord * 0.25);
  const ws = 0.72, wz = D.wingZ + D.chord * 0.1 - half * ws * Math.tan((D.sweep || 0) * deg);
  planeDecals(D, root, wingL, wingR, { y: -fr * 0.25 + half * ws * Math.tan(dih) + D.chord * 0.075, x: fr * 0.55 + half * ws, z: wz - D.chord * 0.1, size: Math.min(D.chord * 0.7, 1.6), fuseAt: fuseG.userData.at });
  root.traverse(o => { if (o.isMesh) o.userData.normalMat = o.material; });
  return { root, wingL, wingR, tail, prop, bombMeshes, rocketMeshes, missileMeshes, mats: [paint, under] };
}
