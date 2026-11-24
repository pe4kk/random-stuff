## Les Arcs — Arc 1600 : scène principale (construite par code).
## Mode capture : godot --path . -- --shot=res://out.png --cam=x,y,z --look=x,y,z [--frames=8]
extends Node3D

var core: HeightField
var mid: HeightField
var far: HeightField
var terrain: Terrain
var mask: Mask
var forest: Forest
var skier: Skier
var body: Node3D
var hud: Label
var camera: Camera3D
var cam_mode := 0
var cam_pos := Vector3.ZERO
var cam_look := Vector3.ZERO
var cam_dir := Vector3.FORWARD
var acc := 0.0
var spawn := Vector3.ZERO
var spawn_yaw := 0.0
const STEP := 1.0 / 120.0
var sun: DirectionalLight3D
var args := {}
var frames := 0
const SUN_DIR := Vector3(0.76, 0.375, 0.53)   # matin, soleil au sud-est, 22° au-dessus de l'horizon

func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.trim_prefix("--").split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	core = HeightField.new("res://data/core_h.f32", 2048, 2048.0)
	mid = HeightField.new("res://data/mid_h.f32", 1024, 8192.0)
	far = HeightField.new("res://data/far_h.f32", 2048, 40960.0)
	_environment()
	var tex := {
		"core_mask": load("res://data/core_mask.png"), "mid_forest": load("res://data/mid_forest.png"),
		"groom": _groom_texture(),
		"snow_alb": load("res://textures/snow_02_diffuse.jpg"), "snow_nrm": load("res://textures/snow_02_nor_gl.jpg"),
		"snow_rgh": load("res://textures/snow_02_rough.jpg"),
		"rock_alb": load("res://textures/rock_face_diffuse.jpg"), "rock_nrm": load("res://textures/rock_face_nor_gl.jpg"),
		"arock_alb": load("res://textures/aerial_rocks_02_diffuse.jpg"), "arock_nrm": load("res://textures/aerial_rocks_02_nor_gl.jpg"),
		"sun_dir": SUN_DIR,
	}
	terrain = Terrain.new(core, mid, far, tex)
	add_child(terrain)
	mask = Mask.new("res://data/core_mask.png")
	forest = Forest.new("res://data/trees.f32", core, mask)
	add_child(forest)
	skier = Skier.new(core, mask, forest)
	_find_spawn()
	skier.place(spawn.x, spawn.z, spawn_yaw)
	body = _placeholder_skier()
	add_child(body)
	_inputs()
	var cl := CanvasLayer.new(); add_child(cl)
	hud = Label.new(); hud.position = Vector2(30, 24)
	hud.add_theme_font_size_override("font_size", 30)
	hud.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.6)); hud.add_theme_constant_override("outline_size", 6)
	cl.add_child(hud)
	camera = Camera3D.new()
	camera.fov = 62.0
	camera.near = 0.3
	camera.far = 120000.0
	add_child(camera)
	if args.has("cam"):
		var cam := _vec(args["cam"])
		if cam.y == 0.0: cam.y = _ground(cam.x, cam.z) + 3.0
		camera.position = cam
		var look := _vec(args.get("look", "700,0,0"))
		if look.y == 0.0: look.y = _ground(look.x, look.z) + 1.0
		camera.look_at(look)
	else:
		# mode capture du jeu : on laisse le skieur descendre quelques secondes (pilote simple)
		var sim := float(args.get("sim", "0"))
		var tsim := 0.0
		while tsim < sim:
			skier.step(STEP, {"steer": sin(tsim * 0.9) * 0.6, "tuck": 0.0, "brake": 0.0, "push": 0.0, "jump": false})
			tsim += STEP
		if args.has("cammode"): cam_mode = int(args["cammode"])
		_update_camera(1.0, true)
	terrain.update(camera.position)

func _vec(s: String) -> Vector3:
	var p := s.split(",")
	return Vector3(float(p[0]), float(p[1]), float(p[2]))

func _ground(x: float, z: float) -> float:
	if core.inside(x, z, 10.0): return core.height(x, z)
	if mid.inside(x, z, 10.0): return mid.height(x, z)
	return far.height(x, z)

func _groom_texture() -> ImageTexture:
	var b := FileAccess.get_file_as_bytes("res://data/groom.f32")
	return ImageTexture.create_from_image(Image.create_from_data(1024, 1024, false, Image.FORMAT_RGF, b))

