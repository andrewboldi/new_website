/**
 * ProteinRibbon — the Cα backbone of Green Fluorescent Protein (1EMA) folding
 * in from the N-terminus, the way an AlphaFold trace resolves into structure.
 * It's an 11-stranded β-barrel: the tube is colored by secondary structure and
 * N→C position, residue beads light up as the fold sweeps past, short
 * side-chain stubs bristle outward, and the chromophore glows at the core.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';
import { GFP } from './proteinData';

export function proteinRibbon(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  scene.add(new THREE.AmbientLight(0x5577aa, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(6, 9, 11); scene.add(key);
  const rim = new THREE.PointLight(PALETTE.cyan, 70, 260); rim.position.set(-14, 8, 10); scene.add(rim);
  const fill = new THREE.PointLight(PALETTE.blue, 40, 260); fill.position.set(12, -6, -8); scene.add(fill);

  const group = new THREE.Group();
  scene.add(group);

  const pts = GFP.ca.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const n = pts.length;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);

  const TUB = 1200;      // tubular segments (GFP is big — keep it smooth)
  const RAD = 9;         // radial segments
  const tube = new THREE.TubeGeometry(curve, TUB, 0.62, RAD, false);

  // ---- per-vertex color: N→C gradient blended with secondary-structure tint ----
  const ringCount = TUB + 1;
  const perRing = RAD + 1;
  const colorAttr = new Float32Array(tube.getAttribute('position').count * 3);
  const cN = new THREE.Color(PALETTE.cyan);
  const cMid = new THREE.Color(PALETTE.blue);
  const cC = new THREE.Color(PALETTE.violet);
  const cHelix = new THREE.Color(PALETTE.amber);
  const cSheet = new THREE.Color(0x4fd0ff);
  const tmp = new THREE.Color();
  const ssLen = GFP.ss.length;
  for (let r = 0; r < ringCount; r++) {
    const f = r / (ringCount - 1);
    if (f < 0.5) tmp.copy(cN).lerp(cMid, f * 2);
    else tmp.copy(cMid).lerp(cC, (f - 0.5) * 2);
    const ssChar = GFP.ss[Math.min(ssLen - 1, Math.floor(f * ssLen))];
    if (ssChar === 'H') tmp.lerp(cHelix, 0.45);
    else if (ssChar === 'E') tmp.lerp(cSheet, 0.5);
    for (let j = 0; j < perRing; j++) {
      const vi = (r * perRing + j) * 3;
      colorAttr[vi] = tmp.r; colorAttr[vi + 1] = tmp.g; colorAttr[vi + 2] = tmp.b;
    }
  }
  tube.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.32, metalness: 0.18,
    emissive: new THREE.Color(0x0a1f33), emissiveIntensity: 0.55,
  });
  const ribbon = new THREE.Mesh(tube, mat);
  group.add(ribbon);

  // ---- residue beads at each Cα ----
  const beadGeo = new THREE.IcosahedronGeometry(0.42, 2);
  const beads: THREE.Mesh[] = [];
  pts.forEach((p, i) => {
    const ssChar = GFP.ss[i] ?? 'C';
    const col = ssChar === 'H' ? PALETTE.amber : ssChar === 'E' ? 0x4fd0ff : PALETTE.cyan;
    const m = new THREE.Mesh(beadGeo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.45, roughness: 0.4 }));
    m.position.copy(p); m.scale.setScalar(0.001);
    group.add(m); beads.push(m);
  });

  // ---- side-chain stubs (radial, perpendicular to the backbone) ----
  const stubPos = new Float32Array(n * 6);
  const tangent = new THREE.Vector3();
  const outward = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
    tangent.subVectors(next, prev).normalize();
    // radial component of the (centered) position, made perpendicular to the backbone
    outward.copy(pts[i]).addScaledVector(tangent, -pts[i].dot(tangent));
    if (outward.lengthSq() < 1e-4) outward.set(0, 1, 0);
    outward.normalize();
    const len = 1.4 + ((i * 7) % 5) * 0.18;
    stubPos[i * 6] = pts[i].x; stubPos[i * 6 + 1] = pts[i].y; stubPos[i * 6 + 2] = pts[i].z;
    stubPos[i * 6 + 3] = pts[i].x + outward.x * len;
    stubPos[i * 6 + 4] = pts[i].y + outward.y * len;
    stubPos[i * 6 + 5] = pts[i].z + outward.z * len;
  }
  const stubGeo = new THREE.BufferGeometry();
  stubGeo.setAttribute('position', new THREE.BufferAttribute(stubPos, 3));
  stubGeo.setDrawRange(0, 0);
  const stubs = new THREE.LineSegments(
    stubGeo,
    new THREE.LineBasicMaterial({ color: 0x8fb8ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  group.add(stubs);

  // ---- chromophore: the glowing heart of GFP ----
  const chromo = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.5, 3),
    new THREE.MeshStandardMaterial({ color: PALETTE.cyan, emissive: PALETTE.cyan, emissiveIntensity: 2.2, roughness: 0.2 }),
  );
  chromo.position.copy(pts[Math.min(n - 1, GFP.chromophore)]);
  chromo.scale.setScalar(0.001);
  group.add(chromo);
  const chromoLight = new THREE.PointLight(PALETTE.cyan, 0, 60);
  chromoLight.position.copy(chromo.position);
  group.add(chromoLight);

  // frame the camera to the whole barrel
  const bounds = new THREE.Box3().setFromObject(ribbon);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  group.position.sub(center);
  const vFOV = THREE.MathUtils.degToRad(camera.fov);
  const fit = Math.max(size.x, size.y) / 2 / Math.tan(vFOV / 2);
  camera.position.set(0, 0, fit * 1.15 + 6);
  camera.lookAt(0, 0, 0);

  const idxPerRing = RAD * 6;
  const totalIdx = TUB * idxPerRing;
  let folded = 0;
  const foldTime = 5.5;
  let holdT = 0;

  onFrame((t, dt) => {
    if (folded < 1) folded = Math.min(1, folded + dt / foldTime);
    else holdT += dt;
    const reveal = easeInOut(folded);

    tube.setDrawRange(0, Math.floor(reveal * totalIdx));
    const front = reveal * (n - 1);
    stubGeo.setDrawRange(0, Math.floor(reveal * n) * 2);

    for (let i = 0; i < beads.length; i++) {
      const target = i <= front ? 1 : 0.001;
      beads[i].scale.setScalar(THREE.MathUtils.lerp(beads[i].scale.x, target, 0.2));
    }

    // chromophore ignites once the fold passes it, then pulses
    const lit = front >= GFP.chromophore;
    const pulse = 1 + 0.18 * Math.sin(t * 2.4);
    chromo.scale.setScalar(THREE.MathUtils.lerp(chromo.scale.x, lit ? pulse : 0.001, 0.12));
    chromoLight.intensity = THREE.MathUtils.lerp(chromoLight.intensity, lit ? 90 : 0, 0.08);

    group.rotation.y += dt * 0.16;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, -0.15 + ctx.pointer.y * 0.4, 0.05);
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, ctx.pointer.x * 0.12, 0.05);

    if (holdT > 11) { holdT = 0; folded = 0; }
  });

  onDispose(() => {
    tube.dispose(); mat.dispose(); beadGeo.dispose(); stubGeo.dispose();
    (stubs.material as THREE.Material).dispose();
    beads.forEach((b) => (b.material as THREE.Material).dispose());
    chromo.geometry.dispose(); (chromo.material as THREE.Material).dispose();
  });
}

function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}
