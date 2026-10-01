'use strict';
// =====================================================================
// HUD: rótulos, mensagens, hit-cam raio-X, minimapa, painéis, placar
// =====================================================================
let shake = 0;
function shakeCam(s) { shake = Math.max(shake, s); }
function shakeAt(pos, s, r) { const d = camera.position.distanceTo(pos); if (d < r) shakeCam(s * (1 - d / r)); }
function makeLabel(v) {
  const el = document.createElement('div'); el.className = 'lbl ' + (v.team === 1 ? 'a' : 'e');
  const D = v.def, nm = D.short || D.name;
  el.textContent = v.isPlayer ? '' : (v.team === 1 && v.who ? `${v.who.name} · ${nm}` : nm);
  $('#labels').appendChild(el); return el;
}
const hitEl = $('#hitmsg'), dmgEl = $('#dmgmsg'); let hitTO, dmgTO, vignTO, hmTO;
function report(target, word, detail, color) {
  hitEl.querySelector('b').textContent = word; hitEl.querySelector('b').style.color = `var(--${color})`;
  hitEl.querySelector('span').textContent = (target.def.short || target.def.name) + ' · ' + detail;
  hitEl.style.opacity = 1; clearTimeout(hitTO); hitTO = setTimeout(() => hitEl.style.opacity = 0, 2800);
}
function showDmg(text, mild) { dmgEl.textContent = text; dmgEl.style.color = mild ? 'var(--khaki)' : 'var(--enemy)'; dmgEl.style.opacity = 1; clearTimeout(dmgTO); dmgTO = setTimeout(() => dmgEl.style.opacity = 0, 2800); }
function flashVign() { $('#vign').style.opacity = 1; clearTimeout(vignTO); vignTO = setTimeout(() => $('#vign').style.opacity = 0, 350); }
function hitMarker() { const h = $('#hitx'); h.style.opacity = 1; clearTimeout(hmTO); hmTO = setTimeout(() => h.style.opacity = 0, 160); }

