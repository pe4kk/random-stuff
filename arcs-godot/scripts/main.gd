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
var body: SkierBody
var crouch := 0.2
var hud: Label
var hud_speed: Label
var hud_piste: Label
var hud_msg: Label
var tracks: Tracks
var spray: GPUParticles3D
var map_view: MapView
var mini_map: MapView
var pause_panel: PanelContainer
var paused := false
var cam_zoom := 1.0
var features: Dictionary
var lifts: Array = []
var _piste_grid := {}
var _msg_t := 0.0
var audio: SkiAudio
var _plant_prev := 1.0
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
	body = SkierBody.new()
	add_child(body)
	tracks = Tracks.new(SUN_DIR)
	add_child(tracks)
	spray = _make_spray()
	add_child(spray)
	_index_pistes()
	audio = SkiAudio.new()
	add_child(audio)
	_inputs()
	_build_ui()
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
		var since := 0.0
		while tsim < sim:
			skier.step(STEP, {"steer": sin(tsim * 0.9) * 0.6, "tuck": 0.0, "brake": 0.0, "push": 0.0, "jump": false})
			tsim += STEP
			since += STEP
			if since > 0.05:
				since = 0.0
				_update_body(0.05)
				_update_snow_fx()
		if args.has("cammode"): cam_mode = int(args["cammode"])
		_update_body(1.0)
		_update_camera(1.0, true)
		if args.has("side"):
			var hd := Vector3(sin(skier.yaw), 0, cos(skier.yaw))
			var sd := Vector3(hd.z, 0, -hd.x)
			camera.position = skier.pos + sd * 3.2 + hd * 1.8 + Vector3(0, 1.1, 0)
			camera.look_at(skier.pos + Vector3(0, 0.8, 0))
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

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed and not map_view.visible:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP: cam_zoom = clampf(cam_zoom / 1.1, 0.5, 2.5)
		if e.button_index == MOUSE_BUTTON_WHEEL_DOWN: cam_zoom = clampf(cam_zoom * 1.1, 0.5, 2.5)

func _process(dt: float) -> void:
	dt = minf(dt, 0.05)
	if not args.has("cam"):
		if Input.is_action_just_pressed("quit"):
			if map_view.visible: _toggle_map(false)
			else: _toggle_pause(not paused)
		if Input.is_action_just_pressed("map"): _toggle_map(not map_view.visible)
		if Input.is_action_just_pressed("reset") and not paused: _restart()
		if Input.is_action_just_pressed("camera"): cam_mode = (cam_mode + 1) % 3
		var frozen := paused or map_view.visible
		var inp := {
			"steer": Input.get_axis("left", "right"), "tuck": Input.get_action_strength("tuck"),
			"brake": Input.get_action_strength("brake"), "push": Input.get_action_strength("tuck"), "jump": Input.is_action_pressed("jump"),
		}
		if not args.has("shot") and not frozen:
			acc += dt
			while acc >= STEP:
				skier.step(STEP, inp); acc -= STEP
		if Input.is_action_just_pressed("fullscreen"):
			var w := get_window()
			w.mode = Window.MODE_WINDOWED if w.mode == Window.MODE_FULLSCREEN or w.mode == Window.MODE_EXCLUSIVE_FULLSCREEN else Window.MODE_FULLSCREEN
		if Input.is_action_just_pressed("mute"):
			audio.toggle_mute(); _message("Son coupé" if audio.muted else "Son activé", 1.2)
		for ev in skier.events:
			if ev == "crash":
				_message(skier.crash_msg + "   (R : recommencer)", 2.5); audio.play("crash", 0.9)
			if ev == "land": audio.play("land", clampf(skier.speed() / 15.0, 0.3, 1.0))
			if ev == "edgewarn": _message("Attention : les carres décrochent !", 1.0)
		skier.events.clear()
		if not args.has("side"):
			_update_body(dt)
			_update_camera(dt, false)
		_update_snow_fx()
		_update_hud(dt)
		if skier.plant < _plant_prev - 0.5: audio.play("pole", 0.5)
		_plant_prev = skier.plant
		audio.update(dt, skier.speed(), skier.carve, skier.skid, skier.on_piste, skier.grounded, skier.crash_t > 0.0, frozen)
	terrain.update(camera.position)
	frames += 1
	if args.has("shot") and frames == int(args.get("frames", "8")):
		get_viewport().get_texture().get_image().save_png(args["shot"])
		print("capture : ", args["shot"])
		get_tree().quit()

