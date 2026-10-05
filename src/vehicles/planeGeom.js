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
    dih: (D.tailDih || 0) * deg, y0: D.tailY != null ? D.tailY * D.fuseR : D.key === 'mig15' ? finH * 0.55 : 0.08, ellip: !jet }; // tailY: altura da raiz em frações de fuseR
}
// deriva: desenhada no plano da asa e girada 90° (x → y) e erguida até o dorso
export function finCfg(D) {
  const jet = !!D.jet, L = D.L, tc = L * 0.13, finH = L * 0.17;
  return { side: 1, x0: 0, half: finH, c0: tc * 1.25, c1: tc * 0.55, zq0: -L * 0.43, sweep: finH * Math.tan((jet ? 45 : 18) * deg), t0: 0.1, t1: 0.08, dih: 0, y0: 0, ellip: false, lift: D.fuseR * (D.finY ?? 0.6) }; // finY: altura da raiz (frações de fuseR), no dorso da cauda
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
// onde a ponta da asa se solta (fração da semienvergadura): na dobra da asa (F-4) ou no início do aileron
export const tipBreak = D => (D.wingBreak ? D.wingBreak[0] : (D.ail || SURF.ail)[0]);
// fração da área de UMA asa que fica na ponta (sustentação perdida quando ela cai)
export function tipArea(D) {
  const o = wingCfg(D, 1), sB = tipBreak(D); let a = 0, t = 0;
  for (let i = 0; i < 40; i++) { const s = (i + 0.5) / 40, c = chordAt(o, s); t += c; if (s > sB) a += c; }
  return a / t;
}
// trem de pouso: altura do CG ao chão (lift), pernas principais (x = ±mx, z = mz, roda mr) e do nariz/bequilha
// (z = nz, comprimento nl, roda nr). O modelo (buildGear) e as caixas de dano (gearL/gearR/gearN) usam a mesma planta.
// def.gear = { track (bitola, m), ret: 'in' (recolhe para dentro, padrão) | 'out' (Spitfire: para fora) }.
// bay = alojamento de cada perna principal no lado +x (espelhado no −x): retângulo em planta x ∈ [xi, xo],
// z ∈ [za, zb] onde a perna e a roda deitam recolhidas; y0 = altura do pivô (meio da asa), len = perna.
// nbay = alojamento do nariz/bequilha (recolhe para trás): z ∈ [za, zb], meia-largura w.
export function gearPlan(D) {
  const lift = D.fuseR + 1.35, mr = D.jet ? 0.36 : 0.4, nr = D.jet ? 0.28 : 0.17, G = D.gear || {};
  // jatos (triciclo): principais atrás do CG, senão o avião senta na cauda; pistão (bequilha): à frente
  // bordo de ataque da asa em |x|: o munhão tem de ficar debaixo da asa — com enflechamento forte (F-4E, MiG-21) a
  // conta antiga punha a perna e o alojamento à frente do bordo de ataque, uma caixa solta no ar
  const o = wingCfg(D, 1), le = x => station(o, Math.min(1, Math.max(0, (x - o.x0) / o.half)), 0)[2];
  const mx = (G.track || D.span * 0.32) / 2, mz = D.jet ? Math.min(D.wingZ + 0.4, -0.45, le(mx) - 0.32) : D.wingZ + 0.4, ret = G.ret || 'in';
  const nz = D.jet ? D.L * 0.33 : -D.L * 0.46, nl = D.jet ? lift : lift * 0.45;
  const ws = Math.min(0.9, Math.max(0, (mx - o.x0) / o.half)), y0 = station(o, ws, 0.45)[1];
  const len = lift - mr * 1.9 + y0;
  // pivô → borda da roda recolhida; para dentro, a perna encolhe (até 40%) para a roda não passar do eixo do avião
  let reach = len + mr * 0.9 + mr + 0.06; const shrink = ret === 'in' ? Math.min(0.4 * len, Math.max(0, reach - (mx - 0.04))) : 0; reach -= shrink;
  const bay = ret === 'out' ? { xi: mx - 0.05, xo: mx + reach } : { xi: mx - reach, xo: mx + 0.03 };
  Object.assign(bay, { za: mz - mr - 0.08, zb: mz + mr + 0.08, y0, len, ret, shrink });
  // borda da frente em |x|: nunca passa do bordo de ataque (perto do munhão só cabe a perna, a roda deita mais para dentro)
  bay.zbx = x => Math.max(Math.min(bay.zb, le(x) - 0.06), mz + 0.12);
  // recolhendo para dentro: |x| da borda de fora da roda deitada — divide a porta da asa em porta da perna e da roda
  if (ret === 'in') bay.xs = mx - (len + mr * 0.9 - shrink - mr - 0.05);
  // nariz do jato: pivô abaixo do eixo (o duto de ar passa por cima do alojamento); a perna encurta o mesmo tanto
  const ny = D.jet ? -D.fuseR * (D.intakes === 'side' ? 0.42 : 0.8) : 0, nlen = nl - nr * 1.9 + ny;
  const nbay = { za: nz - nlen - nr * 1.9 - 0.06, zb: nz + 0.1, w: Math.max(0.15, (D.jet ? 0.14 : 0.1) / 2 + 0.08), len: nlen, y0: ny };
  return { lift, mx, mz, mr, nz, nl, nr, ret, bay, nbay };
}
