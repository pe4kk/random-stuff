"""Génère le skieur réaliste avec MakeHuman (MPFB2 dans Blender 4.2, assets CC0) et l'exporte en GLB.
Usage : python (avec le module bpy) make_human.py sortie.glb"""
import bpy, os, sys, importlib
bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
P = "bl_ext.user_default.mpfb."
HumanService = importlib.import_module(P + "services.humanservice").HumanService
TargetService = importlib.import_module(P + "services.targetservice").TargetService
LocationService = importlib.import_module(P + "services.locationservice").LocationService
D = LocationService.get_user_data()
out = sys.argv[-1]

for o in list(bpy.data.objects): bpy.data.objects.remove(o)
macro = TargetService.get_default_macro_info_dict()
macro.update({"gender": 1.0, "age": 0.5, "muscle": 0.56, "weight": 0.52, "proportions": 0.65, "height": 0.6,
              "race": {"asian": 0.0, "caucasian": 1.0, "african": 0.0}})
human = HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
rig = HumanService.add_builtin_rig(human, "game_engine", import_weights=True)
HumanService.set_character_skin(os.path.join(D, "skins/young_caucasian_male/young_caucasian_male.mhmat"), human, skin_type="GAMEENGINE")
for f, t in [("eyes/low-poly/low-poly.mhclo", "Eyes"), ("eyebrows/eyebrow001/eyebrow001.mhclo", "Eyebrows"),
             ("eyelashes/eyelashes01/eyelashes01.mhclo", "Eyelashes"), ("hair/short02/short02.mhclo", "Hair")]:
    try:
        HumanService.add_mhclo_asset(os.path.join(D, f), human, asset_type=t, subdiv_levels=0, material_type="GAMEENGINE")
    except Exception as e:
        print("ASSET FAIL", f, e)
# fige les formes (cibles) et supprime la géométrie d'aide masquée
bpy.context.view_layer.objects.active = human
human.select_set(True)
if human.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
for m in list(human.modifiers):
    if m.type == 'MASK':
        bpy.ops.object.modifier_apply(modifier=m.name)
# ------------------------------------------------------------------ tenue de ski taillée dans le corps
import bmesh
from mathutils import Vector
arm = rig
def bone_head(n):
    b = arm.data.bones[n]; return arm.matrix_world @ b.head_local
zs = [(human.matrix_world @ v.co).z for v in human.data.vertices]
H = max(zs) - min(zs)
pelvis_y = bone_head("pelvis").z            # Blender : Z vers le haut
chin_z = bone_head("head").z + 0.01
print("REPERES", round(min(zs), 3), round(max(zs), 3), "bassin", round(pelvis_y, 3), "menton", round(chin_z, 3), arm.matrix_world.to_scale())
if not (0.35 * H < pelvis_y - min(zs) < 0.65 * H):
    pelvis_y = min(zs) + 0.53 * H; chin_z = min(zs) + 0.87 * H
    print("REPERES corrigés", round(pelvis_y, 3), round(chin_z, 3))
def cat_of(name):
    if any(k in name for k in ("hand", "thumb", "index", "middle", "ring", "pinky")): return 2
    if name.startswith("head") or name.startswith("neck"): return 3
    if any(k in name for k in ("thigh", "calf", "foot", "ball")) or name in ("pelvis", "Root"): return 1
    return 0
gname = {g.index: g.name for g in human.vertex_groups}
me = human.data
vcat = []
vpants = []
for v in me.vertices:
    w = [0.0, 0.0, 0.0, 0.0]
    for ge in v.groups:
        n = gname.get(ge.group, "")
        if n in arm.data.bones: w[cat_of(n)] += ge.weight
    z = (human.matrix_world @ v.co).z
    vpants.append(w[1] > 0.2 * max(1e-6, sum(w)) and z < pelvis_y + 0.06)
    if z > pelvis_y - 0.16 and w[1] > 0: w[0] += w[1]; w[1] = 0.0          # la veste descend sur les hanches
    if z < chin_z - 0.09 and w[3] > 0: w[0] += w[3]; w[3] = 0.0           # col montant
    vcat.append(max(range(4), key=lambda k: w[k]) if sum(w) > 0 else 3)

