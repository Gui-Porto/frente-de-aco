import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// =====================================================================
// Modelos glTF dos blindados (opcional), só por dados:
//   def.model = { url, turret: 'nome do material da torre', ring: [x, y, z] (centro do anel da torre),
//                 trunnion: [x, y, z] (munhão do canhão), cut: z a partir do qual a malha da torre é canhão/mantelete,
//                 muzzle: z da boca do cano, scale?, rot? }
// Coordenadas do arquivo já no mundo dele: +y cima, +z frente (cano), metros, chão em y = 0.
// O arquivo não precisa ter nós separados: a torre é achada pelo material e o canhão é recortado dela em `cut`.
// Sem arquivo (ou falha ao carregar) o jogo segue com o tanque procedural.
// Trem de rolamento (opcional): `run: { plate: [largura, espessura máx.], wheels: [[y, z, raio], ...] }`. A malha do material
// `track` vem fundida; ela é quebrada em peças soltas (ilhas de triângulos) e cada peça vira roda (cabe no disco de um eixo e
// está centrada nele, ou é miúda), elo de esteira (perto do laço formado pelas sapatas) ou fica parada (braços, batentes).
// A esteira é UM elo (o do meio do trecho de baixo) instanciado ao longo do laço e deslocado pela fase do passo.
// =====================================================================
const loader = new GLTFLoader(), cache = new Map(), failed = new Set();

