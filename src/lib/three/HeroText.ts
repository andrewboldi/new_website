/**
 * HeroText — crisp glowing 3D headline for the homepage hero.
 *
 * A SEPARATE, deliberately LIGHT troika-three-text overlay that floats above the
 * GPGPU particle field (HeroField). It renders "Andrew Boldi" as ONE razor-sharp
 * SDF text mesh (Instrument Serif, the site's display face) — crisp at any DPR,
 * with an emissive cyan↔blue↔amber gradient that sweeps via `uTime` so it GLOWS
 * through the existing UnrealBloom (threshold 0.5) WITHOUT blowing out to white
 * (Andrew principle #9). The DOM keeps the real <h1> for a11y/SEO; this is purely
 * a visual enhancement layered on top.
 *
 * Why this is cheap (Andrew principle #1 + #13):
 *   - troika builds the SDF glyph atlas off the main thread (worker; main-thread
 *     fallback if workers are unavailable) — generation is one-time, off-frame.
 *   - Runtime cost is ONE extra draw call (a single Text mesh) + one cheap bloom-
 *     friendly fragment. No per-frame allocation; the only per-frame work is
 *     bumping a `uTime` uniform.
 *   - Reduced motion → a STATIC gradient (no sweep); the core loop renders a
 *     single frame, so it just shows crisp still text.
 *   - The host is an IntersectionObserver-paused overlay (core handles it), so
 *     once the hero scrolls away the scene stops rendering.
 *
 * Robustness: if troika/font init throws, we fail silently — the DOM <h1>
 * underneath remains the headline, so the name is never lost.
 */
import * as THREE from 'three';
import { Text, preloadFont } from 'troika-three-text';
import type { SceneHandle } from './core';
import { PALETTE, prefersReducedMotion } from './core';

// Same-origin Instrument Serif TTF (vendored to /public/fonts so there is no
// CORS / network dependency and no FOUT). Resolved against the deployed base,
// normalizing the trailing slash so the path is correct whether BASE_URL ends
// in "/" (e.g. "/new_website/") or not (e.g. "/new_website").
const FONT_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/fonts/InstrumentSerif-Regular.ttf`;

const HEADLINE = 'Andrew Boldi';

/**
 * GLSL injected into troika's patched material. troika multiplies its glyph SDF
 * coverage into the final alpha for us, so we only own the RGB: a smooth
 * cyan→blue→amber gradient that drifts horizontally with uTime, plus a soft
 * vertical sheen. Kept emissive-bright (peaks ~1.35, never 1.0-white on all
 * channels) so bloom catches it as a controlled glow, not a blown highlight.
 */
const COLOR_PATCH = /* glsl */ `
  // --- HeroText gradient (injected) ---
  // Only recolor the FILL pass. troika renders the dark OUTLINE with this same
  // material; under normal blending that dark rim is what makes the glyphs legible
  // over the bright particle field, so we must NOT overwrite it with our gradient.
  if (uHeroIsOutline < 0.5) {
  // use mesh-local position (vHeroLocal) for a continuous sweep across the whole
  // word (not per-glyph) → reads as one flowing iridescent bar.
  float gx = vHeroLocal.x;                 // normalized 0..1 across the headline
  float gy = vHeroLocal.y;                 // 0 bottom .. 1 top within the line
  float sweep = sin((gx * 3.14159) - uHeroTime * 0.55) * 0.5 + 0.5;
  // three on-brand stops: blue -> cyan -> amber, biased so cyan dominates
  vec3 cBlue  = vec3(${(PALETTE.blue >> 16 & 255) / 255}, ${(PALETTE.blue >> 8 & 255) / 255}, ${(PALETTE.blue & 255) / 255});
  vec3 cCyan  = vec3(${(PALETTE.cyan >> 16 & 255) / 255}, ${(PALETTE.cyan >> 8 & 255) / 255}, ${(PALETTE.cyan & 255) / 255});
  vec3 cAmber = vec3(${(PALETTE.amber >> 16 & 255) / 255}, ${(PALETTE.amber >> 8 & 255) / 255}, ${(PALETTE.amber & 255) / 255});
  // position-based base gradient (left blue → middle cyan → right warm)
  vec3 grad = mix(cBlue, cCyan, smoothstep(0.0, 0.55, gx));
  grad = mix(grad, mix(cCyan, cAmber, 0.6), smoothstep(0.55, 1.0, gx));
  // animated iridescent sweep nudges hue toward cyan highlight as it passes
  grad = mix(grad, cCyan, sweep * 0.35 * uHeroSweep);
  // gentle top sheen so the caps catch a little extra light
  grad += vec3(0.10, 0.14, 0.16) * smoothstep(0.35, 1.0, gy);
  // emissive lift — bright enough to cross bloom threshold, capped well under
  // full white so hues SURVIVE the bloom (no blowout).
  grad *= 1.35;
  grad = min(grad, vec3(1.45, 1.5, 1.55));
  gl_FragColor.rgb = grad;
  }
