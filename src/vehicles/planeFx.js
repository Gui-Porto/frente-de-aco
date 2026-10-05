import * as THREE from 'three';
import { camera, scene } from '../core/render.js';
import { clamp, rand } from '../core/util.js';
import { fxTrail, spawnP } from '../fx/particles.js';
// =====================================================================
// Efeitos visuais presos à aeronave (estilo WT):
//  - chama da pós-combustão com diamantes de choque; brilho quente do bocal
//    em potência militar nos jatos sem PC;
//  - fogo saindo dos escapamentos no WEP dos motores a pistão;
//  - fumaça de motor (def.smoke; o J79 do F-4 era famoso por ela), que some
//    com a PC acesa;
//  - cone de vapor perto de Mach 1.
// Materiais ÚNICOS e compartilhados, criados no carregamento; apagadas, as malhas
// ficam invisíveis. Uma semente de cada material fica sempre desenhada (escala ~0) na
// cena, então o shader já existe e a primeira ignição não trava (CLAUDE.md).
// =====================================================================
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
// eixo vertical da textura = comprimento da chama (topo = bocal)
const flameTex = canvasTex(64, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(255,236,170,.95)'); gr.addColorStop(0.1, 'rgba(255,170,60,.9)'); gr.addColorStop(0.35, 'rgba(255,105,25,.65)');
  gr.addColorStop(0.7, 'rgba(210,60,20,.25)'); gr.addColorStop(1, 'rgba(150,40,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  // bordas da casca mais fracas (parece volume)
  const sx = g.createLinearGradient(0, 0, w, 0); sx.addColorStop(0, 'rgba(0,0,0,.55)'); sx.addColorStop(0.5, 'rgba(0,0,0,0)'); sx.addColorStop(1, 'rgba(0,0,0,.55)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = sx; g.fillRect(0, 0, w, h);
});
const diamondTex = canvasTex(64, 256, (g, w, h) => {
  g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 5; i++) {
    const y = h * (0.08 + i * 0.15), a = 1 - i * 0.18, r = h * 0.045;
    const gr = g.createRadialGradient(w / 2, y, 0, w / 2, y, r * 1.6); gr.addColorStop(0, `rgba(255,236,200,${a})`); gr.addColorStop(0.5, `rgba(255,170,90,${a * 0.6})`); gr.addColorStop(1, 'rgba(255,120,60,0)');
    g.fillStyle = gr; g.fillRect(0, y - r * 2, w, r * 4);
  }
});
const vaporTex = canvasTex(64, 128, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(0.7, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 6); }
});
const add = { transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending };
// casca em mistura NORMAL (laranja saturado aparece contra o céu claro); diamantes e disco aditivos
const FLAME = new THREE.MeshBasicMaterial({ map: flameTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
const glowTex = canvasTex(64, 64, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.35, 'rgba(255,190,90,.9)'); gr.addColorStop(0.7, 'rgba(255,110,40,.35)'); gr.addColorStop(1, 'rgba(255,80,30,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
const GLOW = new THREE.MeshBasicMaterial({ map: glowTex, ...add });
const DISC = new THREE.CircleGeometry(1, 20).rotateY(Math.PI);
const DIAMOND = new THREE.MeshBasicMaterial({ map: diamondTex, ...add });
const VAPOR = new THREE.MeshBasicMaterial({ map: vaporTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.9 });
// cone de vapor (transônico): casca aberta que alarga para trás, com a borda de trás recortada em ondas — liso, parecia
// um copo de plástico; raio 1 na frente, z = 0 → −1 (o comprimento vem da escala)
function vaporGeo(r1) {
  const g = new THREE.CylinderGeometry(1, r1, 1, 40, 6, true).translate(0, -0.5, 0).rotateX(Math.PI / 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(y, x), t = -z, w = 1 + t * t * (0.18 * Math.sin(a * 7) + 0.1 * Math.sin(a * 13 + 1.3) + 0.06 * Math.sin(a * 23));
    p.setXYZ(i, x * w, y * w, z * (1 + 0.12 * t * Math.sin(a * 5 + 0.7)));
  }
  g.computeVertexNormals(); return g;
}
const VCONE = vaporGeo(2.3), VNOSE = vaporGeo(1.7);
// cone aberto: bocal em z = 0, ponta em z = −1 (o comprimento real vem da escala)
const coneGeo = (r0, r1) => new THREE.CylinderGeometry(r0, r1, 1, 18, 1, true).translate(0, -0.5, 0).rotateX(Math.PI / 2);
const OUTER = coneGeo(1, 0.35), INNER = coneGeo(0.7, 0.2), STACK = coneGeo(1, 0.15);
const HIDE = 1e-4;
const mk = (geo, mat, parent, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.setScalar(HIDE); m.frustumCulled = false; m.renderOrder = 2; m.userData.fx = true; parent.add(m); return m; };

// chamado no fim do buildPlane: nozzles [{x,y,z,r}], stacks [{x,y,z,dir}] no referencial do avião
export function buildPlaneFx(D, root, nozzles, stacks) {
  const fx = { flames: [], stacks: [], vapor: null };
  for (const n of nozzles) fx.flames.push({ out: mk(OUTER, FLAME, root, n.x, n.y, n.z), inn: mk(INNER, DIAMOND, root, n.x, n.y, n.z), glow: mk(DISC, GLOW, root, n.x, n.y, n.z + 0.05), r: n.r });
  for (const s of stacks) { const m = mk(STACK, FLAME, root, s.x, s.y, s.z); m.rotation.y = s.dir || 0; fx.stacks.push(m); }
  mk(HOLEGEO, HOLE, root, 0, 0, 0).visible = false; // marca de bala (o shader vem da semente)
  // dois cones: um no meio da asa (o grande) e outro na cabine/nariz, como nas fotos de passagem transônica
  if (D.jet) { fx.vapor = mk(VCONE, VAPOR, root, 0, 0, D.wingZ + D.chord * 0.4); fx.vaporN = mk(VNOSE, VAPOR, root, 0, D.fuseR * 0.25, D.L * 0.22); }
  return fx;
}

const _p = new THREE.Vector3();
export function updatePlaneFx(p, dt) {
  const fx = p.fx; if (!fx) return;
  const E = p.eng, on = p.alive && p.engineOn && !p.gone, t = performance.now() / 1000;
  const flick = () => 1 + (Math.random() - 0.5) * 0.16;
  if (E.jet) {
    const ab = on && E.hasAB ? E.ab : 0, hot = on ? clamp((E.N - 0.9) / 0.1, 0, 1) : 0;
    const wep = on && !E.hasAB ? E.ab : 0; // WEP do jato sem PC: chama curta e bocal ao rubro, sem diamantes
    for (const f of fx.flames) {
      // PC: chama longa; WEP: chama curta; sem nada: só o brilho curto do bocal em potência militar
      const len = ab > 0.01 ? f.r * (7 + 9 * ab) : wep > 0.01 ? f.r * (3.8 + 1.2 * Math.random()) : f.r * 1.1 * hot, rad = f.r * (ab > 0.01 ? 0.85 + 0.1 * ab : wep > 0.01 ? 0.8 : 0.7);
      // disco incandescente na boca: visto de trás é o que mais aparece (brilha já em potência militar)
      const gk = Math.max(ab, wep * 0.8, hot * 0.35);
      f.glow.scale.setScalar(gk > 0.01 ? f.r * (1.25 + 0.6 * Math.max(ab, wep * 0.6)) * flick() : HIDE);
      if (len < 0.02) { f.out.scale.setScalar(HIDE); f.inn.scale.setScalar(HIDE); continue; }
      f.out.scale.set(rad * flick(), rad * flick(), len * flick());
      f.inn.scale.copy(ab > 0.01 ? f.out.scale : _p.setScalar(HIDE)).multiplyScalar(ab > 0.01 ? 0.95 : 1);
    }
  }
  // WEP no pistão: labaredas curtas nos escapamentos, pulsando
  const wep = on && !E.jet && p.wep && E.power > 1.005;
  for (const m of fx.stacks) {
    if (!wep) { m.scale.setScalar(HIDE); continue; }
    const k = 0.6 + 0.4 * Math.abs(Math.sin(t * 37 + m.id)) * flick();
    m.scale.set(0.085 * k, 0.085 * k, 0.6 * k);
  }
  // fumaça do motor (some com a PC: o combustível queima por completo)
  if (on && p.def.smoke && E.N > 0.85 && E.ab < 0.2 && fx.flames.length) {
    p.smokeT = (p.smokeT || 0) - dt;
    if (p.smokeT <= 0 && p.pos.distanceToSquared(camera.position) < 4000 * 4000) {
      p.smokeT = 0.05 / p.def.smoke;
      for (const f of fx.flames) fxTrail(f.out.getWorldPosition(_p).clone(), 0x5d5a55, 0.7 + 0.5 * p.def.smoke, 4.5);
    }
  }
  // cone de vapor: aparece só numa faixa estreita em torno de Mach 1
  if (fx.vapor) {
    // faixa transônica (~0,92–1,05); o cone de cabine aparece um pouco antes e some antes do da asa. Tremula e gira
    // devagar (a borda recortada não fica parada) — antes era um cilindro liso numa faixa estreitíssima
    const M = p.mach || 0, k = p.alive ? clamp(1 - Math.abs(M - 0.985) / 0.065, 0, 1) ** 0.8 : 0, kn = p.alive ? clamp(1 - Math.abs(M - 0.96) / 0.055, 0, 1) : 0;
    const R = p.def.fuseR, tt = performance.now() / 1000;
    if (k > 0.02) { const s = R * (1.05 + 0.3 * k); fx.vapor.scale.set(s * rand(0.95, 1.05), s * rand(0.95, 1.05), p.def.L * (0.12 + 0.22 * k) * rand(0.92, 1.08)); fx.vapor.rotation.z = tt * 0.7; }
    else fx.vapor.scale.setScalar(HIDE);
    if (fx.vaporN) { if (kn > 0.02) { const s = R * (0.95 + 0.15 * kn); fx.vaporN.scale.set(s * rand(0.96, 1.04), s * rand(0.96, 1.04), p.def.L * 0.12 * kn); fx.vaporN.rotation.z = -tt; } else fx.vaporN.scale.setScalar(HIDE); }
    // supersônico: a casca de vapor se desprende em fiapos que ficam para trás nas pontas das asas
    if (M > 0.97 && M < 1.08 && p.alive && Math.random() < 0.5 && p.pos.distanceToSquared(camera.position) < 1500 * 1500) {
      const sp = p.def.span * 0.45 * (Math.random() < 0.5 ? 1 : -1);
      spawnP({ pos: _p.set(sp, 0, p.def.wingZ - p.def.chord * 0.3).applyQuaternion(p.q).add(p.pos).clone(), vel: p.vel.clone().multiplyScalar(0.7), life: rand(0.3, 0.6), size: 0.8, size1: 2.8, color: 0xf6f8fa, op: 0.35, drag: 3 });
    }
    // passou de Mach 1: anel de condensação que se abre em volta do avião e fica para trás
    if (M >= 1 && (p._m0 || 0) < 1 && (p._m0 || 0) > 0.9 && p.pos.distanceToSquared(camera.position) < 3000 * 3000) {
      p.axes && p.axes();
      const f = _p.set(0, 0, 1).applyQuaternion(p.q), r = p.def.fuseR * 1.6, a = new THREE.Vector3(1, 0, 0).applyQuaternion(p.q), b = new THREE.Vector3(0, 1, 0).applyQuaternion(p.q);
      const c = p.pos.clone().addScaledVector(f, p.def.wingZ);
      for (let i = 0; i < 28; i++) {
        const t = i / 28 * Math.PI * 2, dir = a.clone().multiplyScalar(Math.cos(t)).addScaledVector(b, Math.sin(t));
        spawnP({ pos: c.clone().addScaledVector(dir, r), vel: p.vel.clone().multiplyScalar(0.25).addScaledVector(dir, 22), life: rand(0.9, 1.5), size: 2.2, size1: 7, color: 0xf4f6f8, op: 0.55, drag: 2.2 });
      }
    }
    p._m0 = M;
  }
  // apagado = fora do desenho (antes ia 1 draw call por chama/escapamento por avião, todo quadro)
  for (const f of fx.flames) { f.glow.visible = f.glow.scale.x > HIDE; f.out.visible = f.out.scale.x > HIDE; f.inn.visible = f.inn.scale.x > HIDE; }
  for (const m of fx.stacks) m.visible = m.scale.x > HIDE;
  if (fx.vapor) fx.vapor.visible = fx.vapor.scale.z > HIDE;
  if (fx.vaporN) fx.vaporN.visible = fx.vaporN.scale.z > HIDE;
}

// ---------- lascas de chapa arrancadas pelos acertos ----------
// Malhas pequenas com o MESMO material de pintura do avião (nenhum shader novo na partida); caixa fina
// em vez de plano para aparecer dos dois lados sem DoubleSide (que compilaria outro programa).
const FLAKE = new THREE.BoxGeometry(1, 0.02, 0.7), flakes = [];
export function fxFlakes(pl, pos, n = 2, big = false) {
  const mat = pl.mats && pl.mats[0]; if (!mat || pos.distanceToSquared(camera.position) > 1500 * 1500) return;
  for (let i = 0; i < n; i++) {
    if (flakes.length > 60) { const o = flakes.shift(); o.m.removeFromParent(); }
    const m = new THREE.Mesh(FLAKE, mat), s = big ? rand(0.5, 1.1) : rand(0.12, 0.38); // big: painel inteiro arrancado
    m.scale.set(s, s, s * rand(0.6, 1.2)); m.position.copy(pos); m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    pl.root.parent && pl.root.parent.add(m);
    flakes.push({ m, v: pl.vel.clone().multiplyScalar(0.85).add(new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).multiplyScalar(9)), w: new THREE.Vector3(rand(-14, 14), rand(-14, 14), rand(-14, 14)), t: rand(2.5, 4) });
  }
}
export function updateFlakes(dt) {
  for (let i = flakes.length - 1; i >= 0; i--) {
    const f = flakes[i];
    if ((f.t -= dt) <= 0) { f.m.removeFromParent(); flakes.splice(i, 1); continue; }
    f.v.multiplyScalar(Math.exp(-dt * 2.2)); f.v.y -= 9.8 * dt;             // chapa leve: o ar freia rápido
    f.m.position.addScaledVector(f.v, dt); f.m.rotation.x += f.w.x * dt; f.m.rotation.y += f.w.y * dt; f.m.rotation.z += f.w.z * dt;
  }
}
export function clearFlakes() { for (const f of flakes) f.m.removeFromParent(); flakes.length = 0; }

// ---------- marcas de bala na chapa, presas à peça atingida ----------
// Atlas 4×2 (um material só, nenhum shader novo): 0 entrada de perfurante (furo limpo com o anel de metal nu),
// 1 rombo de explosiva (pétalas rasgadas + queimado), 2 saída (pétalas viradas para fora), 3 painel arrancado
// (interior escuro com nervuras), 4 trinca no vidro, 5 fuligem, 6 entrada de incendiária (anel queimado), 7 entrada
// oblíqua. O tiro é refeito como raio contra o modelo; a marca vira filha da malha atingida (acompanha superfície e
// peças que se soltam). Some no reparo (refit reconstrói o modelo).
const CELL = 128;
const holeTex = canvasTex(CELL * 4, CELL * 2, (g) => {
  const R = CELL / 2, cell = i => [(i % 4) * CELL + R, Math.floor(i / 4) * CELL + R];
  const rad = (x, y, r, stops) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); for (const [t, c] of stops) gr.addColorStop(t, c); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  const jag = (x, y, r0, r1, n, fill, stroke) => { g.beginPath(); for (let k = 0; k <= n; k++) { const a = k / n * 6.283, r = r0 + Math.random() * (r1 - r0); g[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); } };
  let [x, y] = cell(0); // perfurante: furo limpo, anel de metal nu, borra leve
  rad(x, y, R, [[0, 'rgba(60,54,46,.35)'], [0.6, 'rgba(60,54,46,.12)'], [1, 'rgba(60,54,46,0)']]);
  g.fillStyle = 'rgba(205,207,210,.95)'; g.beginPath(); g.arc(x, y, R * 0.3, 0, 7); g.fill();
  jag(x, y, R * 0.16, R * 0.2, 14, 'rgba(6,6,6,1)');
  [x, y] = cell(1); // explosiva: queimado largo, pétalas claras e o rombo
  rad(x, y, R, [[0, 'rgba(20,16,12,.9)'], [0.45, 'rgba(35,28,20,.65)'], [0.8, 'rgba(50,42,34,.2)'], [1, 'rgba(50,42,34,0)']]);
  for (let k = 0; k < 9; k++) { const a = Math.random() * 6.28, l = R * (0.45 + Math.random() * 0.25), w = 0.25; g.fillStyle = `rgba(${150 + Math.random() * 60 | 0},${150 + Math.random() * 55 | 0},${150 + Math.random() * 50 | 0},.9)`; g.beginPath(); g.moveTo(x + Math.cos(a - w) * R * 0.28, y + Math.sin(a - w) * R * 0.28); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.lineTo(x + Math.cos(a + w) * R * 0.28, y + Math.sin(a + w) * R * 0.28); g.fill(); }
  jag(x, y, R * 0.24, R * 0.4, 18, 'rgba(5,5,5,1)', 'rgba(110,100,90,.8)');
  [x, y] = cell(2); // saída: pétalas viradas para fora, metal claro
  for (let k = 0; k < 7; k++) { const a = k / 7 * 6.28 + Math.random() * 0.4, l = R * (0.38 + Math.random() * 0.2); g.fillStyle = 'rgba(215,215,218,.95)'; g.beginPath(); g.moveTo(x + Math.cos(a - 0.35) * R * 0.15, y + Math.sin(a - 0.35) * R * 0.15); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.lineTo(x + Math.cos(a + 0.35) * R * 0.15, y + Math.sin(a + 0.35) * R * 0.15); g.fill(); g.strokeStyle = 'rgba(40,36,32,.6)'; g.lineWidth = 1; g.stroke(); }
  jag(x, y, R * 0.14, R * 0.22, 12, 'rgba(8,8,8,1)');
  [x, y] = cell(3); // painel arrancado: interior escuro, nervuras e longarinas, borda rasgada de metal nu
  g.save(); g.beginPath(); g.rect(x - R * 0.92, y - R * 0.7, R * 1.84, R * 1.4); g.clip();
  jag(x, y, R * 0.9, R * 1.02, 30, 'rgba(200,200,204,.95)');
  jag(x, y, R * 0.72, R * 0.86, 30, 'rgba(22,22,24,1)');
  g.fillStyle = 'rgba(85,88,90,.95)'; for (let k = -2; k <= 2; k++) g.fillRect(x + k * R * 0.3 - 3, y - R * 0.66, 6, R * 1.32);
  g.fillStyle = 'rgba(60,62,64,.95)'; for (const k of [-0.35, 0.35]) g.fillRect(x - R * 0.85, y + k * R - 2, R * 1.7, 4);
  g.fillStyle = 'rgba(160,40,30,.9)'; g.fillRect(x - R * 0.5, y + R * 0.1, R * 0.35, 3); g.fillStyle = 'rgba(40,90,160,.9)'; g.fillRect(x + R * 0.1, y - R * 0.2, R * 0.3, 3); // fios e tubos
  g.restore();
  [x, y] = cell(4); // trinca no vidro: lasca branca, raios e arcos
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.3;
  for (let k = 0; k < 11; k++) { const a = Math.random() * 6.28; let px = x, py = y; g.beginPath(); g.moveTo(px, py); for (let q = 0; q < 4; q++) { const l = R * (0.15 + Math.random() * 0.25); px += Math.cos(a + (Math.random() - 0.5) * 0.5) * l; py += Math.sin(a + (Math.random() - 0.5) * 0.5) * l; g.lineTo(px, py); } g.stroke(); }
  for (const r of [0.22, 0.42]) { g.beginPath(); g.arc(x, y, R * r, Math.random() * 6, Math.random() * 6 + 3); g.stroke(); }
  rad(x, y, R * 0.12, [[0, 'rgba(255,255,255,.95)'], [1, 'rgba(255,255,255,0)']]);
  [x, y] = cell(5); // fuligem
  rad(x, y, R, [[0, 'rgba(18,15,12,.75)'], [0.5, 'rgba(25,20,16,.4)'], [1, 'rgba(25,20,16,0)']]);
  [x, y] = cell(6); // incendiária: anel queimado alaranjado-marrom
  rad(x, y, R, [[0, 'rgba(40,24,12,.8)'], [0.35, 'rgba(110,60,25,.55)'], [0.7, 'rgba(70,50,30,.2)'], [1, 'rgba(70,50,30,0)']]);
  jag(x, y, R * 0.16, R * 0.22, 14, 'rgba(6,6,6,1)');
  [x, y] = cell(7); // entrada oblíqua: rasgo alongado
  g.save(); g.translate(x, y); g.scale(1.8, 0.7);
  rad(0, 0, R * 0.5, [[0, 'rgba(60,54,46,.4)'], [1, 'rgba(60,54,46,0)']]);
  g.fillStyle = 'rgba(205,207,210,.9)'; g.beginPath(); g.arc(0, 0, R * 0.26, 0, 7); g.fill(); jag(0, 0, R * 0.13, R * 0.18, 12, 'rgba(6,6,6,1)');
  g.restore();
});
const HOLE = new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const HOLEGEOS = Array.from({ length: 8 }, (_, i) => {
  const g = new THREE.PlaneGeometry(1, 1), uv = g.attributes.uv, u0 = (i % 4) / 4, v0 = 1 - (Math.floor(i / 4) + 1) / 2;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) / 4, v0 + uv.getY(k) / 2);
  return g;
}), HOLEGEO = HOLEGEOS[0];
for (const [g, m] of [[OUTER, FLAME], [INNER, DIAMOND], [DISC, GLOW], [OUTER, VAPOR], [HOLEGEO, HOLE]]) mk(g, m, scene, 0, -1e4, 0); // sementes dos shaders
const _rc = new THREE.Raycaster(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Vector3();
const matOf = h => (Array.isArray(h.object.material) ? h.object.material[0] : h.object.material);
const solid = h => h.face && !h.object.userData.fx && !matOf(h).transparent;
const glassy = h => h.face && !h.object.userData.fx && matOf(h).transparent && matOf(h).opacity < 0.5;
// marca `cell` no ponto da batida, deitada na face (normal voltada para `side`), presa à malha
function mark(pl, hit, cell, size, side) {
  _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  if (_n.dot(side) < 0) _n.negate();
  const m = new THREE.Mesh(HOLEGEOS[cell], HOLE);
  m.position.copy(hit.point).addScaledVector(_n, 0.01); m.lookAt(_q.copy(m.position).add(_n));
  m.rotateZ(rand(0, 6.28)); m.scale.setScalar(size);
  m.userData.fx = true; m.renderOrder = 2;
  hit.object.attach(m);
  const H = pl.root.userData.holes || (pl.root.userData.holes = []);
  H.push(m); if (H.length > 70) H.shift().removeFromParent();
  return m;
}
// o = { cal (mm), inc (incendiária), pen (mm, quanto atravessa), panel (arranca painel) }
// back: quanto o raio recua antes do ponto de entrada (tiro); 0 = parte do ponto (explosão). Devolve a batida ({ point, object }).
export function fxHole(pl, lp, ld, he, back = 3, size = 0, o = {}) {
  if (!ld || pl.pos.distanceToSquared(camera.position) > 900 * 900) return null;
  const W = pl.root.matrixWorld;
  _d.set(ld[0], ld[1], ld[2]).transformDirection(W);
  _o.set(lp[0], lp[1], lp[2]).applyMatrix4(W).addScaledVector(_d, -back);
  _rc.set(_o, _d); _rc.far = back + 14;
  const all = _rc.intersectObject(pl.root, true), hit = all.find(solid); if (!hit) return null;
  // vidro da capota antes da chapa: trinca nele
  const gl = all.find(glassy); if (gl && gl.distance < hit.distance) mark(pl, gl, 4, he ? rand(0.3, 0.45) : rand(0.14, 0.24), _q.copy(_d).negate());
  const cal = o.cal || 12.7, back_ = _q.copy(_d).negate().clone();
  const oblique = Math.abs(_n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).dot(_d)) < 0.45;
  mark(pl, hit, he ? 1 : o.inc ? 6 : oblique ? 7 : 0, size || (he ? clamp(cal * 0.022, 0.3, 0.9) * rand(0.8, 1.2) : clamp(cal * 0.0055, 0.06, 0.22) * rand(0.9, 1.15)), back_);
  if (he && Math.random() < 0.5) mark(pl, hit, 5, (size || cal * 0.03) * rand(1.4, 2), back_); // fuligem em volta
  if (o.panel) mark(pl, hit, 3, rand(0.45, 0.8), back_);
  // perfurante que atravessa: furo de saída na chapa do outro lado (pétalas para fora)
  if (!he) {
    const reach = 1.2 + (o.pen || 10) * 0.12;
    let ex = null; for (const h of all) if (h !== hit && solid(h) && h.distance - hit.distance > 0.25 && h.distance - hit.distance < reach) ex = h;
    if (ex && Math.random() < 0.7) mark(pl, ex, 2, clamp(cal * 0.007, 0.08, 0.26) * rand(0.9, 1.2), _d);
  }
  return hit;
}
// explosão perto (míssil, granada AA): rombos queimados na face voltada para ela e painéis arrancados
export function fxBlast(pl, lp, R) {
  const n = Math.min(8, 3 + Math.round(R)), D = pl.def;
  for (let i = 0; i < n; i++) {
    const tx = clamp(lp[0] * 0.5, -D.span / 2, D.span / 2) + rand(-1.5, 1.5), ty = rand(-0.4, 0.4), tz = clamp(lp[2] * 0.5, -D.L / 2, D.L / 2) + rand(-2, 2);
    const dx = tx - lp[0], dy = ty - lp[1], dz = tz - lp[2], l = Math.hypot(dx, dy, dz) || 1;
    const h = fxHole(pl, lp, [dx / l, dy / l, dz / l], true, 0, rand(0.6, 1.3), { panel: Math.random() < 0.25 });
    if (h && Math.random() < 0.6) fxFlakes(pl, h.point, 1 + (Math.random() < 0.5), true);
  }
}
