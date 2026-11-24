## Son du ski : boucles (vent, carre, dérapage, poudreuse, ambiance) dosées selon la glisse,
## et bruits ponctuels (planté de bâton, réception, chute). N : couper / remettre le son.
class_name SkiAudio
extends Node

var loops := {}
var gains := {}
var shots := {}
var muted := false

func _ready() -> void:
	for n in ["wind", "carve", "scrape", "powder", "ambience"]:
		var p := AudioStreamPlayer.new()
		var st: AudioStreamWAV = load("res://sounds/%s.wav" % n)
		st.loop_mode = AudioStreamWAV.LOOP_FORWARD
		st.loop_begin = 0
		st.loop_end = int(st.get_length() * st.mix_rate)
		p.stream = st
		p.volume_db = -80.0
		add_child(p)
		p.play(randf() * st.get_length() * 0.9)
		loops[n] = p
		gains[n] = 0.0
	for n in ["pole", "land", "crash"]:
		var p := AudioStreamPlayer.new()
		p.stream = load("res://sounds/%s.wav" % n)
		add_child(p)
		shots[n] = p

func play(n: String, vol := 1.0, pitch := 1.0) -> void:
	if muted or not shots.has(n): return
	var p: AudioStreamPlayer = shots[n]
	p.volume_db = linear_to_db(maxf(vol, 0.001))
	p.pitch_scale = pitch * randf_range(0.92, 1.08)
	p.play()

func toggle_mute() -> void:
	muted = not muted

## appelé à chaque image
func update(dt: float, speed: float, carve: float, skid: float, on_piste: float, grounded: bool, crashed: bool, frozen: bool) -> void:
	var g := grounded and not crashed and not frozen
	var target := {
		"wind": 0.0 if frozen else clampf(speed / 28.0, 0.0, 1.0) ** 1.6 * 0.9,
		"carve": (clampf(carve * 1.4, 0.0, 1.0) * clampf(speed / 8.0, 0.0, 1.0) * (0.4 + 0.6 * on_piste)) if g else 0.0,
		"scrape": (clampf(skid, 0.0, 1.0) * clampf(speed / 4.0, 0.0, 1.0) * 0.9) if g else 0.0,
		"powder": ((1.0 - on_piste) * clampf(speed / 10.0, 0.0, 1.0) * 0.8) if g else 0.0,
		"ambience": 0.18 if frozen else 0.28,
	}
	for n in loops:
		var k := 8.0 if n != "ambience" else 1.0
		gains[n] += (target[n] - gains[n]) * minf(1.0, dt * k)
		var p: AudioStreamPlayer = loops[n]
		p.volume_db = -80.0 if muted else linear_to_db(maxf(gains[n], 0.0001))
	(loops["wind"] as AudioStreamPlayer).pitch_scale = 0.75 + clampf(speed / 40.0, 0.0, 0.7)
	(loops["carve"] as AudioStreamPlayer).pitch_scale = 0.85 + clampf(speed / 50.0, 0.0, 0.5)
	(loops["scrape"] as AudioStreamPlayer).pitch_scale = 0.8 + clampf(speed / 40.0, 0.0, 0.5)
