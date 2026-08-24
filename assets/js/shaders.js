/**
 * All GLSL for the portfolio world.
 *
 * Everything here is GLSL ES 1.00 (gl_FragColor / texture2D) which WebGL2 still
 * compiles, so it works on the widest range of hardware.
 *
 * Colour-space contract:
 *   - Scene materials render into a linear HalfFloat target and must output
 *     LINEAR values. They deliberately do NOT include <tonemapping_fragment>
 *     or <colorspace_fragment>.
 *   - Only COMPOSITE_FRAG writes to the default framebuffer, so it is the one
 *     place tone mapping and sRGB conversion happen.
 *   - Photo textures get `colorSpace = SRGBColorSpace`, which makes three.js
 *     upload them as SRGB8_ALPHA8 so the GPU linearises them on sample. That
 *     works for custom shaders too, so no manual sRGB decode is needed.
 */

/* ------------------------------------------------------------------ *
 * Shared GLSL helpers
 * ------------------------------------------------------------------ */

const HASH = `
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }
  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise21(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
`;

/* ------------------------------------------------------------------ *
 * Fullscreen quad
 * ------------------------------------------------------------------ */

export const QUAD_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Bright-pass with a soft knee, so bloom ramps in instead of popping. */
export const BRIGHT_FRAG = `
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;

  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float soft = clamp(lum - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 0.0001);
    float contrib = max(soft, lum - uThreshold) / max(lum, 0.0001);
    gl_FragColor = vec4(c * contrib, 1.0);
  }
`;

/** Separable 9-tap gaussian. uDirection carries the texel step. */
export const BLUR_FRAG = `
  uniform sampler2D tDiffuse;
  uniform vec2 uDirection;
  varying vec2 vUv;

  void main() {
    // Linear-sampled gaussian: 5 taps covering a 9-tap kernel.
    vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
    vec2 o1 = uDirection * 1.3846153846;
    vec2 o2 = uDirection * 3.2307692308;
    sum += texture2D(tDiffuse, vUv + o1).rgb * 0.3162162162;
    sum += texture2D(tDiffuse, vUv - o1).rgb * 0.3162162162;
    sum += texture2D(tDiffuse, vUv + o2).rgb * 0.0702702703;
    sum += texture2D(tDiffuse, vUv - o2).rgb * 0.0702702703;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

/**
 * The look lives here: bloom composite, block-displacement glitch, RGB split
 * driven by scroll velocity, scanlines, grain, vignette and a faint CRT curve.
 */
export const COMPOSITE_FRAG = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform vec2  uResolution;
  uniform float uTime;
  uniform float uGlitch;     // 0..1 burst intensity
  uniform float uVel;        // signed, normalised scroll velocity
  uniform float uBloom;
  uniform float uScan;
  uniform float uGrain;
  uniform float uVignette;
  uniform float uCurve;
  varying vec2 vUv;

  ${HASH}

  void main() {
    vec2 uv = vUv;

    // --- faint CRT barrel curve -------------------------------------
    vec2 cc = uv - 0.5;
    float r2 = dot(cc, cc);
    uv = uv + cc * r2 * uCurve;

    // Anything pushed outside the frame reads as bezel.
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // --- horizontal block displacement -------------------------------
    float blocks   = 28.0;
    float row      = floor(uv.y * blocks);
    float tick     = floor(uTime * 14.0);
    float rowHash  = hash11(row * 4.31 + tick * 17.7);
    float fires    = step(1.0 - uGlitch * 0.75, rowHash);
    float shove    = (hash11(row * 9.13 + tick) - 0.5) * 0.22 * uGlitch * fires;
    uv.x = fract(uv.x + shove);

    // --- RGB split ---------------------------------------------------
    // Scroll faster and the channels pull further apart.
    float split = (0.0012 + uGlitch * 0.010 + abs(uVel) * 0.0035) * (1.0 + r2 * 2.0);
    vec2 dir = vec2(split, split * 0.15 * sign(uVel));

    vec3 col;
    col.r = texture2D(tDiffuse, uv + dir).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - dir).b;

    // --- bloom -------------------------------------------------------
    col += texture2D(tBloom, uv).rgb * uBloom;

    // --- a hot magenta/cyan tear on strong glitch --------------------
    float tear = step(0.986, hash11(row * 2.7 + tick * 3.1)) * uGlitch;
    col += vec3(1.0, 0.18, 0.59) * tear * 0.30;
    col += vec3(0.0, 0.98, 1.0) * tear * 0.16 * fires;

    // --- scanlines ---------------------------------------------------
    float scan = sin(vUv.y * uResolution.y * 1.35) * 0.5 + 0.5;
    col *= 1.0 - scan * uScan;

    // Slow rolling interlace band.
    float roll = sin((vUv.y + uTime * 0.06) * 3.14159 * 2.0) * 0.5 + 0.5;
    col *= 1.0 - roll * 0.018;

    // --- grain -------------------------------------------------------
    float g = hash21(vUv * uResolution + fract(uTime) * 431.0);
    col += (g - 0.5) * uGrain;

    // --- vignette ----------------------------------------------------
    col *= 1.0 - r2 * uVignette;

    gl_FragColor = vec4(max(col, 0.0), 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ *
 * Particle field
 * ------------------------------------------------------------------ */

export const PARTICLE_VERT = `
  attribute float aScale;
  attribute float aSeed;
  uniform float uTime;
  uniform float uSize;
  uniform float uDrift;   // signed: scroll direction reverses the drift
  uniform float uSpan;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    vec3 p = position;

    // Drift along Z and wrap, so the field is endless in both directions.
    p.z = mod(p.z + uDrift + uSpan * 0.5, uSpan) - uSpan * 0.5;

    // Gentle lateral sway keeps it from looking like a static point cloud.
    p.x += sin(uTime * 0.22 + aSeed * 6.283) * 0.55;
    p.y += cos(uTime * 0.17 + aSeed * 4.712) * 0.45;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * aScale * (34.0 / max(-mv.z, 0.6));

    // Twinkle, and fade out near the far plane so nothing pops in.
    float twinkle = 0.55 + 0.45 * sin(uTime * 1.9 + aSeed * 21.3);
    float depth = smoothstep(0.0, 26.0, -mv.z) * (1.0 - smoothstep(140.0, 240.0, -mv.z));
    vAlpha = twinkle * depth;
    vSeed = aSeed;
  }
