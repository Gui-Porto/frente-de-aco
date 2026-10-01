'use strict';
// =====================================================================
// Utilidades, renderizador, terreno e cenário
// =====================================================================
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V3 = THREE.Vector3, QUAT = THREE.Quaternion;
const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rv = s => new V3(rand(-s, s), rand(-s, s), rand(-s, s));
const UP = new V3(0, 1, 0);
function angDiff(a, b) { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; }
function hash2(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
let now = 0;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.domElement.className = 'gl';
$('#app').prepend(renderer.domElement);

const scene = new THREE.Scene();
const FOGC = 0xa7b2ac;
scene.background = new THREE.Color(FOGC);
scene.fog = new THREE.FogExp2(FOGC, 0.00085);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 12000);

const sky = (() => {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x56789a) }, hor: { value: new THREE.Color(0xc2c7b8) }, sunDir: { value: new V3(0.5, 0.75, 0.3).normalize() } },
    vertexShader: 'varying vec3 vp; void main(){ vp=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; varying vec3 vp; void main(){ float t=clamp(vp.y*2.0,0.0,1.0); vec3 c=mix(hor,top,pow(t,0.65)); float s=max(dot(normalize(vp),sunDir),0.0); c+=vec3(1.0,0.9,0.7)*pow(s,300.0)*2.0+vec3(0.35,0.28,0.18)*pow(s,8.0); gl_FragColor=vec4(c,1.0);}'
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), m); s.renderOrder = -1; scene.add(s); return s;
})();
const hemi = new THREE.HemisphereLight(0xdfe6ea, 0x4c4630, 0.72); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d2, 2.15);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 800 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const flash = new THREE.PointLight(0xffb060, 0, 60, 2); scene.add(flash);
let flashT = 0;
function flashAt(pos, inten) { flash.position.copy(pos); flash.intensity = inten; flashT = 0.08; }

// =====================================================================
// Terreno analítico (a física consulta H(x,z) diretamente)
// =====================================================================
const LIMIT = 360, INNER = 900, OUTER = 8000, AIRLIMIT = 3200;
const POINTS = [{ id: 'A', x: -190, z: 25 }, { id: 'B', x: 0, z: 0 }, { id: 'C', x: 190, z: -25 }];
const SPAWN = { 1: { x: 0, z: 300, yaw: Math.PI }, '-1': { x: 0, z: -300, yaw: 0 } };
const AIRSPAWN = { 1: { x: 0, z: 2400, y: 1300, yaw: Math.PI }, '-1': { x: 0, z: -2400, y: 1300, yaw: 0 } };
function baseH(x, z) {
  let h = 9 * Math.sin(x * 0.009 + 0.5) * Math.cos(z * 0.011) + 4 * Math.sin(x * 0.023 + 1.3) * Math.sin(z * 0.027 + 0.7)
    + 1.3 * Math.sin(x * 0.061 + z * 0.047) + 0.6 * Math.sin(x * 0.13 - z * 0.11)
    + 22 * Math.sin(x * 0.0019 + 1.1) * Math.cos(z * 0.0023 + 0.4) + 10 * Math.sin(x * 0.0041 + z * 0.0033);
  const r = Math.max(Math.abs(x), Math.abs(z)) - 700;
  if (r > 0) h += Math.min(r * 0.05, 90) * (0.55 + 0.45 * Math.sin(x * 0.0031) * Math.cos(z * 0.0027 + 1));
  return h;
}
const FLATS = [...POINTS.map(p => ({ x: p.x, z: p.z, r: 48 })), { x: 0, z: 300, r: 55 }, { x: 0, z: -300, r: 55 }];
for (const f of FLATS) f.h = baseH(f.x, f.z);
function H(x, z) {
  let h = baseH(x, z);
  for (const f of FLATS) {
    const dx = x - f.x, dz = z - f.z, d2 = dx * dx + dz * dz;
    if (d2 < f.r * f.r) { const t = Math.sqrt(d2) / f.r, k = t * t * (3 - 2 * t); h = f.h * (1 - k) + h * k; }
  }
  return h;
}
function terrainNormal(x, z, out) { const e = 0.8; return out.set(H(x - e, z) - H(x + e, z), 2 * e, H(x, z - e) - H(x, z + e)).normalize(); }

