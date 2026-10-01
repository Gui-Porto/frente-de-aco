// =====================================================================
// Dados dos veículos (aproximações dos valores históricos)
// Blindagem: [espessura mm, inclinação a partir da vertical em graus]
// =====================================================================
export const DEG = Math.PI / 180, G = 9.81, RHO = 1.225;

// Penetração de HE por contato (aproximação da curva usada no WT): mm ≈ 15·m_TNT^(1/3)
export const hePen = tnt => 15 * Math.cbrt(tnt);

export const TANKS = {
  sherman: {
    key: 'sherman', type: 'tank', name: 'M4A3 (76) W', nation: 'EUA', year: 1944, color: 0x3a4126, sp: 170,
    mass: 33700, hp: 450, rpm: 2600, vmax: 42 / 3.6, vrev: 7 / 3.6, wheels: 6, rpmTraverse: false,
    L: 5.9, W: 2.62, Hh: 1.45, clr: 0.45, trackW: 0.42, transFront: true,
    turret: { w: 1.85, l: 2.1, h: 0.85, z: 0.25, shape: 'round' },
    armor: { front: [63, 47], lfront: [63, 35], side: [38, 0], rear: [38, 10], top: 19, bottom: 13, tFront: [89, 0], tSide: [64, 5], tRear: [64, 0], tTop: 25 },
    gun: { name: '76 mm M1A1', cal: 76, len: 4.2, reload: 6.5, trav: 24, elevRate: 7, dep: 10, elev: 25, brake: false,
      ammo: [
        { name: 'M62 APCBC', type: 'APHE', pen: 127, v: 792, m: 7.0, filler: 0.064, count: 40 },
        { name: 'M93 HVAP', type: 'APCR', pen: 208, v: 1036, m: 4.3, count: 5 },
        { name: 'M42A1 HE', type: 'HE', v: 800, m: 5.8, tnt: 0.39, count: 26 }] },
    mg: { name: 'M1919A4', cal: 7.62, rpm: 500, v: 850, m: 0.0098, pen: 9, he: 0, belt: 250, total: 3000, tracer: 5 }
  },
  t34: {
    key: 't34', type: 'tank', name: 'T-34-85', nation: 'URSS', year: 1944, color: 0x34442a, sp: 170,
    mass: 32000, hp: 500, rpm: 1800, vmax: 54 / 3.6, vrev: 8 / 3.6, wheels: 5, rpmTraverse: false,
    L: 6.1, W: 3.0, Hh: 1.25, clr: 0.4, trackW: 0.5, transFront: false,
    turret: { w: 2.0, l: 2.5, h: 0.8, z: 0.35, shape: 'hex' },
    armor: { front: [45, 60], lfront: [45, 53], side: [45, 20], rear: [45, 47], top: 20, bottom: 15, tFront: [90, 0], tSide: [75, 20], tRear: [52, 10], tTop: 20 },
    gun: { name: '85 mm ZiS-S-53', cal: 85, len: 4.6, reload: 7.8, trav: 22, elevRate: 6, dep: 5, elev: 22, brake: false,
      ammo: [
        { name: 'BR-365', type: 'APHE', pen: 145, v: 792, m: 9.2, filler: 0.048, count: 30 },
        { name: 'BR-365P', type: 'APCR', pen: 189, v: 1050, m: 4.99, count: 5 },
        { name: 'O-365K', type: 'HE', v: 793, m: 9.5, tnt: 0.74, count: 20 }] },
    mg: { name: 'DT', cal: 7.62, rpm: 600, v: 840, m: 0.0096, pen: 9, he: 0, belt: 63, total: 1953, tracer: 5 }
  },
  pz4: {
    key: 'pz4', type: 'tank', name: 'Pz.Kpfw. IV H', nation: 'Alemanha', year: 1943, color: 0x6f6541, sp: 150,
    mass: 25900, hp: 300, rpm: 3000, vmax: 38 / 3.6, vrev: 7 / 3.6, wheels: 8, rpmTraverse: true,
    L: 5.9, W: 2.88, Hh: 1.3, clr: 0.4, trackW: 0.4, transFront: true,
    turret: { w: 1.8, l: 2.35, h: 0.78, z: 0.1, shape: 'hex' },
    armor: { front: [80, 10], lfront: [80, 14], side: [30, 0], rear: [20, 10], top: 12, bottom: 10, tFront: [80, 10], tSide: [30, 25], tRear: [30, 15], tTop: 16 },
    gun: { name: '75 mm KwK 40 L/48', cal: 75, len: 3.6, reload: 7.0, trav: 14, elevRate: 5, dep: 8, elev: 20, brake: true,
      ammo: [
        { name: 'PzGr 39', type: 'APHE', pen: 135, v: 790, m: 6.8, filler: 0.023, count: 50 },
        { name: 'PzGr 40', type: 'APCR', pen: 176, v: 990, m: 4.1, count: 5 },
        { name: 'Sprgr 34', type: 'HE', v: 550, m: 5.74, tnt: 0.69, count: 32 }] },
    mg: { name: 'MG 34', cal: 7.92, rpm: 900, v: 760, m: 0.0128, pen: 10, he: 0, belt: 150, total: 3150, tracer: 4 }
  },
  tiger: {
    key: 'tiger', type: 'tank', name: 'Tiger H1', nation: 'Alemanha', year: 1943, color: 0x7d6f45, sp: 220,
    mass: 56900, hp: 650, rpm: 2500, vmax: 40 / 3.6, vrev: 7 / 3.6, wheels: 8, rpmTraverse: true,
    L: 6.3, W: 3.56, Hh: 1.45, clr: 0.47, trackW: 0.72, transFront: true,
    turret: { w: 2.3, l: 2.9, h: 0.9, z: -0.1, shape: 'box' },
    armor: { front: [100, 9], lfront: [100, 24], side: [80, 0], rear: [80, 9], top: 25, bottom: 25, tFront: [120, 0], tSide: [80, 0], tRear: [80, 0], tTop: 25 },
    gun: { name: '88 mm KwK 36', cal: 88, len: 5.3, reload: 8.7, trav: 13, elevRate: 5, dep: 8, elev: 15, brake: true,
      ammo: [
        { name: 'PzGr 39', type: 'APHE', pen: 162, v: 773, m: 10.2, filler: 0.059, count: 50 },
        { name: 'PzGr 40', type: 'APCR', pen: 211, v: 930, m: 7.3, count: 5 },
        { name: 'Sprgr L/4.5', type: 'HE', v: 820, m: 9.4, tnt: 0.86, count: 37 }] },
    mg: { name: 'MG 34', cal: 7.92, rpm: 900, v: 760, m: 0.0128, pen: 10, he: 0, belt: 150, total: 4500, tracer: 4 }
  },
  wirbel: {
    key: 'wirbel', type: 'spaa', name: 'Flakpanzer IV Wirbelwind', short: 'Wirbelwind', nation: 'Alemanha', year: 1944, color: 0x6f6541, sp: 110,
    mass: 22000, hp: 300, rpm: 3000, vmax: 38 / 3.6, vrev: 7 / 3.6, wheels: 8, rpmTraverse: false,
    L: 5.9, W: 2.88, Hh: 1.3, clr: 0.4, trackW: 0.4, transFront: true,
    turret: { w: 2.2, l: 2.2, h: 0.75, z: -0.2, shape: 'open' },
    armor: { front: [80, 10], lfront: [80, 14], side: [30, 0], rear: [20, 10], top: 12, bottom: 10, tFront: [16, 25], tSide: [16, 25], tRear: [16, 25], tTop: 0 },
    gun: { name: '4× 2 cm FlaK 38', cal: 20, len: 1.9, auto: true, barrels: 4, rpm: 1800, clip: 80, reload: 6.0, trav: 60, elevRate: 45, dep: 10, elev: 90, brake: false,
      ammo: [
        { name: 'Sprgr (HEFI-T)', type: 'HEF', pen: 6, v: 900, m: 0.12, tnt: 0.008, count: 1600, tracer: 2, dmg: 3 },
        { name: 'PzGr 40 (APCR)', type: 'APCR', pen: 43, v: 1050, m: 0.1, count: 800, tracer: 3, dmg: 2 }] },
    mg: null
  }
};

