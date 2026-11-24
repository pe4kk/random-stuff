## Skieur articulé : personnage réaliste MakeHuman (CC0) en tenue de ski (voir tools/make_human.py), animé chaque image par un
## squelette « pilote » calculé depuis la physique (flexion, angulation, schuss, chasse-neige, planté de bâton)
## puis recopié sur les os : visée des membres et IK des jambes vers les chaussures fixées aux skis.
## Repère du skieur : +X gauche, +Y haut, +Z avant (identique à l'espace du squelette importé).
class_name SkierBody
extends Node3D

var sk: Skeleton3D
var mesh: MeshInstance3D
var rest := {}           # nom -> Transform3D de repos (espace squelette)
var bi := {}             # nom -> index d'os
var dims := {}
var skis: Array[Node3D] = []
var poles: Array[Node3D] = []
var cloth: ShaderMaterial
var _curl := {}
var m2s := Transform3D()        # repère du skieur -> espace du squelette
var meshes: Array[MeshInstance3D] = []
var head_socket: Node3D

func _init(jacket := Color(0.72, 0.07, 0.09), pants := Color(0.05, 0.055, 0.07)) -> void:
	var sc: Node3D = load("res://models/human.glb").instantiate()
	add_child(sc)
	sk = sc.find_children("*", "Skeleton3D", true, false)[0]
	for i in sk.get_bone_count():
		bi[sk.get_bone_name(i)] = i
		rest[sk.get_bone_name(i)] = sk.get_bone_global_rest(i)
	# passage espace squelette -> repère du modèle : déduit des poses de liaison du skinning
	# (le maillage est recalé par elles ; le squelette importé est décalé d'environ 1 m)
	var t := Transform3D()
	for mi in sc.find_children("*", "MeshInstance3D", true, false):
		var skin: Skin = mi.skin
		if skin == null: continue
		for k in skin.get_bind_count():
			if skin.get_bind_name(k) == "pelvis":
				var rest_in_mesh := skin.get_bind_pose(k).affine_inverse()
				t = (mi as Node3D).transform * rest_in_mesh * (rest["pelvis"] as Transform3D).affine_inverse()
				break
		if t != Transform3D(): break
	m2s = t.affine_inverse()
	var mat_for := {}
	for nm in ["Veste", "Pantalon", "Gants"]:
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/ski_wear.gdshader")
		m.set_shader_parameter("part", ["Veste", "Pantalon", "Gants"].find(nm))
		m.set_shader_parameter("main_color", jacket if nm == "Veste" else pants)
		m.set_shader_parameter("accent", Color(0.05, 0.06, 0.08) if nm == "Veste" else Color(0.55, 0.57, 0.6))
		mat_for[nm] = m
	for mi in sc.find_children("*", "MeshInstance3D", true, false):
		meshes.append(mi)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		for nm in mat_for:
			if String(mi.name).begins_with(nm): mi.material_override = mat_for[nm]
	cloth = mat_for["Veste"]
	var P := func(nb: String) -> Vector3: return t * (rest[nb] as Transform3D).origin
	var pelvis: Vector3 = P.call("pelvis")
	var head_j: Vector3 = P.call("head")
	var top := head_j.y + 0.2
	for mi in meshes:
		if String(mi.name) == "Human": top = (mi.transform * mi.get_aabb()).end.y
	dims = {
		"thigh": P.call("calf_l").distance_to(P.call("thigh_l")), "shin": P.call("foot_l").distance_to(P.call("calf_l")),
		"upper": P.call("lowerarm_l").distance_to(P.call("upperarm_l")), "fore": P.call("hand_l").distance_to(P.call("lowerarm_l")),
		"shoulder": P.call("upperarm_l") - pelvis, "head": Vector3(0, (head_j.y + top) / 2.0 + 0.035 - pelvis.y, head_j.z - pelvis.z + 0.01),
		"ankle": P.call("foot_l").y + 0.02, "foot_len": Vector2(P.call("ball_l").x - P.call("foot_l").x, P.call("ball_l").z - P.call("foot_l").z).length(),
		"foot_drop": P.call("foot_l").y - P.call("ball_l").y, "head_r": (top - head_j.y) * 0.86,
	}
	_find_curls()
	_gear()

