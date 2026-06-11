/**
 * Fourier — synthesis of a wave from rotating phasors (epicycles), rendered with
 * Rembrandt-level density.
 *
 * A long chain of circles, each spinning at an odd harmonic with 1/n amplitude
 * (the Fourier series of a square wave), is chained tip-to-tip. Every joint glows;
 * faint guide rings and radius arms show the construction. The final tip traces
 * the resulting waveform, which scrolls to the right as a bright glowing trail
 * over a faint scope baseline, visibly approximating the dashed reference SQUARE
 * wave behind it — sum of sines, the math under signals and music alike.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, mixColor, prefersReducedMotion } from './core';

export function fourier(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;
  const reduced = prefersReducedMotion();

  camera.position.set(0, 0, 30);
  camera.lookAt(0, 0, 0);

  const HARMONICS = ctx.width < 760 ? 9 : 14;  // number of phasors (sharper square)
  const CX = -11;               // x-center of the epicycle stack
  const TRACE_LEN = ctx.width < 760 ? 200 : 320; // points in the scrolling waveform
  const TRACE_X0 = -3;          // where the waveform begins
  const TRACE_W = 24;           // width the waveform spans to the right

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
  const AMP_SQUARE = SCALE * (Math.PI / 4); // ideal square amplitude for this series

  const group = new THREE.Group();
  scene.add(group);

  const circleColors: THREE.Color[] = [];
  for (let h = 0; h < HARMONICS; h++) {
    circleColors.push(mixColor(PALETTE.cyan, PALETTE.violet, h / (HARMONICS - 1)));
  }

  // ---- faint scope baseline + amplitude guide rails ------------------------
  {
    const baseGeo = new THREE.BufferGeometry();
    baseGeo.setAttribute('position', new THREE.Float32BufferAttribute(
      [TRACE_X0, 0, -0.6, TRACE_X0 + TRACE_W, 0, -0.6], 3));
    group.add(new THREE.Line(baseGeo, new THREE.LineBasicMaterial({
      color: PALETTE.blue, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false,
    })));
    // amplitude guide rails (±square amplitude)
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      TRACE_X0, AMP_SQUARE, -0.6, TRACE_X0 + TRACE_W, AMP_SQUARE, -0.6,
      TRACE_X0, -AMP_SQUARE, -0.6, TRACE_X0 + TRACE_W, -AMP_SQUARE, -0.6,
    ], 3));
    group.add(new THREE.LineSegments(railGeo, new THREE.LineBasicMaterial({
      color: PALETTE.violet, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false,
    })));
  }

  // ---- a faded dashed reference square that scrolls with the trace ---------
  const refPos = new Float32Array(TRACE_LEN * 3);
  for (let i = 0; i < TRACE_LEN; i++) refPos[i * 3] = TRACE_X0 + (i / (TRACE_LEN - 1)) * TRACE_W;
  const refGeo = new THREE.BufferGeometry();
  refGeo.setAttribute('position', new THREE.BufferAttribute(refPos, 3).setUsage(THREE.DynamicDrawUsage));
  const refLine = new THREE.Line(refGeo, new THREE.LineBasicMaterial({
    color: PALETTE.violet, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(refLine);
  const refY = new Float32Array(TRACE_LEN);

  // ---- circles (epicycle outlines) ----------------------------------------
  const RING_SEG = 72;
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
    // higher harmonics a bit fainter, but keep them clearly visible
    const op = 0.5 * (0.55 + 0.45 * (amps[h] / amps[0]));
    const m = new THREE.LineBasicMaterial({
      color: circleColors[h], transparent: true, opacity: op,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const loop = new THREE.LineLoop(g, m);
    circles.push(loop);
    group.add(loop);
  }

  // ---- radius arms (phasor vectors), one LineSegments ----------------------
  const armPos = new Float32Array(HARMONICS * 6);
  const armCol = new Float32Array(HARMONICS * 6);
  for (let h = 0; h < HARMONICS; h++) {
    const c = circleColors[h];
    for (let s = 0; s < 2; s++) {
      armCol[h * 6 + s * 3] = c.r; armCol[h * 6 + s * 3 + 1] = c.g; armCol[h * 6 + s * 3 + 2] = c.b;
    }
  }
  const armGeo = new THREE.BufferGeometry();
  armGeo.setAttribute('position', new THREE.BufferAttribute(armPos, 3).setUsage(THREE.DynamicDrawUsage));
  armGeo.setAttribute('color', new THREE.BufferAttribute(armCol, 3));
  const armMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.LineSegments(armGeo, armMat));

  // ---- glowing joint dots (one Points cloud at every phasor pivot) ---------
  const jointPos = new Float32Array((HARMONICS + 1) * 3);
  const jointCol = new Float32Array((HARMONICS + 1) * 3);
  const jointScale = new Float32Array(HARMONICS + 1);
  for (let h = 0; h <= HARMONICS; h++) {
    const c = h < HARMONICS ? circleColors[h] : new THREE.Color(PALETTE.amber);
    jointCol[h * 3] = c.r; jointCol[h * 3 + 1] = c.g; jointCol[h * 3 + 2] = c.b;
    jointScale[h] = h === 0 ? 2.4 : (h === HARMONICS ? 3.2 : 1.6);
  }
  const jointGeo = new THREE.BufferGeometry();
  jointGeo.setAttribute('position', new THREE.BufferAttribute(jointPos, 3).setUsage(THREE.DynamicDrawUsage));
  jointGeo.setAttribute('aColor', new THREE.BufferAttribute(jointCol, 3));
  jointGeo.setAttribute('aScale', new THREE.BufferAttribute(jointScale, 1));
  const jointMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aScale; attribute vec3 aColor; varying vec3 vColor;
      void main() { vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aScale * (90.0 / -mv.z);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() { float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor, a); }`,
  });
  group.add(new THREE.Points(jointGeo, jointMat));

  // tip marker (bright sphere + halo)
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 14),
    new THREE.MeshBasicMaterial({ color: PALETTE.amber }));
  const tipHalo = new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 14),
    new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
  tip.add(tipHalo);
  group.add(tip);

  // connector from tip to the start of the waveform
  const connGeo = new THREE.BufferGeometry();
  connGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3).setUsage(THREE.DynamicDrawUsage));
  const conn = new THREE.Line(connGeo, new THREE.LineBasicMaterial({
    color: PALETTE.amber, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(conn);

  // ---- scrolling waveform trace (bright head, fading tail = "persisting") --
  const tracePos = new Float32Array(TRACE_LEN * 3);
  const traceCol = new Float32Array(TRACE_LEN * 3);
  const traceY = new Float32Array(TRACE_LEN);
  for (let i = 0; i < TRACE_LEN; i++) tracePos[i * 3] = TRACE_X0 + (i / (TRACE_LEN - 1)) * TRACE_W;
  const cWave = new THREE.Color(PALETTE.amber);
  const cWaveTail = new THREE.Color(PALETTE.cyan);
  const traceGeo = new THREE.BufferGeometry();
  traceGeo.setAttribute('position', new THREE.BufferAttribute(tracePos, 3).setUsage(THREE.DynamicDrawUsage));
  traceGeo.setAttribute('color', new THREE.BufferAttribute(traceCol, 3).setUsage(THREE.DynamicDrawUsage));
  const trace = new THREE.Line(traceGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.98, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(trace);

  const SPEED = 1.3; // base angular speed
  const tmpCol = new THREE.Color();

  // square wave reference value at a given accumulated phase
  const squareAt = (ph: number) => (Math.sin(ph) >= 0 ? AMP_SQUARE : -AMP_SQUARE);

  const update = (t: number, dt: number) => {
    let x = CX, y = 0;
    const ang = t * SPEED;
    jointPos[0] = x; jointPos[1] = y; jointPos[2] = 0;
    for (let h = 0; h < HARMONICS; h++) {
      const r = amps[h] * SCALE;
      circles[h].position.set(x, y, 0);
      const px = x, py = y;
      x += Math.cos(ang * freqs[h]) * r;
      y += Math.sin(ang * freqs[h]) * r;
      armPos[h * 6] = px; armPos[h * 6 + 1] = py; armPos[h * 6 + 2] = 0;
      armPos[h * 6 + 3] = x; armPos[h * 6 + 4] = y; armPos[h * 6 + 5] = 0;
      jointPos[(h + 1) * 3] = x; jointPos[(h + 1) * 3 + 1] = y; jointPos[(h + 1) * 3 + 2] = 0;
    }
    armGeo.attributes.position.needsUpdate = true;
    jointGeo.attributes.position.needsUpdate = true;
    tip.position.set(x, y, 0);
    tipHalo.scale.setScalar(1 + 0.25 * Math.sin(t * 3));

    // scroll trace + reference square: shift, insert newest at the head
    traceY.copyWithin(1, 0);
    traceY[0] = y;
    refY.copyWithin(1, 0);
    refY[0] = squareAt(ang); // fundamental phase drives the reference
    for (let i = 0; i < TRACE_LEN; i++) {
      tracePos[i * 3 + 1] = traceY[i];
      refPos[i * 3 + 1] = refY[i];
      const f = 1 - i / (TRACE_LEN - 1); // bright at the head, fades down the tail
      tmpCol.copy(cWave).lerp(cWaveTail, 1 - f); // head amber -> tail cyan
      const glow = 0.18 + 0.82 * f;
      traceCol[i * 3] = tmpCol.r * glow;
      traceCol[i * 3 + 1] = tmpCol.g * glow;
      traceCol[i * 3 + 2] = tmpCol.b * glow;
    }
    traceGeo.attributes.position.needsUpdate = true;
    traceGeo.attributes.color.needsUpdate = true;
    refGeo.attributes.position.needsUpdate = true;

    // connector tip -> trace head
    const cp = connGeo.attributes.position.array as Float32Array;
    cp[0] = x; cp[1] = y; cp[2] = 0;
    cp[3] = TRACE_X0; cp[4] = traceY[0]; cp[5] = 0;
    connGeo.attributes.position.needsUpdate = true;

    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, ctx.pointer.x * 0.12, 0.05);
    group.position.y = THREE.MathUtils.lerp(group.position.y, ctx.pointer.y * 1.5, 0.05);
  };

  // pre-fill the trace with a synthesized waveform so the square shape reads
  // immediately, instead of scrolling in from a flat line over several seconds.
  const primeTrace = (dir: number) => {
    for (let i = 0; i < TRACE_LEN; i++) {
      const ang = i * 0.06 * dir; // step backward in phase along the tail
      let yy = 0;
      for (let h = 0; h < HARMONICS; h++) yy += Math.sin(-ang * freqs[h]) * amps[h] * SCALE;
      traceY[i] = yy;
      refY[i] = squareAt(-ang);
    }
  };

  if (reduced) {
    primeTrace(1);
    update(0, 0);
  } else {
    primeTrace(SPEED); // match the running phase rate so the seam is smooth
    onFrame((t, dt) => update(t, dt));
  }

  onDispose(() => {
    circles.forEach((c) => { c.geometry.dispose(); (c.material as THREE.Material).dispose(); });
    armGeo.dispose(); armMat.dispose();
    jointGeo.dispose(); jointMat.dispose();
    tip.geometry.dispose(); (tip.material as THREE.Material).dispose();
    tipHalo.geometry.dispose(); (tipHalo.material as THREE.Material).dispose();
    connGeo.dispose(); (conn.material as THREE.Material).dispose();
    traceGeo.dispose(); (trace.material as THREE.Material).dispose();
    refGeo.dispose(); (refLine.material as THREE.Material).dispose();
    group.traverse((o) => {
      const ls = o as THREE.LineSegments;
      if (ls.isLineSegments || (o as THREE.Line).isLine) {
        ls.geometry?.dispose?.(); (ls.material as THREE.Material)?.dispose?.();
      }
    });
  });
}