const ROADS = [];
for (const p of POINTS) { ROADS.push([SPAWN[1].x, SPAWN[1].z, p.x, p.z]); ROADS.push([SPAWN[-1].x, SPAWN[-1].z, p.x, p.z]); }
ROADS.push([POINTS[0].x, POINTS[0].z, POINTS[1].x, POINTS[1].z], [POINTS[1].x, POINTS[1].z, POINTS[2].x, POINTS[2].z]);
ROADS.push([-2000, 60, -190, 25], [190, -25, 2000, -80], [0, 300, 40, 2000], [0, -300, -60, -2000]);
function segDist2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
const roadDist = (x, z) => { let d = 1e9; for (const r of ROADS) d = Math.min(d, segDist2D(x, z, r[0], r[1], r[2], r[3])); return d; };

// Campos cultivados da Normandia: mosaico de lotes com cercas vivas (bocage)
const FW = 64, FD = 52;
const fieldCell = (x, z) => [Math.floor((x + 13) / FW), Math.floor((z + 7) / FD)];
const CROPS = [[0.105, 0.155, 0.055], [0.30, 0.25, 0.11], [0.16, 0.115, 0.07], [0.14, 0.185, 0.065], [0.24, 0.23, 0.1]];
function groundColor(x, z, out) {
  const [i, j] = fieldCell(x, z), c = CROPS[Math.floor(hash2(i, j) * CROPS.length)];
  const n = 0.5 + 0.5 * (Math.sin(x * 0.045) * Math.sin(z * 0.038) * 0.6 + 0.4 * Math.sin(x * 0.11 + z * 0.083));
  let r = c[0] * (0.85 + n * 0.3), g = c[1] * (0.85 + n * 0.3), b = c[2] * (0.85 + n * 0.3);
  // sulcos de arado nos lotes arados
  if (c === CROPS[2]) { const s = 0.5 + 0.5 * Math.sin(x * 1.6); r *= 0.85 + s * 0.2; g *= 0.85 + s * 0.2; }
  const slope = Math.hypot(H(x + 1, z) - H(x - 1, z), H(x, z + 1) - H(x, z - 1)) / 2;
  if (slope > 0.32) { const k = clamp((slope - 0.32) * 3, 0, 0.8); r = lerp(r, 0.2, k); g = lerp(g, 0.18, k); b = lerp(b, 0.13, k); }
  const rd = roadDist(x, z);
  if (rd < 6) { const k = clamp((6 - rd) / 3, 0, 1) * 0.92; r = lerp(r, 0.2, k); g = lerp(g, 0.155, k); b = lerp(b, 0.09, k); }
  for (const p of POINTS) { const d = Math.hypot(x - p.x, z - p.z); if (d < 30) { const k = (1 - d / 30) * 0.6; r = lerp(r, 0.19, k); g = lerp(g, 0.16, k); b = lerp(b, 0.1, k); } }
  return out.setRGB(r, g, b);
}
function noiseTex(size, base, amp, blobs) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) { const v = base + (Math.random() - 0.5) * amp; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < blobs; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,255,255'},0.06)`; g.beginPath(); g.arc(Math.random() * size, Math.random() * size, rand(3, 14), 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  return t;
}
{
  const groundTex = noiseTex(256, 215, 80, 600);
  const mk = (size, seg, drop, holeR) => {
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const ed = holeR ? 0 : sstep(INNER / 2 - 50, INNER / 2, Math.max(Math.abs(x), Math.abs(z))) * 1.4;
      pos.setY(i, H(x, z) - drop - ed);
      groundColor(x, z, c); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (holeR) { // remove os triângulos cobertos pela malha interna
      const idx = g.index.array, keep = [];
      for (let t = 0; t < idx.length; t += 3) {
        let inside = true;
        for (let k = 0; k < 3; k++) { const v = idx[t + k]; if (Math.max(Math.abs(pos.getX(v)), Math.abs(pos.getZ(v))) > holeR) { inside = false; break; } }
        if (!inside) keep.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      g.setIndex(keep);
    }
    g.computeVertexNormals();
    const tex = groundTex.clone(); tex.needsUpdate = true; tex.repeat.set(size / 5.6, size / 5.6);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, map: tex }));
    m.receiveShadow = true; scene.add(m); return m;
  };
  mk(INNER, 225, 0, 0);
  mk(OUTER, 250, 1.4, INNER / 2 - 24);
}

