// Terrain des Arcs : une seule surface continue, du domaine (IGN 2 m) aux massifs lointains (Copernicus 40 m).
// Maillage en anneaux concentriques (clipmap) déplacés dans le vertex shader ; neige et roche photographiées.
shader_type spatial;
render_mode cull_back, depth_draw_opaque;

// --- relief
uniform sampler2D core_h : filter_linear, repeat_disable;   // 2048², ±2048 m
uniform sampler2D mid_h : filter_linear, repeat_disable;    // 1024², ±8192 m
uniform sampler2D far_h : filter_linear, repeat_disable;    // 2048², ±40960 m
uniform float core_half = 2048.0;
uniform float mid_half = 8192.0;
uniform float far_half = 40960.0;
// --- masques
uniform sampler2D core_mask : filter_linear_mipmap, repeat_disable;   // R piste, G forêt, B Mont-Blanc, A bâtiments
uniform sampler2D mid_forest : filter_linear_mipmap, repeat_disable;
uniform sampler2D groom : filter_linear, repeat_disable;              // R distance signée à l'axe de piste, G validité
// --- textures photographiées (CC0, Poly Haven)
uniform sampler2D snow_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D snow_nrm : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D snow_rgh : hint_roughness_g, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_nrm : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D arock_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D arock_nrm : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 sun_dir = vec3(0.5, 0.4, 0.6);

// par anneau : x = taille de maille, y = demi-étendue ; inner = centre et demi-étendue de l'anneau plus fin
instance uniform vec4 level_info;
instance uniform vec4 inner_info;

varying vec3 v_world;
varying vec3 v_nrm;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
	vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

float H(vec2 p) {
	float m = max(abs(p.x), abs(p.y));
	float hf = textureLod(far_h, (p + far_half) / (2.0 * far_half), 0.0).r;
	float hm = textureLod(mid_h, (p + mid_half) / (2.0 * mid_half), 0.0).r;
	float hc = textureLod(core_h, (p + core_half) / (2.0 * core_half), 0.0).r;
	float wm = 1.0 - smoothstep(mid_half - 900.0, mid_half - 100.0, m);
	float wc = 1.0 - smoothstep(core_half - 140.0, core_half - 20.0, m);
	// bord du monde : on laisse retomber doucement
	float h = mix(mix(hf, hm, wm), hc, wc);
	return h - smoothstep(far_half - 6000.0, far_half, m) * 400.0;
}

void vertex() {
	float s = level_info.x, e = level_info.y;
	vec2 c = MODEL_MATRIX[3].xz;
	vec3 w = vec3(VERTEX.x * s + c.x, 0.0, VERTEX.z * s + c.y);
	// transition douce vers la maille deux fois plus grosse au bord de l'anneau (pas de fissures)
	vec2 d = abs(w.xz - c) / e;
	float morph = smoothstep(0.78, 0.97, max(d.x, d.y));
	vec2 coarse = floor(w.xz / (2.0 * s) + 0.5) * (2.0 * s);
	vec2 odd = w.xz - coarse;
	w.xz -= odd * morph;
	float h = H(w.xz);
	VERTEX = vec3(w.x - c.x, h, w.z - c.y);
	float st = max(s, 2.0);
	vec3 n = normalize(vec3(H(w.xz - vec2(st, 0)) - H(w.xz + vec2(st, 0)), 2.0 * st, H(w.xz - vec2(0, st)) - H(w.xz + vec2(0, st))));
	NORMAL = n;
	v_nrm = n;
	v_world = vec3(w.x, h, w.z);
}

vec3 unpack_n(vec4 t) { return t.xyz * 2.0 - 1.0; }

