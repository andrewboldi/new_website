/**
 * AmbientField — a calm, deep, slowly drifting atmospheric layer that sits
 * BEHIND the molecular MorphField to give the page background depth/life.
 *
 * Technique: a single full-screen triangle with a fragment shader that builds
 * a *domain-warped* fBm (value-noise, 3 octaves) and maps its density across
 * the brand palette (bg → blue → cyan → faint violet). The warp makes the
 * field flow like a slow nebular gas rather than a static gradient. No
 * raymarching — cost is fixed and trivial, so it's mobile-safe.
 *
 * It is deliberately VERY subtle (low contrast, low alpha host) and never
 * competes with the molecules or hurts text readability — the page scrim still
 * applies on top. Reduced-motion is honoured by freezing `uTime` (core renders
 * a single static frame), and the scene pauses offscreen via core's IO.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, prefersReducedMotion } from './core';

// Fullscreen-triangle pass: clip-space positions, no camera needed.
const VS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Domain-warped value-noise fBm (3 octaves), palette-mapped. Kept cheap and
// banding-resistant (the composite finish dither also helps where present).
const FS = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform float uTime;
  uniform vec2  uResolution;
  uniform float uMotion;    // 0 frozen (reduced-motion) … 1 full drift
  uniform vec3  uBg;        // deep background
  uniform vec3  uBlue;      // mid-low band
  uniform vec3  uCyan;      // mid-high band
  uniform vec3  uViolet;    // faint highlight band

  // -- value noise --------------------------------------------------------
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);            // smootherstep-ish interp
    float a = hash(i + vec2(0.0, 0.0));
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  // 3-octave fBm (octaves capped at 3 per the perf budget)
  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.55;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);  // decorrelate octaves
    for (int i = 0; i < 3; i++) {
      v += amp * vnoise(p);
      p = rot * p * 2.0;
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    // aspect-correct so the field doesn't stretch on wide viewports
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.6;

    float t = uTime * 0.018 * uMotion;       // very slow drift

    // domain warp: fbm of (p + fbm(p + t)) — flowing, "living" marble.
    // Single warp layer (was two nested layers = 5 fbm taps/pixel; now 3). The
    // field is blurred + low-opacity behind everything, so the second warp added
    // ~40% shader cost for detail the blur erased. q is reused as the warp source.
    vec2 q = vec2(fbm(p + vec2(0.0, t)),
                  fbm(p + vec2(5.2, 1.3 - t)));
    float n = fbm(p + 1.9 * q + vec2(1.7, 9.2) + 0.10 * t);

    // gentle vertical falloff keeps the top (where headlines live) calmer
    float band = smoothstep(0.0, 1.0, uv.y * 0.6 + 0.25);

    // --- palette ramp: bg → blue → cyan → faint violet --------------------
    float d = clamp(n * 1.15, 0.0, 1.0);
    vec3 col = uBg;
    col = mix(col, uBlue,   smoothstep(0.30, 0.62, d));
    col = mix(col, uCyan,   smoothstep(0.55, 0.86, d) * 0.9);
    col = mix(col, uViolet, smoothstep(0.78, 0.99, d) * 0.55);

    // keep it deep + atmospheric: low overall brightness, no blowout. The warp
    // residual (q) adds faint filament structure without raising exposure.
    float glow = smoothstep(0.45, 1.0, d);
    col += (uCyan * 0.05 + uViolet * 0.03) * glow * length(q) * 0.5;

    // radial vignette so corners sink into the bg → seamless against the page
    vec2 cuv = uv - 0.5;
    float vig = smoothstep(0.85, 0.18, dot(cuv, cuv) * 2.0);

    float shade = (0.55 + 0.45 * band) * mix(0.4, 1.0, vig);
    col *= shade;

    // Transparent output: the field fades into the page's existing radial
    // atmosphere (body::before / .mood-layer) underneath rather than painting
    // over it. Denser fBm = a touch more presence; corners sink to clear so
    // there's no hard rectangular seam. Alpha stays modest (host opacity adds
    // the final dialing-back) to protect readability.
    float a = (0.45 + 0.55 * d) * vig;

    gl_FragColor = vec4(col, a);
  }
`;

export function ambientField(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, renderer } = ctx;
  const reduced = prefersReducedMotion();

  const toVec3 = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();

  const uniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(ctx.width, ctx.height) },
    uMotion: { value: reduced ? 0 : 1 },
    uBg: { value: toVec3(PALETTE.bg) },
    uBlue: { value: toVec3(PALETTE.blue) },
    uCyan: { value: toVec3(PALETTE.cyan) },
    uViolet: { value: toVec3(PALETTE.violet) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS,
    fragmentShader: FS,
    depthWrite: false,
    depthTest: false,
    transparent: true,
  });

  // Fullscreen triangle (covers clip space with 3 verts, no overdraw seam).
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  scene.add(quad);

  // keep resolution uniform in sync (host resizes are driven by core's RO,
  // which updates renderer size; we read the live drawing-buffer size here).
  const size = new THREE.Vector2();
  onFrame((t) => {
    renderer.getSize(size);
    uniforms.uResolution.value.set(size.x, size.y);
    if (!reduced) uniforms.uTime.value = t;
  });

  onDispose(() => {
    geo.dispose();
    mat.dispose();
  });
}
