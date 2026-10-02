// =====================================================================
// Geometria compartilhada (sem Three): a mesma planta de asa/empenagem
// serve ao modelo 3D (planeModel.js) e às caixas de dano (planeDamage.js),
// então aileron, flap, profundor e leme ficam exatamente onde são desenhados.
// Eixos do corpo: +z nariz, +y cima, +x asa esquerda. Superfícies em frações
// da semienvergadura útil (s: 0 = raiz junto à fuselagem, 1 = ponta).
// =====================================================================
const deg = Math.PI / 180;
// superfícies de comando padrão: [s0, s1] na semienvergadura; cf = fração da corda a partir do bordo de ataque onde fica a dobradiça
export const SURF = { ail: [0.56, 0.93], flap: [0.04, 0.5], cf: 0.74 };

export function wingCfg(D, side) {
  const jet = !!D.jet, fr = D.fuseR, ellip = D.key === 'spit9' || D.key === 'p47';
  const dih = (D.dih ?? (jet ? (D.key === 'mig15' ? -2 : 3) : 5.5)) * deg, half = D.span / 2 - fr * 0.55;
  return { side, x0: fr * 0.55, half, c0: D.chord, c1: ellip ? D.tipChord * 0.35 : D.tipChord, zq0: D.wingZ + D.chord * 0.1,
    sweep: half * Math.tan((D.sweep || 0) * deg) + (ellip ? 0 : (D.chord - D.tipChord) * 0.1), t0: jet ? 0.1 : 0.15, t1: jet ? 0.08 : 0.09,
    dih, y0: -fr * 0.25, ellip, brk: D.wingBreak ? { at: D.wingBreak[0], dih: D.wingBreak[1] * deg } : null };
}
export function tailCfg(D, side) {
  const jet = !!D.jet, L = D.L, th = D.span * 0.19, tc = L * 0.13, finH = L * 0.17;
  return { side, x0: 0.05, half: th, c0: tc, c1: tc * 0.5, zq0: -L * 0.44, sweep: th * Math.tan((jet ? 38 : 4) * deg), t0: 0.1, t1: 0.08,
    dih: (D.tailDih || 0) * deg, y0: D.key === 'mig15' ? finH * 0.55 : 0.08, ellip: !jet };
}
// deriva: desenhada no plano da asa e girada 90° (x → y) e erguida até o dorso
export function finCfg(D) {
  const jet = !!D.jet, L = D.L, tc = L * 0.13, finH = L * 0.17;
  return { side: 1, x0: 0, half: finH, c0: tc * 1.25, c1: tc * 0.55, zq0: -L * 0.43, sweep: finH * Math.tan((jet ? 45 : 18) * deg), t0: 0.1, t1: 0.08, dih: 0, y0: 0, ellip: false, lift: D.fuseR * 0.6 };
}
// corda e posição do 1/4 de corda na estação s (igual a wingGeometry)
export const chordAt = (o, s) => (o.ellip ? Math.max(o.c0 * Math.sqrt(1 - Math.min(s, 0.985) ** 2), o.c1 || 0) : o.c0 + (o.c1 - o.c0) * s);
export function station(o, s, cf, out = [0, 0, 0]) {
  const c = chordAt(o, s), zle = o.zq0 - o.sweep * s + 0.25 * c;
  const y = o.y0 + (o.brk && s > o.brk.at ? o.brk.at * o.half * Math.tan(o.dih) + (s - o.brk.at) * o.half * Math.tan(o.brk.dih) : s * o.half * Math.tan(o.dih));
  out[0] = o.side * (o.x0 + s * o.half); out[1] = y; out[2] = zle - cf * c;
  return out;
}
// ponto da deriva no corpo (aplica a rotação de 90° e a elevação)
export function finStation(o, s, cf) { const p = station(o, s, cf); return [-p[1], p[0] + o.lift, p[2]]; }
// caixa (centro e meias-medidas) de uma faixa de superfície entre s0 e s1, da dobradiça (cf) ao bordo de fuga
export function surfBox(o, s0, s1, cf, fin) {
  const P = fin ? (s, c) => finStation(o, s, c) : (s, c) => station(o, s, c);
  const pts = [P(s0, cf), P(s1, cf), P(s0, 1), P(s1, 1)];
  const mn = [0, 1, 2].map(i => Math.min(...pts.map(p => p[i]))), mx = [0, 1, 2].map(i => Math.max(...pts.map(p => p[i])));
  return { c: mn.map((v, i) => (v + mx[i]) / 2), h: mn.map((v, i) => Math.max((mx[i] - v) / 2, 0.07)) };
}