def extract(name, cats, zmin=-1.0, offset=0.03, smooth_iter=12, flare=0.0, member=None):
    """copie les faces des catégories voulues, les gonfle et les lisse (le tissu efface l'anatomie)"""
    ob = human.copy(); ob.data = human.data.copy(); ob.name = name
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    inside = (lambda i: member[i]) if member is not None else (lambda i: vcat[i] in cats)
    kill = [f for f in bm.faces if not (sum(inside(v.index) for v in f.verts) >= 1 and min((ob.matrix_world @ v.co).z for v in f.verts) > zmin)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(ob.data); bm.free()
    for m in list(ob.modifiers):
        if m.type != 'ARMATURE': ob.modifiers.remove(m)
    # lissage puis gonflement, placés avant l'armature (appliqués à l'export)
    sm = ob.modifiers.new("lisse", 'LAPLACIANSMOOTH'); sm.iterations = smooth_iter; sm.lambda_factor = 0.6; sm.use_volume_preserve = True; sm.use_normalized = True
    dp = ob.modifiers.new("gonfle", 'DISPLACE'); dp.strength = offset; dp.mid_level = 0.0; dp.direction = 'NORMAL'
    for m in [dp, sm]:
        while ob.modifiers.find(m.name) > 0:
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_move_up(modifier=m.name)
    if flare > 0:
        # pantalon évasé sur la chaussure : on écarte le bas des jambes
        for v in ob.data.vertices:
            z = (ob.matrix_world @ v.co).z
            if z < zmin + 0.12:
                k = (zmin + 0.12 - z) / 0.12
                v.co += v.normal * flare * k
    # position de repos (pour les motifs du shader) dans la couleur des sommets
    ca = ob.data.color_attributes.new("repos", 'FLOAT_COLOR', 'POINT')
    for v in ob.data.vertices:
        w = ob.matrix_world @ v.co
        ca.data[v.index].color = (w.x * 0.5 + 0.5, w.z * 0.5, -w.y * 0.5 + 0.5, 1.0)   # x, hauteur, avant (Godot : -Y Blender)
    ob.data.color_attributes.active_color = ca
    ob.data.materials.clear()
    mat = bpy.data.materials.new(name + "_mat"); ob.data.materials.append(mat)
    return ob

jacket = extract("Veste", {0}, offset=0.034, smooth_iter=14)
pants = extract("Pantalon", {1}, zmin=0.19, offset=0.024, smooth_iter=10, flare=0.035, member=vpants)   # monte sous la veste
gloves = extract("Gants", {2}, offset=0.012, smooth_iter=6)
# corps : on ne garde que la tête et le cou (le reste est sous les vêtements ou dans les chaussures)
bm = bmesh.new(); bm.from_mesh(human.data)
kill = [f for f in bm.faces if sum(vcat[v.index] == 3 for v in f.verts) < 3]
bmesh.ops.delete(bm, geom=kill, context='FACES')
bm.to_mesh(human.data); bm.free()
# les cheveux passent sous le casque : retirés
for o in list(bpy.data.objects):
    if o.name.endswith("short02"): bpy.data.objects.remove(o)
for o in bpy.data.objects: print("OBJ", o.name, o.type, len(o.data.vertices) if o.type == 'MESH' else "")
print("ARMATURE", rig.location[:], rig.scale[:])
# fige position/rotation/échelle de l'armature et des maillages : os et corps dans le même repère
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = rig
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
print("ARMATURE après", rig.location[:], [round(x, 3) for x in (rig.matrix_world @ rig.data.bones["pelvis"].head_local)[:]])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                          export_skins=True, export_animations=False, export_morph=False, export_vertex_color='ACTIVE', export_image_format='JPEG', export_jpeg_quality=88)
print("EXPORT", out, os.path.getsize(out))
