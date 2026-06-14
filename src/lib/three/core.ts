/**
 * Shared three.js scene scaffolding.
 *
 * Every scene on the site is a small module that receives a host <div>, builds
 * its world, and returns nothing — lifecycle (RAF, resize, visibility pause,
 * reduced-motion, dispose) is handled here so individual scenes stay focused.
 *
 * PERFORMANCE ARCHITECTURE (added for the multi-scene pages, e.g. About ~10
 * canvases at once):
 *  - A single MODULE-LEVEL scheduler drives every active scene from ONE rAF.
 *    Each scene gets a priority from its on-screen prominence (Intersection
 *    Observer ratio × canvas area). Only the most-prominent 1–2 scenes render
 *    at full 60fps; the rest are throttled (render every 2nd/3rd/… frame) or
 *    frozen to their last frame when far off-screen. Every scene keeps its LOOK
 *    — background scenes just update less often.
 *  - Per-scene QUALITY TIERS pick the post chain: hero/feature scenes get the
 *    full composer (bloom + filmic finish + SMAA + output); the many small TILE
 *    scenes get a cheap chain (single bloom pass → output, no SMAA/no finish),
 *    or a direct render — emissive compensation in registry keeps tiles glowing
 *    rather than dim.
 *  - An adaptive GOVERNOR samples a global rolling frame time and, when GPU
 *    bound, steps quality down (drops the finish+SMAA passes on feature scenes,
 *    lowers pixel ratio, and broadcasts a `quality` signal scenes can read to
 *    cut particle counts); it recovers when frames are fast again.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

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
  /** clear color when not alpha */
  clearColor?: number;
  /** render a single static frame even under reduced motion (default true) */
  staticFallback?: boolean;
  /** cap the device pixel ratio (cheaper for large/background canvases) */
  maxPixelRatio?: number;
  /**
   * Internal RENDER SCALE in (0..1] — render the drawing buffer at this fraction
   * of CSS resolution and let CSS upscale the canvas to 100% (three.js sets the
   * canvas style to the CSS size, the buffer to size×pixelRatio, so a sub-1.0
   * effective pixel ratio = fewer pixels, stretched). On a hi-DPI display fill
   * scales with pixel COUNT, so this is the single biggest lever for FULLSCREEN
   * scenes (the hero cloud + the page-wide fBm/molecular backgrounds): a soft,
   * glowy, blurred field upscales nearly invisibly but costs 2–4× less to fill.
   *
   * Default 1.0 (small tile/feature scenes render crisp at native). Fullscreen
   * scenes should pass ~0.5–0.66. The governor multiplies this DOWN further under
   * load (see applyPixelRatio's loadScale) — fullscreen scenes can reach ~0.4×.
   * The effective pixel ratio is floored at 0.4 so it never gets mushy.
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
}

/* ────────────────────────────────────────────────────────────────────────────
 *  MODULE-LEVEL SCHEDULER + GOVERNOR
 *  One rAF drives all scenes. Per-scene priority decides render cadence so N
 *  visible canvases no longer cost N× full renders every frame.
 * ────────────────────────────────────────────────────────────────────────── */

interface SchedTask {
  /** advance simulation + (maybe) render. Returns true if it actually rendered. */
  step: (t: number, dt: number, render: boolean) => void;
  /** prominence in [0..1]: intersectionRatio × normalized canvas area. */
  priority: () => number;
  /** true while on-screen and not reduced-motion-frozen. */
  active: () => boolean;
  /**
   * HARD FREEZE: true while the scene is intersecting the viewport (even a sliver).
   * When false the scheduler skips the task ENTIRELY — no frame callbacks, no
   * simulation, no render — so an off-screen scene costs ~0 (this is what takes a
   * 10-canvas page down to the 1–2 scenes actually on screen). The task's own
   * `step` advances its clock by a capped dt on the first frame back so the
   * animation resumes where it left off instead of jumping forward by the whole
   * time it spent off-screen.
   */
  onScreen: () => boolean;
  /** stride bucket for throttled scenes (filled by the scheduler each frame). */
  _stride: number;
  _phase: number;
}

const tasks = new Set<SchedTask>();
let schedRAF = 0;
let frameIndex = 0;

