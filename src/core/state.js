// Estado mutável compartilhado entre módulos (ES modules não permitem reatribuir imports).
export const S = {
  now: 0,
  state: 'menu', // menu | spawn | play | spectate | end
  paused: false,
  player: null,
  me: null,
  spectate: null,
  roster: [],
  stats: {},
  tickets: { 1: 800, '-1': 800 },
  matchT: 0,
  shake: 0,
  flashT: 0,
  xray: null,
  mode: 'ground', // ground | air (Batalha Aérea)
  air: null, airLimit: 0,
};
export const tanks = [];
export const planes = [];
export const projs = [];
export const popped = [];
export const TICKETS = 800;
