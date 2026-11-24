// Vêtements de ski : COLOR = position de repos (x, hauteur, avant) pour placer les motifs.
// part : 0 doudoune, 1 pantalon, 2 gants.
shader_type spatial;
render_mode cull_disabled;
uniform int part = 0;
uniform vec3 main_color : source_color = vec3(0.75, 0.08, 0.1);
uniform vec3 accent : source_color = vec3(0.06, 0.07, 0.1);
varying vec3 v_rest;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }

void vertex() { v_rest = vec3((COLOR.r - 0.5) * 2.0, COLOR.g * 2.0, (COLOR.b - 0.5) * 2.0); }

void fragment() {
	vec3 r = v_rest;
	vec3 c = main_color;
	float rough = 0.6;
	float h = 0.0;          // relief (matelassage, coutures)
	// grain du tissu
	float weave = vnoise(r.xy * 900.0) * 0.5 + vnoise(r.zy * 900.0) * 0.5;
	if (part == 0) {
		// doudoune : boudins horizontaux de 9 cm, empiècement d'épaules et col contrastés
		float q = abs(sin(r.y * 35.0));
		h = pow(q, 0.35);
		c *= mix(0.72, 1.0, h);
		float yoke = smoothstep(1.44, 1.46, r.y);
		c = mix(c, accent, yoke);
		// fermeture éclair et rabat
		float front = step(0.02, r.z);
		float zip = (1.0 - smoothstep(0.006, 0.012, abs(r.x))) * front * step(0.9, r.y);
		c = mix(c, vec3(0.03), zip);
		rough = mix(0.45, 0.35, zip);
		// petit logo blanc sur la poitrine gauche
		float logo = step(abs(r.x - 0.09), 0.025) * step(abs(r.y - 1.4), 0.008) * front;
		c = mix(c, vec3(0.92), logo);
		// bas de veste et poignets : bande élastique plus sombre
		c = mix(c, c * 0.55, smoothstep(0.86, 0.84, r.y));
	} else if (part == 1) {
		// pantalon : tissu mat, renfort aux genoux, bande latérale, guêtre en bas
		c = main_color;
		float knee = smoothstep(0.05, 0.0, abs(r.y - 0.52) - 0.07) * step(0.0, r.z);
		c = mix(c, c * 0.7, knee);
		float stripe = (1.0 - smoothstep(0.006, 0.012, abs(abs(r.x) - 0.17))) * step(0.3, r.y);
		c = mix(c, accent, stripe * 0.8);
		c = mix(c, c * 0.6, smoothstep(0.32, 0.28, r.y));
		rough = 0.85;
		h = weave * 0.3;
	} else {
		// gants : cuir synthétique noir, manchette grise
		c = vec3(0.03, 0.03, 0.035);
		rough = 0.5;
		h = weave * 0.2;
	}
	c *= 0.94 + 0.08 * weave;
	ALBEDO = c;
	ROUGHNESS = rough;
	SPECULAR = 0.4;
	// relief : normale perturbée par le gradient écran du relief
	vec3 dpx = dFdx(VERTEX), dpy = dFdy(VERTEX);
	float hx = dFdx(h), hy = dFdy(h);
	vec3 rx = cross(dpy, NORMAL), ry = cross(NORMAL, dpx);
	float det = dot(dpx, rx);
	vec3 g = (hx * rx + hy * ry) / (abs(det) + 1e-6) * sign(det);
	NORMAL = normalize(NORMAL - g * 0.012);
}
