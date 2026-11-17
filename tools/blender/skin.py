# Prepara a "pele" glTF de uma aeronave (def.skin): o modelo de terceiros vira 4 nós — fuse, wingL, wingR, tail — que o
# jogo pendura na estrutura procedural (trem, armas, cabine, dano e hélice continuam sendo os do jogo).
#   blender -b --python tools/blender/skin.py -- entrada.(blend|glb) saida.glb '<json>'
# json: nose: eixo do nariz no arquivo ('+X', '-Y', ...)   span: envergadura real (m)   center: [lateral, vertical] da
#       linha de centro no arquivo (antes da escala)   cg: posição longitudinal do CG no arquivo
#       drop: objetos que saem (trem, hélice, chão): nome exato, ou prefixo terminado em *   tail: prefixos que vão para a cauda
#       wings: { obj: prefixo do objeto que traz as asas fundidas à fuselagem, root: meia-largura da fuselagem (m, já na
#                escala final), zmin: z a partir do qual é asa (o que fica atrás é cauda/fuselagem) }
#       wingObjs: prefixos de objetos que são da asa inteiros (ailerons, flaps): o lado sai do centro do objeto
#       colors: { material: [r, g, b] } para materiais sem textura   dropMats: [materiais] cujas peças saem
#       wings.obj = '*': arquivo sem peças nomeadas — junta tudo e separa só por geometria; wings.ymax: acima disso não é
#       asa (motores em casulo); tailZ: tudo atrás desse z vira cauda
# Saída em metros, +z nariz, +y cima, +x asa esquerda, origem no CG na linha de centro.
import bpy, bmesh, sys, json, math
from mathutils import Matrix, Vector
src, dst, cfg = sys.argv[sys.argv.index('--') + 1:][:3]; cfg = json.loads(cfg)
dropped = lambda n: any(n == p or (p.endswith('*') and n.startswith(p[:-1])) for p in cfg.get('drop', []))   # nome exato, ou prefixo com *
DM = set(cfg.get('dropMats', []))      # materiais que saem (rodas, armamento) quando o arquivo não tem nomes de peça
if src.endswith('.blend'): bpy.ops.wm.open_mainfile(filepath=src)
else: bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
for o in bpy.data.objects:            # rig do autor (superfícies de comando apontando para alvos): fica na posição de repouso
    for c in o.constraints: c.mute = True
    o.animation_data_clear()
for o in list(bpy.data.objects):
    if o.type != 'MESH' or dropped(o.name):
        if o.type == 'MESH': print('fora', o.name)
        continue
# materiais: Principled só com a textura de cor (o resto do grafo do autor não exporta para glTF)
for m in bpy.data.materials:
    img = None; col = cfg.get('colors', {}).get(m.name)
    if m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and n.image.size[0] and 'NRM' not in n.image.name and not col: img = n.image; break
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled'); nt.links.new(b.outputs[0], out.inputs[0])
    b.inputs['Roughness'].default_value = 0.55; b.inputs['Metallic'].default_value = 0.25
    if img: t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    else: b.inputs['Base Color'].default_value = (*(col or m.diffuse_color[:3]), 1)
# malhas no mundo, com modificadores aplicados
dg = bpy.context.evaluated_depsgraph_get(); objs = []
for o in [o for o in bpy.data.objects if o.type == 'MESH' and not dropped(o.name) and not (DM and all(m and m.name in DM for m in o.data.materials))]:
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg)); me.transform(o.matrix_world)
    n = bpy.data.objects.new('s_' + o.name, me); sc.collection.objects.link(n); n['src'] = o.name; objs.append(n)
