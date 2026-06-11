/**
 * MorphField — a persistent background particle system that morphs between
 * shapes as you scroll, each shape a different one of Andrew's fields. Scroll
 * progress drives a continuous blend so the particles *flow* from latent space
 * into a DNA helix into a benzene ring into an atomic orbital, and so on.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';
import { cloud, helix, benzene, orbital, wave, neural, type ShapeGen } from './shapes';

export interface Stage { gen: ShapeGen; label: string; accent: number; }

export const DEFAULT_STAGES: Stage[] = [
  { gen: cloud, label: 'latent chemical space', accent: PALETTE.cyan },
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

    // only rewrite the buffers when the shape state actually moved (the drift in
    // the vertex shader keeps it alive while idle) — this is the scroll-cost win
    if (i !== lastI || Math.abs(f - lastF) > 0.0008) {
      lastI = i; lastF = f;
      const a = targets[i], b = targets[i + 1];
      // brief hold at each end keeps shapes legible; the middle is a staggered,
      // eased cascade so particles flow into the next shape rather than snapping.
      const HOLD = 0.2;
      const g = Math.min(1, Math.max(0, (f - HOLD) / (1 - 2 * HOLD)));
      const W = 0.6; // fraction of the cascade each particle takes to travel
      for (let k = 0; k < N; k++) {
        const x = (g - stagger[k] * (1 - W)) / W;
        const pb = x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10); // smootherstep
        const k3 = k * 3;
        positions[k3] = a.p[k3] + (b.p[k3] - a.p[k3]) * pb;
        positions[k3 + 1] = a.p[k3 + 1] + (b.p[k3 + 1] - a.p[k3 + 1]) * pb;
        positions[k3 + 2] = a.p[k3 + 2] + (b.p[k3 + 2] - a.p[k3 + 2]) * pb;
        colors[k3] = a.c[k3] + (b.c[k3] - a.c[k3]) * pb;
        colors[k3 + 1] = a.c[k3 + 1] + (b.c[k3 + 1] - a.c[k3 + 1]) * pb;
        colors[k3 + 2] = a.c[k3 + 2] + (b.c[k3 + 2] - a.c[k3 + 2]) * pb;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
    }

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

  onDispose(() => { geo.dispose(); mat.dispose(); });
}