`;

export function heroText(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;
  const reduced = prefersReducedMotion();

  // Frame the headline: an orthographic-feeling perspective. We size the text in
  // world units and place the camera so the word spans most of the host width.
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  // Shared uniforms (driven each frame). Allocated ONCE — no per-frame GC.
  const uHeroTime = { value: 0 };
  const uHeroSweep = { value: reduced ? 0 : 1 };

  // Base material troika will clone+patch into an SDF text material.
  // NormalBlending (not additive): troika draws the dark OUTLINE and the bright
  // FILL with this same material, and a dark outline can only occlude the bright
  // particle field under normal blending (additive black is a no-op). The glow
  // then comes from BLOOM catching the bright fill (>threshold 0.5), giving a
  // controlled halo without blowing the field to white. toneMapped:false keeps
  // our emissive RGB intact through ACES so the hues survive.
  const baseMat = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    blending: THREE.NormalBlending,
  });

  // Inject our gradient. troika calls the assigned material's onBeforeCompile
  // chain, so we hook in a varying for mesh-local position + our color patch.
  // Driven per-draw via the mesh's onBeforeRender: troika renders the glyphs as a
  // 2-group multi-material draw ([outlineMtl, fillMtl]) sharing ONE program, so we
  // flip this flag before each group so the fragment knows which pass it is.
  const uHeroIsOutline = { value: 0 };

  baseMat.onBeforeCompile = (shader) => {
    shader.uniforms.uHeroTime = uHeroTime;
    shader.uniforms.uHeroSweep = uHeroSweep;
    shader.uniforms.uHeroIsOutline = uHeroIsOutline;
    shader.uniforms.uHeroBounds = { value: new THREE.Vector4(0, 0, 1, 1) }; // minX,minY,maxX,maxY (set after sync)
    uHeroBoundsRef = shader.uniforms.uHeroBounds;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec2 vHeroLocal;
         uniform vec4 uHeroBounds;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vHeroLocal = vec2(
           (position.x - uHeroBounds.x) / max(uHeroBounds.z - uHeroBounds.x, 0.0001),
           (position.y - uHeroBounds.y) / max(uHeroBounds.w - uHeroBounds.y, 0.0001)
         );`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec2 vHeroLocal;
         uniform float uHeroTime;
         uniform float uHeroSweep;
         uniform float uHeroIsOutline;`,
      )
      // place our color override right before troika/three's final dithering so
      // troika's glyph-alpha multiply (already applied to gl_FragColor.a) stands.
      .replace(
        '#include <dithering_fragment>',
        `${COLOR_PATCH}
         #include <dithering_fragment>`,
      );
  };

  // captured so we can write the real glyph bounds into the uniform post-sync
  let uHeroBoundsRef: { value: THREE.Vector4 } | null = null;

  const text = new Text();
  // Two stacked lines, LEFT-aligned — mirrors the DOM <h1> ("Andrew" / "Boldi")
  // so the 3D headline sits congruently in the same box, same size/position.
  text.text = HEADLINE.replace(' ', '\n');
  text.font = FONT_URL;
  text.fontSize = 1; // real size comes from the fit-to-host scale below
  text.lineHeight = 0.92;
  text.letterSpacing = -0.015;
  text.anchorX = 'left';
  text.anchorY = 'top';
  text.textAlign = 'left';
  text.material = baseMat;
  // Crisp dark halo → razor legibility over the bright additive particle field
  // (its glowing core can sit right behind the glyphs) and keeps the glow from
  // smearing. A wider soft outline reads as a contained dark rim, NOT a box.
  text.outlineWidth = '7%';
  text.outlineColor = 0x04060c;
  text.outlineOpacity = 0.92;
  text.outlineBlur = '5%';
  // a faint cool inner edge so the glyphs read as glowing glass, not flat fill
  text.strokeWidth = '0.5%';
  text.strokeColor = PALETTE.cyan;
  text.strokeOpacity = 0.5;
  text.sdfGlyphSize = 64; // crisp without an oversized atlas (light)
  text.frustumCulled = false;
  text.renderOrder = 10;
  // Per-pass flag: three calls onBeforeRender before EACH multi-material group
  // draw (outline group, then fill group), passing the material in use. troika
  // tags its outline clone with `isTextOutlineMaterial`, so we flip our uniform
  // accordingly — the outline keeps troika's dark color, the fill gets our glow.
  // IMPORTANT: chain troika's own onBeforeRender (it sets the SDF uniforms) — do
  // not replace it.
  const troikaOnBeforeRender = text.onBeforeRender.bind(text);
  text.onBeforeRender = (
    r: THREE.WebGLRenderer, s: THREE.Scene, c: THREE.Camera,
    g: THREE.BufferGeometry, material: THREE.Material, group: THREE.Group,
  ) => {
    troikaOnBeforeRender(r, s, c, g, material, group);
    uHeroIsOutline.value = (material as any)?.isTextOutlineMaterial ? 1 : 0;
  };
  scene.add(text);

  // Fit the 3D text to the HOST box (which overlays the <h1>): scale so the text
  // block fills the host height, and anchor it to the host's top-left — so it
  // lands exactly where the DOM headline was. Recomputed on resize.
  const fitToHost = () => {
    const info = (text as any).textRenderInfo;
    if (!info) return;
    const [minX, minY, maxX, maxY] = info.blockBounds; // local text units (y up)
    const hWorld = (maxY - minY) || 1;
    // visible world extents at z=0 for this perspective camera
    const vFov = (camera.fov * Math.PI) / 180;
    const halfH = Math.tan(vFov / 2) * camera.position.z;
    const halfW = halfH * camera.aspect;
    // Fill ~92% of the host height (the headline is the dominant element). The
    // host's aspect == camera.aspect (core sizes the renderer to the host), so
    // visible world height == 2*halfH maps to the host's pixel height.
    const targetWorldH = halfH * 2 * 0.92;
    const s = targetWorldH / hWorld;
    text.scale.setScalar(s);
    // top-left of the visible area, nudged in a hair for optical margin
    text.position.set(-halfW * 0.985, halfH * 0.96, 0);
    // feed real local bounds to the gradient (so 0..1 spans the actual glyphs)
    if (uHeroBoundsRef) uHeroBoundsRef.value.set(minX, minY, maxX, maxY);
  };

  let disposed = false;
  let fitted = false;

  // Force a paint — needed under reduced motion, where core renders ONE static
  // frame up front but our text.sync()/font load completes asynchronously after
  // it. We render across a couple of rAFs: troika flushes its GlyphsGeometry +
  // SDF uniforms during onBeforeRender of an actual render, so the FIRST render
  // primes the geometry and the SECOND draws the now-ready glyphs reliably.
  const renderOnce = () => {
    if (disposed) return;
    const draw = () => {
      if (disposed) return;
      if (ctx.composer) ctx.composer.render();
      else ctx.renderer.render(scene, camera);
    };
    draw();
    requestAnimationFrame(() => { draw(); requestAnimationFrame(draw); });
  };

  // Warm the SDF atlas off-thread (non-blocking; we don't depend on its callback).
  preloadFont({ font: FONT_URL, characters: HEADLINE, sdfGlyphSize: 64 }, () => {});

  // sync() is the canonical path: it loads the font, builds the SDF, then fires
  // the callback with textRenderInfo ready — so fitToHost() has real bounds.
  text.sync(() => {
    if (disposed) return;
    fitToHost();
    fitted = !!(text as any).textRenderInfo;
    if (reduced) renderOnce(); // static-text users: paint the now-ready glyphs
  });

  // Re-fit on resize (camera.aspect is updated by core before our frame cb runs).
  // Also defensively re-attempt the fit each frame until it has succeeded once,
  // in case textRenderInfo wasn't ready inside the sync callback yet.
  let lastAspect = camera.aspect;
  onFrame((t) => {
    if (!fitted || camera.aspect !== lastAspect) {
      lastAspect = camera.aspect;
      fitToHost();
      fitted = !!(text as any).textRenderInfo;
    }
    if (!reduced) uHeroTime.value = t;
  });

  onDispose(() => {
    disposed = true;
    text.dispose(); // frees troika's geometry + derived material + atlas refs
  });
}
