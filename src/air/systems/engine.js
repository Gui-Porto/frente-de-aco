// =====================================================================
// Motores das aeronaves: definição (ENGINES) + estado (EngineSet).
// Cada avião aponta para um motor por id e diz quantos leva; nada aqui
// sabe qual avião é. Funções puras, testadas em tests/engine.test.js.
//
// Turbojato: a rotação N (fração da máxima) persegue a rotação comandada.
//  - acelera devagar em rotação baixa e rápido perto do máximo (o
//    compressor só "pega" com massa de ar), desacelera mais rápido;
//  - empuxo ∝ N^3,5 entre marcha lenta e militar;
//  - spoolUp/spoolDn são TEMPOS medidos (marcha lenta → 95% do empuxo e
//    militar → 10%); as constantes internas são calibradas a partir deles.
//  - pós-combustão: só com manete em 100% e N ≥ 97%; acende após abLight s
//    e cresce em abRamp s; corta quase na hora.
// Pistão: potência acompanha a manete com atraso curto (resp), cai acima da
// altitude crítica do compressor; hélice converte em empuxo por eta/V.
// =====================================================================
export const ENGINES = {
  // ---- pistão (hp = militar, wep = emergência; altCrit/altScale do compressor) ----
  merlin66: { kind: 'piston', name: 'Rolls-Royce Merlin 66', hp: 1580, wep: 1720, eta: 0.82, resp: 0.35, altCrit: 3800, altScale: 8000, cooling: 'liquid', torque: 1 },
  r2800: { kind: 'piston', name: 'P&W R-2800-59 (turbo)', hp: 2000, wep: 2300, eta: 0.82, resp: 0.5, altCrit: 7600, altScale: 9000, cooling: 'radial', torque: 1.15 },
  bmw801: { kind: 'piston', name: 'BMW 801 D-2', hp: 1700, wep: 2050, eta: 0.82, resp: 0.4, altCrit: 5200, altScale: 6500, cooling: 'radial', torque: 1 },
  am38: { kind: 'piston', name: 'Mikulin AM-38', hp: 1600, wep: 1700, eta: 0.8, resp: 0.45, altCrit: 1500, altScale: 7000, cooling: 'liquid', torque: 1 },
  // ---- turbojato (kN por motor; tsfc em kg/(N·h)) ----
  j47: { kind: 'turbojet', name: 'GE J47-GE-27', mil: 26.3, idle: 0.06, nIdle: 0.45, spoolUp: 5.5, spoolDn: 3.0, tsfc: 0.107, ramK: 0.2, altExp: 0.8 },
  vk1: { kind: 'turbojet', name: 'Klimov VK-1', mil: 26.5, idle: 0.06, nIdle: 0.42, spoolUp: 4.8, spoolDn: 2.8, tsfc: 0.112, ramK: 0.2, altExp: 0.8 },
  j79: { kind: 'turbojet', name: 'GE J79-GE-17', mil: 52.8, ab: 79.6, idle: 0.05, nIdle: 0.5, spoolUp: 4.5, spoolDn: 2.4, abLight: 0.8, abRamp: 1.2, tsfc: 0.086, tsfcAB: 0.199, ramK: 0.45, altExp: 0.75 },
  r13: { kind: 'turbojet', name: 'Tumansky R-13-300', mil: 39.9, ab: 63.7, idle: 0.05, nIdle: 0.48, spoolUp: 4.0, spoolDn: 2.2, abLight: 0.6, abRamp: 1.0, tsfc: 0.094, tsfcAB: 0.224, ramK: 0.5, altExp: 0.75 },
};
const HP_W = 745.7, PISTON_FUEL = 0.000105; // kg/s por hp (mantém a autonomia já balanceada)

