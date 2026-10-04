import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { station, chordAt, finCfg, finStation } from './planeGeom.js';
// =====================================================================
// Detalhes do modelo procedural dos jatos (só visual): bocais com cone de
// turbina e pétalas de pós-combustão, cabine (painel, mira, assento ejetável),
// tripulante de trás, luzes de navegação/anticolisão, antenas, tanques
// externos e gancho. Tudo por dados em PLANES (def.nozzle, antennas, beacons,
// drops, hook, canopy.seats). Os materiais vêm do buildPlane: nenhum shader novo
// (MeshStandard sem textura; luzes só mudam a cor emissiva, que é uniforme).
// Eixos: +z nariz, +y cima, +x asa esquerda.
// =====================================================================
const V = (x, y) => new THREE.Vector2(x, y);
// sólido de revolução em torno do eixo z (LatheGeometry gira em y; rotateX(90°) leva y → +z)
export const latheZ = (pts, seg = 28) => new THREE.LatheGeometry(pts, seg).rotateX(Math.PI / 2);

// Bocal do jato: carenagem que afina até o lábio, parede interna escura, cone da turbina lá dentro
// e, com pós-combustão (n.petals), anel de pétalas convergentes. ze = plano de saída; r = raio do lábio.
export function nozzle(add, M, par, x, y, ze, r, n = {}) {
  const len = n.len || 0.55;
  // carenagem: do raio da fuselagem (um pouco maior) para o lábio, com bordo arredondado
  add(latheZ([V(r * 0.9, ze - 0.005), V(r * 0.97, ze + 0.01), V(r, ze + 0.05), V(r * 1.04, ze + len * 0.6), V(r * 1.08, ze + len)]), n.petals ? M.dark : M.heat, par, x, y, 0);
  // parede interna (escura) até o fundo
  add(latheZ([V(r * 0.78, ze + len * 1.3), V(r * 0.86, ze + 0.06), V(r * 0.9, ze - 0.004)]), M.soot, par, x, y, 0);
  // cone de saída da turbina (aponta para trás) e fundo
  add(latheZ([V(0.001, ze + len * 0.35), V(r * 0.3, ze + len * 0.75), V(r * 0.42, ze + len * 1.05)]), M.steel, par, x, y, 0);
  add(new THREE.CircleGeometry(r * 0.8, 24).rotateY(Math.PI), M.soot, par, x, y, ze + len * 1.25);
  if (n.petals) {
    // pétalas: placas finas em anel, inclinadas para dentro, saindo do lábio
    const N = n.petals, w = 2 * Math.PI * r / N * 1.08, pl = n.petalLen || 0.45, g = [];
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2;
      g.push(new THREE.BoxGeometry(w, 0.018, pl).translate(0, 0, -pl / 2).rotateX(-0.12).translate(0, r * 1.0, 0).rotateZ(a));
    }
    for (const q of g) add(q, M.heat, par, x, y, ze + 0.06);
  }
}

