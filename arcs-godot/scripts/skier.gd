## Physique de glisse (portée du jeu web) : carving limité par l'adhérence, dérapage, frottements,
## schuss, chasse-neige, sauts, chutes, collisions avec les sapins. Pas fixe de 1/120 s.
## Repère : X = est, Z = sud, Y = haut ; cap (yaw) = atan2(x, z).
class_name Skier
extends RefCounted

const G := 9.81
const SLOPE_BOOST := 1.45     # réglage de jeu : la pente « tire » plus que dans la réalité

var hf: HeightField
var mask: Mask
var forest: Forest
var pos := Vector3.ZERO
var vel := Vector3.ZERO
var yaw := 0.0
var grounded := true
var air_time := 0.0
var crash_t := 0.0
var crash_msg := ""
var lean := 0.0
var skid := 0.0
var carve := 0.0
var on_piste := 1.0
var compress := 0.0
var normal := Vector3.UP
var tuck := 0.0
var brake := 0.0
var push := 0.0
var t := 0.0
var plant := 1.0
var plant_side := 0
var events: Array[String] = []
var _jump_held := false
var _turn_sign := 0
var _edge_loss := 0.0
var _warned := false
var tumble := Vector3.ZERO

func _init(h: HeightField, m: Mask, f: Forest) -> void:
	hf = h; mask = m; forest = f

func speed() -> float:
	return vel.length()

func place(x: float, z: float, y_aw: float) -> void:
	pos = Vector3(x, hf.height(x, z), z)
	vel = Vector3.ZERO
	yaw = y_aw
	grounded = true
	crash_t = 0.0

func _crash(msg: String) -> void:
	if crash_t > 0.0: return
	crash_t = 2.2
	crash_msg = msg
	events.append("crash")

