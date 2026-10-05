import { ENGINES } from '../air/systems/engine.js';
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
    mass: 33700, hp: 450, rpm: 2600, vmax: 42 * 1.15 / 3.6, vrev: 7 * 1.25 / 3.6, wheels: 6, rpmTraverse: false,
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
    mass: 32000, hp: 500, rpm: 1800, vmax: 54 * 1.15 / 3.6, vrev: 8 * 1.25 / 3.6, wheels: 5, rpmTraverse: false,
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
    mass: 25900, hp: 300, rpm: 3000, vmax: 38 * 1.15 / 3.6, vrev: 7 * 1.25 / 3.6, wheels: 8, rpmTraverse: true,
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
    mass: 56900, hp: 650, rpm: 2500, vmax: 40 * 1.15 / 3.6, vrev: 7 * 1.25 / 3.6, wheels: 8, rpmTraverse: true,
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
    mass: 22000, hp: 300, rpm: 3000, vmax: 38 * 1.15 / 3.6, vrev: 7 * 1.25 / 3.6, wheels: 8, rpmTraverse: false,
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
    key: 'p47', type: 'plane', marks: { serial: '226418' }, gear: { track: 4.92, ret: 'in' }, name: 'P-47D-28 Thunderbolt', short: 'P-47D', nation: 'EUA', year: 1944, color: 0x4a4d33, sp: 380, stripes: true,
    mass: 6600, S: 27.87, span: 12.4, L: 11.0, cla: 4.6, clmax: 1.45, cd0: 0.0175, e: 0.8, engine: 'r2800',
    vne: 810 / 3.6, glim: 12, kda: 0.04, kde: 0.32, kdr: 0.05, armor: { pilot: 9, engine: 0 },
    hpParts: { wingL: 38, wingR: 38, tail: 28, engine: 26, fuel: 20, fuse: 45 },
    fuseR: 0.78, noseR: 0.72, wingZ: 0.6, chord: 2.6, tipChord: 1.3, cowl: 'radial',
    // peças reais: dois tanques na fuselagem sob a cabine (sem tanque na asa no D-28), turbocompressor no ventre traseiro, radiadores de óleo na carenagem, flaps hidráulicos
    parts: [{ id: 'fuelF', k: 'fuel', n: 'Tanque principal', z: 0.04, y: -0.4, s: [0.55, 0.35, 0.6] }, { id: 'fuelA', k: 'fuel', n: 'Tanque auxiliar', z: -0.1, y: -0.45, s: [0.5, 0.3, 0.4] },
      { id: 'turbo', k: 'turbo', n: 'Turbocompressor', z: -0.3, y: -0.6, s: [0.35, 0.3, 0.45] }, { id: 'oilc', k: 'cool', n: 'Radiadores de óleo', z: 0.26, y: -0.75, s: [0.55, 0.18, 0.35] },
      { id: 'hyd', k: 'act', n: 'Hidráulico', does: ['flaps'], z: -0.12, y: -0.1, s: [0.3, 0.2, 0.3] }],
    guns: [{ w: 'M2', n: 8, span: [1.9, 2.6, 3.0, 3.4], z: 0.9, ammo: 425 }],
    bombs: [{ name: 'AN-M64 500 lb', m: 227, tnt: 121, d: 0.36, n: 2, x: [2.0, -2.0] }],
    rockets: { name: 'M8/HVAR', m: 61, tnt: 3.5, v: 330, n: 6 }
  },
  il2: {
    key: 'il2', type: 'plane', gear: { track: 3.85, ret: 'in' }, name: 'Il-2 (1942)', short: 'Il-2', nation: 'URSS', year: 1942, color: 0x3d4a2c, sp: 340,
    mass: 6100, S: 38.5, span: 14.6, L: 11.6, cla: 4.5, clmax: 1.4, cd0: 0.026, e: 0.8, engine: 'am38',
    vne: 620 / 3.6, glim: 9, kda: 0.035, kde: 0.3, kdr: 0.05, armor: { pilot: 12, engine: 6, fuel: 6 },
    hpParts: { wingL: 40, wingR: 40, tail: 30, engine: 30, fuel: 22, fuse: 55 },
    fuseR: 0.72, noseR: 0.55, wingZ: 0.35, chord: 2.9, tipChord: 1.3, cowl: 'inline',
    // tudo dentro da banheira blindada: três tanques na fuselagem, radiador sob o motor; flaps pneumáticos
    parts: [{ id: 'fuelF', k: 'fuel', n: 'Tanque superior', z: 0.2, y: 0.3, s: [0.45, 0.25, 0.4] }, { id: 'fuelU', k: 'fuel', n: 'Tanque inferior', z: 0.05, y: -0.5, s: [0.5, 0.25, 0.5] },
      { id: 'fuelA', k: 'fuel', n: 'Tanque traseiro', z: -0.08, y: 0, s: [0.45, 0.35, 0.35] }, { id: 'cool', k: 'cool', n: 'Radiador', z: 0.27, y: -0.7, s: [0.35, 0.2, 0.4] },
      { id: 'pneu', k: 'act', n: 'Pneumático', does: ['flaps'], z: -0.18, y: 0, s: [0.25, 0.25, 0.3] }],
    guns: [{ w: 'VYa', n: 2, span: [2.4], z: 0.6, ammo: 150 }, { w: 'ShKAS', n: 2, span: [2.0], z: 0.6, ammo: 750 }],
    bombs: [{ name: 'FAB-100', m: 100, tnt: 40, d: 0.27, n: 4, x: [1.5, -1.5, 2.2, -2.2] }],
    rockets: { name: 'RS-82', m: 6.8, tnt: 0.36, v: 350, n: 8 }
  },
  fw190: {
    key: 'fw190', type: 'plane', gear: { track: 3.5, ret: 'in' }, name: 'Fw 190 F-8', short: 'Fw 190', nation: 'Alemanha', year: 1944, color: 0x6b7069, sp: 360,
    mass: 4750, S: 18.3, span: 10.5, L: 9.0, cla: 4.8, clmax: 1.45, cd0: 0.019, e: 0.8, engine: 'bmw801',
    vne: 850 / 3.6, glim: 12, kda: 0.06, kde: 0.32, kdr: 0.05, armor: { pilot: 8, engine: 6 },
    hpParts: { wingL: 30, wingR: 30, tail: 24, engine: 22, fuel: 18, fuse: 36 },
    fuseR: 0.66, noseR: 0.66, wingZ: 0.7, chord: 2.2, tipChord: 1.1, cowl: 'radial',
    // tanques dianteiro e traseiro sob o piso da cabine, sem tanque na asa; radiador de óleo em anel blindado na frente do motor;
    // flaps e disparo das armas elétricos
    parts: [{ id: 'fuelF', k: 'fuel', n: 'Tanque dianteiro', z: 0.04, y: -0.5, s: [0.45, 0.25, 0.45] }, { id: 'fuelA', k: 'fuel', n: 'Tanque traseiro', z: -0.1, y: -0.45, s: [0.45, 0.28, 0.5] },
      { id: 'oilc', k: 'cool', n: 'Radiador de óleo (anel)', z: 0.42, s: [0.6, 0.6, 0.1], hp: 14 }, { id: 'elec', k: 'act', n: 'Sistema elétrico', does: ['flaps', 'guns'], z: -0.2, y: 0, s: [0.3, 0.25, 0.3] }],
    guns: [{ w: 'MG131', n: 2, span: [0.25], z: 2.0, ammo: 475 }, { w: 'MG151', n: 2, span: [0.9], z: 0.9, ammo: 250 }],
    bombs: [{ name: 'SC 500', m: 500, tnt: 220, d: 0.47, n: 1, x: [0] }, { name: 'SC 50', m: 50, tnt: 25, d: 0.2, n: 2, x: [1.6, -1.6] }],
    rockets: null
  },
  // ---- Batalha aérea: caças sem carga externa e os primeiros jatos ----
  spit9: {
    key: 'spit9', type: 'plane', gear: { track: 1.68, ret: 'out' }, name: 'Spitfire LF Mk IX', short: 'Spitfire IX', nation: 'Reino Unido', year: 1943, color: 0x59604a, sp: 300,
    mass: 3400, S: 22.48, span: 11.23, L: 9.5, cla: 4.9, clmax: 1.5, cd0: 0.0195, e: 0.85, engine: 'merlin66',
    vne: 760 / 3.6, glim: 12, kda: 0.055, kde: 0.36, kdr: 0.05, armor: { pilot: 7 },
    hpParts: { wingL: 28, wingR: 28, tail: 22, engine: 20, fuel: 16, fuse: 32 },
    fuseR: 0.6, noseR: 0.5, wingZ: 0.55, chord: 2.5, tipChord: 0.9, cowl: 'inline',
    // dois tanques entre o motor e a cabine (sem tanque na asa), um radiador sob cada asa; flaps e disparo das armas pneumáticos
    flap: [0.04, 0.42],
    parts: [{ id: 'fuelF', k: 'fuel', n: 'Tanque superior', z: 0.13, y: 0.25, s: [0.4, 0.28, 0.42] }, { id: 'fuelU', k: 'fuel', n: 'Tanque inferior', z: 0.13, y: -0.4, s: [0.4, 0.22, 0.42] },
      { id: 'rad', k: 'cool', n: 'Radiador', w: [0.2, 0.45], dy: -0.22, s: [0.22, 0.12, 0.5] }, { id: 'pneu', k: 'act', n: 'Pneumático', does: ['flaps', 'guns'], z: -0.15, y: -0.2, s: [0.25, 0.2, 0.3] }],
    guns: [{ w: 'Hispano', n: 2, span: [1.9], z: 0.8, ammo: 120 }, { w: 'M2', n: 2, span: [2.6], z: 0.8, ammo: 250 }],
    bombs: [], rockets: null
  },
  f86: {
    key: 'f86', type: 'plane', marks: { serial: '24513', buzz: 'FU-513', decalZ: -0.22 }, gear: { track: 2.5, ret: 'in' }, name: 'F-86F-35 Sabre', short: 'F-86F', nation: 'EUA', year: 1953, color: 0xa9adb0, sp: 520, jet: true, sweep: 35,
    mass: 6600, S: 28.1, span: 11.3, L: 11.4, cla: 4.2, clmax: 1.25, cd0: 0.0145, e: 0.78, engine: 'j47', mcrit: 0.9, vctrl: 290, flapV: [410, 305, 245],
    vne: 1150 / 3.6, glim: 12, kda: 0.05, kde: 0.3, kdr: 0.04, armor: { pilot: 8 },
    hpParts: { wingL: 44, wingR: 44, tail: 32, engine: 34, fuel: 28, fuse: 52 },
    fuseR: 0.72, noseR: 0.62, wingZ: 0.0, chord: 3.3, tipChord: 1.6, cowl: 'intake',
    fuse: [[-0.53, .4, .42, .4, .04], [-0.44, .5, .55, .5, .06], [-0.3, .7, .8, .72, .05], [-0.14, .9, 1.02, .92, .02], [0.02, 1, 1.1, 1, 0], [0.16, 1, 1.12, 1, 0], [0.28, .94, 1.02, .96, -.03], [0.38, 'n1.02', 'n.98', 'n1.04', -.05], [0.46, 'n.98', 'n.9', 'n1', -.06]],
    canopy: { z: 0.22, len: 2.7, w: 0.44, h: 0.62, frames: [0.24], face: false },
    // detalhes do modelo (vehicles/planeDetail.js): bocal sem pós-combustão, antenas UHF (lâmina ventral) e do rádio-compasso,
    // dois tanques alijáveis de 120 gal sob as asas
    nozzle: { len: 0.5 }, antennas: [{ k: 'blade', zf: -0.1, ay: -1, h: 0.26, len: 0.34 }, { k: 'whip', zf: 0.02, ay: 1, h: 0.42, rake: 0.55 }],
    drops: [{ ws: 0.3, len: 3.2, d: 0.6 }],
    // tanques na fuselagem (dianteiro e central) e integrais nas asas; comandos hidráulicos (normal + alternativo) com profundor todo móvel
    stab: 'all', boost: { ch: ['elev', 'ail'], manual: 0.12 },
    parts: [{ id: 'fuelF', k: 'fuel', n: 'Tanque dianteiro', z: 0.1, s: [0.5, 0.45, 0.7] }, { id: 'fuelC', k: 'fuel', n: 'Tanque central', z: -0.03, y: 0.15, s: [0.5, 0.4, 0.55] },
      { id: 'fuelW', k: 'fuel', n: 'Tanque da asa', w: [0.22, 0.35], s: [0.6, 0.1, 0.55] },
      { id: 'hyd', k: 'act', n: 'Hidráulico utilitário', does: ['flaps', 'brake'], z: -0.02, y: -0.45, s: [0.3, 0.18, 0.4] },
      { id: 'hydN', k: 'act', n: 'Comando hidráulico', does: ['ctl'], z: -0.3, y: 0.3, s: [0.2, 0.15, 0.4] }, { id: 'hydA', k: 'act', n: 'Comando alternativo', does: ['ctl'], z: -0.3, y: -0.3, s: [0.2, 0.15, 0.4] }],
    // 6 M3 nas laterais do nariz (3 de cada lado, em calhas com painel anti-sopro)
    guns: [{ w: 'M3', n: 6, span: [0.7, 0.8, 0.9], z: 3.4, ammo: 300, mount: { zf: 0.355, r: 0.026, len: 0.07, port: true, blast: true, b: [[0.98, 0.5], [0.98, 0.18], [0.98, -0.14], [-0.98, 0.5], [-0.98, 0.18], [-0.98, -0.14]] } }],
    // freios aerodinâmicos: dois painéis nas laterais da fuselagem traseira, abrindo para fora
    brake: [{ zf: -0.17, ax: 1, ay: -0.25, w: 0.7, len: 1.05, open: 'side', deg: 60 }, { zf: -0.17, ax: -1, ay: -0.25, w: 0.7, len: 1.05, open: 'side', deg: 60 }],
    missiles: [{ w: 'AIM9B', n: 2 }], radar: 'apg30', maw: 'pd',
    bombs: [], rockets: null
  },
  mig15: {
    key: 'mig15', type: 'plane', marks: { nose: '718', decalZ: -0.2 }, gear: { track: 3.85, ret: 'in' }, name: 'MiG-15bis', short: 'MiG-15', nation: 'URSS', year: 1950, color: 0xb4b6ae, sp: 500, jet: true, sweep: 35,
    mass: 4960, S: 20.6, span: 10.08, L: 10.1, cla: 4.3, clmax: 1.3, cd0: 0.016, e: 0.78, engine: 'vk1', mcrit: 0.86, vctrl: 270, flapV: [410, 305, 245],
    vne: 1076 / 3.6, glim: 10, kda: 0.045, kde: 0.3, kdr: 0.045, armor: { pilot: 10 },
    hpParts: { wingL: 40, wingR: 40, tail: 30, engine: 32, fuel: 26, fuse: 46 }, radar: 'srd1', maw: 'pd',
    fuseR: 0.7, noseR: 0.62, wingZ: 0.1, chord: 2.9, tipChord: 1.4, cowl: 'intake',
    fuse: [[-0.53, .42, .46, .44, .08], [-0.45, .56, .62, .58, .08], [-0.32, .78, .86, .82, .05], [-0.16, .96, 1.04, 1, .02], [0, 1.04, 1.1, 1.06, 0], [0.14, 1.04, 1.1, 1.06, 0], [0.27, .98, 1.02, 1, -.01], [0.37, 'n1.06', 'n1.06', 'n1.06', -.02], [0.46, 'n1', 'n1', 'n1', -.02]],
    canopy: { z: 0.22, len: 2.3, w: 0.42, h: 0.55, frames: [0.24, 0.6], face: false },
    // mastro da antena do rádio atrás da capota com fio até a deriva; tanques "chinelo" de 250 l rentes à asa
    nozzle: { len: 0.5 }, antennas: [{ k: 'mast', zf: 0.08, ay: 1, h: 0.5, rake: 0.25, wire: 0.92 }, { k: 'whip', zf: -0.15, ay: -1, h: 0.4, rake: 0.6 }],
    drops: [{ ws: 0.42, len: 2.6, d: 0.46, ph: 0.04 }],
    // tanque principal entre a cabine e o motor e tanque traseiro (sem tanque na asa); hidráulico único: flaps, freios e servo do aileron (bis)
    boost: { ch: ['ail'], manual: 0.55 },
    parts: [{ id: 'fuelF', k: 'fuel', n: 'Tanque principal', z: 0.08, s: [0.55, 0.55, 0.75] }, { id: 'fuelA', k: 'fuel', n: 'Tanque traseiro', z: -0.36, y: 0.3, s: [0.3, 0.2, 0.3] },
      { id: 'hyd', k: 'act', n: 'Hidráulico', does: ['flaps', 'brake', 'ctl'], z: -0.02, y: -0.45, s: [0.3, 0.18, 0.4] }],
    // N-37 à direita e dois NR-23 à esquerda, sob o nariz, com carenagem e canos à mostra
    guns: [{ w: 'N37', n: 1, span: [-0.45], z: 2.8, ammo: 40, mount: { zf: 0.4, r: 0.048, len: 0.85, brake: true, fair: { r: 0.12, len: 1.5 }, b: [[-0.45, -1.05]] } },
      { w: 'NR23', n: 2, span: [0.5], z: 2.6, ammo: 80, mount: { zf: 0.38, r: 0.032, len: 0.55, fair: { r: 0.09, len: 1.3 }, b: [[0.3, -1.05], [0.62, -0.95]] } }],
    // freios na fuselagem traseira, perto da cauda (abrem para os lados)
    brake: [{ zf: -0.4, ax: 1, ay: 0, w: 0.5, len: 0.7, open: 'side', deg: 60 }, { zf: -0.4, ax: -1, ay: 0, w: 0.5, len: 0.7, open: 'side', deg: 60 }],
    bombs: [], rockets: null
  },
  // ---- geração com radar, pós-combustão e RWR (escala de jogo nas distâncias) ----
  // mass: vazio + combustível embarcado (fuel) + piloto/munição; mísseis somam à parte.
  // wave: arrasto de onda transônico/supersônico { mcr, peak (ΔCD no pico), mpk (Mach do pico) }
  f4e: {
    key: 'f4e', type: 'plane', marks: { serial: 'AF 67-270', decalZ: -0.33 }, gear: { track: 5.45, ret: 'in', mw: 0.26, twinN: true }, name: 'F-4E Phantom II', short: 'F-4E', nation: 'EUA', year: 1967, color: 0x7a7d63, sp: 640, jet: true, sweep: 45,
    mass: 18200, fuel: 4000, S: 49.2, span: 11.7, L: 19.2, cla: 3.5, clmax: 1.25, cd0: 0.021, e: 0.7, engine: 'j79', engines: 2, rcs: 6,
    mcrit: 0.92, wave: { mcr: 0.92, peak: 0.032, mpk: 1.1 }, vctrl: 430, flapV: [420, 370, 300], damp: [26, 0.72, 0.2], inertia: [223700, 44700, 253500], steer: { ka: 3.8, kr: 10, ky: 3.6 }, // leme fraco para a inércia: o instrutor usa mais leme e amortece a guinada (medido) // kg·m² [arfagem, rolagem, guinada] do F-4C/E publicado (a estimativa por L² dava 2–2,4× mais)
    vne: 1400 / 3.6, glim: 9.5, kda: 0.05, kde: 0.36, kdr: 0.03, armor: { pilot: 6 },
    hpParts: { wingL: 60, wingR: 60, tail: 40, engine: 50, fuel: 36, fuse: 75 },
    fuseR: 0.95, noseR: 0.5, wingZ: -1.2, chord: 5.6, tipChord: 1.6, cowl: 'intake', dih: 4, tailDih: -23, tailY: 0.48, finY: 0.34, intakes: 'side', nozzles: 2, gunPod: true, wingBreak: [0.66, 12], finish: 'camo', underColor: 0xc9ccc6,
    radar: 'apq120', rwr: 'apr36',
    fuse: [[-0.53, .72, .42, .5, -.1], [-0.46, .78, .5, .56, -.08], [-0.36, .86, .62, .66, -.04], [-0.2, .95, .86, .82, 0], [0, 1, 1, .95, 0], [0.14, .92, 1.02, .9, 0], [0.26, .7, .92, .78, .02], [0.36, .52, .7, .62, 0], [0.45, 'n1', 'n1', 'n1', 0]],
    canopy: { z: 0.27, len: 5.0, w: 0.46, h: 0.62, frames: [0.2, 0.5, 0.76], seats: [0.34, 0.74], flat: 0.8, rearDy: -0.03 }, smoke: 0.8,
    // bocais com pétalas da pós-combustão, lâminas UHF/IFF, anticolisão em cima e embaixo, gancho e tanques de 370 gal nos pilones externos
    nozzle: { len: 0.7, petals: 18, petalLen: 0.5 }, antennas: [{ k: 'blade', zf: 0.04, ay: 1, h: 0.3, len: 0.42 }, { k: 'blade', zf: 0.02, ay: -1, h: 0.24, len: 0.34 }],
    beacons: [[-0.12, 1], [0.15, -1]], hook: true, drops: [{ ws: 0.8, len: 4.3, d: 0.66 }],
    // 7 células na fuselagem (em três blocos) + tanques integrais nas asas; dois J79; estabilizador todo móvel;
    // PC-1 e PC-2 movem os comandos, o utilitário move flaps e freios
    stab: 'all', boost: { ch: ['elev', 'ail', 'rud'], manual: 0.08 }, ail: [0.3, 0.6], flap: [0.04, 0.29],
    parts: [{ id: 'fuelF', k: 'fuel', n: 'Células dianteiras', z: 0.12, y: 0.25, s: [0.6, 0.45, 1.2] }, { id: 'fuelC', k: 'fuel', n: 'Células centrais', z: -0.02, y: 0.4, s: [0.6, 0.4, 1.3] },
      { id: 'fuelA', k: 'fuel', n: 'Células traseiras', z: -0.17, y: 0.45, s: [0.5, 0.3, 1.0] }, { id: 'fuelW', k: 'fuel', n: 'Tanque da asa', w: [0.25, 0.35], s: [1.0, 0.12, 0.9] },
      { id: 'hydU', k: 'act', n: 'Hidráulico utilitário', does: ['flaps', 'brake'], z: 0.0, y: -0.7, s: [0.35, 0.2, 0.5] },
      { id: 'pc1', k: 'act', n: 'Hidráulico PC-1', does: ['ctl'], x: 0.5, z: -0.3, y: 0.2, s: [0.2, 0.2, 0.5] }, { id: 'pc2', k: 'act', n: 'Hidráulico PC-2', does: ['ctl'], x: -0.5, z: -0.3, y: 0.2, s: [0.2, 0.2, 0.5] }],
    // M61 de 6 canos na carenagem sob o nariz (F-4E)
    guns: [{ w: 'M61', n: 1, span: [0], z: 8.2, ammo: 640, mount: { zf: 0.41, r: 0.022, len: -0.05, cluster: 6, rr: 0.065, pod: { r: 0.2, len: 3.2, blend: true }, b: [[0, -1]] } }],
    // freios sob as asas, atrás do trem principal (abrem para baixo)
    brake: [{ ws: 0.16, cf: 0.45, ax: 1, w: 0.75, len: 0.8, open: 'down', deg: 50 }, { ws: 0.16, cf: 0.45, ax: -1, w: 0.75, len: 0.8, open: 'down', deg: 50 }],
    missiles: [{ w: 'AIM7E', n: 4 }, { w: 'AIM9J', n: 4 }],
    bombs: [], rockets: null
  },
  mig21: {
    key: 'mig21', type: 'plane', marks: { nose: '24' }, gear: { track: 2.69, ret: 'in' }, name: 'MiG-21MF', short: 'MiG-21MF', nation: 'URSS', year: 1970, color: 0xa8aca6, sp: 600, jet: true, sweep: 57,
    mass: 7750, fuel: 2100, S: 23.0, span: 7.15, L: 14.1, cla: 2.9, clmax: 1.15, cd0: 0.0175, e: 0.62, engine: 'r13', rcs: 3,
    mcrit: 0.93, wave: { mcr: 0.93, peak: 0.026, mpk: 1.12 }, vctrl: 380, flapV: [400, 360, 300], damp: [22, 0.75, 0.17], inertia: [57000, 7000, 61000], steer: { ka: 3.8, kr: 10, ky: 3.6 }, // leme fraco para a inércia: o instrutor usa mais leme e amortece a guinada (medido) // kg·m² aproximados do MiG-21 (asa curta e fuselagem fina)
    vne: 1300 / 3.6, glim: 9.5, kda: 0.055, kde: 0.38, kdr: 0.035, armor: { pilot: 6 },
    hpParts: { wingL: 34, wingR: 34, tail: 26, engine: 30, fuel: 22, fuse: 42 },
    fuseR: 0.62, noseR: 0.45, wingZ: -1.6, chord: 5.2, tipChord: 0.45, cowl: 'intake', dih: -2, shockCone: true,
    radar: 'rp22', rwr: 'spo10', maw: 'pd',
    fuse: [[-0.53, .82, .84, .82, 0], [-0.44, .86, .9, .86, 0], [-0.3, .92, 1, .92, 0], [-0.1, .96, 1.18, .96, 0], [0.08, .98, 1.22, .98, 0], [0.2, .98, 1.18, .98, 0], [0.3, .94, 1, .94, 0], [0.39, 'n1.18', 'n1.18', 'n1.18', 0], [0.46, 'n1.1', 'n1.1', 'n1.1', 0]],
    canopy: { z: 0.26, len: 2.7, w: 0.38, h: 0.5, frames: [0.26, 0.62] },
    // pétalas da pós-combustão, IFF "Odd Rods" sob o nariz, lâmina no dorso e tanque ventral de 490 l
    nozzle: { len: 0.6, petals: 16, petalLen: 0.4 }, antennas: [{ k: 'rods', zf: 0.37, ay: -1, h: 0.22 }, { k: 'blade', zf: -0.12, ay: 1, h: 0.2, len: 0.3 }],
    drops: [{ belly: -0.17, len: 3.1, d: 0.52, fins: 3 }],
    // tanques na fuselagem e nas asas; estabilizador todo móvel; dois hidráulicos (principal e de reforço) movem os comandos
    stab: 'all', boost: { ch: ['elev', 'ail'], manual: 0.1 }, flap: [0.04, 0.42], ail: [0.48, 0.9],
    parts: [{ id: 'fuelF', k: 'fuel', n: 'Tanque dianteiro', z: 0.12, y: 0.35, s: [0.4, 0.3, 1.0] }, { id: 'fuelC', k: 'fuel', n: 'Tanque central', z: -0.05, y: 0.35, s: [0.4, 0.3, 0.9] },
      { id: 'fuelW', k: 'fuel', n: 'Tanque da asa', w: [0.25, 0.3], s: [0.6, 0.1, 1.0] },
      { id: 'hydM', k: 'act', n: 'Hidráulico principal', does: ['flaps', 'brake', 'ctl'], z: 0.0, y: -0.55, s: [0.3, 0.18, 0.5] },
      { id: 'hydB', k: 'act', n: 'Hidráulico de reforço', does: ['ctl'], z: -0.25, y: 0.4, s: [0.25, 0.18, 0.5] }],
    // GSh-23L de dois canos em casulo ventral
    guns: [{ w: 'GSh23', n: 1, span: [0], z: 1.0, ammo: 200, mount: { zf: 0.1, r: 0.026, len: 0.3, twin: 0.1, pod: { r: 0.17, len: 1.9 }, b: [[0, -1]] } }],
    // dois freios ventrais à frente e um atrás (abrem para baixo)
    brake: [{ zf: 0.15, ax: 0.45, ay: -1, w: 0.4, len: 0.72, open: 'down', deg: 40 }, { zf: 0.15, ax: -0.45, ay: -1, w: 0.4, len: 0.72, open: 'down', deg: 40 }, { zf: -0.3, ax: 0, ay: -1, w: 0.42, len: 0.5, open: 'down', deg: 40 }],
    missiles: [{ w: 'R3R', n: 2 }, { w: 'R3S', n: 2 }],
    bombs: [], rockets: null
  }
};

