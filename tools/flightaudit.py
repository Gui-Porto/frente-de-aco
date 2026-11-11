# Mede no jogo (headless): vel. máxima nivelada, razão de subida e curva sustentada por avião.
# Uso: npm run dev (outra janela) e: python -I tools/flightaudit.py [chaves...]
import json, os, sys
from playwright.sync_api import sync_playwright
PRE = """const g = window.__game, who = g.mkWho('T', 1, false);
  const p = g.spawnVehicle(who, key, 2), V = p.pos.constructor;
  p.brain = null; p.pos.set(0, alt, 0); p.vel.set(0, 0, v0); p.q.identity(); p.throttle = 1; p.wep = true; p.gearCmd = 0; p.gear = 0; p.fuel = p.fuelMax; p.bombs = []; p.rockets = 0;
  const run = (t, f) => { for (let i = 0; i < t * 30; i++) { f(); p.pos.x = 0; p.pos.z = 0; p.temp = 80; p.heat.water = 85; p.heat.oil = 70; g.simulate(1/30); if (!p.alive) break; } };
  const done = o => { g.planes.splice(g.planes.indexOf(p), 1); p.remove(); return Object.assign({ key, alt }, o); };"""
VMAX = "([key, alt, v0]) => {" + PRE + """
  const d = new V(0, 0, 1); let sum = 0, n = 0; // média dos últimos 10 s (o pico incluiria a velocidade inicial)
  run(90, () => { p.steerTo(d, 1/30); if (++n > 80 * 30) sum += p.vel.length(); });
  return done({ vmax: Math.round(sum / (10 * 30) * 3.6) }); }"""
# subida ESTÁVEL: altitude fixa (densidade constante), o ângulo segura cada velocidade-alvo e vale a
# média de vel.y em 40 s (o controlador oscila como um fugoide); fica a melhor entre as velocidades
CLIMB = "([key, alt, v0]) => {" + PRE + """
  let best = null, all = []; const sp = (p.def.jet ? [450, 600, 750, 900, 1050] : [200, 240, 280, 320]).map(x => x / 3.6);
  for (const vt of sp) { p.pos.set(0, alt, 0); p.vel.set(0, 0, vt); p.q.identity(); p.alive = true; p.iP = 0;
    let gm = 0.2, sum = 0, n = 0; const d = new V();
    const f = () => { gm = Math.max(0, Math.min(1.45, gm + 0.004 * (p.vel.length() - vt) / 30)); d.set(0, Math.sin(gm), Math.cos(gm)); p.steerTo(d, 1/30); p.pos.y = alt; if (++n > 60 * 30) sum += p.vel.y; };
    run(100, f);
    const roc = sum / (40 * 30); all.push([Math.round(vt * 3.6), +roc.toFixed(1)]); if (!best || roc > best.roc) best = { roc: +roc.toFixed(1), kmh: Math.round(vt * 3.6), ang: Math.round(gm * 57.3) }; }
  best.all = all; return done(best); }"""
# curva: alvo 90° à direita do rumo, com leve subida para segurar a altura; tempo de 360° nos últimos 20 s
TURN = "([key, alt, v0]) => {" + PRE + """
  const hd = () => Math.atan2(p.vel.x, p.vel.z), d = new V();
  const aim = () => { const h = hd() + Math.PI / 2, gm = Math.max(-0.3, Math.min(0.3, (alt - p.pos.y) / 400)), c = Math.cos(gm); d.set(Math.sin(h) * c, Math.sin(gm), Math.cos(h) * c); p.steerTo(d, 1/30); };
  run(40, aim); const y0 = p.pos.y; let tot = 0, last = hd();
  run(20, () => { aim(); const h = hd(); let dh = h - last; while (dh > Math.PI) dh -= 2*Math.PI; while (dh < -Math.PI) dh += 2*Math.PI; tot += dh; last = h; });
  return done({ turn360: +(360 / (Math.abs(tot) * 180 / Math.PI / 20)).toFixed(1), kmh: Math.round(p.vel.length() * 3.6), dy: Math.round(p.pos.y - y0), alive: p.alive }); }"""
if __name__ == '__main__':
    keys = sys.argv[1:] or ['p47', 'il2', 'fw190', 'spit9', 'f86', 'mig15', 'f4e', 'mig21']
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(); pg.add_init_script("localStorage.setItem('fda.settings.v1', JSON.stringify({graphics:{quality:'baixa'}}))")
        pg.on('pageerror', lambda e: print('ERR', e))
        pg.goto('http://localhost:5173'); pg.wait_for_function('window.__game', timeout=120000)
        for key in keys:
            for name, js, alt, v0 in [m for m in (('vmax', VMAX, 500, 150), ('vmax', VMAX, 5000, 150), ('climb', CLIMB, 500, 150), ('turn', TURN, 3000, 150)) if m[0] in os.environ.get('MEAS', 'vmax,climb,turn').split(',')]:
                print(name, json.dumps(pg.evaluate(js, [key, alt, v0])), flush=True)
        b.close()