`;

export const PARTICLE_FRAG = `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    // Round, soft-edged sprite without needing a texture.
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d);
    if (r > 0.25) discard;
    float falloff = 1.0 - smoothstep(0.0, 0.25, r);
    falloff = pow(falloff, 1.7);

    vec3 tint = mix(uColorA, uColorB, fract(vSeed * 7.31));
    gl_FragColor = vec4(tint * falloff * vAlpha * 1.6, falloff * vAlpha);
  }
`;

/* ------------------------------------------------------------------ *
 * Procedural corridor grid
 * ------------------------------------------------------------------ */

export const GRID_VERT = `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/** fwidth-based anti-aliased lines stay crisp at every depth. */
export const GRID_FRAG = `
  uniform vec3  uColor;
  uniform float uTime;
  uniform float uScale;
  uniform float uOpacity;
  uniform float uPulse;
  uniform float uFade;
  varying vec2 vUv;
  varying vec3 vWorld;

  ${HASH}

  float gridLine(vec2 p, float w) {
    vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
    float l = min(g.x, g.y);
    return 1.0 - min(l * w, 1.0);
  }

  void main() {
    vec2 p = vWorld.xz / uScale;

    float fine  = gridLine(p, 1.0) * 0.34;
    float major = gridLine(p * 0.2, 1.2) * 0.85;
    float line = max(fine, major);

    // Data pulses running down the corridor.
    float pulse = smoothstep(0.90, 1.0, sin(vWorld.z * 0.06 + uTime * 1.4)) * uPulse;
    line += pulse * major * 1.6;

    // Occasional lit cell, like a rack indicator.
    float cell = hash21(floor(p));
    float blink = step(0.994, fract(cell + uTime * 0.07)) * 0.5;

    // Distance fade so the grid dissolves into the fog rather than ending.
    float dist = length(vWorld.xz - cameraPosition.xz);
    float fade = 1.0 - smoothstep(uFade * 0.25, uFade, dist);

    float a = (line + blink) * uOpacity * fade;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * (line + blink * 2.0) * 1.35, a);
  }
`;

/* ------------------------------------------------------------------ *
 * Photo plane with glitch
 * ------------------------------------------------------------------ */

export const PORTRAIT_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Block displacement + per-channel offset + scanlines + a noise-threshold
 * dissolve that eats the edges. Alpha from the source cutout is respected
 * throughout so the subject stays cleanly matted.
 */