// Armas de aeronaves/AA (stats do projétil base; as cintas — ROUNDS/BELTS abaixo — variam por projétil)
export const GUNS = {
  M2: { name: '12,7 mm M2', cal: 12.7, rpm: 750, v: 870, m: 0.046, pen: 24, he: 0, dmg: 1.2, tracer: 4 },
  ShKAS: { name: '7,62 mm ShKAS', cal: 7.62, rpm: 1800, v: 825, m: 0.0096, pen: 10, he: 0, dmg: 0.45, tracer: 4 },
  VYa: { name: '23 mm VYa-23', cal: 23, rpm: 600, v: 905, m: 0.2, pen: 35, he: 0.01, dmg: 3.2, tracer: 3 },
  MG131: { name: '13 mm MG 131', cal: 13, rpm: 900, v: 750, m: 0.034, pen: 18, he: 0.001, dmg: 1.1, tracer: 4 },
  MG151: { name: '20 mm MG 151/20', cal: 20, rpm: 740, v: 705, m: 0.092, pen: 8, he: 0.0185, dmg: 3.5, tracer: 3 },
  Hispano: { name: '20 mm Hispano Mk II', cal: 20, rpm: 600, v: 880, m: 0.13, pen: 20, he: 0.011, dmg: 3.4, tracer: 3 },
  M3: { name: '12,7 mm M3', cal: 12.7, rpm: 1200, v: 890, m: 0.046, pen: 24, he: 0, dmg: 1.2, tracer: 4 },
  N37: { name: '37 mm N-37D', cal: 37, rpm: 400, v: 690, m: 0.735, pen: 40, he: 0.04, dmg: 12, tracer: 2 },
  NR23: { name: '23 mm NR-23', cal: 23, rpm: 850, v: 680, m: 0.2, pen: 25, he: 0.015, dmg: 3.6, tracer: 3 },
  M61: { name: '20 mm M61A1 Vulcan', cal: 20, rpm: 6000, v: 1030, m: 0.1, pen: 22, he: 0.011, dmg: 3.2, tracer: 5 },
  GSh23: { name: '23 mm GSh-23L', cal: 23, rpm: 3400, v: 715, m: 0.175, pen: 24, he: 0.015, dmg: 3.6, tracer: 4 }
};

