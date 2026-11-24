## Masque du domaine (2048², ±2048 m) : R piste, G forêt, B Mont-Blanc, A bâtiments.
class_name Mask
extends RefCounted

var px: PackedByteArray
var n := 2048
var half := 2048.0

func _init(path: String) -> void:
	var img := Image.load_from_file(ProjectSettings.globalize_path(path))
	img.convert(Image.FORMAT_RGBA8)
	n = img.get_width()
	px = img.get_data()

func _sample(x: float, z: float, ch: int) -> float:
	var fx := (x + half) / (2.0 * half) * n - 0.5
	var fz := (z + half) / (2.0 * half) * n - 0.5
	var i := clampi(floori(fx), 0, n - 2)
	var j := clampi(floori(fz), 0, n - 2)
	var u := clampf(fx - i, 0.0, 1.0)
	var v := clampf(fz - j, 0.0, 1.0)
	var a := px[(j * n + i) * 4 + ch] * (1.0 - u) + px[(j * n + i + 1) * 4 + ch] * u
	var b := px[((j + 1) * n + i) * 4 + ch] * (1.0 - u) + px[((j + 1) * n + i + 1) * 4 + ch] * u
	return (a * (1.0 - v) + b * v) / 255.0

func piste(x: float, z: float) -> float: return _sample(x, z, 0)
func forest(x: float, z: float) -> float: return _sample(x, z, 1)
func building(x: float, z: float) -> float: return _sample(x, z, 3)
