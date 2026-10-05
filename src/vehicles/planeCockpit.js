import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
// =====================================================================
// Cabine (só visual). A fuselagem vem aberta sob a capota (fuselage(D, hole)
// em planeModel.js); aqui fica o que se vê pelo vidro: banheira com forro
// seguindo a chapa por dentro, piso, anteparas, painel de instrumentos
// (mostradores pintados num atlas por estilo + aros em relevo), capota
// antirreflexo, consoles laterais com interruptores, manete, manche, pedais,
// assento (ejetável no jato, concha com blindagem no pistão), mira refletora
// ou visor de mira (LCOSS do F-4E, ASP do MiG) e o radarscópio do F-4 de trás.
// Estilo por dados: def.cockpit = { style, sight } (padrão pela nação/era).
// Eixos: +z nariz, +y cima, +x asa esquerda (lado esquerdo do piloto).
// =====================================================================
const rbox = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 2, r);
const STYLES = {
  // bg = cor do painel; face = mostrador; ring = aro; wall = interior; scope = radarscópio no centro
  raf: { bg: '#141414', face: '#0d0d0d', ink: '#e9e4d0', ring: '#2a2a2a', six: true, wall: 0x4b5243, sight: 'gyro' },
  usaaf: { bg: '#1a1a1a', face: '#0e0e0e', ink: '#ece8da', ring: '#2c2c2c', six: true, wall: 0x5a5f3c, sight: 'refl' },
  luft: { bg: '#2c2f30', face: '#121212', ink: '#efece2', ring: '#3a3d3e', six: false, wall: 0x3c3f3e, sight: 'revi' },
  vvs: { bg: '#2b2b2b', face: '#121212', ink: '#e6e2d4', ring: '#3a3a3a', six: false, wall: 0x6b8f80, sight: 'refl' },
  jet: { bg: '#1c1d1e', face: '#0c0c0c', ink: '#f0eee6', ring: '#3a3b3d', six: true, wall: 0x4a4e48, sight: 'a4', consoles: true },
  mig: { bg: '#3d4f50', face: '#101010', ink: '#f0eee6', ring: '#26302f', six: true, wall: 0x5f8f86, sight: 'asp', consoles: true },
  f4: { bg: '#3c4042', face: '#0e0e0e', ink: '#f2f0e8', ring: '#26292a', six: true, wall: 0x50565a, sight: 'lcoss', consoles: true, adi: true },
  f4r: { bg: '#3c4042', face: '#0e0e0e', ink: '#f2f0e8', ring: '#26292a', six: false, wall: 0x50565a, sight: null, consoles: true, scope: true },
};
export function cockpitStyle(D) {
  if (D.cockpit && D.cockpit.style) return D.cockpit.style;
  if (D.key === 'f4e') return 'f4';
  if (D.jet) return D.nation === 'URSS' ? 'mig' : 'jet';
  return D.nation === 'Reino Unido' ? 'raf' : D.nation === 'Alemanha' ? 'luft' : D.nation === 'URSS' ? 'vvs' : 'usaaf';
}

