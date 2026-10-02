// =====================================================================
// Catálogo de aviônicos. Cada aeronave aponta para um id por sistema
// (def.radar, def.rwr, def.maw); quem não tem o sistema simplesmente não
// tem a chave — HUD, áudio e IA só usam o que existir. Alcances em metros
// na ESCALA DO JOGO (a arena dos jatos com radar tem ~18 km de lado).
// =====================================================================
export const RADARS = {
  // telemétricos de mira (sem varredura): medem a distância de quem está no cone
  apg30: { name: 'AN/APG-30', kind: 'ranging', range: 2750, cone: 6 },
  srd1: { name: 'SRD-1M Konus', cyr: 'СРД-1М', kind: 'ranging', range: 2000, cone: 7 },
  // radares de busca/rastreio (pulso). range = detecção de alvo de 5 m² de frente.
  // azLim/elLim: volume de busca (±graus); scanRate: °/s da antena; beam: largura do feixe;
  // gimbal: limite da antena em rastreio (STT); lockT: s para travar; lookDown: fração do
  // alcance contra alvo baixo sobre o solo (clutter); acm: modo de combate (cone, alcance)
  apq120: { name: 'AN/APQ-120', kind: 'pulse', range: 22000, azLim: 60, elLim: 25, scanRate: 90, beam: 4, gimbal: 60, lockT: 1.2, lookDown: 0.35, chaffSus: 0.6, iff: true, acm: { az: 10, el: 25, range: 9000 } },
  rp22: { name: 'RP-22 Sapfir-21', cyr: 'РП-22', kind: 'pulse', range: 15000, azLim: 30, elLim: 18, scanRate: 70, beam: 5, gimbal: 45, lockT: 1.6, lookDown: 0.25, chaffSus: 0.8, iff: true },
};
// RWR: res = resolução angular (°; 90 = só quadrante); lib = emissores que ele reconhece → rótulo;
// sens = alcance relativo ao do radar inimigo (o RWR ouve de mais longe do que o radar enxerga)
export const RWRS = {
  apr36: { name: 'AN/APR-36', res: 15, sens: 1.5, maxShow: 6, lib: { rp22: '21', srd1: 'AI', apg30: 'AI', apq120: 'F4' }, guidance: true,
    snd: { search: [1150, 1350, 0.035, 'sine'], lock: [1300, 4], guidance: [1300, 1900, 14], lockType: 'sine' } },
  spo10: { name: 'SPO-10 Sirena-3', cyr: 'СПО-10', res: 90, sens: 1.2, maxShow: 4, lib: null, guidance: false,
    snd: { search: [420, 420, 0.12, 'square'], lock: [420, 0], lockType: 'square' } },
};
// Alerta de aproximação de míssil: uv = só vê a pluma do motor aceso; pd = radar Doppler vê o corpo
export const MAWS = {
  uv: { name: 'MAW ultravioleta', kind: 'uv', range: 6000 },
  pd: { name: 'MAW Doppler', kind: 'pd', range: 5000 },
};
// snd (áudio do aparelho): search = [f0, f1, duração, onda] do bipe de nova emissão;
// lock = [frequência, pulsos/s (0 = contínuo)]; guidance = [f baixa, f alta, alternâncias/s]
// prioridade dos níveis de ameaça do RWR
export const THREAT = { SEARCH: 1, TRACK: 2, LOCK: 3, GUIDANCE: 4 };
