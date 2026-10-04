// =====================================================================
// Atmosfera padrão ISA (troposfera + baixa estratosfera, até 20 km).
// Velocidade do som cai com a temperatura: Mach 1 é ~1225 km/h ao nível
// do mar e ~1062 km/h a 11 km. Antes o jogo usava 340 m/s fixos.
// =====================================================================
export const RHO0 = 1.225;
const T0 = 288.15, P0 = 101325, L = 0.0065, R = 287.05, GM = 9.80665;

// out: { rho, T, a, sigma } (reaproveitado para não alocar por passo)
export function isa(h, out = {}) {
  h = Math.min(Math.max(h, 0), 20000);
  let T, p;
  if (h <= 11000) { T = T0 - L * h; p = P0 * Math.pow(T / T0, GM / (L * R)); }
  else { T = 216.65; p = 22632 * Math.exp(-GM * (h - 11000) / (R * T)); }
  out.T = T; out.rho = p / (R * T); out.sigma = out.rho / RHO0; out.a = Math.sqrt(1.4 * R * T);
  return out;
}