func _environment() -> void:
	# ciel d'altitude par beau temps froid : bleu profond au zénith, horizon pâle et laiteux
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.16, 0.36, 0.72)
	sky_mat.sky_horizon_color = Color(0.66, 0.76, 0.88)
	sky_mat.sky_curve = 0.09
	sky_mat.sky_energy_multiplier = 1.25
	sky_mat.ground_bottom_color = Color(0.36, 0.38, 0.42)
	sky_mat.ground_horizon_color = Color(0.66, 0.74, 0.84)
	sky_mat.ground_curve = 0.05
	sky_mat.sun_angle_max = 8.0
	sky_mat.sun_curve = 0.06
	var sky := Sky.new()
	sky.sky_material = sky_mat
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.1
	env.tonemap_white = 6.0
	env.ambient_light_energy = 1.05
	env.ambient_light_sky_contribution = 0.75
	env.ambient_light_color = Color(0.78, 0.83, 0.92)
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.08
	env.ssao_enabled = true
	env.ssao_radius = 2.0
	env.ssao_intensity = 1.5
	env.glow_enabled = true
	env.glow_intensity = 0.25
	env.glow_hdr_threshold = 1.4
	# perspective aérienne : les montagnes lointaines prennent la couleur du ciel ; brume froide dans la vallée
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_density = 0.00011
	env.fog_aerial_perspective = 0.85
	env.fog_sky_affect = 0.0
	env.fog_light_color = Color(0.7, 0.78, 0.9)
	env.fog_sun_scatter = 0.12
	env.fog_height = 1250.0
	env.fog_height_density = 0.0012
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.light_color = Color(1.0, 0.95, 0.88)
	sun.light_energy = 3.2
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 600.0
	sun.directional_shadow_blend_splits = true
	add_child(sun)
	sun.look_at_from_position(Vector3.ZERO, -SUN_DIR, Vector3.UP)

func _process(dt: float) -> void:
	dt = minf(dt, 0.05)
	if not args.has("cam"):
		if Input.is_action_just_pressed("reset"): skier.place(spawn.x, spawn.z, spawn_yaw)
		if Input.is_action_just_pressed("camera"): cam_mode = (cam_mode + 1) % 3
		if Input.is_action_just_pressed("quit"): get_tree().quit()
		var inp := {
			"steer": Input.get_axis("left", "right"), "tuck": Input.get_action_strength("tuck"),
			"brake": Input.get_action_strength("brake"), "push": Input.get_action_strength("tuck"), "jump": Input.is_action_pressed("jump"),
		}
		if not args.has("shot"):
			acc += dt
			while acc >= STEP:
				skier.step(STEP, inp); acc -= STEP
		skier.events.clear()
		_update_body(dt)
		_update_camera(dt, false)
		hud.text = "%d km/h   ·   %d m" % [roundi(skier.speed() * 3.6), roundi(skier.pos.y)]
		if skier.crash_t > 0.0: hud.text += "   ·   " + skier.crash_msg + "  (R : recommencer)"
	terrain.update(camera.position)
	frames += 1
	if args.has("shot") and frames == int(args.get("frames", "8")):
		get_viewport().get_texture().get_image().save_png(args["shot"])
		print("capture : ", args["shot"])
		get_tree().quit()

# --------------------------------------------------------------- jeu
func _find_spawn() -> void:
	var f = JSON.parse_string(FileAccess.get_file_as_string("res://data/features.json"))
	var best: Array = []
	for p in f["pistes"]:
		if p["name"] == "Mont-Blanc" and p["pts"].size() > best.size(): best = p["pts"]
	var a: Array = best[0]
	var k := 1
	while k < best.size() - 1 and Vector2(best[k][0] - a[0], best[k][1] - a[1]).length() < 25.0: k += 1
	var p0: Array = best[k]
	var p1: Array = best[k + 1]
	spawn = Vector3(p0[0], 0, p0[1])
	spawn_yaw = atan2(p1[0] - p0[0], p1[1] - p0[1])

func _inputs() -> void:
	var keys := {"left": [KEY_LEFT, KEY_A, KEY_Q], "right": [KEY_RIGHT, KEY_D], "tuck": [KEY_UP, KEY_W, KEY_Z], "brake": [KEY_DOWN, KEY_S],
		"jump": [KEY_SPACE], "reset": [KEY_R], "camera": [KEY_C], "quit": [KEY_ESCAPE]}
	for act in keys:
		if not InputMap.has_action(act): InputMap.add_action(act, 0.15)
		for k in keys[act]:
			var e := InputEventKey.new(); e.physical_keycode = k; InputMap.action_add_event(act, e)
	var pads := {"left": [JOY_AXIS_LEFT_X, -1.0], "right": [JOY_AXIS_LEFT_X, 1.0], "tuck": [JOY_AXIS_TRIGGER_RIGHT, 1.0], "brake": [JOY_AXIS_TRIGGER_LEFT, 1.0]}
	for act in pads:
		var j := InputEventJoypadMotion.new(); j.axis = pads[act][0]; j.axis_value = pads[act][1]; InputMap.action_add_event(act, j)
	var b := InputEventJoypadButton.new(); b.button_index = JOY_BUTTON_A; InputMap.action_add_event("jump", b)

