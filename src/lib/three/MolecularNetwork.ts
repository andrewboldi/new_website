/**
 * MolecularNetwork — the hero scene.
 *
 * A field of drifting "molecules" in a bounded volume. Each node now carries a
 * little molecular STRUCTURE — a bright central atom ringed by a few smaller
 * satellite atoms joined by short intramolecular bonds — so it reads as a
 * molecule, not a dot. When two molecules approach, a TRANSIENT intermolecular
 * bond forms and fades in; it fades back out as they part (smooth alpha, no
 * popping). Depth cueing dims/cools far molecules; a couple of slow PARALLAX
 * layers add space. Glowing nodes + UnrealBloom give the lab-instrument sheen;
 * the pointer gently steers the whole lattice.
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

// node point sprite: glowing core + halo, with depth-cue dimming baked in
const POINT_VS = /* glsl */ `
  attribute float aScale;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vDepth;
  uniform float uTime;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // depth cue in [0,1]: 1 near, 0 far
    vDepth = clamp(1.0 - (-mv.z - 30.0) / 90.0, 0.25, 1.0);
    float pulse = 1.0 + 0.16 * sin(uTime * 1.6 + position.x * 4.0 + position.y * 3.0);
    gl_PointSize = aScale * pulse * (300.0 / -mv.z) * (0.6 + 0.4 * vDepth);
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FS = /* glsl */ `
  varying vec3 vColor;
  varying float vDepth;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    float halo = smoothstep(0.5, 0.18, d);
    vec3 col = mix(vColor, vec3(1.0), core * 0.55);
    // far molecules cool toward blue + dim
    col = mix(col * 0.55, col, vDepth);
    gl_FragColor = vec4(col, halo * (0.45 + 0.55 * vDepth));
  }
