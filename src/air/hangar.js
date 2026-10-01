import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { camera, renderer, pmrem, setScene, scene as world } from '../core/render.js';
import { buildPlane } from '../vehicles/plane.js';
import { PLANES } from '../data/vehicles.js';
import { clamp, lerp, rand, angDiff, REDUCED } from '../core/util.js';
// =====================================================================
// Hangar da Batalha Aérea: cena própria (luz de estúdio, piso de concreto
// polido com reflexo, treliças, porta aberta para o entardecer, poeira no ar).
// Câmera orbital com arraste, zoom na roda e vistas prontas.
// =====================================================================
export const hv = { yaw: 0.75, pitch: 0.16, dist: 19, ty: 0.75, tp: 0.16, td: 19, idle: 0, drag: false, built: false };
let hs = null, show = null, dust = null, keyL = null, t = 0, cur = 'p47';
const VIEWS = { tres: [0.75, 0.16, 19], frente: [0, 0.05, 15], lado: [Math.PI / 2, 0.04, 17], cima: [0.3, 1.25, 21], tras: [Math.PI, 0.12, 17] };

function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function build() {
  hs = new THREE.Scene();
  hs.background = new THREE.Color(0x0b0e10); hs.fog = new THREE.Fog(0x0b0e10, 45, 120);
  hs.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; hs.environmentIntensity = 0.28;
  // piso: espelho embaixo de um concreto translúcido = reflexo fosco
  const mirror = new Reflector(new THREE.PlaneGeometry(140, 140), { textureWidth: 1024, textureHeight: 1024, color: 0x6a6f73 });
  mirror.rotation.x = -Math.PI / 2; hs.add(mirror);
  const conc = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#2a2f33'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${Math.random() * .05})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 8, 2 + Math.random() * 8); }
    for (let i = 0; i < 18; i++) { const x = Math.random() * w, y = Math.random() * h, r = 30 + Math.random() * 90, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * w / 8, 0); g.lineTo(i * w / 8, h); g.stroke(); g.beginPath(); g.moveTo(0, i * h / 8); g.lineTo(w, i * h / 8); g.stroke(); }
    // linha de taxiamento e círculo de estacionamento
    g.strokeStyle = 'rgba(214,170,60,.75)'; g.lineWidth = 9; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h * 0.38); g.stroke();
    g.setLineDash([26, 18]); g.beginPath(); g.arc(w / 2, h / 2, w * 0.13, 0, 7); g.stroke(); g.setLineDash([]);
  });
  conc.wrapS = conc.wrapT = THREE.RepeatWrapping;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ map: conc, roughness: 0.62, metalness: 0.05, transparent: true, opacity: 0.84 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; floor.receiveShadow = true; conc.repeat.set(3, 3); hs.add(floor);
  // estrutura: paredes de chapa, porta aberta ao fundo, treliças do teto
  const metal = new THREE.MeshStandardMaterial({ color: 0x272d31, roughness: 0.7, metalness: 0.5, side: THREE.DoubleSide });
  const beam = new THREE.MeshStandardMaterial({ color: 0x3a4146, roughness: 0.55, metalness: 0.7 });
  const box = (w, h, d, x, y, z, m = metal, rz = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.z = rz; o.castShadow = o.receiveShadow = true; hs.add(o); return o; };
  box(1, 18, 70, -30, 9, -5); box(1, 18, 70, 30, 9, -5); box(60, 18, 1, 0, 9, 30);
  box(16, 18, 1, -22, 9, -40); box(16, 18, 1, 22, 9, -40); box(28, 5, 1, 0, 15.5, -40);
  for (let z = -36; z <= 26; z += 9) {
    box(60, 0.5, 0.5, 0, 16.5, z, beam);
    for (let x = -26; x <= 26; x += 6.5) box(0.25, 3.2, 0.25, x, 14.8, z, beam, x % 13 ? 0.6 : -0.6);
    box(60, 0.35, 0.35, 0, 13.2, z, beam);
  }
  // abertura: céu de entardecer e pista lá fora
  const skyTex = canvasTex(32, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2c3f55'); gr.addColorStop(0.55, '#c98a5c'); gr.addColorStop(0.7, '#f1c48a'); gr.addColorStop(0.72, '#3b3a33'); gr.addColorStop(1, '#22241f'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const out = new THREE.Mesh(new THREE.PlaneGeometry(90, 40), new THREE.MeshBasicMaterial({ map: skyTex, fog: false }));
  out.position.set(0, 12, -75); hs.add(out);
  // luminárias e luz: principal quente de cima, contra-luz fria da porta, preenchimento baixo
  hs.add(new THREE.HemisphereLight(0x8f9fb0, 0x1a1712, 0.35));
  keyL = new THREE.SpotLight(0xffd6a0, 1400, 60, 0.55, 0.55, 2); keyL.position.set(5, 15.5, 7); keyL.castShadow = true; keyL.shadow.mapSize.set(2048, 2048); keyL.shadow.bias = -0.0002; hs.add(keyL, keyL.target);
  const rim = new THREE.SpotLight(0xa8c8ff, 1100, 80, 0.6, 0.7, 2); rim.position.set(-6, 10, -26); hs.add(rim, rim.target);
  const fill = new THREE.PointLight(0xffb27a, 60, 40, 2); fill.position.set(-10, 3, 12); hs.add(fill);
  const lampM = new THREE.MeshBasicMaterial({ color: 0xffe2b8 });
  for (const [x, z] of [[5, 7], [-12, -10], [14, -14], [-14, 14]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 0.6, 18, 1, true), metal); l.position.set(x, 15.9, z); hs.add(l); const d = new THREE.Mesh(new THREE.CircleGeometry(0.85, 18), lampM); d.rotation.x = Math.PI / 2; d.position.set(x, 15.62, z); hs.add(d); }
  // cenário de apoio: caixotes, tambores, carrinho de ferramentas, escada
  const crate = new THREE.MeshStandardMaterial({ color: 0x4a4a32, roughness: 0.85 });
  const drum = new THREE.MeshStandardMaterial({ color: 0x5b2f22, roughness: 0.5, metalness: 0.4 });
  const ylw = new THREE.MeshStandardMaterial({ color: 0xb08a2e, roughness: 0.6, metalness: 0.3 });
  box(2.4, 1.6, 1.8, -21, 0.8, 18, crate); box(2.4, 1.6, 1.8, -18.4, 0.8, 18.4, crate); box(2, 1.3, 1.6, -20, 2.25, 18.2, crate); box(1.6, 1.2, 1.4, 22, 0.6, -18, crate);
  for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.25, 16), drum); c.position.set(19 + (i % 3) * 0.95, 0.63, 16 + Math.floor(i / 3) * 0.95); c.castShadow = true; hs.add(c); }
  box(1.6, 0.9, 0.8, 10, 0.75, 13, ylw); box(0.1, 3.6, 0.1, -9, 1.8, -8, ylw); box(0.1, 3.6, 0.1, -8.2, 1.8, -8, ylw);
  for (let i = 0; i < 8; i++) box(0.9, 0.06, 0.1, -8.6, 0.4 + i * 0.42, -8, ylw);
  // poeira no feixe de luz
  const N = 700, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) pos.set([rand(-14, 14), rand(0.3, 15), rand(-12, 16)], i * 3);
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffe6c4, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  hs.add(dust);
  hv.built = true;
}

