/**
 * Chromatography — a column separating a mixture into bands.
 *
 * A glass column (wireframe) is packed with stationary phase; a plug of mixed
 * analytes is injected at the top and migrates downward. Each compound travels
 * at its own rate (its retention factor), so the single band resolves into
 * several colored bands that pull apart and elute off the bottom — then the run
 * repeats. The everyday magic of HPLC / column chromatography, ~1000 bench
 * hours' worth.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

export function chromatography(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  camera.position.set(0, 0, 40);
  camera.lookAt(0, 0, 0);

  const mobile = ctx.width < 760;

  const RADIUS = 5;     // column radius
  const TOP = 16;       // y at the top of the packed bed
  const BOTTOM = -16;   // y where compounds elute
  const HEIGHT = TOP - BOTTOM;

  // Each analyte band: a fraction of the particles, its own migration speed +
  // color. All bands are injected together and pull apart as they descend.
  const bands = [
    { color: PALETTE.cyan, rate: 1.0 },
    { color: PALETTE.violet, rate: 0.78 },
    { color: PALETTE.amber, rate: 0.58 },
    { color: PALETTE.blue, rate: 0.4 },
  ];
  const PER_BAND = mobile ? 90 : 170;
  const N = bands.length * PER_BAND;

  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const scales = new Float32Array(N);
  const bandOf = new Uint8Array(N);
  const jitterX = new Float32Array(N);
  const jitterZ = new Float32Array(N);
  const jitterY = new Float32Array(N);

  const tmp = new THREE.Color();
  for (let b = 0; b < bands.length; b++) {
    tmp.set(bands[b].color);
    for (let k = 0; k < PER_BAND; k++) {
      const i = b * PER_BAND + k;
      bandOf[i] = b;
      // random point in a disc cross-section
      const r = RADIUS * 0.86 * Math.sqrt(Math.random());
      const th = Math.random() * Math.PI * 2;
      jitterX[i] = Math.cos(th) * r;
      jitterZ[i] = Math.sin(th) * r;
      // gaussian-ish vertical offset so each band reads as a soft elongated band
      jitterY[i] = ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 2;
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
      scales[i] = 0.8 + Math.random() * 0.8;
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

  // ---- glass column: a faint open cylinder ----
  const colGeo = new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 28, 1, true);
  const colMat = new THREE.MeshBasicMaterial({
    color: PALETTE.blue, transparent: true, opacity: 0.05, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const column = new THREE.Mesh(colGeo, colMat);
  column.position.y = (TOP + BOTTOM) / 2;
  group.add(column);

  // wire rings top & bottom to read as a tube
  const ringMat = new THREE.LineBasicMaterial({ color: PALETTE.blue, transparent: true, opacity: 0.22 });
  for (const y of [TOP, BOTTOM]) {
    const pts: number[] = [];
    const SEG = 48;
    for (let s = 0; s <= SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      pts.push(Math.cos(a) * RADIUS, y, Math.sin(a) * RADIUS);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.Line(rg, ringMat));
  }
  scene.add(group);

  const PLUG = 2.4;       // thickness of each migrating band (in y units)
  const RUN = 11.0;       // seconds per chromatography run
  const START = 3.2;      // begin partway in, so bands are already separating
  // distance the rate=1 band travels over a full run (top, through bed, eluted)
  const RUN_DIST = HEIGHT + PLUG * 2 + 6;

  onFrame((t) => {
    // run progress 0..1; all bands injected together at progress 0
    const prog = ((t + START) % RUN) / RUN;
    for (let i = 0; i < N; i++) {
      const b = bandOf[i];
      const traveled = bands[b].rate * prog * RUN_DIST;
      const y = TOP - traveled + jitterY[i] * PLUG * 0.5;
      const i3 = i * 3;
      positions[i3] = jitterX[i] + Math.sin(t * 0.4 + i) * 0.12;
      positions[i3 + 1] = y;
      positions[i3 + 2] = jitterZ[i];
      // fade in just below injection, fade out as it elutes past the bottom
      let alpha = 1;
      if (y < BOTTOM) alpha = Math.max(0, 1 + (y - BOTTOM) / 3.5);
      else if (y > TOP) alpha = Math.max(0, 1 - (y - TOP) / 2.5);
      const base = bands[b].color;
      // keep brightness modest so additive bloom doesn't blow the bands to white
      tmp.set(base).multiplyScalar(0.42);
      colors[i3] = tmp.r * alpha; colors[i3 + 1] = tmp.g * alpha; colors[i3 + 2] = tmp.b * alpha;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;

    group.rotation.y += 0.0016; // very slow drift so bands read in 3D
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, ctx.pointer.y * 0.12, 0.04);
  });

  onDispose(() => {
    geo.dispose(); mat.dispose(); colGeo.dispose(); colMat.dispose(); ringMat.dispose();
  });
}