## skieur provisoire (remplacé à l'étape 2 par le personnage articulé)
func _placeholder_skier() -> Node3D:
	var root := Node3D.new()
	var suit := StandardMaterial3D.new(); suit.albedo_color = Color(0.75, 0.1, 0.12); suit.roughness = 0.6
	var dark := StandardMaterial3D.new(); dark.albedo_color = Color(0.08, 0.09, 0.12); dark.roughness = 0.7
	var ski_m := StandardMaterial3D.new(); ski_m.albedo_color = Color(0.1, 0.3, 0.9); ski_m.roughness = 0.3; ski_m.metallic = 0.2
	var helmet := StandardMaterial3D.new(); helmet.albedo_color = Color(0.92, 0.93, 0.95); helmet.roughness = 0.25
	for sx in [-0.12, 0.12]:
		var ski := MeshInstance3D.new(); var bm := BoxMesh.new(); bm.size = Vector3(0.09, 0.025, 1.7); ski.mesh = bm
		ski.material_override = ski_m; ski.position = Vector3(sx, 0.015, 0.05); root.add_child(ski)
		var leg := MeshInstance3D.new(); var cm := CapsuleMesh.new(); cm.radius = 0.08; cm.height = 0.85; leg.mesh = cm
		leg.material_override = dark; leg.position = Vector3(sx * 0.9, 0.5, 0.05); leg.rotation.x = -0.35; root.add_child(leg)
	var torso := MeshInstance3D.new(); var tm := CapsuleMesh.new(); tm.radius = 0.19; tm.height = 0.75; torso.mesh = tm
	torso.material_override = suit; torso.position = Vector3(0, 1.15, 0.12); torso.rotation.x = 0.35; root.add_child(torso)
	var head := MeshInstance3D.new(); var sm := SphereMesh.new(); sm.radius = 0.13; sm.height = 0.26; head.mesh = sm
	head.material_override = helmet; head.position = Vector3(0, 1.6, 0.3); root.add_child(head)
	return root

func _update_body(dt: float) -> void:
	var up := skier.normal if skier.grounded else Vector3.UP
	var fwd := Vector3(sin(skier.yaw), 0, cos(skier.yaw))
	fwd = (fwd - up * fwd.dot(up)).normalized()
	var left := up.cross(fwd)
	var b := Basis(left, up, fwd)
	b = b * Basis(Vector3(0, 0, 1), -skier.lean)
	if skier.crash_t > 0.0: b = b * Basis.from_euler(skier.tumble)
	body.global_transform = Transform3D(b, skier.pos)

func _update_camera(dt: float, snap: bool) -> void:
	var p := skier.pos
	var head := Vector3(sin(skier.yaw), 0, cos(skier.yaw))
	var sp := skier.speed()
	var want := head
	if sp > 2.5: want = Vector3(skier.vel.x, 0, skier.vel.z).normalized().lerp(head, 0.3).normalized()
	cam_dir = want if snap else cam_dir.lerp(want, minf(1.0, dt * 2.5)).normalized()
	var target: Vector3
	var look: Vector3
	if cam_mode == 2:
		target = p + Vector3(0, 1.32, 0) - head * 0.75
		look = target + head * 10.0 + Vector3(0, -3.7, 0)
	else:
		var dist := (8.0 + sp * 0.08) if cam_mode == 0 else 18.0
		var height := 4.8 if cam_mode == 0 else 10.0
		target = p - cam_dir * dist
		target.y = maxf(p.y + height, core.height(target.x, target.z) + 1.5)
		look = p + cam_dir * 6.0 + Vector3(0, 0.9, 0)
	var k := 1.0 if snap else minf(1.0, dt * (30.0 if cam_mode == 2 else 6.0))
	cam_pos = cam_pos.lerp(target, k)
	cam_look = look if snap else cam_look.lerp(look, minf(1.0, dt * 10.0))
	camera.position = cam_pos
	camera.look_at(cam_look)
	camera.fov = lerpf(camera.fov, (74.0 if cam_mode == 2 else 62.0) + minf(16.0, sp * 0.45), 1.0 if snap else minf(1.0, dt * 2.0))
