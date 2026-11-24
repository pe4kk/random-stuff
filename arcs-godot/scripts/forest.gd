## Forêt : 48 600 sapins aux positions réelles (relevé IGN : MNS − MNT), rendus en cartes de rameaux
## photographiés ; trois niveaux de détail par carré de 256 m avec fondu géré par le moteur.
class_name Forest
extends Node3D

# rectangles des rameaux dans l'atlas (u0, v0, u1, v1) : tige en bas, pointe en haut
const TWIGS := [Rect2(0.186, 0.043, 0.246, 0.272), Rect2(0.649, 0.037, 0.292, 0.335), Rect2(0.490, 0.257, 0.144, 0.146),
	Rect2(0.303, 0.397, 0.345, 0.381), Rect2(0.631, 0.449, 0.330, 0.384)]

var xs := PackedFloat32Array()
var zs := PackedFloat32Array()
var hs := PackedFloat32Array()
var rs := PackedFloat32Array()
var count := 0
var _grid := {}
const GCELL := 8.0

func _init(path: String, hf: HeightField, mask: Mask) -> void:
	var raw := FileAccess.get_file_as_bytes(path).to_float32_array()
	count = raw.size() / 3
	xs.resize(count); zs.resize(count); hs.resize(count); rs.resize(count)
	for i in count:
		xs[i] = raw[i * 3]; zs[i] = raw[i * 3 + 1]; hs[i] = minf(raw[i * 3 + 2], 30.0)
		rs[i] = 0.35 + minf(0.6, hs[i] * 0.03)
		var k := Vector2i(floori(xs[i] / GCELL), floori(zs[i] / GCELL))
		if not _grid.has(k): _grid[k] = PackedInt32Array()
		_grid[k].append(i)
	_build(hf)

## sapin le plus « pénétré » autour d'un point
func nearest(x: float, z: float, r: float) -> Dictionary:
	var best := -1
	var bd := r
	var brad := 0.0
	var bscore := INF
	for i in range(floori((x - r - 3.0) / GCELL), floori((x + r + 3.0) / GCELL) + 1):
		for j in range(floori((z - r - 3.0) / GCELL), floori((z + r + 3.0) / GCELL) + 1):
			var a: PackedInt32Array = _grid.get(Vector2i(i, j), PackedInt32Array())
			for id in a:
				var d := Vector2(xs[id] - x, zs[id] - z).length()
				var score := d - rs[id]
				if score < bscore:
					bscore = score; best = id; bd = d; brad = rs[id]
	return {"i": best, "d": bd, "rad": brad}

# ------------------------------------------------------------------ géométrie
static func _card_tree(tiers: int, per_tier: int, seed: int, round_shape: bool) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var solid := func(a: Vector3, b: Vector3, c: Vector3, col: Color) -> void:
		var n := (b - a).cross(c - a).normalized()
		for p in [a, b, c]:
			st.set_color(Color(0.0, col.r, col.g, col.b)); st.set_uv(Vector2.ZERO)
			st.set_normal((n * 0.4 + Vector3(p.x, 0.3, p.z).normalized() * 0.6).normalized())
			st.add_vertex(p)
	# tronc et cœur sombre (bouche les trous entre les rameaux)
	var bark := Color(0.23, 0.16, 0.11)
	var core := Color(0.03, 0.05, 0.035)
	for i in 6:
		var a0 := TAU * i / 6.0
		var a1 := TAU * (i + 1) / 6.0
		var r0 := 0.022
		solid.call(Vector3(cos(a0) * r0, 0, sin(a0) * r0), Vector3(cos(a1) * r0, 0, sin(a1) * r0), Vector3(0, 0.3, 0), bark)
		var cr := 0.17 if round_shape else 0.13
		solid.call(Vector3(cos(a0) * cr, 0.14, sin(a0) * cr), Vector3(0, 0.93, 0), Vector3(cos(a1) * cr, 0.14, sin(a1) * cr), core)
	# étages de rameaux tombants : deux cartes croisées par branche
	for t in tiers:
		var f := float(t) / (tiers - 1)
		var yb := 0.13 + f * 0.82
		var prof := (sqrt(maxf(0.0, 1.0 - pow(f * 1.15 - 0.35, 2) / 0.65)) * 0.32 + 0.05) if round_shape else (0.4 * pow(1.0 - f, 0.95) + 0.05)
		var nb := maxi(3, roundi(per_tier * (0.5 + 0.5 * (1.0 - f))))
		var rot := rng.randf() * TAU
		for k in nb:
			var a := rot + TAU * k / nb + (rng.randf() - 0.5) * 0.6
			var r := prof * (0.8 + rng.randf() * 0.4)
			var dir := Vector3(cos(a), 0, sin(a))
			var side := Vector3(-sin(a), 0, cos(a))
			var droop := (0.06 + 0.08 * rng.randf()) * (1.0 - f * 0.4)
			var base := Vector3(0, yb + 0.02, 0)
			var tip := dir * r + Vector3(0, yb - droop, 0)
			var w := r * 0.6
			var rc: Rect2 = TWIGS[rng.randi() % TWIGS.size()]
			var uv0 := Vector2(rc.position.x, rc.position.y + rc.size.y)       # bas gauche
			var uv1 := Vector2(rc.position.x + rc.size.x, rc.position.y + rc.size.y)
			var uv2 := Vector2(rc.position.x + rc.size.x, rc.position.y)
			var uv3 := rc.position
			# plan presque horizontal (vu d'en haut : neige) et plan vertical (silhouette)
			var quads := [
				[base - side * w * 0.25, base + side * w * 0.25, tip + side * w * 0.5 + Vector3(0, -w * 0.12, 0), tip - side * w * 0.5 + Vector3(0, -w * 0.12, 0)],
				[base + Vector3(0, -w * 0.12, 0), base + Vector3(0, w * 0.12, 0), tip + Vector3(0, w * 0.45, 0), tip + Vector3(0, -w * 0.45, 0)],
			]
			var v := 0.85 + rng.randf() * 0.3
			for q in quads:
				var nrm: Vector3 = (q[1] - q[0]).cross(q[3] - q[0]).normalized()
				if nrm.y < 0.0: nrm = -nrm
				nrm = (nrm * 0.25 + (dir * 0.8 + Vector3(0, 0.6, 0)).normalized() * 0.75).normalized()
				var uvs := [uv0, uv1, uv2, uv3]
				for idx in [0, 1, 2, 0, 2, 3]:
					st.set_color(Color(1.0, v, v, v)); st.set_uv(uvs[idx]); st.set_normal(nrm)
					st.add_vertex(q[idx])
	st.generate_tangents()
	return st.commit()

