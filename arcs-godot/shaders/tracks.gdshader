// Sillon de ski : fond tassé, parois éclairées selon le soleil, bourrelet clair.
// Fusion multiplicative dans le tampon HDR : facteur < 1 assombrit (paroi à l'ombre), > 1 éclaircit (bourrelet au soleil).
shader_type spatial;
render_mode unshaded, blend_mul, depth_draw_never, cull_disabled, shadows_disabled;
uniform vec3 sun_dir = vec3(0.5, 0.5, 0.5);
varying float v_dist;
void vertex() { v_dist = length((MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz); }
void fragment() {
	float x = UV.x, ax = abs(x), sx = sign(x);
	float k = UV.y * (1.0 - smoothstep(120.0, 400.0, v_dist));
	float wall = smoothstep(0.12, 0.55, ax) * (1.0 - smoothstep(0.6, 0.85, ax));
	float rim = smoothstep(0.8, 0.92, ax) * (1.0 - smoothstep(0.94, 1.0, ax));
	float dz = sx * (wall * 0.75 - rim * 0.5);
	vec2 s = UV2;
	vec3 n = normalize(vec3(-s.x * dz, 1.0, -s.y * dz));
	float sy = max(sun_dir.y, 0.25);
	float shade = max(dot(n, sun_dir), 0.0) / sy;
	float bottom = 1.0 - smoothstep(0.15, 0.5, ax);
	float f = clamp(mix(1.0, shade, 0.75), 0.6, 1.22) * (1.0 - 0.08 * bottom);
	ALBEDO = vec3(mix(1.0, f, k)) * mix(vec3(1.0), vec3(0.97, 0.98, 1.01), k);
}
