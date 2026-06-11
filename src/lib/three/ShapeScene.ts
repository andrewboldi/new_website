/**
 * ShapeScene — renders any of the shared shape generators as a slowly rotating,
 * gently breathing glowing point cloud. Used for the standalone topic scenes
 * (atomic orbital, DNA helix, crystal lattice) so they match the morph field's
 * visual language without bespoke code each.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import type { ShapeGen } from './shapes';

const VS = /* glsl */ `
  attribute float aScale; attribute vec3 aColor; attribute float aWeight;
  varying vec3 vColor; varying float vWeight; varying float vDepth;
  uniform float uTime; uniform float uBreathe; uniform float uJitter;
  void main() {
    vColor = aColor;
    vWeight = aWeight;
    // gentle global breathing + a small per-point drift (damped per scene so
    // crisp structures — helix rungs, lattice bonds — don't smear into fuzz)
    vec3 p = position * (1.0 + uBreathe * 0.06 * sin(uTime * 0.9 + length(position) * 0.4));
    float j = uJitter * (0.4 + 0.6 / (1.0 + aWeight));   // heavy/bright points jitter less
    p.x += sin(uTime * 0.5 + position.y) * j;
    p.y += cos(uTime * 0.45 + position.x) * j;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // depth cue: 0 (near) .. 1 (far) across the cloud, for dimming/cooling far points
    vDepth = clamp((-mv.z - 30.0) / 70.0, 0.0, 1.0);
    // sub-linear weight→size so bright points are bigger but don't merge to blobs
    float sz = aScale * (0.7 + 0.5 * sqrt(aWeight));
    gl_PointSize = sz * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const FS = /* glsl */ `
  varying vec3 vColor; varying float vWeight; varying float vDepth;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    // soft gaussian sprite: small bright core + wide falloff halo. Keep the core
    // tight so additive blending + bloom don't wash the hue out to pure white.
    float core = smoothstep(0.28, 0.0, d);
    float halo = exp(-d * d * 7.0);
    // bright structural points get a slightly hotter core (subtle chiaroscuro)
    float hot = clamp((vWeight - 1.0) * 0.18, 0.0, 0.2);
    vec3 c = mix(vColor, vec3(1.0), core * (0.14 + hot));
    // depth cueing: far points dim and cool slightly toward the void
    c = mix(c, c * 0.4, vDepth * 0.65);
    // hold the hue: scale brightness by weight but keep alpha modest so color reads
    float alpha = (halo * 0.42 + core * 0.30) * mix(1.0, 0.5, vDepth);
    gl_FragColor = vec4(c, alpha);
  }`;

interface Opts {
  gen: ShapeGen;
  count?: number;
  radius?: number;
  spin?: number;
  breathe?: boolean;
  cameraZ?: number;
  /** per-point drift amplitude; lower keeps fine structure crisp (default 0.12) */
  jitter?: number;
}

export function shapeScene(handle: SceneHandle, opts: Opts) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  const mobile = ctx.width < 760;
  const N = opts.count ?? (mobile ? 1800 : 3000);
  const R = opts.radius ?? 18;
  camera.position.set(0, 0, opts.cameraZ ?? 52);

  const group = new THREE.Group();
  scene.add(group);

  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  // per-point render weight (size + glow). Generators that understand it fill it;
  // others leave the default so the scene still renders uniformly.
  const weights = new Float32Array(N).fill(1);
  opts.gen(positions, colors, N, R, weights);
  const scales = new Float32Array(N);
  for (let i = 0; i < N; i++) scales[i] = 0.8 + Math.random() * 1.0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  geo.setAttribute('aWeight', new THREE.BufferAttribute(weights, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBreathe: { value: opts.breathe === false ? 0 : 1 },
      uJitter: { value: opts.jitter ?? 0.12 },
    },
    vertexShader: VS, fragmentShader: FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.Points(geo, mat));

  const spin = opts.spin ?? 0.12;
  onFrame((t, dt) => {
    mat.uniforms.uTime.value = t;
    group.rotation.y += dt * spin;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, ctx.pointer.y * 0.4, 0.05);
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, -ctx.pointer.x * 0.2, 0.05);
  });

  onDispose(() => { geo.dispose(); mat.dispose(); });
}
