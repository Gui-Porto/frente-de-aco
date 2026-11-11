import * as THREE from 'three';

// Detalhes só visuais dos blindados: nada aqui entra em blindagem, colisão nem na animação das rodas
// (sem `part` no add). Medidas no referencial do casco: +z frente, +y cima, ±x lados. Tudo por dados em KIT.
const KIT = {
  sherman: { skirts: false, fenderH: 0.1, cupola: 'm4', loader: true, bore: true, antenna: 1.9, mgBall: true, drums: 0, bustle: true, hullBoxes: 2 },
  t34: { skirts: false, fenderH: 0.06, cupola: 'low', loader: true, bore: false, antenna: 1.6, mgBall: true, drums: 2, bustle: false, hullBoxes: 1, handrail: true },
  pz4: { skirts: true, fenderH: 0.12, cupola: 'tall', loader: true, bore: false, antenna: 0, mgBall: true, drums: 0, bustle: true, hullBoxes: 2, tskirts: true },
  tiger: { skirts: false, fenderH: 0.14, cupola: 'tall', loader: true, bore: false, antenna: 0, mgBall: true, drums: 0, bustle: true, hullBoxes: 2, spare: true },
  wirbel: { skirts: true, fenderH: 0.12, cupola: null, loader: false, bore: false, antenna: 0, mgBall: false, drums: 0, bustle: false, hullBoxes: 1 }
};

