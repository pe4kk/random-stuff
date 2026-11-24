## Les Arcs — Arc 1600 : scène principale (construite par code).
## Mode capture : godot --path . -- --shot=res://out.png --cam=x,y,z --look=x,y,z [--frames=8]
extends Node3D

var core: HeightField
var mid: HeightField
var far: HeightField
var terrain: Terrain
var camera: Camera3D
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
	camera = Camera3D.new()
	camera.fov = 62.0
	camera.near = 0.3
	camera.far = 120000.0
	add_child(camera)
	var cam := _vec(args.get("cam", "780,0,180"))
	if cam.y == 0.0: cam.y = _ground(cam.x, cam.z) + 3.0
	camera.position = cam
	var look := _vec(args.get("look", "700,0,0"))
	if look.y == 0.0: look.y = _ground(look.x, look.z) + 1.0
	camera.look_at(look)
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
	env.ambient_light_energy = 1.5
	env.ambient_light_sky_contribution = 0.55
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

func _process(_dt: float) -> void:
	terrain.update(camera.position)
	frames += 1
	if args.has("shot") and frames == int(args.get("frames", "8")):
		get_viewport().get_texture().get_image().save_png(args["shot"])
		print("capture : ", args["shot"])
		get_tree().quit()