// Projéteis das cintas: multiplicadores sobre a arma (pen/he/dmg) + chance incendiária (inc) e traçante (t).
// Metralhadora não tem explosivo (he da arma = 0), então HEFI só aparece nas cintas de canhão.
export const ROUNDS = {
  AP: { n: 'Perfurante', s: 'AP', pen: 1, he: 0, dmg: 1, inc: 0 },
  APT: { n: 'Perfurante traçante', s: 'AP-T', pen: 0.95, he: 0, dmg: 0.95, inc: 0, t: 1 },
  API: { n: 'Perfurante-incendiária', s: 'API', pen: 0.95, he: 0, dmg: 1.05, inc: 0.3 },
  APIT: { n: 'Perfurante-incendiária traçante', s: 'API-T', pen: 0.85, he: 0, dmg: 0.95, inc: 0.2, t: 1 },
  I: { n: 'Incendiária', s: 'I', pen: 0.4, he: 0, dmg: 0.9, inc: 0.6 },
  APHE: { n: 'Perfurante-explosiva', s: 'APHE', pen: 0.85, he: 0.35, dmg: 1, inc: 0.05 },
  HEFI: { n: 'Explosiva-incendiária', s: 'HEF-I', pen: 0.25, he: 1, dmg: 1, inc: 0.25 },
  HEFIT: { n: 'Explosiva-incendiária traçante', s: 'HEF-I-T', pen: 0.25, he: 0.85, dmg: 0.95, inc: 0.2, t: 1 },
};
// Cintas por classe de arma (a ordem é a sequência na cinta); GUNS[x].belts sobrescreve
export const BELTS = {
  mg: { 'Padrão': ['AP', 'API', 'APIT'], 'Ar-ar': ['API', 'I', 'API', 'APIT'], 'Furtiva': ['API', 'I', 'API'], 'Traçante': ['APIT'] },
  cannon: { 'Padrão': ['HEFI', 'APT', 'HEFI', 'HEFIT'], 'Ar-ar': ['HEFI', 'HEFI', 'HEFIT'], 'Furtiva': ['HEFI', 'APHE', 'HEFI'], 'Perfurante': ['APT', 'APHE', 'APT'] },
};
export const beltsOf = W => W.belts || BELTS[W.cal >= 15 ? 'cannon' : 'mg'];
// cinta pronta: um objeto de munição por projétil (a arma com os multiplicadores do tipo)
export function beltRounds(W, name) {
  const B = beltsOf(W), seq = B[name] || B['Padrão'];
  return seq.map(k => { const R = ROUNDS[k]; return Object.assign({}, W, { pen: W.pen * R.pen, he: (W.he || 0) * R.he, dmg: W.dmg * R.dmg, inc: R.inc, tracer: !!R.t, round: k, roundName: R.n }); });
}

