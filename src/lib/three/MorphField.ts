/**
 * MorphField — a persistent background particle system that morphs between
 * shapes as you scroll, each shape a different one of Andrew's fields. Scroll
 * progress drives a continuous blend so the particles *flow* from latent space
 * into a DNA helix into a benzene ring into an atomic orbital, and so on.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, prefersReducedMotion } from './core';
import { molecule, helix, benzene, orbital, wave, neural, type ShapeGen } from './shapes';

export interface Stage { gen: ShapeGen; label: string; accent: number; }

export const DEFAULT_STAGES: Stage[] = [
  { gen: molecule, label: 'generative diffusion → caffeine', accent: PALETTE.cyan },
  { gen: helix, label: 'molecular biology', accent: PALETTE.cyan },
  { gen: benzene, label: 'organic chemistry', accent: PALETTE.amber },
  { gen: orbital, label: 'quantum mechanics', accent: PALETTE.violet },
  { gen: wave, label: 'statistical mechanics', accent: PALETTE.blue },
  { gen: neural, label: 'deep learning', accent: PALETTE.cyan },
];

const VS = /* glsl */ `
  attribute float aScale; attribute vec3 aColor; varying vec3 vColor;
  uniform float uTime;
  void main() {
    vColor = aColor;
    vec3 p = position;
    p.x += sin(uTime * 0.5 + position.y * 0.3) * 0.09;
    p.y += cos(uTime * 0.45 + position.x * 0.3) * 0.09;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aScale * (215.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const FS = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    // sharper dot: small bright core, tight falloff (legible, less haze)
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.18), smoothstep(0.5, 0.22, d) * 0.9);
  }`;

interface Opts {
  stages?: Stage[];
  count?: number;
  onStage?: (index: number, label: string, accent: number) => void;
}

