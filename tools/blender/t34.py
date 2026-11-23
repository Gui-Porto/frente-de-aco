# Prepara o T-34-85 (Federico Oviedo, CC BY) para o jogo. Uso:
#   blender -b --python tools/blender/t34.py -- entrada.glb public/models/t34.glb
# Saída (glTF, metros, +z frente, chão em y = 0, casco centrado): nós
#   hull, turret, gun            — casco, torre e canhão+mantelete
#   wheel_<lado>_<n>             — cada roda (extras: y, z, r no glTF) para girar
#   link_L / link_R              — UM par de sapatas de referência por lado (extras: centers = [y, z, ...] do laço,
#                                  ref = índice da sapata de referência, period = 2: dentada + lisa)
# A malha original é uma coisa só; tudo é classificado por ilhas de triângulos (peças soltas).
import bpy, bmesh, sys, math
from mathutils import Matrix
src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obs = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.context.view_layer.update()
for o in obs:
    mw = o.matrix_world.copy(); o.parent = None; o.data.transform(mw); o.matrix_world = Matrix.Identity(4)
bpy.ops.object.select_all(action='DESELECT')
for o in obs: o.select_set(True)
bpy.context.view_layer.objects.active = obs[0]
bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
# escala real (o arquivo vem em 0,44), canhão para −Y do Blender (= +z do glTF), casco centrado
ob.data.transform(Matrix.Translation((-5.265, -2.115, 0)) @ Matrix.Scale(2.29, 4) @ Matrix.Rotation(math.radians(90), 4, 'Z'))
RING_Y, DECK = -0.283, 1.695          # centro do anel (Y) e altura da base da torre

me = ob.data; bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
grp = bm.faces.layers.int.new('grp')
seen = set(); isl = []
for v in bm.verts:
    if v.index in seen: continue
    st = [v]; seen.add(v.index); vs = []
    while st:
        a = st.pop(); vs.append(a)
        for e in a.link_edges:
            b = e.other_vert(a)
            if b.index not in seen: seen.add(b.index); st.append(b)
    xs = [q.co.x for q in vs]; ys = [q.co.y for q in vs]; zs = [q.co.z for q in vs]
    isl.append({'vs': vs, 'mn': (min(xs), min(ys), min(zs)), 'mx': (max(xs), max(ys), max(zs))})
for i in isl:
    i['c'] = tuple((a + b) / 2 for a, b in zip(i['mn'], i['mx'])); i['sz'] = tuple(b - a for a, b in zip(i['mn'], i['mx'])); i['g'] = 0
def tag(i, g):
    i['g'] = g
    for q in i['vs']:
        for f in q.link_faces: f[grp] = g
G_GUN, G_TUR = 1, 2
names = {0: 'hull', G_GUN: 'gun', G_TUR: 'turret'}; extras = {}
for i in isl:
    if i['mn'][2] > DECK and abs(i['c'][0]) < 0.5 and i['mx'][1] < -1.43: tag(i, G_GUN)
    elif i['mn'][2] > DECK - 0.02 and math.hypot(i['c'][0], i['c'][1] - RING_Y) < 1.79: tag(i, G_TUR)
