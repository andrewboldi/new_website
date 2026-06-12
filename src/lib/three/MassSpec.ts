/**
 * MassSpec — a mass spectrum being acquired.
 *
 * A labelled m/z axis (numeric ticks + faint gridlines + a hint of baseline
 * noise) carries a dense stick spectrum: a dozen fragment families, each drawn
 * with its own ISOTOPE envelope (M, M+1, M+2 satellites at the right relative
 * heights), so peaks read as real molecular-ion clusters rather than lone
 * lines. A detector bar sweeps the axis igniting each cluster as it passes; the
 * base peak (tallest) stays crowned, and a small fragmenting-molecule motif in
 * the corner sheds atoms in time with the sweep. LC/MS, GC/MS, LC-TOF — the
 * fingerprint of a molecule.
 *
 * All buffers are preallocated; the frame loop writes into existing typed
 * arrays only (sweep bar, stick heights/colors, motif atoms). Axis labels are
 * baked once into a single canvas texture.
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
  const W = mobile ? 40 : 48;   // width of the m/z axis
  const X0 = -W / 2;
  const FLOOR = -9;             // baseline y
  const MAXH = 17;             // tallest peak height
  const MZ_MAX = 320;          // nominal top of the m/z scale (for labels)

  // ---- fragment families: each a cluster with an isotope envelope ----
  // m: position (0..1 of axis), h: monoisotopic relative intensity,
  // iso: relative heights of [M, M+1, M+2] satellites.
  type Fam = { m: number; h: number; iso: number[] };
  const fams: Fam[] = [
    { m: 0.08, h: 0.28, iso: [1, 0.10] },
    { m: 0.15, h: 0.52, iso: [1, 0.16, 0.03] },
    { m: 0.21, h: 0.20, iso: [1, 0.08] },
    { m: 0.30, h: 0.80, iso: [1, 0.22, 0.05] },
    { m: 0.38, h: 0.40, iso: [1, 0.12] },
    { m: 0.45, h: 1.00, iso: [1, 0.30, 0.07] }, // base peak
    { m: 0.53, h: 0.34, iso: [1, 0.11] },
    { m: 0.61, h: 0.60, iso: [1, 0.18, 0.04] },
    { m: 0.69, h: 0.26, iso: [1, 0.09] },
    { m: 0.78, h: 0.50, iso: [1, 0.15, 0.03] },
    { m: 0.86, h: 0.70, iso: [1, 0.24, 0.06] }, // a heavy fragment cluster
    { m: 0.95, h: 0.46, iso: [1, 0.40, 0.12] }, // molecular-ion cluster (Cl-ish M+2)
  ];
  // base peak index (for the crown)
  let basePeakFam = 0; { let bh = 0; fams.forEach((f, i) => { if (f.h > bh) { bh = f.h; basePeakFam = i; } }); }

  // Flatten families -> individual sticks (M, M+1, M+2). Each stick is a column
  // of points. Preallocate everything.
  const ISO_DX = (1.0 / MZ_MAX) * 1.0; // one Da, in axis-fraction units
  type Stick = { x: number; h: number; famIdx: number; isM: boolean };
  const sticks: Stick[] = [];
  for (let fi = 0; fi < fams.length; fi++) {
    const f = fams[fi];
    for (let s = 0; s < f.iso.length; s++) {
      const mfrac = f.m + s * ISO_DX;
      sticks.push({ x: X0 + mfrac * W, h: f.h * f.iso[s], famIdx: fi, isM: s === 0 });
    }
  }
  const S = sticks.length;
  const PER = mobile ? 22 : 34;       // points per stick
  const N = S * PER;

  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const scales = new Float32Array(N);
  const stickOf = new Uint16Array(N);
  const frac = new Float32Array(N);   // 0 at base, 1 at full height of its stick

  const stickX = new Float32Array(S);
  const stickFamFrac = new Float32Array(S); // family m (for sweep timing)
  for (let s = 0; s < S; s++) { stickX[s] = sticks[s].x; stickFamFrac[s] = fams[sticks[s].famIdx].m; }

  for (let s = 0; s < S; s++) {
    for (let k = 0; k < PER; k++) {
      const i = s * PER + k;
      stickOf[i] = s;
      frac[i] = k / (PER - 1);
      positions[i * 3] = stickX[s];
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

  // ---- baseline axis ----
  const axisGeo = new THREE.BufferGeometry();
  axisGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    [X0 - 1, FLOOR, 0, X0 + W + 1, FLOOR, 0], 3));
  const axisMat = new THREE.LineBasicMaterial({ color: PALETTE.blue, transparent: true, opacity: 0.45 });
  group.add(new THREE.Line(axisGeo, axisMat));

  // ---- ticks + faint horizontal gridlines ----
  const TICKS = 8; // m/z = 0,40,...,320
  const tickPts: number[] = [];
  for (let g = 0; g <= TICKS; g++) {
    const x = X0 + (g / TICKS) * W;
    tickPts.push(x, FLOOR, 0, x, FLOOR - 0.8, 0); // downward tick
  }
  const tickGeo = new THREE.BufferGeometry();
  tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPts, 3));
  // LineSegments (paired vertices) so ticks render as separate marks, not a chain.
  const tickSeg = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({ color: PALETTE.blue, transparent: true, opacity: 0.4 }));
  group.add(tickSeg);

  // intensity gridlines (25/50/75/100%)
  const gridPts: number[] = [];
  for (let g = 1; g <= 4; g++) {
    const y = FLOOR + (g / 4) * MAXH;
    gridPts.push(X0 - 1, y, 0, X0 + W + 1, y, 0);
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
  const gridSeg = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
    color: PALETTE.blue, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(gridSeg);

  // ---- baseline noise (faint static jitter along the axis) ----
  const NOISE = mobile ? 120 : 200;
  const noisePos = new Float32Array(NOISE * 3);
  const noiseBaseY = new Float32Array(NOISE);
  const noisePhase = new Float32Array(NOISE);
  for (let i = 0; i < NOISE; i++) {
    const x = X0 + Math.random() * W;
    noisePos[i * 3] = x;
    noiseBaseY[i] = FLOOR + Math.random() * 0.5;
    noisePos[i * 3 + 1] = noiseBaseY[i];
    noisePos[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
    noisePhase[i] = Math.random() * Math.PI * 2;
  }
  const noiseGeo = new THREE.BufferGeometry();
  noiseGeo.setAttribute('position', new THREE.BufferAttribute(noisePos, 3).setUsage(THREE.DynamicDrawUsage));
  const noiseMat = new THREE.PointsMaterial({
    color: PALETTE.blue, size: 1.2, sizeAttenuation: true,
    transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.Points(noiseGeo, noiseMat));

  // ---- m/z numeric labels baked into one canvas texture ----
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 1024; labelCanvas.height = 128;
  const lctx = labelCanvas.getContext('2d')!;
  lctx.clearRect(0, 0, 1024, 128);
  lctx.fillStyle = 'rgba(150,190,255,0.85)';
  lctx.font = '600 34px ui-sans-serif, system-ui, sans-serif';
  lctx.textAlign = 'center'; lctx.textBaseline = 'middle';
  for (let g = 0; g <= TICKS; g++) {
    const mz = Math.round((g / TICKS) * MZ_MAX);
    const px = (g / TICKS) * 1024;
    lctx.fillText(String(mz), Math.min(1000, Math.max(24, px)), 56);
  }
  // axis caption
  lctx.font = '500 26px ui-sans-serif, system-ui, sans-serif';
  lctx.fillStyle = 'rgba(120,170,255,0.7)';
  lctx.fillText('m / z', 512, 104);
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  labelTex.minFilter = THREE.LinearFilter;
  const labelGeo = new THREE.PlaneGeometry(W + 2, (W + 2) * (128 / 1024));
  const labelMat = new THREE.MeshBasicMaterial({
    map: labelTex, transparent: true, opacity: 0.9, depthWrite: false,
  });
  const labelMesh = new THREE.Mesh(labelGeo, labelMat);
  labelMesh.position.set(0, FLOOR - 2.0, 0);
  group.add(labelMesh);

  // ---- base-peak crown (a little caret above the tallest cluster) ----
  const crownX = X0 + fams[basePeakFam].m * W;
  const crownTopY = FLOOR + fams[basePeakFam].h * MAXH;
  const crownGeo = new THREE.BufferGeometry();
  crownGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    crownX - 1.1, crownTopY + 1.6, 0, crownX, crownTopY + 0.7, 0,
    crownX, crownTopY + 0.7, 0, crownX + 1.1, crownTopY + 1.6, 0,
  ], 3).setUsage(THREE.DynamicDrawUsage));
  const crownMat = new THREE.LineBasicMaterial({
    color: PALETTE.amber, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const crown = new THREE.LineSegments(crownGeo, crownMat);
  group.add(crown);

  // ---- sweeping detector bar ----
  const sweepGeo = new THREE.BufferGeometry();
  sweepGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    [0, FLOOR - 1, 0, 0, FLOOR + MAXH + 2, 0], 3).setUsage(THREE.DynamicDrawUsage));
  const sweepMat = new THREE.LineBasicMaterial({
    color: PALETTE.white, transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sweep = new THREE.Line(sweepGeo, sweepMat);
  group.add(sweep);

  // ---- fragmenting-molecule motif (corner): a ring shedding atoms ----
  const MOT_N = 7;
  const motPos = new Float32Array(MOT_N * 3);
  const motHome = new Float32Array(MOT_N * 3);
  const motCol = new Float32Array(MOT_N * 3);
  const motOX = mobile ? (X0 + W * 0.16) : (X0 + W * 0.12);
  const motOY = FLOOR + MAXH * 0.86;
  const motR = 2.2;
  const motColors = [PALETTE.white, PALETTE.cyan, PALETTE.amber, PALETTE.white, PALETTE.violet, PALETTE.white, PALETTE.cyan];
  const tmpMC = new THREE.Color();
  for (let i = 0; i < MOT_N; i++) {
    const a = (i / MOT_N) * Math.PI * 2;
    motHome[i * 3] = motOX + Math.cos(a) * motR;
    motHome[i * 3 + 1] = motOY + Math.sin(a) * motR;
    motHome[i * 3 + 2] = 0;
    motPos[i * 3] = motHome[i * 3]; motPos[i * 3 + 1] = motHome[i * 3 + 1]; motPos[i * 3 + 2] = 0;
    tmpMC.set(motColors[i]);
    motCol[i * 3] = tmpMC.r; motCol[i * 3 + 1] = tmpMC.g; motCol[i * 3 + 2] = tmpMC.b;
  }
  const motGeo = new THREE.BufferGeometry();
  motGeo.setAttribute('position', new THREE.BufferAttribute(motPos, 3).setUsage(THREE.DynamicDrawUsage));
  motGeo.setAttribute('aColor', new THREE.BufferAttribute(motCol, 3));
  motGeo.setAttribute('aScale', new THREE.BufferAttribute(new Float32Array(MOT_N).fill(2.4), 1));
  const motMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aScale; attribute vec3 aColor; varying vec3 vColor;
      void main() { vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aScale * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
        gl_FragColor = vec4(mix(vColor, vec3(1.0), smoothstep(0.5,0.0,d)*0.32), smoothstep(0.5, 0.12, d) * 0.78); }`,
  });
  group.add(new THREE.Points(motGeo, motMat));
  // motif bonds (ring)
  const motBondPos = new Float32Array(MOT_N * 6);
  const motBondGeo = new THREE.BufferGeometry();
  motBondGeo.setAttribute('position', new THREE.BufferAttribute(motBondPos, 3).setUsage(THREE.DynamicDrawUsage));
  const motBondMat = new THREE.LineBasicMaterial({
    color: PALETTE.cyan, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.LineSegments(motBondGeo, motBondMat));

  scene.add(group);

  const cLow = new THREE.Color(PALETTE.blue);
  const cHigh = new THREE.Color(PALETTE.cyan);
  const cHot = new THREE.Color(PALETTE.amber);
  const tmp = new THREE.Color();

  const SWEEP_PERIOD = 4.0;
  const grown = new Float32Array(fams.length); // visible height per family

  // Shared per-frame update so reduced-motion seeds a fully-acquired spectrum.
  const updateAt = (t: number) => {
    const sweepFrac = (t / SWEEP_PERIOD) % 1;
    const sweepXpos = X0 + sweepFrac * W;
    const sp = sweepGeo.attributes.position.array as Float32Array;
    sp[0] = sweepXpos; sp[3] = sweepXpos;
    sweepGeo.attributes.position.needsUpdate = true;

    for (let f = 0; f < fams.length; f++) {
      const target = sweepFrac >= fams[f].m ? 1 : 0;
      grown[f] = THREE.MathUtils.lerp(grown[f], target, 0.12);
    }

    for (let i = 0; i < N; i++) {
      const s = stickOf[i];
      const fi = sticks[s].famIdx;
      const peakH = sticks[s].h * MAXH * grown[fi];
      const y = FLOOR + frac[i] * peakH;
      const i3 = i * 3;
      positions[i3 + 1] = y;
      positions[i3] = stickX[s] + Math.sin(t * 2 + i) * 0.04;
      positions[i3 + 2] = Math.sin(t * 1.3 + s) * 0.35;

      const hf = sticks[s].h;
      tmp.copy(cLow).lerp(cHigh, Math.min(1, hf * 1.1));
      const near = Math.max(0, 1 - Math.abs(stickX[s] - sweepXpos) / 2.5);
      tmp.lerp(cHot, near * 0.6);
      // base peak family keeps an amber crown tint at the top
      if (fi === basePeakFam) tmp.lerp(cHot, 0.14 * frac[i]);
      // Keep peaks legible as distinct lines: cap brightness so overlapping
      // M/M+1/M+2 sticks don't additively bloom into a white wall.
      const b = (0.34 + 0.4 * grown[fi]) * (0.85 + near * 0.25);
      colors[i3] = tmp.r * b; colors[i3 + 1] = tmp.g * b; colors[i3 + 2] = tmp.b * b;
      scales[i] = (0.85 + hf * 1.0) * (1 + near * 0.55);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aScale.needsUpdate = true;

    // baseline noise shimmer
    const np = noiseGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < NOISE; i++) {
      np[i * 3 + 1] = noiseBaseY[i] + Math.sin(t * 3 + noisePhase[i]) * 0.18 + Math.random() * 0.06;
    }
    noiseGeo.attributes.position.needsUpdate = true;

    // crown brightness pulses when the sweep crosses the base peak
    const crownNear = Math.max(0, 1 - Math.abs(crownX - sweepXpos) / 4);
    crownMat.opacity = 0.32 + 0.34 * grown[basePeakFam] * (0.6 + 0.4 * crownNear);

    // fragmenting motif: atoms drift outward in a periodic "fragmentation",
    // synced to the sweep, then snap home and repeat.
    const fragPhase = sweepFrac; // 0..1
    const burst = Math.max(0, Math.sin(fragPhase * Math.PI)); // peaks mid-sweep
    const mp = motGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < MOT_N; i++) {
      const ox = motHome[i * 3] - motOX, oy = motHome[i * 3 + 1] - motOY;
      const out = 1 + burst * (0.4 + (i % 3) * 0.25);
      mp[i * 3] = motOX + ox * out + Math.sin(t * 2 + i) * 0.05;
      mp[i * 3 + 1] = motOY + oy * out + Math.cos(t * 1.7 + i) * 0.05;
      mp[i * 3 + 2] = Math.sin(t + i) * 0.2 * burst;
    }
    motGeo.attributes.position.needsUpdate = true;
    // rebuild ring bonds, fading as the molecule fragments
    const mbp = motBondGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < MOT_N; i++) {
      const j = (i + 1) % MOT_N;
      mbp[i * 6] = mp[i * 3]; mbp[i * 6 + 1] = mp[i * 3 + 1]; mbp[i * 6 + 2] = mp[i * 3 + 2];
      mbp[i * 6 + 3] = mp[j * 3]; mbp[i * 6 + 4] = mp[j * 3 + 1]; mbp[i * 6 + 5] = mp[j * 3 + 2];
    }
    motBondGeo.attributes.position.needsUpdate = true;
    motBondMat.opacity = 0.4 * (1 - burst * 0.8);
  };

  // Seed a near-complete spectrum for the static / reduced-motion frame.
  for (let f = 0; f < fams.length; f++) grown[f] = 1;
  updateAt(0.985 * SWEEP_PERIOD);

  onFrame((t) => {
    updateAt(t);
    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, ctx.pointer.x * 0.16, 0.05);
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, -0.04 + ctx.pointer.y * 0.1, 0.05);
  });

  onDispose(() => {
    geo.dispose(); mat.dispose();
    axisGeo.dispose(); axisMat.dispose();
    tickGeo.dispose(); (tickSeg.material as THREE.Material).dispose();
    gridGeo.dispose(); (gridSeg.material as THREE.Material).dispose();
    noiseGeo.dispose(); noiseMat.dispose();
    labelGeo.dispose(); labelMat.dispose(); labelTex.dispose();
    crownGeo.dispose(); crownMat.dispose();
    sweepGeo.dispose(); sweepMat.dispose();
    motGeo.dispose(); motMat.dispose(); motBondGeo.dispose(); motBondMat.dispose();
  });
}