// aeronave em exposição sobre trem de pouso simples (só no hangar)
export function showcase(key) {
  if (!hv.built) build();
  if (show) hs.remove(show.root);
  const D = PLANES[key]; show = buildPlane(D); cur = key;
  const gearM = new THREE.MeshStandardMaterial({ color: 0x1c1c1b, roughness: 0.5, metalness: 0.5 });
  const lift = D.fuseR + 1.35, wh = r => new THREE.CylinderGeometry(r, r, 0.22, 18).rotateZ(Math.PI / 2);
  for (const s of [1, -1]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, lift, 8), gearM); st.position.set(s * D.span * 0.16, -lift / 2, D.wingZ + 0.4); show.root.add(st);
    const w = new THREE.Mesh(wh(0.4), gearM); w.position.set(s * D.span * 0.16, -lift + 0.4, D.wingZ + 0.4); w.castShadow = true; show.root.add(w);
  }
  const nz = D.jet ? D.L * 0.33 : -D.L * 0.46, nl = D.jet ? lift : lift * 0.45;
  const ns = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, nl, 8), gearM); ns.position.set(0, -nl / 2, nz); show.root.add(ns);
  const nw = new THREE.Mesh(wh(D.jet ? 0.3 : 0.18), gearM); nw.position.set(0, -nl + (D.jet ? 0.3 : 0.18), nz); show.root.add(nw);
  show.root.position.set(0, lift - 0.02, 0);
  if (!D.jet) show.root.rotation.x = -Math.atan2(lift - nl, D.L * 0.46 + D.wingZ + 0.4) * 0.9; // pousado na bequilha
  show.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  hs.add(show.root);
  keyL.target.position.set(0, 1, 0); hv.td = Math.max(15, D.span * 1.6);
}
export function setView(k) { const v = VIEWS[k]; if (!v) return; hv.ty = hv.yaw + angDiff(hv.yaw, v[0]); hv.tp = v[1]; hv.td = v[2] * Math.max(1, PLANES[cur].span / 11); hv.idle = 0; }
export function openHangar(key) { if (!hv.built) build(); showcase(key); setScene(hs); }
export function closeHangar() { setScene(world); camera.clearViewOffset(); }

