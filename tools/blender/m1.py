# Prepara o M1 Abrams (Artem.Goyko, CC BY) para o jogo. Uso:
#   blender -b --python tools/blender/m1.py -- entrada.glb public/models/m1.glb
# Saída (glTF, metros, +z frente, chão em y = 0, casco centrado): nós
#   hull, turret, gun            — casco, torre e canhão+mantelete
#   wheel_<lado>_<n>             — rodas de apoio, tensora, motriz e roletes (extras: y, z, r, side)
#   link_L / link_R              — UM elo por lado (extras: centers = [y, z, ...] do laço, ref, period)
# O tanque vem numa malha só com os vértices soltos por triângulo: as peças são as ilhas de triângulos depois de soldar
# os vértices por posição. A esteira do arquivo é uma FITA texturizada com recorte por alfa (sem elos): o elo é um
# pedaço do trecho de baixo com exatamente um período da textura, e o laço é o contorno (casco convexo) da fita.
import bpy, bmesh, sys, math, json, struct
from mathutils import Matrix
src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
bpy.context.view_layer.update()
obs = [o for o in bpy.data.objects if o.type == 'MESH']
for o in obs:
    mw = o.matrix_world.copy(); o.parent = None; o.data.transform(mw); o.matrix_world = Matrix.Identity(4)
band = next(o for o in obs if len(o.data.polygons) < 10000); ob = next(o for o in obs if o is not band)
# escala real (rodas de 635 mm: o arquivo vem em ~1/9,5), canhão para −Y do Blender (= +z do glTF), fita centrada no chão
SCALE = 9.5
T = Matrix.Scale(SCALE, 4) @ Matrix.Rotation(math.radians(90), 4, 'Z')
for o in obs: o.data.transform(T)
vs = [v.co for v in band.data.vertices]
T = Matrix.Translation((0, -(min(v.y for v in vs) + max(v.y for v in vs)) / 2, -min(v.z for v in vs)))
for o in obs: o.data.transform(T); o.data.update()
DECK = 1.52                            # base da torre (glTF y)
U0, UPER = 99.5 / 1024, 121 / 1024     # vão entre almofadas e período da textura da esteira (em u, medido no alfa)

# ---- esteira: um elo por lado tirado da fita + centros do laço ----
out = []; extras = {}
bme = band.data; uvl = bme.uv_layers.active.data
def hull2(pts):                        # casco convexo (cadeia monótona), anti-horário
    pts = sorted(set(pts)); cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    def half(ps):
        h = []
        for p in ps:
            while len(h) > 1 and cross(h[-2], h[-1], p) <= 0: h.pop()
            h.append(p)
        return h[:-1]
    return half(pts) + half(pts[::-1])
