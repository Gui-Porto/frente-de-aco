# Mede o som que o jogo REALMENTE produz (quem ajusta nem sempre pode ouvir): grava a saída do master no Chromium
# sem cabeça e imprime, por cena, nível (RMS/pico), fator de crista e a divisão da energia por faixa de frequência.
# Uso (com npm run dev ligado): python -I tools/audio_probe.py [tank] [jet] [prop]   — AUDIO_OUT=pasta grava os .wav
import base64, os, sys, wave
import numpy as np
from playwright.sync_api import sync_playwright

TAP = """
window.__cap = { chunks: [], marks: [], sr: 48000 };
const oc = AudioNode.prototype.connect;
AudioNode.prototype.connect = function (dst, ...a) {
  const r = oc.call(this, dst, ...a);
  if (dst instanceof AudioDestinationNode && !this.__tap) {
    this.__tap = true; const ctx = dst.context, sp = ctx.createScriptProcessor(4096, 2, 2), z = ctx.createGain(); z.gain.value = 0;
    sp.onaudioprocess = e => { const L = e.inputBuffer.getChannelData(0), R = e.inputBuffer.getChannelData(1), m = new Float32Array(L.length); for (let i = 0; i < L.length; i++) m[i] = (L[i] + R[i]) / 2; window.__cap.chunks.push(m); };
    oc.call(this, sp); oc.call(sp, z); oc.call(z, dst); window.__cap.sr = ctx.sampleRate;
  }
  return r;
};
window.__mark = n => window.__cap.marks.push([n, window.__cap.chunks.length * 4096]);
window.__w = ms => new Promise(r => setTimeout(r, ms));
window.__key = async (code, ms) => { dispatchEvent(new KeyboardEvent('keydown', { code })); await __w(ms); dispatchEvent(new KeyboardEvent('keyup', { code })); };
window.__dump = () => { const n = window.__cap.chunks.length * 4096, o = new Int16Array(n); let k = 0; for (const c of window.__cap.chunks) for (let i = 0; i < c.length; i++) o[k++] = Math.max(-1, Math.min(1, c[i])) * 32767; let s = ''; const u = new Uint8Array(o.buffer); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return { b64: btoa(s), marks: window.__cap.marks, sr: window.__cap.sr }; };
"""
TANK = """
document.querySelector('#startBtn').click(); await __w(2500); document.querySelector('#spawnBtn').click(); await __w(4000);
const g = window.__game, p = g.S.player, A = g.audio, V = p.pos.constructor;
for (const t of g.tanks) if (t !== p) t.brain = null; // ninguém atirando por conta própria no meio da medição
__mark('tanque parado'); await __w(3000);
__mark('tanque acelerando'); await __key('KeyW', 5000);
__mark('silencio'); await __w(1500);
__mark('seu canhao'); p.shoot(); await __w(3500);
__mark('sua metralhadora'); for (let i = 0; i < 14; i++) { p.mgCd = 0; p.shootMG(); await __w(100); } await __w(800);
__mark('canhao a 250 m'); A.sndShot(new V(p.pos.x + 250, p.pos.y, p.pos.z), 88); await __w(4000);
__mark('explosao a 60 m'); A.sndBoom(new V(p.pos.x, p.pos.y, p.pos.z + 60), true); await __w(4000);
__mark('fim');
"""
AIR = lambda plane: """
document.querySelector('#airBtn').click(); await __w(1500); document.querySelector('#airGo').click(); await __w(800); document.querySelector('#cfgGo').click(); await __w(10000);
const g = window.__game, p = g.S.player, V = p.pos.constructor;
for (const q of g.planes) if (q !== p) { q.brain = null; q.pos.set(9000, 3000, 9000); q.vel.set(0, 0, 200); q.gear = 0; q.gearCmd = 0; }
const hold = () => { p.pos.set(0, 1800, 0); if (p.vel.length() < 120) p.vel.set(0, 0, -200); };
__mark('marcha lenta na pista'); await __w(3000);
p.pos.set(0, 1800, 0); p.vel.set(0, 0, -200); p.q.setFromAxisAngle(new V(0, 1, 0), Math.PI); p.gearCmd = 0; p.gear = 0; p.throttle = 1;
const iv = setInterval(hold, 500); await __w(4000);
__mark('potencia militar'); await __w(4000);
__mark('PC ou WEP'); p.wep = true; for (let i = 0; i < 40; i++) { p.wep = true; await __w(100); }
const am0 = p.guns.reduce((s, q) => s + q.ammo, 0); __mark('suas armas'); dispatchEvent(new KeyboardEvent('keydown', { code: 'Mouse0' })); document.querySelector('canvas.gl').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })); await __w(2000); dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })); await __w(1500);
__mark('fim'); clearInterval(iv); return 'tiros disparados: ' + (am0 - p.guns.reduce((s, q) => s + q.ammo, 0));
"""
BANDS = [('sub <60', 0, 60), ('grave 60-250', 60, 250), ('m.grave 250-800', 250, 800), ('medio 800-2.5k', 800, 2500), ('presenca 2.5-6k', 2500, 6000), ('ar >6k', 6000, 30000)]

