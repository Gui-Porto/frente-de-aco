# Prepara as gravações de public/audio a partir dos originais (mp3/wav) numa pasta: decodifica no Chromium (não há
# ffmpeg na máquina), corta, passa para mono, normaliza e grava WAV 16 bits curto. Uso (com npm run dev ligado):
#   python -I tools/audio_prep.py <pasta com os originais>
# Tipos: shot = som inteiro a partir do ataque; loop = trecho mais estável de N s com as pontas emendadas (crossfade);
#        by = passagem (rasante) centrada no pico, com o instante do pico gravado em meta.json.
import sys, os, json, base64, shutil
from playwright.sync_api import sync_playwright
src = sys.argv[1]; root = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); tmp = os.path.join(root, 'public', '_asrc'); out = os.path.join(root, 'public', 'audio')
PLAN = {  # saída: [arquivo, tipo, segundos, taxa]
    'tankshot': ['tankshot.mp3', 'shot', 2.4, 44100], 'boom': ['boom.mp3', 'shot', 5.0, 32000], 'boom_small': ['boomsmall.mp3', 'shot', 2.6, 32000],
    'tank': ['tank.mp3', 'loop', 6.0, 32000], 'piston': ['piston.mp3', 'loop', 6.0, 32000], 'jet': ['jet.mp3', 'loop', 6.0, 32000], 'jetcab': ['jetcab.mp3', 'loop', 6.0, 24000],
    'mgloop': ['mgloop.mp3', 'loop', 1.6, 32000], 'jetby': ['jetby.mp3', 'by', 12.0, 32000], 'propby': ['propby.mp3', 'by', 12.0, 32000],
}
JS = r"""async ([file, kind, secs, rate]) => {
  const ac = new AudioContext(), buf = await ac.decodeAudioData(await (await fetch('/_asrc/' + file)).arrayBuffer());
  const n0 = buf.length, sr = buf.sampleRate, m = new Float32Array(n0);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n0; i++) m[i] += d[i] / buf.numberOfChannels; }
  const W = Math.floor(sr * 0.1), nb = Math.floor(n0 / W), rms = new Float32Array(nb);
  for (let b = 0; b < nb; b++) { let s = 0; for (let i = b * W; i < (b + 1) * W; i++) s += m[i] * m[i]; rms[b] = Math.sqrt(s / W); }
  const mx = Math.max(...rms), pk = rms.indexOf(mx); let a = 0, len = Math.min(n0, Math.floor(secs * sr)), peak = 0;
  if (kind === 'shot') { let b = 0; while (b < nb && rms[b] < mx * 0.08) b++; a = Math.max(0, b * W - Math.floor(sr * 0.02)); }
  else if (kind === 'by') { a = Math.max(0, Math.min(n0 - len, pk * W - Math.floor(len * 0.5))); peak = (pk * W - a) / sr; }
  else { // loop: janela com o volume mais constante (menor desvio relativo), longe das pontas do arquivo
    const nw = Math.floor(secs * 10), xf = 5; let best = 1e9;
    for (let b = 10; b + nw + xf < nb - 10; b += 2) { let s = 0, s2 = 0; for (let i = b; i < b + nw; i++) { s += rms[i]; s2 += rms[i] * rms[i]; } const mean = s / nw, cv = Math.sqrt(Math.max(0, s2 / nw - mean * mean)) / (mean + 1e-6) + (mean < mx * 0.35 ? 1 : 0); if (cv < best) { best = cv; a = b * W; } }
  }
  len = Math.min(len, n0 - a); const seg = m.slice(a, a + len);
  if (kind === 'loop') { const xf = Math.floor(sr * 0.5); for (let i = 0; i < xf && a + len + i < n0; i++) { const k = i / xf; seg[i] = seg[i] * Math.sqrt(k) + m[a + len + i] * Math.sqrt(1 - k); } } // o que vem DEPOIS do fim entra por baixo do começo
  else { const fo = Math.floor(sr * (kind === 'by' ? 1.0 : 0.25)); for (let i = 0; i < fo; i++) seg[len - 1 - i] *= i / fo; if (kind === 'by') for (let i = 0; i < fo; i++) seg[i] *= i / fo; }
  const off = new OfflineAudioContext(1, Math.ceil(len * rate / sr), rate), sb = off.createBuffer(1, len, sr); sb.copyToChannel(seg, 0);
  const s = off.createBufferSource(); s.buffer = sb; s.connect(off.destination); s.start(); const r = (await off.startRendering()).getChannelData(0);
  let p = 0; for (const v of r) p = Math.max(p, Math.abs(v)); const g = 0.94 / (p || 1), N = r.length, wav = new DataView(new ArrayBuffer(44 + N * 2));
  const wr = (o, t) => [...t].forEach((ch, i) => wav.setUint8(o + i, ch.charCodeAt(0)));
  wr(0, 'RIFF'); wav.setUint32(4, 36 + N * 2, true); wr(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); wr(36, 'data'); wav.setUint32(40, N * 2, true);
  for (let i = 0; i < N; i++) wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, r[i] * g)) * 32767, true);
  let bin = ''; const u = new Uint8Array(wav.buffer); for (let i = 0; i < u.length; i += 8192) bin += String.fromCharCode(...u.subarray(i, i + 8192));
  return { b64: btoa(bin), dur: N / rate, from: a / sr, srcDur: n0 / sr, peak, gain: g };
}"""
shutil.rmtree(tmp, ignore_errors=True); shutil.copytree(src, tmp); os.makedirs(out, exist_ok=True); meta = {}
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page(); pg.goto('http://localhost:5173/tools/bench.html?glb=none', wait_until='commit')
        for name, plan in PLAN.items():
            if not os.path.exists(os.path.join(tmp, plan[0])): print('falta', plan[0]); continue
            r = pg.evaluate(JS, plan); open(os.path.join(out, name + '.wav'), 'wb').write(base64.b64decode(r['b64']))
            if plan[1] == 'by': meta[name] = {'peak': round(r['peak'], 2)}
            print('%-10s %-4s %5.1f s de %6.1f s (a partir de %5.1f s) ganho %.1f  %d KB' % (name, plan[1], r['dur'], r['srcDur'], r['from'], r['gain'], len(r['b64']) * 3 // 4 // 1024))
        b.close()
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'))
finally: shutil.rmtree(tmp, ignore_errors=True)