func _build(hf: HeightField) -> void:
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/tree.gdshader")
	mat.set_shader_parameter("twig", load("res://textures/fir_twig_rgba.png"))
	mat.set_shader_parameter("twig_nrm", load("res://textures/fir_twig_nor_1k.png"))
	var lods := [
		[_card_tree(13, 8, 11, false), _card_tree(14, 8, 29, false), _card_tree(10, 9, 53, true)],
		[_card_tree(7, 5, 5, false), _card_tree(8, 5, 17, false), _card_tree(6, 5, 41, true)],
		[_card_tree(3, 4, 7, false), _card_tree(3, 4, 13, false), _card_tree(3, 4, 9, true)],
	]
	# distance mesurée au centre du carré : carrés plus petits pour le niveau détaillé
	# même découpage pour les trois niveaux (pas de doublons), seuils mesurés au centre du carré
	var chunks := [128.0, 128.0, 128.0]
	var ranges := [[0.0, 165.0], [165.0, 520.0], [520.0, 1700.0]]
	var half := hf.half
	var species := PackedInt32Array(); species.resize(count)
	var ys := PackedFloat32Array(); ys.resize(count)
	for i in count:
		ys[i] = hf.height(xs[i], zs[i])
		var pin := clampf((ys[i] - 1850.0) / 400.0, 0.0, 0.6)
		species[i] = 2 if float((i * 2654435761) % 1000) / 1000.0 < pin else i % 2
	for lod in 3:
		var csz: float = chunks[lod]
		var nc := int(2.0 * half / csz)
		var buckets := {}
		for i in count:
			var key := Vector3i(clampi(floori((xs[i] + half) / csz), 0, nc - 1), clampi(floori((zs[i] + half) / csz), 0, nc - 1), species[i])
			if not buckets.has(key): buckets[key] = PackedInt32Array()
			buckets[key].append(i)
		for key in buckets:
			var ids: PackedInt32Array = buckets[key]
			var center := Vector3(-half + (key.x + 0.5) * csz, 0, -half + (key.y + 0.5) * csz)
			center.y = hf.height(center.x, center.z)
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_custom_data = true
			mm.mesh = lods[lod][key.z]
			mm.instance_count = ids.size()
			for k in ids.size():
				var id := ids[k]
				var h := hs[id]
				var w := h * (0.62 if key.z == 2 else 0.5) * (1.0 + float((id * 7919) % 100) / 100.0 * 0.35)
				var b := Basis(Vector3.UP, fmod(id * 2.399, TAU)).scaled(Vector3(w, h, w))
				var p := Vector3(xs[id], ys[id] - 0.4, zs[id]) - center
				mm.set_instance_transform(k, Transform3D(b, p))
				var v := 0.82 + float((id * 104729) % 100) / 100.0 * 0.32
				mm.set_instance_custom_data(k, Color(v, v * (0.95 + float((id * 13) % 10) / 90.0), v * 0.98, 1.0))
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.material_override = mat
			mmi.position = center
			mmi.visibility_range_begin = ranges[lod][0]
			mmi.visibility_range_end = ranges[lod][1]
			mmi.visibility_range_begin_margin = 25.0 if lod > 0 else 0.0
			mmi.visibility_range_end_margin = 25.0
			mmi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if lod < 2 else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(mmi)
