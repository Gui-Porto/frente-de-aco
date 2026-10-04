import * as THREE from 'three';
import { rand } from '../core/util.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

// Camuflagem procedural por nação, com desgaste e sujeira
const cache = new Map();
// extra(g, size): desenho por cima (aviões: juntas dos painéis na mesma planta do relevo)
export function camoTexture(D, extra) {
  if (cache.has(D.key)) return cache.get(D.key);
  const c = document.createElement('canvas'); c.width = c.height = extra ? 1024 : 512; if (extra) c.getContext('2d').scale(2, 2); const g = c.getContext('2d');
  const base = '#' + new THREE.Color(D.color).getHexString();
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  const blob = (col, n, rmin, rmax) => {
    g.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const x = rand(0, 512), y = rand(0, 512), r = rand(rmin, rmax);
      g.beginPath();
      for (let a = 0; a <= 12; a++) { const t = a / 12 * Math.PI * 2, rr = r * rand(0.6, 1.3); g.lineTo(x + Math.cos(t) * rr * 1.6, y + Math.sin(t) * rr); }
      g.closePath(); g.fill();
    }
  };
  if (D.nation === 'Alemanha') { blob('#3d4a2a', 22, 20, 46); blob('#5a3f2a', 16, 14, 34); }
  else if (D.nation === 'URSS') { blob('rgba(40,55,30,.35)', 30, 20, 60); }
  else { blob('rgba(35,40,22,.3)', 30, 20, 60); }
  // variação, desgaste nas bordas e lama embaixo
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${rand(0, .07)})`; g.fillRect(rand(0, 512), rand(0, 512), rand(1, 3), rand(1, 3)); }
  for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(30,25,18,${rand(.08, .2)})`; g.lineWidth = rand(1, 3); const x = rand(0, 512); g.beginPath(); g.moveTo(x, rand(0, 200)); g.lineTo(x + rand(-6, 6), rand(260, 512)); g.stroke(); }
  const gr = g.createLinearGradient(0, 512, 0, 300); gr.addColorStop(0, 'rgba(70,58,38,.55)'); gr.addColorStop(1, 'rgba(70,58,38,0)'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  if (extra) { g.setTransform(1, 0, 0, 1, 0, 0); extra(g, 1024); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.repeat.set(0.35, 0.35);
  cache.set(D.key, t);
  return t;
}
function decal(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 128; draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const DEC = {
  star: decal(g => { g.translate(64, 64); g.strokeStyle = '#e8e4d8'; g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 56, 0, 7); g.stroke(); g.fillStyle = '#e8e4d8'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 19 : 48, a = i / 10 * Math.PI * 2 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); }),
  cross: decal(g => { g.translate(64, 64); g.fillStyle = '#f0ece0'; g.fillRect(-46, -16, 92, 32); g.fillRect(-16, -46, 32, 92); g.fillStyle = '#151515'; g.fillRect(-38, -8, 76, 16); g.fillRect(-8, -38, 16, 76); }),
};
function numTex(n, color) { return decal(g => { g.fillStyle = color; g.font = 'bold 74px "Saira Stencil One", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 64, 68); }); }
// Insígnias e números de torre como decalques (planos levemente afastados da chapa)
export function addDecals(D, root, turret) {
  const plane = (tex, size, parent, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: .9 }));
    m.position.set(x, y, z); m.rotation.y = ry; parent.add(m); return m;
  };
  const T = D.turret, yH = D.clr + D.Hh;
  const num = Math.floor(rand(100, 999));
  if (D.nation === 'EUA') {
    for (const s of [1, -1]) plane(DEC.star, 0.8, root, s * (D.W / 2 + 0.01), yH - D.Hh * 0.28, -D.L * 0.05, s * Math.PI / 2);
    for (const s of [1, -1]) plane(DEC.star, 0.55, turret, s * (T.w / 2 + 0.02), T.h * 0.55, -0.1, s * Math.PI / 2);
  } else if (D.nation === 'URSS') {
    const tx = numTex(num, '#e8e4d8');
    for (const s of [1, -1]) plane(tx, 0.75, turret, s * (T.w / 2 + 0.02), T.h * 0.5, -0.15, s * Math.PI / 2);
  } else {
    for (const s of [1, -1]) plane(DEC.cross, 0.6, root, s * (D.W / 2 + 0.01), yH - D.Hh * 0.28, -D.L * 0.12, s * Math.PI / 2);
    const tx = numTex(num, '#1a1a1a');
    for (const s of [1, -1]) plane(tx, 0.7, turret, s * (T.w / 2 + 0.02), T.h * 0.5, -T.l * 0.1, s * Math.PI / 2);
  }
}