// separa os triângulos de g (não indexada) em [pred verdadeiro, falso]
function splitGeo(g, pred) {
  const names = Object.keys(g.attributes), pos = g.attributes.position, out = [{}, {}];
  for (const n of names) out[0][n] = [], out[1][n] = [];
  for (let t = 0; t < pos.count; t += 3) {
    const o = out[pred((pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3, (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3, (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3) ? 0 : 1];
    for (const n of names) { const a = g.attributes[n], s = a.itemSize; for (let i = t * s; i < (t + 3) * s; i++) o[n].push(a.array[i]); }
  }
  return out.map(o => { const r = new THREE.BufferGeometry(); for (const n of names) r.setAttribute(n, new THREE.Float32BufferAttribute(o[n], g.attributes[n].itemSize)); return r; });
}

// ilhas de triângulos de uma geometria não indexada (vértices soldados por posição): Int32Array com a ilha de cada triângulo
function islands(pos) {
  const ids = new Map(), vid = new Int32Array(pos.count), par = [];
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getX(i) * 2000) + ',' + Math.round(pos.getY(i) * 2000) + ',' + Math.round(pos.getZ(i) * 2000);
    let id = ids.get(k); if (id === undefined) { id = par.length; par.push(id); ids.set(k, id); } vid[i] = id;
  }
  const find = a => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  for (let t = 0; t < pos.count; t += 3) { const a = find(vid[t]); par[find(vid[t + 1])] = a; par[find(vid[t + 2])] = a; }
  const out = new Int32Array(pos.count / 3); for (let t = 0; t < out.length; t++) out[t] = find(vid[t * 3]);
  return out;
}
// geometria só com os triângulos escolhidos (opcionalmente transformada por mat)
function pick(g, tris, mat) {
  const r = new THREE.BufferGeometry();
  for (const n in g.attributes) { const a = g.attributes[n], s = a.itemSize, o = new Float32Array(tris.length * 3 * s); tris.forEach((t, i) => o.set(a.array.subarray(t * 3 * s, (t * 3 + 3) * s), i * 3 * s)); r.setAttribute(n, new THREE.BufferAttribute(o, s)); }
  return mat ? r.applyMatrix4(mat) : r;
}
function runningGear(g, R) {
  const pos = g.attributes.position, isl = islands(pos), comps = new Map();
  for (let t = 0; t < isl.length; t++) {
    let c = comps.get(isl[t]); if (!c) comps.set(isl[t], c = { tris: [], mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9] });
    c.tris.push(t);
    for (let i = t * 3; i < t * 3 + 3; i++) { const v = [pos.getX(i), pos.getY(i), pos.getZ(i)]; for (let k = 0; k < 3; k++) { c.mn[k] = Math.min(c.mn[k], v[k]); c.mx[k] = Math.max(c.mx[k], v[k]); } }
  }
  const all = [...comps.values()];
  for (const c of all) { c.c = c.mn.map((v, k) => (v + c.mx[k]) / 2); c.sz = c.mx.map((v, k) => v - c.mn[k]); }
  const still = [], wheels = [], tracks = [];
  for (const side of [1, -1]) {
    const mine = all.filter(c => c.c[0] * side > 0);
    // sapatas: largura conhecida e finas; ordenadas em volta do centro do laço
    let pl = mine.filter(c => Math.abs(c.sz[0] - R.plate[0]) < 0.015 && Math.hypot(c.sz[1], c.sz[2]) < R.plate[1]);
    const cnt = new Map(); for (const c of pl) cnt.set(c.tris.length, (cnt.get(c.tris.length) || 0) + 1);
    const mode = [...cnt].sort((a, b) => b[1] - a[1])[0]; pl = mode ? pl.filter(c => c.tris.length === mode[0]) : [];
    if (pl.length < 20) { still.push(...mine); continue; }
    const cy = pl.reduce((s, c) => s + c.c[1], 0) / pl.length, cz = pl.reduce((s, c) => s + c.c[2], 0) / pl.length;
    pl.sort((a, b) => Math.atan2(a.c[1] - cy, a.c[2] - cz) - Math.atan2(b.c[1] - cy, b.c[2] - cz));
    const N = pl.length, px = pl.reduce((s, c) => s + c.c[0], 0) / N;
    const frames = pl.map((c, i) => { const a = pl[(i + N - 1) % N].c, b = pl[(i + 1) % N].c; return { y: c.c[1], z: c.c[2], th: Math.atan2(-(b[1] - a[1]), b[2] - a[2]) }; });
    // elo de referência: o do meio do trecho de baixo
    let ref = -1; for (let i = 0; i < N; i++) if (pl[i].c[1] < cy && (ref < 0 || Math.abs(pl[i].c[2] - cz) < Math.abs(pl[ref].c[2] - cz))) ref = i;
    const link = [];
    for (const c of mine) {
      // elo: peça perto de uma sapata do laço
      let bi = -1, bd = 0.13; pl.forEach((q, i) => { const d = Math.hypot(c.c[1] - q.c[1], c.c[2] - q.c[2]); if (d < bd) { bd = d; bi = i; } });
      if (bi >= 0 && Math.abs(c.c[0] - px) < R.plate[0] * 0.95) { if (bi === ref) link.push(...c.tris); continue; }
      // roda: cabe inteira no disco do eixo mais próximo e está centrada nele (ou é miúda: parafuso, calota)
      let wi = -1, wd = 1e9; R.wheels.forEach(([y, z], i) => { const d = Math.hypot(c.c[1] - y, c.c[2] - z); if (d < wd) { wd = d; wi = i; } });
      const [wy, wz, wr] = R.wheels[wi], far = Math.max(...[c.mn, c.mx].flatMap(a => [c.mn, c.mx].map(b => Math.hypot(a[1] - wy, b[2] - wz))));
      if (far < wr + 0.015 && (wd < 0.03 || Math.hypot(...c.sz) < 0.2)) { (wheels[wi + (side > 0 ? 0 : R.wheels.length)] ||= { side, y: wy, z: wz, r: wr, tris: [] }).tris.push(...c.tris); continue; }
      still.push(c);
    }
    const f = frames[ref], inv = new THREE.Matrix4().makeRotationX(-f.th).multiply(new THREE.Matrix4().makeTranslation(0, -f.y, -f.z));
    // sentido: andando para frente o trecho de baixo corre para trás (z diminui)
    const nx = frames[(ref + 1) % N];
    tracks.push({ side, g: pick(g, link, inv), frames, dir: nx.z < f.z ? 1 : -1, pitch: Math.hypot(nx.y - f.y, nx.z - f.z) });
  }
  return {
    still: pick(g, still.flatMap(c => c.tris)), tracks,
    wheels: wheels.filter(Boolean).map(w => ({ side: w.side, r: w.r, at: [0, w.y, w.z], g: pick(g, w.tris, new THREE.Matrix4().makeTranslation(0, -w.y, -w.z)) }))
  };
}

function prepare(D, scene) {
  const M = D.model, fix = new THREE.Matrix4().makeScale(M.scale || 1, M.scale || 1, M.scale || 1);
  if (M.rot) fix.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...M.rot)));
  scene.updateMatrixWorld(true);
  const parts = { hull: [], track: [], turret: [], gun: [] }, mats = new Map();
  scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld).applyMatrix4(fix), mat = o.material;
    if (!mats.has(mat)) { mat.transparent = false; mat.depthWrite = true; mats.set(mat, mats.size); }
    const mi = mats.get(mat);
    if (mat.name === M.turret) {
      const [gun, tur] = splitGeo(g.toNonIndexed(), (x, y, z) => z > M.cut);
      parts.gun.push({ g: gun.translate(-M.trunnion[0], -M.trunnion[1], -M.trunnion[2]), mi });
      parts.turret.push({ g: tur.translate(-M.ring[0], -M.ring[1], -M.ring[2]), mi });
    } else parts[mat.name === (M.track || 'chassis') ? 'track' : 'hull'].push({ g, mi });
  });
  let run = null;
  if (M.run && parts.track.length) {
    // todas as malhas do trem viram uma só, não indexada, para as peças soltas poderem ser reagrupadas
    const gs = parts.track.map(p => p.g.toNonIndexed()), one = new THREE.BufferGeometry();
    for (const n in gs[0].attributes) { const s = gs[0].attributes[n].itemSize, o = new Float32Array(gs.reduce((t, q) => t + q.attributes[n].array.length, 0)); let at = 0; for (const q of gs) { o.set(q.attributes[n].array, at); at += q.attributes[n].array.length; } one.setAttribute(n, new THREE.BufferAttribute(o, s)); }
    run = runningGear(one, M.run); run.mi = parts.track[0].mi; parts.track = [{ g: run.still, mi: run.mi }];
  }
  return { parts, run, mats: [...mats.keys()] };
}

