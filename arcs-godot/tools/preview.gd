## Aperçu d'un modèle : godot --path . res://tools/preview.tscn -- --model=res://models/human.glb --shot=out.png [--yaw=0] [--dist=3] [--y=1]
extends Node3D
var args := {}
var frames := 0
func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.trim_prefix("--").split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var env := Environment.new()
	var sky := Sky.new(); var sm := ProceduralSkyMaterial.new(); sky.sky_material = sm
	env.background_mode = Environment.BG_SKY; env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY; env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new(); we.environment = env; add_child(we)
	var sun := DirectionalLight3D.new(); sun.light_energy = 2.5; sun.shadow_enabled = true; add_child(sun)
	sun.look_at_from_position(Vector3.ZERO, Vector3(-0.6, -0.5, -0.6), Vector3.UP)
	var g := MeshInstance3D.new(); var pm := PlaneMesh.new(); pm.size = Vector2(20, 20); g.mesh = pm; add_child(g)
	var m: Node3D = load(args.get("model", "res://models/human.glb")).instantiate()
	m.rotation.y = deg_to_rad(float(args.get("yaw", "0")))
	add_child(m)
	if args.has("print"):
		for sk in m.find_children("*", "Skeleton3D", true, false):
			var names := []
			for i in sk.get_bone_count(): names.append(sk.get_bone_name(i))
			print("BONES ", names)
			for n in ["pelvis", "thigh_l", "calf_l", "foot_l", "ball_l", "upperarm_l", "hand_l", "head", "spine_01"]:
				var i: int = sk.find_bone(n)
				if i >= 0: print(n, " ", sk.get_bone_global_rest(i).origin)
		for mi in m.find_children("*", "MeshInstance3D", true, false): print("MESH ", mi.name, " ", mi.get_aabb())
	var cam := Camera3D.new(); add_child(cam)
	var d := float(args.get("dist", "3.2")); var y := float(args.get("y", "1.0"))
	cam.position = Vector3(0, y + 0.1, d); cam.look_at(Vector3(0, y, 0)); cam.fov = 35
func _process(_d: float) -> void:
	frames += 1
	if frames == 8:
		get_viewport().get_texture().get_image().save_png(args.get("shot", "user://preview.png"))
		get_tree().quit()
