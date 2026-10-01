import * as THREE from 'three';
import { S, tanks, planes } from '../core/state.js';
import { $, clamp } from '../core/util.js';
import { H, POINTS, LIMIT, groundSample } from '../world/terrain.js';
import { OBST, TREES, HEDGES } from '../world/scenery.js';
import { DEG } from '../data/vehicles.js';
import { yawOf } from '../ai/brains.js';

// ---------- Minimapa com grade ----------
const mini = $('#mini'), mctx = mini.getContext('2d');
const MMBASE = 1600, mmBase = document.createElement('canvas'); mmBase.width = mmBase.height = 640;
{
  const g = mmBase.getContext('2d'), img = g.createImageData(640, 640), s = 640 / (MMBASE * 2), c = new THREE.Color();
  for (let j = 0; j < 640; j++) for (let i = 0; i < 640; i++) {
    const x = i / s - MMBASE, z = j / s - MMBASE, h = H(x, z), sl = H(x + 4, z) - H(x, z);
    groundSample(x, z, c, null);
    const sh = 1 + sl * 0.25, o = (j * 640 + i) * 4;
    img.data[o] = clamp(Math.sqrt(c.r) * 255 * sh, 0, 255); img.data[o + 1] = clamp(Math.sqrt(c.g) * 255 * sh, 0, 255); img.data[o + 2] = clamp(Math.sqrt(c.b) * 255 * sh, 0, 255); img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#b3ab98'; for (const b of OBST) g.fillRect((b.mn[0] + MMBASE) * s, (b.mn[2] + MMBASE) * s, Math.max(1, (b.mx[0] - b.mn[0]) * s), Math.max(1, (b.mx[2] - b.mn[2]) * s));
  g.fillStyle = 'rgba(20,35,15,.7)'; for (const t of TREES) g.fillRect((t.x + MMBASE) * s - 1, (t.z + MMBASE) * s - 1, 2, 2);
  g.strokeStyle = 'rgba(15,30,10,.8)'; g.lineWidth = 1.5; for (const h of HEDGES) { g.strokeRect((h.mn[0] + MMBASE) * s, (h.mn[2] + MMBASE) * s, (h.mx[0] - h.mn[0]) * s, (h.mx[2] - h.mn[2]) * s); }
}
export function drawMini(viewer, air, cam) {
  const R = air ? 1500 : 390, W = 210, s = W / (R * 2), cx = air ? 0 : 0, cz = 0;
  const bs = 640 / (MMBASE * 2);
  mctx.drawImage(mmBase, (cx - R + MMBASE) * bs, (cz - R + MMBASE) * bs, R * 2 * bs, R * 2 * bs, 0, 0, W, W);
  const X = x => (x - cx + R) * s, Z = z => (z - cz + R) * s;
  // grade estilo carta militar
  mctx.strokeStyle = 'rgba(0,0,0,.35)'; mctx.lineWidth = 1; mctx.font = '600 10px "Barlow Condensed", sans-serif'; mctx.fillStyle = 'rgba(230,225,200,.7)';
  const cell = air ? 400 : 100; const n = Math.round(R * 2 / cell);
  for (let i = 0; i <= n; i++) {
    const p = i * W / n;
    mctx.beginPath(); mctx.moveTo(p, 0); mctx.lineTo(p, W); mctx.moveTo(0, p); mctx.lineTo(W, p); mctx.stroke();
    if (i < n) { mctx.fillText(String.fromCharCode(65 + i), p + 2, 9); mctx.fillText(String(i + 1), 2, p + 18); }
  }
  // área de combate terrestre
  if (air) { mctx.strokeStyle = 'rgba(230,90,66,.6)'; mctx.strokeRect(X(-LIMIT), Z(-LIMIT), LIMIT * 2 * s, LIMIT * 2 * s); }
  mctx.textAlign = 'center'; mctx.textBaseline = 'middle'; mctx.font = '600 12px "Barlow Condensed", sans-serif';
  for (const p of POINTS) {
    mctx.strokeStyle = p.owner === 1 ? '#6db4e3' : p.owner === -1 ? '#e65a42' : '#ddd6b7'; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(X(p.x), Z(p.z), Math.max(4, p.r * s + 2), 0, 7); mctx.stroke(); mctx.fillStyle = mctx.strokeStyle; mctx.fillText(p.id, X(p.x), Z(p.z));
  }
  mctx.textAlign = 'left'; mctx.textBaseline = 'alphabetic';
  for (const t of tanks) {
    if (t === viewer) continue;
    if (!(t.team === 1 || t.spottedUntil > S.now)) continue;
    mctx.fillStyle = !t.alive ? '#555' : t.team === 1 ? '#6db4e3' : '#e65a42';
    mctx.fillRect(X(t.pos.x) - 2.5, Z(t.pos.z) - 2.5, 5, 5);
  }
  for (const p of planes) {
    if (p === viewer || p.gone) continue;
    if (!(p.team === 1 || p.spottedUntil > S.now)) continue;
    const yaw = Math.atan2(p.vel.x, p.vel.z);
    mctx.save(); mctx.translate(X(p.pos.x), Z(p.pos.z)); mctx.rotate(-yaw + Math.PI);
    mctx.fillStyle = !p.alive ? '#555' : p.team === 1 ? '#6db4e3' : '#e65a42';
    mctx.beginPath(); mctx.moveTo(0, -6); mctx.lineTo(5, 4); mctx.lineTo(-5, 4); mctx.closePath(); mctx.fill(); mctx.restore();
  }
  if (viewer) {
    const x = X(viewer.pos.x), z = Z(viewer.pos.z);
    mctx.fillStyle = 'rgba(221,214,183,.12)'; mctx.beginPath(); mctx.moveTo(x, z);
    const a = Math.atan2(Math.cos(cam.yaw), Math.sin(cam.yaw)), fov = cam.sniper ? cam.fov * DEG : .9;
    mctx.arc(x, z, 40, a - fov / 2, a + fov / 2); mctx.fill();
    const yaw = viewer.type === 'plane' ? Math.atan2(viewer.vel.x, viewer.vel.z) : yawOf(viewer);
    mctx.save(); mctx.translate(x, z); mctx.rotate(-yaw + Math.PI);
    mctx.fillStyle = '#efa53c'; mctx.beginPath(); mctx.moveTo(0, -7); mctx.lineTo(4.5, 5); mctx.lineTo(-4.5, 5); mctx.closePath(); mctx.fill(); mctx.restore();
  }
}