export async function preloadTankModels(defs) {
  await Promise.all(defs.filter(D => D.model && !cache.has(D.key) && !failed.has(D.key)).map(async D => {
    try { cache.set(D.key, prepare(D, (await loader.loadAsync(D.model.url)).scene)); }
    catch (e) { failed.add(D.key); console.warn(`[modelos] ${D.key}: ${D.model.url} indisponível, usando procedural`); }
  }));
}
export const hasTankModel = D => !!(D.model && cache.has(D.key));

// Monta o mesmo objeto que buildTank() devolve. tagArmor(mesh, D, part) grava a espessura por vértice (visão de blindagem).
export function gltfTank(D, tagArmor) {
  const C = cache.get(D.key), M = D.model, mats = C.mats.map(m => m.clone()), armorMeshes = [];
  const root = new THREE.Group(), turret = new THREE.Group(), gunPivot = new THREE.Group();
  turret.position.fromArray(M.ring); root.add(turret);
  gunPivot.position.set(M.trunnion[0] - M.ring[0], M.trunnion[1] - M.ring[1], M.trunnion[2] - M.ring[2]); turret.add(gunPivot);
  const put = (list, parent, part) => {
    for (const { g, mi } of list) {
      const m = new THREE.Mesh(g, mats[mi]); m.castShadow = m.receiveShadow = true; parent.add(m);
      if (!g.attributes.thick) { m.updateMatrix(); tagArmor(m, D, part); } else m.userData.normalMat = m.material;
      armorMeshes.push(m);
    }
  };
  put(C.parts.hull, root, 'hull'); put(C.parts.track, root, 'track'); put(C.parts.turret, turret, 'turret'); put(C.parts.gun, gunPivot, 'mantlet');
  const mz = new THREE.Object3D(); mz.position.set(0, 0, M.muzzle - M.trunnion[2]); gunPivot.add(mz);
  const mgMuzzle = new THREE.Object3D(); mgMuzzle.position.set(D.turret.w * .14, .05, .7); gunPivot.add(mgMuzzle);
  const still = () => ({ map: { offset: { x: 0 } } }), wheels = []; // a esteira do modelo anda por trackAnim, não por textura
  let trackAnim = null;
  if (C.run) {
    const mat = mats[C.run.mi], dummy = new THREE.Object3D();
    for (const w of C.run.wheels) { const m = new THREE.Mesh(w.g, mat); m.position.fromArray(w.at); m.castShadow = m.receiveShadow = true; root.add(m); wheels.push({ m, side: w.side, r: w.r }); }
    const belts = C.run.tracks.map(t => { const im = new THREE.InstancedMesh(t.g, mat, t.frames.length); im.castShadow = im.receiveShadow = true; im.frustumCulled = false; root.add(im); return { im, t, last: NaN }; });
    // off = [esquerda, direita] em metros andados pela esteira
    trackAnim = off => {
      for (const b of belts) {
        const { frames, dir, pitch } = b.t, N = frames.length, u = off[b.t.side > 0 ? 0 : 1] / pitch, k = Math.floor(u), f = u - k;
        if (Math.abs(u - b.last) < 1e-4) continue; b.last = u;
        for (let i = 0; i < N; i++) {
          const a = frames[(((i + k * dir) % N) + N) % N], c = frames[(((i + (k + 1) * dir) % N) + N) % N];
          let d = c.th - a.th; if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
          dummy.position.set(0, a.y + (c.y - a.y) * f, a.z + (c.z - a.z) * f); dummy.rotation.x = a.th + d * f; dummy.updateMatrix(); b.im.setMatrixAt(i, dummy.matrix);
        }
        b.im.instanceMatrix.needsUpdate = true;
      }
    };
    trackAnim([0, 0]);
  }
  return { root, turret, gunPivot, muzzles: [mz], mgMuzzle, mats, wheels, armorMeshes, trackL: still(), trackR: still(), trackAnim };
}
