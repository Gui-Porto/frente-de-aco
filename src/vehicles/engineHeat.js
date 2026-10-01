// =====================================================================
// Temperaturas do motor (como no War Thunder): a ÁGUA (só motores
// refrigerados a líquido) esquenta rápido, o ÓLEO acompanha devagar, e só o
// excesso SUSTENTADO acima do limite desgasta o motor — devagar no começo,
// rápido quando passa muito. WEP em voo nivelado rápido aguenta minutos;
// WEP subindo devagar superaquece. Função pura: testada em tests/air.test.js.
// =====================================================================
export const COOLING = { spit9: 'liquid', il2: 'liquid', p47: 'radial', fw190: 'radial' };
export const HEAT_LIMITS = { liquid: { water: 115, oil: 95 }, radial: { water: 0, oil: 105 }, jet: { water: 0, oil: 120 } };
const AMB = 15, WEP_HEAT = 1.25;

export const coolingOf = (key, jet) => (jet ? 'jet' : COOLING[key] || 'liquid');

// e: { water, oil } (°C, mutado); throttle 0..1; ias m/s; leak = radiador/óleo vazando.
// Retorna o desgaste do motor nesta fração de segundo (fração do HP total).
export function stepHeat(e, kind, throttle, wep, ias, leak, dt) {
  const L = HEAT_LIMITS[kind];
  const air = Math.sqrt(Math.min(Math.max(ias / 120, 0.25), 1.3)); // fluxo de ar no radiador
  const h = throttle * (wep && kind !== 'jet' ? WEP_HEAT : 1);
  let oilT;
  if (kind === 'liquid') {
    const waterT = AMB + 80 * h / air + (leak ? 70 : 0);
    e.water += (waterT - e.water) * Math.min(1, dt / 20);
    oilT = AMB + 0.8 * (e.water - AMB);
  } else if (kind === 'radial') oilT = AMB + 85 * h / air + (leak ? 50 : 0);
  else oilT = 40 + 50 * h + (leak ? 80 : 0);
  e.oil += (oilT - e.oil) * Math.min(1, dt / (kind === 'liquid' ? 60 : 45));
  const ow = Math.max(0, e.oil - L.oil) / 5, ww = L.water ? Math.max(0, e.water - L.water) / 5 : 0;
  return (0.004 * ww * ww + 0.006 * ow * ow) * dt;
}
// faixa para HUD/IA: 0 = normal, 1 = acima do limite, 2 = crítico (+10 °C)
export function heatLevel(e, kind) {
  const L = HEAT_LIMITS[kind], over = Math.max(e.oil - L.oil, L.water ? e.water - L.water : -99);
  return over > 10 ? 2 : over > 0 ? 1 : 0;
}
