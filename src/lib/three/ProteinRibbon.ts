/**
 * ProteinRibbon — the Cα backbone of crambin (1CRN) rendered as a smooth tube
 * that *folds in* from the N-terminus, the way an AlphaFold trace resolves into
 * structure. Colored N→C, with secondary-structure accents and residue beads
 * that light up as the fold sweeps past. Structural biology, animated.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';
import { CRAMBIN } from './proteinData';

export function proteinRibbon(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  camera.position.set(0, 0, 42);

  scene.add(new THREE.AmbientLight(0x5577aa, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(5, 8, 10); scene.add(key);
  const rim = new THREE.PointLight(PALETTE.cyan, 50, 200); rim.position.set(-12, 6, 8); scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  const pts = CRAMBIN.ca.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);

  const TUB = 700;       // tubular segments
  const RAD = 8;         // radial segments
  const tube = new THREE.TubeGeometry(curve, TUB, 0.62, RAD, false);

  // per-vertex color: N→C gradient blended with secondary-structure tint
  const nTotal = tube.getAttribute('position').count;
  const ringCount = TUB + 1;
  const perRing = RAD + 1;
  const colorAttr = new Float32Array(nTotal * 3);
  const cN = new THREE.Color(PALETTE.cyan);
  const cMid = new THREE.Color(PALETTE.blue);
  const cC = new THREE.Color(PALETTE.violet);
  const cHelix = new THREE.Color(PALETTE.amber);
  const cSheet = new THREE.Color(0x57d6ff);
  const tmp = new THREE.Color();
  const ssLen = CRAMBIN.ss.length;

  for (let r = 0; r < ringCount; r++) {
    const f = r / (ringCount - 1);
    // base gradient
    if (f < 0.5) tmp.copy(cN).lerp(cMid, f * 2);
    else tmp.copy(cMid).lerp(cC, (f - 0.5) * 2);
    // secondary structure tint
    const ssChar = CRAMBIN.ss[Math.min(ssLen - 1, Math.floor(f * ssLen))];
    if (ssChar === 'H') tmp.lerp(cHelix, 0.35);
    else if (ssChar === 'E') tmp.lerp(cSheet, 0.35);
    for (let j = 0; j < perRing; j++) {
      const vi = r * perRing + j;
      colorAttr[vi * 3] = tmp.r; colorAttr[vi * 3 + 1] = tmp.g; colorAttr[vi * 3 + 2] = tmp.b;
    }
  }
  tube.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.3,
    metalness: 0.15,
    emissive: new THREE.Color(0x0a1f33),
    emissiveIntensity: 0.6,
  });
  const ribbon = new THREE.Mesh(tube, mat);
  group.add(ribbon);

  // residue beads at each Cα
  const beadGeo = new THREE.IcosahedronGeometry(0.5, 2);
  const beads: THREE.Mesh[] = [];
  pts.forEach((p, i) => {
    const ssChar = CRAMBIN.ss[i] ?? 'C';
    const col = ssChar === 'H' ? PALETTE.amber : ssChar === 'E' ? 0x57d6ff : PALETTE.cyan;
    const m = new THREE.Mesh(
      beadGeo,
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4, roughness: 0.4 }),
    );
    m.position.copy(p);
    m.scale.setScalar(0.001);
    group.add(m);
    beads.push(m);
  });

  const idxPerRing = RAD * 6; // indices used to connect one ring to the next
  const totalIdx = TUB * idxPerRing;

  let folded = 0;     // 0..1 progress
  const foldTime = 4.5;
  let holdT = 0;

  onFrame((t, dt) => {
    // fold in, hold, then gently keep full
    if (folded < 1) folded = Math.min(1, folded + dt / foldTime);
    else holdT += dt;

    const reveal = easeInOut(folded);
    tube.setDrawRange(0, Math.floor(reveal * totalIdx));

    // beads pop in as the fold passes them
    const frontResidue = reveal * (pts.length - 1);
    for (let i = 0; i < beads.length; i++) {
      const target = i <= frontResidue ? 1 : 0.001;
      const s = THREE.MathUtils.lerp(beads[i].scale.x, target, 0.2);
      beads[i].scale.setScalar(s);
    }

    group.rotation.y += dt * 0.12;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, ctx.pointer.y * 0.4, 0.05);

    // occasionally refold for life
    if (holdT > 9) { holdT = 0; folded = 0; }
  });

  onDispose(() => {
    tube.dispose(); mat.dispose(); beadGeo.dispose();
    beads.forEach((b) => (b.material as THREE.Material).dispose());
  });
}

function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}
