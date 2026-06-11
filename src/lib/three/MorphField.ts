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
  const N = opts.count ?? (mobile ? 1800 : 3200);
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

  // ---- glowing core ----
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.6, 3),
    new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }),
  );
  group.add(core);

  // faint structural shell for depth
  const shell = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R * 1.35, 1)),
    new THREE.LineBasicMaterial({ color: PALETTE.blue, transparent: true, opacity: 0.05 }),
  );
  group.add(shell);

  let progress = 0;       // eased scroll progress 0..1
  let lastStage = -1;
  let lastI = -1, lastF = -1; // skip the morph loop when nothing changed
  // per-particle phase so the morph cascades organically instead of snapping in lockstep
  const stagger = new Float32Array(N);
  for (let k = 0; k < N; k++) stagger[k] = Math.random();

  // ---- diffusion / denoise intro ----------------------------------------
  // Particles begin as random gaussian NOISE and condense into the molecule
  // (shape[0]) over a few seconds, echoing denoising-diffusion generative
  // chemistry. Buffers are preallocated; the per-particle cascade reuses the
  // same staggered smootherstep as the scroll morph, so noise→molecule and
  // molecule→helix feel like one continuous language. No per-frame allocation.
  const reduced = prefersReducedMotion();
  const noise = new Float32Array(N * 3);          // fixed noise field (reused)
  const noiseStagger = new Float32Array(N);       // per-particle reveal phase
  const NOISE_R = R * 1.85;                        // noise cloud radius
  const gauss = () => {                            // Box–Muller-ish gaussian
    let s = 0;
    for (let m = 0; m < 3; m++) s += Math.random();
    return (s / 3 - 0.5) * 2;                       // ~[-1,1], bell-shaped
  };
  const seedNoise = () => {
    for (let k = 0; k < N; k++) {
      noise[k * 3] = gauss() * NOISE_R;
      noise[k * 3 + 1] = gauss() * NOISE_R;
      noise[k * 3 + 2] = gauss() * NOISE_R;
      noiseStagger[k] = Math.random();
    }
  };
  seedNoise();
  const INTRO_DUR = 3.2;            // seconds noise→molecule
  const INTRO_SPREAD = 0.55;        // fraction of the run each particle travels
  let introStart = -1;             // elapsed-time anchor; set on first frame
  // reduced motion: skip the animation entirely — rest on the formed molecule.
  let introActive = !reduced;
  let introMix = reduced ? 0 : 1;   // 1 = full noise control, 0 = handed off
  let leftTop = false;             // armed once we've scrolled away (for re-trigger)
  const TOP_EPS = 0.012;           // "at the very top" threshold (scroll progress)

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

    // ---- denoise intro state ------------------------------------------------
    // `introMix` is the global noise→molecule progress (1 = pure noise, 0 = the
    // intro has fully handed off to the scroll morph). It's driven by elapsed
    // time, but scrolling away from the top fast-forwards it so the intro never
    // fights a user who starts scrolling mid-condensation.
    if (introActive) {
      if (introStart < 0) introStart = t;            // anchor on the first live frame
      const ageRaw = (t - introStart) / INTRO_DUR;   // 0..1 time progress
      // if the user scrolls during the intro, push the run forward so noise clears
      const scrollPush = progress > TOP_EPS ? Math.min(1, progress / 0.05) : 0;
      const age = Math.min(1, Math.max(ageRaw, scrollPush));
      // global mix = how much noise remains once the last particle has condensed
      introMix = 1 - (age <= 0 ? 0 : age >= 1 ? 1 : age * age * age * (age * (age * 6 - 15) + 10));
      if (age >= 1) { introActive = false; introMix = 0; }
    }

    // Re-arm + re-trigger the denoise when the field returns to the very top
    // after having been scrolled away (a nice "regenerate" beat; cheap to do).
    if (!introActive) {
      if (progress > 0.06) leftTop = true;
      else if (leftTop && progress < TOP_EPS && !reduced) {
        leftTop = false; introActive = true; introStart = t; introMix = 1; seedNoise();
      }
    }

    // only rewrite the buffers when the shape state actually moved (the drift in
    // the vertex shader keeps it alive while idle) — this is the scroll-cost win.
    // While the intro animates we must rewrite every frame so noise can condense.
    if (introActive || i !== lastI || Math.abs(f - lastF) > 0.0008) {
      lastI = i; lastF = f;
      const a = targets[i], b = targets[i + 1];
      // brief hold at each end keeps shapes legible; the middle is a staggered,
      // eased cascade so particles flow into the next shape rather than snapping.
      const HOLD = 0.2;
      const g = Math.min(1, Math.max(0, (f - HOLD) / (1 - 2 * HOLD)));
      const W = 0.6; // fraction of the cascade each particle takes to travel
      // intro time progress (shared across particles; per-particle phase below)
      const introAge = introActive
        ? Math.min(1, Math.max((t - introStart) / INTRO_DUR,
            progress > TOP_EPS ? Math.min(1, progress / 0.05) : 0))
        : 1;
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
        if (introActive) {
          // per-particle denoise: same staggered smootherstep, so order emerges
          // out of noise one cascade at a time. dn: 0 = still noise, 1 = settled.
          const ix = (introAge - noiseStagger[k] * (1 - INTRO_SPREAD)) / INTRO_SPREAD;
          const dn = ix <= 0 ? 0 : ix >= 1 ? 1 : ix * ix * ix * (ix * (ix * 6 - 15) + 10);
          positions[k3] = noise[k3] + (tx - noise[k3]) * dn;
          positions[k3 + 1] = noise[k3 + 1] + (ty - noise[k3 + 1]) * dn;
          positions[k3 + 2] = noise[k3 + 2] + (tz - noise[k3 + 2]) * dn;
          // colors brighten as particles settle (noise reads dim/cold)
          colors[k3] = cr * (0.25 + 0.75 * dn);
          colors[k3 + 1] = cg * (0.25 + 0.75 * dn);
          colors[k3 + 2] = cb * (0.45 + 0.55 * dn);
        } else {
          positions[k3] = tx; positions[k3 + 1] = ty; positions[k3 + 2] = tz;
          colors[k3] = cr; colors[k3 + 1] = cg; colors[k3 + 2] = cb;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
      updateWeb();
    }

    // bond web fades in as atoms settle out of the noise (and stays full after).
    edgeMat.opacity = 0.55 * (1 - introMix);

    // pulsing core
    core.scale.setScalar(1 + 0.22 * Math.sin(t * 1.8));
    (core.material as THREE.MeshBasicMaterial).opacity = (0.6 + 0.25 * Math.sin(t * 1.8 + 1)) * (1 - 0.6 * introMix);

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
    core.geometry.dispose(); (core.material as THREE.Material).dispose();
  });
}
