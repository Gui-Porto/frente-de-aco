import * as THREE from 'three';
import { scene } from '../core/render.js';
import { rand } from '../core/util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
// concreto: um bloco de 4×4 placas (7,5 m) com juntas e manchas, repetido ao longo da pista; a sinalização vem
// em geometria por cima (nítida de qualquer distância — a textura única de 4096 px esticada em 1,7 km borrava)
const concrete = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#86847c'; g.fillRect(0, 0, w, h);
  const c = w / 4;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const k = (Math.random() - 0.5) * 16 | 0; g.fillStyle = `rgb(${132 + k},${130 + k},${122 + k})`; g.fillRect(x * c + 2, y * c + 2, c - 4, c - 4); }
  noise(g, w, h, 16000, 0.06);
  g.fillStyle = 'rgba(40,38,34,.55)'; for (let k = 0; k <= 4; k++) { g.fillRect(k * c - 1, 0, 2, h); g.fillRect(0, k * c - 1, w, 2); } // juntas
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(60,56,50,${rand(.03, .08)})`; g.beginPath(); g.ellipse(rand(0, w), rand(0, h), rand(8, 40), rand(4, 20), rand(0, 3), 0, 7); g.fill(); }
}, [1, 1]);
function numTex(t) { return canvasTex(128, 192, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#eeece4'; g.font = 'bold 150px Impact, "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, w / 2, h / 2 + 6); }); }
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
  lamp: new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffd58a, emissiveIntensity: 1.6, fog: false }),
  // sinalização e luzes de pouso (as luzes sem névoa: furam a bruma como as reais e mostram a pista de longe)
  paintW: new THREE.MeshStandardMaterial({ color: 0xeceae2, roughness: .75 }),
  skid: new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: 1, transparent: true, opacity: .32, depthWrite: false }),
  green: new THREE.MeshStandardMaterial({ color: 0x9dffb0, emissive: 0x30ff70, emissiveIntensity: 2.2, fog: false }),
  red: new THREE.MeshStandardMaterial({ color: 0xff9d90, emissive: 0xff2a10, emissiveIntensity: 2.2, fog: false }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 2.4, fog: false }),
};
// PAPI: cada caixa mostra branco acima da rampa e vermelho abaixo (3°); a cor é trocada por quadro para o avião do jogador
const papis = [];
const socks = [];
for (const a of AIRFIELDS) {
  const grp = new THREE.Group(); grp.position.set(a.x, a.h, a.z); scene.add(grp);
  const flat = (w, l, mat, x, z, y = 0.06) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), mat); m.position.set(x, y, z); m.receiveShadow = true; grp.add(m); return m; };
  const rwM = new THREE.MeshStandardMaterial({ map: concrete.clone(), roughness: .9 }); rwM.map.repeat.set(a.w / 30, a.len / 30); rwM.map.needsUpdate = true;
  flat(a.w, a.len, rwM, 0, 0, 0.08);
  // ---- sinalização (padrão OACI): tudo branco numa malha só ----
  const W = [], box = (w, l, x, z) => W.push(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2).translate(x, 0.1, z));
  const L2 = a.len / 2, hw = a.w / 2;
  for (const sx of [1, -1]) box(0.9, a.len - 10, sx * (hw - 1.2), 0);                                         // bordas
  for (let z = -L2 + 120; z < L2 - 120; z += 50) box(0.9, 30, 0, z + 15);                                     // faixa central
  for (const e of [1, -1]) {
    const z0 = e * (L2 - 6);                                                                                 // cabeceira: "piano"
    const nb = a.w >= 60 ? 16 : 12, bw = 1.8, gap = (a.w - 6 - nb * bw) / (nb - 1 + 2);
    for (let k = 0; k < nb; k++) { const x = -hw + 3 + bw / 2 + k * (bw + gap) + (k >= nb / 2 ? gap * 2 : 0); box(bw, 30, x, z0 - e * 15); }
    box(a.w - 4, 1.8, 0, z0 - e * 36);                                                                       // barra
    // zona de toque: pares de faixas a 150/300/450/600 m; ponto de visada (dois blocos largos) a 300 m
    for (const [d, n] of [[150, 3], [450, 2], [600, 1]]) for (const sx of [1, -1]) for (let k = 0; k < n; k++) box(1.8, 22, sx * (6 + k * 3.2), z0 - e * d);
    for (const sx of [1, -1]) box(8, 45, sx * 9.5, z0 - e * 300);
    // número da pista (18/36), deitado e virado para quem chega
    const nm = new THREE.Mesh(new THREE.PlaneGeometry(9, 14).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: numTex(e > 0 ? '18' : '36'), transparent: true, alphaTest: 0.4, roughness: .75 }));
    nm.position.set(0, 0.11, z0 - e * 64); nm.rotation.y = e > 0 ? 0 : Math.PI; grp.add(nm);
    // marcas de pneu na zona de toque (quem pousa nesta cabeceira)
    const S = []; for (let k = 0; k < 90; k++) S.push(new THREE.PlaneGeometry(rand(0.35, 0.6), rand(15, 60)).rotateX(-Math.PI / 2).translate(rand(-4.5, 4.5) + (Math.random() < .5 ? 3 : -3), 0.095, z0 - e * rand(140, 520)));
    const sk = new THREE.Mesh(mergeGeometries(S), M.skid); grp.add(sk);
  }
  const mk = new THREE.Mesh(mergeGeometries(W), M.paintW); mk.receiveShadow = true; grp.add(mk);
  // ---- luzes de pouso ----
  const lights = (mat, pts, sz = 0.5) => { const I = new THREE.InstancedMesh(new THREE.BoxGeometry(sz, sz * 0.7, sz), mat, pts.length), m4 = new THREE.Matrix4(); pts.forEach((q, k) => I.setMatrixAt(k, m4.makeTranslation(q[0], q[1] ?? 0.3, q[2]))); grp.add(I); return I; };
  const thr = [], app = [];
  for (const e of [1, -1]) {
    const zt = e * (L2 + 2);
    for (let x = -hw; x <= hw; x += 3) thr.push([x, 0.3, zt]);                                                // cabeceira (verde)
    // ALS: barras transversais a cada 30 m até 600 m antes da cabeceira, com a barra cruzada aos 300 m
    for (let d = 60; d <= 600; d += 30) { for (let k = -2; k <= 2; k++) app.push([k * 1.2, 0.6 + d * 0.004, zt + e * d]); if (d === 300) for (let k = -7; k <= 7; k++) if (Math.abs(k) > 2) app.push([k * 1.5, 0.6 + d * 0.004, zt + e * d]); }
    // PAPI à esquerda de quem pousa, a 300 m da cabeceira
    const side = -e, pz = e * (L2 - 300);
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.8), M.white); b.position.set(side * (hw + 15 + k * 9), 0.6, pz); grp.add(b); papis.push({ m: b, a, k, z: pz, e }); }
  }
  lights(M.green, thr, 0.6); lights(M.white, app, 0.55);
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
  const n = Math.floor(a.len / 60) + 1, L = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.45, 0.6), M.lamp, n * 2), m4 = new THREE.Matrix4(); // maiores: a pista aparece de longe
  for (let i = 0; i < n; i++) for (const s of [1, -1]) L.setMatrixAt(i * 2 + (s > 0 ? 0 : 1), m4.makeTranslation(s * (a.w / 2 + 2), 0.25, -a.len / 2 + i * 60));
  grp.add(L);
  a.group = grp;
}
let t = 0;
// pl: avião do jogador — o PAPI mostra a rampa dele (caixa k fica vermelha abaixo de 2,5°+0,33°·k)
export function updateAirfields(dt, pl) {
  t += dt; for (const s of socks) s.rotation.y = 0.6 + Math.sin(t * 0.3) * 0.35 + Math.sin(t * 1.7) * 0.05;
  if (!pl) return;
  for (const P of papis) {
    const a = P.a, along = (pl.pos.z - (a.z + P.z)) * P.e, up = pl.pos.y - a.h;
    const ang = along > 0 ? Math.atan2(up, along) * 180 / Math.PI : 0;
    P.m.material = ang > 2.5 + 0.33 * (3 - P.k) ? M.white : M.red;
  }
}