def analyse(d, sr):
    if len(d) < 2048: return 'curto demais'
    rms = np.sqrt((d ** 2).mean()); pk = np.abs(d).max(); db = lambda x: 20 * np.log10(max(x, 1e-9))
    S = np.abs(np.fft.rfft(d * np.hanning(len(d)))) ** 2; fr = np.fft.rfftfreq(len(d), 1 / sr); tot = S.sum() or 1
    bands = '  '.join(f'{n} {100 * S[(fr >= a) & (fr < b)].sum() / tot:4.1f}%' for n, a, b in BANDS)
    # pico de curta duração (janela de 50 ms): o quanto o som "bate"
    k = int(sr * 0.05); win = np.sqrt(np.convolve(d ** 2, np.ones(k) / k, 'valid')).max()
    return f'RMS {db(rms):6.1f} dB  janela50ms {db(win):6.1f} dB  pico {db(pk):6.1f} dB  centroide {(S * fr).sum() / tot:5.0f} Hz | {bands}'

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    what = [a for a in sys.argv[1:]] or ['tank', 'jet', 'prop']
    out = os.environ.get('AUDIO_OUT')
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        for w in what:
            pg = b.new_page(viewport={'width': 1280, 'height': 720}); pg.add_init_script(TAP)
            if w != 'tank': pg.add_init_script("localStorage.setItem('fda.air.cfg', JSON.stringify({ plane: '%s', mode: 'equipes', enemies: 1, allies: 0, diff: 'normal', weather: 'limpo', time: 'tarde', map: 'normandia' }))" % ('f4e' if w == 'jet' else 'p47' if w == 'prop' else w))
            pg.on('pageerror', lambda e: print('ERR', e))
            pg.goto('http://localhost:5173'); pg.wait_for_function('window.__game', timeout=120000); pg.wait_for_timeout(1000)
            ret = pg.evaluate('async () => {' + (TANK if w == 'tank' else AIR(w)) + '}')
            if ret: print('  ', ret)
            r = pg.evaluate('() => __dump()'); pg.close()
            d = np.frombuffer(base64.b64decode(r['b64']), dtype='<i2').astype(np.float64) / 32767; sr = int(r['sr']); marks = r['marks']
            print(f'== {w} ({len(d) / sr:.1f} s gravados, {sr} Hz)')
            for (n, a), (_, e) in zip(marks, marks[1:]): print(f'  {n:24} {analyse(d[a:e], sr)}')
            if out:
                os.makedirs(out, exist_ok=True); f = wave.open(os.path.join(out, w + '.wav'), 'wb'); f.setnchannels(1); f.setsampwidth(2); f.setframerate(sr); f.writeframes((d * 32767).astype('<i2').tobytes()); f.close()
        b.close()
