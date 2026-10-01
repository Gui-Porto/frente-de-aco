import * as THREE from 'three';

export const V3 = THREE.Vector3;
export const QUAT = THREE.Quaternion;
export const UP = new V3(0, 1, 0);
export const $ = s => document.querySelector(s);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const rv = s => new V3(rand(-s, s), rand(-s, s), rand(-s, s));
export const lin = hex => new THREE.Color(hex);
export const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export function angDiff(a, b) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
export function hash2(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
let seed = 7;
export const srand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
