import { RHO } from '../data/vehicles.js';
// =====================================================================
// Contas puras sobre os dados de um míssil (MISSILES): ficha do hangar,
// ganho de velocidade da queima e tamanho da fumaça/chama. Sem Three.
// =====================================================================

// escala do motor em relação ao AIM-9B (127 mm, 17,8 kN): cresce com o diâmetro e com o empuxo
const motorScale = M => Math.sqrt((M.d / 0.127) * (M.thrust / 17800));
// rastro e chama proporcionais ao míssil (AIM-9B = rastro de 1,8 → 14 m em 14 s)
// M.smoke = { k (densidade), color }: cada motor tem a sua fumaça (Mk 38 do Sparrow grossa e branca; R-3 mais acinzentada)
export function smokeOf(M) {
  const S = M.smoke || {}, k = motorScale(M) * (S.k ?? 1);
  return { w0: 1.8 * k, w1: 14 * k, life: 14 * (0.7 + 0.3 * k), flame: M.d * 14 * Math.sqrt(M.thrust / 17800), color: S.color ?? 0xd6d2ca, puff: S.puff ?? 1 };
}

// Ganho de velocidade da queima em voo nivelado reto, com o mesmo modelo do voo
// (massa constante, arrasto quadrático, ar ISA exponencial). v0 em m/s, alt em m.
export function boostGain(M, v0 = 250, alt = 3000) {
  const rho = RHO * Math.exp(-alt / 8500), A = Math.PI * (M.d / 2) ** 2, h = 0.01;
  let v = v0;
  for (let t = 0; t < M.burn; t += h) v += (M.thrust / M.mass - 0.5 * rho * v * v * M.cd * A / M.mass) * h;
  return v - v0;
}

const nf = (x, d = 0) => x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const SEEKER_LABEL = { ir: 'Infravermelho', sarh: 'Radar semiativo' };
// linhas [rótulo, valor] da ficha do míssil no cartão da aeronave
export function missileSheet(M) {
  const seeker = M.seeker === 'sarh' ? `${SEEKER_LABEL.sarh} · gimbal ±${M.gimbal}°`
    : `${SEEKER_LABEL.ir} · ${M.rearAspect ? `só pela cauda (±${M.rearAspect}°)` : 'todos os aspectos'} · gimbal ±${M.gimbal}°`;
  return [
    ['Buscador', seeker],
    ['Alcance', `${nf(M.minRange)} – ${nf(M.range)} m`],
    ['Manobra', `${M.maxG} G`],
    ['Queima', `${nf(M.burn, 1)} s · ${nf(M.thrust / 1000, 1)} kN`],
    ['Ganho de velocidade', `+${nf(boostGain(M))} m/s`],
    ['Ogiva', `${nf(M.warhead, 1)} kg · espoleta ${M.fuse} m`],
    ['Trava', M.seeker === 'sarh' ? 'radar do caça travado (STT) até o impacto' : `${nf(M.lockT, 1)} s`],
  ];
}