export function morphField(handle: SceneHandle, opts: Opts = {}) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  const stages = opts.stages ?? DEFAULT_STAGES;
  const mobile = ctx.width < 760;
  // Particle budget trimmed (was 3200 desktop / 1800 mobile). The field is a
  // soft background behind page content — every shape still reads clearly at this
  // density, and the per-frame O(N) diffusion-displacement loop + bond-web rebuild
  // get ~45% cheaper, smoothing scroll on content pages (perf budget: POLA-fast).
  const N = opts.count ?? (mobile ? 1100 : 1800);
  const R = 22;

  camera.position.set(0, 0, 50);

  const group = new THREE.Group();
  scene.add(group);

  // precompute every stage's target positions + colors
  const targets = stages.map((s) => {
    const p = new Float32Array(N * 3);
    const c = new Float32Array(N * 3);
    s.gen(p, c, N, R);
    return { p, c };
  });

  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  positions.set(targets[0].p);
  colors.set(targets[0].c);
  const scales = new Float32Array(N);
  for (let i = 0; i < N; i++) scales[i] = 0.7 + Math.random() * 1.5;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: VS, fragmentShader: FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  group.add(points);

  // ---- morphing bond web: link each particle to ~2 nearest neighbours ----
  // Bonds follow the live particle positions, so the web reshapes as the cloud
  // morphs into a helix, a ring, an orbital… and long bonds fade out.
  const base0 = targets[0].p;
  const CS = R / 3.5;
  const grid = new Map<string, number[]>();
  const gkey = (x: number, y: number, z: number) => `${Math.round(x / CS)}|${Math.round(y / CS)}|${Math.round(z / CS)}`;
  for (let i = 0; i < N; i++) {
    const k = gkey(base0[i * 3], base0[i * 3 + 1], base0[i * 3 + 2]);
    let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(i);
  }
  const edges: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < N; i++) {
    const x = base0[i * 3], y = base0[i * 3 + 1], z = base0[i * 3 + 2];
    let b0 = -1, b1 = -1, d0 = 1e9, d1 = 1e9;
    const cx = Math.round(x / CS), cy = Math.round(y / CS), cz = Math.round(z / CS);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const c = grid.get(`${cx + dx}|${cy + dy}|${cz + dz}`); if (!c) continue;
      for (const j of c) {
        if (j === i) continue;
        const ux = x - base0[j * 3], uy = y - base0[j * 3 + 1], uz = z - base0[j * 3 + 2];
        const d = ux * ux + uy * uy + uz * uz;
        if (d < d0) { d1 = d0; b1 = b0; d0 = d; b0 = j; } else if (d < d1) { d1 = d; b1 = j; }
      }
    }
    for (const j of [b0, b1]) {
      if (j < 0) continue;
      const k = i < j ? i * N + j : j * N + i;
      if (seen.has(k)) continue; seen.add(k); edges.push(i, j);
    }
  }
  const eCount = edges.length / 2;
  const edgePos = new Float32Array(eCount * 6);
  const edgeCol = new Float32Array(eCount * 6);
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3).setUsage(THREE.DynamicDrawUsage));
  edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeCol, 3).setUsage(THREE.DynamicDrawUsage));
  const edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const web = new THREE.LineSegments(edgeGeo, edgeMat);
  group.add(web);
  const linkMax = R * 0.85, linkMax2 = linkMax * linkMax;
  const updateWeb = () => {
    for (let e = 0; e < eCount; e++) {
      const a = edges[e * 2], b = edges[e * 2 + 1];
      const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
      const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
      edgePos[e * 6] = ax; edgePos[e * 6 + 1] = ay; edgePos[e * 6 + 2] = az;
      edgePos[e * 6 + 3] = bx; edgePos[e * 6 + 4] = by; edgePos[e * 6 + 5] = bz;
      const ux = ax - bx, uy = ay - by, uz = az - bz, d2 = ux * ux + uy * uy + uz * uz;
      const f = d2 > linkMax2 ? 0 : (1 - Math.sqrt(d2) / linkMax) * 0.7;
      edgeCol[e * 6] = colors[a * 3] * f; edgeCol[e * 6 + 1] = colors[a * 3 + 1] * f; edgeCol[e * 6 + 2] = colors[a * 3 + 2] * f;
      edgeCol[e * 6 + 3] = colors[b * 3] * f; edgeCol[e * 6 + 4] = colors[b * 3 + 1] * f; edgeCol[e * 6 + 5] = colors[b * 3 + 2] * f;
    }
    edgeGeo.attributes.position.needsUpdate = true;
    edgeGeo.attributes.color.needsUpdate = true;
  };

  // faint structural shell for depth
  const shell = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R * 1.35, 1)),
    new THREE.LineBasicMaterial({ color: PALETTE.blue, transparent: true, opacity: 0.05 }),
  );
  group.add(shell);

  let progress = 0;       // eased scroll progress 0..1
  let lastStage = -1;
  let lastI = -1, lastF = -1; // skip the morph loop when nothing changed
  let webFrame = 0;       // throttle the bond-web rebuild (it's a blurred bg layer)
  // per-particle phase so the morph cascades organically instead of snapping in lockstep
  const stagger = new Float32Array(N);
  for (let k = 0; k < N; k++) stagger[k] = Math.random();

  // ---- continuous stepped denoising-diffusion on shape[0] ----------------
  // shape[0] (caffeine) is never a static target: it perpetually runs a reverse
  // diffusion process and back. Each particle sits at
  //     molecule + sigma(step) · dir(particle)
  // where `dir` is a FIXED per-particle gaussian displacement (preallocated) and
  // `sigma` steps down a discrete cosine noise schedule. A slow ping-pong clock
  // walks the schedule: denoise (sigma hi→0) → hold clean → re-noise (0→hi) →
  // hold noisy → repeat, so the structure visibly RESOLVES IN STAGES and loops
  // back and forth. The per-step ease+hold makes the stages a perceptible
  // staircase rather than one smooth blend. No per-frame allocation.
  const reduced = prefersReducedMotion();
  const dir = new Float32Array(N * 3);            // fixed per-particle noise dir
  const NOISE_R = R * 1.85;                        // full-noise displacement scale
  const gauss = () => {                            // bell-shaped ~[-1,1]
    let s = 0;
    for (let m = 0; m < 3; m++) s += Math.random();
    return (s / 3 - 0.5) * 2;
  };
  for (let k = 0; k < N; k++) {
    dir[k * 3] = gauss() * NOISE_R;
    dir[k * 3 + 1] = gauss() * NOISE_R;
    dir[k * 3 + 2] = gauss() * NOISE_R;
  }

  // Discrete reverse-diffusion schedule. sigma[0] = full noise, sigma[STEPS] = 0
  // (clean molecule). Cosine schedule → slow start, fast collapse near the end,
  // which reads like a real sampler snapping into structure at the last steps.
  const STEPS = 14;
  const sigmaLUT = new Float32Array(STEPS + 1);
  for (let s = 0; s <= STEPS; s++) {
    const u = s / STEPS;                            // 0 clean … 1 full noise
    sigmaLUT[s] = Math.sin((u * Math.PI) / 2);      // cosine-ish ease (concave)
  }
  // sigma at an arbitrary (fractional, EASED) step position — linear interp of LUT
  const sigmaAt = (step: number) => {
    const c = Math.min(STEPS, Math.max(0, step));
    const lo = Math.floor(c), hi = Math.min(STEPS, lo + 1), fr = c - lo;
    return sigmaLUT[lo] + (sigmaLUT[hi] - sigmaLUT[lo]) * fr;
  };

  // Ping-pong "diffusion clock". A normalized phase 0..1 maps:
  //   0.00–0.42  denoise  (step STEPS → 0)      ~ molecule forming
  //   0.42–0.52  HOLD on clean molecule
  //   0.52–0.94  re-noise (step 0 → STEPS)      ~ dissolving back
  //   0.94–1.00  HOLD on full noise
  const CYCLE = reduced ? 1 : 17.0;   // seconds for one full back-and-forth
  const DENOISE_END = 0.42, CLEAN_HOLD_END = 0.52, RENOISE_END = 0.94;
  // eased staircase: snap a continuous 0..1 within-schedule fraction to a stepped,
  // per-step-eased value with a brief hold at each step (perceptible stages).
  const STEP_HOLD = 0.34;             // fraction of each step spent holding
  const staircase = (u: number) => {
    const c = Math.min(1, Math.max(0, u)) * STEPS;  // 0..STEPS continuous
    const idx = Math.floor(c);
    if (idx >= STEPS) return STEPS;
    const fr = c - idx;                              // 0..1 within this step
    // hold, then smootherstep to the next integer step
    const e = fr <= STEP_HOLD ? 0
      : (() => { const x = (fr - STEP_HOLD) / (1 - STEP_HOLD); return x * x * x * (x * (x * 6 - 15) + 10); })();
    return idx + e;
  };
  // eased-staircase step position ∈ [0,STEPS] for a phase (STEPS = full noise).
  const schedule = (phase: number): number => {
    if (reduced) return 0;                           // static clean molecule
    if (phase < DENOISE_END) return STEPS - staircase(phase / DENOISE_END);
    if (phase < CLEAN_HOLD_END) return 0;            // clean hold
    if (phase < RENOISE_END)
      return staircase((phase - CLEAN_HOLD_END) / (RENOISE_END - CLEAN_HOLD_END));
    return STEPS;                                    // noise hold
  };
  let diffActive = !reduced;        // false only under reduced-motion
  let oscMix = reduced ? 0 : 1;     // 1 = diffusion owns shape[0], 0 = scroll owns
  const TOP_EPS = 0.012;            // "at the very top" threshold (scroll progress)

  const scrollProgress = () => {
    // window.scrollY is robust even when `body { overflow-x: hidden }` makes the
    // body (not documentElement) the scroll container.
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  };

  onFrame((t, dt) => {
    mat.uniforms.uTime.value = t;

    // ease toward the real scroll position (tight enough to track, smooth enough to glide)
    progress += (scrollProgress() - progress) * Math.min(1, dt * 5);

    const span = stages.length - 1;
    const sf = progress * span;
    const i = Math.min(span - 1, Math.floor(sf));
    const f = sf - i;

    // ---- diffusion clock + scroll handoff -----------------------------------
    // `oscMix` is how much the diffusion oscillation owns shape[0] (1 at the very
    // top, easing to 0 as you scroll into the morph) — so the perpetual noising
    // never fights a user who scrolls away. The clock keeps ticking underneath,
    // so returning to the top rejoins the oscillation already in motion.
    const oscTarget = diffActive ? Math.min(1, Math.max(0, 1 - progress / 0.06)) : 0;
    oscMix += (oscTarget - oscMix) * Math.min(1, dt * 4);   // smooth fade, no pop
    // ping-pong phase from elapsed time (sawtooth 0..1 over CYCLE seconds)
    const phase = diffActive ? (t / CYCLE) % 1 : 0;
    const sigma = sigmaAt(schedule(phase));                   // 0 clean … 1 noise
    // "resolved" only ramps in the last ~30% of denoising (low sigma) so the
    // bond web snaps in as the molecule forms and dissolves as it re-noises.
    const RES_LO = 0.0, RES_HI = 0.42;                        // sigma window
    const rRaw = 1 - Math.min(1, Math.max(0, (sigma - RES_LO) / (RES_HI - RES_LO)));
    const resolved = rRaw * rRaw * (3 - 2 * rRaw);            // smoothstep
    // live "boiling" jitter: strong at high sigma, calms to nothing as it settles
    const boil = sigma * sigma * 0.14 * R;
    // whether diffusion currently perturbs the buffers enough to rewrite them
    const diffOn = oscMix > 0.001 && (sigma > 0.0005 || oscMix < 0.999);

    // only rewrite the buffers when the shape state actually moved (the drift in
    // the vertex shader keeps it alive while idle) — this is the scroll-cost win.
    // While the diffusion oscillates we rewrite every frame so it can breathe.
    if (diffOn || i !== lastI || Math.abs(f - lastF) > 0.0008) {
      lastI = i; lastF = f;
      const a = targets[i], b = targets[i + 1];
      // brief hold at each end keeps shapes legible; the middle is a staggered,
      // eased cascade so particles flow into the next shape rather than snapping.
      const HOLD = 0.2;
      const g = Math.min(1, Math.max(0, (f - HOLD) / (1 - 2 * HOLD)));
      const W = 0.6; // fraction of the cascade each particle takes to travel
      // per-particle stagger spreads the sigma slightly so the resolve doesn't
      // happen in perfect lockstep — front of the cascade settles a touch first.
      const SIG_SPREAD = 0.18;
      for (let k = 0; k < N; k++) {
        const x = (g - stagger[k] * (1 - W)) / W;
        const pb = x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10); // smootherstep
        const k3 = k * 3;
        // scroll-blend target (at the very top this resolves to the molecule)
        const tx = a.p[k3] + (b.p[k3] - a.p[k3]) * pb;
        const ty = a.p[k3 + 1] + (b.p[k3 + 1] - a.p[k3 + 1]) * pb;
        const tz = a.p[k3 + 2] + (b.p[k3 + 2] - a.p[k3 + 2]) * pb;
        const cr = a.c[k3] + (b.c[k3] - a.c[k3]) * pb;
        const cg = a.c[k3 + 1] + (b.c[k3 + 1] - a.c[k3 + 1]) * pb;
        const cb = a.c[k3 + 2] + (b.c[k3 + 2] - a.c[k3 + 2]) * pb;
        if (diffOn) {
          // reverse-diffusion displacement away from the (scroll-blended) target.
          // sig: this particle's effective noise level (sigma + tiny stagger),
          // faded by oscMix so scrolling hands smoothly back to the clean morph.
          let sig = sigma + (stagger[k] - 0.5) * SIG_SPREAD * sigma;
          if (sig < 0) sig = 0;
          const amp = sig * oscMix;
          // live stochastic boil (cheap trig hash), strongest at high sigma
          const bx = Math.sin(t * 2.1 + k * 12.9898) * boil * oscMix;
          const by = Math.cos(t * 1.7 + k * 7.233) * boil * oscMix;
          const bz = Math.sin(t * 2.4 + k * 3.111) * boil * oscMix;
          positions[k3] = tx + dir[k3] * amp + bx;
          positions[k3 + 1] = ty + dir[k3 + 1] * amp + by;
          positions[k3 + 2] = tz + dir[k3 + 2] * amp + bz;
          // dim + cool the points while noisy; brighten as they resolve
          const lit = 1 - oscMix * (1 - resolved);
          colors[k3] = cr * (0.25 + 0.75 * lit);
          colors[k3 + 1] = cg * (0.25 + 0.75 * lit);
          colors[k3 + 2] = cb * (0.45 + 0.55 * lit);
        } else {
          positions[k3] = tx; positions[k3 + 1] = ty; positions[k3 + 2] = tz;
          colors[k3] = cr; colors[k3 + 1] = cg; colors[k3 + 2] = cb;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
      // Throttle the bond-web rebuild to ~30fps: the web is a soft, blur(1px),
      // 0.5-opacity background layer whose endpoints move slowly, so refreshing it
      // every other frame is visually identical while halving its O(edges) cost on
      // every content page (the morph particles themselves still update at the loop
      // rate above). On the off-frame the previous bond positions persist one frame.
      if ((webFrame++ & 1) === 0) updateWeb();
    }

    // bond web fades IN only as the structure resolves (last ~30% of denoising)
    // and dissolves as it re-noises. Away from the top (oscMix→0) the web returns
    // to full strength for the scroll-morph shapes.
    const formed = 1 - oscMix * (1 - resolved);     // 1 when clean OR scrolled
    edgeMat.opacity = 0.55 * formed;

    // notify the page which field we're in
    const stageIdx = Math.round(sf);
    if (stageIdx !== lastStage) {
      lastStage = stageIdx;
      const s = stages[Math.min(stages.length - 1, stageIdx)];
      opts.onStage?.(stageIdx, s.label, s.accent);
    }

    // motion: slow spin + scroll-coupled tumble + pointer parallax
    group.rotation.y += dt * 0.05;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, ctx.pointer.y * 0.3 + progress * 0.35, 0.05);
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, -ctx.pointer.x * 0.12, 0.05);
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, ctx.pointer.x * 6, 0.04);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, ctx.pointer.y * 5, 0.04);
    camera.lookAt(0, 0, 0);
  });

  onDispose(() => {
    geo.dispose(); mat.dispose();
    edgeGeo.dispose(); edgeMat.dispose();
  });
}
