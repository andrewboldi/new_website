/**
 * MolecularNetwork — the hero scene.
 *
 * A field of drifting nodes in a bounded volume; when two nodes come within a
 * threshold they're joined by a line whose brightness falls off with distance.
 * Read it as latent chemical space: molecules diffusing, transient interactions
 * forming and breaking. Glowing nodes + UnrealBloom give it the lab-instrument
 * sheen. Pointer gently steers the whole lattice.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

interface Opts {
  count?: number;
  radius?: number;
  linkDist?: number;
  hubCount?: number;
}

const POINT_VS = /* glsl */ `
  attribute float aScale;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vScale;
  uniform float uTime;
  void main() {
    vColor = aColor;
    vScale = aScale;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float pulse = 1.0 + 0.18 * sin(uTime * 1.6 + position.x * 4.0 + position.y * 3.0);
    gl_PointSize = aScale * pulse * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FS = /* glsl */ `
  varying vec3 vColor;
  varying float vScale;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    // soft glowing core
    float core = smoothstep(0.5, 0.0, d);
    float halo = smoothstep(0.5, 0.18, d);
    vec3 col = mix(vColor, vec3(1.0), core * 0.55);
    gl_FragColor = vec4(col, halo);
  }
`;

export function molecularNetwork(handle: SceneHandle, opts: Opts = {}) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  const mobile = ctx.width < 760;
  const count = opts.count ?? (mobile ? 110 : 230);
  const R = opts.radius ?? 28;
  const linkDist = opts.linkDist ?? (mobile ? 9 : 8.2);
  const hubCount = opts.hubCount ?? 6;

  camera.position.set(0, 0, 62);
  camera.lookAt(0, 0, 0);

  const group = new THREE.Group();
  scene.add(group);

  // ---------- nodes ----------
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  const cBlue = new THREE.Color(PALETTE.blue);
  const cCyan = new THREE.Color(PALETTE.cyan);
  const cViolet = new THREE.Color(PALETTE.violet);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    // distribute in a soft sphere
    const r = R * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i3 + 2] = r * Math.cos(phi);

    velocities[i3] = (Math.random() - 0.5) * 0.9;
    velocities[i3 + 1] = (Math.random() - 0.5) * 0.9;
    velocities[i3 + 2] = (Math.random() - 0.5) * 0.9;

    const isHub = i < hubCount;
    scales[i] = isHub ? 4.4 + Math.random() * 1.6 : 0.7 + Math.random() * 1.1;

    // color by radial position: core cyan -> mid blue -> rim violet
    const t = r / R;
    if (isHub) tmpColor.copy(cCyan);
    else tmpColor.copy(cCyan).lerp(cBlue, t).lerp(cViolet, Math.max(0, t - 0.6));
    colors[i3] = tmpColor.r; colors[i3 + 1] = tmpColor.g; colors[i3 + 2] = tmpColor.b;
  }

  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  nodeGeo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  nodeGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const nodeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: POINT_VS,
    fragmentShader: POINT_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const nodes = new THREE.Points(nodeGeo, nodeMat);
  group.add(nodes);

  // ---------- links ----------
  const maxSegments = count * 14; // soft cap on simultaneous links
  const linkPos = new Float32Array(maxSegments * 6);
  const linkCol = new Float32Array(maxSegments * 6);
  const linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPos, 3).setUsage(THREE.DynamicDrawUsage));
  linkGeo.setAttribute('color', new THREE.BufferAttribute(linkCol, 3).setUsage(THREE.DynamicDrawUsage));
  linkGeo.setDrawRange(0, 0);
  const linkMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const links = new THREE.LineSegments(linkGeo, linkMat);
  group.add(links);

  // a faint enclosing wire sphere for "containment" depth cue
  const shell = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R * 1.18, 1)),
    new THREE.LineBasicMaterial({ color: PALETTE.blue, transparent: true, opacity: 0.06 }),
  );
  group.add(shell);

  const linkD2 = linkDist * linkDist;
  const cA = new THREE.Color();
  const cB = new THREE.Color();

  onFrame((t, dt) => {
    nodeMat.uniforms.uTime.value = t;

    // integrate + bounce inside sphere
    const step = (dt || 0.016) * 1.0;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] += velocities[i3] * step;
      positions[i3 + 1] += velocities[i3 + 1] * step;
      positions[i3 + 2] += velocities[i3 + 2] * step;
      const x = positions[i3], y = positions[i3 + 1], z = positions[i3 + 2];
      const d = Math.hypot(x, y, z);
      if (d > R) {
        // reflect velocity about the surface normal
        const nx = x / d, ny = y / d, nz = z / d;
        const dot = velocities[i3] * nx + velocities[i3 + 1] * ny + velocities[i3 + 2] * nz;
        velocities[i3] -= 2 * dot * nx;
        velocities[i3 + 1] -= 2 * dot * ny;
        velocities[i3 + 2] -= 2 * dot * nz;
        const s = R / d;
        positions[i3] = x * s; positions[i3 + 1] = y * s; positions[i3 + 2] = z * s;
      }
    }
    nodeGeo.attributes.position.needsUpdate = true;

    // recompute links (O(n^2) but n is small)
    let vp = 0, cp = 0, seg = 0;
    for (let i = 0; i < count && seg < maxSegments; i++) {
      const i3 = i * 3;
      const xi = positions[i3], yi = positions[i3 + 1], zi = positions[i3 + 2];
      cA.set(colors[i3], colors[i3 + 1], colors[i3 + 2]);
      for (let j = i + 1; j < count && seg < maxSegments; j++) {
        const j3 = j * 3;
        const dx = xi - positions[j3];
        const dy = yi - positions[j3 + 1];
        const dz = zi - positions[j3 + 2];
        const dist2 = dx * dx + dy * dy + dz * dz;
        if (dist2 > linkD2) continue;
        const a = 1 - Math.sqrt(dist2) / linkDist;
        cB.set(colors[j3], colors[j3 + 1], colors[j3 + 2]);

        linkPos[vp++] = xi; linkPos[vp++] = yi; linkPos[vp++] = zi;
        linkPos[vp++] = positions[j3]; linkPos[vp++] = positions[j3 + 1]; linkPos[vp++] = positions[j3 + 2];

        linkCol[cp++] = cA.r * a; linkCol[cp++] = cA.g * a; linkCol[cp++] = cA.b * a;
        linkCol[cp++] = cB.r * a; linkCol[cp++] = cB.g * a; linkCol[cp++] = cB.b * a;
        seg++;
      }
    }
    linkGeo.setDrawRange(0, seg * 2);
    linkGeo.attributes.position.needsUpdate = true;
    linkGeo.attributes.color.needsUpdate = true;

    // slow auto-rotate + pointer parallax
    group.rotation.y += dt * 0.04;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, ctx.pointer.y * 0.35, 0.04);
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, -ctx.pointer.x * 0.12, 0.04);
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, ctx.pointer.x * 8, 0.04);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, ctx.pointer.y * 6, 0.04);
    camera.lookAt(0, 0, 0);
  });

  onDispose(() => {
    nodeGeo.dispose(); nodeMat.dispose();
    linkGeo.dispose(); linkMat.dispose();
  });
}