// Lightweight instrumentation: total number of ACTUAL scene renders performed
// (composer.render / renderer.render). One integer add per render — negligible.
// Exposed on window so perf tooling can sample renders/sec; this is the quantity
// the scheduler exists to cut (N visible scenes no longer = N renders/frame).
let sceneRenderCount = 0;
let schedTicks = 0; // number of scheduler-loop iterations (detects rAF starvation)
// Dev-only perf hooks (tree-shaken from production via import.meta.env.DEV): let
// tooling sample renders/sec, scheduler tick rate, the stride histogram, and the
// governor's current quality. The two counters above are plain integer adds in
// the hot path (negligible) and stay in all builds; only the window surface is
// gated so production ships nothing extra.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __sceneRenderCount: () => number }).__sceneRenderCount = () => sceneRenderCount;
  (window as unknown as { __sceneStats: () => unknown }).__sceneStats = () => {
    // Stride histogram across active scenes: how many render every frame (full
    // rate) vs throttled. Proves the scheduler caps full-rate work regardless of
    // how many scenes are visible.
    const strides: Record<number, number> = {};
    let active = 0; // on-screen AND ticking (the only scenes doing per-frame work)
    let offscreen = 0; // registered but frozen (skipped wholesale by the scheduler)
    for (const tk of tasks) {
      if (!tk.active() || !tk.onScreen()) { offscreen++; continue; }
      active++;
      strides[tk._stride] = (strides[tk._stride] ?? 0) + 1;
    }
    return {
      renders: sceneRenderCount,
      schedTicks,
      activeScenes: active, // scenes actually running onFrame + maybe rendering
      offscreenScenes: offscreen, // frozen scenes (proof: these cost ~0)
      totalScenes: tasks.size,
      quality: qLevel,
      avgFrameMs: avgFrame,
      strideHistogram: strides, // e.g. {1:2, 2:2, 3:8} = 2 full, 2 half, 8 third-rate
    };
  };
}

// ---- governor state (global, shared by all scenes) ----
let qLevel = 1; // current broadcast quality in [0..1]
const qSubs = new Set<(q: number) => void>();
let avgFrame = 16.7; // rolling average frame time (ms)
let slowAccum = 0; // ms spent "slow" (debounce stepping down)
let fastAccum = 0; // ms spent "fast" (debounce stepping up)
// Thresholds: step DOWN when sustained avg > 22ms (~45fps); step UP when
// sustained avg < 15ms (~66fps). Hysteresis via the accum debounce windows.
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
  // EMA of frame time; ignore absurd spikes (tab refocus, GC) so one hitch
  // doesn't yank quality.
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

