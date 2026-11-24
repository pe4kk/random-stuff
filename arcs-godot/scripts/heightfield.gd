## Champ de hauteur régulier centré sur l'origine (X = est, Z = sud), lu depuis un fichier float32 brut.
class_name HeightField
extends RefCounted

var data: PackedFloat32Array
var n: int
var half: float
var cell: float
var texture: ImageTexture

func _init(path: String, size: int, half_size: float) -> void:
	n = size
	half = half_size
	cell = 2.0 * half / n
	var bytes := FileAccess.get_file_as_bytes(path)
	data = bytes.to_float32_array()
	var img := Image.create_from_data(n, n, false, Image.FORMAT_RF, bytes)
	texture = ImageTexture.create_from_image(img)

func at(i: int, j: int) -> float:
	i = clampi(i, 0, n - 1)
	j = clampi(j, 0, n - 1)
	return data[j * n + i]

## interpolation bilinéaire (identique au filtrage de texture du rendu)
func height(x: float, z: float) -> float:
	var fx := (x + half) / cell - 0.5
	var fz := (z + half) / cell - 0.5
	var i := floori(fx)
	var j := floori(fz)
	var u := fx - i
	var v := fz - j
	var a := at(i, j) * (1.0 - u) + at(i + 1, j) * u
	var b := at(i, j + 1) * (1.0 - u) + at(i + 1, j + 1) * u
	return a * (1.0 - v) + b * v

func normal(x: float, z: float, step := 1.5) -> Vector3:
	var hl := height(x - step, z)
	var hr := height(x + step, z)
	var hd := height(x, z - step)
	var hu := height(x, z + step)
	return Vector3(hl - hr, 2.0 * step, hd - hu).normalized()

func inside(x: float, z: float, margin := 0.0) -> bool:
	return absf(x) < half - margin and absf(z) < half - margin