`;

export function molecularNetwork(handle: SceneHandle, opts: Opts = {}) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  const mobile = ctx.width < 760;
  const reduced =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  // a bit fewer "molecules" than the old node count, since each is now a cluster
  const count = opts.count ?? (mobile ? 70 : 150);
  const R = opts.radius ?? 28;
  const linkDist = opts.linkDist ?? (mobile ? 9.5 : 8.6);
  const hubCount = opts.hubCount ?? 5;

  camera.position.set(0, 0, 62);
  camera.lookAt(0, 0, 0);

  const group = new THREE.Group();
  scene.add(group);

  // ---------- molecule cores (one bright point per molecule) ----------
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const spin = new Float32Array(count);          // intramolecular rotation rate
  const scales = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const satCount = new Uint8Array(count);        // satellites per molecule (2..4)

  const cBlue = new THREE.Color(PALETTE.blue);
  const cCyan = new THREE.Color(PALETTE.cyan);
  const cViolet = new THREE.Color(PALETTE.violet);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const r = R * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i3 + 2] = r * Math.cos(phi);

    velocities[i3] = (Math.random() - 0.5) * 0.85;
    velocities[i3 + 1] = (Math.random() - 0.5) * 0.85;
    velocities[i3 + 2] = (Math.random() - 0.5) * 0.85;
    spin[i] = (Math.random() - 0.5) * 1.6;
    satCount[i] = 2 + (Math.random() * 3 | 0);

    const isHub = i < hubCount;
    scales[i] = isHub ? 4.6 + Math.random() * 1.6 : 1.6 + Math.random() * 1.0;

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
    vertexShader: POINT_VS, fragmentShader: POINT_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const nodes = new THREE.Points(nodeGeo, nodeMat);
  group.add(nodes);

  // ---------- satellite atoms (smaller points orbiting each core) ----------
  // Precompute local offsets per satellite; positions recomputed each frame.
  const MAXSAT = 4;
  const satN = count * MAXSAT;
  const satPos = new Float32Array(satN * 3);
  const satCol = new Float32Array(satN * 3);
  const satScale = new Float32Array(satN);
  const satLocal = new Float32Array(satN * 3); // unit local direction
  const satRad = new Float32Array(satN);       // bond length
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    for (let s = 0; s < MAXSAT; s++) {
      const k = i * MAXSAT + s;
      // random unit direction
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      satLocal[k * 3] = Math.sin(ph) * Math.cos(th);
      satLocal[k * 3 + 1] = Math.sin(ph) * Math.sin(th);
      satLocal[k * 3 + 2] = Math.cos(ph);
      satRad[k] = (scales[i] * 0.18) + 1.4 + Math.random() * 0.6;
      satScale[k] = s < satCount[i] ? scales[i] * 0.42 + 0.5 : 0.0; // hide extras
      // satellites slightly cooler/whiter than the core
      tmpColor.set(colors[i3], colors[i3 + 1], colors[i3 + 2]).lerp(new THREE.Color(0xffffff), 0.25);
      satCol[k * 3] = tmpColor.r; satCol[k * 3 + 1] = tmpColor.g; satCol[k * 3 + 2] = tmpColor.b;
    }
  }
  const satGeo = new THREE.BufferGeometry();
  satGeo.setAttribute('position', new THREE.BufferAttribute(satPos, 3).setUsage(THREE.DynamicDrawUsage));
  satGeo.setAttribute('aScale', new THREE.BufferAttribute(satScale, 1));
  satGeo.setAttribute('aColor', new THREE.BufferAttribute(satCol, 3));
  const satMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: POINT_VS, fragmentShader: POINT_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.Points(satGeo, satMat));

  // ---------- intramolecular bonds (core -> each satellite) ----------
  const intraSeg = count * MAXSAT;
  const intraPos = new Float32Array(intraSeg * 6);
  const intraCol = new Float32Array(intraSeg * 6);
  const intraGeo = new THREE.BufferGeometry();
  intraGeo.setAttribute('position', new THREE.BufferAttribute(intraPos, 3).setUsage(THREE.DynamicDrawUsage));
  intraGeo.setAttribute('color', new THREE.BufferAttribute(intraCol, 3).setUsage(THREE.DynamicDrawUsage));
  const intraMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.LineSegments(intraGeo, intraMat));

  // ---------- transient intermolecular bonds (form/break with fading) ----------
  const maxLinks = count * 6;
  const linkPos = new Float32Array(maxLinks * 6);
  const linkCol = new Float32Array(maxLinks * 6);
  const linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPos, 3).setUsage(THREE.DynamicDrawUsage));
  linkGeo.setAttribute('color', new THREE.BufferAttribute(linkCol, 3).setUsage(THREE.DynamicDrawUsage));
  linkGeo.setDrawRange(0, 0);
  const linkMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.72,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.LineSegments(linkGeo, linkMat));

  // persistent bond strengths keyed by packed (i,j) — eased so bonds fade.
  // Use a Map<number, number>: key = i*count + j (i<j).
  const bondStrength = new Map<number, number>();

  // faint enclosing wire sphere for containment depth cue
  const shell = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R * 1.18, 1)),
    new THREE.LineBasicMaterial({ color: PALETTE.blue, transparent: true, opacity: 0.06 }),
  );
  group.add(shell);

  // parallax dust: two slow layers of faint far points for depth
  const makeDust = (n: number, spread: number, size: number, op: number) => {
    const dp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      dp[i * 3] = (Math.random() - 0.5) * spread;
      dp[i * 3 + 1] = (Math.random() - 0.5) * spread;
      dp[i * 3 + 2] = (Math.random() - 0.5) * spread;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    const m = new THREE.PointsMaterial({
      color: PALETTE.blue, size, transparent: true, opacity: op,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    return new THREE.Points(g, m);
  };
  const dustFar = makeDust(mobile ? 60 : 120, R * 4.2, 0.6, 0.12);
  const dustMid = makeDust(mobile ? 40 : 90, R * 2.8, 0.9, 0.18);
  scene.add(dustFar);
  scene.add(dustMid);

  const linkD2 = linkDist * linkDist;
  const cA = new THREE.Color();
  const cB = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);

  onFrame((t, dt) => {
    nodeMat.uniforms.uTime.value = t;
    satMat.uniforms.uTime.value = t;

    const step = (reduced ? 0 : (dt || 0.016)) * 1.0;

    // integrate + bounce molecule cores inside sphere
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] += velocities[i3] * step;
      positions[i3 + 1] += velocities[i3 + 1] * step;
      positions[i3 + 2] += velocities[i3 + 2] * step;
      const x = positions[i3], y = positions[i3 + 1], z = positions[i3 + 2];
      const d = Math.hypot(x, y, z);
      if (d > R) {
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

    // ---- satellites + intramolecular bonds ----
    let ip = 0, icp = 0;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const cx = positions[i3], cy = positions[i3 + 1], cz = positions[i3 + 2];
      const ang = t * spin[i];
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let s = 0; s < MAXSAT; s++) {
        const k = i * MAXSAT + s;
        const k3 = k * 3;
        if (satScale[k] <= 0) {
          // park hidden satellites at center (still drawn but size 0 -> discarded)
          satPos[k3] = cx; satPos[k3 + 1] = cy; satPos[k3 + 2] = cz;
          // zero-length intra bond
          intraPos[ip++] = cx; intraPos[ip++] = cy; intraPos[ip++] = cz;
          intraPos[ip++] = cx; intraPos[ip++] = cy; intraPos[ip++] = cz;
          for (let q = 0; q < 6; q++) intraCol[icp++] = 0;
          continue;
        }
        // rotate local dir around Y for a little tumbling
        let lx = satLocal[k3], ly = satLocal[k3 + 1], lz = satLocal[k3 + 2];
        const rx = lx * ca - lz * sa;
        const rz = lx * sa + lz * ca;
        lx = rx; lz = rz;
        const sx = cx + lx * satRad[k];
        const sy = cy + ly * satRad[k];
        const sz = cz + lz * satRad[k];
        satPos[k3] = sx; satPos[k3 + 1] = sy; satPos[k3 + 2] = sz;

        // intra bond core->sat, colored by core color, dimmer at satellite
        intraPos[ip++] = cx; intraPos[ip++] = cy; intraPos[ip++] = cz;
        intraPos[ip++] = sx; intraPos[ip++] = sy; intraPos[ip++] = sz;
        const cr = colors[i3] * 0.7, cg = colors[i3 + 1] * 0.7, cbb = colors[i3 + 2] * 0.7;
        intraCol[icp++] = cr; intraCol[icp++] = cg; intraCol[icp++] = cbb;
        intraCol[icp++] = cr * 0.5; intraCol[icp++] = cg * 0.5; intraCol[icp++] = cbb * 0.5;
      }
    }
    satGeo.attributes.position.needsUpdate = true;
    intraGeo.attributes.position.needsUpdate = true;
    intraGeo.attributes.color.needsUpdate = true;

    // ---- transient intermolecular bonds with fade in/out ----
    // 1) bump strength for currently-close pairs; 2) decay all; 3) draw >eps.
    const decay = Math.exp(-(dt || 0.016) * 2.2);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const xi = positions[i3], yi = positions[i3 + 1], zi = positions[i3 + 2];
      for (let j = i + 1; j < count; j++) {
        const j3 = j * 3;
        const dx = xi - positions[j3];
        const dy = yi - positions[j3 + 1];
        const dz = zi - positions[j3 + 2];
        const dist2 = dx * dx + dy * dy + dz * dz;
        if (dist2 > linkD2) continue;
        const closeness = 1 - Math.sqrt(dist2) / linkDist; // 0..1
        const key = i * count + j;
        const prev = bondStrength.get(key) ?? 0;
        // target strength grows when close; ease toward it
        const next = Math.max(prev, closeness);
        bondStrength.set(key, next);
      }
    }

    let vp = 0, cp = 0, seg = 0;
    for (const [key, str] of bondStrength) {
      const decayed = str * decay;
      if (decayed < 0.02) { bondStrength.delete(key); continue; }
      bondStrength.set(key, decayed);
      if (seg >= maxLinks) continue;
      const i = (key / count) | 0;
      const j = key % count;
      const i3 = i * 3, j3 = j * 3;
      // recheck distance so a bond that drifts apart keeps fading (already decaying)
      cA.set(colors[i3], colors[i3 + 1], colors[i3 + 2]).multiplyScalar(decayed);
      cB.set(colors[j3], colors[j3 + 1], colors[j3 + 2]).multiplyScalar(decayed);
      linkPos[vp++] = positions[i3]; linkPos[vp++] = positions[i3 + 1]; linkPos[vp++] = positions[i3 + 2];
      linkPos[vp++] = positions[j3]; linkPos[vp++] = positions[j3 + 1]; linkPos[vp++] = positions[j3 + 2];
      linkCol[cp++] = cA.r; linkCol[cp++] = cA.g; linkCol[cp++] = cA.b;
      linkCol[cp++] = cB.r; linkCol[cp++] = cB.g; linkCol[cp++] = cB.b;
      seg++;
    }
    linkGeo.setDrawRange(0, seg * 2);
    linkGeo.attributes.position.needsUpdate = true;
    linkGeo.attributes.color.needsUpdate = true;

    // slow auto-rotate + pointer parallax (cores)
    group.rotation.y += (reduced ? 0 : dt * 0.04);
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, ctx.pointer.y * 0.35, 0.04);
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, -ctx.pointer.x * 0.12, 0.04);
    // parallax dust layers rotate slower / opposite for depth
    dustMid.rotation.y = group.rotation.y * 0.5;
    dustMid.rotation.x = group.rotation.x * 0.5;
    dustFar.rotation.y = -group.rotation.y * 0.25;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, ctx.pointer.x * 8, 0.04);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, ctx.pointer.y * 6, 0.04);
    camera.lookAt(0, 0, 0);
  });

  onDispose(() => {
    nodeGeo.dispose(); nodeMat.dispose();
    satGeo.dispose(); satMat.dispose();
    intraGeo.dispose(); intraMat.dispose();
    linkGeo.dispose(); linkMat.dispose();
    shell.geometry.dispose(); (shell.material as THREE.Material).dispose();
    dustFar.geometry.dispose(); (dustFar.material as THREE.Material).dispose();
    dustMid.geometry.dispose(); (dustMid.material as THREE.Material).dispose();
  });
}
