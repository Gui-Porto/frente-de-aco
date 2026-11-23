import * as THREE from 'three';
import { scene, camera } from '../core/render.js';
import { SKYLIT } from './particles.js';
// =====================================================================
// Rastro de fumaça contínuo (míssil, avião em chamas): uma fita voltada para a câmera por
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
  // ruído periódico em y (a textura repete ao longo do rastro): soma de senos com fases sorteadas
  const TAU = Math.PI * 2, oct = [1, 2, 3, 5, 8, 13].map(f => ({ f, a: Math.random() * TAU, b: Math.random() * TAU, k: 1 + Math.random() * 2 }));
  const fbm = (u, v) => { let s = 0, w = 0; for (const o of oct) { const amp = 1 / o.f ** 0.7; s += amp * Math.sin(v * TAU * o.f + o.a + Math.sin(u * o.k * 3 + o.b) * 1.3); w += amp; } return 0.5 + 0.5 * s / w; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / (W - 1), v = y / H, n = fbm(u, v), edge = 0.62 + 0.38 * fbm(0.3, v + 0.37); // a largura respira ao longo do rastro
    const across = Math.max(0, 1 - Math.abs(u - 0.5) * 2 / edge) ** 1.2;
    const o = (y * W + x) * 4; d[o] = d[o + 1] = d[o + 2] = 185 + n * 70; d[o + 3] = Math.min(1, across * (0.45 + 0.9 * n)) * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapT = THREE.RepeatWrapping; return t;
})();
const MAT = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
export const trails = [];
// semente sempre desenhada (um triângulo de ~0 lá embaixo): o programa da fita nasce nos primeiros quadros, não no 1º míssil
{ const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1e-4, 0, 0, 0, 1e-4, 0]), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(12), 4)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
  const s = new THREE.Mesh(g, MAT); s.position.y = -1e4; s.frustumCulled = false; scene.add(s); }
const _t = new THREE.Vector3(), _c = new THREE.Vector3(), _s = new THREE.Vector3(), _pv = new THREE.Vector3();

export class Trail {
  // o: { life (s), w0, w1 (meia largura inicial/final), color (albedo), alpha, step (m entre amostras), lit (luz do dia: padrão sim), rise (m/s) }
  constructor(o = {}) {
    this.life = o.life || 11; this.w0 = o.w0 || 0.5; this.w1 = o.w1 || 5; this.alpha = o.alpha ?? 0.85; this.step = o.step || 4; this.lit = o.lit ?? true; this.rise = o.rise ?? 0.35; this.vlen = o.vlen || Math.max(60, this.w1 * 14); // metros de rastro por repetição da textura
    this.col = new THREE.Color(o.color ?? 0xeeeeea);
    this.p = new Float32Array(N * 3); this.t = new Float32Array(N); this.j = new Float32Array(N * 3); this.n = 0; this.head = 0; this.open = true; this.age = 0; this.turb = o.turb ?? 0.5;
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
    // turbulência: cada amostra deriva para um lado sorteado (suave de uma para a outra) conforme envelhece — a fita ondula
    const q = this.n ? (i - 1 + N) % N : i; for (let a = 0; a < 3; a++) this.j[i * 3 + a] = (this.n ? this.j[q * 3 + a] * 0.6 : 0) + (Math.random() - 0.5) * 0.8;
    this.head = (i + 1) % N; this.n = Math.min(N, this.n + 1);
    this.last = (this.last || new THREE.Vector3()).copy(pos); this.tip = null;
  }
  close() { this.open = false; }
  // reconstrói a fita: largura e alfa pela idade de cada amostra
  update(now, dt) {
    const g = this.mesh.geometry, P = g.attributes.position.array, C = g.attributes.color.array, U = g.attributes.uv.array;
    let k = 0, alive = 0; _pv.setFromMatrixColumn(camera.matrixWorld, 0); // lado da amostra anterior (começa no "direita" da câmera)
    // contra o céu HDR a fumaça precisa da luz do dia (cor > 1): com cor ≤ 1 o rastro saía cinza-escuro, quase preto
    const cr = this.col.r * (this.lit ? SKYLIT.r : 1), cg = this.col.g * (this.lit ? SKYLIT.g : 1), cb = this.col.b * (this.lit ? SKYLIT.b : 1);
    for (let j = 0; j < this.n; j++) {
      const i = (this.head - this.n + j + N) % N, age = now - this.t[i], f = age / this.life;
      if (f >= 1) continue;
      alive++;
      const w = this.w0 + (this.w1 - this.w0) * Math.sqrt(f), dr = this.turb * w * Math.min(1, age * 0.8);
      _s.set(this.p[i * 3] + this.j[i * 3] * dr, this.p[i * 3 + 1] + age * this.rise + this.j[i * 3 + 1] * dr, this.p[i * 3 + 2] + this.j[i * 3 + 2] * dr); // sobe devagar (ar quente/vento)
      // tangente pela vizinha; lado = tangente × direção da câmera
      const jn = j < this.n - 1 ? (i + 1) % N : (i - 1 + N) % N;
      _t.set(this.p[jn * 3] - this.p[i * 3], this.p[jn * 3 + 1] - this.p[i * 3 + 1], this.p[jn * 3 + 2] - this.p[i * 3 + 2]);
      if (j === this.n - 1) _t.negate();
      _c.copy(camera.position).sub(_s);
      // lado da fita = tangente × direção da câmera. Com o rastro apontando para a câmera (o SEU míssil indo embora) o produto
      // some: o lado virava ruído, trocava de sinal de amostra em amostra e a fita torcia em gravata e esticava em espetos.
      // Agora o lado nunca inverte em relação à amostra anterior e, quase alinhado, herda o dela.
      const tl = _t.length() || 1, dC = _c.length() || 1; _t.cross(_c); const L = _t.length(), sn = L / (tl * dC);
      if (L > 1e-9) _t.divideScalar(L); else _t.copy(_pv);
      if (_t.dot(_pv) < 0) _t.negate();
      if (sn < 0.3) _t.lerp(_pv, 1 - sn / 0.3).normalize();
      _pv.copy(_t);
      P[k * 6] = _s.x + _t.x * w; P[k * 6 + 1] = _s.y + _t.y * w; P[k * 6 + 2] = _s.z + _t.z * w;
      P[k * 6 + 3] = _s.x - _t.x * w; P[k * 6 + 4] = _s.y - _t.y * w; P[k * 6 + 5] = _s.z - _t.z * w;
      // alfa: nasce forte, some com a idade; a ponta mais nova (perto do motor) um pouco mais clara
      // vista de PONTA (o seu míssil indo embora) a fita é uma laje deitada que tapava meia tela: ali ela some e quem
      // aparece são os tufos de fumaça soltos ao longo do rastro; e some também colada na câmera
      const a = this.alpha * (1 - f) ** 1.6 * Math.min(1, age * 6 + 0.35) * Math.min(1, Math.max(0, (sn - 0.05) / 0.25)) * Math.min(1, Math.max(0, (dC - 3) / 12));
      for (const o of [0, 4]) { C[k * 8 + o] = cr; C[k * 8 + o + 1] = cg; C[k * 8 + o + 2] = cb; C[k * 8 + o + 3] = a; }
      const tv = i * this.step / this.vlen; U[k * 4] = 0; U[k * 4 + 1] = tv; U[k * 4 + 2] = 1; U[k * 4 + 3] = tv; // preso à amostra: a textura não escorrega quando as velhas somem
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