export const PORTRAIT_FRAG = `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uGlitch;
  uniform float uVel;
  uniform float uOpacity;
  uniform float uDissolve;   // 0 = whole, 1 = fully scattered
  uniform vec3  uRim;
  uniform vec3  uTint;
  varying vec2 vUv;

  ${HASH}

  void main() {
    vec2 uv = vUv;
    float energy = uGlitch + abs(uVel) * 0.35;

    // --- block displacement -----------------------------------------
    float row  = floor(uv.y * 34.0);
    float tick = floor(uTime * 11.0);
    float h    = hash11(row * 5.7 + tick * 13.1);
    float fires = step(0.82 - energy * 0.5, h);
    uv.x += (hash11(row + tick * 2.3) - 0.5) * 0.10 * energy * fires;

    // --- channel split ----------------------------------------------
    float split = 0.0016 + energy * 0.012;
    vec4 cr = texture2D(uMap, uv + vec2(split, 0.0));
    vec4 cg = texture2D(uMap, uv);
    vec4 cb = texture2D(uMap, uv - vec2(split, 0.0));

    vec3 col = vec3(cr.r, cg.g, cb.b);
    float alpha = max(cg.a, max(cr.a, cb.a) * 0.6);

    // --- digital dissolve from the edges inward ----------------------
    // Scatter is biased by horizontal distance from centre, so the subject
    // breaks apart at the silhouette first.
    float edge = abs(uv.x - 0.5) * 2.0;
    float n = noise21(uv * vec2(38.0, 90.0) + vec2(uTime * 0.6, 0.0));
    float cut = uDissolve * (0.35 + edge * 0.9);
    alpha *= 1.0 - smoothstep(cut - 0.12, cut + 0.08, n);

    // Escaped fragments glow as they leave.
    float sparks = step(0.965, n) * uDissolve * 1.4;
    col += uRim * sparks;

    // --- rim light ---------------------------------------------------
    float rim = smoothstep(0.55, 1.0, edge) * cg.a;
    col += uRim * rim * 0.32;

    // --- scanlines + tint --------------------------------------------
    float scan = sin(vUv.y * 900.0) * 0.5 + 0.5;
    col *= 1.0 - scan * 0.10;
    col = mix(col, col * uTint, 0.35);

    // A bright bar sweeping the plate.
    float bar = smoothstep(0.985, 1.0, sin(vUv.y * 5.0 - uTime * 1.1));
    col += uRim * bar * 0.22;

    alpha *= uOpacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

/* ------------------------------------------------------------------ *
 * Holographic panel (project cards in 3D)
 * ------------------------------------------------------------------ */

export const PANEL_FRAG = `
  uniform vec3  uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uActive;   // lights up when the matching DOM card is on screen
  varying vec2 vUv;

  ${HASH}

  void main() {
    vec2 uv = vUv;

    // Border frame with cut corners.
    vec2 d = min(uv, 1.0 - uv);
    float edge = min(d.x, d.y);
    float frame = 1.0 - smoothstep(0.004, 0.010, edge);

    // Corner brackets.
    float corner = step(d.x, 0.11) * step(d.y, 0.11);
    float bracket = corner * (1.0 - smoothstep(0.004, 0.014, edge));

    // Dot matrix fill.
    vec2 g = fract(uv * vec2(26.0, 34.0)) - 0.5;
    float dots = (1.0 - smoothstep(0.10, 0.20, length(g))) * 0.16;

    // Readout bars, seeded per row.
    float rows = floor(uv.y * 14.0);
    float w = hash11(rows * 3.7) * 0.55 + 0.12;
    float bars = step(uv.x, w) * step(fract(uv.y * 14.0), 0.30) * 0.10;

    // Scan sweep.
    float sweep = smoothstep(0.975, 1.0, sin(uv.y * 6.0 - uTime * 1.6)) * 0.5;

    float a = (frame + bracket * 1.4 + dots + bars + sweep);
    a *= uOpacity * (0.35 + uActive * 0.65);
    if (a < 0.004) discard;

    vec3 col = uColor * (1.0 + uActive * 1.5) * (frame + bracket * 2.0 + dots + bars + sweep);
    gl_FragColor = vec4(col, a);
  }
`;

/* ------------------------------------------------------------------ *
 * Labels / glyph tiles (canvas textures)
 * ------------------------------------------------------------------ */

export const LABEL_FRAG = `
  uniform sampler2D uMap;
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uGlitch;
  varying vec2 vUv;

  ${HASH}

  void main() {
    vec2 uv = vUv;
    float row = floor(uv.y * 18.0);
    float tick = floor(uTime * 9.0);
    float fires = step(0.93 - uGlitch * 0.35, hash11(row * 7.1 + tick * 3.3));
    uv.x += (hash11(row + tick) - 0.5) * 0.06 * uGlitch * fires;

    vec4 t = texture2D(uMap, uv);
    float a = t.a * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * t.rgb * 1.8, a);
  }
`;

/* ------------------------------------------------------------------ *
 * Core wireframe shell
 * ------------------------------------------------------------------ */

export const CORE_VERT = `
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  ${HASH}

  void main() {
    vec3 p = position;
    // Breathe, plus a little per-vertex jitter so it feels unstable.
    float n = hash11(dot(position, vec3(12.9898, 78.233, 37.719)));
    p += normal * (sin(uTime * 1.3 + n * 6.283) * 0.05 + uPulse * 0.22);

    vec4 wp = modelMatrix * vec4(p, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const CORE_FRAG = `
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform float uOpacity;
  uniform float uPulse;
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  void main() {
    // Fresnel so the silhouette glows and the facing surface stays open.
    float f = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir)));
    f = pow(clamp(f, 0.0, 1.0), 2.2);
    vec3 col = mix(uColorA, uColorB, f) * (f * 2.6 + uPulse * 0.8);
    float a = (f * 0.9 + uPulse * 0.25) * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;
