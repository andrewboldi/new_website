/**
 * StatMech — a box of gas particles in constant motion, each colored by its
 * speed (a live Maxwell–Boltzmann distribution: cool/slow → blue, hot/fast →
 * amber). Kinetic theory and statistical mechanics, the physical-chemistry way.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

export function statMech(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  camera.position.set(0, 0, 40);

  const mobile = ctx.width < 760;
  const N = mobile ? 500 : 1100;
  const B = 16; // half box size

  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const scales = new Float32Array(N);
  const vel = new Float32Array(N * 3);

  // Maxwell–Boltzmann velocities ≈ Gaussian per component
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const SPEED = 7;
  for (let i = 0; i < N; i++) {
    positions[i * 3] = (Math.random() * 2 - 1) * B;
    positions[i * 3 + 1] = (Math.random() * 2 - 1) * B;
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * B;
    vel[i * 3] = gauss() * SPEED;
    vel[i * 3 + 1] = gauss() * SPEED;
    vel[i * 3 + 2] = gauss() * SPEED;
    scales[i] = 1.4;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aScale; attribute vec3 aColor; varying vec3 vColor;
      void main() { vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aScale * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() { float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vColor, smoothstep(0.5, 0.08, d)); }`,
  });
  const group = new THREE.Group();
  group.add(new THREE.Points(geo, mat));

  // box wireframe
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(B * 2, B * 2, B * 2)),
    new THREE.LineBasicMaterial({ color: PALETTE.blue, transparent: true, opacity: 0.14 }),
  );
  group.add(box);
  scene.add(group);

  const cSlow = new THREE.Color(PALETTE.blue);
  const cMid = new THREE.Color(PALETTE.cyan);
  const cFast = new THREE.Color(PALETTE.amber);
  const tmp = new THREE.Color();

  onFrame((t, dt) => {
    const step = Math.min(dt, 0.05);
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      for (let a = 0; a < 3; a++) {
        let p = positions[i3 + a] + vel[i3 + a] * step;
        if (p > B) { p = B; vel[i3 + a] = -Math.abs(vel[i3 + a]); }
        else if (p < -B) { p = -B; vel[i3 + a] = Math.abs(vel[i3 + a]); }
        positions[i3 + a] = p;
      }
      const speed = Math.hypot(vel[i3], vel[i3 + 1], vel[i3 + 2]);
      const f = Math.min(1, speed / (SPEED * 2.4));
      if (f < 0.5) tmp.copy(cSlow).lerp(cMid, f * 2);
      else tmp.copy(cMid).lerp(cFast, (f - 0.5) * 2);
      colors[i3] = tmp.r; colors[i3 + 1] = tmp.g; colors[i3 + 2] = tmp.b;
      scales[i] = 1.1 + f * 1.6;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aScale.needsUpdate = true;

    group.rotation.y += dt * 0.12;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, -0.2 + ctx.pointer.y * 0.3, 0.05);
  });

  onDispose(() => { geo.dispose(); mat.dispose(); });
}
