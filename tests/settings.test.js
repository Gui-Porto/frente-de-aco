import { describe, it, expect } from 'vitest';
import { ACTIONS } from '../src/core/settings.js';

describe('atalhos padrão', () => {
  it('nenhuma tecla faz duas coisas no mesmo grupo (Tanque / Avião / Geral)', () => {
    const seen = new Map();
    for (const [id, grp, , keys] of ACTIONS) for (const k of keys) {
      const key = `${grp}:${k}`;
      expect(seen.get(key), `${k} em ${id} e ${seen.get(key)}`).toBeUndefined();
      seen.set(key, id);
    }
  });
  it('Espaço dispara o míssil; bombas no B', () => {
    const b = Object.fromEntries(ACTIONS.map(a => [a[0], a[3]]));
    expect(b.a_missile).toContain('Space');
    expect(b.a_bomb).toEqual(['KeyB']);
  });
});
