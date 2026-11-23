# Reexporta um GLB trocando as texturas para JPEG (malha intacta). blender -b --python jpeg.py -- entrada.glb saida.glb
import bpy, sys
src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src, merge_vertices=False)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=88, export_yup=True, export_tangents=False)
