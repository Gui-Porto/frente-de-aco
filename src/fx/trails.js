import * as THREE from 'three';
import { scene, camera } from '../core/render.js';
// =====================================================================
// Rastro de fumaça contínuo (míssil): uma fita voltada para a câmera por
// rastro, com amostras a cada poucos metros. Cada amostra envelhece: a fita
// alarga, esmaece e sobe devagar. O rastro sobrevive ao míssil e some
// sozinho. Material ÚNICO criado no carregamento (compilado na decolagem
// pelo míssil-fantasma de screens.js) — nada de shader novo no meio da luta.
// Bem mais barato que partículas avulsas (uma malha por rastro, sem limite
// do pool de partículas) e sem "contas de colar" quando o míssil é rápido.
// =====================================================================
const N = 640;                                 // amostras por rastro (anel)
const tex = (() => {
  const W = 64, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / (W - 1), across = Math.max(0, 1 - Math.abs(u - 0.5) * 2) ** 1.4;
    const n = 0.5 + 0.5 * Math.sin(y * 0.05 + Math.sin(x * 0.15) * 1.5) * Math.sin(y * 0.031 + x * 0.05);
    const o = (y * W + x) * 4; d[o] = d[o + 1] = d[o + 2] = 200 + n * 55; d[o + 3] = across * (0.78 + 0.22 * n) * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapT = THREE.RepeatWrapping; return t;
})();
const MAT = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
export const trails = [];
const _t = new THREE.Vector3(), _c = new THREE.Vector3(), _s = new THREE.Vector3();

export class Trail {
  // o: { life (s), w0, w1 (largura inicial/final), color, alpha, step (m entre amostras) }
  constructor(o = {}) {
    this.life = o.life || 11; this.w0 = o.w0 || 0.5; this.w1 = o.w1 || 5; this.alpha = o.alpha ?? 0.85; this.step = o.step || 4;
    this.col = new THREE.Color(o.color ?? 0xeeeeea);
    this.p = new Float32Array(N * 3); this.t = new Float32Array(N); this.n = 0; this.head = 0; this.open = true; this.age = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(N * 2 * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx); g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, MAT); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    scene.add(this.mesh); trails.push(this);
    this.last = null;
  }
  // nova posição da fonte (só grava se andou `step` metros desde a última amostra)
  push(pos, now) {
    if (!this.open) return;
    if (this.last && this.last.distanceToSquared(pos) < this.step * this.step) { this.tip = pos; return; }
    const i = this.head; this.p[i * 3] = pos.x; this.p[i * 3 + 1] = pos.y; this.p[i * 3 + 2] = pos.z; this.t[i] = now;
    this.head = (i + 1) % N; this.n = Math.min(N, this.n + 1);
    this.last = (this.last || new THREE.Vector3()).copy(pos); this.tip = null;
  }
  close() { this.open = false; }
  // reconstrói a fita: largura e alfa pela idade de cada amostra
  update(now, dt) {
    const g = this.mesh.geometry, P = g.attributes.position.array, C = g.attributes.color.array, U = g.attributes.uv.array;
    let k = 0, alive = 0;
    for (let j = 0; j < this.n; j++) {
      const i = (this.head - this.n + j + N) % N, age = now - this.t[i], f = age / this.life;
      if (f >= 1) continue;
      alive++;
      _s.set(this.p[i * 3], this.p[i * 3 + 1] + age * 0.35, this.p[i * 3 + 2]); // sobe devagar (ar quente/vento)
      // tangente pela vizinha; lado = tangente × direção da câmera
      const jn = j < this.n - 1 ? (i + 1) % N : (i - 1 + N) % N;
      _t.set(this.p[jn * 3] - this.p[i * 3], this.p[jn * 3 + 1] - this.p[i * 3 + 1], this.p[jn * 3 + 2] - this.p[i * 3 + 2]);
      if (j === this.n - 1) _t.negate();
      _c.copy(camera.position).sub(_s);
      _t.cross(_c); const L = _t.length() || 1;
      const w = (this.w0 + (this.w1 - this.w0) * Math.sqrt(f)) / L;
      P[k * 6] = _s.x + _t.x * w; P[k * 6 + 1] = _s.y + _t.y * w; P[k * 6 + 2] = _s.z + _t.z * w;
      P[k * 6 + 3] = _s.x - _t.x * w; P[k * 6 + 4] = _s.y - _t.y * w; P[k * 6 + 5] = _s.z - _t.z * w;
      // alfa: nasce forte, some com a idade; a ponta mais nova (perto do motor) um pouco mais clara
      const a = this.alpha * (1 - f) ** 1.6 * Math.min(1, age * 6 + 0.35);
      for (const o of [0, 4]) { C[k * 8 + o] = this.col.r; C[k * 8 + o + 1] = this.col.g; C[k * 8 + o + 2] = this.col.b; C[k * 8 + o + 3] = a; }
      U[k * 4] = 0; U[k * 4 + 1] = j * 0.02; U[k * 4 + 2] = 1; U[k * 4 + 3] = j * 0.02;
      k++;
    }
    g.setDrawRange(0, Math.max(0, (k - 1) * 6));
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.uv.needsUpdate = true;
    this.age += dt;
    return this.open || alive > 0;
  }
  dispose() { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}
export function updateTrails(now, dt) {
  for (let i = trails.length - 1; i >= 0; i--) if (!trails[i].update(now, dt)) { trails[i].dispose(); trails.splice(i, 1); }
}
export function clearTrails() { for (const t of trails) t.dispose(); trails.length = 0; }