export const PLANES = {
  p47: {
    key: 'p47', type: 'plane', name: 'P-47D-28 Thunderbolt', short: 'P-47D', nation: 'EUA', year: 1944, color: 0x4a4d33, sp: 380, stripes: true,
    mass: 6600, S: 27.87, span: 12.4, L: 11.0, cla: 4.6, clmax: 1.45, cd0: 0.0175, e: 0.8, hp: 2000, wep: 2300, eta: 0.82,
    vne: 810 / 3.6, glim: 12, kda: 0.04, kde: 0.32, kdr: 0.05, armor: { pilot: 9, engine: 0 },
    hpParts: { wingL: 38, wingR: 38, tail: 28, engine: 26, fuel: 20, fuse: 45 },
    fuseR: 0.78, noseR: 0.72, wingZ: 0.6, chord: 2.6, tipChord: 1.3, cowl: 'radial',
    guns: [{ w: 'M2', n: 8, span: [1.9, 2.6, 3.0, 3.4], z: 0.9, ammo: 425 }],
    bombs: [{ name: 'AN-M64 500 lb', m: 227, tnt: 121, d: 0.36, n: 2, x: [2.0, -2.0] }],
    rockets: { name: 'M8/HVAR', m: 61, tnt: 3.5, v: 330, n: 6 }
  },
  il2: {
    key: 'il2', type: 'plane', name: 'Il-2 (1942)', short: 'Il-2', nation: 'URSS', year: 1942, color: 0x3d4a2c, sp: 340,
    mass: 6100, S: 38.5, span: 14.6, L: 11.6, cla: 4.5, clmax: 1.4, cd0: 0.026, e: 0.8, hp: 1600, wep: 1700, eta: 0.8,
    vne: 620 / 3.6, glim: 9, kda: 0.035, kde: 0.3, kdr: 0.05, armor: { pilot: 12, engine: 6, fuel: 6 },
    hpParts: { wingL: 40, wingR: 40, tail: 30, engine: 30, fuel: 22, fuse: 55 },
    fuseR: 0.72, noseR: 0.55, wingZ: 0.35, chord: 2.9, tipChord: 1.3, cowl: 'inline',
    guns: [{ w: 'VYa', n: 2, span: [2.4], z: 0.6, ammo: 150 }, { w: 'ShKAS', n: 2, span: [2.0], z: 0.6, ammo: 750 }],
    bombs: [{ name: 'FAB-100', m: 100, tnt: 40, d: 0.27, n: 4, x: [1.5, -1.5, 2.2, -2.2] }],
    rockets: { name: 'RS-82', m: 6.8, tnt: 0.36, v: 350, n: 8 }
  },
  fw190: {
    key: 'fw190', type: 'plane', name: 'Fw 190 F-8', short: 'Fw 190', nation: 'Alemanha', year: 1944, color: 0x6b7069, sp: 360,
    mass: 4750, S: 18.3, span: 10.5, L: 9.0, cla: 4.8, clmax: 1.45, cd0: 0.019, e: 0.8, hp: 1700, wep: 2050, eta: 0.82,
    vne: 850 / 3.6, glim: 12, kda: 0.06, kde: 0.32, kdr: 0.05, armor: { pilot: 8, engine: 6 },
    hpParts: { wingL: 30, wingR: 30, tail: 24, engine: 22, fuel: 18, fuse: 36 },
    fuseR: 0.66, noseR: 0.66, wingZ: 0.7, chord: 2.2, tipChord: 1.1, cowl: 'radial',
    guns: [{ w: 'MG131', n: 2, span: [0.25], z: 2.0, ammo: 475 }, { w: 'MG151', n: 2, span: [0.9], z: 0.9, ammo: 250 }],
    bombs: [{ name: 'SC 500', m: 500, tnt: 220, d: 0.47, n: 1, x: [0] }, { name: 'SC 50', m: 50, tnt: 25, d: 0.2, n: 2, x: [1.6, -1.6] }],
    rockets: null
  }
};

