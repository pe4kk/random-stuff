// Sapins : cartes de rameaux photographiés (CC0, Poly Haven), neige posée sur le dessus des branches.
shader_type spatial;
render_mode cull_disabled, depth_draw_opaque;

uniform sampler2D twig : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D twig_nrm : hint_normal, filter_linear_mipmap, repeat_disable;
uniform float snow_amount = 0.55;
varying vec3 v_wn;
varying vec3 v_wp;
varying float v_kind;   // couleur des sommets : r = 1 rameau, 0 tronc/cœur
varying vec3 v_tint;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void vertex() {
	v_wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	v_wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_kind = COLOR.r;
	v_tint = INSTANCE_CUSTOM.rgb;
}

void fragment() {
	vec4 t = texture(twig, UV);
	vec3 alb;
	float alpha = 1.0;
	if (v_kind > 0.5) {
		alb = mix(vec3(dot(t.rgb, vec3(0.333))), t.rgb, 0.75) * vec3(0.62, 0.68, 0.62);   // épicéa : vert sombre, peu saturé
		alpha = t.a;
	} else {
		alb = COLOR.gba;      // tronc / cœur : couleur unie
	}
	alb *= v_tint;
	// neige : sur les faces tournées vers le ciel, en paquets irréguliers
	float up = FRONT_FACING ? v_wn.y : -v_wn.y;
	float lump = hash12(floor(UV * 18.0) + floor(v_wp.xz * 3.0)) * 0.5 + hash12(floor(UV * 7.0)) * 0.5;
	float s = smoothstep(0.15, 0.75, up) * smoothstep(1.0 - snow_amount, 1.0 - snow_amount + 0.25, lump) * step(0.5, v_kind);
	alb = mix(alb, vec3(0.9, 0.93, 0.97), s);
	ALBEDO = alb;
	ALPHA = alpha;
	ALPHA_SCISSOR_THRESHOLD = 0.45;
	ROUGHNESS = mix(0.85, 0.7, s);
	SPECULAR = 0.3;
	vec3 nm = texture(twig_nrm, UV).xyz;
	NORMAL_MAP = mix(vec3(0.5, 0.5, 1.0), nm, 0.6 * (1.0 - s));
	BACKLIGHT = vec3(0.12, 0.16, 0.1) * (1.0 - s);
}
