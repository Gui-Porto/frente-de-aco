# Trem de rolamento do Wirbelwind (Prak, CC BY). Roda DEPOIS do prep.py, em cima do arquivo já preparado:
#   blender -b --python tools/blender/wirbel.py -- public/models/wirbel.glb public/models/wirbel.glb
# No arquivo do autor cada lado é UMA malha soldada: rodas, truques e uma cinta extrudada (perfil com as sapatas, tampas
# laterais em leque). Não há ilhas para separar, então a divisão é geométrica, na vista lateral (y cima, z frente):
#   cinta  = faces com todos os vértices colados no contorno de fora e que atravessam a largura (ou estão nas tampas)
#   roda_n = faces inteiras dentro do disco de um eixo (centro aproximado em AXLES, refinado pela caixa dos vértices)
#   resto  = truques e suportes, ficam parados no nó "track"
# A cinta sai e entra UM elo por lado (link_L / link_R) com o mesmo perfil da sapata do arquivo (passo de 120 mm) e os
# centros do laço (contorno convexo reamostrado no passo), que o jogo instancia e faz andar.
import bpy, bmesh, sys, math
src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
trk = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('track'))
mat = trk.data.materials[0]
PITCH, TH = 0.12, 0.21                 # passo do elo; espessura máxima da cinta medida a partir do contorno de fora
# eixos aproximados [y, z, raio] em coordenadas glTF, de trás para a frente: tensora, 8 rodas de apoio, motriz, 4 roletes
AXLES = [[0.68, -2.45, 0.40]] + [[0.35, z, 0.23] for z in (-1.73, -1.20, -0.69, -0.17, 0.32, 0.83, 1.34, 1.85)] + [[0.72, 2.43, 0.44]] + [[1.02, z, 0.13] for z in (-1.47, -0.45, 0.56, 1.50)]

def hull2(pts):                        # casco convexo (cadeia monótona), anti-horário
    pts = sorted(set(pts)); cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    def half(ps):
        h = []
        for p in ps:
            while len(h) > 1 and cross(h[-2], h[-1], p) <= 0: h.pop()
            h.append(p)
        return h[:-1]
    return half(pts) + half(pts[::-1])
def seg_d(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ((dx * dx + dy * dy) or 1)))
    return math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t)

bm = bmesh.new(); bm.from_mesh(trk.data); mw = trk.matrix_world
P = {v.index: mw @ v.co for v in bm.verts}                    # Blender: X lado, Y = −z do glTF, Z = cima
zy = lambda i: (-P[i].y, P[i].z)                              # (z, y) do glTF
out = []
def mesh(name, faces, extras=None):
    idx = {}; vs = []; fs = []
    for f in faces:
        fs.append([idx.setdefault(v.index, len(idx)) for v in f.verts])
    vs = [None] * len(idx)
    for i, n in idx.items(): vs[n] = tuple(P[i])
    me = bpy.data.meshes.new(name); me.from_pydata(vs, [], fs); me.materials.append(mat)
    for p, f in zip(me.polygons, faces): p.use_smooth = f.smooth
    me.update(); o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    for k, v in (extras or {}).items(): o[k] = v
    out.append(o); return o