export function updateHangar(dt) {
  if (!hs) return;
  t += dt; hv.idle += dt;
  if (!hv.drag && hv.idle > 5 && !REDUCED) hv.ty += dt * 0.06; // giro lento quando ninguém mexe
  hv.yaw = lerp(hv.yaw, hv.ty, 1 - Math.exp(-dt * 5)); hv.pitch = lerp(hv.pitch, hv.tp, 1 - Math.exp(-dt * 5)); hv.dist = lerp(hv.dist, hv.td, 1 - Math.exp(-dt * 5));
  const wide = innerWidth > 900;
  camera.setViewOffset(innerWidth, innerHeight, wide ? -innerWidth * 0.08 : 0, wide ? innerHeight * 0.04 : innerHeight * 0.12, innerWidth, innerHeight);
  if (Math.abs(camera.fov - 40) > 0.01) { camera.fov = 40; camera.updateProjectionMatrix(); }
  const cy = 2.2;
  camera.position.set(Math.sin(hv.yaw) * Math.cos(hv.pitch) * hv.dist, cy + Math.sin(hv.pitch) * hv.dist, Math.cos(hv.yaw) * Math.cos(hv.pitch) * hv.dist);
  camera.position.y = Math.max(0.6, camera.position.y);
  camera.lookAt(0, cy, 0);
  // poeira subindo devagar; luz principal com cintilação leve de lâmpada
  if (dust && !REDUCED) { const a = dust.geometry.attributes.position.array; for (let i = 1; i < a.length; i += 3) { a[i] += dt * 0.12; a[i - 1] += Math.sin(t * 0.4 + i) * dt * 0.05; if (a[i] > 15) a[i] = 0.3; } dust.geometry.attributes.position.needsUpdate = true; }
  keyL.intensity = 1400 * (0.97 + 0.03 * Math.sin(t * 17) * Math.sin(t * 5.3));
}
// arraste para orbitar, roda para aproximar
export function hangarPointer(kind, e) {
  if (kind === 'down') { hv.drag = true; hv.idle = 0; }
  else if (kind === 'up') hv.drag = false;
  else if (kind === 'move' && hv.drag) { hv.ty -= e.movementX * 0.006; hv.tp = clamp(hv.tp + e.movementY * 0.004, -0.05, 1.35); hv.idle = 0; }
  else if (kind === 'wheel') { hv.td = clamp(hv.td * (e.deltaY > 0 ? 1.1 : 0.9), 8, 40); hv.idle = 0; }
}