# --------------------------------------------------------------- jeu
func _find_spawn() -> void:
	features = JSON.parse_string(FileAccess.get_file_as_string("res://data/features.json"))
	var f := features
	for l in f["lifts"]:
		var pts: Array = l["pts"]
		lifts.append({"name": l["name"], "top": Vector2(pts[-1][0], pts[-1][1]), "bottom": Vector2(pts[0][0], pts[0][1])})
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
		"jump": [KEY_SPACE], "reset": [KEY_R], "camera": [KEY_C], "quit": [KEY_ESCAPE], "map": [KEY_M], "mute": [KEY_N], "fullscreen": [KEY_F11]}
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
	var p := skier.pos
	if skier.crash_t > 0.0:
		b = b * Basis.from_euler(skier.tumble); p.y += 0.3
	body.global_transform = Transform3D(b, p)
	var ct := 0.15 + skier.carve * 0.35 + maxf(0.0, -skier.compress) * 0.6 + maxf(0.0, skier.compress) * 0.5 + (0.0 if skier.grounded else 0.25)
	crouch += (ct - crouch) * minf(1.0, dt * 8.0)
	body.pose(crouch, -skier.lean, skier.tuck, skier.t, skier.push, skier.brake, skier.plant, skier.plant_side, 1.0 if skier.crash_t > 0.0 else 0.0)

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
		var dist := ((8.0 + sp * 0.08) if cam_mode == 0 else 18.0) * cam_zoom
		var height := (4.8 if cam_mode == 0 else 10.0) * cam_zoom
		target = p - cam_dir * dist
		target.y = maxf(p.y + height, core.height(target.x, target.z) + 1.5)
		look = p + cam_dir * 6.0 + Vector3(0, 0.9, 0)
	var k := 1.0 if snap else minf(1.0, dt * (30.0 if cam_mode == 2 else 6.0))
	cam_pos = cam_pos.lerp(target, k)
	cam_look = look if snap else cam_look.lerp(look, minf(1.0, dt * 10.0))
	camera.position = cam_pos
	camera.look_at(cam_look)
	camera.fov = lerpf(camera.fov, (74.0 if cam_mode == 2 else 62.0) + minf(16.0, sp * 0.45), 1.0 if snap else minf(1.0, dt * 2.0))

# --------------------------------------------------------------- neige : traces et gerbes
func _make_spray() -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = 400
	p.lifetime = 0.9
	p.local_coords = false
	p.emitting = false
	var m := ParticleProcessMaterial.new()
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	m.emission_sphere_radius = 0.18
	m.direction = Vector3(0, 1, 0)
	m.spread = 55.0
	m.initial_velocity_min = 1.2
	m.initial_velocity_max = 3.8
	m.gravity = Vector3(0, -5.5, 0)
	m.damping_min = 1.5; m.damping_max = 3.0
	m.scale_min = 0.5; m.scale_max = 1.6
	var fade := Gradient.new(); fade.set_color(0, Color(1, 1, 1, 0.85)); fade.set_color(1, Color(1, 1, 1, 0))
	var gt := GradientTexture1D.new(); gt.gradient = fade
	m.color_ramp = gt
	p.process_material = m
	var q := QuadMesh.new(); q.size = Vector2(0.14, 0.14)
	var sm := StandardMaterial3D.new()
	sm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm.vertex_color_use_as_albedo = true
	sm.albedo_color = Color(0.95, 0.97, 1.0)
	var dot := GradientTexture2D.new(); dot.fill = GradientTexture2D.FILL_RADIAL; dot.fill_from = Vector2(0.5, 0.5); dot.fill_to = Vector2(1.0, 0.5)
	var g := Gradient.new(); g.set_color(0, Color(1, 1, 1, 1)); g.set_color(1, Color(1, 1, 1, 0)); dot.gradient = g
	sm.albedo_texture = dot
	q.material = sm
	p.draw_pass_1 = q
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return p

