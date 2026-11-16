# Prepara o T-34-85 (Federico Oviedo, CC BY) para o jogo: separa torre do casco por ilhas, decima, põe em metros com
# +z para frente (glTF), chão em y = 0, e exporta GLB com objetos "hull" e "turret". Uso:
#   blender -b --python bl_t34.py -- entrada.glb saida.glb
import bpy, bmesh, sys, math
from mathutils import Matrix, Vector
src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
SCALE = 2.29                       # o arquivo vem em ~0,44 da escala real
RING = (0.80, -2.30)               # centro do anel da torre (x, y do arquivo importado)
DECK = 0.74                        # altura da base da torre
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obs = [o for o in bpy.data.objects if o.type == 'MESH']
# assa a transformação do mundo em cada malha (os pais trazem escala/rotação) e só então junta
bpy.context.view_layer.update()
for o in obs:
    mw = o.matrix_world.copy(); o.parent = None; o.data.transform(mw); o.matrix_world = Matrix.Identity(4)
bpy.ops.object.select_all(action='DESELECT')
for o in obs: o.select_set(True)
bpy.context.view_layer.objects.active = obs[0]
bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active

def split(pred, name):
    me = ob.data; bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    seen = set(); n = 0
    for f in bm.faces: f.select = False
    for v in bm.verts:
        if v.index in seen: continue
        st = [v]; seen.add(v.index); vs = []
        while st:
            a = st.pop(); vs.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen: seen.add(b.index); st.append(b)
        xs = [q.co.x for q in vs]; ys = [q.co.y for q in vs]; zs = [q.co.z for q in vs]
        if pred(min(xs), max(xs), (min(ys) + max(ys)) / 2, min(zs)):
            n += 1
            for q in vs:
                for f in q.link_faces: f.select = True
    bm.to_mesh(me); bm.free()
    before = set(bpy.data.objects)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
    new = [o for o in bpy.data.objects if o not in before][0]; new.name = name
    print(name, 'ilhas', n); return new
# canhão + mantelete: ilhas no eixo do canhão, inteiras à frente da casca da torre (frente = −x)
gun = split(lambda x0, x1, cy, z0: z0 > DECK and abs(cy - RING[1]) < 0.22 and x1 < 0.30, 'gun')
tur = split(lambda x0, x1, cy, z0: z0 > DECK - 0.01 and math.hypot((x0 + x1) / 2 - RING[0], cy - RING[1]) < 0.78, 'turret')
ob.name = 'hull'
for o, ratio in ((ob, 0.24), (tur, 0.5), (gun, 0.6)):
    m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='dec')
    print(o.name, 'tris', sum(len(p.vertices) - 2 for p in o.data.polygons))
T = Matrix.Scale(SCALE, 4) @ Matrix.Rotation(math.radians(90), 4, 'Z')
for o in (ob, tur, gun): o.data.transform(T); o.data.update()
for im in bpy.data.images:
    if im.size[0] > 2048: im.scale(2048, 2048)
bpy.ops.object.select_all(action='DESELECT')
for o in (ob, tur, gun): o.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_image_format='JPEG', export_jpeg_quality=85, export_apply=True, export_yup=True)
print('exportado', dst)