// Cabine: painel de instrumentos com mostradores, capota antirreflexo (coaming), mira refletora
// e assento ejetável (encosto, apoio de cabeça, alças amarelas). Origem = cabeça do tripulante.
const rbox = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, r);
export function seat(add, M, par, opts = {}) {
  const S = M.seat || M.dark, Cu = M.cushion || M.dark;
  add(rbox(0.44, 0.74, 0.09, 0.03), S, par, 0, -0.38, -0.24);                                        // encosto
  add(rbox(0.36, 0.5, 0.05, 0.02), Cu, par, 0, -0.42, -0.18);                                        // almofada das costas
  add(rbox(0.34, 0.27, 0.17, 0.04), S, par, 0, 0.0, -0.24);                                          // caixa do paraquedas / apoio de cabeça
  add(rbox(0.24, 0.17, 0.04, 0.02), Cu, par, 0, 0.0, -0.14);                                         // almofada da cabeça
  add(rbox(0.44, 0.08, 0.44, 0.02), S, par, 0, -0.72, -0.02);                                        // assento
  for (const s of [1, -1]) {
    add(new THREE.BoxGeometry(0.03, 0.82, 0.05), M.steel, par, s * 0.2, -0.36, -0.29);              // trilhos do canhão ejetor
    add(rbox(0.05, 0.3, 0.32, 0.015), S, par, s * 0.23, -0.62, -0.06);                             // laterais do assento
    add(new THREE.BoxGeometry(0.045, 0.045, 0.16), M.yellow, par, s * 0.24, -0.47, 0.06);           // alças laterais
  }
  // alça de face (Martin-Baker/KM-1) no topo; F-86: só as laterais
  if (opts.face !== false) add(new THREE.TorusGeometry(0.06, 0.011, 6, 12, Math.PI), M.yellow, par, 0, 0.14, -0.15);
  add(new THREE.BoxGeometry(0.08, 0.05, 0.05), M.yellow, par, 0, -0.68, 0.2);                         // alça entre as pernas
}
// painel: face com mostradores e, por cima, a capota antirreflexo curva (não uma placa) na largura w do para-brisa
export function panel(add, M, par, z, y, w) {
  const p = add(rbox(w, 0.3, 0.06, 0.02), M.dark, par, 0, y - 0.44, z);
  const hood = add(new THREE.CylinderGeometry(w * 0.5, w * 0.5, 0.3, 18, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), M.dark, par, 0, y - 0.29, z + 0.1);
  hood.scale.y = 0.32;
  // mostradores (aro + vidro) voltados para o tripulante (−z)
  for (let i = 0; i < 7; i++) {
    const x = ((i % 4) - 1.5) * w * 0.22, yy = y - 0.36 - Math.floor(i / 4) * 0.11;
    add(new THREE.CylinderGeometry(0.036, 0.036, 0.012, 14).rotateX(Math.PI / 2), M.steel, par, x, yy, z - 0.032);
    add(new THREE.CircleGeometry(0.03, 14).rotateY(Math.PI), M.dial, par, x, yy, z - 0.04);
  }
  return p;
}
export function gunsight(add, M, par, z, y) {
  add(new THREE.BoxGeometry(0.08, 0.07, 0.12), M.dark, par, 0, y - 0.23, z);
  const g = add(new THREE.PlaneGeometry(0.1, 0.09), M.glass, par, 0, y - 0.15, z + 0.02); g.rotation.x = -0.6;
}

// Luzes: navegação (vermelha à esquerda = +x, verde à direita), branca na deriva, anticolisão vermelha
export function navLight(add, M, par, p, side) { const o = add(new THREE.SphereGeometry(0.06, 10, 6), side > 0 ? M.red : M.green, par, p[0] + side * 0.02, p[1], p[2]); o.scale.set(0.8, 0.8, 1.6); }
export function tailLight(add, M, tail, D) { const p = finStation(finCfg(D), 0.98, 1); add(new THREE.SphereGeometry(0.05, 8, 6), M.white, tail, p[0], p[1] - 0.05, p[2] - 0.04); }
export function beacons(add, M, root, D, at) {
  for (const [zf, ay] of D.beacons || []) {
    const a = at(zf), b = add(new THREE.SphereGeometry(0.09, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.red, root, 0, ay > 0 ? a.top - 0.02 : a.yc - a.h + 0.02, zf * D.L);
    if (ay < 0) b.rotation.x = Math.PI;
  }
}

// Antenas (def.antennas): blade (lâmina enflechada), whip (haste inclinada), mast (mastro com fio até a deriva),
// rods (3 hastes do IFF "Odd Rods"). ay = 1 dorso, −1 ventre; h = altura; len = corda.
export function antennas(add, M, root, tail, D, at) {
  for (const A of D.antennas || []) {
    const a = at(A.zf), z = A.zf * D.L, dn = A.ay < 0, y = dn ? a.yc - a.h + 0.03 : a.top - 0.03, sg = dn ? -1 : 1, h = A.h || 0.3, x = A.x || 0;
    if (A.k === 'blade') {
      const c = A.len || 0.4, sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(-c, 0); sh.lineTo(-c * 0.95 - h * 0.5, h); sh.lineTo(-c * 0.45 - h * 0.5, h); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.025, bevelEnabled: false }).translate(c / 2, 0, -0.0125).rotateY(-Math.PI / 2);
      if (dn) g.scale(1, -1, 1).computeVertexNormals();
      add(g, M.skin, root, x, y, z);
    } else if (A.k === 'whip' || A.k === 'mast') {
      const rake = A.rake ?? 0.35, m = add(new THREE.CylinderGeometry(0.008, A.k === 'mast' ? 0.03 : 0.015, h, 6).translate(0, h / 2, 0), A.k === 'mast' ? M.skin : M.dark, root, x, y, z);
      m.rotation.x = -sg * rake; if (dn) m.rotation.z = Math.PI;
      if (A.wire) {
        // fio do topo do mastro até a deriva
        const P = new THREE.Vector3(x, y + Math.cos(rake) * h, z - Math.sin(rake) * h), Q = new THREE.Vector3(...finStation(finCfg(D), A.wire, 0.25));
        const d = Q.clone().sub(P), w = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, d.length(), 4), M.dark);
        w.position.copy(P).addScaledVector(d, 0.5); w.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); tail.add(w); w.updateMatrix();
      }
    } else if (A.k === 'rods') {
      for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.009, 0.012, h * (1 - i * 0.12), 5).translate(0, sg * h * (1 - i * 0.12) / 2, 0), M.dark, root, x, y, z - i * 0.12);
    }
  }
}

