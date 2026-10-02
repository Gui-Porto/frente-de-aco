import { PLANES, GUNS, MISSILES } from '../data/vehicles.js';
// =====================================================================
// Roster da Batalha Aérea. A física usa PLANES (data/vehicles.js); aqui
// ficam a ficha técnica exibida no hangar, as notas e o estilo da IA.
// Nova aeronave = entrada em PLANES + entrada aqui.
// =====================================================================
export const AIR = {
  spit9: {
    maker: 'Supermarine', role: 'Caça de superioridade', era: 'helice', engine: 'Rolls-Royce Merlin 66 · 1.720 hp',
    vmax: 650, cruise: 520, ceiling: 13100, climb: 20, ai: 'turn',
    rate: { velocidade: 5, subida: 8, manobra: 10, resistencia: 4, fogo: 6 },
    strong: ['Curva sustentada mais fechada do roster', 'Subida forte em baixa velocidade', 'Hispano de 20 mm preciso'],
    weak: ['Pouca munição de canhão (120 por arma)', 'Estrutura leve: castigo custa caro'],
  },
  p47: {
    maker: 'Republic', role: 'Caça pesado · energia', era: 'helice', engine: 'P&W R-2800 · 2.300 hp com WEP',
    vmax: 690, cruise: 560, ceiling: 12800, climb: 16, ai: 'boom',
    rate: { velocidade: 7, subida: 5, manobra: 4, resistencia: 10, fogo: 8 },
    strong: ['Mergulho e velocidade em altitude', 'Oito .50 com muita munição', 'Aguenta muito dano'],
    weak: ['Pesado: perde energia em curva', 'Subida lenta'],
  },
  fw190: {
    maker: 'Focke-Wulf', role: 'Caça · ataque e escape', era: 'helice', engine: 'BMW 801 D-2 · 2.050 hp com WEP',
    vmax: 650, cruise: 530, ceiling: 10300, climb: 15, ai: 'boom',
    rate: { velocidade: 7, subida: 6, manobra: 6, resistencia: 7, fogo: 8 },
    strong: ['Rolagem muito rápida', 'MG 151/20 com granada explosiva', 'Boa visibilidade e robustez'],
    weak: ['Perde desempenho acima de 6 km', 'Estol brusco em curva fechada'],
  },
  f86: {
    maker: 'North American', role: 'Caça a jato · mísseis', era: 'jato', engine: 'GE J47-GE-27 · 26,3 kN',
    vmax: 1106, cruise: 870, ceiling: 15000, climb: 46, ai: 'boom',
    rate: { velocidade: 10, subida: 8, manobra: 7, resistencia: 7, fogo: 7 },
    strong: ['Dois AIM-9B Sidewinder', 'Retém energia em alta velocidade', 'Seis M3 de alta cadência'],
    weak: ['Míssil só trava pela cauda do alvo', 'Turbina demora a responder'],
  },
  mig15: {
    maker: 'Mikoyan-Gurevich', role: 'Interceptador a jato', era: 'jato', engine: 'Klimov VK-1 · 26,5 kN',
    vmax: 1076, cruise: 850, ceiling: 15500, climb: 51, ai: 'turn',
    rate: { velocidade: 9, subida: 10, manobra: 7, resistencia: 8, fogo: 9 },
    strong: ['Canhão de 37 mm derruba com 2 ou 3 acertos', 'Subida e teto excelentes', 'Leve e ágil'],
    weak: ['Cadência baixa e balística curva', 'Instável perto de Mach 0,9'],
  },
  f4e: {
    maker: 'McDonnell Douglas', role: 'Caça multifunção · BVR', era: 'radar', engine: '2× GE J79-GE-17 · 79,6 kN com PC',
    vmax: 2370, cruise: 940, ceiling: 18000, climb: 210, ai: 'boom',
    rate: { velocidade: 10, subida: 9, manobra: 5, resistencia: 9, fogo: 10 },
    strong: ['Radar APQ-120 de longo alcance e modo de combate (ACM)', 'Quatro AIM-7E guiados pelo radar + quatro AIM-9J', 'RWR APR-36 identifica o emissor e o guiamento de míssil', 'Dois motores: empuxo enorme com pós-combustão'],
    weak: ['Pesado: perde energia rápido em curva', 'Sparrow exige manter o radar travado até o impacto', 'Rolagem lenta em baixa velocidade'],
  },
  mig21: {
    maker: 'Mikoyan-Gurevich', role: 'Interceptador leve · delta', era: 'radar', engine: 'Tumansky R-13-300 · 63,7 kN com PC',
    vmax: 2230, cruise: 900, ceiling: 17800, climb: 225, ai: 'turn',
    rate: { velocidade: 9, subida: 10, manobra: 7, resistencia: 5, fogo: 7 },
    strong: ['Leve e pequeno: difícil de ver e de detectar no radar', 'Pós-combustão responde rápido', 'R-3R semiativo + R-3S infravermelho'],
    weak: ['Radar RP-22 curto e estreito', 'RWR SPO-10 só indica o quadrante e não avisa de míssil', 'Pouco combustível e um único canhão'],
  },
  il2: { maker: 'Ilyushin', role: 'Avião de ataque blindado', era: 'helice', engine: 'Mikulin AM-38 · 1.700 hp', vmax: 410, cruise: 340, ceiling: 6000, climb: 10, ai: 'bomber', hidden: true,
    rate: { velocidade: 2, subida: 2, manobra: 3, resistencia: 10, fogo: 5 }, strong: [], weak: [] },
};
export const AIR_ROSTER = Object.keys(AIR).filter(k => !AIR[k].hidden);
export const NATION_TAG = { 'Reino Unido': 'RU', EUA: 'EUA', Alemanha: 'ALE', URSS: 'URSS' };

// Adversários por era (jato contra jato, hélice contra hélice)
export const ENEMY_POOL = { helice: ['fw190', 'spit9', 'p47'], jato: ['mig15', 'f86'], radar: ['mig21', 'f4e'] };
export const ALLY_POOL = { helice: ['spit9', 'p47', 'fw190'], jato: ['f86', 'mig15'], radar: ['f4e', 'mig21'] };
// arena por era: limite (m do centro), distância de spawn de cada lado e altitude inicial.
// Com radar o combate começa além do alcance visual.
export const ARENA = { helice: { limit: 4200, spawnZ: 2700, alt: 1600 }, jato: { limit: 4200, spawnZ: 2700, alt: 1600 }, radar: { limit: 8500, spawnZ: 6500, alt: 4000 } };

// Linhas de armamento para a ficha
export function armament(key) {
  const D = PLANES[key], rows = D.guns.map((g, gi) => ({ gi, W: GUNS[g.w], name: GUNS[g.w].name, n: g.n, ammo: g.ammo, rpm: GUNS[g.w].rpm, cal: GUNS[g.w].cal, v: GUNS[g.w].v }));
  for (const r of D.missiles || []) { const M = MISSILES[r.w]; rows.push({ name: M.name, n: r.n, missile: true, range: M.range, seeker: M.seeker, rear: !!M.rearAspect }); }
  return rows;
}
// peso de fogo (kg/s) para comparar poder de fogo
export const burstMass = key => PLANES[key].guns.reduce((s, g) => s + g.n * GUNS[g.w].rpm / 60 * GUNS[g.w].m, 0);
