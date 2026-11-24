## Plan des pistes plein écran (M) et mini-carte. Le fond est data/map.png (2 m/px, ±2048 m).
## Molette : zoom ; glisser : déplacer ; clic sur un sommet de remontée : téléportation.
class_name MapView
extends Control

signal teleport(lift_index: int)

var tex: Texture2D
var half := 2048.0
var mini := false
var center := Vector2.ZERO       # monde (x, z) au centre de la vue
var mpp := 3.0                   # mètres par pixel écran
var player := Vector3.ZERO
var player_yaw := 0.0
var lifts: Array = []            # [{name, top: Vector2, bottom: Vector2}]
var _drag := false
var _drag_from := Vector2.ZERO
var _drag_center := Vector2.ZERO
var _moved := false
var _font: Font

func _init(t: Texture2D, lift_list: Array, is_mini := false) -> void:
	tex = t
	lifts = lift_list
	mini = is_mini
	mouse_filter = Control.MOUSE_FILTER_IGNORE if mini else Control.MOUSE_FILTER_STOP
	_font = ThemeDB.fallback_font

func world_to_screen(w: Vector2) -> Vector2: return size / 2.0 + (w - center) / mpp
func screen_to_world(s: Vector2) -> Vector2: return center + (s - size / 2.0) * mpp

func _draw() -> void:
	var r := Rect2(Vector2.ZERO, size)
	if mini:
		draw_circle(size / 2.0, size.x / 2.0, Color(1, 1, 1, 0.9))
	else:
		draw_rect(r, Color(0.08, 0.1, 0.14, 0.92))
	# portion de la carte visible
	var tl := screen_to_world(Vector2.ZERO)
	var br := screen_to_world(size)
	var px := tex.get_width() / (2.0 * half)
	var src := Rect2((tl + Vector2(half, half)) * px, (br - tl) * px)
	if mini:
		# carte circulaire : on dessine en bandes horizontales découpées au disque
		var rad := size.x / 2.0
		var n := 48
		for i in n:
			var y0 := size.y * i / n
			var y1 := size.y * (i + 1) / n
			var yc := (y0 + y1) / 2.0 - rad
			var hw := sqrt(maxf(0.0, rad * rad - yc * yc))
			var dst := Rect2(rad - hw, y0, 2.0 * hw, y1 - y0)
			var s0 := screen_to_world(dst.position)
			var s1 := screen_to_world(dst.end)
			draw_texture_rect_region(tex, dst, Rect2((s0 + Vector2(half, half)) * px, (s1 - s0) * px))
		draw_arc(size / 2.0, rad, 0, TAU, 64, Color(1, 1, 1, 0.95), 3.0)
	else:
		draw_texture_rect_region(tex, r, src)
		for i in lifts.size():
			var l: Dictionary = lifts[i]
			var p := world_to_screen(l.top)
			draw_circle(p, 9.0, Color(1, 1, 1))
			draw_arc(p, 9.0, 0, TAU, 24, Color(0.1, 0.1, 0.1), 2.5)
			draw_string(_font, p + Vector2(13, 6), l.name, HORIZONTAL_ALIGNMENT_LEFT, -1, 17, Color(0.05, 0.05, 0.05))
		draw_string(_font, Vector2(24, 40), "Plan des pistes · Arc 1600   —   clic sur un sommet ○ pour s'y téléporter · molette : zoom · M : fermer", HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color(1, 1, 1))
	# joueur : flèche orientée
	var pp := world_to_screen(Vector2(player.x, player.z))
	var f := Vector2(sin(player_yaw), cos(player_yaw))
	var sd := Vector2(-f.y, f.x)
	var k := 9.0 if mini else 12.0
	draw_colored_polygon(PackedVector2Array([pp + f * k * 1.4, pp - f * k * 0.8 + sd * k * 0.8, pp - f * k * 0.4, pp - f * k * 0.8 - sd * k * 0.8]), Color(0.95, 0.15, 0.1))

func _gui_input(e: InputEvent) -> void:
	if mini: return
	if e is InputEventMouseButton:
		var mb := e as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP or mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if mb.pressed:
				var before := screen_to_world(mb.position)
				mpp = clampf(mpp * (0.87 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else 1.15), 0.4, 6.0)
				center += before - screen_to_world(mb.position)
				queue_redraw()
		elif mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				_drag = true; _moved = false; _drag_from = mb.position; _drag_center = center
			else:
				_drag = false
				if not _moved:
					for i in lifts.size():
						if world_to_screen(lifts[i].top).distance_to(mb.position) < 16.0:
							teleport.emit(i); return
	elif e is InputEventMouseMotion and _drag:
		var mm := e as InputEventMouseMotion
		if mm.position.distance_to(_drag_from) > 4.0: _moved = true
		center = _drag_center - (mm.position - _drag_from) * mpp
		queue_redraw()