export function addTankDetail(D, c) {
  const { root, turret, gunPivot, mats, wheels } = c, [camo, dark, steel] = mats, K = KIT[D.key] || KIT.sherman;
  const lens = new THREE.MeshStandardMaterial({ color: 0xe8e0b8, roughness: 0.3, metalness: 0.2, emissive: 0x2a2614 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x16150f, roughness: 0.95, metalness: 0.05 });
  const add = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const box = (w, h, l) => new THREE.BoxGeometry(w, h, l);
  const cylZ = (r, l, n = 10) => new THREE.CylinderGeometry(r, r, l, n).rotateX(Math.PI / 2);
  const y0 = D.clr, y1 = D.clr + D.Hh, L = D.L, W = D.W, tw = D.trackW, th = D.clr + 0.42, lh = D.Hh * 0.4, gh = D.Hh - lh, gR = D.gRun || 0.8;
  const gz = f => L / 2 - gR + gR * f, gy = f => y1 - gh * f, gAng = Math.atan2(gh, gR); // ponto da glacis: f=0 topo, f=1 base

  // ---- esteiras e rodas
  for (const sd of [1, -1]) {
    const tx = sd * (W / 2 - tw / 2);
    // para-lama sobre a esteira, com borda levantada e aba inclinada na frente
    add(box(tw + 0.06, 0.035, L * 0.84), camo, root, tx, th + 0.1, 0);
    add(box(0.03, K.fenderH, L * 0.84), camo, root, tx + sd * (tw / 2 + 0.015), th + 0.1 + K.fenderH / 2, 0);
    const nose = add(box(tw + 0.06, 0.035, 0.5), camo, root, tx, th + 0.02, L * 0.42 + 0.28); nose.rotation.x = 0.4;
    const tail = add(box(tw + 0.06, 0.035, 0.4), camo, root, tx, th + 0.04, -L * 0.42 - 0.2); tail.rotation.x = -0.3;
    // rolos de retorno
    for (let i = 0; i < 3; i++) { const rr = add(new THREE.CylinderGeometry(0.06, 0.06, 0.09, 8), steel, root, sd * (W / 2 - 0.03), th - 0.02, (i - 1) * L * 0.2); rr.rotation.z = Math.PI / 2; }
    // faixa de cubo por fora das esteiras (borracha dos pneus nas rodas de apoio)
    for (const w of wheels) if (w.side === sd && w.r < th * 0.37) {
      const ring = add(new THREE.TorusGeometry(w.r * 0.86, w.r * 0.16, 6, 14).rotateX(Math.PI / 2), rubber, w.m, 0, 0, 0);
      const cap = add(new THREE.CylinderGeometry(w.r * 0.32, w.r * 0.32, 0.12, 8), dark, w.m, 0, sd * 0.02, 0); ring.castShadow = cap.castShadow = false;
    }
    // saias de blindagem laterais (Schürzen), em placas separadas
    if (K.skirts) for (let i = 0; i < 4; i++) add(box(0.025, 0.6, L * 0.2), camo, root, sd * (W / 2 + 0.01), th + 0.35, -L * 0.36 + i * L * 0.24);
    if (K.spare) add(box(0.2, 0.04, 0.4), dark, root, sd * (W / 2 - 0.45), th + 0.14, L * 0.2);
  }

  // ---- convés e glacis
  const deckY = y1 + 0.005;
  // faróis, buzina e cabos de reboque
  for (const sd of [1, -1]) {
    const hl = add(cylZ(0.06, 0.1), dark, root, sd * (W * 0.34), y1 + 0.07, L / 2 - gR - 0.15); add(cylZ(0.04, 0.03), lens, hl, 0, 0, 0.06);
    const cb = add(box(0.04, 0.04, gR * 0.9 / Math.cos(gAng)), steel, root, sd * (W * 0.24), gy(0.55), gz(0.55) + 0.03); cb.rotation.x = gAng;
  }
  // escotilhas do motorista e do operador de rádio, bola da metralhadora na glacis
  for (const sd of [1, -1]) {
    const hatch = add(box(0.46, 0.05, 0.36), camo, root, sd * W * 0.17, gy(0.12) + 0.03, gz(0.12)); hatch.rotation.x = gAng * 0.5;
    add(box(0.38, 0.02, 0.08), dark, hatch, 0, 0.03, 0.12);
  }
  if (K.mgBall) { const ball = add(new THREE.SphereGeometry(0.075, 8, 6), steel, root, W * 0.05, gy(0.55) + 0.03, gz(0.55) + 0.04); const bar = add(cylZ(0.02, 0.35, 6), dark, ball, 0, 0, 0.2); bar.rotation.x = 0; }
  // grades de ventilação e entrada de ar do motor, caixas de ferramentas e tambores
  add(box(W * 0.46, 0.05, L * 0.16), dark, root, 0, deckY + 0.025, -L * 0.3);
  add(box(W * 0.46, 0.09, L * 0.1), steel, root, 0, deckY + 0.045, -L * 0.42);
  for (let i = 0; i < K.hullBoxes; i++) add(box(0.22, 0.16, 0.5), steel, root, (i ? -1 : 1) * (W / 2 - tw * 0.6), th + 0.2, -L * 0.1 + i * 0.4);
  for (let i = 0; i < K.drums; i++) add(cylZ(0.2, 0.6, 12), dark, root, (i ? -1 : 1) * (W / 2 - tw / 2), th + 0.32, -L * 0.36);
  if (K.antenna) { const base = add(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), dark, root, W * 0.38, y1 + 0.12, -L * 0.34); add(new THREE.CylinderGeometry(0.01, 0.018, K.antenna, 5), dark, base, 0, K.antenna / 2, 0); }
  // escapamentos com abafador e barra de reboque traseira
  add(box(0.35, 0.08, 0.1), steel, root, 0, y0 + 0.2, -L / 2 - 0.02);
  for (const sd of [1, -1]) add(new THREE.CylinderGeometry(0.07, 0.09, 0.28, 8), steel, root, sd * W * 0.3, y1 - 0.12, -L / 2 - 0.12).rotation.x = Math.PI / 2 - 0.2;

  // ---- torre
  const T = D.turret;
  if (K.cupola) {
    const ch = K.cupola === 'tall' ? 0.32 : K.cupola === 'm4' ? 0.2 : 0.14, cr = K.cupola === 'tall' ? 0.27 : 0.3, cx = T.w * 0.2, cz = -T.l * 0.2;
    const cup = add(new THREE.CylinderGeometry(cr, cr * 1.05, ch, 14), camo, turret, cx, T.h + 0.1 + ch / 2, cz);
    add(new THREE.CylinderGeometry(cr * 0.82, cr * 0.82, 0.04, 14), steel, cup, 0, ch / 2 + 0.02, 0);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(box(0.09, 0.05, 0.03), dark, cup, Math.sin(a) * cr * 1.02, ch * 0.25, Math.cos(a) * cr * 1.02).rotation.y = a; }
    if (K.cupola === 'm4' || K.cupola === 'low') add(cylZ(0.015, 0.4, 5), dark, cup, 0.05, ch / 2 + 0.1, 0.1); // metralhadora antiaérea
  }
  if (K.loader) {
    const lh2 = add(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 14), camo, turret, -T.w * 0.2, T.h + 0.115, -T.l * 0.08);
    add(box(0.16, 0.05, 0.06), dark, lh2, 0, 0.04, 0.2);
  }
  if (K.bustle) add(box(T.w * 0.82, T.h * 0.6, 0.4), camo, turret, 0, T.h * 0.45, -T.l / 2 - 0.12);
  if (K.tskirts) for (const sd of [1, -1]) add(box(0.02, T.h * 0.8, T.l * 0.7), camo, turret, sd * (T.w / 2 + 0.04), T.h * 0.55, -0.05);
  if (K.handrail) for (const sd of [1, -1]) add(cylZ(0.012, T.l * 0.8, 5), steel, turret, sd * (T.w / 2 + 0.05), T.h * 0.8, 0);
  if (D.turret.shape === 'open') { // Wirbelwind: protetor da tripulação e suportes dos canhões
    for (const sd of [1, -1]) add(box(0.04, 0.3, T.l * 0.8), camo, turret, sd * (T.w / 2 - 0.02), T.h + 0.15, 0);
  }

  // ---- canhão: mantelete arredondado, capa do recuo, evacuador de fumaça
  if (!D.gun.auto) {
    const mr = T.h * 0.4;
    add(new THREE.CylinderGeometry(mr, mr, T.w * (D.key === 'tiger' ? 0.58 : 0.42), 14).rotateZ(Math.PI / 2), camo, gunPivot, 0, 0, 0.18);
    const rr = D.gun.cal / 1000 * 0.75 + 0.03;
    if (D.key !== 'tiger') add(new THREE.CylinderGeometry(rr * 1.7, rr * 1.35, 0.5, 12).rotateX(Math.PI / 2), steel, gunPivot, 0, 0, 0.5);
    if (K.bore) add(new THREE.CylinderGeometry(rr * 1.35, rr * 1.35, 0.36, 10).rotateX(Math.PI / 2), steel, gunPivot, 0, 0, D.gun.len * 0.62);
  }
}