// ---------- atlas do painel (1024×1024): metade de cima = painel, embaixo = console esq. e dir. ----------
// devolve também a lista de mostradores (centro e raio em frações do painel) para os aros em relevo
const atlasCache = new Map();
function atlas(style) {
  if (atlasCache.has(style)) return atlasCache.get(style);
  const S = STYLES[style], N = 1024, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), gauges = [];
  // fundo do painel com textura fosca, parafusos nos cantos e linhas de chapa
  g.fillStyle = S.bg; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${Math.random() * .05})`; g.fillRect(Math.random() * N, Math.random() * N, 2, 2); }
  const screw = (x, y) => { g.fillStyle = '#777'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.strokeStyle = '#333'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 4, y); g.lineTo(x + 4, y); g.stroke(); };
  const text = (s, x, y, sz, col = S.ink, al = 'center') => { g.fillStyle = col; g.font = `bold ${sz}px "Arial Narrow", Arial, sans-serif`; g.textAlign = al; g.textBaseline = 'middle'; g.fillText(s, x, y); };
  // mostrador redondo: escala, números, ponteiro; kind muda o desenho
  const dial = (x, y, r, kind = 'gen', lab = '') => {
    gauges.push([x / N, y / (N / 2), r / (N / 2)]);
    g.fillStyle = S.ring; g.beginPath(); g.arc(x, y, r * 1.12, 0, 7); g.fill();
    g.fillStyle = S.face; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    if (kind === 'adi') { // horizonte artificial: céu e terra, linha do horizonte, avião de referência
      g.save(); g.beginPath(); g.arc(x, y, r * 0.96, 0, 7); g.clip();
      g.fillStyle = '#3d6f9e'; g.fillRect(x - r, y - r, 2 * r, r * 1.05); g.fillStyle = '#5a3d22'; g.fillRect(x - r, y + r * 0.05, 2 * r, r);
      g.strokeStyle = '#f2f0e8'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - r, y + r * 0.05); g.lineTo(x + r, y + r * 0.05); g.stroke();
      for (let k = -2; k <= 2; k++) if (k) { g.beginPath(); g.moveTo(x - r * 0.25, y + r * 0.05 - k * r * 0.2); g.lineTo(x + r * 0.25, y + r * 0.05 - k * r * 0.2); g.stroke(); }
      g.restore(); g.strokeStyle = '#ffb020'; g.lineWidth = 5; g.beginPath(); g.moveTo(x - r * 0.55, y); g.lineTo(x - r * 0.15, y); g.lineTo(x, y + r * 0.12); g.lineTo(x + r * 0.15, y); g.lineTo(x + r * 0.55, y); g.stroke();
      return;
    }
    g.strokeStyle = S.ink; g.fillStyle = S.ink;
    const a0 = kind === 'alt' ? -Math.PI / 2 : Math.PI * 0.75, span = kind === 'alt' ? Math.PI * 2 : Math.PI * 1.5, n = kind === 'alt' ? 50 : 30;
    for (let i = 0; i <= n; i++) {
      const a = a0 + span * i / n, big = i % 5 === 0, r0 = r * (big ? 0.76 : 0.85);
      g.lineWidth = big ? 3 : 1.4; g.beginPath(); g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); g.lineTo(x + Math.cos(a) * r * 0.93, y + Math.sin(a) * r * 0.93); g.stroke();
      if (big && i < n && r > 34) text(String(kind === 'alt' ? i / 5 : i / 5 * 2), x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.2);
    }
    if (kind === 'gen' && Math.random() < 0.5) { g.strokeStyle = '#c0392b'; g.lineWidth = 4; g.beginPath(); g.arc(x, y, r * 0.88, a0 + span * 0.85, a0 + span); g.stroke(); }
    if (lab) text(lab, x, y + r * 0.42, Math.max(10, r * 0.16));
    // ponteiro(s) em posição aleatória plausível
    const ang = a0 + span * (0.2 + Math.random() * 0.5);
    g.strokeStyle = '#f2f0e8'; g.lineWidth = Math.max(3, r * 0.06); g.lineCap = 'round';
    g.beginPath(); g.moveTo(x - Math.cos(ang) * r * 0.15, y - Math.sin(ang) * r * 0.15); g.lineTo(x + Math.cos(ang) * r * 0.78, y + Math.sin(ang) * r * 0.78); g.stroke();
    if (kind === 'alt') { const b = ang * 0.37; g.lineWidth = r * 0.1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * r * 0.48, y + Math.sin(b) * r * 0.48); g.stroke(); }
    g.fillStyle = '#222'; g.beginPath(); g.arc(x, y, r * 0.08, 0, 7); g.fill();
  };
  const lamp = (x, y, col) => { g.fillStyle = '#111'; g.fillRect(x - 13, y - 13, 26, 26); g.fillStyle = col; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); };
  const sw = (x, y) => { g.fillStyle = '#888'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); g.fillStyle = '#ddd'; g.fillRect(x - 2.5, y - 16, 5, 14); };
  const H = N / 2;
  for (const [x, y] of [[14, 14], [N - 14, 14], [14, H - 14], [N - 14, H - 14]]) screw(x, y);
  if (S.scope) {
    // radarscópio central (APQ-120, assento de trás): tela verde com varredura em B
    g.fillStyle = '#0b0c0c'; g.fillRect(N / 2 - 170, 40, 340, 330); g.fillStyle = '#0d2a14'; g.fillRect(N / 2 - 145, 62, 290, 270);
    g.strokeStyle = 'rgba(90,255,120,.55)'; g.lineWidth = 1.5; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(N / 2 - 145, 62 + i * 67); g.lineTo(N / 2 + 145, 62 + i * 67); g.stroke(); g.beginPath(); g.moveTo(N / 2 - 145 + i * 72, 62); g.lineTo(N / 2 - 145 + i * 72, 332); g.stroke(); }
    g.fillStyle = 'rgba(120,255,140,.9)'; g.fillRect(N / 2 + 20, 140, 14, 6); g.fillRect(N / 2 - 60, 220, 12, 5);
    for (let i = 0; i < 8; i++) sw(N / 2 - 140 + i * 40, 400);
    dial(150, 130, 70, 'gen', 'ALT'); dial(150, 330, 70, 'gen', 'KNOTS'); dial(N - 150, 130, 70, 'adi'); dial(N - 150, 330, 70, 'gen', 'RANGE');
    for (let i = 0; i < 4; i++) dial(70 + i * 60, 455, 26);
    for (let i = 0; i < 4; i++) dial(N - 250 + i * 60, 455, 26);
  } else if (S.six) {
    // "seis básicos" no meio (velocímetro, horizonte, altímetro / climb, direcional, curva e derrapagem)
    const cx = N / 2, r = 74;
    dial(cx - 175, 125, r, 'gen', 'AIRSPEED'); dial(cx, 125, r, 'adi'); dial(cx + 175, 125, r, 'alt', 'ALT');
    dial(cx - 175, 300, r, 'gen', 'CLIMB'); dial(cx, 300, r, 'gen', 'HDG'); dial(cx + 175, 300, r, 'gen', 'TURN');
    // motor e sistemas nas laterais
    for (let i = 0; i < 3; i++) { dial(85, 90 + i * 140, 52, 'gen', ['RPM', 'BOOST', 'OIL'][i]); dial(N - 85, 90 + i * 140, 52, 'gen', ['FUEL', 'TEMP', 'PRESS'][i]); }
    dial(cx - 330, 420, 38); dial(cx + 330, 420, 38);
    if (S.adi) { lamp(cx - 60, 430, '#d33'); lamp(cx - 20, 430, '#e9b020'); lamp(cx + 20, 430, '#3c3'); lamp(cx + 60, 430, '#d33'); }
    else { for (let i = 0; i < 5; i++) sw(cx - 120 + i * 60, 440); }
  } else {
    // painel alemão/soviético dos anos 40: duas fileiras desencontradas
    const row1 = [[150, 120, 66, 'gen', 'km/h'], [330, 115, 70, 'adi'], [510, 120, 66, 'alt', 'm'], [690, 115, 62, 'gen'], [870, 120, 60, 'gen']];
    const row2 = [[110, 310, 52, 'gen'], [250, 320, 58, 'gen'], [400, 310, 54, 'gen'], [560, 320, 58, 'gen'], [720, 310, 52, 'gen'], [880, 320, 56, 'gen']];
    for (const d of [...row1, ...row2]) dial(...d);
    for (let i = 0; i < 6; i++) sw(200 + i * 110, 450);
  }
  // consoles: interruptores, botões, placas de identificação e a escala da manete (esq.)
  const consolePanel = (x0, w, left) => {
    g.fillStyle = S.bg; g.fillRect(x0, H, w, H);
    for (let r = 0; r < 6; r++) {
      const y = H + 40 + r * 78; g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x0 + 16, y - 26, w - 32, 66);
      for (let i = 0; i < 4; i++) {
        const x = x0 + 50 + i * (w - 100) / 3;
        if ((r + i + (left ? 0 : 1)) % 3 === 0) { g.fillStyle = '#0c0c0c'; g.beginPath(); g.arc(x, y + 6, 18, 0, 7); g.fill(); g.fillStyle = '#9a9a9a'; g.beginPath(); g.arc(x, y + 6, 7, 0, 7); g.fill(); }
        else sw(x, y + 10);
        text(['RADIO', 'IFF', 'ARM', 'LIGHTS', 'PITOT', 'FUEL'][(r + i) % 6], x, y - 16, 12);
      }
    }
    for (let k = 0; k < 4; k++) screw(x0 + (k % 2 ? w - 14 : 14), H + (k < 2 ? 14 : H - 14));
  };
  consolePanel(0, N / 2, true); consolePanel(N / 2, N / 2, false);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const r = { tex, gauges }; atlasCache.set(style, r); return r;
}
// retângulo com UV num pedaço do atlas: u0..u1, v0..v1 (v = 1 no topo da imagem)
function uvPlane(w, h, u0, u1, v0, v1) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
  return g;
}

// ponto da seção (superelipse) no ângulo th, encolhido k em torno do centro
const secPt = (s, th, k) => { const c = Math.cos(th), sn = Math.sin(th); return [Math.sign(c) * Math.abs(c) ** s.ex * s.hw * k, s.yc + (sn >= 0 ? s.tp : s.bt) * Math.sign(sn) * Math.abs(sn) ** s.ex * k]; };
// ângulo (lado +x, entre −π/2 e π/2) em que a seção encolhida k passa pela altura y
function thAtY(s, y, k) { const hh = (y >= s.yc ? s.tp : s.bt) * k, v = Math.max(-1, Math.min(1, (y - s.yc) / hh)); return Math.sign(v) * Math.asin(Math.abs(v) ** (1 / s.ex)); }
// largura interna (meia) da seção na altura y
const innerX = (s, y, k = 0.95) => secPt(s, thAtY(s, y, k), k)[0];

// ctx: { add, root, D, M, sec(z), hole: { z0, z1, hw(z) }, crew: [{ y, z }] (cabeças), jet, cy (base da capota), canopyH(z) (altura dela no eixo) }
export function buildCockpit(ctx) {
  const { add, root, D, M, sec, hole, crew, jet } = ctx;
  const style0 = cockpitStyle(D), S0 = STYLES[style0], K = 0.95;
  const wall = new THREE.MeshStandardMaterial({ color: S0.wall, roughness: .82, metalness: .15 });
  const floorM = new THREE.MeshStandardMaterial({ color: new THREE.Color(S0.wall).multiplyScalar(0.55), roughness: .9, metalness: .1 });
  const black = M.dark, steel = M.steel;
  // piso: um pouco abaixo dos calcanhares do tripulante mais baixo, sem sair da seção
  const floorAt = z => { const s = sec(z); let y = Math.min(...crew.map(c => c.y)) - 1.12; return Math.max(y, s.yc - s.bt * K * 0.92); };
  // ---- banheira: forro das paredes (da borda da abertura até o piso) + piso, em fatias ao longo de z ----
  const NZ = 18, NS = 9, pos = [], idx = [];
  const strip = z => {
    const s = sec(z), he = Math.min(hole.hw(z), innerX(s, s.yc + s.tp * 0.6)), yf = floorAt(z), out = [];
    const thE = Math.acos(Math.min(1, (he / (s.hw * K)) ** (1 / s.ex))), thF = thAtY(s, yf, K);
    for (const sd of [1, -1]) {
      const side = [];
      for (let i = 0; i <= NS; i++) { const th = thE + (thF - thE) * i / NS, p = secPt(s, th, K); side.push([sd * p[0], p[1]]); }
      if (sd > 0) out.push(...side); else out.push(...side.reverse());
    }
    // piso entre os dois pés da parede (de +x para −x, entre os dois lados)
    const xf = out[NS][0], fl = []; for (let i = 1; i < 4; i++) fl.push([xf * (1 - 2 * i / 4), yf]);
    out.splice(NS + 1, 0, ...fl);
    return out;
  };
  let per = 0;
  for (let j = 0; j <= NZ; j++) { const z = hole.z0 + (hole.z1 - hole.z0) * j / NZ, st = strip(z); per = st.length; for (const [x, y] of st) pos.push(x, y, z); }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < per - 1; i++) { const a = j * per + i, b = a + 1, c = a + per, d = c + 1; idx.push(a, c, b, b, c, d); }
  const tub = new THREE.BufferGeometry(); tub.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tub.setIndex(idx);
  tub.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2)); tub.computeVertexNormals();
  // a face tem de olhar para dentro (para o eixo): confere no meio do piso e inverte se preciso
  if (tub.attributes.normal.getY(Math.floor(NZ / 2) * per + NS + 2) < 0) { const ix = tub.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } tub.computeVertexNormals(); }
  add(tub, wall, root);
  // anteparas na frente e atrás: o contorno da fatia fechado na linha da borda
  for (const [z, face] of [[hole.z0 + 0.004, 1], [hole.z1 - 0.004, -1]]) {
    const st = strip(z), cx = 0, cy = st.reduce((a, p) => a + p[1], 0) / st.length, P = [cx, cy, z];
    for (const [x, y] of st) P.push(x, y, z);
    const I = []; const n = st.length;
    for (let i = 0; i < n; i++) { const a = 1 + i, b = 1 + ((i + 1) % n); I.push(...(face > 0 ? [0, b, a] : [0, a, b])); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(P.length / 3 * 2).fill(0), 2)); g.computeVertexNormals();
    if (g.attributes.normal.getZ(0) * face < 0) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } g.computeVertexNormals(); }
    add(g, wall, root);
  }
  // nervuras (cavernas) no forro, de cada lado: dão a estrutura por dentro
  for (let j = 1; j < 5; j++) {
    const z = hole.z0 + (hole.z1 - hole.z0) * j / 5, s = sec(z), yf = floorAt(z), y0 = yf + 0.08, y1 = s.yc + s.tp * 0.55;
    for (const sd of [1, -1]) {
      const pts = []; for (let i = 0; i <= 6; i++) { const y = y0 + (y1 - y0) * i / 6; pts.push(new THREE.Vector3(sd * (innerX(s, y, 0.93) - 0.005), y, z)); }
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.012, 4), floorM, root);
    }
  }
  // piso com chapa de pisar (antiderrapante escuro) sob os pés
  crew.forEach((c, i) => {
    const st = STYLES[i === 0 ? style0 : style0 === 'f4' ? 'f4r' : style0], A = atlas(i === 0 ? style0 : style0 === 'f4' ? 'f4r' : style0);
    const pm = new THREE.MeshStandardMaterial({ map: A.tex, roughness: .6, metalness: .25 });
    // painel: o topo passa acima da chapa (fica sob o para-brisa, como nos reais); a largura segue o forro por dentro
    // e, acima da chapa, a borda da abertura. Contorno em polígono, com o atlas na proporção certa (sem esticar)
    const zP = c.z + 0.78, sP = sec(zP), yBot = c.y - 0.66, yTop = Math.min(c.y - 0.2, ctx.cy + ctx.canopyH(zP) * 0.55), tilt = 0.16;
    const ySec = sP.yc + sP.tp * 0.93 * 0.985, hwP = y => Math.max(innerX(sP, Math.min(y, ySec), 0.93), hole.hw(zP) * 0.97) - 0.008;
    const ph = yTop - yBot, yc0 = (yTop + yBot) / 2, sh0 = new THREE.Shape(), NSd = 8;
    for (let k = 0; k <= NSd; k++) { const y = yBot + ph * k / NSd; (k ? sh0.lineTo.bind(sh0) : sh0.moveTo.bind(sh0))(hwP(y), y - yc0); }
    for (let k = NSd; k >= 0; k--) { const y = yBot + ph * k / NSd; sh0.lineTo(-hwP(y), y - yc0); }
    const face = new THREE.ShapeGeometry(sh0), fuv = face.attributes.uv, fp = face.attributes.position;
    // u: 1 unidade de textura = 2·ph metros (o pedaço do painel no atlas é 2:1); v: metade de cima do atlas
    for (let k = 0; k < fp.count; k++) fuv.setXY(k, 0.5 - fp.getX(k) / (2 * ph), 0.75 + fp.getY(k) / (2 * ph));
    face.rotateY(Math.PI);
    const panel = new THREE.Group(); panel.position.set(0, yc0, zP); panel.rotation.x = -tilt; root.add(panel);
    add(face, pm, panel, 0, 0, -0.006);
    add(new THREE.ExtrudeGeometry(sh0, { depth: 0.05, bevelEnabled: false }).rotateY(Math.PI).translate(0, 0, 0.05), black, panel, 0, 0, 0);
    const rims = [], inside = (x, y) => Math.abs(x) < hwP(y + yc0) - 0.01 && y + yc0 > yBot + 0.01 && y + yc0 < yTop - 0.01;
    for (const [u, v, r] of A.gauges) {
      const rr = r * ph * 0.5 * 1.08, x = -(u - 0.5) * 2 * ph, y = (0.5 - v) * ph; // −x: a face foi girada para o piloto
      if (rr < 0.01 || !inside(-x - rr, y) || !inside(-x + rr, y)) continue;
      rims.push(new THREE.TorusGeometry(rr, Math.max(0.0035, rr * 0.09), 5, 18).translate(x, y, -0.012));
      rims.push(new THREE.CircleGeometry(rr * 0.98, 18).rotateY(Math.PI).translate(x, y, -0.016)); // vidro
    }
    for (const g of rims) add(g, g.type === 'CircleGeometry' ? M.glass : steel, panel);
    // capota antirreflexo: casca arqueada do topo do painel para a frente, até onde o para-brisa deixa (não fura o vidro)
    // cada vértice fica 2 cm para dentro do vidro naquela estação (o para-brisa afina para a frente: antes a chapa
    // reta passava pelos lados e pela frente da capota)
    let zE = zP; while (zE < zP + 0.5 && ctx.canopyW(zE + 0.02, yTop + 0.02) > 0.12) zE += 0.02;
    const gl = Math.max(0.12, zE - zP + 0.04), gw = hwP(yTop) * 2 + 0.03, by = yTop - 0.04, bz = zP + gl / 2 - 0.05;
    const brow = new THREE.BoxGeometry(gw, 0.025, gl, 12, 1, 6), bp = brow.attributes.position;
    for (let k = 0; k < bp.count; k++) {
      const u = bp.getX(k) / (gw / 2), y = bp.getY(k) + 0.05 * (1 - u * u), z = bp.getZ(k) + bz, xm = Math.max(0.02, ctx.canopyW(z, y + by) - 0.02);
      bp.setY(k, y); if (z > zP && Math.abs(bp.getX(k)) > xm) bp.setX(k, Math.sign(bp.getX(k)) * xm);
    }
    brow.computeVertexNormals();
    add(brow, black, root, 0, by, bz);
    const pad = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, k) => { const u = k / 4 - 1; return new THREE.Vector3(u * gw / 2, 0.05 * (1 - u * u), 0); })), 16, 0.016, 6);
    add(pad, M.cushion, root, 0, yTop - 0.04, zP - 0.05); // borda acolchoada voltada para o piloto
    // pedestal central sob o painel (jato)
    if (jet) { const h = Math.max(0.08, yBot - floorAt(zP) - 0.14); add(rbox(0.16, h, 0.2, 0.02), black, root, 0, floorAt(zP) + h / 2, zP - 0.06); }
    const yf = floorAt(c.z), sz = c.z + 0.42;
    add(new THREE.ConeGeometry(0.075, 0.12, 12), M.cushion, root, 0, yf + 0.06, sz);                              // coifa de couro
    const stick = new THREE.Group(); stick.position.set(0, yf + 0.06, sz); stick.rotation.x = -0.12; root.add(stick);
    const sh = c.y - 0.56 - (yf + 0.06);
    add(new THREE.CylinderGeometry(0.014, 0.018, sh, 8).translate(0, sh / 2, 0), steel, stick);
    if (jet) { add(rbox(0.05, 0.13, 0.055, 0.02), black, stick, 0, sh + 0.05, 0); add(new THREE.BoxGeometry(0.012, 0.03, 0.03), steel, stick, 0, sh + 0.02, 0.035); add(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 6), M.red, stick, 0, sh + 0.12, 0.012); }
    else if (D.nation === 'Reino Unido') { const r = add(new THREE.TorusGeometry(0.075, 0.012, 6, 20), black, stick, 0, sh + 0.065, 0); add(new THREE.CylinderGeometry(0.01, 0.01, 0.02, 6), steel, stick, 0.04, sh + 0.09, 0.012); r.rotation.y = 0; } // punho em anel do Spitfire
    else { add(rbox(0.045, 0.12, 0.05, 0.02), black, stick, 0, sh + 0.05, 0); add(new THREE.BoxGeometry(0.03, 0.012, 0.03), steel, stick, 0, sh + 0.11, 0.02); }
    // pedais: braços, barra e chapas com a correia
    for (const sx of [1, -1]) {
      const pz = c.z + 0.86, py = yf + 0.13;
      add(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 6).translate(0, 0.1, 0), steel, root, sx * 0.13, yf, pz + 0.04);
      const ped = add(rbox(0.09, 0.16, 0.02, 0.006), black, root, sx * 0.13, py, pz); ped.rotation.x = -0.45;
      add(new THREE.BoxGeometry(0.095, 0.015, 0.025), steel, root, sx * 0.13, py + 0.05, pz - 0.02);
    }
    // consoles laterais (do assento até o painel) com tampo pintado; pistão: só a do lado esquerdo e mais baixa
    const zc0 = c.z - 0.25, zc1 = c.z + 0.7, zcm = (zc0 + zc1) / 2, sC = sec(zcm), yc = jet ? c.y - 0.72 : c.y - 0.78;
    for (const sd of S0.consoles ? [1, -1] : [1]) {
      const xw = innerX(sC, yc, 0.93), w = jet ? 0.16 : 0.1, x = sd * (xw - w / 2 - 0.005), h = Math.max(0.08, yc - floorAt(zcm));
      add(new THREE.BoxGeometry(w, h, zc1 - zc0), black, root, x, yc - h / 2, zcm);
      const top = add(uvPlane(zc1 - zc0, w, sd > 0 ? 0 : 0.5, sd > 0 ? 0.5 : 1, 0, 0.5).rotateX(-Math.PI / 2).rotateY(sd > 0 ? -Math.PI / 2 : Math.PI / 2), pm, root, x, yc + 0.003, zcm);
      top.userData.cockpit = true;
    }
    // manete no console esquerdo (+x): trilho, alavanca e manopla
    {
      const sT = sec(c.z + 0.1), yT = (jet ? c.y - 0.72 : c.y - 0.62), xT = innerX(sT, yT, 0.93) - (jet ? 0.08 : 0.06);
      add(new THREE.BoxGeometry(0.04, 0.03, 0.3), steel, root, xT, yT + 0.015, c.z + 0.1);
      const lever = new THREE.Group(); lever.position.set(xT, yT + 0.02, c.z + 0.12); lever.rotation.x = 0.35; root.add(lever);
      add(new THREE.BoxGeometry(0.018, 0.16, 0.025).translate(0, 0.08, 0), steel, lever);
      add(jet ? rbox(0.06, 0.07, 0.08, 0.02) : new THREE.SphereGeometry(0.03, 10, 8), black, lever, jet ? -0.015 : 0, 0.18, 0);
      c.throttle = [xT - (jet ? 0.015 : 0), yT + 0.02 + Math.cos(0.35) * 0.18, c.z + 0.12 + Math.sin(0.35) * 0.18];
    }
    c.stick = [0, yf + 0.06 + Math.cos(0.12) * (sh + 0.05), sz - Math.sin(0.12) * (sh + 0.05)];
    // assento
    const seat = new THREE.Group(); seat.position.set(0, c.y, c.z); root.add(seat);
    if (jet) ejectSeat(add, M, seat, { face: ctx.face !== false, sov: D.nation === 'URSS' });
    else pistonSeat(add, M, seat, D);
    // mira (só o piloto) e caixa de armamento
    if (i === 0) sight(add, M, root, D.cockpit?.sight || st.sight, 0, yTop + 0.02, zP + 0.06);
  });
}

// assento ejetável (origem = cabeça do piloto): estrutura com trilhos, encosto e paraquedas atrás, caixa da cabeça
// com o contêiner do paraquedas-piloto em cima e as "orelhas" (Martin-Baker), alça de face listrada (puxada por cima)
// ou punhos laterais (KM-1 soviético), concha lateral, caixa de sobrevivência sob a almofada e o punho entre as pernas
function ejectSeat(add, M, par, o) {
  const S = M.seat, Cu = M.cushion, St = M.steel, Y = M.yellow, K = M.dark;
  const tube = (pts, r, m) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 12, r, 6), m, par);
  // estrutura: dois trilhos com roletes e travessas; canhão ejetor no meio, atrás
  for (const s of [1, -1]) {
    add(rbox(0.04, 1.08, 0.06, 0.01), St, par, s * 0.19, -0.33, -0.33);
    for (const y of [-0.7, -0.25, 0.1]) add(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 8).rotateZ(Math.PI / 2), K, par, s * 0.215, y, -0.36);
  }
  for (const y of [-0.82, -0.05]) add(new THREE.BoxGeometry(0.36, 0.035, 0.04), St, par, 0, y, -0.34);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 10), St, par, 0, -0.3, -0.38);
  // encosto: paraquedas (pacote estofado) e almofada inclinada com costuras
  add(rbox(0.38, 0.56, 0.13, 0.04), S, par, 0, -0.43, -0.29);
  const back = add(rbox(0.36, 0.5, 0.06, 0.025), Cu, par, 0, -0.44, -0.2); back.rotation.x = 0.06;
  for (const y of [-0.3, -0.45, -0.6]) add(new THREE.BoxGeometry(0.34, 0.006, 0.062), K, par, 0, y, -0.2);
  if (o.sov) {
    // KM-1 / SK: apoio de cabeça largo e baixo, sem alça de face; punhos amarelos nas laterais do assento
    add(rbox(0.34, 0.22, 0.2, 0.05), S, par, 0, 0.0, -0.27);
    add(rbox(0.26, 0.15, 0.05, 0.02), Cu, par, 0, -0.01, -0.155);
    add(rbox(0.3, 0.06, 0.16, 0.03), S, par, 0, 0.14, -0.29);
    for (const s of [1, -1]) { const h = add(new THREE.TorusGeometry(0.04, 0.009, 6, 12, Math.PI), Y, par, s * 0.25, -0.62, 0.12); h.rotation.set(0, Math.PI / 2, Math.PI / 2); }
  } else {
    // Martin-Baker: caixa da cabeça, contêiner do paraquedas-piloto em cima, orelhas e almofada
    add(rbox(0.32, 0.3, 0.22, 0.05), S, par, 0, 0.05, -0.28);
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.28, 14).rotateZ(Math.PI / 2), S, par, 0, 0.22, -0.3);
    for (const s of [1, -1]) add(rbox(0.04, 0.16, 0.08, 0.015), S, par, s * 0.15, 0.06, -0.17);
    add(rbox(0.22, 0.17, 0.05, 0.02), Cu, par, 0, 0.02, -0.155);
    if (o.face) {
      // alça de face: arco amarelo com listras pretas, acima da cabeça
      const fh = add(new THREE.TorusGeometry(0.07, 0.011, 6, 16, Math.PI), Y, par, 0, 0.27, -0.2); fh.rotation.x = -0.35;
      for (const a of [0.5, 1.2, 1.95, 2.65]) add(new THREE.BoxGeometry(0.012, 0.026, 0.026), K, par, Math.cos(a) * 0.07, 0.27 + Math.sin(a) * 0.07 * Math.cos(0.35), -0.2 - Math.sin(a) * 0.07 * Math.sin(0.35));
    }
  }
  // concha lateral (afina para a frente) e assento: almofada sobre a caixa de sobrevivência
  for (const s of [1, -1]) {
    const sh = new THREE.Shape(); sh.moveTo(-0.3, -0.2); sh.lineTo(0.18, -0.2); sh.lineTo(0.18, -0.08); sh.lineTo(-0.05, 0.12); sh.lineTo(-0.3, 0.2); sh.closePath();
    add(new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1 }).rotateY(-Math.PI / 2).translate(s * 0.23 + 0.0175, 0, 0), S, par, 0, -0.66, -0.03);
  }
  add(rbox(0.44, 0.14, 0.46, 0.03), S, par, 0, -0.8, -0.02);
  add(rbox(0.38, 0.06, 0.4, 0.025), Cu, par, 0, -0.71, -0.01);
  // punho de disparo entre as pernas e a fivela do cinto
  const ph = add(new THREE.TorusGeometry(0.045, 0.01, 6, 14, Math.PI), Y, par, 0, -0.72, 0.22); ph.rotation.x = -Math.PI / 2;
  add(new THREE.BoxGeometry(0.03, 0.03, 0.03), K, par, 0, -0.72, 0.2);
  // cintos: dos ombros por cima até a fivela no peito, e os da cintura
  for (const s of [1, -1]) {
    tube([[s * 0.1, -0.2, -0.22], [s * 0.115, -0.21, -0.06], [s * 0.1, -0.33, 0.1], [s * 0.04, -0.52, 0.13]], 0.011, Cu);
    tube([[s * 0.21, -0.7, -0.1], [s * 0.17, -0.66, 0.07], [s * 0.05, -0.6, 0.14]], 0.011, Cu);
  }
  add(rbox(0.07, 0.07, 0.025, 0.01), St, par, 0, -0.55, 0.14);
}
// assento de pistão: concha de chapa com rebordo, almofada, blindagem atrás da cabeça e cintos Sutton
function pistonSeat(add, M, par, D) {
  const S = M.seat, Cu = M.cushion;
  const shell = new THREE.CylinderGeometry(0.24, 0.22, 0.6, 16, 1, true, Math.PI * 0.3, Math.PI * 1.4); // aberta na frente
  add(shell, S, par, 0, -0.5, -0.12);
  add(rbox(0.44, 0.06, 0.4, 0.02), S, par, 0, -0.8, -0.04);
  add(rbox(0.36, 0.05, 0.34, 0.02), Cu, par, 0, -0.75, -0.04);
  // blindagem do encosto e da cabeça (placa grossa); Spitfire e Fw 190 com apoio de cabeça acolchoado
  add(rbox(0.42, 0.55, 0.05, 0.015), M.steel, par, 0, -0.38, -0.33);
  add(rbox(0.3, 0.22, 0.06, 0.02), M.steel, par, 0, 0.02, -0.3);
  add(rbox(0.2, 0.12, 0.05, 0.02), Cu, par, 0, 0.02, -0.25);
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.04, 0.42, 0.012), M.cushion, par, s * 0.1, -0.38, -0.2);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 12).rotateX(Math.PI / 2), M.steel, par, 0, -0.52, -0.17);
}
// mira: 'gyro' (Mk II do Spitfire), 'refl' (refletora simples), 'revi' (Revi 16), 'a4' (A-4 do F-86),
// 'asp' (ASP-3N/PF dos MiG), 'lcoss' (visor de cálculo do F-4E). Corpo + vidro refletor inclinado.
function sight(add, M, par, kind, x, y, z) {
  if (!kind) return;
  const big = kind === 'a4' || kind === 'asp' || kind === 'lcoss' || kind === 'gyro', jetS = kind === 'a4' || kind === 'asp' || kind === 'lcoss';
  const w = big ? 0.12 : 0.08, h = big ? 0.11 : 0.08, d = big ? 0.2 : 0.12;
  add(rbox(w, h, d, 0.018), M.dark, par, x, y + h / 2, z);                                                        // corpo
  add(new THREE.CylinderGeometry(w * 0.32, w * 0.36, 0.03, 16), M.steel, par, x, y + h + 0.012, z + d * 0.2);      // lente (projeta para cima)
  if (kind === 'gyro' || kind === 'a4') add(rbox(w * 0.8, h * 0.6, 0.08, 0.02), M.cushion, par, x, y + h * 0.4, z - d / 2 - 0.04); // almofada de proteção
  if (jetS) for (const s of [1, -1]) add(new THREE.BoxGeometry(0.015, 0.03, d * 0.7), M.steel, par, x + s * w * 0.52, y + h * 0.5, z); // botões de ajuste
  // vidro refletor inclinado na moldura; o retículo (anel, marcas e ponto, aceso) fica nele, voltado para o piloto
  const gw = w * (kind === 'lcoss' ? 1.4 : 1.15), gh = h * (kind === 'lcoss' ? 1.25 : 1.05), gz = z + d * 0.2, gy = y + h + 0.03 + gh * 0.36;
  const pane = new THREE.Group(); pane.position.set(x, gy, gz); pane.rotation.x = -0.72; par.add(pane);
  add(new THREE.PlaneGeometry(gw, gh), M.glass, pane);
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.008, gh * 1.05, 0.012), M.dark, pane, s * gw / 2, 0, 0);
  add(new THREE.BoxGeometry(gw, 0.01, 0.012), M.dark, pane, 0, -gh / 2, 0);
  const lit = kind === 'asp' || kind === 'revi' || kind === 'refl' ? M.red : M.green;
  add(new THREE.TorusGeometry(gh * 0.2, 0.0012, 4, 32), lit, pane, 0, 0.004, -0.002);
  add(new THREE.CircleGeometry(0.0022, 8).rotateY(Math.PI), lit, pane, 0, 0.004, -0.003);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; add(new THREE.BoxGeometry(0.0025, 0.007, 0.001), lit, pane, Math.cos(a) * gh * 0.27, 0.004 + Math.sin(a) * gh * 0.27, -0.002).rotation.z = a + Math.PI / 2; }
}
