// Tenue de ski : couleur par zone (COLOR = poids veste, pantalon, gants, peau), motifs selon la position de repos.
shader_type spatial;
render_mode cull_back;
uniform vec3 jacket : source_color = vec3(0.78, 0.09, 0.1);
uniform vec3 jacket2 : source_color = vec3(0.25, 0.03, 0.03);
uniform vec3 pants : source_color = vec3(0.06, 0.07, 0.1);
uniform vec3 glove : source_color = vec3(0.04, 0.04, 0.045);
uniform vec3 skin : source_color = vec3(0.72, 0.52, 0.42);
varying vec4 v_cat;
varying vec3 v_rest;
void vertex() { v_cat = COLOR; v_rest = vec3(UV.x, UV.y, UV2.x); }
void fragment() {
	vec3 r = v_rest;
	vec3 jk = jacket;
	jk = mix(jk, jacket2, smoothstep(0.0, 0.02, r.y - 1.38));                       // empiècement d'épaules
	jk = mix(jk, vec3(0.9, 0.9, 0.92), smoothstep(0.015, 0.0, abs(r.y - 1.12) - 0.02) * 0.9);   // bande réfléchissante
	float zip = smoothstep(0.012, 0.004, abs(r.x)) * step(0.0, r.z) * step(r.y, 1.5);
	jk = mix(jk, vec3(0.04), zip * 0.85);
	vec3 pt = mix(pants, pants * 0.55, smoothstep(0.42, 0.36, r.y));                // renfort bas de jambe
	vec3 c = jk * v_cat.x + pt * v_cat.y + glove * v_cat.z + skin * v_cat.w;
	ALBEDO = c;
	// tissu technique : légère brillance sur la veste, mat sur le pantalon
	ROUGHNESS = mix(0.55, 0.85, v_cat.y) * (1.0 - v_cat.z * 0.2);
	SPECULAR = 0.4;
	SSS_STRENGTH = 0.15 * v_cat.w;
}
