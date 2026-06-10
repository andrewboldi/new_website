/**
 * Signal — a band of points that repeatedly resolves from noise into a clean
 * travelling wave and dissolves back. Literally signal over noise, for the
 * essay of the same name.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

export function signal(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  camera.position.set(0, 0, 30);

  const mobile = ctx.width < 760;
  const N = mobile ? 900 : 1700;
  const W = 46, A = 7;

  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const scales = new Float32Array(N);
  const xs = new Float32Array(N);
  const noise = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1) - 0.5) * W;
    xs[i] = x;
    noise[i] = (Math.random() * 2 - 1);
    positions[i * 3] = x;
    scales[i] = 0.8 + Math.random() * 1.2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1).setUsage(THREE.DynamicDrawUsage));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aScale; attribute vec3 aColor; varying vec3 vColor;
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aScale * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vColor, smoothstep(0.5, 0.1, d));
      }`,
  });
  scene.add(new THREE.Points(geo, mat));

  const cNoise = new THREE.Color(PALETTE.blue).multiplyScalar(0.5);
  const cSignal = new THREE.Color(PALETTE.cyan);
  const tmp = new THREE.Color();

  onFrame((t) => {
    // clarity breathes 0 -> 1 -> 0
    const clarity = 0.5 - 0.5 * Math.cos(t * 0.45);
    for (let i = 0; i < N; i++) {
      const x = xs[i];
      const sig = Math.sin(x * 0.4 - t * 2.2) * A;
      const noiseY = noise[i] * A * 1.1 + Math.sin(t * 7 + i) * (1 - clarity) * 1.2;
      positions[i * 3 + 1] = noiseY * (1 - clarity) + sig * clarity;
      positions[i * 3 + 2] = (1 - clarity) * (Math.random() - 0.5) * 4;
      tmp.copy(cNoise).lerp(cSignal, clarity);
      const b = 0.35 + 0.65 * clarity;
      colors[i * 3] = tmp.r * b; colors[i * 3 + 1] = tmp.g * b; colors[i * 3 + 2] = tmp.b * b;
      scales[i] = (0.8 + (i % 3) * 0.2) * (0.7 + clarity * 0.8);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aScale.needsUpdate = true;
  });

  onDispose(() => { geo.dispose(); mat.dispose(); });
}