// ---------- turbojato: dinâmica da rotação ----------
const thrustFrac = (E, N) => E.idle + (1 - E.idle) * Math.max(0, (N ** 3.5 - E.nIdle ** 3.5) / (1 - E.nIdle ** 3.5));
// taxa de aceleração cresce com a rotação: s = 0 em marcha lenta, 1 no máximo
const upRate = (E, N) => { const s = (N - E.nIdle) / (1 - E.nIdle); return E._kU * (0.12 + 0.88 * s * s); };
export function stepRpm(E, N, Nc, dt) {
  const d = Nc - N;
  if (d > 0) return Math.min(Nc, N + d * Math.min(1, upRate(E, N) * dt));
  return Math.max(Nc, N + d * Math.min(1, E._kD * dt));
}
// tempo de marcha lenta até 95% do empuxo militar (ou de militar até 10%)
export function spoolTime(E, up, dt = 1 / 120) {
  let N = up ? E.nIdle : 1, t = 0;
  while (t < 60) {
    N = stepRpm(E, N, up ? 1 : E.nIdle, dt); t += dt;
    const f = thrustFrac(E, N);
    if (up ? f >= 0.95 : f <= 0.1) return t;
  }
  return t;
}
// calibra _kU/_kD por bisseção para que os tempos medidos batam com a ficha
function calibrate(E) {
  for (const [key, up, target] of [['_kU', true, E.spoolUp], ['_kD', false, E.spoolDn]]) {
    let lo = 0.01, hi = 50;
    for (let i = 0; i < 40; i++) { E[key] = Math.sqrt(lo * hi); if (spoolTime(E, up) > target) lo = E[key]; else hi = E[key]; }
  }
}
for (const E of Object.values(ENGINES)) if (E.kind === 'turbojet') calibrate(E);

// ---------- estado dos motores de uma aeronave ----------
export class EngineSet {
  constructor(id, count = 1) {
    this.E = ENGINES[id]; this.count = count;
    if (!this.E) throw new Error(`motor desconhecido: ${id}`);
    this.jet = this.E.kind === 'turbojet';
    this.N = 1; this.ab = 0; this.abT = 0; this.power = 1; // N: rotação; ab: 0..1 da pós-combustão; power: fração entregue (pistão)
    this.thrust = 0; this.flow = 0;                       // saídas do último passo (N, kg/s)
  }
  get hasAB() { return !!this.E.ab; }
  get abLit() { return this.ab > 0.02; }
  // fração de potência/empuxo para HUD, som e temperatura (0..1; >1 = WEP/pós-combustão)
  get output() { return this.jet ? thrustFrac(this.E, this.N) * (1 + this.ab * ((this.E.ab || this.E.mil) / this.E.mil - 1)) : this.power; }
  // thr 0..1; boost = WEP/pós-combustão pedido; health 0..1 (dano reduz o rendimento); running = motor ligado
  step(dt, thr, boost, health, running) {
    const E = this.E;
    if (this.jet) {
      const Nc = running ? E.nIdle + (1 - E.nIdle) * thr : 0;
      this.N = running ? stepRpm(E, this.N, Nc, dt) : Math.max(0, this.N - dt * 0.15);
      const want = running && boost && E.ab && thr > 0.99 && this.N > 0.97;
      if (want) { this.abT += dt; if (this.abT >= E.abLight) this.ab = Math.min(1, this.ab + dt / E.abRamp); }
      else { this.abT = 0; this.ab = Math.max(0, this.ab - dt / 0.35); }
    } else {
      const target = running ? thr * (boost ? E.wep / E.hp : 1) : 0;
      this.power += (target - this.power) * Math.min(1, dt / E.resp);
    }
    this.health = running ? health : 0;
  }
  // força propulsiva (N). V m/s, atm = isa(), mach
  force(V, atm, mach) {
    const E = this.E, k = this.count * this.health;
    if (this.jet) {
      const amb = Math.pow(atm.sigma, E.altExp) * (1 + E.ramK * mach * mach);
      const mil = E.mil * 1000 * thrustFrac(E, this.N), abx = (E.ab ? (E.ab - E.mil) * 1000 : 0) * this.ab;
      this.thrust = (mil + abx) * amb * k;
      // na pós-combustão o consumo específico vale para o empuxo TOTAL (por isso dispara)
      const fl = mil * E.tsfc + (E.ab ? this.ab * ((mil + (E.ab - E.mil) * 1000) * E.tsfcAB - mil * E.tsfc) : 0);
      this.flow = fl * amb * k / 3600;
      return this.thrust;
    }
    const h = atm.alt || 0, altF = h < E.altCrit ? 1 : Math.exp(-(h - E.altCrit) / E.altScale);
    const P = E.hp * HP_W * this.power * altF * k;
    this.flow = E.hp * PISTON_FUEL * this.power * this.count * (this.health > 0 ? 1 : 0);
    this.shaft = P;
    this.thrust = P * E.eta / Math.max(V, 28);
    return this.thrust;
  }
}
