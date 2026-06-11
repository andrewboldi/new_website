/**
 * Shared three.js scene scaffolding.
 *
 * Every scene on the site is a small module that receives a host <div>, builds
 * its world, and returns nothing — lifecycle (RAF, resize, visibility pause,
 * reduced-motion, dispose) is handled here so individual scenes stay focused.
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
}

export interface SceneHandle {
  ctx: SceneContext;
  /** called on every animated frame; receives (elapsed, delta) */
  onFrame: (cb: (t: number, dt: number) => void) => void;
  /** register extra cleanup */
  onDispose: (cb: () => void) => void;
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
}

/**
 * Bootstraps a renderer + scene + camera sized to `host`, wires the animation
 * loop, pauses when scrolled off-screen, and respects reduced-motion.
 */
export function createScene(opts: CreateSceneOpts): SceneHandle {
  const { host } = opts;
  const reduced = prefersReducedMotion();

  const width = host.clientWidth || 1;
  const height = host.clientHeight || 1;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: opts.alpha ?? true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, opts.maxPixelRatio ?? 2));
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  if (!(opts.alpha ?? true)) renderer.setClearColor(opts.clearColor ?? PALETTE.bg, 1);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 55, width / height, 0.1, 4000);
  camera.position.z = opts.cameraZ ?? 6;

  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  let finishPass: ShaderPass | null = null;
  if (opts.bloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Bloom (linear). Default threshold raised 0.1 -> 0.5 so only genuinely
    // bright/emissive accents glow instead of washing the whole frame to mush.
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      opts.bloom.strength ?? 0.8,
      opts.bloom.radius ?? 0.5,
      opts.bloom.threshold ?? 0.5,
    );
    composer.addPass(bloomPass);
    // Combined filmic finish: vignette + faint grain + ordered dither (linear).
    finishPass = new ShaderPass(FilmicFinishShader);
    finishPass.uniforms.uResolution.value.set(width, height);
    composer.addPass(finishPass);
    // Anti-aliasing: the composer bypasses native MSAA, so thin science
    // geometry shimmers without this. SMAA runs in linear-srgb, before output.
    composer.addPass(new SMAAPass());
    // OutputPass stays LAST: the only tonemap (ACES) + linear->sRGB step.
    composer.addPass(new OutputPass());
  }

  const ctx: SceneContext = {
    scene, camera, renderer, composer, host,
    clock: new THREE.Clock(),
    pointer: new THREE.Vector2(0, 0),
    width, height,
  };

  const frameCbs: Array<(t: number, dt: number) => void> = [];
  const disposeCbs: Array<() => void> = [];
  const onFrame = (cb: (t: number, dt: number) => void) => frameCbs.push(cb);
  const onDispose = (cb: () => void) => disposeCbs.push(cb);

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
      finishPass?.uniforms.uResolution.value.set(w, h);
    });
  });
  ro.observe(host);

  // ---- visibility (pause when off-screen) ----
  let visible = true;
  const vis = new IntersectionObserver(
    ([e]) => { visible = e.isIntersecting; },
    { threshold: 0 },
  );
  vis.observe(host);

  const render = (t = 0) => {
    if (finishPass) finishPass.uniforms.uTime.value = t;
    return composer ? composer.render() : renderer.render(scene, camera);
  };

  let raf = 0;
  let last = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!visible || document.hidden) return;
    const t = ctx.clock.getElapsedTime();
    const dt = Math.min(t - last, 0.05);
    last = t;
    ctx.pointer.lerp(targetPointer, 0.06);
    for (const cb of frameCbs) cb(t, dt);
    render(t);
  };

  // First frame always renders (so reduced-motion users see the static world).
  const start = () => {
    if (reduced && opts.staticFallback !== false) {
      // run one synchronous frame, then stop
      requestAnimationFrame(() => {
        for (const cb of frameCbs) cb(0, 0);
        render();
      });
      return;
    }
    tick();
  };

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
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

  return { ctx, onFrame, onDispose, destroy };
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