// =====================================================================
// Obstáculos (AABB) com grade espacial
// =====================================================================
const OBST = [], OGRID = new Map(), GCELL = 24;
let obstStamp = 0;
const gk = (i, j) => (i + 512) * 1024 + (j + 512);
function regObst(b) {
  b.stamp = 0; OBST.push(b);
  for (let i = Math.floor(b.mn[0] / GCELL); i <= Math.floor(b.mx[0] / GCELL); i++)
    for (let j = Math.floor(b.mn[2] / GCELL); j <= Math.floor(b.mx[2] / GCELL); j++) {
      const k = gk(i, j); if (!OGRID.has(k)) OGRID.set(k, []); OGRID.get(k).push(b);
    }
}
const _cand = [];
function obstNear(x0, z0, x1, z1) {
  _cand.length = 0; obstStamp++;
  const i0 = Math.floor(Math.min(x0, x1) / GCELL), i1 = Math.floor(Math.max(x0, x1) / GCELL);
  const j0 = Math.floor(Math.min(z0, z1) / GCELL), j1 = Math.floor(Math.max(z0, z1) / GCELL);
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > 900) { for (const b of OBST) _cand.push(b); return _cand; }
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const l = OGRID.get(gk(i, j)); if (!l) continue;
    for (const b of l) if (b.stamp !== obstStamp) { b.stamp = obstStamp; _cand.push(b); }
  }
  return _cand;
}
const stoneTex = noiseTex(128, 200, 70, 200);
const stoneMat = new THREE.MeshStandardMaterial({ color: lin(0x8a8273), roughness: .95, map: stoneTex });
const plasterMat = new THREE.MeshStandardMaterial({ color: lin(0xb3aa94), roughness: .95, map: stoneTex });
const roofMat = new THREE.MeshStandardMaterial({ color: lin(0x5a3426), roughness: .9 });
const slateMat = new THREE.MeshStandardMaterial({ color: lin(0x3c4048), roughness: .8 });
const ruinMat = new THREE.MeshStandardMaterial({ color: lin(0x6d675c), roughness: 1 });
const winMat = new THREE.MeshStandardMaterial({ color: lin(0x1d1f1c), roughness: .4 });
function groundMin(x, z, w, d) { return Math.min(H(x - w / 2, z - d / 2), H(x + w / 2, z - d / 2), H(x - w / 2, z + d / 2), H(x + w / 2, z + d / 2), H(x, z)); }
function addBox(x, z, w, d, h, mat, y0) {
  if (y0 === undefined) y0 = groundMin(x, z, w, d) - 0.6;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y0 + h / 2, z); m.castShadow = m.receiveShadow = true; scene.add(m);
  regObst({ mn: [x - w / 2, y0, z - d / 2], mx: [x + w / 2, y0 + h, z + d / 2] });
  return y0 + h;
}
function clearSpot(x, z, rad) {
  if (roadDist(x, z) < rad + 5) return false;
  for (const p of POINTS) if (Math.hypot(x - p.x, z - p.z) < 18 + rad) return false;
  for (const s of [SPAWN[1], SPAWN[-1]]) if (Math.hypot(x - s.x, z - s.z) < 48) return false;
  for (const b of obstNear(x - rad - 3, z - rad - 3, x + rad + 3, z + rad + 3)) if (x + rad > b.mn[0] - 3 && x - rad < b.mx[0] + 3 && z + rad > b.mn[2] - 3 && z - rad < b.mx[2] + 3) return false;
  return true;
}
let seed = 7; const srand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function house(x, z, ruined) {
  const w = 6 + srand() * 4, d = 7 + srand() * 4, h = ruined ? 2 + srand() * 2 : 4 + srand() * 2.4;
  if (!clearSpot(x, z, Math.max(w, d) / 2)) return;
  const mat = srand() < 0.5 ? stoneMat : plasterMat;
  const top = addBox(x, z, w, d, h + 0.6, mat);
  if (ruined) return;
  // janelas
  for (const s of [1, -1]) for (let k = -1; k <= 1; k += 2) {
    const wm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.1), winMat); wm.position.set(x + k * w * 0.22, top - h * 0.45, z + s * (d / 2 + 0.03)); scene.add(wm);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), srand() < 0.6 ? roofMat : slateMat);
  roof.rotation.y = Math.PI / 4; roof.scale.set((w / 2 + 0.4) / 0.707, 2.8, (d / 2 + 0.4) / 0.707);
  roof.position.set(x, top + 1.4, z); roof.castShadow = true; scene.add(roof);
}
// Igreja de pedra no vilarejo B (marco visual também para aviões)
{
  const x = 34, z = -38, y0 = groundMin(x, z, 12, 24) - 0.6;
  addBox(x, z, 11, 22, 11, stoneMat, y0);
  const tri = new THREE.Shape(); tri.moveTo(-6.2, 0); tri.lineTo(6.2, 0); tri.lineTo(0, 5.5); tri.closePath();
  const rg = new THREE.ExtrudeGeometry(tri, { depth: 22.6, bevelEnabled: false }); rg.translate(0, 0, -11.3);
  const roof = new THREE.Mesh(rg, slateMat); roof.position.set(x, y0 + 11, z); roof.castShadow = true; scene.add(roof);
  addBox(x, z + 13, 5.5, 5.5, 24, stoneMat, y0);
  const sp = new THREE.Mesh(new THREE.ConeGeometry(3.9, 12, 4), slateMat); sp.rotation.y = Math.PI / 4; sp.position.set(x, y0 + 30, z + 13); sp.castShadow = true; scene.add(sp);
}
for (const p of POINTS) for (let i = 0; i < (p.id === 'B' ? 16 : 7); i++) { const a = srand() * Math.PI * 2, r = 24 + srand() * (p.id === 'B' ? 42 : 30); house(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, srand() < 0.25); }
for (let i = 0; i < 22; i++) house(srand() * 660 - 330, srand() * 540 - 270, srand() < 0.3);
for (let i = 0; i < 40; i++) house(srand() * 5000 - 2500, srand() * 5000 - 2500, false); // fazendas distantes
for (let i = 0; i < 22; i++) {
  const x = srand() * 660 - 330, z = srand() * 560 - 280, along = srand() < 0.5, len = 14 + srand() * 22;
  if (clearSpot(x, z, len / 2)) addBox(x, z, along ? len : 0.9, along ? 0.9 : len, 1.9, ruinMat);
}
for (let i = 0; i < 30; i++) {
  const x = srand() * 680 - 340, z = srand() * 600 - 300, s = 1.6 + srand() * 2.4;
  if (!clearSpot(x, z, s)) continue;
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), ruinMat);
  const y = H(x, z); m.position.set(x, y + s * 0.35, z); m.rotation.set(srand() * 3, srand() * 3, 0); m.castShadow = m.receiveShadow = true; scene.add(m);
  regObst({ mn: [x - s * 0.8, y - 2, z - s * 0.8], mx: [x + s * 0.8, y + s * 1.2, z + s * 0.8] });
}

