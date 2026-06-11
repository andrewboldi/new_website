/**
 * StatMech — a realistic ideal-gas box. Many particles, colored by speed (a live
 * Maxwell–Boltzmann distribution: cool/slow → blue, hot/fast → amber), bounce off
 * the container walls AND off each other via an O(N) spatial-hash elastic
 * collision solver. The box has visible glassy walls + glowing edges. Below it,
 * a live HISTOGRAM of the speed distribution builds up frame by frame, its bars
 * relaxing toward the analytic Maxwell–Boltzmann curve drawn over them. Kinetic
 * theory and statistical mechanics, the physical-chemistry way.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, prefersReducedMotion } from './core';

export function statMech(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;
  const reduced = prefersReducedMotion();

  camera.position.set(0, 2, 44);
  camera.lookAt(0, 1, 0);

  const mobile = ctx.width < 760;
  const N = mobile ? 520 : 1000;
  const B = 15;            // half box size
  const RAD = 0.42;        // particle collision radius
  const D = RAD * 2;
  const D2 = D * D;

  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const scales = new Float32Array(N);
  const vel = new Float32Array(N * 3);

  // Maxwell–Boltzmann velocities ≈ Gaussian per component (Box–Muller)
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const SPEED = 6.5;
  for (let i = 0; i < N; i++) {
    positions[i * 3] = (Math.random() * 2 - 1) * (B - RAD);
    positions[i * 3 + 1] = (Math.random() * 2 - 1) * (B - RAD);
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * (B - RAD);
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
        float a = smoothstep(0.5, 0.06, d);
        // tiny hot core
        a += smoothstep(0.18, 0.0, d) * 0.6;
        gl_FragColor = vec4(vColor, a); }`,
  });
  const gasGroup = new THREE.Group(); // rotates
  gasGroup.add(new THREE.Points(geo, mat));

  // ---- container: glassy walls + bright edges ------------------------------
  const boxGeom = new THREE.BoxGeometry(B * 2, B * 2, B * 2);
  const walls = new THREE.Mesh(boxGeom, new THREE.MeshBasicMaterial({
    color: PALETTE.blue, transparent: true, opacity: 0.04,
    side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  gasGroup.add(walls);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeom),
    new THREE.LineBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  gasGroup.add(edges);
  // corner nodes for a built look
  const cornerGeo = new THREE.BufferGeometry();
  {
    const cp: number[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) cp.push(sx * B, sy * B, sz * B);
    cornerGeo.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  }
  const corners = new THREE.Points(cornerGeo, new THREE.PointsMaterial({
    color: PALETTE.white, size: 5, sizeAttenuation: false, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  gasGroup.add(corners);

  gasGroup.position.y = 4; // lift box so the histogram sits below
  scene.add(gasGroup);

  // ---- speed -> color ramp -------------------------------------------------
  const cSlow = new THREE.Color(PALETTE.blue);
  const cMid = new THREE.Color(PALETTE.cyan);
  const cFast = new THREE.Color(PALETTE.amber);
  const tmp = new THREE.Color();
  const VMAX = SPEED * 3.2;        // speed scale for color + histogram x-axis

  // ---- spatial hash grid for O(N) collisions -------------------------------
  const CELL = D;                  // cell size = collision diameter
  const GRID = Math.max(1, Math.floor((2 * B) / CELL));
  const GRID3 = GRID * GRID * GRID;
  const cellHead = new Int32Array(GRID3).fill(-1);
  const nextIdx = new Int32Array(N).fill(-1);
  const cellOf = (p: number) => {
    let c = Math.floor((p + B) / CELL);
    if (c < 0) c = 0; else if (c >= GRID) c = GRID - 1;
    return c;
  };

  // ---- live speed histogram (instrument panel below the box) ---------------
  const BINS = mobile ? 22 : 30;
  const counts = new Float32Array(BINS);   // smoothed bar heights (display)
  const raw = new Float32Array(BINS);      // instantaneous counts
  const HW = 26;                            // panel width
  const HH = 9;                             // panel max height
  const HY = -16.5;                         // panel baseline y
  const barW = (HW / BINS) * 0.82;
  // one merged geometry: BINS quads (2 tris each) we restretch each frame in Y
  const histPos = new Float32Array(BINS * 6 * 3);  // 6 verts per bar
  const histCol = new Float32Array(BINS * 6 * 3);
  const histGeo = new THREE.BufferGeometry();
  histGeo.setAttribute('position', new THREE.BufferAttribute(histPos, 3).setUsage(THREE.DynamicDrawUsage));
  histGeo.setAttribute('color', new THREE.BufferAttribute(histCol, 3).setUsage(THREE.DynamicDrawUsage));
  const histMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const histPanel = new THREE.Group(); // does NOT rotate
  histPanel.add(new THREE.Mesh(histGeo, histMat));

  // bar top outlines for crisp edges
  const barEdgePos = new Float32Array(BINS * 6); // 2 verts per bar top, 3 comps
  const barEdgeGeo = new THREE.BufferGeometry();
  barEdgeGeo.setAttribute('position', new THREE.BufferAttribute(barEdgePos, 3).setUsage(THREE.DynamicDrawUsage));
  histPanel.add(new THREE.LineSegments(barEdgeGeo, new THREE.LineBasicMaterial({
    color: PALETTE.white, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
  })));

  // bar colors (fixed by bin -> speed)
  for (let b = 0; b < BINS; b++) {
    const f = b / (BINS - 1);
    if (f < 0.5) tmp.copy(cSlow).lerp(cMid, f * 2); else tmp.copy(cMid).lerp(cFast, (f - 0.5) * 2);
    for (let v = 0; v < 6; v++) {
      histCol[(b * 6 + v) * 3] = tmp.r; histCol[(b * 6 + v) * 3 + 1] = tmp.g; histCol[(b * 6 + v) * 3 + 2] = tmp.b;
    }
  }

  // analytic Maxwell–Boltzmann speed curve overlaid on the histogram
  const MB_SEG = 120;
  const mbPos = new Float32Array(MB_SEG * 3);
  const mbGeo = new THREE.BufferGeometry();
  mbGeo.setAttribute('position', new THREE.BufferAttribute(mbPos, 3));
  // f(v) ∝ v^2 exp(-v^2 / (2σ^2)); find its peak to normalize to panel height
  const sigma = SPEED;
  const mbAt = (v: number) => (v * v) * Math.exp(-(v * v) / (2 * sigma * sigma));
  const vPeak = Math.SQRT2 * sigma;          // mode of the distribution
  const mbPeak = mbAt(vPeak);
  for (let i = 0; i < MB_SEG; i++) {
    const v = (i / (MB_SEG - 1)) * VMAX;
    const x = -HW / 2 + (v / VMAX) * HW;
    const y = HY + (mbAt(v) / mbPeak) * HH * 0.96;
    mbPos[i * 3] = x; mbPos[i * 3 + 1] = y; mbPos[i * 3 + 2] = 0;
  }
  mbGeo.setAttribute('position', new THREE.BufferAttribute(mbPos, 3));
  const mbLine = new THREE.Line(mbGeo, new THREE.LineBasicMaterial({
    color: PALETTE.amber, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  histPanel.add(mbLine);

  // baseline axis + a few ticks under the histogram
  {
    const ax: number[] = [-HW / 2, HY, 0, HW / 2, HY, 0];
    for (let k = 0; k <= 5; k++) {
      const x = -HW / 2 + (k / 5) * HW;
      ax.push(x, HY, 0, x, HY - 0.7, 0);
    }
    const axGeo = new THREE.BufferGeometry();
    axGeo.setAttribute('position', new THREE.Float32BufferAttribute(ax, 3));
    histPanel.add(new THREE.LineSegments(axGeo, new THREE.LineBasicMaterial({
      color: PALETTE.blue, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false,
    })));
  }
  scene.add(histPanel);

  // write one bar's 6 vertices given height h (in panel units)
  const setBar = (b: number, h: number) => {
    const x0 = -HW / 2 + (b + 0.5) * (HW / BINS) - barW / 2;
    const x1 = x0 + barW;
    const y0 = HY, y1 = HY + h;
    const o = b * 18;
    // tri 1
    histPos[o] = x0; histPos[o + 1] = y0; histPos[o + 2] = 0;
    histPos[o + 3] = x1; histPos[o + 4] = y0; histPos[o + 5] = 0;
    histPos[o + 6] = x1; histPos[o + 7] = y1; histPos[o + 8] = 0;
    // tri 2
    histPos[o + 9] = x0; histPos[o + 10] = y0; histPos[o + 11] = 0;
    histPos[o + 12] = x1; histPos[o + 13] = y1; histPos[o + 14] = 0;
    histPos[o + 15] = x0; histPos[o + 16] = y1; histPos[o + 17] = 0;
    // top edge
    barEdgePos[b * 6] = x0; barEdgePos[b * 6 + 1] = y1; barEdgePos[b * 6 + 2] = 0;
    barEdgePos[b * 6 + 3] = x1; barEdgePos[b * 6 + 4] = y1; barEdgePos[b * 6 + 5] = 0;
  };

  let histClock = 0;

  const stepPhysics = (step: number) => {
    // integrate + wall bounce
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      for (let a = 0; a < 3; a++) {
        let p = positions[i3 + a] + vel[i3 + a] * step;
        const lim = B - RAD;
        if (p > lim) { p = lim; vel[i3 + a] = -Math.abs(vel[i3 + a]); }
        else if (p < -lim) { p = -lim; vel[i3 + a] = Math.abs(vel[i3 + a]); }
        positions[i3 + a] = p;
      }
    }
    // rebuild spatial hash
    cellHead.fill(-1);
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      const cx = cellOf(positions[i3]), cy = cellOf(positions[i3 + 1]), cz = cellOf(positions[i3 + 2]);
      const c = (cx * GRID + cy) * GRID + cz;
      nextIdx[i] = cellHead[c];
      cellHead[c] = i;
    }
    // pairwise collisions within 27-neighborhood
    for (let cx = 0; cx < GRID; cx++) {
      for (let cy = 0; cy < GRID; cy++) {
        for (let cz = 0; cz < GRID; cz++) {
          let i = cellHead[(cx * GRID + cy) * GRID + cz];
          while (i !== -1) {
            const i3 = i * 3;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cx + dx; if (nx < 0 || nx >= GRID) continue;
              for (let dy = -1; dy <= 1; dy++) {
                const ny = cy + dy; if (ny < 0 || ny >= GRID) continue;
                for (let dz = -1; dz <= 1; dz++) {
                  const nz = cz + dz; if (nz < 0 || nz >= GRID) continue;
                  let j = cellHead[(nx * GRID + ny) * GRID + nz];
                  while (j !== -1) {
                    if (j > i) { // each pair once
                      const j3 = j * 3;
                      const rx = positions[j3] - positions[i3];
                      const ry = positions[j3 + 1] - positions[i3 + 1];
                      const rz = positions[j3 + 2] - positions[i3 + 2];
                      const dist2 = rx * rx + ry * ry + rz * rz;
                      if (dist2 < D2 && dist2 > 1e-6) {
                        const dist = Math.sqrt(dist2);
                        const nxn = rx / dist, nyn = ry / dist, nzn = rz / dist;
                        // relative velocity along normal
                        const dvx = vel[j3] - vel[i3];
                        const dvy = vel[j3 + 1] - vel[i3 + 1];
                        const dvz = vel[j3 + 2] - vel[i3 + 2];
                        const vn = dvx * nxn + dvy * nyn + dvz * nzn;
                        if (vn < 0) { // approaching: equal-mass elastic exchange of normal component
                          vel[i3] += vn * nxn; vel[i3 + 1] += vn * nyn; vel[i3 + 2] += vn * nzn;
                          vel[j3] -= vn * nxn; vel[j3 + 1] -= vn * nyn; vel[j3 + 2] -= vn * nzn;
                        }
                        // positional de-overlap so they don't stick
                        const push = (D - dist) * 0.5;
                        positions[i3] -= nxn * push; positions[i3 + 1] -= nyn * push; positions[i3 + 2] -= nzn * push;
                        positions[j3] += nxn * push; positions[j3 + 1] += nyn * push; positions[j3 + 2] += nzn * push;
                      }
                    }
                    j = nextIdx[j];
                  }
                }
              }
            }
            i = nextIdx[i];
          }
        }
      }
    }
  };

  const shade = () => {
    raw.fill(0);
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      const speed = Math.hypot(vel[i3], vel[i3 + 1], vel[i3 + 2]);
      const f = Math.min(1, speed / VMAX);
      if (f < 0.5) tmp.copy(cSlow).lerp(cMid, f * 2); else tmp.copy(cMid).lerp(cFast, (f - 0.5) * 2);
      colors[i3] = tmp.r; colors[i3 + 1] = tmp.g; colors[i3 + 2] = tmp.b;
      scales[i] = 1.1 + f * 1.6;
      let b = Math.floor(f * BINS); if (b >= BINS) b = BINS - 1;
      raw[b] += 1;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aScale.needsUpdate = true;
  };

  // normalize histogram so its mode matches the M–B curve height visually
  const drawHistogram = (alpha: number) => {
    // find current max for scaling
    let maxC = 1;
    for (let b = 0; b < BINS; b++) { counts[b] += (raw[b] - counts[b]) * alpha; if (counts[b] > maxC) maxC = counts[b]; }
    const scaleY = (HH * 0.96) / maxC;
    for (let b = 0; b < BINS; b++) setBar(b, counts[b] * scaleY);
    histGeo.attributes.position.needsUpdate = true;
    barEdgeGeo.attributes.position.needsUpdate = true;
  };

  const update = (t: number, dt: number) => {
    const step = Math.min(dt, 0.033);
    stepPhysics(step);
    shade();
    histClock += dt;
    if (histClock > 0.06) { drawHistogram(0.12); histClock = 0; }

    gasGroup.rotation.y += dt * 0.1;
    gasGroup.rotation.x = THREE.MathUtils.lerp(gasGroup.rotation.x, -0.18 + ctx.pointer.y * 0.28, 0.05);
  };

  if (reduced) {
    // settle the distribution with a few synchronous steps for a rich static frame
    for (let s = 0; s < 90; s++) stepPhysics(0.02);
    shade();
    for (let b = 0; b < BINS; b++) counts[b] = raw[b];
    drawHistogram(1.0);
    gasGroup.rotation.set(-0.18, 0.5, 0);
  } else {
    onFrame((t, dt) => update(t, dt));
  }

  onDispose(() => {
    geo.dispose(); mat.dispose();
    boxGeom.dispose(); (walls.material as THREE.Material).dispose();
    edges.geometry.dispose(); (edges.material as THREE.Material).dispose();
    cornerGeo.dispose(); (corners.material as THREE.Material).dispose();
    histGeo.dispose(); histMat.dispose();
    barEdgeGeo.dispose();
    mbGeo.dispose(); (mbLine.material as THREE.Material).dispose();
  });
}
