## Traces de skis creusées : rubans continus par paquets de 256 segments (le paquet en cours est
## reconstruit à chaque ajout, les anciens restent figés). Éclairées selon le soleil dans le shader.
class_name Tracks
extends Node3D

const BATCH := 256
var max_batches := 60
var material: ShaderMaterial
var _batches: Array[MeshInstance3D] = []
var _cur: MeshInstance3D
var _pos := PackedVector3Array()
var _uv := PackedVector2Array()
var _uv2 := PackedVector2Array()
var _n := 0
var _last := {}      # clé -> dernier point
var _edge := {}      # clé -> [gauche, droite] du segment précédent
var min_step := 0.3

func _init(sun_dir: Vector3) -> void:
	material = ShaderMaterial.new()
	material.shader = load("res://shaders/tracks.gdshader")
	material.set_shader_parameter("sun_dir", sun_dir.normalized())
	_new_batch()

func _new_batch() -> void:
	_cur = MeshInstance3D.new()
	_cur.material_override = material
	_cur.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_cur)
	_batches.append(_cur)
	if _batches.size() > max_batches:
		_batches.pop_front().queue_free()
	_pos = PackedVector3Array(); _uv = PackedVector2Array(); _uv2 = PackedVector2Array(); _n = 0

func reset(key := 0) -> void:
	_last.erase(key * 2); _last.erase(key * 2 + 1); _edge.erase(key * 2); _edge.erase(key * 2 + 1)

## points : un point par ski ; side : vecteur latéral horizontal ; width en m ; strength 0..1
func add(points: Array, side: Vector3, width: float, strength: float, key := 0) -> void:
	var changed := false
	side = Vector3(side.x, 0, side.z).normalized()
	for s in points.size():
		var slot: int = key * 2 + s
		var p: Vector3 = points[s] + Vector3(0, 0.03, 0)
		if not _last.has(slot):
			_last[slot] = p; _edge.erase(slot); continue
		var prev: Vector3 = _last[slot]
		var d2 := prev.distance_squared_to(p)
		if d2 < min_step * min_step: continue
		if d2 > 36.0:
			_last[slot] = p; _edge.erase(slot); continue
		var w := width * 0.5
		var a: Vector3; var b: Vector3
		if _edge.has(slot):
			a = _edge[slot][0]; b = _edge[slot][1]
		else:
			a = prev - side * w; b = prev + side * w
		var c := p - side * w
		var e := p + side * w
		for q in [[a, -1.0], [b, 1.0], [c, -1.0], [b, 1.0], [e, 1.0], [c, -1.0]]:
			_pos.append(q[0]); _uv.append(Vector2(q[1], strength)); _uv2.append(Vector2(side.x, side.z))
		_edge[slot] = [c, e]
		_last[slot] = p
		_n += 1
		changed = true
	if changed:
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = _pos; arr[Mesh.ARRAY_TEX_UV] = _uv; arr[Mesh.ARRAY_TEX_UV2] = _uv2
		var m := ArrayMesh.new()
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		_cur.mesh = m
		if _n >= BATCH: _new_batch()