// ---------- Hit-cam raio-X (vista 3D esquemática do interior do alvo) ----------
let xray = null;
const xc = $('#xray'), xctx = xc.getContext('2d');
function xrayShot(t, hit, dir, E, am, word, detail, color, inner) {
  report(t, word, detail, color);
  const lp = hit.part === 'hull' ? hit.lp : hit.point.clone().applyMatrix4(t.invRoot).toArray();
  const ld = dir.clone().transformDirection(t.invRoot);
  const ent = inner ? inner.lp : lp;
  const pre = [ent[0] - ld.x * 3, ent[1] - ld.y * 3, ent[2] - ld.z * 3];
  xray = { t0: performance.now(), def: t.def, ty: t.turretYaw, turret: t.turretOn, entry: ent, pre, end: inner ? inner.end : null, frags: inner ? inner.frags : [], blast: inner ? inner.blast : null,
    comps: inner ? inner.comps.map((c, i) => ({ p: c.p, r: c.r, kind: c.kind, label: compLabel(c), was: inner.before[i], now: c.kind === 'crew' ? c.ref.alive : !(c.name in t.mods) || !t.mods[c.name].broken })) : t.components().map(c => ({ p: c.p, r: c.r, kind: c.kind, was: true, now: true })),
    word, color, ammo: `${am.name} · ${Math.round(E.pen)} mm`, plate: `${E.arm.t} mm · ${Math.round(E.ang)}° → ${Math.round(E.eff)} mm` };
  xc.hidden = false;
}
function xrayReport(r) {
  report(r.t, r.w, r.s, r.c);
  if (!r.x) return;
  const t = r.t;
  xray = { t0: performance.now(), def: t.def, ty: t.turretYaw, turret: t.turretOn, entry: r.x.lp, pre: [r.x.lp[0], r.x.lp[1] + 3, r.x.lp[2]], end: null, frags: r.x.frags, blast: r.x.blast,
    comps: r.x.comps.map((c, i) => ({ p: c.p, r: c.r, kind: c.kind, label: compLabel(c), was: r.x.before[i], now: c.kind === 'crew' ? c.ref.alive : !(c.name in t.mods) || !t.mods[c.name].broken })),
    word: r.w, color: r.c, ammo: 'Alto-explosivo', plate: r.s.split(' · ').slice(1, 2).join('') };
  xc.hidden = false;
}
function drawXray() {
  if (!xray) return;
  const el = (performance.now() - xray.t0) / 1000;
  if (el > 4.2) { xray = null; xc.hidden = true; return; }
  const W = xc.width, Hh = xc.height, c = xctx, D = xray.def;
  c.clearRect(0, 0, W, Hh);
  c.fillStyle = 'rgba(8,14,18,.92)'; c.fillRect(0, 0, W, Hh);
  const yaw = 0.7 + el * 0.25, pit = 0.42, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  const sc = Math.min(W, Hh) / (D.L * 1.25), ox = W / 2, oy = Hh * 0.58;
  const P = (x, y, z) => { y -= D.clr + D.Hh * 0.5; const X = x * cy - z * sy, Z = x * sy + z * cy; const Y = y * cp - Z * sp; return [ox + X * sc, oy - Y * sc, Z * cp + y * sp]; };
  const box = (mn, mx, tf) => {
    const v = []; for (const x of [mn[0], mx[0]]) for (const y of [mn[1], mx[1]]) for (const z of [mn[2], mx[2]]) v.push(P(...(tf ? tf(x, y, z) : [x, y, z])));
    const e = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    c.beginPath(); for (const [a, b] of e) { c.moveTo(v[a][0], v[a][1]); c.lineTo(v[b][0], v[b][1]); } c.stroke();
  };
  c.strokeStyle = 'rgba(120,190,220,.55)'; c.lineWidth = 1;
  // casco pelo perfil real
  const pr = hullProfile(D), hw = (D.W - 2 * D.trackW) / 2;
  c.beginPath();
  for (const s of [hw, -hw]) pr.forEach(([z, y], i) => { const q = P(s, y, z); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); if (i === pr.length - 1) { const q0 = P(s, pr[0][1], pr[0][0]); c.lineTo(q0[0], q0[1]); } });
  for (const [z, y] of pr) { const a = P(hw, y, z), b = P(-hw, y, z); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
  c.stroke();
  c.strokeStyle = 'rgba(120,190,220,.3)';
  box([-D.W / 2, 0.05, -D.L * .47], [-D.W / 2 + D.trackW, D.clr + .45, D.L * .47]); box([D.W / 2 - D.trackW, 0.05, -D.L * .47], [D.W / 2, D.clr + .45, D.L * .47]);
  if (xray.turret) {
    const T = D.turret, yH = D.clr + D.Hh, ct = Math.cos(xray.ty), st = Math.sin(xray.ty);
    c.strokeStyle = 'rgba(120,190,220,.55)';
    box([-T.w / 2, 0, -T.l / 2], [T.w / 2, T.h, T.l / 2], (x, y, z) => [x * ct + z * st, yH + y, -x * st + z * ct + T.z]);
    const g0 = P(T.l / 2 * st, yH + T.h / 2, T.l / 2 * ct + T.z), g1 = P((T.l / 2 + D.gun.len) * st, yH + T.h / 2, (T.l / 2 + D.gun.len) * ct + T.z);
    c.lineWidth = 2; c.beginPath(); c.moveTo(g0[0], g0[1]); c.lineTo(g1[0], g1[1]); c.stroke(); c.lineWidth = 1;
  }
  // componentes ordenados por profundidade
  const k = clamp((el - 0.6) / 0.8, 0, 1);
  const comps = xray.comps.map(o => ({ o, q: P(...o.p) })).sort((a, b) => b.q[2] - a.q[2]);
  for (const { o, q } of comps) {
    const hitNow = o.was && !o.now && k > 0.5;
    c.fillStyle = hitNow ? 'rgba(230,70,50,.95)' : o.now ? (o.kind === 'crew' ? 'rgba(110,200,110,.85)' : 'rgba(170,170,160,.7)') : 'rgba(120,40,30,.8)';
    c.beginPath(); c.arc(q[0], q[1], Math.max(3, o.r * sc * 0.55), 0, 7); c.fill();
  }
  // trajetória do projétil
  const s = clamp(el / 0.6, 0, 1), a = P(...xray.pre), b = P(...xray.entry);
  c.strokeStyle = '#ffd08a'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(lerp(a[0], b[0], s), lerp(a[1], b[1], s)); c.stroke();
  if (s >= 1 && xray.end) { const e = P(...xray.end); c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(lerp(b[0], e[0], k), lerp(b[1], e[1], k)); c.stroke(); }
  if (k > 0) {
    c.strokeStyle = 'rgba(255,170,80,.75)'; c.lineWidth = 1; c.beginPath();
    for (const [f0, f1] of xray.frags) { const p0 = P(...f0), p1 = P(...f1); c.moveTo(p0[0], p0[1]); c.lineTo(lerp(p0[0], p1[0], k), lerp(p0[1], p1[1], k)); }
    c.stroke();
    if (xray.blast && k < 0.7) { const q = P(...xray.blast); c.fillStyle = `rgba(255,180,80,${0.7 - k})`; c.beginPath(); c.arc(q[0], q[1], 10 + k * 30, 0, 7); c.fill(); }
  }
  c.fillStyle = '#ddd6b7'; c.font = '600 13px "Barlow Condensed", sans-serif'; c.textAlign = 'left';
  c.fillText(`${D.short || D.name}`, 10, 18);
  c.font = '500 11px "IBM Plex Mono", monospace'; c.fillStyle = 'rgba(221,214,183,.75)';
  c.fillText(xray.ammo, 10, Hh - 26); c.fillText(xray.plate || '', 10, Hh - 11);
  c.textAlign = 'right'; c.font = '400 18px "Saira Stencil One", sans-serif';
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--' + xray.color);
  c.fillText(xray.word, W - 10, 22);
  const lost = xray.comps.filter(o => o.was && !o.now && o.label).map(o => o.label);
  if (k > 0.5 && lost.length) { c.font = '500 11px "IBM Plex Mono", monospace'; c.fillStyle = '#e65a42'; lost.slice(0, 5).forEach((l, i) => c.fillText(l, W - 10, 42 + i * 14)); }
}

