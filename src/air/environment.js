import * as THREE from 'three';
import { scene, camera, sky, sun, hemi, SUN_DIR, FOGC, renderer, env, refreshEnvMap } from '../core/render.js';
import { planes } from '../core/state.js';
import { V3, clamp, rand, sstep } from '../core/util.js';
import { makeLayer, spawnP } from '../fx/particles.js';
// =====================================================================
// EnvironmentSystem: horário (sol, cor da luz, céu), clima (nuvens,
// neblina, chuva) e rastros (contrails em altitude, vapor nas asas com G).
// Tudo criado no carregamento: nenhum shader novo aparece na partida.
// =====================================================================
export const TIMES = {
  manha: { label: 'Manhã', elev: 16, az: 105, sun: 0xffe0bc, sunI: 2.3, hemiI: 0.3, fog: 0xc3cbcf, turb: 5, ray: 1.9, exp: 0.88 },
  meio: { label: 'Meio-dia', elev: 58, az: 165, sun: 0xfff4e2, sunI: 2.8, hemiI: 0.36, fog: 0xb9c6cd, turb: 3.6, ray: 1.4, exp: 0.82 },
  tarde: { label: 'Tarde', elev: 30, az: 230, sun: 0xffe9cc, sunI: 2.5, hemiI: 0.32, fog: 0xbcc4c3, turb: 4.4, ray: 1.7, exp: 0.85 },
  por: { label: 'Pôr do sol', elev: 3.5, az: 258, sun: 0xff9850, sunI: 1.7, hemiI: 0.2, fog: 0xc79a80, turb: 9, ray: 2.8, exp: 1.0 },
};
export const WEATHER = {
  limpo: { label: 'Céu limpo', cover: 0.22, dens: 0.35, fogMul: 0.75, clouds: 9, rain: 0, dim: 1 },
  nublado: { label: 'Nublado', cover: 0.78, dens: 0.75, fogMul: 1.25, clouds: 30, rain: 0, dim: 0.68 },
  chuva: { label: 'Chuva', cover: 0.95, dens: 0.95, fogMul: 2.3, clouds: 36, rain: 1, dim: 0.5 },
  neblina: { label: 'Neblina', cover: 0.5, dens: 0.5, fogMul: 4.2, clouds: 10, rain: 0, dim: 0.78 },
};
const U = sky.material.uniforms;
const BASE = { dir: SUN_DIR.clone(), sunC: sun.color.clone(), sunI: sun.intensity, hemiI: hemi.intensity, fog: FOGC.clone(), turb: U.turbidity.value, ray: U.rayleigh.value, cover: U.cloudCoverage.value, dens: U.cloudDensity.value, exp: renderer.toneMappingExposure };

// ---------- nuvens: camada de billboards instanciados (mesmo shader das partículas) ----------
const MAXC = 420, CL = makeLayer(false); CL.mesh.renderOrder = 1;
const puffs = [];
function buildClouds(n, tint) {
  puffs.length = 0;
  for (let c = 0; c < n; c++) {
    const cx = rand(-5200, 5200), cz = rand(-5200, 5200), cy = rand(1900, 2700), k = Math.floor(rand(6, 13)), R = rand(220, 520);
    for (let i = 0; i < k && puffs.length < MAXC; i++) {
      const s = rand(160, 380);
      puffs.push({ p: new V3(cx + rand(-R, R), cy + rand(-60, 90) + (i % 3) * 40, cz + rand(-R * .6, R * .6)), s, rot: rand(0, 6.28), sh: rand(0.88, 1.04) });
    }
  }
  const P = CL.pos.array, D = CL.dat.array, C = CL.col.array, col = new THREE.Color(tint);
  puffs.forEach((q, i) => {
    P[i * 3] = q.p.x; P[i * 3 + 1] = q.p.y; P[i * 3 + 2] = q.p.z;
    D[i * 4] = q.s; D[i * 4 + 1] = q.rot; D[i * 4 + 3] = 0;
    C[i * 4] = col.r * q.sh; C[i * 4 + 1] = col.g * q.sh; C[i * 4 + 2] = col.b * q.sh; C[i * 4 + 3] = 0.85;
  });
  CL.g.instanceCount = puffs.length;
  CL.pos.needsUpdate = CL.dat.needsUpdate = CL.col.needsUpdate = true;
}
// ---------- chuva: riscos em volta da câmera ----------
const NR = 1400, rainPos = new Float32Array(NR * 6);
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xa9b3bb, transparent: true, opacity: 0.32, depthWrite: false }));
rain.frustumCulled = false; rainGeo.setDrawRange(0, 0); scene.add(rain);
for (let i = 0; i < NR; i++) { const x = rand(-60, 60), y = rand(-40, 40), z = rand(-60, 60); rainPos.set([x, y, z, x, y - 1.6, z], i * 6); }
let raining = 0;

