/**
 * MassSpec — a mass spectrum being acquired.
 *
 * Vertical peaks stand at characteristic m/z values (a molecular ion plus a
 * fragmentation pattern); their intensities shimmer as if averaging scans, and
 * a detector line sweeps across the m/z axis, igniting each peak as it passes
 * before the trace resets and re-acquires. LC/MS, GC/MS, LC-TOF — the
 * fingerprint of a molecule.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

export function massSpec(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  camera.position.set(0, 1.5, 34);
  camera.lookAt(0, 1.5, 0);

  const mobile = ctx.width < 760;
  const W = 44;          // width of the m/z axis
  const X0 = -W / 2;
  const FLOOR = -9;      // baseline y
  const MAXH = 17;       // tallest peak height

  // A plausible fragmentation pattern: m/z fraction (0..1) and relative intensity.
  const peaks = [
    { m: 0.10, h: 0.30 }, { m: 0.18, h: 0.55 }, { m: 0.24, h: 0.22 },
    { m: 0.33, h: 0.78 }, { m: 0.41, h: 0.40 }, { m: 0.47, h: 1.00 }, // base peak
    { m: 0.55, h: 0.34 }, { m: 0.63, h: 0.62 }, { m: 0.71, h: 0.28 },
    { m: 0.80, h: 0.50 }, { m: 0.88, h: 0.72 }, { m: 0.96, h: 0.44 }, // molecular ion-ish
  ];
  const P = peaks.length;

  // Each peak is drawn as a vertical run of glowing points (a stick).
  const PER = mobile ? 26 : 40;
  const N = P * PER;
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const scales = new Float32Array(N);
  const peakOf = new Uint16Array(N);
  const frac = new Float32Array(N); // 0 at base, 1 at full height of its peak

  const peakX = new Float32Array(P);
  for (let p = 0; p < P; p++) peakX[p] = X0 + peaks[p].m * W;

  for (let p = 0; p < P; p++) {
    for (let k = 0; k < PER; k++) {
      const i = p * PER + k;
      peakOf[i] = p;
      frac[i] = k / (PER - 1);
      positions[i * 3] = peakX[p];
      positions[i * 3 + 1] = FLOOR;
      positions[i * 3 + 2] = 0;
      scales[i] = 1.5;
    }
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
        gl_FragColor = vec4(vColor, smoothstep(0.5, 0.12, d)); }`,
  });

  const group = new THREE.Group();
  group.add(new THREE.Points(geo, mat));

  // baseline (m/z axis)
  const axisGeo = new THREE.BufferGeometry();
  axisGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    [X0 - 1, FLOOR, 0, X0 + W + 1, FLOOR, 0], 3));
  const axisMat = new THREE.LineBasicMaterial({ color: PALETTE.blue, transparent: true, opacity: 0.3 });
  group.add(new THREE.Line(axisGeo, axisMat));

  // sweeping detector line (a vertical bar)
  const sweepGeo = new THREE.BufferGeometry();
  sweepGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    [0, FLOOR - 1, 0, 0, FLOOR + MAXH + 2, 0], 3).setUsage(THREE.DynamicDrawUsage));
  const sweepMat = new THREE.LineBasicMaterial({
    color: PALETTE.white, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sweep = new THREE.Line(sweepGeo, sweepMat);
  group.add(sweep);
  scene.add(group);

  const cLow = new THREE.Color(PALETTE.blue);
  const cHigh = new THREE.Color(PALETTE.cyan);
  const cHot = new THREE.Color(PALETTE.amber);
  const tmp = new THREE.Color();

  const SWEEP_PERIOD = 4.0;
  // current visible height fraction per peak (eased toward target as sweep passes)
  const grown = new Float32Array(P);

  onFrame((t, dt) => {
    const sweepFrac = (t / SWEEP_PERIOD) % 1;
    const sweepXpos = X0 + sweepFrac * W;
    const sp = sweepGeo.attributes.position.array as Float32Array;
    sp[0] = sweepXpos; sp[3] = sweepXpos;
    sweepGeo.attributes.position.needsUpdate = true;

    for (let p = 0; p < P; p++) {
      // a peak is "acquired" once the sweep has passed its x
      const target = sweepFrac >= peaks[p].m ? 1 : 0;
      grown[p] = THREE.MathUtils.lerp(grown[p], target, 0.12);
    }

    for (let i = 0; i < N; i++) {
      const p = peakOf[i];
      const peakH = peaks[p].h * MAXH * grown[p];
      const y = FLOOR + frac[i] * peakH;
      const i3 = i * 3;
      positions[i3 + 1] = y;
      // subtle shimmer in x/z so sticks feel alive
      positions[i3] = peakX[p] + Math.sin(t * 2 + i) * 0.05;
      positions[i3 + 2] = Math.sin(t * 1.3 + p) * 0.4;

      // color: low->high by height, flash hot near the sweep
      const hf = peaks[p].h;
      tmp.copy(cLow).lerp(cHigh, hf);
      const near = Math.max(0, 1 - Math.abs(peakX[p] - sweepXpos) / 2.5);
      tmp.lerp(cHot, near * 0.8);
      const b = 0.5 + 0.5 * grown[p];
      colors[i3] = tmp.r * b; colors[i3 + 1] = tmp.g * b; colors[i3 + 2] = tmp.b * b;
      scales[i] = (1.2 + hf * 1.4) * (1 + near * 0.8);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aScale.needsUpdate = true;

    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, ctx.pointer.x * 0.18, 0.05);
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, -0.04 + ctx.pointer.y * 0.1, 0.05);
  });

  onDispose(() => {
    geo.dispose(); mat.dispose();
    axisGeo.dispose(); axisMat.dispose();
    sweepGeo.dispose(); sweepMat.dispose();
  });
}
