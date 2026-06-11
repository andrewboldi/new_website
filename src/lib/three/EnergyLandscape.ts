/**
 * EnergyLandscape — a living potential-energy / loss surface, rendered with
 * Rembrandt-level density.
 *
 * A subdivided surface mesh is displaced by an analytic height field: two deep
 * wells (reactant + product) flanking a SADDLE (the transition state), plus a
 * shallow off-axis basin, all sitting in a gentle bowl. The surface is shaded
 * by height with a Fresnel rim glow, overlaid with glowing CONTOUR / iso-energy
 * lines computed in-shader, a faint base GRID, and a sparse downhill GRADIENT
 * vector field. A glowing marker repeatedly performs gradient descent from the
 * transition state down into a well, dragging a fading TRAIL behind it — the
 * shared geometry of physics, ML, and RL.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, mixColor, prefersReducedMotion } from './core';

interface Well { x: number; z: number; depth: number; sigma: number; ax: number; az: number; phase: number; }

export function energyLandscape(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;
  const reduced = prefersReducedMotion();

  const SIZE = 60;
  const N = ctx.width < 760 ? 96 : 150; // vertices per side (mesh resolution)
  const HALF = SIZE / 2;

  camera.position.set(0, 30, 48);
  camera.lookAt(0, -3, 0);

  const group = new THREE.Group();
  group.rotation.x = -0.06;
  scene.add(group);

  // ---- the landscape: a deliberate reactant / TS / product topology --------
  // Two deep wells on the x-axis with a saddle between them, plus a shallow
  // basin off to one side. Wells "breathe" subtly so the surface lives without
  // the topology dissolving into noise.
  const wells: Well[] = [
    { x: -17, z: -2, depth: 15, sigma: 8.5, ax: 1.4, az: 1.0, phase: 0.0 },   // reactant
    { x: 18, z: 3, depth: 16, sigma: 9.0, ax: 1.2, az: 1.3, phase: 1.7 },     // product (deeper)
    { x: 2, z: -19, depth: 9, sigma: 7.0, ax: 1.0, az: 1.6, phase: 3.1 },     // shallow side basin
    { x: -3, z: 19, depth: 7, sigma: 6.5, ax: 1.5, az: 0.8, phase: 4.4 },     // shallow side basin
  ];
  // a low ridge through the middle creates a genuine saddle between the two
  // deep wells (max along z=0 line, min crossing it on the x-axis path)
  const RIDGE_AMP = 5.5;

  const height = (x: number, z: number, t: number): number => {
    let h = (x * x + z * z) * 0.0055; // gentle confining bowl
    // ridge: a Gaussian wall along the x-axis (peaks near z=0, centered x≈0)
    h += RIDGE_AMP * Math.exp(-(x * x) / (2 * 11 * 11)) * Math.exp(-(z * z) / (2 * 5.5 * 5.5));
    for (const w of wells) {
      const wx = w.x + Math.sin(t * 0.18 + w.phase) * w.ax;
      const wz = w.z + Math.cos(t * 0.15 + w.phase) * w.az;
      const dpt = w.depth + Math.sin(t * 0.25 + w.phase) * 0.8;
      const d2 = (x - wx) ** 2 + (z - wz) ** 2;
      h -= dpt * Math.exp(-d2 / (2 * w.sigma * w.sigma));
    }
    return h;
  };

  // ---- surface mesh --------------------------------------------------------
  // PlaneGeometry laid flat on XZ; we displace Y per frame and recompute normals.
  const surfGeo = new THREE.PlaneGeometry(SIZE, SIZE, N - 1, N - 1);
  surfGeo.rotateX(-Math.PI / 2); // now spans XZ, normals up
  const sPos = surfGeo.attributes.position as THREE.BufferAttribute;
  sPos.setUsage(THREE.DynamicDrawUsage);
  const vCount = sPos.count;
  // per-vertex normalized height (for shader coloring), updated each frame
  const hNorm = new Float32Array(vCount);
  surfGeo.setAttribute('aH', new THREE.BufferAttribute(hNorm, 1).setUsage(THREE.DynamicDrawUsage));

  const surfUniforms = {
    uLo: { value: new THREE.Color(PALETTE.cyan) },
    uMid: { value: new THREE.Color(PALETTE.blue) },
    uHi: { value: new THREE.Color(PALETTE.violet) },
    uPeak: { value: new THREE.Color(PALETTE.amber) },
    uContour: { value: 18.0 },     // number of iso bands across the height range
    uTime: { value: 0 },
  };
  const surfMat = new THREE.ShaderMaterial({
    uniforms: surfUniforms,
    transparent: true,
    depthWrite: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aH;
      varying float vH;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vH = aH;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uLo, uMid, uHi, uPeak;
      uniform float uContour;
      varying float vH;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        // base color ramp: deep valleys cyan -> blue -> violet, high ridges -> amber
        vec3 col;
        if (vH < 0.5) col = mix(uLo, uMid, vH * 2.0);
        else          col = mix(uMid, uHi, (vH - 0.5) * 2.0);
        col = mix(col, uPeak, smoothstep(0.78, 1.0, vH) * 0.6);
        // keep the base dark so bloom picks out highlights/contours, not wash
        col *= 0.34;

        // soft lambert shading + a restrained fresnel rim so the form reads in 3D
        vec3 N = normalize(vN);
        float lambert = clamp(dot(N, normalize(vec3(0.3, 0.9, 0.4))), 0.0, 1.0);
        float fres = pow(1.0 - clamp(dot(N, normalize(vView)), 0.0, 1.0), 3.0);
        col *= (0.3 + 0.7 * lambert);
        col += uHi * fres * 0.16;

        // glowing iso-energy contour lines via derivative-based anti-aliasing
        float band = vH * uContour;
        float f = abs(fract(band - 0.5) - 0.5);
        float w = fwidth(band);
        float line = 1.0 - smoothstep(0.0, w * 1.5, f);
        col += vec3(0.45, 0.72, 0.95) * line * 0.55;

        // valley floors glow a touch hotter (where the action settles)
        col += uLo * smoothstep(0.16, 0.0, vH) * 0.16;

        float alpha = 0.96;
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const surface = new THREE.Mesh(surfGeo, surfMat);
  group.add(surface);

  // a very faint wireframe sheet just above the surface adds mesh density
  const wireMat = new THREE.MeshBasicMaterial({
    color: PALETTE.blue, wireframe: true, transparent: true, opacity: 0.025,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const wire = new THREE.Mesh(surfGeo, wireMat); // shares displaced geometry
  wire.position.y = 0.04;
  group.add(wire);

  // ---- base reference grid on the floor plane ------------------------------
  const grid = new THREE.GridHelper(SIZE, 24, PALETTE.blue, PALETTE.blue);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.05;
  (grid.material as THREE.LineBasicMaterial).blending = THREE.AdditiveBlending;
  (grid.material as THREE.Material).depthWrite = false;
  grid.position.y = -24;
  group.add(grid);

  // ---- gradient vector field (sparse downhill arrows) ----------------------
  const GN = ctx.width < 760 ? 9 : 13; // arrows per side
  const ARROWS = GN * GN;
  // each arrow = 3 line segments (shaft + 2 barbs) = 6 vertices
  const fieldPos = new Float32Array(ARROWS * 6 * 3);
  const fieldCol = new Float32Array(ARROWS * 6 * 3);
  const fieldGeo = new THREE.BufferGeometry();
  fieldGeo.setAttribute('position', new THREE.BufferAttribute(fieldPos, 3).setUsage(THREE.DynamicDrawUsage));
  fieldGeo.setAttribute('color', new THREE.BufferAttribute(fieldCol, 3).setUsage(THREE.DynamicDrawUsage));
  const fieldMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.LineSegments(fieldGeo, fieldMat));
  // precompute the xz sample positions for the field
  const fieldXZ = new Float32Array(ARROWS * 2);
  {
    let fi = 0;
    for (let ix = 0; ix < GN; ix++) {
      for (let iz = 0; iz < GN; iz++) {
        fieldXZ[fi * 2] = (ix / (GN - 1) - 0.5) * SIZE * 0.92;
        fieldXZ[fi * 2 + 1] = (iz / (GN - 1) - 0.5) * SIZE * 0.92;
        fi++;
      }
    }
  }
  const cFieldLo = new THREE.Color(PALETTE.blue).multiplyScalar(0.5);
  const cFieldHi = new THREE.Color(PALETTE.cyan);

  // ---- gradient-descent marker + glowing trail -----------------------------
  const markerMat = new THREE.MeshBasicMaterial({ color: PALETTE.amber });
  const marker = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 2), markerMat);
  group.add(marker);
  const halo = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.9, 2),
    new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  marker.add(halo);
  // a vertical "drop line" from the marker to the floor, for depth reading
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3).setUsage(THREE.DynamicDrawUsage));
  const drop = new THREE.Line(dropGeo, new THREE.LineBasicMaterial({
    color: PALETTE.amber, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(drop);

  // trail: a ring buffer of recent marker positions, drawn as a fading line
  const TRAIL = 90;
  const trailPos = new Float32Array(TRAIL * 3);
  const trailCol = new Float32Array(TRAIL * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3).setUsage(THREE.DynamicDrawUsage));
  const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(trailLine);
  const cTrail = new THREE.Color(PALETTE.amber);

  // marker starts near the transition state (top of the ridge) so it visibly
  // tips into one of the two deep wells.
  let mx = (Math.random() - 0.5) * 4;
  let mz = (Math.random() - 0.5) * 3;
  let respawn = 0;
  let trailLen = 0;
  const resetTrail = (x: number, y: number, z: number) => {
    for (let i = 0; i < TRAIL; i++) {
      trailPos[i * 3] = x; trailPos[i * 3 + 1] = y; trailPos[i * 3 + 2] = z;
    }
    trailLen = 0;
  };

  const FLOOR = -24;
  const lift = 1.0; // marker rides slightly above the surface

  const update = (t: number, dt: number) => {
    // ---- displace surface + compute normalized height field ----
    let minH = 1e9, maxH = -1e9;
    const arr = sPos.array as Float32Array;
    for (let i = 0; i < vCount; i++) {
      const x = arr[i * 3], z = arr[i * 3 + 2];
      const h = height(x, z, t);
      arr[i * 3 + 1] = h; // wells (negative h) dip DOWN, ridge + bowl rim rise
      if (h < minH) minH = h; if (h > maxH) maxH = h;
    }
    const range = Math.max(1e-3, maxH - minH);
    for (let i = 0; i < vCount; i++) {
      const h = arr[i * 3 + 1];
      hNorm[i] = (h - minH) / range;
    }
    sPos.needsUpdate = true;
    (surfGeo.attributes.aH as THREE.BufferAttribute).needsUpdate = true;
    surfGeo.computeVertexNormals();
    (surfGeo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;

    // ---- gradient vector field ----
    const eps = 0.6;
    for (let a = 0; a < ARROWS; a++) {
      const x = fieldXZ[a * 2], z = fieldXZ[a * 2 + 1];
      const gx = (height(x + eps, z, t) - height(x - eps, z, t)) / (2 * eps);
      const gz = (height(x, z + eps, t) - height(x, z - eps, t)) / (2 * eps);
      let dx = -gx, dz = -gz; // downhill
      const g = Math.hypot(dx, dz) || 1e-4;
      const len = Math.min(3.2, 0.6 + g * 0.6); // arrow length scales with slope
      dx = (dx / g) * len; dz = (dz / g) * len;
      const y = height(x, z, t) + 0.5;
      const ey = height(x + dx * 0.5, z + dz * 0.5, t) + 0.5;
      const o = a * 18; // 6 verts * 3 comps
      // shaft
      fieldPos[o] = x; fieldPos[o + 1] = y; fieldPos[o + 2] = z;
      fieldPos[o + 3] = x + dx; fieldPos[o + 4] = ey; fieldPos[o + 5] = z + dz;
      // barbs (in xz plane, splayed back from the tip)
      const bx = -dx, bz = -dz;
      const px = -dz, pz = dx; // perpendicular
      const bs = 0.28;
      fieldPos[o + 6] = x + dx; fieldPos[o + 7] = ey; fieldPos[o + 8] = z + dz;
      fieldPos[o + 9] = x + dx + (bx + px) * bs; fieldPos[o + 10] = ey; fieldPos[o + 11] = z + dz + (bz + pz) * bs;
      fieldPos[o + 12] = x + dx; fieldPos[o + 13] = ey; fieldPos[o + 14] = z + dz;
      fieldPos[o + 15] = x + dx + (bx - px) * bs; fieldPos[o + 16] = ey; fieldPos[o + 17] = z + dz + (bz - pz) * bs;
      // color by slope magnitude
      const tcol = Math.min(1, g / 2.5);
      const cr = cFieldLo.r + (cFieldHi.r - cFieldLo.r) * tcol;
      const cg = cFieldLo.g + (cFieldHi.g - cFieldLo.g) * tcol;
      const cb = cFieldLo.b + (cFieldHi.b - cFieldLo.b) * tcol;
      for (let v = 0; v < 6; v++) {
        fieldCol[o + v * 3] = cr; fieldCol[o + v * 3 + 1] = cg; fieldCol[o + v * 3 + 2] = cb;
      }
    }
    fieldGeo.attributes.position.needsUpdate = true;
    fieldGeo.attributes.color.needsUpdate = true;

    // ---- marker gradient descent ----
    const me = 0.4;
    const gx = (height(mx + me, mz, t) - height(mx - me, mz, t)) / (2 * me);
    const gz = (height(mx, mz + me, t) - height(mx, mz - me, t)) / (2 * me);
    const lr = 5.0;
    mx -= gx * lr * dt; mz -= gz * lr * dt;
    mx = THREE.MathUtils.clamp(mx, -HALF, HALF);
    mz = THREE.MathUtils.clamp(mz, -HALF, HALF);
    const my = height(mx, mz, t) + lift;
    marker.position.set(mx, my, mz);
    const grad = Math.hypot(gx, gz);
    markerMat.color.copy(mixColor(PALETTE.amber, PALETTE.cyan, Math.min(1, grad * 0.8)));
    halo.scale.setScalar(1 + Math.min(1, grad) * 0.5);

    // drop line to the floor
    const dp = dropGeo.attributes.position.array as Float32Array;
    dp[0] = mx; dp[1] = my; dp[2] = mz;
    dp[3] = mx; dp[4] = FLOOR; dp[5] = mz;
    dropGeo.attributes.position.needsUpdate = true;

    // push into trail ring buffer (shift then write head)
    trailPos.copyWithin(3, 0);
    trailPos[0] = mx; trailPos[1] = my; trailPos[2] = mz;
    if (trailLen < TRAIL) trailLen++;
    for (let i = 0; i < TRAIL; i++) {
      const f = 1 - i / (TRAIL - 1);
      trailCol[i * 3] = cTrail.r * f;
      trailCol[i * 3 + 1] = cTrail.g * f;
      trailCol[i * 3 + 2] = cTrail.b * f;
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
    trailGeo.setDrawRange(0, trailLen);

    respawn += dt;
    if (grad < 0.05 || respawn > 6.5) {
      respawn = 0;
      // re-spawn back near the transition state / ridge crest so descent repeats
      mx = (Math.random() - 0.5) * 5;
      mz = (Math.random() - 0.5) * 4;
      const ry = height(mx, mz, t) + lift;
      resetTrail(mx, ry, mz);
    }

    surfUniforms.uTime.value = t;
    group.rotation.y = Math.sin(t * 0.05) * 0.22 + ctx.pointer.x * 0.28;
  };

  // prime the trail at the start position
  resetTrail(mx, height(mx, mz, 0) + lift, mz);

  if (reduced) {
    // rich static frame: one descent step already settled toward a well
    mx = -14; mz = -2;
    update(2.4, 0);
  } else {
    onFrame((t, dt) => update(t, dt));
  }

  onDispose(() => {
    surfGeo.dispose(); surfMat.dispose(); wireMat.dispose();
    grid.geometry.dispose(); (grid.material as THREE.Material).dispose();
    fieldGeo.dispose(); fieldMat.dispose();
    marker.geometry.dispose(); markerMat.dispose();
    halo.geometry.dispose(); (halo.material as THREE.Material).dispose();
    dropGeo.dispose(); (drop.material as THREE.Material).dispose();
    trailGeo.dispose(); (trailLine.material as THREE.Material).dispose();
  });
}
