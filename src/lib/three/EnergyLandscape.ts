/**
 * EnergyLandscape — a living potential-energy / loss surface.
 *
 * A grid is displaced by an analytic height field (a drifting sum of Gaussian
 * wells on a gentle bowl). A glowing marker repeatedly performs gradient descent
 * down the surface and re-spawns — the shared geometry of physics, ML, and RL.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, mixColor } from './core';

interface Well { x: number; z: number; depth: number; sigma: number; vx: number; vz: number; }

export function energyLandscape(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  const SIZE = 60;
  const N = ctx.width < 760 ? 60 : 90; // grid resolution
  const HALF = SIZE / 2;

  camera.position.set(0, 26, 46);
  camera.lookAt(0, -2, 0);

  const group = new THREE.Group();
  group.rotation.x = -0.1;
  scene.add(group);

  // moving wells define the landscape
  const wells: Well[] = Array.from({ length: 5 }, (_, i) => ({
    x: (Math.random() - 0.5) * SIZE * 0.7,
    z: (Math.random() - 0.5) * SIZE * 0.7,
    depth: 8 + Math.random() * 7,
    sigma: 7 + Math.random() * 5,
    vx: (Math.random() - 0.5) * 2,
    vz: (Math.random() - 0.5) * 2,
  }));

  const height = (x: number, z: number, t: number): number => {
    let h = (x * x + z * z) * 0.006; // gentle bowl
    for (const w of wells) {
      const wx = w.x + Math.sin(t * 0.2) * w.vx * 3;
      const wz = w.z + Math.cos(t * 0.17) * w.vz * 3;
      const d2 = (x - wx) ** 2 + (z - wz) ** 2;
      h -= w.depth * Math.exp(-d2 / (2 * w.sigma * w.sigma));
    }
    return h;
  };

  // ---- point grid ----
  const total = N * N;
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const scales = new Float32Array(total);
  let k = 0;
  for (let ix = 0; ix < N; ix++) {
    for (let iz = 0; iz < N; iz++) {
      const x = (ix / (N - 1) - 0.5) * SIZE;
      const z = (iz / (N - 1) - 0.5) * SIZE;
      positions[k * 3] = x; positions[k * 3 + 1] = 0; positions[k * 3 + 2] = z;
      scales[k] = 1; k++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1).setUsage(THREE.DynamicDrawUsage));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aScale; attribute vec3 color; varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aScale * (360.0 / -mv.z);
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
  const points = new THREE.Points(geo, mat);
  group.add(points);

  // ---- gradient-descent marker ----
  const markerMat = new THREE.MeshBasicMaterial({ color: PALETTE.amber });
  const marker = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 2), markerMat);
  group.add(marker);
  const halo = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.7, 2),
    new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.18 }),
  );
  marker.add(halo);

  let mx = (Math.random() - 0.5) * SIZE * 0.6;
  let mz = (Math.random() - 0.5) * SIZE * 0.6;
  let respawn = 0;

  const lo = new THREE.Color(PALETTE.cyan);
  const mid = new THREE.Color(PALETTE.blue);
  const hi = new THREE.Color(PALETTE.violet);
  const tmp = new THREE.Color();

  onFrame((t, dt) => {
    let idx = 0;
    let minH = 1e9, maxH = -1e9;
    // first pass: heights
    for (let ix = 0; ix < N; ix++) {
      for (let iz = 0; iz < N; iz++) {
        const x = positions[idx * 3], z = positions[idx * 3 + 2];
        const h = height(x, z, t);
        positions[idx * 3 + 1] = -h; // invert so wells dip down
        if (h < minH) minH = h; if (h > maxH) maxH = h;
        idx++;
      }
    }
    // color + size by normalized height
    const range = Math.max(1e-3, maxH - minH);
    for (let i = 0; i < total; i++) {
      const norm = (height(positions[i * 3], positions[i * 3 + 2], t) - minH) / range;
      if (norm < 0.5) tmp.copy(lo).lerp(mid, norm * 2);
      else tmp.copy(mid).lerp(hi, (norm - 0.5) * 2);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
      scales[i] = 1.0 + (1 - norm) * 2.4; // valleys brighter/bigger
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.aScale.needsUpdate = true;

    // gradient descent on the marker
    const eps = 0.4;
    const gx = (height(mx + eps, mz, t) - height(mx - eps, mz, t)) / (2 * eps);
    const gz = (height(mx, mz + eps, t) - height(mx, mz - eps, t)) / (2 * eps);
    const lr = 6.0;
    mx -= gx * lr * dt; mz -= gz * lr * dt;
    mx = THREE.MathUtils.clamp(mx, -HALF, HALF);
    mz = THREE.MathUtils.clamp(mz, -HALF, HALF);
    marker.position.set(mx, -height(mx, mz, t) + 1.0, mz);
    const grad = Math.hypot(gx, gz);
    markerMat.color.copy(mixColor(PALETTE.amber, PALETTE.cyan, Math.min(1, grad)));

    respawn += dt;
    if (grad < 0.06 || respawn > 7) {
      respawn = 0;
      mx = (Math.random() - 0.5) * SIZE * 0.7;
      mz = (Math.random() - 0.5) * SIZE * 0.7;
    }

    group.rotation.y = Math.sin(t * 0.06) * 0.25 + ctx.pointer.x * 0.25;
  });

  onDispose(() => { geo.dispose(); mat.dispose(); });
}