// Geometria instanciada a partir de partes coloridas por vértice
function mergeColored(parts) {
  let n = 0; parts.forEach(([g]) => n += g.attributes.position.count);
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3); let o = 0;
  for (const [g, c] of parts) {
    P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < g.attributes.position.count; i++) C.set(c, (o + i) * 3);
    o += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return geo;
}
// Cercas vivas (bocage): bloqueiam a visão, não as granadas; tanques atravessam com perda de velocidade
const HEDGES = [];
{
  const bush = new THREE.IcosahedronGeometry(1, 0);
  const list = [];
  for (let i = -6; i <= 6; i++) for (let j = -7; j <= 7; j++) {
    for (const horiz of [true, false]) {
      if (hash2(i * 7 + (horiz ? 1 : 2), j * 13) > 0.42) continue;
      const x0 = i * FW - 13, z0 = j * FD - 7;
      const len = horiz ? FW : FD, cx = horiz ? x0 + FW / 2 : x0, cz = horiz ? z0 : z0 + FD / 2;
      if (Math.abs(cx) > LIMIT + 120 || Math.abs(cz) > LIMIT + 120) continue;
      const pts = [];
      for (let s = -len / 2; s <= len / 2; s += 2.2) {
        const x = horiz ? cx + s : cx + rand(-.3, .3), z = horiz ? cz + rand(-.3, .3) : cz + s;
        if (roadDist(x, z) < 7 || POINTS.some(p => Math.hypot(x - p.x, z - p.z) < 26) || [SPAWN[1], SPAWN[-1]].some(p => Math.hypot(x - p.x, z - p.z) < 50)) { if (pts.length > 2) HEDGES.push(seg(pts, horiz)); pts.length = 0; continue; }
        if (obstNear(x - 2, z - 2, x + 2, z + 2).some(b => x > b.mn[0] - 1 && x < b.mx[0] + 1 && z > b.mn[2] - 1 && z < b.mx[2] + 1)) continue;
        pts.push([x, z]); list.push([x, z]);
      }
      if (pts.length > 2) HEDGES.push(seg(pts, horiz));
    }
  }
  function seg(pts, horiz) {
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    const y0 = Math.min(...pts.map(p => H(p[0], p[1])));
    return { mn: [Math.min(...xs) - 0.8, y0 - 1, Math.min(...zs) - 0.8], mx: [Math.max(...xs) + 0.8, y0 + 2.9, Math.max(...zs) + 0.8], stamp: 0 };
  }
  const mesh = new THREE.InstancedMesh(mergeColored([[bush, [0.06, 0.1, 0.035]]]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), list.length);
  const m = new THREE.Matrix4(), q = new QUAT(), s = new V3(), p = new V3();
  list.forEach(([x, z], i) => { const sc = rand(1.2, 1.7); p.set(x, H(x, z) + sc * 0.6, z); q.setFromEuler(new THREE.Euler(rand(0, 3), rand(0, 3), 0)); s.set(sc, sc * rand(0.9, 1.3), sc); m.compose(p, q, s); mesh.setMatrixAt(i, m); });
  mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
}
// Árvores (derrubáveis na área de combate) e florestas distantes
const TREES = [];
let treeMesh;
{
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3, 6).toNonIndexed(); trunk.translate(0, 1.5, 0);
  const crown = new THREE.ConeGeometry(2.2, 7, 7).toNonIndexed(); crown.translate(0, 6, 0);
  const crown2 = new THREE.IcosahedronGeometry(3, 0); crown2.translate(0, 6, 0);
  const pine = mergeColored([[trunk, [0.16, 0.11, 0.07]], [crown, [0.06, 0.11, 0.045]]]);
  const oak = mergeColored([[trunk, [0.16, 0.11, 0.07]], [crown2, [0.09, 0.14, 0.05]]]);
  const list = [];
  for (let i = 0; i < 3000 && list.length < 520; i++) {
    const cx = srand() * 720 - 360, cz = srand() * 660 - 330;
    const k = Math.sin(cx * 0.02) * Math.cos(cz * 0.017) + Math.sin(cx * 0.051 + 2) * 0.4;
    if (k < 0.38) continue;
    if (clearSpot(cx, cz, 1.2)) list.push([cx, cz, 0.8 + srand() * 0.6]);
  }
  treeMesh = new THREE.InstancedMesh(pine, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, flatShading: true }), list.length);
  treeMesh.castShadow = true; treeMesh.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new QUAT(), s = new V3(), p = new V3();
  list.forEach(([x, z, sc], i) => {
    p.set(x, H(x, z) - 0.2, z); q.setFromAxisAngle(UP, srand() * 6); s.set(sc, sc, sc);
    m.compose(p, q, s); treeMesh.setMatrixAt(i, m);
    TREES.push({ x, z, sc, down: false, i, rot: q.clone() });
  });
  scene.add(treeMesh);
  const far = [];
  for (let i = 0; i < 20000 && far.length < 2600; i++) {
    const x = srand() * 7000 - 3500, z = srand() * 7000 - 3500;
    if (Math.max(Math.abs(x), Math.abs(z)) < INNER / 2) continue;
    if (Math.sin(x * 0.004) * Math.cos(z * 0.0035) + Math.sin(x * 0.011 + z * 0.007) * 0.5 < 0.55) continue;
    far.push([x, z, 0.9 + srand() * 0.7]);
  }
  const fm = new THREE.InstancedMesh(oak, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), far.length);
  far.forEach(([x, z, sc], i) => { p.set(x, H(x, z) - 1.6, z); q.setFromAxisAngle(UP, srand() * 6); s.set(sc * 1.4, sc * 1.4, sc * 1.4); m.compose(p, q, s); fm.setMatrixAt(i, m); });
  scene.add(fm);
}
function resetTrees() {
  const m = new THREE.Matrix4(), s = new V3(), p = new V3();
  for (const t of TREES) if (t.down) { t.down = false; s.set(t.sc, t.sc, t.sc); p.set(t.x, H(t.x, t.z) - 0.2, t.z); m.compose(p, t.rot, s); treeMesh.setMatrixAt(t.i, m); }
  treeMesh.instanceMatrix.needsUpdate = true;
}
function fellTree(t, dirx, dirz) {
  t.down = true;
  const axis = new V3(dirz, 0, -dirx).normalize();
  const q = new QUAT().setFromAxisAngle(axis, Math.PI / 2 * 0.95).multiply(t.rot);
  const m = new THREE.Matrix4().compose(new V3(t.x, H(t.x, t.z) + 0.2, t.z), q, new V3(t.sc, t.sc, t.sc));
  treeMesh.setMatrixAt(t.i, m); treeMesh.instanceMatrix.needsUpdate = true;
  sndCrack(new V3(t.x, H(t.x, t.z), t.z));
}