void fragment() {
	vec3 p = v_world;
	// zone recouverte par l'anneau plus fin : non dessinée
	if (inner_info.z > 0.0 && abs(p.x - inner_info.x) < inner_info.z && abs(p.z - inner_info.y) < inner_info.z) discard;
	float dist = length(CAMERA_POSITION_WORLD - p);
	vec3 n = normalize(v_nrm);
	// au loin : normale recalculée au pixel depuis le relief à sa pleine résolution (arêtes, couloirs, ravines)
	if (dist > 250.0) {
		float st = max(dist * 0.0035, max(abs(p.x), abs(p.z)) < core_half ? 2.0 : (max(abs(p.x), abs(p.z)) < mid_half ? 16.0 : 40.0));
		vec3 nf = normalize(vec3(H(p.xz - vec2(st, 0)) - H(p.xz + vec2(st, 0)), 2.0 * st, H(p.xz - vec2(0, st)) - H(p.xz + vec2(0, st))));
		n = normalize(mix(n, nf, smoothstep(250.0, 600.0, dist)));
	}
	float slope = 1.0 - n.y;

	// --- masques
	vec4 m = vec4(0.0);
	float inCore = step(max(abs(p.x), abs(p.z)), core_half - 4.0);
	if (inCore > 0.5) m = texture(core_mask, (p.xz + core_half) / (2.0 * core_half));
	float forestMid = texture(mid_forest, (p.xz + mid_half) / (2.0 * mid_half)).r * (1.0 - inCore);
	float piste = smoothstep(0.35, 0.75, m.r);
	float edge = smoothstep(0.1, 0.22, m.r) * (1.0 - smoothstep(0.26, 0.38, m.r));
	float low = vnoise(p.xz / 530.0) * 0.6 + vnoise(p.xz / 190.0) * 0.4;

	// --- neige : deux échelles de la photo, variation lente pour casser la répétition
	vec2 uvA = p.xz / 3.7, uvB = p.xz / 21.0 + 0.37;
	float fadeA = 1.0 - smoothstep(40.0, 160.0, dist);
	// la photo ne sert qu'aux nuances : la neige reste très blanche (albédo réel ~0,9)
	float lumA = dot(texture(snow_alb, uvA).rgb, vec3(0.333)), lumB = dot(texture(snow_alb, uvB).rgb, vec3(0.333));
	float lum = mix(lumB, lumA, fadeA * 0.7);
	vec3 alb = vec3(0.9, 0.92, 0.96) * (0.9 + 0.12 * clamp((lum - 0.55) * 2.0, -1.0, 1.0)) * (0.97 + 0.05 * low);
	vec3 nA = unpack_n(texture(snow_nrm, uvA)), nB = unpack_n(texture(snow_nrm, uvB));
	float powderK = (1.0 - piste) + edge * 0.6;
	vec2 pert = nA.xy * fadeA * mix(0.25, 0.75, powderK) + nB.xy * (1.0 - smoothstep(200.0, 1200.0, dist)) * mix(0.25, 0.7, powderK);
	float rough = mix(texture(snow_rgh, uvA).g * 0.5 + 0.45, 0.62, 1.0 - fadeA);

	// --- piste damée : velours fin et bandes de dameuse parallèles à l'axe de la piste
	if (piste > 0.01) {
		vec2 g = texture(groom, (p.xz + core_half) / (2.0 * core_half)).rg;
		vec2 fall = normalize(n.xz + vec2(1e-4));
		float across = mix(dot(p.xz, vec2(-fall.y, fall.x)), g.r, step(0.5, g.g));
		float cw = fwidth(across * 80.0 / 6.2832);
		float cord = cos(across * 80.0) * (1.0 - smoothstep(0.25, 0.7, cw)) * (1.0 - smoothstep(6.0, 35.0, dist));
		float band = cos(across * 1.396 + low * 3.0) * (1.0 - smoothstep(0.3, 0.8, fwidth(across * 1.396 / 6.2832)));
		vec2 perp = normalize(vec2(-fall.y, fall.x));
		pert = mix(pert, pert * 0.35, piste) + perp * (cord * 0.035 + band * 0.03) * piste;
		alb *= mix(1.0, 0.95 + 0.02 * band, piste);
		rough = mix(rough, 0.55, piste);
	}
	vec3 nw = normalize(n + vec3(pert.x, 0.0, pert.y));

	// --- roche : pentes raides, projection triplanaire, variation par bruit
	float rockN = vnoise(p.xz / 37.0) * 0.6 + vnoise(p.xz / 9.0) * 0.4;
	float rockM = smoothstep(0.30, 0.44, slope + 0.16 * (rockN - 0.5)) * (1.0 - piste);
	if (inCore < 0.5) rockM = smoothstep(0.22, 0.36, slope + 0.14 * (rockN - 0.5));
	if (rockM > 0.01) {
		vec3 bw = pow(abs(n), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
		float sc = 1.0 / 7.0;
		vec3 rx = texture(rock_alb, p.zy * sc).rgb, ry = texture(rock_alb, p.xz * sc).rgb, rz = texture(rock_alb, p.xy * sc).rgb;
		vec3 ra = rx * bw.x + ry * bw.y + rz * bw.z;
		vec3 nx = unpack_n(texture(rock_nrm, p.zy * sc)), nz = unpack_n(texture(rock_nrm, p.xy * sc));
		vec3 rn = normalize(n + vec3(0.0, nx.y, nx.x) * bw.x * 0.9 + vec3(nz.x, nz.y, 0.0) * bw.z * 0.9);
		// au loin : photo aérienne de roche, à grande échelle
		float farK = smoothstep(500.0, 2500.0, dist);
		vec3 aa = texture(arock_alb, p.xz / 160.0).rgb;
		ra = mix(ra, aa, farK);
		// neige accrochée sur les replats de la paroi
		float ledge = smoothstep(0.55, 0.75, rockN + (0.42 - slope) * 1.2);
		ra = mix(ra * vec3(0.95, 0.93, 0.9), vec3(0.92, 0.94, 0.98), ledge * 0.8);
		alb = mix(alb, ra, rockM);
		nw = normalize(mix(nw, rn, rockM));
		rough = mix(rough, 0.85, rockM);
	}

	// --- forêt lointaine (au-delà des arbres réels) et vallée sans neige
	float forest = (inCore > 0.5 ? m.g : forestMid) * smoothstep(900.0, 1300.0, dist);
	forest *= smoothstep(0.32, 0.62, vnoise(p.xz / 11.0) * 0.5 + vnoise(p.xz / 47.0) * 0.5 + forest * 0.4);
	vec3 forestC = mix(vec3(0.035, 0.06, 0.045), vec3(0.42, 0.46, 0.5), smoothstep(0.5, 0.8, vnoise(p.xz / 13.0)) * 0.5);
	alb = mix(alb, forestC, forest * (1.0 - rockM));
	float snowline = 1000.0 + 250.0 * (low - 0.5) + 150.0 * max(0.0, n.z);
	float ground = (1.0 - smoothstep(snowline - 150.0, snowline + 150.0, p.y)) * (1.0 - inCore);
	vec3 meadow = mix(vec3(0.17, 0.18, 0.13), vec3(0.26, 0.25, 0.19), low);
	alb = mix(alb, mix(meadow, vec3(0.1, 0.12, 0.08), forest), ground);
	// bâtiments (emprise au sol, en attendant les vrais)
	alb = mix(alb, vec3(0.6, 0.6, 0.62), m.a * 0.4);

	ALBEDO = alb;
	ROUGHNESS = mix(rough, 0.95, max(ground, forest));
	SPECULAR = 0.45;
	NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
	// neige : diffusion sous la surface (ombres bleutées et lumineuses)
	SSS_STRENGTH = 0.25 * (1.0 - rockM) * (1.0 - ground) * (1.0 - smoothstep(50.0, 300.0, dist));

	// paillettes au soleil, de près
	if (dist < 25.0) {
		vec2 gp = p.xz * 6.0; vec2 cell = floor(gp);
		float h = hash12(cell);
		vec3 v = normalize(CAMERA_POSITION_WORLD - vec3((cell + 0.5) / 6.0, p.y).xzy);
		float tw = fract(h * 91.7 + dot(v, vec3(13.1, 7.7, 19.3)) * 3.0);
		float dotm = 1.0 - smoothstep(0.04, 0.18, length(fract(gp) - 0.5));
		float sp = step(0.988, tw) * dotm * (1.0 - smoothstep(6.0, 24.0, dist)) * (1.0 - rockM) * max(dot(n, normalize(sun_dir)), 0.0);
		EMISSION = vec3(1.0, 0.98, 0.94) * sp * 3.0;
	}
}