export function applyEnv(wKey, tKey) {
  const T = TIMES[tKey] || TIMES.tarde, W = WEATHER[wKey] || WEATHER.limpo;
  SUN_DIR.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - T.elev), THREE.MathUtils.degToRad(T.az));
  U.sunPosition.value.copy(SUN_DIR);
  U.turbidity.value = T.turb + W.cover * 4; U.rayleigh.value = T.ray; U.cloudCoverage.value = W.cover; U.cloudDensity.value = W.dens;
  sun.color.setHex(T.sun); sun.intensity = T.sunI * W.dim; hemi.intensity = T.hemiI * (0.8 + 0.2 * W.dim);
  FOGC.setHex(T.fog).multiplyScalar(0.75 + 0.25 * W.dim); scene.fog.color.copy(FOGC); scene.background.copy(FOGC);
  renderer.toneMappingExposure = T.exp;
  env.fogMul = W.fogMul;
  const tint = new THREE.Color(T.sun).lerp(new THREE.Color(0xffffff), 0.55).multiplyScalar(0.92 * (0.75 + 0.25 * W.dim));
  CL.mesh.material.uniforms.sunTint.value.copy(tint);
  buildClouds(W.clouds, 0xf2f2f0);
  raining = W.rain;
  rainGeo.setDrawRange(0, raining ? NR * 2 : 0);
  refreshEnvMap();
}
export function resetEnv() {
  SUN_DIR.copy(BASE.dir); U.sunPosition.value.copy(SUN_DIR);
  U.turbidity.value = BASE.turb; U.rayleigh.value = BASE.ray; U.cloudCoverage.value = BASE.cover; U.cloudDensity.value = BASE.dens;
  sun.color.copy(BASE.sunC); sun.intensity = BASE.sunI; hemi.intensity = BASE.hemiI;
  FOGC.copy(BASE.fog); scene.fog.color.copy(FOGC); scene.background.copy(FOGC);
  renderer.toneMappingExposure = BASE.exp; env.fogMul = 1;
  CL.g.instanceCount = 0; puffs.length = 0; raining = 0; rainGeo.setDrawRange(0, 0);
  refreshEnvMap();
}

const _w = new V3(), _t = new V3();
let fadeT = 0;
export function updateEnv(dt) {
  // nuvens somem ao chegar perto (não "bate" num cartão de papel)
  if ((fadeT -= dt) <= 0 && puffs.length) {
    fadeT = 0.08;
    const C = CL.col.array, cp = camera.position;
    for (let i = 0; i < puffs.length; i++) { const q = puffs[i], d = q.p.distanceTo(cp); C[i * 4 + 3] = 0.85 * sstep(q.s * 0.35, q.s * 1.3, d); }
    CL.col.needsUpdate = true;
  }
  CL.mesh.material.uniforms.fogDensity.value = scene.fog.density * 0.55;
  if (raining) {
    rain.position.copy(camera.position);
    const fall = dt * 38;
    for (let i = 0; i < NR; i++) { const o = i * 6; rainPos[o + 1] -= fall; rainPos[o + 4] -= fall; if (rainPos[o + 1] < -40) { rainPos[o + 1] += 80; rainPos[o + 4] += 80; } }
    rainGeo.attributes.position.needsUpdate = true;
  }
  // contrails (ar frio em altitude) e vapor na ponta das asas sob G alto
  for (const p of planes) {
    if (!p.alive || p.pos.distanceTo(camera.position) > 2500) continue;
    const hi = p.pos.y > (p.def.jet ? 5500 : 6500), vap = Math.abs(p.n) > 5.2 && p.ias > 110;
    if (!hi && !vap) continue;
    p.trailT = (p.trailT || 0) - dt; if (p.trailT > 0) continue; p.trailT = 0.045;
    for (const s of [1, -1]) {
      _w.set(s * p.def.span / 2 * 0.97, 0, p.def.wingZ - p.def.chord * 0.3).applyMatrix4(p.root.matrixWorld);
      spawnP({ pos: _w, vel: _t.copy(p.vel).multiplyScalar(0.02), life: hi ? 5 : 0.9, size: hi ? 0.9 : 0.5, size1: hi ? 4 : 1.4, color: 0xf4f4f2, op: hi ? 0.5 : 0.35, drag: 2 });
    }
  }
}
