# Folha de inspeção 3x2 por veículo. Uso (com npm run dev ligado): python -I tools/bench.py f4e p47 ... [--gear=0]
import sys, os
from playwright.sync_api import sync_playwright
out = os.environ.get('BENCH_OUT', 'bench-out'); os.makedirs(out, exist_ok=True)
gear = next((a.split('=')[1] for a in sys.argv if a.startswith('--gear=')), '1')
view = next((a.split('=')[1] for a in sys.argv if a.startswith('--v=')), '')
keys = [a for a in sys.argv[1:] if not a.startswith('--')]
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader']); pg = b.new_page(viewport={'width': 1800, 'height': 1000})
    pg.on('pageerror', lambda e: print('ERR', e)); pg.on('console', lambda m: print(m.text) if m.text.startswith('BOX') else None)
    for k in keys:
        pg.goto(f'http://localhost:5173/tools/bench.html?k={k}&gear={gear}&v={view}'); pg.wait_for_function('window.__done', timeout=120000)
        pg.screenshot(path=f'{out}/{k}{"_v" if view else ""}.png'); print('ok', k)
    b.close()