static = []
for side, sn in ((1, 'L'), (-1, 'R')):
    faces = [f for f in bm.faces if sum(P[v.index].x for v in f.verts) * side > 0]
    vi = {v.index for f in faces for v in f.verts}
    H = hull2([(round(zy(i)[0], 4), round(zy(i)[1], 4)) for i in vi])
    hd = {i: min(seg_d(zy(i), H[n], H[(n + 1) % len(H)]) for n in range(len(H))) for i in vi}
    xs = [abs(P[i].x) for i in vi if hd[i] < 0.01 and P[i].z < 0.02]; x0, x1 = min(xs), max(xs)     # bordas da cinta
    band = set()
    for f in faces:
        ix = [v.index for v in f.verts]
        if max(hd[i] for i in ix) > TH: continue
        ax = [abs(P[i].x) for i in ix]
        if max(ax) - min(ax) > (x1 - x0) * 0.9 or all(abs(a - x0) < 2e-3 for a in ax) or all(abs(a - x1) < 2e-3 for a in ax): band.add(f)
    rest = [f for f in faces if f not in band]; rv = {v.index for f in rest for v in f.verts}
    wheels = []
    for y, z, r in AXLES:
        for _ in range(4):               # centro = meio da caixa dos vértices dentro do disco
            inn = [zy(i) for i in rv if math.hypot(zy(i)[0] - z, zy(i)[1] - y) < r * 1.08]
            z = (min(p[0] for p in inn) + max(p[0] for p in inn)) / 2; y = (min(p[1] for p in inn) + max(p[1] for p in inn)) / 2
            r = max(max(p[0] for p in inn) - min(p[0] for p in inn), max(p[1] for p in inn) - min(p[1] for p in inn)) / 2
        wheels.append([y, z, r, []])
    for f in rest:
        for w in wheels:
            if all(math.hypot(zy(v.index)[0] - w[1], zy(v.index)[1] - w[0]) < w[2] + 0.004 for v in f.verts): w[3].append(f); break
        else: static.append(f)
    for n, (y, z, r, fs) in enumerate(wheels):
        print('  eixo %s %2d  y %.3f z %.3f r %.3f  faces %d' % (sn, n, y, z, r, len(fs)))
        if fs: mesh('wheel_%s_%d' % (sn, n), fs, {'y': y, 'z': z, 'r': r, 'side': side})
    # elo: sapata (apoio de 50 mm + rebaixo em arco) extrudada na largura da cinta, com o dente-guia no meio
    yb = min(p[1] for p in H); zc = 0.0; a, b = side * x0, side * x1
    prof = [(0, .007), (.05, .007), (.054, .022), (.063, .034), (.077, .04), (.092, .04), (.106, .034), (.116, .022), (.12, .007), (.12, .151), (0, .151)]
    vs = []; fs = []
    for x in (a, b): vs += [(x, -(zc - PITCH / 2 + z), yb + y) for z, y in prof]
    n = len(prof)
    for i in range(n): j = (i + 1) % n; fs.append([i, j, n + j, n + i])
    fs += [list(range(n))[::-1], list(range(n, 2 * n))]
    xm = (a + b) / 2; k = len(vs)                                # dente-guia
    for x in (xm - .03, xm + .03): vs += [(x, -(zc - .025), yb + .15), (x, -(zc + .025), yb + .15), (x, -(zc + .012), yb + .19), (x, -(zc - .012), yb + .19)]
    fs += [[k, k + 1, k + 2, k + 3], [k + 7, k + 6, k + 5, k + 4], [k, k + 3, k + 7, k + 4], [k + 1, k + 5, k + 6, k + 2], [k + 3, k + 2, k + 6, k + 7]]
    me = bpy.data.meshes.new('link_' + sn); me.from_pydata(vs, [], fs); me.materials.append(mat); me.update()
    bm2 = bmesh.new(); bm2.from_mesh(me); bmesh.ops.recalc_face_normals(bm2, faces=bm2.faces); bm2.to_mesh(me); bm2.free()
    lk = bpy.data.objects.new('link_' + sn, me); bpy.context.scene.collection.objects.link(lk); out.append(lk)
    # laço: contorno de fora reamostrado no passo, a partir do centro do elo (meio do trecho de baixo)
    j = next(n for n in range(len(H)) if H[n][1] < yb + 0.02 and H[(n + 1) % len(H)][1] < yb + 0.02 and min(H[n][0], H[(n + 1) % len(H)][0]) <= zc <= max(H[n][0], H[(n + 1) % len(H)][0]))
    path = [(zc, yb)] + [H[(j + 1 + n) % len(H)] for n in range(len(H))] + [(zc, yb)]
    sl = [math.dist(path[n], path[n + 1]) for n in range(len(path) - 1)]; L = sum(sl); N = round(L / PITCH); cen = []
    for n in range(N):
        t = L * n / N; i = 0
        while i < len(sl) - 1 and t > sl[i]: t -= sl[i]; i += 1
        u = t / (sl[i] or 1); cen += [round(path[i][1] + (path[i + 1][1] - path[i][1]) * u, 4), round(path[i][0] + (path[i + 1][0] - path[i][0]) * u, 4)]   # [y, z]
    lk['centers'] = cen; lk['ref'] = 0; lk['period'] = 1; lk['side'] = side
    print(sn, 'cinta: %d faces fora, borda x %.3f..%.3f, laço %.2f m, %d elos' % (len(band), x0, x1, L, N))
mesh('track', static)
bm.free(); bpy.data.objects.remove(trk)
keep = out + [o for o in bpy.data.objects if o.type == 'MESH' and o.name.split('.')[0] in ('hull', 'turret', 'gun')]
bpy.ops.object.select_all(action='DESELECT')
for o in keep: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_extras=True, export_tangents=False)
print('exportado', dst, [o.name for o in keep])
