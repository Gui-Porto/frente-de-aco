import * as THREE from 'three';
import { scene } from '../core/render.js';
import { rand } from '../core/util.js';
import { AIRFIELDS } from './terrain.js';
// =====================================================================
// Bases aéreas da Batalha Aérea (uma por equipe, em AIRFIELDS): pista de
// concreto com marcações, pista de táxi e pátio, hangares em arco, torre,
// biruta e luzes de borda. Tudo criado no carregamento (shaders compilados
// junto com a cena). Pousar e parar na própria base repara e rearma.
// =====================================================================
function canvasTex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); }
  return t;
}
const noise = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2 + Math.random() * 3); } };
// pista inteira numa textura (comprida): placas de concreto, marcas de pneu na zona de toque,
// faixa central tracejada, cabeceiras "piano" e números
function runwayTex(a) {
  return canvasTex(256, 4096, (g, w, h) => {
    g.fillStyle = '#7d7b74'; g.fillRect(0, 0, w, h);
    const slab = h / (a.len / 7.5);
    for (let y = 0; y < h; y += slab) for (let x = 0; x < w; x += w / 6) { const k = (Math.random() - 0.5) * 14 | 0; g.fillStyle = `rgb(${125 + k},${123 + k},${116 + k})`; g.fillRect(x + 1, y + 1, w / 6 - 2, slab - 2); }
    noise(g, w, h, 30000, 0.06);
    // marcas de pneu escuras perto das duas cabeceiras
    for (const y0 of [h * 0.08, h * 0.72]) for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(25,24,22,${rand(.04, .12)})`; g.fillRect(w / 2 + rand(-40, 40), y0 + rand(0, h * 0.2), rand(3, 9), rand(30, 120)); }
    g.fillStyle = '#e6e3d8';
    for (let y = h * 0.1; y < h * 0.9; y += 64) g.fillRect(w / 2 - 3, y, 6, 36);                     // faixa central
    for (const top of [true, false]) {
      const y = top ? 20 : h - 20 - 70;
      for (let i = 0; i < 8; i++) { const x = 18 + i * 28 + (i >= 4 ? 16 : 0); g.fillRect(x, y, 14, 70); } // cabeceira
      g.fillRect(8, top ? 110 : h - 150, w - 16, 10);                                                  // barra de cabeceira
    }
    g.font = 'bold 64px Impact, sans-serif'; g.textAlign = 'center';
    g.save(); g.translate(w / 2, 220); g.fillText('18', 0, 0); g.restore();
    g.save(); g.translate(w / 2, h - 220); g.rotate(Math.PI); g.fillText('36', 0, 0); g.restore();
    g.fillRect(6, 0, 3, h); g.fillRect(w - 9, 0, 3, h); // faixas laterais
  });
}
const asphalt = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#4a4944'; g.fillRect(0, 0, w, h); noise(g, w, h, 9000, 0.09); }, [10, 10]);
const tin = canvasTex(256, 64, (g, w, h) => { for (let x = 0; x < w; x += 8) { const k = x % 16 ? 0 : 18; g.fillStyle = `rgb(${92 + k},${96 + k},${88 + k})`; g.fillRect(x, 0, 8, h); } noise(g, w, h, 2500, 0.1); for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(110,60,30,${rand(.05, .15)})`; g.fillRect(rand(0, w), rand(0, h), rand(4, 14), rand(10, 60)); } }, [6, 2]);

const M = {
  apron: new THREE.MeshStandardMaterial({ map: asphalt, roughness: .95 }),
  hangar: new THREE.MeshStandardMaterial({ map: tin, roughness: .7, metalness: .35 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x23231f, roughness: .9 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xb8b2a2, roughness: .85 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x2c3b44, roughness: .1, metalness: .8 }),
  sock: new THREE.MeshStandardMaterial({ color: 0xe8662a, roughness: .7 }),
  pole: new THREE.MeshStandardMaterial({ color: 0xdedbd0, roughness: .6 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffd58a, emissiveIntensity: 1.6 }),
};
const socks = [];
for (const a of AIRFIELDS) {
  const grp = new THREE.Group(); grp.position.set(a.x, a.h, a.z); scene.add(grp);
  const flat = (w, l, mat, x, z, y = 0.06) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), mat); m.position.set(x, y, z); m.receiveShadow = true; grp.add(m); return m; };
  flat(a.w, a.len, new THREE.MeshStandardMaterial({ map: runwayTex(a), roughness: .9 }), 0, 0, 0.08);
  const side = a.team === 1 ? 1 : -1, tx = side * (a.w / 2 + 70);           // pista de táxi paralela e pátio do lado de dentro
  const ta = flat(18, a.len * 0.8, M.apron, tx, 0); ta.material = M.apron.clone(); ta.material.map = asphalt.clone(); ta.material.map.repeat.set(2, 60); ta.material.map.needsUpdate = true;
  for (const z of [-a.len * 0.38, 0, a.len * 0.38]) flat(70, 14, M.apron, side * (a.w / 2 + 35), z, 0.07);      // ligações
  flat(140, 260, M.apron, side * (a.w / 2 + 145), 0, 0.065);                                                   // pátio
  // hangares em arco (semicilindro de chapa ondulada) com portão escuro
  for (let i = 0; i < 3; i++) {
    const hg = new THREE.Group(); hg.position.set(side * (a.w / 2 + 200), 0, -90 + i * 90); hg.rotation.y = side > 0 ? Math.PI : 0; grp.add(hg); // portão virado para a pista
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 40, 28, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), M.hangar); shell.castShadow = shell.receiveShadow = true; hg.add(shell);
    const back = new THREE.Mesh(new THREE.CircleGeometry(15, 28, 0, Math.PI), M.wall); back.position.x = -20; back.rotation.y = -Math.PI / 2; hg.add(back);
    const door = new THREE.Mesh(new THREE.CircleGeometry(14.6, 28, 0, Math.PI), M.dark); door.position.x = 19.8; door.rotation.y = Math.PI / 2; hg.add(door);
  }
  // torre de controle
  const tw = new THREE.Mesh(new THREE.BoxGeometry(7, 12, 7), M.wall); tw.position.set(side * (a.w / 2 + 120), 6, 170); tw.castShadow = true; grp.add(tw);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(8.5, 3.2, 8.5), M.glass); cab.position.set(tw.position.x, 13.6, 170); grp.add(cab);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.5, 9.5), M.dark); roof.position.set(tw.position.x, 15.4, 170); grp.add(roof);
  // biruta (gira devagar com o vento)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 8, 6), M.pole); pole.position.set(side * (a.w / 2 + 25), 4, -a.len * 0.42); grp.add(pole);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.2, 10, 1, true).rotateZ(Math.PI / 2).translate(1.6, 0, 0), M.sock); sock.position.set(pole.position.x, 7.6, pole.position.z); grp.add(sock); socks.push(sock);
  // luzes de borda (uma malha instanciada por base)
  const n = Math.floor(a.len / 60) + 1, L = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), M.lamp, n * 2), m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) for (const s of [1, -1]) L.setMatrixAt(i * 2 + (s > 0 ? 0 : 1), m4.makeTranslation(s * (a.w / 2 + 2), 0.25, -a.len / 2 + i * 60));
  grp.add(L);
  a.group = grp;
}
let t = 0;
export function updateAirfields(dt) { t += dt; for (const s of socks) s.rotation.y = 0.6 + Math.sin(t * 0.3) * 0.35 + Math.sin(t * 1.7) * 0.05; }