// Nuvens
{
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) { const x = rand(28, 100), y = rand(40, 88), r = rand(16, 34); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  const tex = new THREE.CanvasTexture(c);
  for (let i = 0; i < 70; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: rand(.6, .95), color: 0xf2f2ee }));
    const sc = rand(300, 700); s.scale.set(sc, sc * 0.45, 1);
    s.position.set(rand(-4500, 4500), rand(900, 1500), rand(-4500, 4500)); scene.add(s);
  }
}

// Pontos de captura
for (const p of POINTS) {
  p.r = 22; p.owner = 0; p.prog = 0; p.contested = false;
  const y = H(p.x, p.z);
  p.ring = new THREE.Mesh(new THREE.RingGeometry(p.r - 1, p.r, 64), new THREE.MeshBasicMaterial({ color: 0xddd6b7, transparent: true, opacity: .55, depthWrite: false }));
  p.ring.rotation.x = -Math.PI / 2; p.ring.position.set(p.x, y + 0.12, p.z); scene.add(p.ring);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 9, 6), new THREE.MeshStandardMaterial({ color: 0x777777 }));
  pole.position.set(p.x, y + 4.5, p.z); scene.add(pole);
  p.flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshStandardMaterial({ color: 0xddd6b7, side: THREE.DoubleSide, roughness: 1 }));
  p.flag.position.set(p.x + 1.25, y + 8.1, p.z); scene.add(p.flag);
}

// Crateras (decalques reaproveitados)
const CRATERS = [];
{
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(20,16,12,.95)'); gr.addColorStop(.55, 'rgba(45,36,25,.75)'); gr.addColorStop(1, 'rgba(60,50,35,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); CRATERS.push(m);
  }
}
let craterI = 0;
function addCrater(p, r) {
  if (Math.abs(p.y - H(p.x, p.z)) > 2) return;
  const m = CRATERS[craterI]; craterI = (craterI + 1) % CRATERS.length;
  m.visible = true; m.position.set(p.x, H(p.x, p.z) + 0.08, p.z); m.scale.setScalar(r); m.rotation.z = Math.random() * 6;
}
function hideCraters() { CRATERS.forEach(m => m.visible = false); }