func _update_snow_fx() -> void:
	var sp := skier.speed()
	var on := skier.grounded and skier.crash_t <= 0.0 and sp > 0.5
	var b := body.global_transform
	if on:
		var side := b.basis.x
		var pts := []
		for s in 2:
			var ski: Node3D = body.skis[s]
			var w := ski.global_transform * Vector3(0, 0, -0.3)
			w.y = core.height(w.x, w.z)
			pts.append(w)
		tracks.add(pts, side, (0.26 + skier.skid * 0.35) * (1.5 - skier.on_piste * 0.5), 1.0 - skier.on_piste * 0.15)
	else:
		tracks.reset()
	var inten := skier.skid * minf(1.0, sp / 5.0) + skier.carve * 0.35 + (1.0 - skier.on_piste) * minf(1.0, sp / 12.0) * 0.5
	if skier.crash_t > 0.0 and sp > 2.0: inten = 0.6
	spray.emitting = (on or skier.crash_t > 0.0) and inten > 0.04
	spray.amount_ratio = clampf(inten, 0.05, 1.0)
	spray.global_position = skier.pos + Vector3(0, 0.15, 0)
	var pm := spray.process_material as ParticleProcessMaterial
	var outward := skier.normal.cross(skier.vel).normalized() * (-1.0 if skier.lean > 0.0 else 1.0)
	var dir := (skier.vel * 0.15 + outward * 0.8 + Vector3(0, 1, 0)).normalized()
	pm.direction = dir

# --------------------------------------------------------------- interface
func _label(size: int, col := Color(1, 1, 1)) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.55))
	l.add_theme_constant_override("outline_size", 7)
	return l

func _build_ui() -> void:
	var cl := CanvasLayer.new(); add_child(cl)
	var root := Control.new(); root.set_anchors_preset(Control.PRESET_FULL_RECT); root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cl.add_child(root)
	hud = _label(15)       # rappel des commandes, en bas
	hud.text = "←→ tourner · ↑ schuss · ↓ freiner · Espace saut · R recommencer · C caméra · molette zoom · M plan · N son · Échap menu"
	hud.set_anchors_preset(Control.PRESET_CENTER_BOTTOM); hud.position = Vector2(-330, -30); root.add_child(hud)
	hud_piste = _label(24); hud_piste.set_anchors_preset(Control.PRESET_CENTER_TOP); hud_piste.position = Vector2(-120, 18); root.add_child(hud_piste)
	hud_speed = _label(40); hud_speed.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT); hud_speed.position = Vector2(-260, -150)
	hud_speed.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT; hud_speed.size = Vector2(230, 90); root.add_child(hud_speed)
	hud_msg = _label(30); hud_msg.set_anchors_preset(Control.PRESET_CENTER_TOP); hud_msg.position = Vector2(-330, 120); root.add_child(hud_msg)
	var maptex: Texture2D = load("res://data/map.png")
	mini_map = MapView.new(maptex, lifts, true)
	mini_map.set_anchors_preset(Control.PRESET_BOTTOM_LEFT); mini_map.position = Vector2(24, -244); mini_map.size = Vector2(220, 220)
	mini_map.mpp = 2.2
	root.add_child(mini_map)
	map_view = MapView.new(maptex, lifts, false)
	map_view.set_anchors_preset(Control.PRESET_FULL_RECT)
	map_view.visible = false
	map_view.teleport.connect(_spawn_at_lift)
	root.add_child(map_view)
	# menu pause
	pause_panel = PanelContainer.new()
	pause_panel.set_anchors_preset(Control.PRESET_CENTER)
	pause_panel.position = Vector2(-180, -170); pause_panel.size = Vector2(360, 340)
	var vb := VBoxContainer.new(); vb.add_theme_constant_override("separation", 12)
	pause_panel.add_child(vb)
	var title := _label(30); title.text = "Pause"; title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER; vb.add_child(title)
	for item in [["Reprendre", func(): _toggle_pause(false)], ["Recommencer en haut du Mont-Blanc", func(): _toggle_pause(false); _restart()],
			["Plan des pistes (M)", func(): _toggle_pause(false); _toggle_map(true)], ["Caméra suivante (C)", func(): cam_mode = (cam_mode + 1) % 3],
			["Quitter le jeu", func(): get_tree().quit()]]:
		var bt := Button.new(); bt.text = item[0]; bt.add_theme_font_size_override("font_size", 20); bt.custom_minimum_size = Vector2(320, 46)
		bt.pressed.connect(item[1]); vb.add_child(bt)
	pause_panel.visible = false
	root.add_child(pause_panel)

