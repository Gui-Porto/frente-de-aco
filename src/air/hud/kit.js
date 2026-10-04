import { $, clamp } from '../../core/util.js';
// =====================================================================
// Kit de desenho da HUD aérea: canvas, tamanho da tela e primitivas.
// Os painéis importam daqui (V.W/V.H mudam a cada quadro).
// =====================================================================
export const cv = $('#airhud'), g = cv.getContext('2d');
export const V = { W: 0, H: 0, dpr: 1, blink: 0 };
export const C = { green: '#6cff7a', greenD: 'rgba(108,255,122,.6)', white: '#eef1ec', out: 'rgba(0,0,0,.8)', ink: 'rgba(8,11,9,.62)', ph: '#e9dfb4', phd: 'rgba(233,223,180,.55)', amber: '#efa53c', enemy: '#e65a42', ally: '#6db4e3', sky: '#8fb7cf', ok: '#93cf6c' };
export const MONO = '"IBM Plex Mono", ui-monospace, monospace', UI = '"Barlow Condensed", "Arial Narrow", sans-serif';

export const glow = (c, b = 6) => { g.shadowColor = c; g.shadowBlur = b; };
export function txt(s, x, y, size = 13, col = C.ph, align = 'left', font = MONO) { g.font = `500 ${size}px ${font}`; g.fillStyle = col; g.textAlign = align; g.fillText(s, x, y); }
// texto com contorno escuro (legível sobre céu claro e nuvens)
export function otxt(s, x, y, size = 15, col = C.white, align = 'left', font = UI, weight = 600) {
  g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.shadowBlur = 0;
  g.lineWidth = 3; g.strokeStyle = C.out; g.lineJoin = 'round'; g.strokeText(s, x, y);
  g.fillStyle = col; g.fillText(s, x, y);
}
// texto sobre placa (fundo já dá contraste): sem contorno, que embaça em corpo pequeno
export function ptxt(s, x, y, size = 13, col = C.white, align = 'left', font = UI, weight = 600) {
  g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.shadowBlur = 0; g.fillStyle = col; g.fillText(s, x, y);
}
export function gstroke(w = 1.6, col = C.green) { g.shadowBlur = 0; g.lineWidth = w + 2.2; g.strokeStyle = C.out; g.stroke(); g.lineWidth = w; g.strokeStyle = col; g.stroke(); }
export const fmtD = d => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1).replace('.', ',')} km`);
export const dec = (v, n = 1) => v.toFixed(n).replace('.', ',');
// placa de painel: chanfro no canto superior esquerdo, borda fina na cor do tema
export function plate(x, y, w, h, T, cut = 14) {
  g.shadowBlur = 0; g.beginPath();
  g.moveTo(x + cut, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.lineTo(x, y + cut); g.closePath();
  const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, T.plate0); gr.addColorStop(1, T.plate1);
  g.fillStyle = gr; g.fill(); g.lineWidth = 1; g.strokeStyle = T.edge; g.stroke();
  g.fillStyle = T.accent; g.fillRect(x + cut + 6, y - 1, 26, 2);
}
export const fade = (t, k) => clamp(Math.exp(-t / k), 0, 1);