for side, sn in ((1, 'L'), (-1, 'R')):
    polys = [p for p in bme.polygons if p.center.x * side > 0]
    # trecho de baixo: faces extrudadas ao longo de Y (as tampas de cada segmento têm extensão nula em Y)
    segs = {}
    for p in polys:
        co = [bme.vertices[i].co for i in p.vertices]; ys = [c.y for c in co]
        if max(c.z for c in co) < 0.25 and max(ys) - min(ys) > 0.3: segs.setdefault(round(min(ys), 2), []).append(p)
    k = min(segs, key=lambda k: abs(k - sum(segs) / len(segs))); seg = segs[k]
    y0 = min(bme.vertices[i].co.y for p in seg for i in p.vertices); y1 = max(bme.vertices[i].co.y for p in seg for i in p.vertices)
    us = [[uvl[li].uv.x for p in seg for li in p.loop_indices if abs(bme.vertices[bme.loops[li].vertex_index].co.y - y) < 1e-3] for y in (y0, y1)]
    u0, u1 = sum(us[0]) / len(us[0]), sum(us[1]) / len(us[1])
    ya, yb = (y0 + (u - u0) / (u1 - u0) * (y1 - y0) for u in (U0, U0 + UPER)); pitch = abs(yb - ya); yc = (ya + yb) / 2
    verts = []; faces = []; uvs = []; seen = set()
    for p in seg:
        key = tuple(sorted(tuple(round(c, 3) for c in bme.vertices[i].co) for i in p.vertices))
        if key in seen: continue                 # a fita vem com faces duplicadas
        seen.add(key); f = []
        for li in p.loop_indices:
            c = bme.vertices[bme.loops[li].vertex_index].co; lo = abs(c.y - y0) < 1e-3
            f.append(len(verts)); verts.append((c.x, ya if lo else yb, c.z)); uvs.append((U0 if lo else U0 + UPER, uvl[li].uv.y))
        faces.append(f)
    me = bpy.data.meshes.new('link_' + sn); me.from_pydata(verts, [], faces); me.uv_layers.new(name='UVMap')
    for li, uv in enumerate(uvs): me.uv_layers.active.data[li].uv = uv
    me.materials.append(bme.materials[0]); me.update()
    lk = bpy.data.objects.new('link_' + sn, me); bpy.context.scene.collection.objects.link(lk); out.append(lk)
    # laço: contorno de fora da fita no plano YZ, reamostrado no passo do elo a partir do centro do elo de referência
    H = hull2([(round(bme.vertices[i].co.y, 4), round(bme.vertices[i].co.z, 4)) for p in polys for i in p.vertices])
    j = next(n for n in range(len(H)) if H[n][1] < 1e-3 and H[(n + 1) % len(H)][1] < 1e-3 and min(H[n][0], H[(n + 1) % len(H)][0]) <= yc <= max(H[n][0], H[(n + 1) % len(H)][0]))
    path = [(yc, 0.0)] + [H[(j + 1 + n) % len(H)] for n in range(len(H))] + [(yc, 0.0)]
    seg_l = [math.dist(path[n], path[n + 1]) for n in range(len(path) - 1)]; L = sum(seg_l); N = round(L / pitch); cen = []
    for n in range(N):
        t = L * n / N; i = 0
        while i < len(seg_l) - 1 and t > seg_l[i]: t -= seg_l[i]; i += 1
        u = t / (seg_l[i] or 1); y = path[i][0] + (path[i + 1][0] - path[i][0]) * u; z = path[i][1] + (path[i + 1][1] - path[i][1]) * u
        cen += [round(z, 4), round(-y, 4)]       # glTF: y = Z do Blender, z = −Y
    lk['centers'] = cen; lk['ref'] = 0; lk['period'] = 1; lk['side'] = side
    print(sn, 'elo: passo %.4f, laço %.2f m, %d elos, %d faces' % (pitch, L, N, len(faces)))
bpy.data.objects.remove(band)

# ---- tanque: ilhas (vértices soldados por posição) ----
me = ob.data; bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
grp = bm.faces.layers.int.new('grp')
par = {}
def find(a):
    while par[a] != a: par[a] = par[par[a]]; a = par[a]
    return a
key = lambda v: (round(v.co.x * 2000), round(v.co.y * 2000), round(v.co.z * 2000))
for f in bm.faces:
    ks = [key(v) for v in f.verts]
    for k in ks: par.setdefault(k, k)
    for k in ks[1:]: par[find(k)] = find(ks[0])
by = {}
for f in bm.faces: by.setdefault(find(key(f.verts[0])), []).append(f)
isl = []
for fs in by.values():                 # caixas em coordenadas glTF: x = X, y = Z (cima), z = −Y (frente)
    xs = [v.co.x for f in fs for v in f.verts]; ys = [v.co.z for f in fs for v in f.verts]; zs = [-v.co.y for f in fs for v in f.verts]
    mn = (min(xs), min(ys), min(zs)); mx = (max(xs), max(ys), max(zs))
    isl.append({'fs': fs, 'mn': mn, 'mx': mx, 'c': tuple((a + b) / 2 for a, b in zip(mn, mx)), 'sz': tuple(b - a for a, b in zip(mn, mx)), 'g': 0})
print('ilhas', len(isl))
def tag(i, g):
    i['g'] = g
    for f in i['fs']: f[grp] = g
