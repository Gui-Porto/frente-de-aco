import * as THREE from 'three';
import { SURF, tipBreak, finCfg } from './planeGeom.js';
// =====================================================================
// Fatia a pele glTF nas MESMAS peças do modelo de dano. A pele chega com a asa e a empenagem inteiras: quando a
// ponta da asa quebrava ou um aileron era arrancado, a HUD mostrava a peça perdida e o avião continuava inteiro
// na tela (o que se soltava era a estrutura procedural, invisível por baixo). Aqui cada triângulo da pele vai
// para o grupo da peça a que pertence — ponta da asa, aileron, flap, profundor, leme — e as superfícies de comando
// ganham a própria dobradiça (medida na pele), então também se mexem com o comando.
// A classificação é pela planta DA PELE (envergadura e corda locais medidas nos vértices), não pela do procedural:
// as duas não coincidem ao centímetro. Feita uma vez por arquivo (cache por geometria); cada avião só monta as malhas.
// def.model.split = false desliga (formas fora do padrão: A-10 com dois lemes nas pontas do estabilizador).
// =====================================================================
const cache = new Map();   // geometry.uuid → { peça: BufferGeometry } ('' = o que fica no nó)
const hinges = new Map();  // url → { nome: [P0, P1] } no referencial do avião
const NB = 28, _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

const meshesOf = node => { const l = []; node.traverse(o => { if (o.isMesh) l.push(o); }); return l; };
const toRoot = (o, rootInv) => _m.multiplyMatrices(rootInv, o.matrixWorld).clone();
function eachVert(meshes, rootInv, f) {
  for (const o of meshes) { const M = toRoot(o, rootInv), p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).applyMatrix4(M); f(_v.x, _v.y, _v.z); } }
}
// pontos ao longo das ARESTAS (não só vértices): em malha de poucos triângulos (MiG-21, F-4E) a maioria das faixas não tinha
// vértice nenhum, ficava sem corda medida e a peça saía em tiras alternadas, como um pente
function eachEdge(meshes, rootInv, f) {
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const o of meshes) {
    const M = toRoot(o, rootInv), p = o.geometry.attributes.position, idx = o.geometry.index ? o.geometry.index.array : null, n = idx ? idx.length : p.count;
    for (let t = 0; t < n; t += 3) {
      for (let k = 0; k < 3; k++) P[k].fromBufferAttribute(p, idx ? idx[t + k] : t + k).applyMatrix4(M);
      for (let k = 0; k < 3; k++) { const a = P[k], b = P[(k + 1) % 3], m = Math.min(12, 1 + Math.ceil(a.distanceTo(b) / 0.08)); for (let i = 0; i < m; i++) { const u = i / m; f(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u); } }
    }
  }
}
// faixas ao longo de um eixo: bordo de ataque (z máx), de fuga (z mín) e a altura (2º eixo) do bordo de fuga
function bins(lo, hi) {
  const B = { lo, hi, zmax: new Float32Array(NB).fill(-1e9), zmin: new Float32Array(NB).fill(1e9), h: new Float32Array(NB) };
  B.i = t => Math.max(0, Math.min(NB - 1, Math.floor((t - lo) / (hi - lo) * NB)));
  B.add = (t, z, h) => { if (t < lo || t > hi) return; const i = B.i(t); if (z > B.zmax[i]) B.zmax[i] = z; if (z < B.zmin[i]) { B.zmin[i] = z; B.h[i] = h; } };
  B.cf = (t, z) => { const i = B.i(t), c = B.zmax[i] - B.zmin[i]; return c > 0.05 ? (B.zmax[i] - z) / c : -1; }; // 0 = bordo de ataque, 1 = de fuga
  B.chord = t => { const i = B.i(t); return Math.max(0, B.zmax[i] - B.zmin[i]); };
  B.at = (t, cf) => { const i = B.i(t); return [B.zmax[i] - cf * (B.zmax[i] - B.zmin[i]), B.h[i]]; };
  return B;
}
// Triângulo que atravessa a fronteira entre duas peças é subdividido (pontos médios) até ~10 cm: com o triângulo inteiro
// indo para um lado só, malha de triângulos grandes (F-4E) saía em lascas de meio metro. Os vértices novos entram no fim
// dos mesmos atributos; cada peça é só um índice diferente sobre eles.
function split(o, rootInv, classify) {
  const g = o.geometry; let out = cache.get(g.uuid);
  if (!out) {
    const M = toRoot(o, rootInv), names = Object.keys(g.attributes), src = names.map(n => g.attributes[n]), P = g.attributes.position;
    const A = src.map(a => { const arr = new Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k); return arr; });
    const pos = A[names.indexOf('position')], rp = [], key = [], mids = new Map(), parts = {}; let nv = P.count;
    const R = i => { if (rp[i * 3] === undefined) { _v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(M); rp[i * 3] = _v.x; rp[i * 3 + 1] = _v.y; rp[i * 3 + 2] = _v.z; } return i * 3; };
    const kv = i => { if (key[i] === undefined) { const q = R(i); key[i] = classify(rp[q], rp[q + 1], rp[q + 2]); } return key[i]; };
    const mid = (a, b) => { const k = a < b ? a * 4194304 + b : b * 4194304 + a; let m = mids.get(k); if (m === undefined) { m = nv++; for (let t = 0; t < A.length; t++) { const n = src[t].itemSize, arr = A[t]; for (let c = 0; c < n; c++) arr[m * n + c] = (arr[a * n + c] + arr[b * n + c]) / 2; } mids.set(k, m); } return m; };
    const d2 = (a, b) => { const p = R(a), q = R(b); return (rp[p] - rp[q]) ** 2 + (rp[p + 1] - rp[q + 1]) ** 2 + (rp[p + 2] - rp[q + 2]) ** 2; };
    const rec = (a, b, c, d) => {
      const p = R(a), q = R(b), r = R(c), kc = classify((rp[p] + rp[q] + rp[r]) / 3, (rp[p + 1] + rp[q + 1] + rp[r + 1]) / 3, (rp[p + 2] + rp[q + 2] + rp[r + 2]) / 3);
      if (d >= 6 || (kv(a) === kc && kv(b) === kc && kv(c) === kc) || Math.max(d2(a, b), d2(b, c), d2(c, a)) < 0.01) { (parts[kc] || (parts[kc] = [])).push(a, b, c); return; }
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      rec(a, ab, ca, d + 1); rec(ab, b, bc, d + 1); rec(ca, bc, c, d + 1); rec(ab, bc, ca, d + 1);
    };
    const idx = g.index ? g.index.array : null, n = idx ? idx.length : P.count;
    for (let t = 0; t < n; t += 3) rec(idx ? idx[t] : t, idx ? idx[t + 1] : t + 1, idx ? idx[t + 2] : t + 2, 0);
    const attrs = names.map((nm, t) => new THREE.Float32BufferAttribute(A[t], src[t].itemSize));
    out = {};
    for (const k in parts) { const s = new THREE.BufferGeometry(); names.forEach((nm, t) => s.setAttribute(nm, attrs[t])); s.setIndex(parts[k]); s.computeBoundingSphere(); s.computeBoundingBox(); out[k] = s; }
    cache.set(g.uuid, out);
  }
  const made = {};
  for (const k in out) {
    if (k === '') continue;
    const m = new THREE.Mesh(out[k], o.material); m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
    m.castShadow = o.castShadow; m.receiveShadow = o.receiveShadow; m.renderOrder = o.renderOrder; m.userData.normalMat = o.userData.normalMat;
    o.parent.add(m); m.updateMatrixWorld(true); made[k] = m;
  }
  if (out['']) o.geometry = out['']; else o.visible = false; // o nó ficou sem nada (tudo virou peça)
  return made;
}