func _toggle_pause(on: bool) -> void:
	paused = on
	pause_panel.visible = on

func _toggle_map(on: bool) -> void:
	map_view.visible = on
	if on:
		map_view.center = Vector2(skier.pos.x, skier.pos.z)
		map_view.mpp = 2.4
		map_view.player = skier.pos; map_view.player_yaw = skier.yaw
		map_view.queue_redraw()

func _message(t: String, dur: float) -> void:
	hud_msg.text = t
	_msg_t = dur

func _restart() -> void:
	skier.place(spawn.x, spawn.z, spawn_yaw)
	tracks.reset()
	_message("Piste Mont-Blanc · Arc 1600 — bonne descente !", 2.5)

func _spawn_at_lift(i: int) -> void:
	var top: Vector2 = lifts[i].top
	var bottom: Vector2 = lifts[i].bottom
	# on part un peu en aval de la gare d'arrivée, face à la pente
	var n := core.normal(top.x, top.y, 6.0)
	var down := Vector2(n.x, n.z)
	if down.length() < 0.05: down = (top - bottom)
	down = down.normalized()
	var p := top + down * 22.0
	skier.place(p.x, p.y, atan2(down.x, down.y))
	tracks.reset()
	_toggle_map(false)
	_message("Sommet : " + str(lifts[i].name), 2.0)

const DIFF := {"novice": ["verte", Color(0.13, 0.64, 0.29)], "easy": ["bleue", Color(0.12, 0.44, 0.88)], "intermediate": ["rouge", Color(0.85, 0.15, 0.17)],
	"advanced": ["noire", Color(0.1, 0.1, 0.1)], "expert": ["noire", Color(0.1, 0.1, 0.1)], "freeride": ["itinéraire", Color(0.94, 0.54, 0.11)]}

func _index_pistes() -> void:
	for p in features["pistes"]:
		if p.get("area", false) or str(p["name"]) == "": continue
		var pts: Array = p["pts"]
		for k in pts.size() - 1:
			var a := Vector2(pts[k][0], pts[k][1])
			var b := Vector2(pts[k + 1][0], pts[k + 1][1])
			for q in [a, (a + b) / 2.0, b]:
				var key := Vector2i(floori(q.x / 32.0), floori(q.y / 32.0))
				if not _piste_grid.has(key): _piste_grid[key] = []
				_piste_grid[key].append([a, b, p["name"], p["diff"]])

func _piste_at(x: float, z: float) -> Array:
	var best := []
	var bd := 26.0
	var q := Vector2(x, z)
	for i in range(-1, 2):
		for j in range(-1, 2):
			for seg in _piste_grid.get(Vector2i(floori(x / 32.0) + i, floori(z / 32.0) + j), []):
				var d := Geometry2D.get_closest_point_to_segment(q, seg[0], seg[1]).distance_to(q)
				if d < bd: bd = d; best = seg
	return best

func _update_hud(dt: float) -> void:
	hud_speed.text = "%d km/h\n%d m" % [roundi(skier.speed() * 3.6), roundi(skier.pos.y)]
	var ps := _piste_at(skier.pos.x, skier.pos.z)
	if ps.size() > 0:
		var dinfo: Array = DIFF.get(ps[3], ["", Color.GRAY])
		hud_piste.text = "● " + str(ps[2]) + " · " + str(dinfo[0])
		hud_piste.add_theme_color_override("font_color", dinfo[1].lightened(0.35))
	else:
		hud_piste.text = "Hors-piste" if skier.on_piste < 0.3 else "Piste"
		hud_piste.add_theme_color_override("font_color", Color(1, 0.7, 0.35) if skier.on_piste < 0.3 else Color(1, 1, 1))
	if _msg_t > 0.0:
		_msg_t -= dt
		if _msg_t <= 0.0: hud_msg.text = ""
	mini_map.center = Vector2(skier.pos.x, skier.pos.z)
	mini_map.player = skier.pos; mini_map.player_yaw = skier.yaw
	mini_map.queue_redraw()
	if map_view.visible:
		map_view.player = skier.pos; map_view.player_yaw = skier.yaw
