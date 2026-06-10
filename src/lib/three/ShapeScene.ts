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
  attribute float aScale; attribute vec3 aColor; varying vec3 vColor;
  uniform float uTime; uniform float uBreathe;
  void main() {
    vColor = aColor;
    vec3 p = position * (1.0 + uBreathe * 0.08 * sin(uTime * 0.9 + length(position) * 0.4));
    p.x += sin(uTime * 0.5 + position.y) * 0.12;
    p.y += cos(uTime * 0.45 + position.x) * 0.12;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aScale * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const FS = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.25), smoothstep(0.5, 0.18, d) * 0.6);
  }`;

interface Opts {
  gen: ShapeGen;
  count?: number;
  radius?: number;
  spin?: number;
  breathe?: boolean;
  cameraZ?: number;
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
  opts.gen(positions, colors, N, R);
  const scales = new Float32Array(N);
  for (let i = 0; i < N; i++) scales[i] = 0.8 + Math.random() * 1.6;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBreathe: { value: opts.breathe === false ? 0 : 1 } },
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
