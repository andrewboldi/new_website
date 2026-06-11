/**
 * Signal — an oscilloscope. A band of points repeatedly resolves from noise into
 * a clean travelling wave and dissolves back, traced by a bright "beam" polyline
 * riding over a faint scope GRATICULE with axis ticks and a sweeping scan dot.
 * Beside it, a small live frequency SPECTRUM (a running DFT of the current trace)
 * shows the noise floor collapsing into a few clean harmonic peaks as the signal
 * resolves. Literally signal over noise, for the essay of the same name.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, prefersReducedMotion } from './core';

export function signal(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;
  const reduced = prefersReducedMotion();

  camera.position.set(0, 0, 30);

  const mobile = ctx.width < 760;
  const N = mobile ? 900 : 1700;
  const W = 46, A = 7;
  const HX = W / 2;          // scope half-width
  const HY = 11;             // scope half-height

  const group = new THREE.Group();
  scene.add(group);

  // ---- oscilloscope graticule (faint grid + bright center axes + ticks) ----
  {
    const minor: number[] = [];
    const DIVX = 10, DIVY = 6;
    for (let i = 0; i <= DIVX; i++) {
      const x = -HX + (i / DIVX) * W;
      minor.push(x, -HY, -0.5, x, HY, -0.5);
    }
    for (let j = 0; j <= DIVY; j++) {
      const y = -HY + (j / DIVY) * (HY * 2);
      minor.push(-HX, y, -0.5, HX, y, -0.5);
    }
    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.Float32BufferAttribute(minor, 3));
    group.add(new THREE.LineSegments(gGeo, new THREE.LineBasicMaterial({
      color: PALETTE.blue, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false,
    })));

    // center cross-hair axes, brighter, with fine tick marks
    const axis: number[] = [-HX, 0, -0.4, HX, 0, -0.4, 0, -HY, -0.4, 0, HY, -0.4];
    const tick = 0.35;
    for (let i = 0; i <= DIVX * 5; i++) {
      const x = -HX + (i / (DIVX * 5)) * W;
      axis.push(x, -tick, -0.4, x, tick, -0.4);
    }
    for (let j = 0; j <= DIVY * 5; j++) {
      const y = -HY + (j / (DIVY * 5)) * (HY * 2);
      axis.push(-tick, y, -0.4, tick, y, -0.4);
    }
    const aGeo = new THREE.BufferGeometry();
    aGeo.setAttribute('position', new THREE.Float32BufferAttribute(axis, 3));
    group.add(new THREE.LineSegments(aGeo, new THREE.LineBasicMaterial({
      color: PALETTE.cyan, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false,
    })));

    // outer bezel frame
    const f = HX, g = HY;
    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.Float32BufferAttribute(
      [-f, -g, -0.4, f, -g, -0.4, f, g, -0.4, -f, g, -0.4, -f, -g, -0.4], 3));
    group.add(new THREE.Line(frameGeo, new THREE.LineBasicMaterial({
      color: PALETTE.blue, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false,
    })));
  }

  // ---- the noisy point band ------------------------------------------------
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
        gl_FragColor = vec4(vColor, smoothstep(0.5, 0.1, d)); }`,
  });
  group.add(new THREE.Points(geo, mat));

  // ---- bright resolved "beam" polyline over the cloud ----------------------
  const BEAM = mobile ? 220 : 360;
  const beamPos = new Float32Array(BEAM * 3);
  const beamCol = new Float32Array(BEAM * 3);
  for (let i = 0; i < BEAM; i++) beamPos[i * 3] = -HX + (i / (BEAM - 1)) * W;
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPos, 3).setUsage(THREE.DynamicDrawUsage));
  beamGeo.setAttribute('color', new THREE.BufferAttribute(beamCol, 3).setUsage(THREE.DynamicDrawUsage));
  const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(beam);

  // sweeping scan dot that rides the beam
  const scan = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 12),
    new THREE.MeshBasicMaterial({ color: PALETTE.white }));
  group.add(scan);

  // ---- live frequency spectrum readout (running DFT) -----------------------
  const KBINS = mobile ? 26 : 36;     // spectrum bins
  const MSAMP = 128;                  // samples fed to the DFT
  const specRaw = new Float32Array(KBINS);
  const specDisp = new Float32Array(KBINS);
  const sampBuf = new Float32Array(MSAMP);
  // precompute DFT twiddle factors (cos/sin) : [k][m]
  const cosT = new Float32Array(KBINS * MSAMP);
  const sinT = new Float32Array(KBINS * MSAMP);
  for (let k = 0; k < KBINS; k++) {
    for (let m = 0; m < MSAMP; m++) {
      const ang = (2 * Math.PI * k * m) / MSAMP;
      cosT[k * MSAMP + m] = Math.cos(ang);
      sinT[k * MSAMP + m] = Math.sin(ang);
    }
  }
  // spectrum panel placement (top-left inside the scope)
  const SPW = 16, SPH = 6.5;
  const SPX = -HX + 1.0;            // left edge
  const SPY = HY - SPH - 0.8;       // bottom edge
  const sbW = (SPW / KBINS) * 0.8;
  const specPos = new Float32Array(KBINS * 6 * 3);
  const specCol = new Float32Array(KBINS * 6 * 3);
  const specGeo = new THREE.BufferGeometry();
  specGeo.setAttribute('position', new THREE.BufferAttribute(specPos, 3).setUsage(THREE.DynamicDrawUsage));
  specGeo.setAttribute('color', new THREE.BufferAttribute(specCol, 3).setUsage(THREE.DynamicDrawUsage));
  const specMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(specGeo, specMat));
  // spectrum frame + baseline
  {
    const fr: number[] = [SPX, SPY, 0, SPX + SPW, SPY, 0, SPX + SPW, SPY + SPH, 0, SPX, SPY + SPH, 0, SPX, SPY, 0];
    const frGeo = new THREE.BufferGeometry();
    frGeo.setAttribute('position', new THREE.Float32BufferAttribute(fr, 3));
    group.add(new THREE.Line(frGeo, new THREE.LineBasicMaterial({
      color: PALETTE.blue, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false,
    })));
  }
  const cSpecLo = new THREE.Color(PALETTE.blue);
  const cSpecHi = new THREE.Color(PALETTE.cyan);
  const tmpC = new THREE.Color();

  const setSpecBar = (b: number, h: number) => {
    const x0 = SPX + (b + 0.5) * (SPW / KBINS) - sbW / 2;
    const x1 = x0 + sbW;
    const y0 = SPY, y1 = SPY + h;
    const o = b * 18;
    specPos[o] = x0; specPos[o + 1] = y0; specPos[o + 2] = 0;
    specPos[o + 3] = x1; specPos[o + 4] = y0; specPos[o + 5] = 0;
    specPos[o + 6] = x1; specPos[o + 7] = y1; specPos[o + 8] = 0;
    specPos[o + 9] = x0; specPos[o + 10] = y0; specPos[o + 11] = 0;
    specPos[o + 12] = x1; specPos[o + 13] = y1; specPos[o + 14] = 0;
    specPos[o + 15] = x0; specPos[o + 16] = y1; specPos[o + 17] = 0;
    const f = b / (KBINS - 1);
    tmpC.copy(cSpecLo).lerp(cSpecHi, f);
    for (let v = 0; v < 6; v++) { specCol[o + v * 3] = tmpC.r; specCol[o + v * 3 + 1] = tmpC.g; specCol[o + v * 3 + 2] = tmpC.b; }
  };

  const cNoise = new THREE.Color(PALETTE.blue).multiplyScalar(0.5);
  const cSignal = new THREE.Color(PALETTE.cyan);
  const cBeam = new THREE.Color(PALETTE.cyan);
  const tmp = new THREE.Color();

  // the clean signal: a fundamental + a couple of harmonics (richer spectrum)
  const sigAt = (x: number, t: number) =>
    (Math.sin(x * 0.4 - t * 2.2)
      + 0.42 * Math.sin(x * 0.8 - t * 4.4 + 0.6)
      + 0.22 * Math.sin(x * 1.2 - t * 6.6 + 1.1)) * A * 0.62;

  let specClock = 0;

  const update = (t: number) => {
    // clarity breathes 0 -> 1 -> 0
    const clarity = 0.5 - 0.5 * Math.cos(t * 0.4);

    // point band
    for (let i = 0; i < N; i++) {
      const x = xs[i];
      const sig = sigAt(x, t);
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

    // resolved beam: the clean signal with a little residual noise, brightening
    for (let i = 0; i < BEAM; i++) {
      const x = beamPos[i * 3];
      const resid = (1 - clarity) * Math.sin(x * 3.1 + t * 9 + i) * 1.4;
      beamPos[i * 3 + 1] = sigAt(x, t) + resid;
      const bb = 0.25 + 0.95 * clarity;
      beamCol[i * 3] = cBeam.r * bb; beamCol[i * 3 + 1] = cBeam.g * bb; beamCol[i * 3 + 2] = cBeam.b * bb;
    }
    beamGeo.attributes.position.needsUpdate = true;
    beamGeo.attributes.color.needsUpdate = true;

    // scan dot rides along the beam
    const sphase = (t * 0.5) % 1;
    const sxi = Math.floor(sphase * (BEAM - 1));
    scan.position.set(beamPos[sxi * 3], beamPos[sxi * 3 + 1], 0.2);
    (scan.material as THREE.MeshBasicMaterial).color.copy(
      tmp.copy(cNoise).lerp(new THREE.Color(PALETTE.white), clarity));

    // ---- running DFT for the spectrum (throttled) ----
    specClock += 1;
    if (specClock >= 2) {
      specClock = 0;
      // sample the beam signal uniformly into sampBuf
      for (let m = 0; m < MSAMP; m++) {
        const x = -HX + (m / (MSAMP - 1)) * W;
        const resid = (1 - clarity) * (Math.sin(x * 3.1 + t * 9 + m) * 0.9 + (Math.random() - 0.5) * 0.8);
        sampBuf[m] = sigAt(x, t) + resid;
      }
      let maxMag = 1e-3;
      for (let k = 0; k < KBINS; k++) {
        let re = 0, im = 0;
        const base = k * MSAMP;
        for (let m = 0; m < MSAMP; m++) {
          const s = sampBuf[m];
          re += s * cosT[base + m];
          im -= s * sinT[base + m];
        }
        const mag = Math.sqrt(re * re + im * im) / MSAMP;
        specRaw[k] = mag;
        if (mag > maxMag) maxMag = mag;
      }
      // normalize + smooth toward display
      for (let k = 0; k < KBINS; k++) {
        const target = (specRaw[k] / maxMag) * SPH * 0.92;
        specDisp[k] += (target - specDisp[k]) * 0.25;
      }
    }
    for (let k = 0; k < KBINS; k++) setSpecBar(k, specDisp[k]);
    specGeo.attributes.position.needsUpdate = true;
    specGeo.attributes.color.needsUpdate = true;

    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, ctx.pointer.x * 0.1, 0.05);
  };

  if (reduced) {
    update(Math.PI / 0.4); // clarity ≈ 1 : a clean resolved frame
  } else {
    onFrame((t) => update(t));
  }

  onDispose(() => {
    geo.dispose(); mat.dispose();
    beamGeo.dispose(); (beam.material as THREE.Material).dispose();
    scan.geometry.dispose(); (scan.material as THREE.Material).dispose();
    specGeo.dispose(); specMat.dispose();
    group.traverse((o) => {
      const ln = o as THREE.Line;
      if ((ln as THREE.Line).isLine || (o as THREE.LineSegments).isLineSegments) {
        ln.geometry?.dispose?.();
        (ln.material as THREE.Material)?.dispose?.();
      }
    });
  });
}
