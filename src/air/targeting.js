import { V3, clamp } from '../core/util.js';
// =====================================================================
// Aquisição de alvo (buscador infravermelho) e guiamento: funções puras,
// usadas igualmente pelo jogador e pela IA (e testadas sem navegador).
// Estados: BUSCA → RASTREIO → TRAVADO; PERDIDO quando o alvo sai do cone.
// =====================================================================
export const LOCK = { OFF: 'off', SEARCH: 'search', TRACK: 'track', LOCKED: 'locked', LOST: 'lost' };
export const LOCK_LABEL = { off: '', search: 'BUSCA', track: 'RASTREIO', locked: 'TRAVADO', lost: 'PERDIDO' };
const DEG = Math.PI / 180;
const _d = new V3(), _f = new V3(), _tf = new V3(), _r = new V3(), _v = new V3(), _w = new V3();

export const fwdOf = (q, out) => out.set(0, 0, 1).applyQuaternion(q);

// O alvo está no cone do buscador, ao alcance e (se exigido) com a cauda virada para o atirador?
// Retorna o ângulo fora do eixo (rad) ou -1.
export function seekerAngle(pos, fwd, tgt, M, coneDeg) {
  _d.copy(tgt.pos).sub(pos);
  const dist = _d.length();
  if (dist > M.range || dist < 1) return -1;
  _d.divideScalar(dist);
  const c = _d.dot(fwd);
  if (c < Math.cos(coneDeg * DEG)) return -1;
  if (M.rearAspect) { fwdOf(tgt.q, _tf); if (_d.dot(_tf) < Math.cos(M.rearAspect * DEG)) return -1; }
  return Math.acos(clamp(c, -1, 1));
}

export class Seeker {
  constructor(M) { this.M = M; this.state = LOCK.SEARCH; this.target = null; this.t = 0; this.lostT = 0; }
  reset() { this.state = LOCK.SEARCH; this.target = null; this.t = 0; this.lostT = 0; }
  get locked() { return this.state === LOCK.LOCKED && this.target; }
  // owner: {pos, q, team}; list: possíveis alvos {pos, q, team, alive}
  // prefer: alvo marcado pelo piloto (tem prioridade se estiver no cone); now: relógio (flares quebram o rastreio)
  update(dt, owner, list, prefer = null, now = 0) {
    const M = this.M, fwd = fwdOf(owner.q, _f);
    if (this.target && prefer && prefer !== this.target && prefer.alive && seekerAngle(owner.pos, fwd, prefer, M, M.acq || M.fov * 2.5) >= 0) { this.target = prefer; this.t = 0; }
    if (this.target) {
      // rastreando: o buscador gira (gimbal) para seguir o alvo; flares recém-lançadas podem quebrar o rastreio
      const fooled = this.target.flareUntil > now && Math.random() < dt * 1.6;
      const ok = !fooled && this.target.alive && seekerAngle(owner.pos, fwd, this.target, M, M.gimbal) >= 0;
      if (ok) { this.t += dt; if (this.t >= M.lockT) this.state = LOCK.LOCKED; return this.state; }
      this.target = null; this.state = LOCK.LOST; this.lostT = 0.9; this.t = 0;
    }
    // aquisição: cone estreito à frente do nariz (o piloto precisa apontar)
    let best = null, ba = 1e9;
    for (const e of list) {
      if (!e.alive || e.team === owner.team || e === owner) continue;
      const a = seekerAngle(owner.pos, fwd, e, M, M.acq || M.fov * 2.5);
      if (a >= 0 && (e === prefer ? 0 : a) < ba) { ba = e === prefer ? 0 : a; best = e; }
    }
    if (best) { this.target = best; this.t = 0; this.state = LOCK.TRACK; return this.state; }
    if (this.lostT > 0) { this.lostT -= dt; this.state = LOCK.LOST; } else this.state = LOCK.SEARCH;
    return this.state;
  }
}

// Navegação proporcional 3D: a = N·Vc·(Ω × r̂), Ω = (r × v)/|r|² (taxa de giro da linha de visada).
// Retorna a aceleração lateral comandada (m/s²) em `out` e a velocidade de aproximação.
export function pnAccel(mPos, mVel, tPos, tVel, N, out) {
  _r.copy(tPos).sub(mPos); _v.copy(tVel).sub(mVel);
  const r2 = Math.max(_r.lengthSq(), 1), r = Math.sqrt(r2);
  const Vc = -_r.dot(_v) / r;
  _w.crossVectors(_r, _v).divideScalar(r2);
  out.crossVectors(_w, _r.divideScalar(r)).multiplyScalar(N * Math.max(Vc, 50));
  return Vc;
}

// Ponto de mira com avanço para armas de tubo (balas herdam a velocidade do atirador).
// Itera o tempo de voo duas vezes; g opcional compensa a queda.
export function leadPoint(shooterPos, shooterVel, tgtPos, tgtVel, muzzleV, out, g = 9.81) {
  let t = shooterPos.distanceTo(tgtPos) / muzzleV;
  for (let i = 0; i < 2; i++) {
    out.copy(tgtPos).addScaledVector(tgtVel, t).addScaledVector(shooterVel, -t);
    t = shooterPos.distanceTo(out) / muzzleV;
  }
  out.copy(tgtPos).addScaledVector(tgtVel, t).addScaledVector(shooterVel, -t);
  out.y += 0.5 * g * t * t;
  return t;
}

// Energia específica (altura de energia, m) e "energia relativa" entre dois aviões
export const energyHeight = (alt, v) => alt + v * v / (2 * 9.81);