// Tanque externo alijável: corpo em charuto com pontas em ogiva, aletas opcionais e pilone.
// def.drops = [{ ws (fração da semienvergadura) | belly: zf, len, d, fins, dz }]
function dropTank(T) {
  const r = T.d / 2, L = T.len, pts = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16, z = -L / 2 + t * L, k = t < 0.3 ? Math.sin(t / 0.3 * Math.PI / 2) ** 0.75 : t > 0.72 ? Math.cos((t - 0.72) / 0.28 * Math.PI / 2) ** 0.6 : 1; pts.push(V(Math.max(r * k, 0.004), z)); }
  pts[0].x = 0.001; pts[16].x = 0.001;
  const parts = [new THREE.LatheGeometry(pts, 20).rotateX(Math.PI / 2)];
  for (let i = 0; i < (T.fins || 0); i++) {
    const s = new THREE.Shape(); s.moveTo(r * 0.5, -L / 2 + 0.05); s.lineTo(r * 1.6, -L / 2 + 0.02); s.lineTo(r * 1.6, -L / 2 + 0.22); s.lineTo(r * 0.5, -L / 2 + 0.55); s.closePath();
    parts.push(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false }).translate(0, 0, -0.006).rotateX(Math.PI / 2).rotateZ(Math.PI / 2 + i / T.fins * Math.PI * 2 + (T.fins === 3 ? Math.PI : Math.PI / 4)));
  }
  return parts;
}
export function drops(add, M, root, D, at, wingCfg, wingL, wingR, sB) {
  for (const T of D.drops || []) {
    const r = T.d / 2;
    for (const side of T.belly != null ? [0] : [1, -1]) {
      let par = root, x = 0, y, z, top, pz, pl;
      if (T.belly != null) { const a = at(T.belly); z = T.belly * D.L; top = a.yc - a.h; y = top - r - 0.12; pz = z; pl = T.len * 0.4; }
      else {
        const o = wingCfg(side), c = chordAt(o, T.ws), p0 = station(o, T.ws, 0.4), tw = (o.t0 + (o.t1 - o.t0) * T.ws) * c * 0.5;
        par = T.ws > sB ? (side > 0 ? wingL : wingR).userData.tip : side > 0 ? wingL : wingR;
        x = p0[0]; top = p0[1] - tw; y = top - r - (T.ph ?? 0.14); z = p0[2] + (T.dz || 0); pz = p0[2]; pl = Math.min(c * 0.55, T.len * 0.45);
      }
      for (const g of dropTank(T)) add(g, M.tank, par, x, y, z);
      add(new THREE.BoxGeometry(0.07, top - y - r + 0.06, pl), M.skin, par, x, (top + y + r) / 2, pz);       // pilone
    }
  }
}
// gancho de parada (F-4): haste sob o cone de cauda, ponta amarela
export function hook(add, M, root, D, at) {
  if (!D.hook) return;
  const a = at(-0.4), z = -0.4 * D.L, y = a.yc - a.h, len = 1.6;
  const h = add(new THREE.CylinderGeometry(0.04, 0.05, len, 8).translate(0, -len / 2, 0), M.dark, root, 0, y + 0.02, z); h.rotation.x = Math.PI / 2 - 0.1;
  add(new THREE.BoxGeometry(0.12, 0.06, 0.14), M.yellow, h, 0, -len, 0);
}
