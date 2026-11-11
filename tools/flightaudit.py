# Mede vel. máxima nivelada por avião no jogo (headless) para comparar com dados públicos.
# Uso: npm run dev (outra aba) e: python tools/flightaudit.py
import json, sys
from playwright.sync_api import sync_playwright
JS = """([key, alt]) => {
  const g = window.__game, who = g.mkWho('T', 1, false);
  const p = g.spawnVehicle(who, key, 2);
  p.brain = null; p.pos.set(0, alt, 0); p.vel.set(0, 0, 150); p.q.identity(); p.throttle = 1; p.wep = true; p.gearCmd = 0; p.gear = 0; p.fuel = p.fuelMax * 0.5;
  const dir = new p.pos.constructor(0, 0, 1);
  for (let i = 0; i < 90 * 30; i++) { p.steerTo(dir, 1/30); g.simulate(1/30); if (!p.alive) break; }
  const out = { key, alt, kmh: Math.round(p.vel.length() * 3.6), y: Math.round(p.pos.y) };
  g.planes.splice(g.planes.indexOf(p), 1); p.remove();
  return out;
}"""
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(); pg.add_init_script("localStorage.setItem('fda.settings.v1', JSON.stringify({graphics:{quality:'baixa'}}))")
    pg.on('pageerror', lambda e: print('ERR', e))
    pg.goto('http://localhost:5173'); pg.wait_for_function('window.__game', timeout=120000)
    for key in (sys.argv[1:] or ['p47', 'il2', 'fw190', 'spit9', 'f86', 'mig15', 'f4e', 'mig21']):
        for alt in (500, 5000):
            print(json.dumps(pg.evaluate(JS, [key, alt])), flush=True)
    b.close()
