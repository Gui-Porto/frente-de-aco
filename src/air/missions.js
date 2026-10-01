import { planes } from '../core/state.js';
import { V3 } from '../core/util.js';
// =====================================================================
// Objetivos de missão. Cada modo cria um objeto com:
//   setup(b)     → monta as equipes (usa b.spawn)
//   update(b,dt) → null enquanto corre; { win, why } quando termina
//   status(b)    → texto curto para o HUD
// Novo objetivo (escolta, defender área, alvo específico…) = nova entrada.
// =====================================================================
const alive = team => planes.filter(p => p.alive && p.team === team);

function elimination(b, { allies }) {
  return {
    setup() { b.spawnTeam(1, allies ? b.cfg.allies : 0); b.spawnTeam(-1, b.cfg.enemies); },
    update() {
      if (!alive(-1).length) return { win: true, why: 'Todas as aeronaves inimigas foram derrubadas.' };
      if (!alive(1).length) return { win: false, why: allies ? 'Sua esquadrilha foi destruída.' : 'Você foi abatido.' };
      return null;
    },
    status() { return `Inimigos restantes · ${alive(-1).length}`; },
  };
}

function zone(b) {
  const pts = { 1: 600, '-1': 600 }, Z = { x: 0, z: 0, r: 1500 };
  let acc = 0;
  return {
    zone: Z, pts,
    setup() { b.spawnTeam(1, b.cfg.allies); b.spawnTeam(-1, b.cfg.enemies); },
    update(_, dt) {
      if ((acc += dt) >= 1) {
        acc = 0;
        const n = t => alive(t).filter(p => Math.hypot(p.pos.x - Z.x, p.pos.z - Z.z) < Z.r && p.pos.y < 4500).length;
        const a = n(1), e = n(-1);
        if (a && !e) pts[-1] = Math.max(0, pts[-1] - 4 * a);
        if (e && !a) pts[1] = Math.max(0, pts[1] - 4 * e);
      }
      if (pts[-1] <= 0 || !alive(-1).length) return { win: true, why: 'O espaço aéreo sobre o setor é nosso.' };
      if (pts[1] <= 0 || !alive(1).length) return { win: false, why: 'O inimigo dominou o espaço aéreo.' };
      return null;
    },
    status() { return `Zona aérea · nós ${Math.ceil(pts[1])} × ${Math.ceil(pts[-1])} eles`; },
  };
}

function intercept(b) {
  const base = new V3(0, 900, 2300), bombers = [];
  return {
    base, bombers,
    setup() {
      b.spawnTeam(1, b.cfg.allies);
      const n = Math.max(3, Math.min(6, b.cfg.enemies + 1));
      for (let i = 0; i < n; i++) bombers.push(b.spawnOne('il2', -1, i, n, { role: 'bomber', goal: base, ord: true, z: -3700, y: 1000 }));
      b.spawnTeam(-1, Math.max(1, b.cfg.enemies - 1), { escort: bombers[0], z: -3500, y: 1500 });
    },
    update() {
      const left = bombers.filter(p => p.alive);
      if (!left.length) return { win: true, why: 'A esquadrilha de ataque foi interceptada.' };
      if (left.some(p => Math.hypot(p.pos.x - base.x, p.pos.z - base.z) < 500)) return { win: false, why: 'Os Il-2 chegaram à base e lançaram as bombas.' };
      if (!alive(1).length) return { win: false, why: 'Não sobrou ninguém para interceptar.' };
      return null;
    },
    status() {
      const left = bombers.filter(p => p.alive);
      const d = left.length ? Math.min(...left.map(p => Math.hypot(p.pos.x - base.x, p.pos.z - base.z))) : 0;
      return `Bombardeiros · ${left.length} · ${(d / 1000).toFixed(1).replace('.', ',')} km da base`;
    },
  };
}

function survival(b) {
  const WAVES = 5; let wave = 0, wait = 0;
  const next = () => { wave++; b.spawnTeam(-1, Math.min(8, b.cfg.enemies + wave - 1), { z: -3200 }); b.toast(`Onda ${wave} de ${WAVES}`); };
  return {
    get wave() { return wave; },
    setup() { next(); },
    update(_, dt) {
      if (!b.player || !b.player.alive) return null; // derrota tratada pela morte do jogador
      if (!alive(-1).length) {
        if (wave >= WAVES) return { win: true, why: `Você sobreviveu às ${WAVES} ondas.` };
        if ((wait += dt) > 6) { wait = 0; next(); }
      }
      return null;
    },
    status() { return `Onda ${wave}/${WAVES} · inimigos ${alive(-1).length}`; },
  };
}

export const MODES = {
  duelo: { label: 'Duelo', tag: 'DOGFIGHT', desc: 'Você contra os caças inimigos, sem alas. Derrube todos.', allies: false, create: b => elimination(b, { allies: false }) },
  equipes: { label: 'Combate em equipes', tag: 'TEAM DEATHMATCH', desc: 'Duas esquadrilhas. Vence quem eliminar a outra.', allies: true, create: b => elimination(b, { allies: true }) },
  superioridade: { label: 'Superioridade aérea', tag: 'AIR SUPERIORITY', desc: 'Domine a zona sobre o setor central. Cada segundo sem inimigos dentro custa pontos a eles.', allies: true, create: zone },
  intercepta: { label: 'Interceptação', tag: 'INTERCEPT', desc: 'Il-2 escoltados vão atacar a nossa base. Derrube os bombardeiros antes que cheguem.', allies: true, create: intercept },
  sobrevivencia: { label: 'Sobrevivência', tag: 'SURVIVAL', desc: 'Cinco ondas de caças, cada uma maior. Uma vida só.', allies: false, create: survival },
};