// Armas de aeronaves/AA (bala única com cinto simplificado)
export const GUNS = {
  M2: { name: '12,7 mm M2', cal: 12.7, rpm: 750, v: 870, m: 0.046, pen: 24, he: 0, dmg: 1.2, tracer: 4 },
  ShKAS: { name: '7,62 mm ShKAS', cal: 7.62, rpm: 1800, v: 825, m: 0.0096, pen: 10, he: 0, dmg: 0.45, tracer: 4 },
  VYa: { name: '23 mm VYa-23', cal: 23, rpm: 600, v: 905, m: 0.2, pen: 35, he: 0.01, dmg: 3.2, tracer: 3 },
  MG131: { name: '13 mm MG 131', cal: 13, rpm: 900, v: 750, m: 0.034, pen: 18, he: 0.001, dmg: 1.1, tracer: 4 },
  MG151: { name: '20 mm MG 151/20', cal: 20, rpm: 740, v: 705, m: 0.092, pen: 8, he: 0.0185, dmg: 3.5, tracer: 3 }
};

export const VEHICLES = Object.assign({}, TANKS, PLANES);
export const LINEUP = ['sherman', 't34', 'pz4', 'tiger', 'wirbel', 'p47', 'il2', 'fw190'];

// ---------- Balística: arrasto quadrático a = -k|v|v, k = ½ρ·Cd·A/m ----------
export function prepAmmo(am, cal, cd) {
  am.cal = am.cal || cal;
  const A = Math.PI * Math.pow(am.cal / 2000, 2);
  am.k = 0.5 * RHO * (cd || (am.type === 'APCR' ? 0.36 : 0.29)) * A / am.m;
  am.tab = [{ ang: 0, v: am.v, t: 0 }];
  let x = 0, y = 0, vx = am.v, vy = 0, t = 0, next = 25; const h = 0.002;
  while (next <= 3000 && t < 20) {
    const sp = Math.hypot(vx, vy);
    vx += -am.k * sp * vx * h; vy += (-G - am.k * sp * vy) * h; x += vx * h; y += vy * h; t += h;
    if (x >= next) { am.tab.push({ ang: Math.atan(-y / x), v: Math.hypot(vx, vy), t }); next += 25; }
  }
  return am;
}
for (const D of Object.values(TANKS)) {
  for (const am of D.gun.ammo) prepAmmo(am, D.gun.cal);
  if (D.mg) prepAmmo(Object.assign(D.mg, { type: 'MG', dmg: 0.4 }), D.mg.cal, 0.3);
}
for (const g of Object.values(GUNS)) prepAmmo(Object.assign(g, { type: g.he ? 'HEF' : 'MG', tnt: g.he }), g.cal, 0.3);
export function ballistic(am, r) {
  const i = Math.max(0, Math.min(r / 25, am.tab.length - 1.001)), a = Math.floor(i), f = i - a;
  const A = am.tab[a], B = am.tab[a + 1];
  return { ang: A.ang + (B.ang - A.ang) * f, v: A.v + (B.v - A.v) * f, t: A.t + (B.t - A.t) * f };
}
// Perfuração cai com a velocidade de impacto (relação de De Marre, expoente 1,43)
export const penAt = (am, v) => am.type === 'HE' ? hePen(am.tnt) : am.pen * Math.pow(v / am.v, 1.43);