G_GUN, G_TUR = 1, 2
names = {0: 'hull', G_GUN: 'gun', G_TUR: 'turret'}
for i in isl:
    if i['mn'][1] <= DECK: continue
    # canhão: tubo, mantelete, metralhadora coaxial e o que vai em cima deles — tudo à frente da face da torre, no eixo
    if abs(i['c'][0]) < 0.5 and (i['mx'][2] > 2.3 or (i['mn'][2] > 1.15 and i['sz'][0] < 0.8)): tag(i, G_GUN)
    elif -2.95 < i['c'][2] < 2.45: tag(i, G_TUR)
# ---- trem de rolamento: por fora do casco e abaixo das saias; discos viram eixos, miudezas que cabem no disco vão junto ----
nextg = 3
for side, sn in ((1, 'L'), (-1, 'R')):
    zone = [i for i in isl if i['g'] == 0 and i['c'][0] * side > 0.95 and i['mx'][1] < 1.25]
    discs = [i for i in zone if abs(i['sz'][1] - i['sz'][2]) < 0.04 and i['sz'][1] > 0.18 and len(i['fs']) > 100]
    axles = []
    for d in discs:
        for a in axles:
            if math.hypot(d['c'][1] - a['y'], d['c'][2] - a['z']) < 0.05: a['r'] = max(a['r'], d['sz'][1] / 2); break
        else: axles.append({'y': d['c'][1], 'z': d['c'][2], 'r': d['sz'][1] / 2, 'g': 0})
    axles.sort(key=lambda a: a['z'])
    for n, a in enumerate(axles):
        a['g'] = nextg; nextg += 1; names[a['g']] = 'wheel_%s_%d' % (sn, n); extras[a['g']] = {'y': a['y'], 'z': a['z'], 'r': a['r'], 'side': side}
        print('  eixo', sn, n, 'y %.3f z %.3f r %.3f' % (a['y'], a['z'], a['r']))
    for i in zone:
        a = min(axles, key=lambda a: math.hypot(i['c'][1] - a['y'], i['c'][2] - a['z']))
        wd = math.hypot(i['c'][1] - a['y'], i['c'][2] - a['z'])
        far = max(math.hypot(y - a['y'], z - a['z']) for y in (i['mn'][1], i['mx'][1]) for z in (i['mn'][2], i['mx'][2]))
        if far < a['r'] * 1.42 + 0.02 and wd < 0.04: tag(i, a['g'])       # 1,42: o canto da caixa de um disco fica a r·√2
    print(sn, 'rodas', len(axles), 'zona', len(zone))
bm.to_mesh(me); bm.free()
for g in sorted(names, reverse=True):
    if g == 0: continue
    bm = bmesh.new(); bm.from_mesh(ob.data); L = bm.faces.layers.int['grp']
    any_ = False
    for f in bm.faces: f.select = f[L] == g; any_ = any_ or f.select
    for e in bm.edges: e.select = all(f.select for f in e.link_faces)
    for v in bm.verts: v.select = all(f.select for f in v.link_faces)
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
    v = [q.co for q in o.data.vertices]
    print('%-10s tris %5d  glTF x[%.2f,%.2f] y[%.2f,%.2f] z[%.2f,%.2f]' % (o.name, sum(len(p.vertices) - 2 for p in o.data.polygons), min(q.x for q in v), max(q.x for q in v), min(q.z for q in v), max(q.z for q in v), -max(q.y for q in v), -min(q.y for q in v)))
for im in bpy.data.images:
    if im.size[0] > 2048: im.scale(2048, 2048)
bpy.ops.object.select_all(action='DESELECT')
for o in out: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_image_format='JPEG', export_jpeg_quality=85, export_apply=True, export_yup=True, export_extras=True, export_tangents=False)
# a esteira é recortada pelo alfa da textura: o material sai como MASK (o jogo desenha tudo opaco, com alphaTest)
d = open(dst, 'rb').read(); n = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + n]); rest = d[20 + n:]
for m in j['materials']:
    if m.get('alphaMode') == 'BLEND' or m['name'] == bme.materials[0].name: m['alphaMode'] = 'MASK'; m['alphaCutoff'] = 0.5
js = json.dumps(j, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
open(dst, 'wb').write(d[:8] + struct.pack('<I', 20 + len(js) + len(rest)) + struct.pack('<I', len(js)) + d[16:20] + js + rest)
print('exportado', dst)
