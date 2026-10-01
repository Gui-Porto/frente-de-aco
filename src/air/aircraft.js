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
  il2: { maker: 'Ilyushin', role: 'Avião de ataque blindado', era: 'helice', engine: 'Mikulin AM-38 · 1.700 hp', vmax: 410, cruise: 340, ceiling: 6000, climb: 10, ai: 'bomber', hidden: true,
    rate: { velocidade: 2, subida: 2, manobra: 3, resistencia: 10, fogo: 5 }, strong: [], weak: [] },
};
export const AIR_ROSTER = Object.keys(AIR).filter(k => !AIR[k].hidden);
export const NATION_TAG = { 'Reino Unido': 'RU', EUA: 'EUA', Alemanha: 'ALE', URSS: 'URSS' };

// Adversários por era (jato contra jato, hélice contra hélice)
export const ENEMY_POOL = { helice: ['fw190', 'spit9', 'p47'], jato: ['mig15', 'f86'] };
export const ALLY_POOL = { helice: ['spit9', 'p47', 'fw190'], jato: ['f86', 'mig15'] };

// Linhas de armamento para a ficha
export function armament(key) {
  const D = PLANES[key], rows = D.guns.map(g => ({ name: GUNS[g.w].name, n: g.n, ammo: g.ammo, rpm: GUNS[g.w].rpm, cal: GUNS[g.w].cal }));
  if (D.missiles) { const M = MISSILES[D.missiles.w]; rows.push({ name: M.name, n: D.missiles.n, missile: true, range: M.range }); }
  return rows;
}
// peso de fogo (kg/s) para comparar poder de fogo
export const burstMass = key => PLANES[key].guns.reduce((s, g) => s + g.n * GUNS[g.w].rpm / 60 * GUNS[g.w].m, 0);
