/**
 * Shared three.js scene scaffolding — SINGLE-CONTEXT architecture.
 *
 * Every scene on the site is a small module that receives a host <div>, builds
 * its world into `ctx.scene`, and animates in `onFrame` — it does NOT render
 * itself (core renders it). Lifecycle (RAF, resize, visibility pause,
 * reduced-motion, dispose) is handled here so individual scenes stay focused.
 *
 * WHY ONE CONTEXT (the big architectural change):
 *  A Chrome GPU trace proved the multi-scene lag was GPU command-submission
 *  thrash from MULTIPLE WebGL contexts (one per scene): `GLContextEGL::
 *  MakeCurrent` alone was ~625ms switching between per-scene renderers, GPUTask
 *  56% of wall time, while ANY single scene alone ran a perfect 16.7ms/0 spikes.
 *  A WebGL context belongs to exactly ONE canvas and cannot be shared across
 *  canvases, so the only way to one context is the canonical three.js "multiple
 *  scenes, one renderer" pattern (threejs.org/manual/en/multiple-scenes.html):
 *
 *   - ONE module-level WebGLRenderer + ONE <canvas> positioned `fixed; inset:0`
 *     covering the viewport (pointer-events:none, behind content). It persists
 *     across SPA navigation; scenes register/unregister against it.
 *   - Each REGISTERED + on-screen scene reads its host's getBoundingClientRect()
 *     every frame and is rendered into THAT rect via setViewport + setScissor +
 *     setScissorTest. In-flow tile hosts move with scroll; fixed hero/bg hosts
 *     stay — reading the rect live tracks both.
 *   - PER-SCENE POST: each scene keeps its own EffectComposer (bloom/finish/SMAA
 *     per tier), but it renders to its OWN WebGLRenderTarget (renderToScreen=
 *     false) sized to rect × renderScale; we then BLIT that RT's texture into the
 *     scene's screen rect with a scissored fullscreen-quad (a plain CopyShader,
 *     no second tone-map). One context, per-scene bloom + resolution scaling +
 *     no cross-bleed, zero MakeCurrent thrash. RTs are reused (no per-frame alloc).
 *
 * PERFORMANCE (preserved from the multi-canvas era):
 *  - A single MODULE-LEVEL scheduler drives every scene from ONE rAF. Per-scene
 *    priority (IntersectionObserver ratio × area) picks cadence: the top 1–2
 *    scenes render every frame, the rest are throttled (every 2nd/3rd/…), and
 *    OFF-SCREEN scenes are skipped wholesale (no sim, no render, no composite).
 *  - Per-scene QUALITY TIERS pick the post chain (hero/feature = full composer;
 *    tile = cheap bloom→output). An adaptive GOVERNOR samples a global rolling
 *    frame time and steps quality down when GPU-bound (drops finish+SMAA, lowers
 *    pixel ratio, broadcasts a `quality` signal scenes can read to cut work).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Combined filmic-finish pass (one fullscreen draw, runs in LINEAR space before
 * OutputPass): subtle vignette to focus the eye, faint animated film grain, and
 * a light ordered (Bayer 4x4) dither to kill banding in dark gradients. Kept
 * deliberately gentle — Andrew dislikes heavy-handed grades / blown highlights.
 */
const FilmicFinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.9 }, // outer darkening amount (0 = off)
    uGrain: { value: 0.05 }, // grain amplitude in linear space
    uDither: { value: 1.0 }, // dither amplitude in 1/255 units
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uDither;
    uniform vec2 uResolution;
    varying vec2 vUv;

    // hash-based pseudo noise for grain
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    // 4x4 ordered (Bayer) dither matrix, normalized to [-0.5, 0.5]
    float bayer(vec2 frag) {
      int x = int(mod(frag.x, 4.0));
      int y = int(mod(frag.y, 4.0));
      int idx = x + y * 4;
      float m[16];
      m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
      m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
      m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
      m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
      float v = 0.0;
      for (int i = 0; i < 16; i++) { if (i == idx) v = m[i]; }
      return v / 16.0 - 0.5;
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // --- vignette (smooth radial falloff toward corners) ---
      vec2 d = vUv - 0.5;
      float vig = smoothstep(0.85, 0.25, dot(d, d) * 2.0);
      vig = mix(1.0, vig, uVignette);
      color.rgb *= vig;

      // --- film grain (animated, luminance-aware so darks stay clean-ish) ---
      float g = hash(vUv * uResolution + fract(uTime) * 137.0) - 0.5;
      color.rgb += g * uGrain;

      // --- ordered dither (breaks up gradient banding) ---
      vec2 frag = vUv * uResolution;
      color.rgb += bayer(frag) * (uDither / 255.0);

      gl_FragColor = color;
    }
  `,
};

export const PALETTE = {
  bg: 0x06080f,
  blue: 0x0099ff,
  cyan: 0x38e8c8,
  amber: 0xffb347,
  violet: 0x9d7bff,
  white: 0xeaf0fb,
};

export const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scene quality tier — selects the post-processing chain + pixel-ratio cap. */
export type SceneTier = 'hero' | 'feature' | 'tile';

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** the SHARED renderer (one per page) */
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer | null;
  host: HTMLElement;
  /** seconds since first frame */
  clock: THREE.Clock;
  /** normalized pointer in [-1,1], eased */
  pointer: THREE.Vector2;
  width: number;
  height: number;
  /**
   * Adaptive quality in [0..1], driven by the global governor. 1 = full detail;
   * lower when the page is GPU-bound. Scenes MAY read this to scale particle
   * counts etc. — it changes rarely (hysteresis), so reading it per frame is fine.
   */
  readonly quality: number;
}

export interface SceneHandle {
  ctx: SceneContext;
  /** called on every animated frame; receives (elapsed, delta) */
  onFrame: (cb: (t: number, dt: number) => void) => void;
  /** register extra cleanup */
  onDispose: (cb: () => void) => void;
  /** subscribe to adaptive-quality changes (also fires once with the current value) */
  onQuality: (cb: (q: number) => void) => void;
  destroy: () => void;
}

export interface CreateSceneOpts {
  host: HTMLElement;
  /** camera field of view */
  fov?: number;
  /** initial camera z */
  cameraZ?: number;
  alpha?: boolean;
  /** add an UnrealBloom composer chain */
  bloom?: { strength?: number; radius?: number; threshold?: number } | false;
  /** clear color when not alpha (per-scene background fill, drawn into its rect) */
  clearColor?: number;
  /** render a single static frame even under reduced motion (default true) */
  staticFallback?: boolean;
  /** cap the device pixel ratio (cheaper for large/background regions) */
  maxPixelRatio?: number;
  /**
   * Internal RENDER SCALE in (0..1] — render this scene's composer target at this
   * fraction of its CSS rect, then upscale on blit. On a hi-DPI display fill
   * scales with pixel COUNT, so this is the single biggest lever for FULLSCREEN
   * scenes (the hero cloud + the page-wide fBm/molecular backgrounds): a soft,
   * glowy, blurred field upscales nearly invisibly but costs 2–4× less to fill.
   *
   * Default 1.0 (small tile/feature scenes render crisp at native). Fullscreen
   * scenes should pass ~0.5–0.66. The governor multiplies this DOWN further under
   * load. The effective pixel ratio is floored at 0.4 so it never gets mushy.
   */
  renderScale?: number;
  /**
   * Quality tier (default 'feature'):
   *  - 'hero'    full composer, pixelRatio ≤2 (≤1.5 under load), always high
   *              scheduler priority. For the homepage centerpiece.
   *  - 'feature' full composer (bloom + filmic finish + SMAA), pixelRatio ≤1.5.
   *              The governor strips finish+SMAA from feature scenes first when
   *              GPU-bound. For protein / molecule / lab feature scenes.
   *  - 'tile'    CHEAP path: a single bloom pass → output (no SMAA, no filmic),
   *              pixelRatio ≤1.0. For the many small scene tiles. Emissive
   *              compensation lives in the scene/registry so tiles still glow.
   */
  tier?: SceneTier;
  /**
   * Added to this scene's scheduler priority, which decides which scenes get
   * FULL frame rate (`_stride = 1`) and which are throttled to every 2nd/3rd
   * frame. Base priority is `intersectionRatio × area` (+1 for tier 'hero'), so
   * two fullscreen background fields both score ~1.0 and the tie breaks on MOUNT
   * ORDER — which silently starved the scroll-linked morph field to 30fps behind
   * the purely decorative fBm atmosphere.
   *
   * Pass a small boost (~0.5) on any scene whose motion is SCROLL-LINKED: those
   * must sample scroll every frame or they visibly stair-step, while ambient,
   * slow, or blurred scenes are indistinguishable at half rate. This re-ranks
   * scenes rather than adding frame budget — the throttling still applies, it
   * just falls on the scene that can afford it.
   */
  priorityBoost?: number;
  /** scene needs shadow maps (the bookshelf). Enables shadowMap on the shared renderer. */
  shadows?: boolean;
  /**
   * COMPOSITE MODE on the shared canvas:
   *  - default (false): ADDITIVE — the scene's light is added over the background
   *    (the glowing molecular/particle aesthetic: sparse bright geometry on a
   *    transparent RT, dark pixels let the background show through). Correct for
   *    nearly every scene.
   *  - true: SOLID — standard premultiplied "over" so opaque lit geometry occludes
   *    what's behind it (the bookshelf, the ball-and-stick molecule, the piano,
   *    the Rubik's cube — solid objects, not additive glow).
   */
  solid?: boolean;
  /**
   * COMPOSITE LAYER (z-order on the shared canvas). Lower = further back. The
   * fullscreen BACKGROUND fields (hero cloud, morph field, ambient fBm) pass 0 so
   * they paint UNDER everything; in-flow CONTENT scene tiles use the default 1 and
   * draw on top within their rects. Defaults to 0 for hosts that are CSS
   * position:fixed (the backgrounds) and 1 otherwise, so callers rarely set it.
   */
  layer?: number;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  SHARED RENDERER SINGLETON
 *  One WebGLRenderer + one fixed full-viewport canvas for the whole page. A
 *  WebGL context cannot be shared across canvases, so this single canvas is the
 *  only way every scene lives on ONE GL context (killing the MakeCurrent thrash).
 * ────────────────────────────────────────────────────────────────────────── */

interface Shared {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  /** CSS pixel size of the canvas (viewport). */
  cssW: number;
  cssH: number;
  /** fullscreen-quads used to blit each scene's RT into its screen rect. */
  blitQuad: FullScreenQuad;       // premultiplied "over" — opaque scenes
  blitMat: THREE.ShaderMaterial;
  blitAddQuad: FullScreenQuad;    // additive — transparent/glowing scenes
  blitAddMat: THREE.ShaderMaterial;
  /** shared CopyShader uniforms (tDiffuse) used by both blit quads. */
  blitUniforms: typeof CopyShader.uniforms;
  /** does any registered scene want shadows? */
  shadowWanted: boolean;
}

let shared: Shared | null = null;

/** Base device-pixel-ratio cap for the SHARED canvas buffer. Per-scene render
 *  scale shrinks each scene's RT below this; the canvas itself blits at this. */
const CANVAS_DPR_CAP = 2;

function canvasDpr() {
  return Math.min(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1, CANVAS_DPR_CAP);
}

function ensureShared(): Shared {
  if (shared) return shared;

  const canvas = document.createElement('canvas');
  canvas.id = 'gl-shared';
  // Fixed, full-viewport, behind content, never intercepts pointer events.
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'block',
    pointerEvents: 'none',
    zIndex: '0',
  } as CSSStyleDeclaration);
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // SMAA is applied per-scene in the composer where needed
    alpha: true, // page content / mood layer shows through transparent regions
    powerPreference: 'high-performance',
    premultipliedAlpha: true,
  });
  const cssW = window.innerWidth || 1;
  const cssH = window.innerHeight || 1;
  renderer.setPixelRatio(canvasDpr());
  renderer.setSize(cssW, cssH, false);
  renderer.autoClear = false; // we clear the whole canvas ONCE per frame ourselves
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);

  // Blit materials — copy each scene's RT (already tone-mapped + sRGB-encoded by
  // its OutputPass; NO second conversion here) onto the shared canvas. The canvas
  // is `alpha:true`, so the BROWSER composites it over the page (mood layer + body
  // gradient) using the canvas ALPHA — which means the blit must write a sensible
  // alpha, not just RGB, or bright-but-sparse pixels would be composited away.
  //
  //  • ADDITIVE (transparent/glowing scenes — backgrounds + molecular tiles +
  //    feature scenes): the scene drew its light additively onto a transparent RT,
  //    so the RT IS accumulated light. We ADD that rgb over whatever's already on
  //    the canvas (e.g. the morph field) AND raise the canvas alpha to the pixel's
  //    luminance, so a thin bright Fourier phasor / Three-body trail stays visible
  //    over the dark page instead of being discarded as near-transparent. Dark
  //    scene pixels (rgb≈0 → alpha≈0) leave the background showing through. This
  //    reproduces the old per-canvas "additive scene over the field" look.
  //  • OVER (solid scenes — piano, bookshelf, ball-and-stick molecule, Rubik's):
  //    standard straight-alpha over; the RT's own alpha (1 on opaque geometry)
  //    occludes the background.
  const blitVert = CopyShader.vertexShader;
  const blitFragOver = /* glsl */ `
    uniform float opacity; uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() { gl_FragColor = texture2D(tDiffuse, vUv) * opacity; }
  `;
  const blitFragAdd = /* glsl */ `
    uniform float opacity; uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // canvas alpha = perceived brightness so glow shows over the page; rgb adds.
      float a = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0);
      gl_FragColor = vec4(c.rgb * opacity, a * opacity);
    }
  `;
  const blitUniforms = THREE.UniformsUtils.clone(CopyShader.uniforms);
  const blitMat = new THREE.ShaderMaterial({
    uniforms: blitUniforms,
    vertexShader: blitVert,
    fragmentShader: blitFragOver,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,       // straight-alpha "over" for rgb
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,  // canvas alpha builds toward opaque
  });
  const blitAddMat = new THREE.ShaderMaterial({
    uniforms: blitUniforms, // SHARED uniforms (same tDiffuse set per scene per frame)
    vertexShader: blitVert,
    fragmentShader: blitFragAdd,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,                    // additive rgb: dst.rgb += src.rgb
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,               // additive alpha: dst.a += lum
  });
  const blitQuad = new FullScreenQuad(blitMat);
  const blitAddQuad = new FullScreenQuad(blitAddMat);

  shared = { renderer, canvas, cssW, cssH, blitQuad, blitMat, blitAddQuad, blitAddMat, blitUniforms, shadowWanted: false };

  // Keep the canvas sized to the viewport. Scenes read their own rects each
  // frame, so we only need the canvas itself to match the viewport.
  window.addEventListener('resize', onSharedResize, { passive: true });

  if (import.meta.env.DEV && typeof window !== 'undefined') {
    (window as unknown as { __glShared: () => unknown }).__glShared = () => ({
      contexts: 1,
      cssW: shared?.cssW,
      cssH: shared?.cssH,
      pixelRatio: shared?.renderer.getPixelRatio(),
      scenes: tasks.size,
      shadows: shared?.shadowWanted,
    });
  }
  return shared;
}

let sharedResizeRAF = 0;
function onSharedResize() {
  cancelAnimationFrame(sharedResizeRAF);
  sharedResizeRAF = requestAnimationFrame(() => {
    if (!shared) return;
    shared.cssW = window.innerWidth || 1;
    shared.cssH = window.innerHeight || 1;
    shared.renderer.setPixelRatio(canvasDpr());
    shared.renderer.setSize(shared.cssW, shared.cssH, false);
  });
}

/** Tear the shared renderer + canvas down (SPA leave / no scenes left). */
function disposeShared() {
  if (!shared) return;
  window.removeEventListener('resize', onSharedResize);
  cancelAnimationFrame(sharedResizeRAF);
  try { shared.blitQuad.dispose(); } catch { /* noop */ }
  try { shared.blitAddQuad.dispose(); } catch { /* noop */ }
  try { shared.blitMat.dispose(); } catch { /* noop */ }
  try { shared.blitAddMat.dispose(); } catch { /* noop */ }
  try { shared.renderer.dispose(); } catch { /* noop */ }
  shared.renderer.forceContextLoss?.();
  shared.canvas.remove();
  shared = null;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  MODULE-LEVEL SCHEDULER + GOVERNOR
 *  One rAF drives all scenes. Per-scene priority decides render cadence so N
 *  visible scenes no longer cost N× full renders every frame.
 * ────────────────────────────────────────────────────────────────────────── */

interface SchedTask {
  /**
   * Advance simulation and, when `render` is true, re-render this scene's
   * composer into its OWN render target. Does NOT touch the shared canvas — the
   * scheduler composites separately (see `composite`). This is the EXPENSIVE
   * work the stride/governor throttles.
   */
  step: (t: number, dt: number, render: boolean) => void;
  /**
   * BLIT this scene's render target (its last-rendered frame, persistent) into
   * its host rect on the shared canvas. CHEAP (one textured quad), so the
   * scheduler calls it for EVERY on-screen scene EVERY frame — that's what keeps
   * the composited image complete (no blank regions) even for throttled scenes
   * that didn't re-render this frame. Returns true if it actually blitted (i.e.
   * the RT was initialized and the rect was on-screen).
   */
  composite: () => boolean;
  /** prominence in [0..1]: intersectionRatio × normalized canvas area. */
  priority: () => number;
  /** true while on-screen and not reduced-motion-frozen. */
  active: () => boolean;
  /**
   * HARD FREEZE: true while the scene is intersecting the viewport (even a sliver).
   * When false the scheduler skips the task ENTIRELY — no frame callbacks, no
   * simulation, no render — so an off-screen scene costs ~0.
   */
  onScreen: () => boolean;
  /**
   * COMPOSITE LAYER (z-order). Scenes are blitted onto the ONE shared canvas in
   * ascending layer order each frame, so a fullscreen BACKGROUND field (layer 0)
   * is painted first and in-flow CONTENT tiles (layer 1, default) draw ON TOP of
   * it within their rects. Without this a fullscreen background blitted after a
   * tile would overpaint the tile's region (its scissor is the whole viewport).
   */
  layer: number;
  /** stride bucket for throttled scenes (filled by the scheduler each frame). */
  _stride: number;
  _phase: number;
  /**
   * True once the scene has rendered its RT at least once. Until then its RT is
   * uninitialized and MUST NOT be blitted (it would flash garbage/black). The
   * scheduler uses this to render-on-first-appearance and to avoid counting an
   * un-blitted just-appeared scene as a flicker shortfall.
   */
  _everRendered: boolean;
}

const tasks = new Set<SchedTask>();
let schedRAF = 0;
let frameIndex = 0;

/**
 * Optional hook run at the TOP of every scheduler frame, before any scene steps.
 * Exists for the damped-scroll layer (src/scripts/smooth-scroll.ts): the scroll
 * position must advance before scroll-linked scenes read `window.scrollY` in the
 * same frame, or the background trails the page by one frame. Driving it from
 * this rAF instead of a second one is what keeps them locked together.
 */
let preFrame: ((nowMs: number) => void) | null = null;

/**
 * Register (or clear, with null) the pre-frame hook. Keeps the scheduler rAF
 * alive on its own, so a page with zero mounted scenes still ticks the hook —
 * otherwise smooth scrolling would silently die wherever no scene is mounted.
 */
export function setPreFrame(cb: ((nowMs: number) => void) | null) {
  preFrame = cb;
  if (cb) ensureScheduler();
  else if (tasks.size === 0 && schedRAF) {
    cancelAnimationFrame(schedRAF);
    schedRAF = 0;
  }
}

// Lightweight instrumentation, split so we can PROVE the fix:
//  • sceneRenderCount  — EXPENSIVE composer renders (throttled by stride/governor).
//  • sceneCompositeCount — CHEAP blits onto the shared canvas (every on-screen
//    scene, EVERY frame). A flicker would show up as composites < on-screen×frames.
let sceneRenderCount = 0;
let sceneCompositeCount = 0;
let schedTicks = 0; // number of scheduler-loop iterations (detects rAF starvation)
// Per-frame composite accounting: how many on-screen scenes blitted on the frame
// that just completed, and how many were on-screen and SHOULD have. The verifier
// asserts these are equal on every frame (no blank regions).
let lastFrameOnScreen = 0;
let lastFrameComposited = 0;
let frameCompositeShortfalls = 0; // frames where composited < onScreen (a flicker)
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __sceneRenderCount: () => number }).__sceneRenderCount = () => sceneRenderCount;
  (window as unknown as { __sceneCompositeCount: () => number }).__sceneCompositeCount = () => sceneCompositeCount;
  (window as unknown as { __sceneStats: () => unknown }).__sceneStats = () => {
    const strides: Record<number, number> = {};
    let active = 0;
    let offscreen = 0;
    for (const tk of tasks) {
      if (!tk.active() || !tk.onScreen()) { offscreen++; continue; }
      active++;
      strides[tk._stride] = (strides[tk._stride] ?? 0) + 1;
    }
    return {
      renders: sceneRenderCount,
      composites: sceneCompositeCount,
      lastFrameOnScreen,
      lastFrameComposited,
      frameCompositeShortfalls, // MUST stay 0 — any increment is a blank-region frame
      schedTicks,
      activeScenes: active,
      offscreenScenes: offscreen,
      totalScenes: tasks.size,
      contexts: shared ? 1 : 0,
      quality: qLevel,
      avgFrameMs: avgFrame,
      strideHistogram: strides,
    };
  };
}

// ---- governor state (global, shared by all scenes) ----
let qLevel = 1; // current broadcast quality in [0..1]
const qSubs = new Set<(q: number) => void>();
let avgFrame = 16.7; // rolling average frame time (ms)
let slowAccum = 0; // ms spent "slow" (debounce stepping down)
let fastAccum = 0; // ms spent "fast" (debounce stepping up)
const SLOW_MS = 22;
const FAST_MS = 15;
const STEP_DEBOUNCE = 600; // ms a condition must persist before we change qLevel
const Q_STEPS = [1, 0.75, 0.5, 0.35]; // quality ladder (0.35 = deepest cut for weak iGPUs)

function setQuality(next: number) {
  if (next === qLevel) return;
  qLevel = next;
  for (const cb of qSubs) { try { cb(qLevel); } catch { /* noop */ } }
}

function governorTick(frameMs: number) {
  if (frameMs > 0 && frameMs < 500) avgFrame += (frameMs - avgFrame) * 0.1;

  const idx = Q_STEPS.indexOf(qLevel);
  if (avgFrame > SLOW_MS) {
    slowAccum += frameMs; fastAccum = 0;
    if (slowAccum > STEP_DEBOUNCE && idx < Q_STEPS.length - 1) {
      setQuality(Q_STEPS[idx + 1]);
      slowAccum = 0;
    }
  } else if (avgFrame < FAST_MS) {
    fastAccum += frameMs; slowAccum = 0;
    if (fastAccum > STEP_DEBOUNCE && idx > 0) {
      setQuality(Q_STEPS[idx - 1]);
      fastAccum = 0;
    }
  } else {
    slowAccum = 0; fastAccum = 0;
  }
}

/** Number of full-rate scenes (rest are throttled). Tunable budget. */
const FULL_RATE_BUDGET = 2;

const liveScratch: SchedTask[] = [];
const byPriorityDesc = (a: SchedTask, b: SchedTask) => b.priority() - a.priority();
// Separate scratch + comparator for the per-frame LAYER-ordered render pass
// (kept distinct from assignStrides' priority sort so neither clobbers the other).
const renderScratch: SchedTask[] = [];
const byLayerAsc = (a: SchedTask, b: SchedTask) => a.layer - b.layer;

function assignStrides() {
  const live = liveScratch;
  let n = 0;
  for (const tk of tasks) if (tk.active() && tk.onScreen()) live[n++] = tk;
  live.length = n; // trim without reallocating the backing store
  live.sort(byPriorityDesc);
  const farStride = qLevel <= 0.5 ? 5 : qLevel < 1 ? 4 : 3;
  for (let i = 0; i < n; i++) {
    const tk = live[i];
    if (i < FULL_RATE_BUDGET) tk._stride = 1;
    else if (i < FULL_RATE_BUDGET + 2) tk._stride = 2;
    else tk._stride = farStride;
  }
}

let schedLast = 0;
function schedulerLoop(now: number) {
  schedRAF = requestAnimationFrame(schedulerLoop);
  const frameMs = schedLast ? now - schedLast : 16.7;
  schedLast = now;
  if (document.hidden) return;
  schedTicks++;

  // Advance damped scroll FIRST — every scene below reads window.scrollY, and
  // they must all see the position this frame actually renders at.
  if (preFrame) preFrame(now);

  governorTick(frameMs);
  assignStrides();

  const t = now / 1000;
  const dt = Math.min(frameMs / 1000, 0.05);

  // Build the on-screen list ONCE and sort by ascending LAYER so background
  // fields composite UNDER content tiles on the single shared canvas (a
  // fullscreen background blitted after a tile would otherwise overpaint it).
  // Stable-ish sort by layer only (preserves Set order within a layer, which is
  // mount order — fine for same-layer siblings that don't overlap).
  const order = renderScratch;
  let m = 0;
  for (const tk of tasks) {
    if (!tk.active() || !tk.onScreen()) continue;
    order[m++] = tk;
  }
  order.length = m;
  order.sort(byLayerAsc);

  // ── PASS 1: SIMULATE + (throttled) RE-RENDER ────────────────────────────
  // Each scene advances its sim every frame; only the stride/governor-selected
  // subset re-renders its composer into its OWN render target (the expensive
  // work). Throttled scenes keep their last RT untouched — it's reused as-is by
  // the composite pass below. This pass does NOT touch the shared canvas.
  for (let i = 0; i < m; i++) {
    const tk = order[i];
    const render = (frameIndex % tk._stride) === tk._phase % tk._stride;
    tk.step(t, dt, render);
  }

  // ── PASS 2: COMPOSITE (clear once, then blit EVERY on-screen scene) ──────
  // The render targets above are stable, so we can clear the canvas and blit
  // every on-screen scene's RT — including throttled ones that didn't re-render
  // this frame — producing a COMPLETE image with no blank regions. The blit is
  // cheap (a scissored textured quad), so doing it for all visible scenes every
  // frame is fine and is what kills the throttle-induced flicker.
  //
  // Ordering matters: we MUST clear *after* PASS 1, because a scene's
  // composer.render() leaves the renderer bound to null with a full viewport,
  // and clearing here guarantees a clean framebuffer right before compositing
  // (no double-clear: this is the ONLY clear per frame).
  const sh = shared;
  if (sh) {
    sh.renderer.setRenderTarget(null);
    sh.renderer.setScissorTest(false);
    sh.renderer.clear(true, true, true);
  }
  let composited = 0;
  for (let i = 0; i < m; i++) {
    if (order[i].composite()) composited++;
  }
  // Per-frame flicker accounting: every on-screen scene that has rendered at
  // least once must composite. A scene entering view that hasn't rendered yet
  // legitimately can't blit (its RT is uninitialized) — that's not a flicker, so
  // we only flag a shortfall once all on-screen scenes are initialized.
  lastFrameOnScreen = m;
  lastFrameComposited = composited;
  if (composited < m) {
    // Distinguish "uninitialized, will render next" from a true blank region.
    let initialized = 0;
    for (let i = 0; i < m; i++) if (order[i]._everRendered) initialized++;
    if (composited < initialized) frameCompositeShortfalls++;
  }

  // Leave the renderer in a clean state for the next frame / any external GL use.
  if (sh) sh.renderer.setScissorTest(false);
  frameIndex++;
}

function ensureScheduler() {
  if (!schedRAF) {
    schedLast = 0;
    schedRAF = requestAnimationFrame(schedulerLoop);
  }
}

function addTask(tk: SchedTask) {
  tk._phase = tasks.size; // de-sync throttled renders across scenes
  tasks.add(tk);
  ensureScheduler();
}

function removeTask(tk: SchedTask) {
  tasks.delete(tk);
  // Keep the loop alive for the pre-frame hook (damped scroll) even with no scenes.
  if (tasks.size === 0 && !preFrame && schedRAF) {
    cancelAnimationFrame(schedRAF);
    schedRAF = 0;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 *  createScene — registers a scene against the shared renderer.
 * ────────────────────────────────────────────────────────────────────────── */

export function createScene(opts: CreateSceneOpts): SceneHandle {
  const { host } = opts;
  const reduced = prefersReducedMotion();
  const tier: SceneTier = opts.tier ?? 'feature';
  const priorityBoost = opts.priorityBoost ?? 0;

  const sh = ensureShared();
  if (opts.shadows) {
    sh.shadowWanted = true;
    sh.renderer.shadowMap.enabled = true;
  }
  const renderer = sh.renderer;

  // Composite layer: explicit opts.layer wins; otherwise fixed-position hosts are
  // backgrounds (layer 0, painted first/under), everything else is content (10).
  // The gap (0..10) lets fixed background fields stack among themselves (ambient
  // 0 < morph 1 < hero 2) while always staying under in-flow content tiles.
  let layer = opts.layer;
  if (layer === undefined) {
    let fixed = false;
    try { fixed = getComputedStyle(host).position === 'fixed'; } catch { /* noop */ }
    layer = fixed ? 0 : 10;
  }

  // Per-tier pixel-ratio cap (tiles ≤1, feature ≤1.5, hero ≤2). An explicit
  // opts.maxPixelRatio still wins so callers can override.
  const tierCap = tier === 'tile' ? 1 : tier === 'hero' ? 2 : 1.5;
  const baseCap = opts.maxPixelRatio ?? tierCap;
  // Internal render scale (fraction of CSS rect the scene's RT is rendered at;
  // the blit upscales). Default 1.0 = native; fullscreen scenes pass ~0.5–0.66.
  const renderScale = Math.min(1, Math.max(0.1, opts.renderScale ?? 1));
  // SOLID scenes (opaque lit geometry, or explicitly opts.solid) blit with
  // premultiplied "over" so they occlude; everything else ADDS its glow over the
  // background — the molecular/additive aesthetic, and the only mode that keeps
  // sparse glowing scenes (thin Fourier phasors, Three-body trails) visible.
  const isOpaque = opts.solid === true || !(opts.alpha ?? true);

  // Initial CSS rect from the host (fallback to 1px so nothing divides by zero).
  const rect0 = host.getBoundingClientRect();
  let cssW = Math.max(1, Math.round(rect0.width) || host.clientWidth || 1);
  let cssH = Math.max(1, Math.round(rect0.height) || host.clientHeight || 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 55, cssW / cssH, 0.1, 4000);
  camera.position.z = opts.cameraZ ?? 6;

  // Effective device-pixel-ratio for THIS scene's RT: clamp(devicePixelRatio,
  // baseCap) × renderScale × governor-load-scale, floored at 0.4.
  let curPixelRatio = Math.min(canvasDpr(), baseCap) * renderScale;
  // RT buffer dimensions (device pixels).
  const rtW = () => Math.max(1, Math.round(cssW * curPixelRatio));
  const rtH = () => Math.max(1, Math.round(cssH * curPixelRatio));

  // ── Per-scene render target + post-processing chain, built per tier ──────
  // The composer renders into `target` (renderToScreen=false); we blit its
  // result texture into the scene's screen rect each frame.
  const target = new THREE.WebGLRenderTarget(rtW(), rtH(), {
    // 8-bit like the old per-scene canvas (which looked great). Bloom's internal
    // mip RTs keep their own HDR-ish precision; a HalfFloat final target doubled
    // RT memory/bandwidth and periodically stalled the weak iGPU's pipeline
    // (~600ms hitches) for no visible gain, so we match the old format.
    type: THREE.UnsignedByteType,
    samples: 0,
    depthBuffer: true,
    stencilBuffer: false,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace; // OutputPass writes sRGB here

  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  let finishPass: ShaderPass | null = null;
  let smaaPass: SMAAPass | null = null;
  let renderPass: RenderPass | null = null;
  let outputPass: OutputPass | null = null;
  let premiumOn = tier !== 'tile';

  // Even tile/no-bloom scenes get a composer (RenderPass → [bloom] → OutputPass)
  // so EVERYTHING composites through the same RT→blit path. OutputPass applies
  // tone-map + sRGB ONCE into the RT; the blit is a raw copy.
  composer = new EffectComposer(renderer, target);
  composer.renderToScreen = false;
  renderPass = new RenderPass(scene, camera);
  // Per-scene background fill (opaque scenes): RenderPass clears the RT with the
  // scene's clearColor; transparent scenes leave the RT transparent so the page
  // shows through after the blit.
  if (!(opts.alpha ?? true)) {
    scene.background = new THREE.Color(opts.clearColor ?? PALETTE.bg);
  }
  composer.addPass(renderPass);

  if (opts.bloom) {
    const bloomRes = new THREE.Vector2(
      Math.max(1, Math.round(cssW * 0.5)),
      Math.max(1, Math.round(cssH * 0.5)),
    );
    bloomPass = new UnrealBloomPass(
      bloomRes,
      opts.bloom.strength ?? 0.8,
      opts.bloom.radius ?? 0.5,
      opts.bloom.threshold ?? 0.5,
    );
    composer.addPass(bloomPass);
  }

  if (tier !== 'tile') {
    // FULL path (hero/feature): vignette+grain+dither, then SMAA.
    finishPass = new ShaderPass(FilmicFinishShader);
    finishPass.uniforms.uResolution.value.set(cssW, cssH);
    composer.addPass(finishPass);
    smaaPass = new SMAAPass();
    composer.addPass(smaaPass);
  }
  outputPass = new OutputPass();
  composer.addPass(outputPass);
  composer.setSize(rtW(), rtH());

  // Rebuild the pass list when the governor toggles premium quality.
  const rebuildPasses = () => {
    if (!composer || !renderPass || !outputPass) return;
    composer.passes.length = 0;
    composer.addPass(renderPass);
    if (bloomPass) composer.addPass(bloomPass);
    if (premiumOn && finishPass && smaaPass) {
      composer.addPass(finishPass);
      composer.addPass(smaaPass);
    }
    composer.addPass(outputPass);
  };

  const ctxState = { quality: qLevel, ticks: 0 };
  const ctx: SceneContext = {
    scene, camera, renderer, composer, host,
    clock: new THREE.Clock(),
    pointer: new THREE.Vector2(0, 0),
    width: cssW, height: cssH,
    get quality() { return ctxState.quality; },
  };

  const frameCbs: Array<(t: number, dt: number) => void> = [];
  const disposeCbs: Array<() => void> = [];
  const qualityCbs: Array<(q: number) => void> = [];
  const onFrame = (cb: (t: number, dt: number) => void) => frameCbs.push(cb);
  const onDispose = (cb: () => void) => disposeCbs.push(cb);
  const onQuality = (cb: (q: number) => void) => { qualityCbs.push(cb); cb(ctxState.quality); };

  // ---- pointer (eased toward target). Read against the host's live rect so a
  // scene's pointer is correct wherever the host sits on the (scrolling) page. ----
  const targetPointer = new THREE.Vector2(0, 0);
  const onPointer = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    targetPointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -(((e.clientY - r.top) / r.height) * 2 - 1),
    );
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  // ---- resize the scene's RT/composer when its CSS rect changes ----
  // RenderTarget.setSize early-outs when dims are unchanged, so calling these on
  // an unchanged rect is cheap (a comparison); only an actual change reallocates.
  const applyRtSize = () => {
    const w = rtW(), h = rtH();
    target.setSize(w, h);
    composer?.setSize(w, h);
    // composer.setSize resized bloom to full RT res — pull it back to half-res.
    bloomPass?.setSize(Math.max(1, Math.round(w * 0.5)), Math.max(1, Math.round(h * 0.5)));
    finishPass?.uniforms.uResolution.value.set(cssW, cssH);
  };

  const applyPixelRatio = () => {
    const loadScale = qLevel >= 1 ? 1 : qLevel >= 0.75 ? 0.8 : qLevel >= 0.5 ? 0.65 : 0.5;
    const want = Math.min(canvasDpr(), baseCap) * renderScale * loadScale;
    const clamped = Math.max(0.4, want);
    if (Math.abs(clamped - curPixelRatio) > 0.01) {
      curPixelRatio = clamped;
      applyRtSize();
    }
  };

  // Recompute the CSS rect from the host. Returns true if it changed.
  const syncRect = (): boolean => {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width) || host.clientWidth || 1);
    const h = Math.max(1, Math.round(r.height) || host.clientHeight || 1);
    if (w === cssW && h === cssH) return false;
    cssW = w; cssH = h;
    ctx.width = w; ctx.height = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyRtSize();
    return true;
  };

  // ---- visibility + prominence (drives scheduler priority + hard freeze) ----
  let visible = true;
  let ratio = 1; // intersectionRatio in [0..1]
  let wasOnScreen = false;
  // True once this scene's RT holds a rendered frame. Guards the blit so we never
  // composite an uninitialized RT (would flash garbage). Set on first renderScene.
  let everRendered = false;
  let ownRenders = 0; // DEV: this scene's own composer renders (proves its real frame rate)
  const vis = new IntersectionObserver(
    ([e]) => {
      visible = e.isIntersecting;
      ratio = e.intersectionRatio;
      if (!visible) wasOnScreen = false;
    },
    { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
  );
  vis.observe(host);

  // ── BLIT (COMPOSITE) this scene's RT into its screen rect on the shared canvas.
  // Reads the host's LIVE rect each frame (tracks scroll). Skips when the rect
  // is fully outside the viewport. Y is flipped (GL origin = bottom-left). This
  // is the CHEAP per-frame work: it ALWAYS uses the RT's CURRENT contents (the
  // last frame the composer rendered), so a throttled scene that didn't re-render
  // this frame still paints its full region — no blank flicker. Returns true if
  // it actually drew (RT initialized + rect on-screen).
  const blitToScreen = (): boolean => {
    if (!everRendered) return false; // RT not yet initialized — nothing to blit
    const r = host.getBoundingClientRect();
    const cw = sh.cssW, ch = sh.cssH;
    // Off-screen / zero-size guard (clip to viewport bounds).
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.bottom <= 0 || r.top >= ch || r.right <= 0 || r.left >= cw) return false;
    // setViewport/setScissor take CSS pixels (three multiplies by pixelRatio).
    const left = r.left;
    const width = r.width;
    const height = r.height;
    const bottomUp = ch - r.bottom; // flip top-left DOM → bottom-left GL
    renderer.setRenderTarget(null);
    renderer.setViewport(left, bottomUp, width, height);
    renderer.setScissor(left, bottomUp, width, height);
    renderer.setScissorTest(true);
    sh.blitUniforms.tDiffuse.value = (composer as EffectComposer).readBuffer.texture;
    // Opaque scenes paint solidly (over); transparent/glowing scenes ADD their
    // light over the background (see the blit-material comments in ensureShared).
    (isOpaque ? sh.blitQuad : sh.blitAddQuad).render(renderer);
    sceneCompositeCount++;
    return true;
  };

  // ── React to governor quality changes ──────────────────────────────────
  const onGlobalQuality = (q: number) => {
    ctxState.quality = q;
    const wantPremium = tier === 'hero' ? q >= 0.5 : tier === 'feature' ? q >= 0.75 : false;
    if (wantPremium !== premiumOn && tier !== 'tile') {
      premiumOn = wantPremium;
      rebuildPasses();
    }
    applyPixelRatio();
    for (const cb of qualityCbs) { try { cb(q); } catch { /* noop */ } }
  };
  qSubs.add(onGlobalQuality);

  // ── Scheduler task ─────────────────────────────────────────────────────
  const areaWeight = () => {
    const a = (ctx.width * ctx.height) / (1280 * 720);
    return Math.min(1, a);
  };
  const task: SchedTask = {
    _stride: 1,
    _phase: 0,
    _everRendered: false,
    layer,
    active: () => visible && !document.hidden,
    onScreen: () => visible,
    priority: () => ratio * (0.4 + 0.6 * areaWeight()) + (tier === 'hero' ? 1 : 0) + priorityBoost,
    step: (_t, dt, doRender) => {
      const firstAppearance = !wasOnScreen;
      if (firstAppearance) {
        wasOnScreen = true;
        ctx.clock.getDelta(); // discard the off-screen wall-time gap (capped resume)
      }
      // Track the host's live rect (scene may have scrolled / page reflowed).
      syncRect();
      const st = ctx.clock.getElapsedTime();
      ctxState.ticks++;
      ctx.pointer.lerp(targetPointer, 0.06);
      // Scene advances its sim + may run GPGPU compute here (compute saves/
      // restores its own render target). The shared canvas is composited by the
      // scheduler AFTER this pass — we never interleave compute inside a blit.
      for (const cb of frameCbs) cb(st, dt);
      // RENDER-ON-FIRST-APPEARANCE: a scene just entering view (or that has never
      // rendered) MUST render once this frame so its RT is initialized before the
      // composite pass tries to blit it — otherwise its region would be blank for
      // a frame (a flash). After that, the stride/governor decides.
      if (doRender || !everRendered) renderScene(st);
    },
    // CHEAP per-frame composite: blit the (possibly throttled, last-rendered) RT.
    composite: () => blitToScreen(),
  };

  // The task object actually registered with the scheduler. For animated scenes
  // it's `task`; for reduced-motion it's a no-sim variant (see start()). Kept so
  // renderScene + destroy reference the live registered object, not a stale copy.
  let registeredTask: SchedTask = task;

  // Render the scene's composer into its OWN render target. Does NOT blit to the
  // shared canvas — the scheduler's composite pass blits every on-screen scene
  // (this one included) separately, so throttled scenes that skip this still get
  // composited from their last RT. This is the EXPENSIVE, throttled half.
  const renderScene = (t: number) => {
    if (!composer) return;
    if (finishPass && premiumOn) finishPass.uniforms.uTime.value = t;
    // composer.render() drives its own render targets; it restores the render
    // target it found on entry (null) at the end. Scissor is irrelevant here
    // (each pass sets its RT, which carries full/disabled scissor).
    renderer.setScissorTest(false);
    renderer.setRenderTarget(target);
    renderer.setViewport(0, 0, target.width, target.height);
    composer.render();
    everRendered = true;
    ownRenders++;
    // Flag the ACTUAL registered task (the live or static variant) so the
    // scheduler's flicker accounting sees this scene as initialized.
    registeredTask._everRendered = true;
    sceneRenderCount++;
  };

  // DEV-only per-scene tick probe.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const w = window as unknown as { __sceneTicks?: Record<string, () => unknown> };
    if (!w.__sceneTicks) w.__sceneTicks = {};
    const key = host.id || host.dataset.scene || `scene-${tasks.size}-${Math.random().toString(36).slice(2, 6)}`;
    // `stride` + `priority` are the observability that was MISSING when the
    // scroll-linked morph field silently lost its full-rate slot to the ambient
    // fBm on a mount-order tie-break and ran at 30fps. Nothing in the codebase
    // could see which scenes won full rate, so the regression was invisible.
    w.__sceneTicks[key] = () => ({
      ticks: ctxState.ticks,
      onScreen: visible,
      ratio,
      stride: registeredTask._stride,
      priority: registeredTask.priority(),
      renders: ownRenders,
    });
  }

  // First frame always renders (so reduced-motion / first paint shows the world).
  const start = () => {
    syncRect();
    if (reduced && opts.staticFallback !== false) {
      // REDUCED MOTION: render the static frame ONCE into the RT, then register a
      // no-sim, no-rerender task. The scheduler's composite pass re-blits that
      // single RT every frame (cheap), so the static image stays on the shared
      // canvas after each full-canvas clear without ever re-rendering the composer.
      registeredTask = {
        ...task,
        step: (_t, _dt, _r) => {
          // Only keep the rect in sync (it may scroll); never re-render the sim.
          // If the RT somehow isn't initialized yet, render once to seed it.
          syncRect();
          if (!everRendered) renderScene(0);
        },
        // composite is inherited from `task` (blitToScreen) — blits the static RT.
      };
      addTask(registeredTask);
      requestAnimationFrame(() => {
        syncRect();
        for (const cb of frameCbs) cb(0, 0);
        renderScene(0); // seed the RT so the composite pass has something to blit
      });
      return;
    }
    requestAnimationFrame(() => {
      syncRect();
      for (const cb of frameCbs) cb(0, 0);
      renderScene(0); // initialize the RT before the first composite pass blits it
      addTask(task);
    });
  };

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    removeTask(registeredTask); // the actual registered task (live or static variant)
    qSubs.delete(onGlobalQuality);
    vis.disconnect();
    window.removeEventListener('pointermove', onPointer);
    for (const cb of disposeCbs) { try { cb(); } catch { /* noop */ } }
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    composer?.dispose?.();
    target.dispose();
    // NOTE: we do NOT dispose the shared renderer here — other scenes may use it.
    // It is torn down by disposeShared() when the last scene leaves / on swap.
  };

  // defer start one tick so the host has laid out
  requestAnimationFrame(start);

  return { ctx, onFrame, onDispose, onQuality, destroy };
}

/* ────────────────────────────────────────────────────────────────────────────
 *  mount — bind a scene module to a host + wire SPA teardown.
 * ────────────────────────────────────────────────────────────────────────── */

// Track how many scenes are mounted on the current page so we can tear the
// shared renderer down (and recreate it next page) when the last one leaves.
let mountedCount = 0;
let swapWired = false;

function wireSharedSwapTeardown() {
  if (swapWired) return;
  swapWired = true;
  // On SPA navigation, destroy the shared renderer + canvas so the next page
  // starts clean (no leaked context, no double canvas). Scenes re-register and
  // ensureShared() recreates it on astro:page-load.
  document.addEventListener('astro:before-swap', () => {
    disposeShared();
    mountedCount = 0;
  });
}

export function mount(
  selector: string | HTMLElement,
  build: (handle: SceneHandle) => void,
  opts: Omit<CreateSceneOpts, 'host'>,
): SceneHandle | null {
  const host = typeof selector === 'string'
    ? document.querySelector<HTMLElement>(selector)
    : selector;
  if (!host) return null;
  if (host.dataset.mounted === '1') return null;
  host.dataset.mounted = '1';

  wireSharedSwapTeardown();
  const handle = createScene({ host, ...opts });
  build(handle);
  mountedCount++;

  const cleanup = () => {
    handle.destroy();
    host.dataset.mounted = '';
    mountedCount = Math.max(0, mountedCount - 1);
    if (mountedCount === 0) disposeShared();
  };
  document.addEventListener('astro:before-swap', cleanup, { once: true });
  window.addEventListener('beforeunload', cleanup, { once: true });
  return handle;
}

/** small helper: smoothstep */
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** lerp colors in linear space */
export function mixColor(a: number, b: number, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}
