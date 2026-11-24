## Terrain en anneaux concentriques (clipmap) : chaque niveau double la taille de maille,
## centré sur la caméra ; le relief est lu dans le shader. Détail constant à l'écran, coût fixe.
class_name Terrain
extends Node3D

const LEVELS := 10
const N := 192            # mailles par côté et par niveau
const BASE := 1.0         # taille de maille du niveau 0 (m)

var material: ShaderMaterial
var rings: Array[MeshInstance3D] = []

func _init(core: HeightField, mid: HeightField, far: HeightField, tex: Dictionary) -> void:
	material = ShaderMaterial.new()
	material.shader = load("res://shaders/terrain.gdshader")
	material.set_shader_parameter("core_h", core.texture)
	material.set_shader_parameter("mid_h", mid.texture)
	material.set_shader_parameter("far_h", far.texture)
	material.set_shader_parameter("core_half", core.half)
	material.set_shader_parameter("mid_half", mid.half)
	material.set_shader_parameter("far_half", far.half)
	for k in tex: material.set_shader_parameter(k, tex[k])
	var mesh := _grid(N)
	for l in LEVELS:
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.material_override = material
		mi.custom_aabb = AABB(Vector3(-1e6, -1e4, -1e6), Vector3(2e6, 2e4, 2e6))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if l < 6 else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		rings.append(mi)

## grille plate de n × n mailles unitaires, centrée
func _grid(n: int) -> ArrayMesh:
	var verts := PackedVector3Array()
	var idx := PackedInt32Array()
	verts.resize((n + 1) * (n + 1))
	var h := n / 2.0
	for j in n + 1:
		for i in n + 1:
			verts[j * (n + 1) + i] = Vector3(i - h, 0.0, j - h)
	idx.resize(n * n * 6)
	var t := 0
	for j in n:
		for i in n:
			var a := j * (n + 1) + i
			var b := a + 1
			var c := a + n + 1
			var d := c + 1
			idx[t] = a; idx[t + 1] = b; idx[t + 2] = c
			idx[t + 3] = b; idx[t + 4] = d; idx[t + 5] = c
			t += 6
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_INDEX] = idx
	var normals := PackedVector3Array(); normals.resize(verts.size()); normals.fill(Vector3.UP)
	arr[Mesh.ARRAY_NORMAL] = normals
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m

## recentre les anneaux sur la caméra (alignés sur la maille double de chaque niveau)
func update(cam: Vector3) -> void:
	var prev_c := Vector2.ZERO
	var prev_e := 0.0
	for l in LEVELS:
		var s := BASE * pow(2.0, l)
		var snap := 2.0 * s
		var c := Vector2(floorf(cam.x / snap + 0.5) * snap, floorf(cam.z / snap + 0.5) * snap)
		var e := N * s * 0.5
		var mi := rings[l]
		mi.position = Vector3(c.x, 0.0, c.y)
		mi.set_instance_shader_parameter("level_info", Vector4(s, e, 0, 0))
		mi.set_instance_shader_parameter("inner_info", Vector4(prev_c.x, prev_c.y, prev_e, 0))
		prev_c = c
		prev_e = e