# ------------------------------------------------------------------ équipement
func _mat(c: Color, rough := 0.5, metal := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new(); m.albedo_color = c; m.roughness = rough; m.metallic = metal; return m

func _ski_mesh() -> ArrayMesh:
	# ski de 1,70 m : spatule relevée, talon, ligne de cote
	var bm := BoxMesh.new(); bm.size = Vector3(1, 1, 1); bm.subdivide_depth = 24
	var arr := bm.get_mesh_arrays()
	var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	for i in v.size():
		var z := v[i].z * 1.7
		var t := z / 0.85
		var w := 0.105 - 0.022 * cos(t * PI / 2.0)
		var y := v[i].y * 0.022
		if t > 0.72:
			var k := (t - 0.72) / 0.28; y += k * k * 0.11; w *= 1.0 - k * k * 0.35
		if t < -0.85:
			var k2 := (-t - 0.85) / 0.15; y += k2 * k2 * 0.03
		v[i] = Vector3(v[i].x * w, y + 0.011, z)
	arr[Mesh.ARRAY_VERTEX] = v
	var m := ArrayMesh.new(); m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var st := SurfaceTool.new(); st.create_from(m, 0); st.generate_normals(); return st.commit()

func _gear() -> void:
	var ski_m := _mat(Color(0.08, 0.32, 0.95), 0.3, 0.25)
	var boot_m := _mat(Color(0.11, 0.12, 0.14), 0.35, 0.1)
	var metal := _mat(Color(0.75, 0.77, 0.8), 0.3, 0.9)
	var ski_mesh := _ski_mesh()
	for sx in [-0.13, 0.13]:
		var ski := Node3D.new()
		var body := MeshInstance3D.new(); body.mesh = ski_mesh; body.material_override = ski_m; body.position.z = 0.05; ski.add_child(body)
		var bind := MeshInstance3D.new(); var bb := BoxMesh.new(); bb.size = Vector3(0.08, 0.04, 0.42); bind.mesh = bb; bind.material_override = metal; bind.position.y = 0.04; ski.add_child(bind)
		var shell := MeshInstance3D.new(); var sb := BoxMesh.new(); sb.size = Vector3(0.125, 0.1, 0.33); shell.mesh = sb; shell.material_override = boot_m; shell.position = Vector3(0, 0.1, 0.02); ski.add_child(shell)
		var cuff := MeshInstance3D.new(); var cm := CylinderMesh.new(); cm.top_radius = 0.082; cm.bottom_radius = 0.085; cm.height = 0.27; cuff.mesh = cm
		cuff.material_override = boot_m; cuff.position = Vector3(0, 0.26, -0.035); cuff.rotation.x = 0.25; ski.add_child(cuff)
		for by in [0.17, 0.27, 0.35]:
			var bk := MeshInstance3D.new(); var kb := BoxMesh.new(); kb.size = Vector3(0.03, 0.022, 0.06); bk.mesh = kb; bk.material_override = metal
			bk.position = Vector3(-0.075 if sx < 0 else 0.075, by, -(by - 0.17) * 0.2); ski.add_child(bk)
		ski.position.x = sx
		add_child(ski); skis.append(ski)
	# bâtons
	var grip_m := _mat(Color(0.05, 0.05, 0.06), 0.6)
	for s in 2:
		var pole := Node3D.new()
		var g := MeshInstance3D.new(); var gm := CylinderMesh.new(); gm.top_radius = 0.019; gm.bottom_radius = 0.016; gm.height = 0.15; g.mesh = gm; g.material_override = grip_m; pole.add_child(g)
		var sh := MeshInstance3D.new(); var shm := CylinderMesh.new(); shm.top_radius = 0.009; shm.bottom_radius = 0.007; shm.height = 1.15; sh.mesh = shm; sh.material_override = metal; sh.position.y = -0.6; pole.add_child(sh)
		var bs := MeshInstance3D.new(); var bsm := CylinderMesh.new(); bsm.top_radius = 0.045; bsm.bottom_radius = 0.045; bsm.height = 0.012; bs.mesh = bsm; bs.material_override = grip_m; bs.position.y = -1.07; pole.add_child(bs)
		add_child(pole); poles.append(pole)
	# casque et masque, fixés à l'os de la tête
	var att := BoneAttachment3D.new(); att.bone_name = "head"; sk.add_child(att)
	var hs := Node3D.new(); att.add_child(hs)
	head_socket = hs
	var hr: Transform3D = rest["head"]
	var s2m := m2s.affine_inverse()
	var want: Vector3 = m2s * (s2m * (rest["pelvis"] as Transform3D).origin + dims.head)
	hs.transform = Transform3D(hr.basis.inverse() * m2s.basis, hr.basis.inverse() * (want - hr.origin))
	hs.scale = Vector3.ONE * (dims.head_r / 0.118)
	var helmet := MeshInstance3D.new(); var hm := SphereMesh.new(); hm.radius = 0.128; hm.height = 0.135; hm.is_hemisphere = true
	helmet.mesh = hm; helmet.material_override = _mat(Color(0.93, 0.94, 0.96), 0.22, 0.05); helmet.position = Vector3(0, -0.005, -0.01); helmet.scale = Vector3(1.0, 1.0, 1.12); hs.add_child(helmet)
	var gog := MeshInstance3D.new(); var gc := CylinderMesh.new(); gc.top_radius = 0.123; gc.bottom_radius = 0.123; gc.height = 0.058; gc.cap_top = false; gc.cap_bottom = false
	gog.mesh = gc; var gmat := _mat(Color(1.0, 0.55, 0.1), 0.05, 0.9); gmat.cull_mode = BaseMaterial3D.CULL_DISABLED
	gog.material_override = gmat; gog.position = Vector3(0, -0.012, 0.004); gog.scale = Vector3(1, 1, 1.02); hs.add_child(gog)

# ------------------------------------------------------------------ doigts : poing fermé
func _find_curls() -> void:
	for nm in bi:
		var s: String = nm
		var ok := false
		for f in ["index_0", "middle_0", "ring_0", "pinky_0", "thumb_0"]:
			if s.begins_with(f) and not s.contains("leaf"): ok = true
		if not ok: continue
		var i: int = bi[s]
		var child := -1
		for c in sk.get_bone_children(i): child = c
		if child < 0: continue
		var base := sk.get_bone_rest(i).basis.get_rotation_quaternion()
		var best_axis := Vector3.RIGHT
		var best_y := INF
		for ax in [Vector3.RIGHT, Vector3.LEFT, Vector3.BACK, Vector3.FORWARD]:
			sk.set_bone_pose_rotation(i, base * Quaternion(ax, 0.6))
			var y := sk.get_bone_global_pose(child).origin.y
			if y < best_y: best_y = y; best_axis = ax
		sk.set_bone_pose_rotation(i, base)
		var ang := 0.45 if s.begins_with("thumb") else (1.25 if s.contains("_01") else 1.35)
		_curl[i] = base * Quaternion(best_axis, ang)
	for i in _curl: sk.set_bone_pose_rotation(i, _curl[i])

# ------------------------------------------------------------------ pose
static func _frame(dir: Vector3, pole: Vector3) -> Basis:
	var a := dir.normalized()
	var b := pole - a * pole.dot(a)
	if b.length_squared() < 1e-8: b = Vector3(0, 0, 1) - a * a.z
	b = b.normalized()
	return Basis(a, b, a.cross(b))

func _gpose(n: String) -> Transform3D: return sk.get_bone_global_pose(bi[n])

func _set_q(n: String, qd: Basis) -> void:
	var i: int = bi[n]
	var par := sk.get_bone_parent(i)
	var pb := sk.get_bone_global_pose(par).basis if par >= 0 else Basis()
	sk.set_bone_pose_rotation(i, (pb.inverse() * qd).get_rotation_quaternion())

func _aim(n: String, child: String, target: Vector3, rest_pole: Vector3, pole: Vector3) -> void:
	var r: Transform3D = rest[n]
	var rc: Transform3D = rest[child]
	var fr := _frame(rc.origin - r.origin, rest_pole)
	var ft := _frame(target - _gpose(n).origin, pole)
	_set_q(n, ft * fr.inverse() * r.basis)

static func _rx(a: float) -> Basis: return Basis(Vector3.RIGHT, a)
static func _rz(a: float) -> Basis: return Basis(Vector3.BACK, a)

## crouch 0..1, lean (rad), tuck 0..1, t (s), push, brake, plant 0..1, plant_side -1/1, crash 0/1
## vue subjective : tête, casque et veste masqués (la caméra est dedans) ; on garde jambes, gants, bâtons et skis
func set_first_person(on: bool) -> void:
	head_socket.visible = not on
	for mi in meshes:
		if String(mi.name).begins_with("Human") or String(mi.name).begins_with("Veste"): mi.visible = not on

## position des yeux (repère monde)
func eye_position() -> Vector3:
	# articulation de la tête (espace squelette -> repère du skieur), puis yeux un peu au-dessus et devant
	var h := m2s.affine_inverse() * sk.get_bone_global_pose(bi["head"]).origin
	return global_transform * (h + Vector3(0, 0.08, 0.06))

func pose(crouch: float, lean: float, tuck: float, t: float, push: float, brake: float, plant: float, plant_side: int, crash: float) -> void:
	var a := 0.42 + crouch * 0.6 + tuck * 0.45
	var lt: float = dims.thigh
	var ls: float = dims.shin
	var ankle_y: float = dims.ankle + 0.075
	var lean_t := Transform3D(_rz(lean), Vector3.ZERO)
	var hips_pos := Vector3(-lean * 0.12, ankle_y + (lt + ls) * cos(a) * 0.97, -sin(a) * 0.17)
	var hips_t := lean_t * Transform3D(_rx(a * 0.35), hips_pos)
	var torso_t := hips_t * Transform3D(_rx(0.18 + a * 0.12 + tuck * 0.85) * _rz(-lean * 0.55), Vector3.ZERO)
	var hx := -(0.18 + a * 0.42 + tuck * 0.6) * 0.8
	var head_t := torso_t * Transform3D(_rx(hx) * _rz(lean * 0.3), dims.head)
	var plough := brake * 0.13
	var ski_t: Array[Transform3D] = []
	for s in 2:
		var sx := (0.13 + brake * 0.07) * (-1.0 if s == 0 else 1.0)
		var tr := lean_t * Transform3D(Basis(Vector3.UP, plough if s == 0 else -plough), Vector3(sx, 0, 0))
		ski_t.append(tr)
		skis[s].transform = tr
	var swing := sin(t * 5.0) * push
	var elbow := []
	var wrist := []
	var upper_b := []
	var lower_b := []
	for s in 2:
		var sg := -1.0 if s == 0 else 1.0
		var pl := sin(minf(1.0, plant) * PI) if plant_side == int(sg) else 0.0
		var ux := -0.55 - tuck * 0.85 + swing * 0.9 - pl * 0.55
		var uz := sg * (0.3 - tuck * 0.18) + (sg * sin(t * 11.0 + s) * 1.2 * crash)
		var sh: Vector3 = dims.shoulder
		var up_t := torso_t * Transform3D(_rx(ux) * _rz(uz), Vector3(sg * sh.x, sh.y, sh.z))
		var lo_t := up_t * Transform3D(_rx(-0.8 - tuck * 0.55 + pl * 0.35), Vector3(0, -dims.upper, 0))
		var wr_t := lo_t * Transform3D(_rx(1.3 + tuck * 0.95 - swing * 0.7 - pl * 0.9), Vector3(0, -dims.fore, 0))
		elbow.append(lo_t.origin); wrist.append(wr_t.origin); upper_b.append(up_t.basis); lower_b.append(lo_t.basis)
		poles[s].transform = wr_t * Transform3D(_rz(-sg * 0.12), Vector3.ZERO)
	# ---- recopie sur le squelette (pilote exprimé dans le repère du modèle -> espace squelette)
	hips_t = m2s * hips_t; torso_t = m2s * torso_t; head_t = m2s * head_t
	for s in 2:
		ski_t[s] = m2s * (ski_t[s] as Transform3D)
		elbow[s] = m2s * (elbow[s] as Vector3); wrist[s] = m2s * (wrist[s] as Vector3)
		upper_b[s] = m2s.basis * (upper_b[s] as Basis); lower_b[s] = m2s.basis * (lower_b[s] as Basis)
	var L := func(x: String) -> String: return x + "_l"
	var R := func(x: String) -> String: return x + "_r"
	var p_par := sk.get_bone_parent(bi["pelvis"])
	var pinv := sk.get_bone_global_pose(p_par).affine_inverse() if p_par >= 0 else Transform3D()
	sk.set_bone_pose_position(bi["pelvis"], pinv * hips_t.origin)
	_set_q("pelvis", hips_t.basis * (rest["pelvis"] as Transform3D).basis)
	var qh := hips_t.basis.get_rotation_quaternion()
	var qt := torso_t.basis.get_rotation_quaternion()
	var qhd := head_t.basis.get_rotation_quaternion()
	_set_q("spine_01", Basis(qh.slerp(qt, 0.4)) * (rest["spine_01"] as Transform3D).basis)
	_set_q("spine_02", Basis(qh.slerp(qt, 0.75)) * (rest["spine_02"] as Transform3D).basis)
	_set_q("spine_03", Basis(qt) * (rest["spine_03"] as Transform3D).basis)
	_set_q("neck_01", Basis(qt.slerp(qhd, 0.5)) * (rest["neck_01"] as Transform3D).basis)
	_set_q("head", Basis(qhd) * (rest["head"] as Transform3D).basis)
	for s in 2:
		var side: Callable = L if s == 1 else R          # bras 1 = gauche (+X)
		_aim(side.call("upperarm"), side.call("lowerarm"), elbow[s], Vector3.FORWARD, (upper_b[s] as Basis) * Vector3.FORWARD)
		_aim(side.call("lowerarm"), side.call("hand"), wrist[s], Vector3.BACK, (lower_b[s] as Basis) * Vector3.BACK)
	# jambes : IK à deux os vers la chaussure
	for s in 2:
		var side: Callable = L if s == 1 else R
		var st: Transform3D = ski_t[s]
		var fwd := st.basis * Vector3.BACK
		var upv := st.basis * Vector3.UP
		var ankle := st * Vector3(0, ankle_y, -0.045)
		var hip := _gpose(side.call("thigh")).origin
		var dv := ankle - hip
		var dist := minf(dv.length(), (lt + ls) * 0.999)
		dv = dv.normalized()
		var kp := fwd + Vector3(1, 0, 0) * (-lean * 0.5)
		kp = (kp - dv * kp.dot(dv)).normalized()
		var ca := (lt * lt + dist * dist - ls * ls) / (2.0 * lt * dist)
		var along := lt * clampf(ca, -1.0, 1.0)
		var hgt := sqrt(maxf(0.0, lt * lt - along * along))
		var knee := hip + dv * along + kp * hgt
		var ankle_t := hip + dv * dist
		_aim(side.call("thigh"), side.call("calf"), knee, Vector3.BACK, kp)
		_aim(side.call("calf"), side.call("foot"), ankle_t, Vector3.BACK, kp)
		_aim(side.call("foot"), side.call("ball"), ankle_t + fwd * dims.foot_len - upv * dims.foot_drop, Vector3.UP, upv)
