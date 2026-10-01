import RAPIER from '@dimforge/rapier3d-compat';
import { H, INNER } from './terrain.js';

// Rapier precisa de RAPIER.init() antes deste módulo ser importado (feito em main.js).
export { RAPIER };
export const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 120;
export const STEP = 1 / 120;

// Grupos de colisão: estático, veículo, destroço
export const GROUP = { STATIC: 0x0001, VEH: 0x0002, DEBRIS: 0x0004, TERRAIN: 0x0008 };
const groups = (member, filter) => (member << 16) | filter;
export const COL = {
  static: groups(GROUP.STATIC, GROUP.VEH | GROUP.DEBRIS),
  terrain: groups(GROUP.TERRAIN, GROUP.VEH | GROUP.DEBRIS),
  veh: groups(GROUP.VEH, GROUP.STATIC | GROUP.TERRAIN | GROUP.VEH | GROUP.DEBRIS),
  // parte baixa do casco (altura das lagartas): bate em muros/rochas, mas o terreno é tratado pela suspensão
  vehLow: groups(GROUP.VEH, GROUP.STATIC | GROUP.VEH | GROUP.DEBRIS),
  debris: groups(GROUP.DEBRIS, GROUP.STATIC | GROUP.TERRAIN | GROUP.VEH | GROUP.DEBRIS),
};

// Terreno da área de combate como heightfield (armazenamento em coluna: índice = linha + coluna·(nrows+1))
{
  const n = 300, size = INNER, heights = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = -size / 2 + (j / n) * size, z = -size / 2 + (i / n) * size;
    heights[i + j * (n + 1)] = H(x, z);
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size }).setFriction(0.8).setCollisionGroups(COL.terrain), body);
}
const fixedBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
export function addStaticBox(cx, cy, cz, hx, hy, hz, rotY = 0) {
  const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setFriction(0.7).setCollisionGroups(COL.static);
  if (rotY) d.setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
  return world.createCollider(d, fixedBody);
}
export function removeBody(b) { if (b) world.removeRigidBody(b); }