## inp : steer (-1 gauche … 1 droite), tuck, brake, push (0..1), jump (bool)
func step(dt: float, inp: Dictionary) -> void:
	t += dt
	plant = minf(1.0, plant + dt / 0.45)
	tuck += (inp.tuck - tuck) * minf(1.0, dt * 6.0)
	brake += (inp.brake - brake) * minf(1.0, dt * 8.0)
	push += ((1.0 if inp.push > 0.0 and speed() < 11.0 else 0.0) - push) * minf(1.0, dt * 5.0)

	if crash_t > 0.0:
		crash_t -= dt
		normal = hf.normal(pos.x, pos.z)
		var a := Vector3(0, -G, 0) + normal * (G * normal.y)
		vel += a * dt * 0.4
		vel *= exp(-dt * 2.5)
		vel -= normal * vel.dot(normal)
		pos += vel * dt
		pos.y = hf.height(pos.x, pos.z)
		_collide(true)
		var sp := speed()
		tumble.x += dt * sp * 1.2; tumble.z += dt * sp * 0.7
		if crash_t <= 0.0:
			tumble = Vector3.ZERO
			if sp > 0.3: yaw = atan2(vel.x, vel.z)
			vel *= 0.2
			grounded = true
		skid = minf(1.0, sp / 8.0); carve = 0.0
		return

	var on_p := mask.piste(pos.x, pos.z)
	on_piste = on_p
	var steer: float = inp.steer

	if grounded:
		var n := hf.normal(pos.x, pos.z)
		normal = n
		var d := Vector3(sin(yaw), 0, cos(yaw))
		d = (d - n * d.dot(n)).normalized()
		var l := n.cross(d)                                # gauche
		var sp := vel.length()
		var vf := vel.dot(d)
		var vl := vel.dot(l)
		var abs_s := absf(steer)
		var R := 38.0 - 27.0 * abs_s - 6.0 * brake
		var N := G * n.y + maxf(0.0, compress) * 2.0
		var powder := 1.0 - on_p
		var grip := (1.25 + 0.35 * abs_s) * (1.0 - 0.3 * powder) * (1.0 - 0.65 * brake) * N
		var yaw_rate := -steer * (absf(vf) / R)
		# virage limité par l'adhérence : à grande vitesse le rayon s'élargit, pas de chute pour un coup de direction
		if absf(vf) > 1.0:
			var lim := (grip * 1.3) / absf(vf)
			yaw_rate = clampf(yaw_rate, -lim, lim)
		yaw_rate += -steer * 1.9 * maxf(0.0, 1.0 - sp / 9.0)     # pivot à basse vitesse
		yaw_rate += -steer * brake * 1.2                          # dérapage piloté
		yaw += yaw_rate * dt
		var a := (Vector3(0, -G, 0) + n * (G * n.y)) * SLOPE_BOOST
		var a_lat := -vl * 9.0
		var sk := 0.0
		if absf(a_lat) > grip:
			sk = minf(1.0, (absf(a_lat) - grip) / (grip + 1.0))
			a_lat = signf(a_lat) * grip
		a += l * a_lat
		var mu := 0.022 + 0.03 * powder + 0.15 * brake + 0.12 * sk
		var cda := 0.55 - 0.3 * tuck + 0.25 * brake
		var drag := mu * N + (0.5 * 1.2 * cda / 42.0) * sp * sp + powder * (0.01 * sp * sp + 0.25 * sp)
		if sp > 0.01:
			a -= vel * (minf(drag, sp / dt) / sp)
		if inp.push > 0.0 and sp < 11.0:
			a += d * (4.2 * inp.push * (1.0 - sp / 11.0))
		if brake > 0.05 and sp > 0.01:
			a -= vel * (minf(brake * 5.5, sp / dt) / sp)
		vel += a * dt
		vel -= n * vel.dot(n)
		skid += (maxf(sk, brake * minf(1.0, sp / 6.0)) - skid) * minf(1.0, dt * 10.0)
		carve += (minf(1.0, abs_s * sp / 14.0) * (1.0 - sk) - carve) * minf(1.0, dt * 6.0)
		var sgn := 1 if steer > 0.3 else (-1 if steer < -0.3 else 0)
		if sgn != 0 and sgn != _turn_sign and sp > 2.5:
			plant = 0.0; plant_side = -1 if sgn > 0 else 1
		if sgn != 0: _turn_sign = sgn
		if sk > 0.85 and sp > 20.0 and brake < 0.3: _edge_loss += dt
		else: _edge_loss = maxf(0.0, _edge_loss - dt * 3.0)
		if _edge_loss > 0.5 and not _warned:
			_warned = true; events.append("edgewarn")
		if _edge_loss > 0.08: lean += (randf() - 0.5) * 0.12
		if _edge_loss == 0.0: _warned = false
		if _edge_loss > 1.6 and n.y < 0.975:
			_edge_loss = 0.0; _warned = false; _crash("Perte de carre !")
		var lat_acc := vf * yaw_rate
		var target_lean := clampf(atan2(lat_acc, G), -0.95, 0.95)
		lean += (target_lean - lean) * minf(1.0, dt * 8.0)
		pos += vel * dt
		var ty := hf.height(pos.x, pos.z)
		if pos.y > ty + 0.12 and sp > 5.0:
			grounded = false; air_time = 0.0
		else:
			pos.y = ty
		if inp.jump and not _jump_held: _jump_held = true
		if inp.jump: compress = minf(1.0, compress + dt * 3.0)
		if not inp.jump and _jump_held:
			_jump_held = false
			vel += n * (3.0 + 3.4 * compress)
			grounded = false; air_time = 0.0
			pos.y += 0.05
			events.append("jump")
			compress = 0.0
		if not inp.jump: compress *= exp(-dt * 6.0)
	else:
		var sp := vel.length()
		vel.y -= G * dt
		var cda := 0.5 - 0.25 * tuck
		vel *= 1.0 - (0.5 * 1.2 * cda / 80.0) * sp * dt
		yaw += -steer * 2.6 * dt
		air_time += dt
		pos += vel * dt
		lean *= exp(-dt * 3.0)
		var ty := hf.height(pos.x, pos.z)
		if pos.y <= ty:
			var n := hf.normal(pos.x, pos.z)
			normal = n
			var vn := vel.dot(n)
			var impact := maxf(0.0, -vn)
			vel -= n * vn
			pos.y = ty
			grounded = true
			compress = -minf(1.0, impact / 9.0)
			var d := Vector3(sin(yaw), 0, cos(yaw))
			var hv := Vector3(vel.x, 0, vel.z)
			var hs := hv.length()
			var align := absf(d.dot(hv) / hs) if hs > 1.0 else 1.0
			if impact > 15.0 or (hs > 9.0 and align < 0.4):
				_crash("Réception trop violente" if impact > 15.0 else "Réception de travers")
			else:
				vel *= 1.0 - minf(0.25, impact * 0.015)
				if impact > 3.0: events.append("land")
				if hs > 2.0 and align > 0.4:
					var target := atan2(hv.x, hv.z)
					var fwd := target if d.dot(hv) >= 0.0 else target + PI
					yaw += wrapf(fwd - yaw, -PI, PI) * 0.5
	# pas de marche arrière : les skis pivotent dans le sens de la pente
	var dd := Vector3(sin(yaw), 0, cos(yaw))
	if grounded and crash_t <= 0.0 and vel.dot(dd) < -1.0:
		var tg := atan2(vel.x, vel.z)
		var dy := wrapf(tg - yaw, -PI, PI)
		yaw += signf(dy) * minf(absf(dy), dt * 4.0)
	_collide(false)
	compress += (0.0 - compress) * minf(1.0, dt * 4.0)

func _collide(crashed: bool) -> void:
	var lim := hf.half - 40.0
	if absf(pos.x) > lim or absf(pos.z) > lim:
		pos.x = clampf(pos.x, -lim, lim); pos.z = clampf(pos.z, -lim, lim)
		vel *= 0.3
		pos.y = hf.height(pos.x, pos.z)
	var near := forest.nearest(pos.x, pos.z, 2.0)
	if near.i >= 0:
		var h: float = forest.hs[near.i]
		var r: float = near.rad
		if near.d < r and pos.y < hf.height(pos.x, pos.z) + h * 0.9:
			var ox: float = forest.xs[near.i]
			var oz: float = forest.zs[near.i]
			var dx := pos.x - ox
			var dz := pos.z - oz
			var l := maxf(0.001, sqrt(dx * dx + dz * dz))
			pos.x = ox + dx / l * r
			pos.z = oz + dz / l * r
			var sp := speed()
			var vn := (vel.x * dx + vel.z * dz) / l
			if vn < 0.0:
				vel.x -= vn * dx / l * 1.3; vel.z -= vn * dz / l * 1.3
			if not crashed and sp > 6.0 and vn < -3.0: _crash("Sapin !")
			vel *= 0.7
	if mask.building(pos.x, pos.z) > 0.75:
		var sp := speed()
		pos -= vel * (2.0 / 60.0)
		vel *= -0.25
		pos.y = hf.height(pos.x, pos.z)
		if not crashed and sp > 6.0: _crash("Bâtiment !")