# ---- trem de rolamento: fora dos lados do casco e abaixo dos para-lamas ----
nextg = 3
for side, sn in ((1, 'L'), (-1, 'R')):
    zone = [i for i in isl if i['g'] == 0 and i['c'][0] * side > 0.92 and i['mx'][2] < 1.15]
    # sapatas: quase a largura toda da esteira e finas; ordenadas em volta do centro do laço (plano YZ)
    pl = [i for i in zone if 0.40 < i['sz'][0] < 0.56 and math.hypot(i['sz'][1], i['sz'][2]) < 0.30]
    cy = sum(i['c'][1] for i in pl) / len(pl); cz = sum(i['c'][2] for i in pl) / len(pl)
    pl.sort(key=lambda i: math.atan2(i['c'][2] - cz, i['c'][1] - cy))
    N = len(pl); print(sn, 'sapatas', N, 'zona', len(zone))
    # rodas: discos (iguais em Y e Z), centradas; depois as miudezas que cabem no disco
    discs = [i for i in zone if i not in pl and abs(i['sz'][1] - i['sz'][2]) < 0.06 and i['sz'][1] > 0.45]
    axles = []
    for d in discs:
        for a in axles:
            if math.hypot(d['c'][1] - a['y'], d['c'][2] - a['z']) < 0.05: a['r'] = max(a['r'], d['sz'][1] / 2); break
        else: axles.append({'y': d['c'][1], 'z': d['c'][2], 'r': d['sz'][1] / 2, 'g': 0})
    for a in axles: a['g'] = nextg; nextg += 1
    ref = min((k for k in range(N) if pl[k]['c'][2] < cz), key=lambda k: abs(pl[k]['c'][1] - cy))
    ref -= ref % 2  # o par (ref, ref+1) é a unidade que se repete
    g_link = nextg; nextg += 1
    for i in zone:
        k = min(range(N), key=lambda k: math.hypot(i['c'][1] - pl[k]['c'][1], i['c'][2] - pl[k]['c'][2]))
        dk = math.hypot(i['c'][1] - pl[k]['c'][1], i['c'][2] - pl[k]['c'][2])
        if dk < 0.14 and abs(i['c'][0] - pl[k]['c'][0]) < 0.45:
            tag(i, g_link if k in (ref, (ref + 1) % N) else -1)       # −1: elo repetido, descartado (vira instância)
            continue
        a = min(axles, key=lambda a: math.hypot(i['c'][1] - a['y'], i['c'][2] - a['z']))
        wd = math.hypot(i['c'][1] - a['y'], i['c'][2] - a['z'])
        far = max(math.hypot(y - a['y'], z - a['z']) for y in (i['mn'][1], i['mx'][1]) for z in (i['mn'][2], i['mx'][2]))
        if far < a['r'] + 0.02 and (wd < 0.04 or math.hypot(*i['sz']) < 0.22): tag(i, a['g'])
    for n, a in enumerate(axles):
        names[a['g']] = 'wheel_%s_%d' % (sn, n); extras[a['g']] = {'y': a['z'], 'z': -a['y'], 'r': a['r'], 'side': side}
    names[g_link] = 'link_' + sn
    cen = []
    for i in pl: cen += [round(i['c'][2], 4), round(-i['c'][1], 4)]       # glTF: y = Z do Blender, z = −Y
    extras[g_link] = {'centers': cen, 'ref': ref, 'period': 2, 'side': side}
    print(sn, 'rodas', len(axles), 'ref', ref)
# apaga os elos repetidos e grava
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[grp] == -1], context='FACES')
bm.to_mesh(me); bm.free()
RATIO = {'hull': 0.24, 'turret': 0.5, 'gun': 0.6, 'wheel': 0.3, 'link': 0.45}
out = []
for g in sorted(names, reverse=True):
    if g == 0: continue
    bm = bmesh.new(); bm.from_mesh(ob.data); L = bm.faces.layers.int['grp']
    any_ = False
    for f in bm.faces: f.select = f[L] == g; any_ = any_ or f.select
    bm.to_mesh(ob.data); bm.free()
    if not any_: print('vazio', names[g]); continue
    before = set(bpy.data.objects); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
    new = [o for o in bpy.data.objects if o not in before][0]; new.name = names[g]
    for k, v in extras.get(g, {}).items(): new[k] = v
    out.append(new)
ob.name = 'hull'; out.append(ob)
for o in out:
    m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = RATIO[o.name.split('_')[0]]
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='dec')
    print(o.name, 'tris', sum(len(p.vertices) - 2 for p in o.data.polygons))
for im in bpy.data.images:
    if im.size[0] > 2048: im.scale(2048, 2048)
bpy.ops.object.select_all(action='DESELECT')
for o in out: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_image_format='JPEG', export_jpeg_quality=85, export_apply=True, export_yup=True, export_extras=True)
print('exportado', dst)
