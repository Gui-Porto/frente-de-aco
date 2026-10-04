// =====================================================================
// Identidade visual da HUD por aeronave. Cada avião pode trazer def.hud;
// sem isso, o tema sai da família (pistão / jato ocidental / jato soviético).
// Os temas vêm dos painéis reais de cada época:
//  ww2  — tinta luminosa creme com latão (mostradores de rádio dos anos 40)
//  nato — painel preto com legenda branca e aço-azulado; escopo de fósforo P7
//         (varredura branco-azulada, persistência amarelo-esverdeada)
//  sov  — turquesa dos cockpits soviéticos; legendas dos sistemas em cirílico;
//         escopo com persistência âmbar
// mach: o painel tem machímetro; cyr: usar o nome cirílico dos sistemas.
// =====================================================================
export const THEMES = {
  ww2: { id: 'ww2', fg: '#f0e7c6', dim: 'rgba(240,231,198,.58)', faint: 'rgba(240,231,198,.16)', accent: '#c9a54a', edge: 'rgba(201,165,74,.34)', plate0: 'rgba(16,13,8,.84)', plate1: 'rgba(16,13,8,.66)', ab: '#efa53c', mach: false, cyr: false },
  nato: { id: 'nato', fg: '#eef1ec', dim: 'rgba(238,241,236,.56)', faint: 'rgba(238,241,236,.14)', accent: '#7fc4d8', edge: 'rgba(127,196,216,.3)', plate0: 'rgba(6,10,13,.86)', plate1: 'rgba(6,10,13,.68)', ab: '#ff9a3c', mach: true, cyr: false,
    scope: { bg: 'rgba(3,9,7,.86)', sweep: '223,244,255', glow: '182,227,106', grid: 'rgba(182,227,106,.16)', text: '#cde9a6' } },
  sov: { id: 'sov', fg: '#e4f4ef', dim: 'rgba(228,244,239,.58)', faint: 'rgba(228,244,239,.15)', accent: '#5fd0bf', edge: 'rgba(95,208,191,.4)', plate0: 'rgba(8,46,44,.86)', plate1: 'rgba(4,22,22,.7)', ab: '#ff9a3c', mach: true, cyr: true,
    scope: { bg: 'rgba(6,13,9,.86)', sweep: '255,241,200', glow: '226,200,96', grid: 'rgba(226,200,96,.16)', text: '#ead79a' } },
};
export const themeOf = D => THEMES[D.hud] || THEMES[!D.jet ? 'ww2' : D.nation === 'URSS' ? 'sov' : 'nato'];
// nome do sistema como aparece na placa (cirílico no tema soviético, se houver)
export const sysName = (T, S) => (T.cyr && S.cyr ? S.cyr : S.name);