function assignStrides() {
  // Rank active tasks by priority; the top FULL_RATE_BUDGET render every frame,
  // the next tier every 2nd frame, the rest every 3rd (or 4th when GPU-bound).
  // Only ON-SCREEN tasks compete for the budget — off-screen scenes are frozen
  // (skipped in the loop) so they neither render nor consume a full-rate slot.
  const live: SchedTask[] = [];
  for (const tk of tasks) if (tk.active() && tk.onScreen()) live.push(tk);
  live.sort((a, b) => b.priority() - a.priority());
  const farStride = qLevel <= 0.5 ? 5 : qLevel < 1 ? 4 : 3;
  for (let i = 0; i < live.length; i++) {
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

  governorTick(frameMs);
  assignStrides();

  const t = now / 1000;
  const dt = Math.min(frameMs / 1000, 0.05);
  for (const tk of tasks) {
    // HARD FREEZE: an off-screen (non-intersecting) scene is skipped wholesale —
    // no simulation, no render, fully idle. `active()` also covers document.hidden.
    if (!tk.active() || !tk.onScreen()) continue;
    const render = (frameIndex % tk._stride) === tk._phase % tk._stride;
    tk.step(t, dt, render);
  }
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
  if (tasks.size === 0 && schedRAF) {
    cancelAnimationFrame(schedRAF);
    schedRAF = 0;
  }
}

/**
 * Bootstraps a renderer + scene + camera sized to `host`, registers itself with
 * the shared scheduler, pauses when scrolled off-screen, and respects
 * reduced-motion.
 */
export function createScene(opts: CreateSceneOpts): SceneHandle {
  const { host } = opts;
  const reduced = prefersReducedMotion();
  const tier: SceneTier = opts.tier ?? 'feature';

  const width = host.clientWidth || 1;
  const height = host.clientHeight || 1;

  // Per-tier pixel-ratio cap (tiles ≤1, feature ≤1.5, hero ≤2). An explicit
  // opts.maxPixelRatio still wins so callers can override.
  const tierCap = tier === 'tile' ? 1 : tier === 'hero' ? 2 : 1.5;
  const baseCap = opts.maxPixelRatio ?? tierCap;
  // Internal render scale (fraction of CSS resolution the buffer is rendered at;
  // CSS upscales). Default 1.0 = native; fullscreen scenes pass ~0.5–0.66 to cut
  // fill on hi-DPI displays. Clamped to (0..1] so it can only ever REDUCE pixels.
  const renderScale = Math.min(1, Math.max(0.1, opts.renderScale ?? 1));

  const renderer = new THREE.WebGLRenderer({
    // Native MSAA only matters when rendering straight to screen (tiles with no
    // composer). The full composer adds SMAA instead, so AA there is redundant.
    antialias: tier === 'tile' || !opts.bloom,
    alpha: opts.alpha ?? true,
    powerPreference: 'high-performance',
  });
  let curPixelRatio = Math.min(devicePixelRatio, baseCap) * renderScale;
  renderer.setPixelRatio(curPixelRatio);
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  if (!(opts.alpha ?? true)) renderer.setClearColor(opts.clearColor ?? PALETTE.bg, 1);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 55, width / height, 0.1, 4000);
  camera.position.z = opts.cameraZ ?? 6;

  // ── Post-processing chain, built per tier ───────────────────────────────
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  let finishPass: ShaderPass | null = null;
  let smaaPass: SMAAPass | null = null;
  let renderPass: RenderPass | null = null;
  let outputPass: OutputPass | null = null;
  // Whether the "premium" finish+SMAA passes are currently enabled (governor may
  // strip them on feature scenes under load). Tiles never have them.
  let premiumOn = tier !== 'tile';

  if (opts.bloom) {
    composer = new EffectComposer(renderer);
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    // Bloom (linear). Default threshold 0.5 so only genuinely bright/emissive
    // accents glow instead of washing the whole frame to mush.
    // FILL: UnrealBloom is a multi-pass full-screen blur — the single biggest
    // post cost on a weak iGPU. Its internal mip pyramid is sized HALF-res here
    // (the bloom is a soft wide glow, so half-res is visually indistinguishable
    // but quarters the bloom blur fill). The resolution vec only sets the mip
    // chain size; the composer still composites it back at full res.
    const bloomRes = new THREE.Vector2(
      Math.max(1, Math.round(width * 0.5)),
      Math.max(1, Math.round(height * 0.5)),
    );
    bloomPass = new UnrealBloomPass(
      bloomRes,
      opts.bloom.strength ?? 0.8,
      opts.bloom.radius ?? 0.5,
      opts.bloom.threshold ?? 0.5,
    );
    composer.addPass(bloomPass);

    if (tier === 'tile') {
      // CHEAP path: bloom → output only. No filmic finish, no SMAA fullscreen
      // pass. Tiles rely on emissive/threshold tuning (registry) to still glow.
      outputPass = new OutputPass();
      composer.addPass(outputPass);
    } else {
      // FULL path (hero/feature): vignette+grain+dither, then SMAA, then output.
      finishPass = new ShaderPass(FilmicFinishShader);
      finishPass.uniforms.uResolution.value.set(width, height);
      composer.addPass(finishPass);
      smaaPass = new SMAAPass();
      composer.addPass(smaaPass);
      outputPass = new OutputPass();
      composer.addPass(outputPass);
    }
  }

  // Rebuild the pass list when the governor toggles premium quality on a feature
  // scene. Cheaper than per-frame `pass.enabled` because EffectComposer still
  // copies through disabled passes; we drop them from the chain entirely.
  const rebuildPasses = () => {
    if (!composer || tier === 'tile' || !renderPass || !bloomPass || !outputPass) return;
    composer.passes.length = 0;
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    if (premiumOn && finishPass && smaaPass) {
      composer.addPass(finishPass);
      composer.addPass(smaaPass);
    }
    composer.addPass(outputPass);
  };

  // `ticks` counts how many frame callbacks this scene has actually run. It only
  // increments when the scene is ON-SCREEN and ticked, so a frozen off-screen
  // scene's counter stays flat — that's the proof the hard-freeze works (perf
  // tooling samples per-scene ticks via window.__sceneTicks in DEV).
  const ctxState = { quality: qLevel, ticks: 0 };
  const ctx: SceneContext = {
    scene, camera, renderer, composer, host,
    clock: new THREE.Clock(),
    pointer: new THREE.Vector2(0, 0),
    width, height,
    get quality() { return ctxState.quality; },
  };

  const frameCbs: Array<(t: number, dt: number) => void> = [];
  const disposeCbs: Array<() => void> = [];
  const qualityCbs: Array<(q: number) => void> = [];
  const onFrame = (cb: (t: number, dt: number) => void) => frameCbs.push(cb);
  const onDispose = (cb: () => void) => disposeCbs.push(cb);
  const onQuality = (cb: (q: number) => void) => { qualityCbs.push(cb); cb(ctxState.quality); };

  // ---- pointer (eased toward target) ----
  const targetPointer = new THREE.Vector2(0, 0);
  const onPointer = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    targetPointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -(((e.clientY - r.top) / r.height) * 2 - 1),
    );
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  // ---- resize ----
  let resizeRAF = 0;
  const applyPixelRatio = () => {
    // Under load the governor pulls pixel ratio DOWN aggressively — resolution
    // is the #1 fill lever on a weak iGPU. Tiles too (their full-screen siblings
    // dominate fill; a tile at 0.8 DPR is still crisp at its small size).
    const loadScale = qLevel >= 1 ? 1 : qLevel >= 0.75 ? 0.8 : qLevel >= 0.5 ? 0.65 : 0.5;
    // renderScale (the scene's BASE fraction of CSS res) multiplies the governor's
    // load scale, so a fullscreen scene defaulting to 0.6× drops to ~0.4× under
    // deep load — the big fill win on a hi-DPI iGPU.
    const want = Math.min(devicePixelRatio, baseCap) * renderScale * loadScale;
    // Allow sub-1.0 effective pixel ratio (CSS upscales) — this is where the big
    // fill wins come from. Floor at 0.4 so it never gets mushy (a soft glowy
    // fullscreen field upscales fine; the floor protects crisp tiles which keep
    // renderScale 1.0 and so only reach this floor under the deepest load).
    const clamped = Math.max(0.4, want);
    if (Math.abs(clamped - curPixelRatio) > 0.01) {
      curPixelRatio = clamped;
      renderer.setPixelRatio(clamped);
      renderer.setSize(ctx.width, ctx.height);
      composer?.setSize(ctx.width, ctx.height);
      // composer.setSize resized bloom to full res — pull it back to half-res.
      bloomPass?.setSize(Math.max(1, Math.round(ctx.width * 0.5)), Math.max(1, Math.round(ctx.height * 0.5)));
      finishPass?.uniforms.uResolution.value.set(ctx.width, ctx.height);
    }
  };
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(() => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      ctx.width = w; ctx.height = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer?.setSize(w, h);
      bloomPass?.setSize(Math.max(1, Math.round(w * 0.5)), Math.max(1, Math.round(h * 0.5)));
      finishPass?.uniforms.uResolution.value.set(w, h);
    });
  });
  ro.observe(host);

  // ---- visibility + prominence (drives scheduler priority) ----
  // `visible` is the HARD-FREEZE gate: true the moment any sliver of the host
  // intersects the viewport, false once it's fully off-screen. An off-screen
  // scene is skipped entirely by the scheduler (no sim, no render) — see the
  // scheduler loop's onScreen() check. `wasOnScreen` lets `step` advance the
  // scene clock by only a capped dt on the first frame back (clean resume, no
  // jump forward by the whole time spent off-screen).
  let visible = true;
  let ratio = 1; // intersectionRatio in [0..1]
  let wasOnScreen = false;
  const vis = new IntersectionObserver(
    ([e]) => {
      visible = e.isIntersecting;
      ratio = e.intersectionRatio;
      // Going off-screen arms the clean-resume re-sync for the next time the
      // scene scrolls back into view (see step()).
      if (!visible) wasOnScreen = false;
    },
    // Multiple thresholds so prominence is continuous, not just on/off.
    { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
  );
  vis.observe(host);

  const render = (t = 0) => {
    if (finishPass && premiumOn) finishPass.uniforms.uTime.value = t;
    sceneRenderCount++;
    return composer ? composer.render() : renderer.render(scene, camera);
  };

  // ── React to governor quality changes ──────────────────────────────────
  const onGlobalQuality = (q: number) => {
    ctxState.quality = q;
    // Drop the premium finish+SMAA full-screen passes when GPU-bound. Feature
    // scenes shed them first (q<0.75); the hero is full-viewport and the single
    // costliest scene, so it sheds them under deeper load (q<0.5) — SMAA + the
    // filmic pass are two extra full-screen draws we can't afford on a weak iGPU.
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
  // Cache a rough normalized area weight (updated on resize via ctx.width/height).
  const areaWeight = () => {
    const a = (ctx.width * ctx.height) / (1280 * 720); // relative to a ~720p tile
    return Math.min(1, a);
  };
  const task: SchedTask = {
    _stride: 1,
    _phase: 0,
    active: () => visible && !document.hidden,
    // HARD-FREEZE gate: only on-screen scenes tick. `active()` already excludes
    // document.hidden; this adds the off-screen (non-intersecting) cutoff so a
    // scrolled-away scene goes fully idle.
    onScreen: () => visible,
    // Prominence: how centered/large on screen. Area gives big hero canvases a
    // boost; ratio fades scenes near the viewport edges.
    priority: () => ratio * (0.4 + 0.6 * areaWeight()) + (tier === 'hero' ? 1 : 0),
    // Each scene keeps its OWN clock time (seconds since it started) so per-scene
    // animation phase/intro logic is byte-identical to the old per-scene rAF; the
    // shared scheduler only supplies the frame delta and the render gate.
    step: (_t, dt, doRender) => {
      // CLEAN RESUME after a freeze: while off-screen the scene was skipped, so
      // ctx.clock kept advancing in wall-time but was never READ. Absorb that gap
      // into a discarded delta (resets the clock's internal oldTime to now) so the
      // very next getElapsedTime() advances by ~one frame, not by the whole span
      // the scene spent off-screen — the animation resumes where it left off.
      if (!wasOnScreen) {
        wasOnScreen = true;
        ctx.clock.getDelta(); // discard the off-screen wall-time gap (capped resume)
      }
      const st = ctx.clock.getElapsedTime();
      ctxState.ticks++;
      ctx.pointer.lerp(targetPointer, 0.06);
      for (const cb of frameCbs) cb(st, dt);
      if (doRender) render(st);
    },
  };

  // DEV-only per-scene tick probe (tree-shaken from production): lets Playwright
  // read a single scene's live tick count + on-screen state by host id and PROVE
  // that an off-screen scene's counter is frozen while a visible one climbs.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const w = window as unknown as { __sceneTicks?: Record<string, () => unknown> };
    if (!w.__sceneTicks) w.__sceneTicks = {};
    const key = host.id || host.dataset.scene || `scene-${tasks.size}-${Math.random().toString(36).slice(2, 6)}`;
    w.__sceneTicks[key] = () => ({ ticks: ctxState.ticks, onScreen: visible, ratio });
  }

  // First frame always renders (so reduced-motion / first paint shows the world).
  const start = () => {
    if (reduced && opts.staticFallback !== false) {
      // run one synchronous frame, then stop — no scheduler registration.
      requestAnimationFrame(() => {
        for (const cb of frameCbs) cb(0, 0);
        render();
      });
      return;
    }
    // Render one immediate frame so the canvas isn't blank before its first
    // scheduled (possibly throttled) turn, then join the shared loop.
    requestAnimationFrame(() => {
      for (const cb of frameCbs) cb(0, 0);
      render(0);
      addTask(task);
    });
  };

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    removeTask(task);
    qSubs.delete(onGlobalQuality);
    cancelAnimationFrame(resizeRAF);
    ro.disconnect();
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
    renderer.dispose();
    renderer.domElement.remove();
  };

  // defer start one tick so the host has laid out
  requestAnimationFrame(start);

  return { ctx, onFrame, onDispose, onQuality, destroy };
}

/**
 * Mounts a scene module against the first matching host, and wires teardown on
 * Astro page swaps / unload. Returns the handle (or null if host missing).
 */
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

  const handle = createScene({ host, ...opts });
  build(handle);

  const cleanup = () => handle.destroy();
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