// ---------- aviões: insígnias projetadas na chapa ----------
// textura 512 px (desenho em coordenadas de 128, escalado) com mipmaps e anisotropia: nítida de perto e de longe
function decal512(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); g.scale(4, 4); draw(g);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const starPath = (g, R, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const rr = i % 2 ? r : R, a = i / 10 * Math.PI * 2 - Math.PI / 2; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); };
const disks = rings => decal512(g => { g.translate(64, 64); for (const [r, c] of rings) { g.fillStyle = c; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); } });
const AIR = {
  // EUA (1947+): estrela branca no disco azul, barras brancas com a faixa vermelha, tudo com contorno azul
  EUA: decal512(g => {
    g.translate(64, 64); const B = '#1d2f5a', W = '#ece8dc';
    g.fillStyle = B; g.fillRect(-63, -12, 126, 24); g.beginPath(); g.arc(0, 0, 33, 0, 7); g.fill();
    g.fillStyle = W; g.fillRect(-60, -9.5, 120, 19); starPath(g, 31, 12); g.fill();
    g.fillStyle = '#b3241c'; g.fillRect(-58, -3.6, 34, 7.2); g.fillRect(24, -3.6, 34, 7.2);
  }),
  // VVS: estrela vermelha com borda branca fina e filete vermelho
  URSS: decal512(g => { g.translate(64, 64); g.fillStyle = '#b3241c'; starPath(g, 60, 25); g.fill(); g.fillStyle = '#ece8dc'; starPath(g, 55, 22.5); g.fill(); g.fillStyle = '#b3241c'; starPath(g, 50, 20.5); g.fill(); }),
  // Balkenkreuz de 1941+: cruz preta com bordas brancas
  Alemanha: decal512(g => { g.translate(64, 64); g.fillStyle = '#ece8dc'; g.fillRect(-52, -16, 104, 32); g.fillRect(-16, -52, 32, 104); g.fillStyle = '#141414'; g.fillRect(-44, -9, 88, 18); g.fillRect(-9, -44, 18, 88); }),
  // RAF tipo C1 (fuselagem)
  'Reino Unido': disks([[60, '#d9b53a'], [53, '#27345e'], [28, '#ece8dc'], [22, '#a82a22']]),
};
// RAF tipo B (extradorso: sem branco nem amarelo) e C (intradorso)
const RAF_B = disks([[60, '#27345e'], [24, '#a82a22']]), RAF_C = disks([[60, '#27345e'], [30, '#ece8dc'], [23, '#a82a22']]);
// faixas da deriva da RAF (vermelho na frente, branco, azul)
const FIN_FLASH = decal512(g => { for (const [x, w, c] of [[4, 52, '#a82a22'], [56, 12, '#ece8dc'], [68, 56, '#27345e']]) { g.fillStyle = c; g.fillRect(x, 6, w, 116); } });
// texto (número de série, número do nariz) no meio da textura, fundo transparente; px = altura da letra
const textCache = new Map();
const textTex = (txt, col, px, font, w = 1024, h = 256) => {
  const key = [txt, col, px, font, w, h].join('|'); if (textCache.has(key)) return textCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = col; g.font = `bold ${px}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2 + px * 0.06);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; textCache.set(key, t); return t;
};
const decalMats = new Map();
const decalMat = tex => { if (!decalMats.has(tex)) decalMats.set(tex, new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: .62, metalness: .05 })); return decalMats.get(tex); };
const _m4 = new THREE.Matrix4(), _eu = new THREE.Euler();
// decalque projetado na malha `mesh` (só as faces voltadas para fora), no ponto p, com o eixo u (direita da
// imagem) e v (topo); w, h = tamanho, depth = profundidade da caixa. Vai para o pai da malha.
function project(mesh, tex, p, u, v, w, h, depth) {
  const out = new THREE.Vector3().crossVectors(u, v).normalize();
  _m4.makeBasis(u, v, out); _eu.setFromRotationMatrix(_m4);
  const g = new DecalGeometry(mesh, p, _eu, new THREE.Vector3(w, h, depth));
  // tira as faces de trás (a caixa pega também o outro lado de asa fina ou de fuselagem estreita)
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, keep = { p: [], n: [], u: [] };
  if (!P) return null;
  for (let i = 0; i < P.count; i += 3) {
    let d = 0; for (let k = 0; k < 3; k++) d += N.getX(i + k) * out.x + N.getY(i + k) * out.y + N.getZ(i + k) * out.z;
    if (d / 3 < 0.25) continue;
    for (let k = 0; k < 3; k++) { keep.p.push(P.getX(i + k), P.getY(i + k), P.getZ(i + k)); keep.n.push(N.getX(i + k), N.getY(i + k), N.getZ(i + k)); keep.u.push(U.getX(i + k), U.getY(i + k)); }
  }
  if (!keep.p.length) return null;
  const q = new THREE.BufferGeometry();
  q.setAttribute('position', new THREE.Float32BufferAttribute(keep.p, 3)); q.setAttribute('normal', new THREE.Float32BufferAttribute(keep.n, 3)); q.setAttribute('uv', new THREE.Float32BufferAttribute(keep.u, 2));
  const m = new THREE.Mesh(q, decalMat(tex)); m.receiveShadow = true; m.userData.fx = true; mesh.parent.add(m); return m;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
// Insígnias e marcações por nação, projetadas na chapa (seguem a curvatura, sem flutuar nem atravessar).
// t = { fuse, fuseAt, wings: [[malha, { x, y (extradorso), yl (intradorso), z, size, dih, th }, lado]],
//       fin: { mesh, p: { y, z, size } }, serial, nose: { zf, n }, buzz: { zf, txt } }
export function planeDecals(D, t) {
  const N = D.nation, ins = AIR[N];
  t.fuse.updateWorldMatrix(true, true);
  // asas: no extradorso a imagem é vista de cima (direita = −x), no intradorso de baixo (direita = +x); o eixo u
  // segue o diedro. EUA: em cima só na asa esquerda e embaixo só na direita (como nos reais)
  const up = N === 'EUA' ? [1] : [1, -1], low = N === 'EUA' ? [-1] : [1, -1];
  for (const [mesh, w, sd] of t.wings) {
    mesh.updateWorldMatrix(true, false);
    const c = Math.cos(w.dih), s = Math.sin(w.dih);
    if (up.includes(sd)) project(mesh, N === 'Reino Unido' ? RAF_B : ins, V3(sd * w.x, w.y, w.z), V3(-c, -sd * s, 0), V3(0, 0, 1), w.size, w.size, w.th);
    if (low.includes(sd)) project(mesh, N === 'Reino Unido' ? RAF_C : ins, V3(sd * w.x, w.yl, w.z), V3(c, sd * s, 0), V3(0, 0, 1), w.size, w.size, w.th);
  }
  // fuselagem: vista de fora de cada lado (direita da imagem = cauda), na estação zf
  const L = D.L, zf = t.decalZ ?? -0.14, f = t.fuseAt(zf), sz = Math.min(f.hw * 2.1, (f.top - f.yc + f.h) * 0.92);
  for (const sd of [1, -1]) project(t.fuse, ins, V3(sd * f.hw, f.yc, L * zf), V3(0, 0, -sd), V3(0, 1, 0), N === 'EUA' ? sz * 1.9 : sz, sz, f.hw * 1.4);
  // deriva: faixas da RAF, estrela da VVS, número de série dos EUA
  if (t.fin) {
    const F = t.fin.p, fin = t.fin.mesh; fin.updateWorldMatrix(true, false);
    const finTex = N === 'Reino Unido' ? FIN_FLASH : N === 'URSS' ? ins : N === 'EUA' ? textTex(t.serial, '#161616', 150, '"Arial Narrow", Arial, sans-serif') : null;
    const wd = N === 'EUA' ? F.size * 1.5 : F.size * (N === 'Reino Unido' ? 0.55 : 0.75), ht = N === 'EUA' ? F.size * 0.38 : N === 'Reino Unido' ? F.size * 0.7 : wd;
    if (finTex) for (const sd of [1, -1]) project(fin, finTex, V3(0, F.y, F.z), V3(0, 0, -sd), V3(0, 1, 0), wd, ht, 0.5);
  }
  // número do nariz (VVS, vermelho) e "buzz number" dos jatos dos EUA na fuselagem dianteira
  const side = (zf, yk, txt, col, px, font, kw, kh) => { const a = t.fuseAt(zf), tx = textTex(txt, col, px, font, 512, 256); for (const sd of [1, -1]) project(t.fuse, tx, V3(sd * a.hw, a.yc + yk * (a.top - a.yc), L * zf), V3(0, 0, -sd), V3(0, 1, 0), a.hw * kw, a.hw * kh, a.hw * 1.2); };
  if (N === 'URSS' && t.nose) side(t.nose.zf, 0.25, t.nose.n, '#b3241c', 190, 'Impact, "Arial Black", sans-serif', 1.1, 0.55);
  if (N === 'EUA' && t.buzz) side(t.buzz.zf, -0.1, t.buzz.txt, '#161616', 120, '"Arial Black", Arial, sans-serif', 2.2, 1.1);
}
