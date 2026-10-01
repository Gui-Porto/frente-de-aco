import { camera, frameLighting, renderFrame } from '../core/render.js';
import { S, tanks, planes, projs } from '../core/state.js';
import { endFrame } from '../core/settings.js';
import { V3, rv } from '../core/util.js';
import { H } from '../world/terrain.js';
import { world, STEP } from '../world/physics.js';
import { grass, waveFlags } from '../world/scenery.js';
import { Q } from '../core/render.js';
import { updateProjs, updatePopped, segmentHit, raycast, evalArmor, destroyVehicle } from '../combat/ballistics.js';
import { updateParts, fxBurn, spawnP, TEX } from '../fx/particles.js';
import { eng } from '../fx/audio.js';
import { updateMatch, startMatch, spawnPlayer, mkWho, spawnVehicle } from './match.js';
import { controlPlayer } from './controls.js';
import { updateCamera, cam } from './camera.js';
import { updateHUD } from '../ui/hud.js';
import { initMenus, openSpawn } from '../ui/menus.js';
import { B } from '../air/battle.js';
import { updateAirCamera } from '../air/camera.js';
import { updateAirHUD } from '../air/hud.js';
import { updateHangar } from '../air/hangar.js';
import { airAudio } from '../air/sound.js';
import { initAir } from '../air/screens.js';
import { missiles } from '../air/missiles.js';

let acc = 0;
export function simulate(dt) {
  S.now += dt;
  if (S.mode === 'air') B.update(dt); else controlPlayer(dt);
  for (const t of tanks) if (t.brain) t.brain.update(dt);
  for (const p of planes) if (p.brain) p.brain.update(dt);
  for (const t of tanks) { if (t.alive) t.drive(dt); t.updateTurret(dt); t.updateSystems(dt); }
  // física de corpo rígido em passo fixo (suspensão/tração calculadas a cada passo)
  acc += dt; let n = 0;
  while (acc >= STEP && n < 8) { for (const t of tanks) t.prePhysics(); world.step(); acc -= STEP; n++; }
  if (n === 8) acc = 0;
  for (const t of tanks) {
    t.afterPhysics(dt);
    if (!t.alive && t.burnT > 0) { t.burnT -= dt; if ((t.smokeT -= dt) < 0) { t.smokeT = .22; fxBurn(t.centerPos(new V3()).add(rv(1)), 1.2); } }
  }
  for (const p of planes) { p.physics(dt); p.updateWeapons(dt); p.applyTransform(); }
  updateProjs(dt); updatePopped(); updateParts(dt);
  if (S.mode !== 'air' && (S.state === 'play' || S.state === 'spawn' || S.state === 'spectate')) updateMatch(dt);
}

let last = performance.now(), flagT = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (ts - last) / 1000); last = ts;
  if (S.paused) dt = 0; else if (S.state === 'end') dt *= 0.25;
  const menu = S.state === 'menu' || S.state === 'airmenu';
  if (dt > 0 && !menu) simulate(dt);
  else if (menu) updateParts(dt);
  if (S.state === 'airmenu') updateHangar(dt); else if (S.mode === 'air') updateAirCamera(dt); else updateCamera(dt);
  const p = S.player, f = S.state === 'menu' && cam.hangar ? cam.hangar.pos : p && p.alive ? p.pos : S.spectate ? S.spectate.pos : camera.position;
  frameLighting(f, camera.position.y, H(camera.position.x, camera.position.z), S, dt);
  grass.count = Q.grass; grass.update(dt);
  if ((flagT += dt) > 0.05) { waveFlags(S.now + ts / 1000); flagT = 0; }
  // motores
  if (S.mode === 'air' || S.state === 'airmenu') { if (eng.tank) eng.tank.g.gain.value = 0; airAudio(dt || 0.016); }
  else if (eng.tank) {
    const on = p && p.alive && S.state === 'play' && !S.paused && p.type !== 'plane';
    eng.tank.g.gain.value = on ? 0.05 + Math.abs(p.throttle) * 0.03 : 0;
    if (on) { eng.tank.o.frequency.value = 22 + p.rpm / 60; eng.tank.o2.frequency.value = 11 + p.rpm / 120; }
    const pl = p && p.alive && p.type === 'plane' && !S.paused ? p : null;
    let near = pl, nd = 0;
    if (!near) { nd = 1e9; for (const q of planes) { if (!q.alive) continue; const d = q.pos.distanceTo(camera.position); if (d < nd) { nd = d; near = q; } } }
    eng.air.g.gain.value = near && !S.paused && S.state !== 'menu' ? (pl ? 0.06 : 0.12 / (1 + nd / 120)) * (near.engineOn ? 1 : 0.1) : 0;
    if (near) { eng.air.o.frequency.value = 45 + near.throttle * 40 + (near.wep ? 8 : 0); eng.air.o2.frequency.value = eng.air.o.frequency.value / 2; }
  }
  if (S.mode === 'air') updateAirHUD(dt || 0.016); else updateHUD(dt || 0.016);
  renderFrame();
  endFrame();
}
initMenus(); initAir();
// compila todos os shaders agora (evita travadas por compilação no meio da partida)
import('../core/render.js').then(R => { try { R.renderer.compile(R.scene, R.camera); } catch (e) { /* opcional */ } });
requestAnimationFrame(frame);
// gancho para testes automatizados
import * as R from '../core/render.js';
window.__r = R;
window.__game = { B, missiles, spawnP, TEX, S, tanks, planes, projs, simulate, startMatch, spawnPlayer, mkWho, spawnVehicle, openSpawn, segmentHit, raycast, evalArmor, destroyVehicle, world, H, cam };