// ---------- Mensagens de abate ----------
function addFeed(k, v, cause) {
  if (state === 'menu') return;
  const d = document.createElement('div');
  const nm = t => `<span class="${t.team === 1 ? 'a' : 'e'}">${t.isPlayer ? 'Você' : (t.who ? t.who.name : '')} (${t.def.short || t.def.name})</span>`;
  const verb = { ammo: ' detonou ', crew: ' abateu ', fire: ' incendiou ', pilot: ' matou o piloto de ', wing: ' arrancou a asa de ', tail: ' destruiu a cauda de ', structure: ' derrubou ', crash: ' derrubou ' }[cause] || ' destruiu ';
  const self = { oob: ' abandonou a área de combate', flip: ' capotou', crash: ' caiu', overg: ' quebrou a asa por excesso de G', vne: ' excedeu a velocidade máxima', fire: ' queimou' }[cause] || ' foi destruído';
  d.innerHTML = k ? `${nm(k)}${verb}${nm(v)}` : `${nm(v)}${self}`;
  $('#feed').prepend(d); setTimeout(() => d.remove(), 8000);
  while ($('#feed').children.length > 6) $('#feed').lastChild.remove();
}

// ---------- Minimapa com grade ----------
const mini = $('#mini'), mctx = mini.getContext('2d');
const MMBASE = 1600, mmBase = document.createElement('canvas'); mmBase.width = mmBase.height = 640;
{
  const g = mmBase.getContext('2d'), img = g.createImageData(640, 640), s = 640 / (MMBASE * 2), c = new THREE.Color();
  for (let j = 0; j < 640; j++) for (let i = 0; i < 640; i++) {
    const x = i / s - MMBASE, z = j / s - MMBASE, h = H(x, z), sl = H(x + 4, z) - H(x, z);
    groundColor(x, z, c);
    const sh = 1 + sl * 0.25, o = (j * 640 + i) * 4;
    img.data[o] = clamp(Math.sqrt(c.r) * 255 * sh, 0, 255); img.data[o + 1] = clamp(Math.sqrt(c.g) * 255 * sh, 0, 255); img.data[o + 2] = clamp(Math.sqrt(c.b) * 255 * sh, 0, 255); img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#b3ab98'; for (const b of OBST) g.fillRect((b.mn[0] + MMBASE) * s, (b.mn[2] + MMBASE) * s, Math.max(1, (b.mx[0] - b.mn[0]) * s), Math.max(1, (b.mx[2] - b.mn[2]) * s));
  g.fillStyle = 'rgba(20,35,15,.7)'; for (const t of TREES) g.fillRect((t.x + MMBASE) * s - 1, (t.z + MMBASE) * s - 1, 2, 2);
  g.strokeStyle = 'rgba(15,30,10,.8)'; g.lineWidth = 1.5; for (const h of HEDGES) { g.strokeRect((h.mn[0] + MMBASE) * s, (h.mn[2] + MMBASE) * s, (h.mx[0] - h.mn[0]) * s, (h.mx[2] - h.mn[2]) * s); }
}
function drawMini(viewer, air) {
  const R = air ? 1500 : 390, W = 210, s = W / (R * 2), cx = air ? 0 : 0, cz = 0;
  const bs = 640 / (MMBASE * 2);
  mctx.drawImage(mmBase, (cx - R + MMBASE) * bs, (cz - R + MMBASE) * bs, R * 2 * bs, R * 2 * bs, 0, 0, W, W);
  const X = x => (x - cx + R) * s, Z = z => (z - cz + R) * s;
  // grade estilo carta militar
  mctx.strokeStyle = 'rgba(0,0,0,.35)'; mctx.lineWidth = 1; mctx.font = '600 10px "Barlow Condensed", sans-serif'; mctx.fillStyle = 'rgba(230,225,200,.7)';
  const cell = air ? 400 : 100; const n = Math.round(R * 2 / cell);
  for (let i = 0; i <= n; i++) {
    const p = i * W / n;
    mctx.beginPath(); mctx.moveTo(p, 0); mctx.lineTo(p, W); mctx.moveTo(0, p); mctx.lineTo(W, p); mctx.stroke();
    if (i < n) { mctx.fillText(String.fromCharCode(65 + i), p + 2, 9); mctx.fillText(String(i + 1), 2, p + 18); }
  }
  // área de combate terrestre
  if (air) { mctx.strokeStyle = 'rgba(230,90,66,.6)'; mctx.strokeRect(X(-LIMIT), Z(-LIMIT), LIMIT * 2 * s, LIMIT * 2 * s); }
  mctx.textAlign = 'center'; mctx.textBaseline = 'middle'; mctx.font = '600 12px "Barlow Condensed", sans-serif';
  for (const p of POINTS) {
    mctx.strokeStyle = p.owner === 1 ? '#6db4e3' : p.owner === -1 ? '#e65a42' : '#ddd6b7'; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(X(p.x), Z(p.z), Math.max(4, p.r * s + 2), 0, 7); mctx.stroke(); mctx.fillStyle = mctx.strokeStyle; mctx.fillText(p.id, X(p.x), Z(p.z));
  }
  mctx.textAlign = 'left'; mctx.textBaseline = 'alphabetic';
  for (const t of tanks) {
    if (t === viewer) continue;
    if (!(t.team === 1 || t.spottedUntil > now)) continue;
    mctx.fillStyle = !t.alive ? '#555' : t.team === 1 ? '#6db4e3' : '#e65a42';
    mctx.fillRect(X(t.pos.x) - 2.5, Z(t.pos.z) - 2.5, 5, 5);
  }
  for (const p of planes) {
    if (p === viewer || p.gone) continue;
    if (!(p.team === 1 || p.spottedUntil > now)) continue;
    const yaw = Math.atan2(p.vel.x, p.vel.z);
    mctx.save(); mctx.translate(X(p.pos.x), Z(p.pos.z)); mctx.rotate(-yaw + Math.PI);
    mctx.fillStyle = !p.alive ? '#555' : p.team === 1 ? '#6db4e3' : '#e65a42';
    mctx.beginPath(); mctx.moveTo(0, -6); mctx.lineTo(5, 4); mctx.lineTo(-5, 4); mctx.closePath(); mctx.fill(); mctx.restore();
  }
  if (viewer) {
    const x = X(viewer.pos.x), z = Z(viewer.pos.z);
    mctx.fillStyle = 'rgba(221,214,183,.12)'; mctx.beginPath(); mctx.moveTo(x, z);
    const a = Math.atan2(Math.cos(cam.yaw), Math.sin(cam.yaw)), fov = cam.sniper ? cam.fov * DEG : .9;
    mctx.arc(x, z, 40, a - fov / 2, a + fov / 2); mctx.fill();
    const yaw = viewer.type === 'plane' ? Math.atan2(viewer.vel.x, viewer.vel.z) : yawOf(viewer);
    mctx.save(); mctx.translate(x, z); mctx.rotate(-yaw + Math.PI);
    mctx.fillStyle = '#efa53c'; mctx.beginPath(); mctx.moveTo(0, -7); mctx.lineTo(4.5, 5); mctx.lineTo(-4.5, 5); mctx.closePath(); mctx.fill(); mctx.restore();
  }
}

// ---------- Painéis ----------
function buildTankPanel(t) {
  $('#tankPanel').hidden = false; $('#planePanel').hidden = true;
  $('#pName').textContent = t.def.short || t.def.name;
  $('#pCrew').innerHTML = t.crew.map(c => `<span class="chip" title="${c.label}">${c.short}</span>`).join('');
  $('#pMods').innerHTML = Object.keys(MODS).map(k => `<span class="chip">${MODS[k][0]}</span>`).join('');
  $('#pAmmo').innerHTML = t.gun.ammo.map((a, i) => `<div><span>${i + 1} · ${a.name} <small>${a.type}</small></span><span class="mono"><i class="cnt"></i> · ${a.type === 'HE' ? Math.round(hePen(a.tnt)) : a.pen} mm</span></div>`).join('')
    + (t.def.mg ? `<div class="mg"><span>Espaço · ${t.def.mg.name}</span><span class="mono"><i class="cnt"></i></span></div>` : '');
}
function buildPlanePanel(p) {
  $('#tankPanel').hidden = true; $('#planePanel').hidden = false;
  $('#aName').textContent = p.def.short;
}
function updateTankPanel(t) {
  $('#pSpeed').textContent = `${Math.round(Math.abs(t.vFwd) * 3.6)} km/h`;
  $('#pGear').textContent = t.gear < 0 ? 'R' : Math.abs(t.vFwd) < 0.2 && Math.abs(t.throttle) < 0.05 ? 'N' : String(t.gear);
  $('#pRpm').textContent = `${Math.round(t.rpm / 10) * 10} rpm`;
  [...$('#pCrew').children].forEach((c, i) => { const cr = t.crew[i]; const rep = Object.values(t.replace).some(r => r.spare === cr); c.className = 'chip' + (!cr.alive ? ' dead' : rep ? ' warn' : ''); });
  [...$('#pMods').children].forEach((c, i) => { const k = Object.keys(MODS)[i], m = t.mods[k]; c.className = 'chip' + (m.broken ? ' dead' : ''); c.textContent = m.label + (m.broken ? ' ' + Math.ceil(m.rep) + 's' : ''); });
  const rows = [...$('#pAmmo').children];
  rows.forEach((c, i) => {
    if (c.classList.contains('mg')) { c.querySelector('.cnt').textContent = t.mgReload > 0 ? `recarregando ${t.mgReload.toFixed(0)} s` : `${t.mgBelt} / ${t.mgAmmo}`; return; }
    c.className = i === t.sel ? 'sel' : ''; c.querySelector('.cnt').textContent = t.ammoLeft[i];
  });
  const g = t.gun, ready = t.loaded >= 0, frac = ready ? (g.auto ? t.clip / g.clip : 1) : 1 - t.reload / g.reload;
  $('#pReload').style.width = frac * 100 + '%'; $('#pReloadBox').className = 'reload' + (ready ? ' ready' : '');
  $('#pReloadT').textContent = !t.alive ? 'destruído' : t.mods.breech.broken ? 'culatra danificada' : !t.seat('gunner').alive ? 'sem atirador' : ready ? (g.auto ? `pente ${t.clip} / ${g.clip}` : `carregado · ${g.ammo[t.loaded].name}`) : `recarregando ${t.reload.toFixed(1)} s`;
  $('#pFire').hidden = !(t.fire > 0);
  const cc = $('#compass').getContext('2d'); cc.clearRect(0, 0, 58, 58); cc.save(); cc.translate(29, 29);
  cc.rotate(-(yawOf(t) - cam.yaw)); cc.strokeStyle = '#ddd6b7'; cc.lineWidth = 1.5; cc.strokeRect(-5, -10, 10, 20);
  cc.rotate(-t.turretYaw); cc.fillStyle = '#efa53c'; cc.fillRect(-1.2, -20, 2.4, 18); cc.beginPath(); cc.arc(0, 0, 5, 0, 7); cc.fill(); cc.restore();
}
function updatePlanePanel(p) {
  $('#aIas').textContent = Math.round(p.ias * 3.6);
  $('#aAlt').textContent = Math.round(p.pos.y);
  $('#aThr').textContent = p.wep ? 'WEP' : Math.round(p.throttle * 100) + '%';
  $('#aThr').className = 'mono' + (p.wep ? ' warn' : '');
  $('#aG').textContent = p.n.toFixed(1);
  $('#aTemp').textContent = Math.round(p.temp) + ' °C'; $('#aTemp').className = 'mono' + (p.temp > 110 ? ' bad' : p.temp > 100 ? ' warn' : '');
  $('#aGuns').innerHTML = p.guns.map(g => `<div><span>${g.W.name}</span><span class="mono">${g.ammo}</span></div>`).join('')
    + (p.def.bombs.length ? `<div><span>Espaço · bombas (${p.def.bombs.map(b => b.name).join(', ')})</span><span class="mono">${p.bombs.length}</span></div>` : '')
    + (p.def.rockets ? `<div><span>X · ${p.def.rockets.name}</span><span class="mono">${p.rockets}</span></div>` : '');
  const parts = [['wingL', 'Asa E'], ['wingR', 'Asa D'], ['tail', 'Cauda'], ['engine', 'Motor'], ['fuel', 'Tanques'], ['fuse', 'Fuselagem']];
  $('#aParts').innerHTML = parts.map(([k, l]) => { const f = p.hp[k] / p.maxHp[k]; return `<span class="chip${f <= 0 ? ' dead' : f < .5 ? ' warn' : ''}">${l}</span>`; }).join('') + (p.fire > 0 ? '<span class="chip dead">FOGO</span>' : '') + (p.oil > 0 ? '<span class="chip warn">ÓLEO</span>' : '');
  $('#gdark').style.opacity = clamp(p.gStress - 0.3, 0, 1) * 0.92;
}

// ---------- Placar (Tab) ----------
function drawScore() {
  const rows = team => roster.filter(w => w.team === team).sort((a, b) => b.score - a.score)
    .map(w => `<tr class="${w.isPlayer ? 'me' : ''}"><td>${w.name}</td><td>${w.veh ? (VEHICLES[w.veh].short || VEHICLES[w.veh].name) : '—'}</td><td class="mono">${w.kills}</td><td class="mono">${w.airKills}</td><td class="mono">${w.deaths}</td><td class="mono">${w.score}</td></tr>`).join('');
  const head = '<tr><th>Nome</th><th>Veículo</th><th>Terrestres</th><th>Aéreos</th><th>Mortes</th><th>Pontos</th></tr>';
  $('#scoreA').innerHTML = head + rows(1); $('#scoreE').innerHTML = head + rows(-1);
}
