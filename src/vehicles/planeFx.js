import * as THREE from 'three';
import { camera } from '../core/render.js';
import { clamp, rand } from '../core/util.js';
import { fxTrail } from '../fx/particles.js';
// =====================================================================
// Efeitos visuais presos à aeronave (estilo WT):
//  - chama da pós-combustão com diamantes de choque; brilho quente do bocal
//    em potência militar nos jatos sem PC;
//  - fogo saindo dos escapamentos no WEP dos motores a pistão;
//  - fumaça de motor (def.smoke; o J79 do F-4 era famoso por ela), que some
//    com a PC acesa;
//  - cone de vapor perto de Mach 1.
// Materiais ÚNICOS e compartilhados, criados no carregamento; as malhas ficam
// sempre "visíveis" com escala ~0 quando apagadas — assim o renderer.compile
// da decolagem já compila tudo e a primeira ignição não trava (CLAUDE.md).
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
  if (D.jet) fx.vapor = mk(new THREE.CylinderGeometry(D.fuseR * 1.15, D.fuseR * 2.6, 1, 24, 1, true).translate(0, -0.5, 0).rotateX(Math.PI / 2), VAPOR, root, 0, 0, D.wingZ + D.chord * 0.4);
  return fx;
}

const _p = new THREE.Vector3();
export function updatePlaneFx(p, dt) {
  const fx = p.fx; if (!fx) return;
  const E = p.eng, on = p.alive && p.engineOn && !p.gone, t = performance.now() / 1000;
  const flick = () => 1 + (Math.random() - 0.5) * 0.16;
  if (E.jet) {
    const ab = on ? E.ab : 0, hot = on ? clamp((E.N - 0.9) / 0.1, 0, 1) : 0;
    for (const f of fx.flames) {
      // PC: chama longa; sem PC: só o brilho curto do bocal em potência militar
      const len = ab > 0.01 ? f.r * (7 + 9 * ab) : f.r * 1.1 * hot, rad = f.r * (ab > 0.01 ? 0.85 + 0.1 * ab : 0.7);
      // disco incandescente na boca: visto de trás é o que mais aparece (brilha já em potência militar)
      const gk = Math.max(ab, hot * 0.35);
      f.glow.scale.setScalar(gk > 0.01 ? f.r * (1.25 + 0.6 * ab) * flick() : HIDE);
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
    const M = p.mach || 0, k = on ? clamp(1 - Math.abs(M - 0.985) / 0.045, 0, 1) : 0;
    if (k > 0.02) { const s = 0.75 + 0.25 * k; fx.vapor.scale.set(s * rand(0.97, 1.03), s * rand(0.97, 1.03), p.def.L * 0.22 * k); }
    else fx.vapor.scale.setScalar(HIDE);
  }
}
