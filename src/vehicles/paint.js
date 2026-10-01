import * as THREE from 'three';
import { rand } from '../core/util.js';

// Camuflagem procedural por nação, com desgaste e sujeira
const cache = new Map();
export function camoTexture(D) {
  if (cache.has(D.key)) return cache.get(D.key);
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
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

const AIR = {
  EUA: decal(g => { g.translate(64, 64); g.fillStyle = '#1d2f5a'; g.beginPath(); g.arc(0, 0, 40, 0, 7); g.fill(); g.fillStyle = '#ece8dc'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 15 : 38, a = i / 10 * Math.PI * 2 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.fillRect(28, -9, 34, 18); g.fillRect(-62, -9, 34, 18); }),
  URSS: decal(g => { g.translate(64, 64); g.fillStyle = '#ece8dc'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 24 : 58, a = i / 10 * Math.PI * 2 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.fillStyle = '#b3241c'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 19 : 50, a = i / 10 * Math.PI * 2 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); }),
  Alemanha: DEC.cross,
  // RAF tipo C1 (1943+): anel amarelo, azul, branco estreito e centro vermelho
  'Reino Unido': decal(g => { g.translate(64, 64); for (const [r, c] of [[58, '#d9b53a'], [50, '#27345e'], [26, '#ece8dc'], [20, '#a82a22']]) { g.fillStyle = c; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); } }),
};
// Insígnias nas asas e na fuselagem
// o (opcional): posição da insígnia no extradorso { x, y, z, size }, calculada pelo modelo da asa
export function planeDecals(D, root, wingL, wingR, o) {
  const tex = AIR[D.nation];
  const mk = (parent, size, x, y, z, rx, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: .8 }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); parent.add(m);
  };
  const w = o || { x: D.span * 0.36, y: 0.27 + D.span * 0.36 * 0.06, z: D.wingZ - D.chord * 0.15, size: D.chord * 0.75 };
  for (const [wg, s] of [[wingL, 1], [wingR, -1]]) mk(wg, w.size, s * w.x, w.y, w.z, -Math.PI / 2, 0);
  // lateral da fuselagem na estação da insígnia (vem do loft em planeModel; 2 cm para fora da chapa)
  const zf = -0.14, f = o && o.fuseAt ? o.fuseAt(zf) : { hw: D.fuseR * 0.82, yc: 0.05 };
  for (const s of [1, -1]) mk(root, Math.min(D.fuseR * 1.2, f.h * 1.5 || 9), s * (f.hw + 0.02), f.yc, D.L * zf, 0, s * Math.PI / 2);
}