// Mísseis ar-ar (guiamento por navegação proporcional; buscador infravermelho de aspecto traseiro)
// form: medidas do modelo 3D (m, contadas a partir da ponta do nariz; span = envergadura de ponta a ponta).
//   nose: { kind: 'ir' (domo de vidro de raio dome·r, cone até o diâmetro cheio em len) | 'ogive' (radome em ogiva de comprimento len) }
//   canards/wings/tails: { at (bordo de ataque na raiz), root, tip (cordas), span, roller? (diâmetro do rolleron) }; bordo de fuga reto
//   bands: faixas pintadas { at, w } — warhead amarela (ogiva explosiva), motor marrom; nozzle: { len, r (fração do raio) }
export const MISSILES = {
  AIM9B: { name: 'AIM-9B Sidewinder', short: 'AIM-9B', mass: 70, d: 0.127, len: 2.83, thrust: 17800, burn: 2.2, cd: 0.45,
    life: 22, range: 4600, minRange: 250, gimbal: 30, fov: 4, acq: 14, lockT: 0.9, maxG: 13, nav: 3.8, fuse: 10, warhead: 4.5, rearAspect: 95, seeker: 'ir',
    form: { nose: { kind: 'ir', len: 0.3, dome: 0.55 }, canards: { at: 0.3, root: 0.26, tip: 0.04, span: 0.45 }, wings: { at: 2.38, root: 0.4, tip: 0.14, span: 0.56, roller: 0.09 },
      bands: { warhead: { at: 0.72, w: 0.04 }, motor: { at: 1.25, w: 0.04 } }, nozzle: { len: 0.06, r: 0.8 } } },
  AIM9J: { name: 'AIM-9J Sidewinder', short: 'AIM-9J', mass: 78, d: 0.127, len: 3.02, thrust: 15500, burn: 3.0, cd: 0.42,
    life: 24, range: 7000, minRange: 300, gimbal: 40, fov: 4, acq: 16, lockT: 0.7, maxG: 18, nav: 4, fuse: 9, warhead: 4.5, rearAspect: 110, flareRes: 0.22, seeker: 'ir',
    form: { nose: { kind: 'ir', len: 0.28, dome: 0.6 }, canards: { at: 0.28, root: 0.3, tip: 0.06, span: 0.56 }, wings: { at: 2.55, root: 0.42, tip: 0.15, span: 0.64, roller: 0.09 },
      bands: { warhead: { at: 0.78, w: 0.04 }, motor: { at: 1.35, w: 0.04 } }, nozzle: { len: 0.06, r: 0.8 } } },
  R3S: { name: 'R-3S (K-13)', short: 'R-3S', mass: 75, d: 0.127, len: 2.84, thrust: 17000, burn: 2.2, cd: 0.45,
    life: 22, range: 5200, minRange: 300, gimbal: 30, fov: 4, acq: 14, lockT: 1.0, maxG: 12, nav: 3.8, fuse: 10, warhead: 4.5, rearAspect: 90, flareRes: 0.35, seeker: 'ir',
    form: { nose: { kind: 'ir', len: 0.33, dome: 0.5 }, canards: { at: 0.33, root: 0.24, tip: 0.05, span: 0.42 }, wings: { at: 2.4, root: 0.38, tip: 0.13, span: 0.53, roller: 0.09 },
      bands: { warhead: { at: 0.74, w: 0.04 }, motor: { at: 1.28, w: 0.04 } }, nozzle: { len: 0.06, r: 0.78 } } },
  // semiativos: não têm buscador próprio de aquisição — exigem o radar do lançador travado (STT) até o impacto
  AIM7E: { name: 'AIM-7E Sparrow', short: 'AIM-7E', mass: 197, d: 0.203, len: 3.66, thrust: 26000, burn: 3.6, cd: 0.4,
    life: 40, range: 16000, minRange: 1200, gimbal: 40, maxG: 16, nav: 4, fuse: 12, warhead: 9, seeker: 'sarh',
    form: { nose: { kind: 'ogive', len: 0.62 }, wings: { at: 1.2, root: 0.66, tip: 0.08, span: 1.02 }, tails: { at: 3.18, root: 0.44, tip: 0.18, span: 0.81 },
      bands: { warhead: { at: 1.95, w: 0.05 }, motor: { at: 2.35, w: 0.05 } }, nozzle: { len: 0.05, r: 0.75 } } },
  R3R: { name: 'R-3R (K-13R)', short: 'R-3R', mass: 83, d: 0.127, len: 3.1, thrust: 17500, burn: 2.4, cd: 0.44,
    life: 26, range: 8000, minRange: 900, gimbal: 35, maxG: 13, nav: 3.8, fuse: 10, warhead: 5, seeker: 'sarh',
    form: { nose: { kind: 'ogive', len: 0.42 }, canards: { at: 0.5, root: 0.24, tip: 0.05, span: 0.42 }, wings: { at: 2.65, root: 0.4, tip: 0.13, span: 0.53, roller: 0.09 },
      bands: { warhead: { at: 0.98, w: 0.04 }, motor: { at: 1.5, w: 0.04 } }, nozzle: { len: 0.06, r: 0.78 } } }
};

// Campos derivados do motor (fonte única: air/systems/engine.js). Telas antigas leem hp/wep/thrust.
for (const D of Object.values(PLANES)) {
  const E = ENGINES[D.engine]; D.engines = D.engines || 1; D.jet = E.kind === 'turbojet';
  if (D.jet) D.thrust = E.mil * D.engines; else { D.hp = E.hp * D.engines; D.wep = E.wep * D.engines; D.eta = E.eta; }
}
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