// r = o que buildPlane() montou (wingL/R, tipL/R, tail, surf); wings/tailNode = nós da pele já presos aos grupos.
// Devolve as malhas novas (somem junto com a pele na vista de cabine).
export function splitSkin(D, r, nodes) {
  if (D.model.split === false) return [];
  r.root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(r.root.matrixWorld).invert(), all = [], H = hinges.get(D.model.url) || {};
  hinges.set(D.model.url, H);
  const put = (made, name, group) => { const m = made[name]; if (!m || !group) return; group.attach(m); all.push(m); };
  // dobradiça própria da pele: pivô novo no lugar do procedural (que passa a andar junto, escondido)
  const hinge = (name, made) => {
    const old = r.surf && r.surf[name], m = made[name]; if (!m) return;
    if (!old || !H[name]) { all.push(m); return; } // sem comando no modelo de dano: fica onde está
    const par = old.pivot.parent, piv = new THREE.Group(), [P0, P1] = H[name];
    par.updateMatrixWorld(true);
    piv.position.copy(par.worldToLocal(r.root.localToWorld(_a.fromArray(P0)))); par.add(piv); piv.updateMatrixWorld(true);
    const ax = par.worldToLocal(r.root.localToWorld(_b.fromArray(P1))).sub(piv.position).normalize();
    if (ax.dot(_a.copy(old.axis).applyQuaternion(old.pivot.quaternion)) < 0) ax.negate(); // mesmo sentido de giro do procedural
    piv.attach(old.pivot); piv.attach(m); all.push(m);
    r.surf[name] = { pivot: piv, axis: ax.clone(), max: old.max, base: new THREE.Quaternion() };
  };
  // ---------- asas ----------
  for (const [side, sg] of [['L', 1], ['R', -1]]) {
    const node = nodes['wing' + side]; if (!node) continue;
    const ms = meshesOf(node); if (!ms.length) continue;
    const need = ms.some(o => !cache.has(o.geometry.uuid)); let cls = null;
    if (need) {
      let x0 = 1e9, x1 = 0; eachVert(ms, rootInv, x => { const a = sg * x; if (a < x0) x0 = a; if (a > x1) x1 = a; });
      const B = bins(x0, x1); eachEdge(ms, rootInv, (x, y, z) => B.add(sg * x, z, y));
      const S = t => (t - x0) / (x1 - x0), X = s => x0 + s * (x1 - x0), ail = D.ail || SURF.ail, flap = D.flap || SURF.flap, sT = tipBreak(D), cfH = SURF.cf;
      cls = (x, y, z) => {
        const t = sg * x, s = S(t), cf = B.cf(t, z), thin = Math.abs(y - B.at(t, 1)[1]) < 0.05 * B.chord(t) + 0.05; // só a casca da asa: tanques, pilones e mísseis ficam de fora
        if (cf > cfH && thin) { if (s >= ail[0] && s <= ail[1]) return 'ail' + side; if (s >= flap[0] && s <= flap[1]) return 'flap' + side; }
        return s > sT ? 'tip' : '';
      };
      for (const [nm, rg] of [['ail', ail], ['flap', flap]]) { const a = B.at(X(rg[0]), cfH), b = B.at(X(rg[1]), cfH); H[nm + side] = [[sg * X(rg[0]), a[1], a[0]], [sg * X(rg[1]), b[1], b[0]]]; }
    }
    for (const o of ms) { const made = split(o, rootInv, cls); put(made, 'tip', r['tip' + side]); hinge('ail' + side, made); hinge('flap' + side, made); }
  }
  // ---------- empenagem ----------
  const tn = nodes.tail, tms = tn ? meshesOf(tn) : [];
  if (tms.length) {
    let cls = null;
    if (tms.some(o => !cache.has(o.geometry.uuid))) {
      let xm = 0, yT = -1e9; eachVert(tms, rootInv, (x, y) => { if (Math.abs(x) > xm) xm = Math.abs(x); if (y > yT) yT = y; });
      const xs = Math.max(0.3, xm * 0.3), allMove = D.stab === 'all', cfE = allMove ? -1 : 0.64, fin = finCfg(D), yb = yT - fin.half * 0.8, xf = Math.max(0.1, xm * 0.07);
      const BL = bins(xs, xm), BR = bins(xs, xm), BF = bins(yb, yT);
      eachEdge(tms, rootInv, (x, y, z) => { if (x > xs) BL.add(x, z, y); else if (x < -xs) BR.add(-x, z, y); if (Math.abs(x) < xf && y > yb) BF.add(y, z, x); });
      cls = (x, y, z) => {
        const ax = Math.abs(x);
        if (ax > xs) { const B = x > 0 ? BL : BR; if (Math.abs(y - B.at(ax, 1)[1]) < 0.14 * B.chord(ax) + 0.12 && (allMove || B.cf(ax, z) > cfE)) return x > 0 ? 'elevL' : 'elevR'; } // altura pelo bordo de fuga LOCAL: o estabilizador do F-4 desce 23°
        if (ax < xf && y > yb && y < yT - (yT - yb) * 0.04 && BF.cf(y, z) > 0.66) return 'rud';
        return '';
      };
      for (const [nm, B, s] of [['elevL', BL, 1], ['elevR', BR, -1]]) { const c = allMove ? 0.45 : cfE, a = B.at(xs, c), b = B.at(xm * 0.95, c); H[nm] = [[s * xs, a[1], a[0]], [s * xm * 0.95, b[1], b[0]]]; }
      { const a = BF.at(yb, 0.66), b = BF.at(yT - (yT - yb) * 0.06, 0.66); H.rud = [[0, yb, a[0]], [0, yT - (yT - yb) * 0.06, b[0]]]; }
    }
    for (const o of tms) { const made = split(o, rootInv, cls); for (const n of ['elevL', 'elevR', 'rud']) hinge(n, made); }
  }
  return all;
}

// Miolo da pele em volta do piloto (interior modelado, molduras da capota): peça à parte que some na vista de cabine —
// de dentro, só ela tapava o painel e a mira; a casca de fora já é invisível por dentro (faces viradas para fora).
// heads = [[y, z], ...] cabeças dos tripulantes no referencial do avião. Devolve as malhas.
export function splitCockpit(D, r, body, heads) {
  if (D.model.split === false || !heads.length) return [];
  r.root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(r.root.matrixWorld).invert(), out = [];
  const z0 = Math.min(...heads.map(h => h[1])) - 0.9, z1 = Math.max(...heads.map(h => h[1])) + 1.25, y0 = heads[0][0] - 1.15, y1 = heads[0][0] + 0.5;
  const cls = (x, y, z) => (Math.abs(x) < 0.55 && y > y0 && y < y1 && z > z0 && z < z1 ? 'cz' : '');
  for (const o of meshesOf(body)) { const made = split(o, rootInv, cls); if (made.cz) out.push(made.cz); }
  return out;
}
