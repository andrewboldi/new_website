/**
 * Fourier — synthesis of a wave from rotating phasors (epicycles).
 *
 * A chain of circles, each spinning at an odd harmonic with 1/n amplitude (the
 * Fourier series of a square wave), is chained tip-to-tip. The final tip traces
 * out the resulting waveform, which scrolls to the right as a glowing trail —
 * sum of sines, the math under signals and music alike.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, mixColor } from './core';

export function fourier(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  camera.position.set(0, 0, 30);
  camera.lookAt(0, 0, 0);

  const HARMONICS = 6;          // number of phasors
  const CX = -10;               // x-center of the epicycle stack
  const TRACE_LEN = 220;        // points in the scrolling waveform
  const TRACE_X0 = -2;          // where the waveform begins
  const TRACE_W = 22;           // width the waveform spans to the right

  // odd harmonics: amplitude 1/(2k-1), angular freq (2k-1)
  const amps: number[] = [];
  const freqs: number[] = [];
  let ampSum = 0;
  for (let k = 1; k <= HARMONICS; k++) {
    const n = 2 * k - 1;
    amps.push(1 / n);
    freqs.push(n);
    ampSum += 1 / n;
  }
  const SCALE = 7 / ampSum; // normalize overall radius

  const group = new THREE.Group();
  scene.add(group);

  // ---- circles (epicycle outlines) ----
  const RING_SEG = 64;
  const circleColors: THREE.Color[] = [];
  for (let h = 0; h < HARMONICS; h++) {
    circleColors.push(mixColor(PALETTE.cyan, PALETTE.violet, h / (HARMONICS - 1)));
  }
  // one BufferGeometry per circle so we can translate them each frame
  const circles: THREE.LineLoop[] = [];
  for (let h = 0; h < HARMONICS; h++) {
    const r = amps[h] * SCALE;
    const pts: number[] = [];
    for (let s = 0; s < RING_SEG; s++) {
      const a = (s / RING_SEG) * Math.PI * 2;
      pts.push(Math.cos(a) * r, Math.sin(a) * r, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({
      color: circleColors[h], transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const loop = new THREE.LineLoop(g, m);
    circles.push(loop);
    group.add(loop);
  }

  // ---- radius arms (phasor vectors), drawn as one LineSegments ----
  const armPos = new Float32Array(HARMONICS * 6);
  const armCol = new Float32Array(HARMONICS * 6);
  for (let h = 0; h < HARMONICS; h++) {
    const c = circleColors[h];
    for (let s = 0; s < 2; s++) {
      armCol[h * 6 + s * 3] = c.r;
      armCol[h * 6 + s * 3 + 1] = c.g;
      armCol[h * 6 + s * 3 + 2] = c.b;
    }
  }
  const armGeo = new THREE.BufferGeometry();
  armGeo.setAttribute('position', new THREE.BufferAttribute(armPos, 3).setUsage(THREE.DynamicDrawUsage));
  armGeo.setAttribute('color', new THREE.BufferAttribute(armCol, 3));
  const armMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.LineSegments(armGeo, armMat));

  // tip marker
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 12, 12),
    new THREE.MeshBasicMaterial({ color: PALETTE.amber }),
  );
  group.add(tip);

  // connector from tip to the start of the waveform
  const connGeo = new THREE.BufferGeometry();
  connGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)
    .setUsage(THREE.DynamicDrawUsage));
  const connMat = new THREE.LineBasicMaterial({
    color: PALETTE.amber, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.Line(connGeo, connMat));

  // ---- scrolling waveform trace ----
  const tracePos = new Float32Array(TRACE_LEN * 3);
  const traceCol = new Float32Array(TRACE_LEN * 3);
  const traceY = new Float32Array(TRACE_LEN);
  for (let i = 0; i < TRACE_LEN; i++) {
    tracePos[i * 3] = TRACE_X0 + (i / (TRACE_LEN - 1)) * TRACE_W;
  }
  const cWave = new THREE.Color(PALETTE.amber);
  const traceGeo = new THREE.BufferGeometry();
  traceGeo.setAttribute('position', new THREE.BufferAttribute(tracePos, 3).setUsage(THREE.DynamicDrawUsage));
  traceGeo.setAttribute('color', new THREE.BufferAttribute(traceCol, 3).setUsage(THREE.DynamicDrawUsage));
  const traceMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.Line(traceGeo, traceMat));

  const SPEED = 1.3; // base angular speed

  onFrame((t, dt) => {
    // accumulate phasors from CX outward
    let x = CX, y = 0;
    const ang = t * SPEED;
    for (let h = 0; h < HARMONICS; h++) {
      const r = amps[h] * SCALE;
      // center the circle on the current tip
      circles[h].position.set(x, y, 0);
      const px = x, py = y;
      x += Math.cos(ang * freqs[h]) * r;
      y += Math.sin(ang * freqs[h]) * r;
      armPos[h * 6] = px; armPos[h * 6 + 1] = py; armPos[h * 6 + 2] = 0;
      armPos[h * 6 + 3] = x; armPos[h * 6 + 4] = y; armPos[h * 6 + 5] = 0;
    }
    armGeo.attributes.position.needsUpdate = true;
    tip.position.set(x, y, 0);

    // scroll trace: shift down, insert newest tip-y at the front (x = TRACE_X0)
    traceY.copyWithin(1, 0);
    traceY[0] = y;
    for (let i = 0; i < TRACE_LEN; i++) {
      tracePos[i * 3 + 1] = traceY[i];
      const f = 1 - i / (TRACE_LEN - 1); // bright at the head
      traceCol[i * 3] = cWave.r * f;
      traceCol[i * 3 + 1] = cWave.g * f;
      traceCol[i * 3 + 2] = cWave.b * f;
    }
    traceGeo.attributes.position.needsUpdate = true;
    traceGeo.attributes.color.needsUpdate = true;

    // connector tip -> trace head
    const cp = connGeo.attributes.position.array as Float32Array;
    cp[0] = x; cp[1] = y; cp[2] = 0;
    cp[3] = TRACE_X0; cp[4] = traceY[0]; cp[5] = 0;
    connGeo.attributes.position.needsUpdate = true;

    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, ctx.pointer.x * 0.12, 0.05);
    group.position.y = THREE.MathUtils.lerp(group.position.y, ctx.pointer.y * 1.5, 0.05);
  });

  onDispose(() => {
    circles.forEach((c) => { c.geometry.dispose(); (c.material as THREE.Material).dispose(); });
    armGeo.dispose(); armMat.dispose();
    tip.geometry.dispose(); (tip.material as THREE.Material).dispose();
    connGeo.dispose(); connMat.dispose();
    traceGeo.dispose(); traceMat.dispose();
  });
}