# eixos: nariz -> −Y do Blender (= +z do glTF), cima +Z; CG e linha de centro na origem; escala pela envergadura
ax = cfg['nose']; sgn = 1 if ax[0] == '+' else -1; a = 'XYZ'.index(ax[1])
ang = {0: -90 * sgn, 1: 0 if sgn < 0 else 180}[a]
R = Matrix.Rotation(math.radians(ang), 4, 'Z')
for o in objs: o.data.transform(R)
lat0, up0 = cfg['center']; c = R @ Vector((cfg['cg'] if a == 0 else lat0, lat0 if a == 0 else cfg['cg'], up0))
for o in objs: o.data.transform(Matrix.Translation(-c))
span = max(abs(v.co.x) for o in objs for v in o.data.vertices) * 2; k = cfg['span'] / span
for o in objs: o.data.transform(Matrix.Scale(k, 4)); o.data.update()
print('escala %.4f (envergadura do arquivo %.2f)' % (k, span))
# cutBoxes: [[x0, x1, y0, y1, z0, z1], ...] em coordenadas finais do glTF (x lado, y cima, z nariz): faces com o centro dentro
# de uma caixa saem — é como se tira o trem de pouso de um arquivo sem peças nomeadas (o trem do jogo é o procedural)
for bx in cfg.get('cutBoxes', []):
    for o in objs:
        bm = bmesh.new(); bm.from_mesh(o.data)
        dead = [f for f in bm.faces if (lambda c: bx[0] <= c.x <= bx[1] and bx[2] <= c.z <= bx[3] and bx[4] <= -c.y <= bx[5])(f.calc_center_median())]
        if dead: bmesh.ops.delete(bm, geom=dead, context='FACES'); bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS'); bm.to_mesh(o.data)
        bm.free()
# papéis
W = cfg.get('wings', {}); groups = {'fuse': [], 'wingL': [], 'wingR': [], 'tail': []}
def split(o, pred):                   # separa as faces de o em que pred(face) é verdadeiro; devolve o objeto novo (ou None)
    bm = bmesh.new(); bm.from_mesh(o.data); fl = list(bm.faces); idx = {i for i, f in enumerate(fl) if pred(f, o)}; sel = [fl[i] for i in idx]
    if not sel: bm.free(); return None
    b2 = bm.copy(); f2 = list(b2.faces)          # a cópia mantém a ordem das faces
    loose = lambda b: bmesh.ops.delete(b, geom=[v for v in b.verts if not v.link_faces], context='VERTS')   # apagar faces deixa vértices soltos
    bmesh.ops.delete(bm, geom=sel, context='FACES'); loose(bm); bm.to_mesh(o.data); bm.free()
    bmesh.ops.delete(b2, geom=[f for i, f in enumerate(f2) if i not in idx], context='FACES'); loose(b2)
    me = bpy.data.meshes.new(o.name + '_p'); b2.to_mesh(me); b2.free()
    for m in o.data.materials: me.materials.append(m)
    n = bpy.data.objects.new(o.name + '_p', me); sc.collection.objects.link(n); return n
if W.get('obj') == '*':
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join(); objs = [bpy.context.view_layer.objects.active]; objs[0]['src'] = '*'
    if 'tailZ' in cfg:
        t = split(objs[0], lambda f, ob: -f.calc_center_median().y < cfg['tailZ'])
        if t: groups['tail'].append(t)
for o in objs:
    s = o['src']; cx = sum(v.co.x for v in o.data.vertices) / len(o.data.vertices)
    if any(s.startswith(p) for p in cfg.get('tail', [])): groups['tail'].append(o)
    elif any(s.startswith(p) for p in cfg.get('wingObjs', [])): groups['wingL' if cx > 0 else 'wingR'].append(o)
    elif W and (s == '*' or s.startswith(W['obj'])):
        for side, g in ((1, 'wingL'), (-1, 'wingR')):
            w = split(o, lambda f, ob: f.calc_center_median().x * side > W['root'] and -f.calc_center_median().y > W.get('zmin', -1e9) and f.calc_center_median().z < W.get('ymax', 1e9))
            if w: groups[g].append(w)
        groups['fuse'].append(o)
    else: groups['fuse'].append(o)
outs = []
for g, obs in groups.items():
    if not obs: continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = g; outs.append(o)
    v = [q.co for q in o.data.vertices]
    print('%-6s tris %6d  glTF x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]' % (g, sum(len(p.vertices) - 2 for p in o.data.polygons), min(q.x for q in v), max(q.x for q in v), min(q.z for q in v), max(q.z for q in v), -max(q.y for q in v), -min(q.y for q in v)))
bpy.ops.object.select_all(action='DESELECT')
for o in outs: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_image_format='JPEG', export_jpeg_quality=88, export_apply=True, export_yup=True, export_tangents=False)
print('exportado', dst)
