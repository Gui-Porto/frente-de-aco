# Prepara um tanque cujo arquivo JÁ vem separado em objetos (casco, torre, esteiras): junta por papel, põe em metros com
# +z para frente (glTF), chão em y = 0, centrado, texturas 2k JPEG. Não decima (o carregador precisa das ilhas da esteira).
#   blender -b --python tools/blender/prep.py -- entrada.glb saida.glb '{"roles": {"Hull1": "hull", ...}, "scale": 1.21, "yaw": 0}'
# roles: prefixo do nome do objeto -> hull | turret | track. yaw (graus, eixo Z do Blender) gira até o canhão apontar para −Y.
import bpy, sys, json, math
from mathutils import Matrix, Vector
src, dst, cfg = sys.argv[sys.argv.index('--') + 1:][:3]; cfg = json.loads(cfg)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
bpy.context.view_layer.update()
groups = {}
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    role = next((r for p, r in cfg['roles'].items() if o.name.startswith(p)), None)
    mw = o.matrix_world.copy(); o.parent = None; o.data.transform(mw); o.matrix_world = Matrix.Identity(4)
    if role: groups.setdefault(role, []).append(o)
    else: print('ignorado', o.name); bpy.data.objects.remove(o)
out = []
for role, obs in groups.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = role; out.append(o)
T = Matrix.Scale(cfg.get('scale', 1), 4) @ Matrix.Rotation(math.radians(cfg.get('yaw', 0)), 4, 'Z')
for o in out: o.data.transform(T)
ref = next(o for o in out if o.name == cfg.get('center', 'track'))
vs = [v.co for v in ref.data.vertices]
cx = (min(v.x for v in vs) + max(v.x for v in vs)) / 2; cy = (min(v.y for v in vs) + max(v.y for v in vs)) / 2; z0 = min(v.z for v in vs)
for o in out:
    o.data.transform(Matrix.Translation((-cx, -cy, -z0))); o.data.update()
    v = [q.co for q in o.data.vertices]
    print('%s tris %d  glTF x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]' % (o.name, sum(len(p.vertices) - 2 for p in o.data.polygons), min(q.x for q in v), max(q.x for q in v), min(q.z for q in v), max(q.z for q in v), -max(q.y for q in v), -min(q.y for q in v)))
for im in bpy.data.images:
    if im.size[0] > 2048: im.scale(2048, 2048)
bpy.ops.object.select_all(action='DESELECT')
for o in out: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_image_format='JPEG', export_jpeg_quality=85, export_apply=True, export_yup=True, export_tangents=False)
print('exportado', dst)
