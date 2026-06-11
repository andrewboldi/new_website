/**
 * GradientDescent — optimization on a loss surface.
 *
 * A smooth multi-modal loss surface, drawn as a glowing wireframe with a marker
 * that rolls downhill along the true negative gradient, leaving a fading trail,
 * then re-spawns from a fresh random start to find a (possibly different) basin.
 * The optimization loop that ML and the physical world quietly share.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, mixColor } from './core';

export function gradientDescent(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  camera.position.set(0, 11, 30);
  camera.lookAt(0, -3, 0);

  const mobile = ctx.width < 760;
  const SEG = mobile ? 48 : 72;   // grid resolution
  const SIZE = 30;                 // world extent of the surface
  const HALF = SIZE / 2;

  // Loss as a sum of gaussian wells/bumps — gives several local minima.
  const wells = [
    { x: -7, z: -5, a: -9, s: 5.5 },
    { x: 6, z: 4, a: -7, s: 4.5 },
    { x: 8, z: -7, a: -5, s: 4.0 },
    { x: -5, z: 8, a: -6, s: 5.0 },
    { x: 0, z: 0, a: 4, s: 7.0 }, // central hill
  ];
  const loss = (x: number, z: number) => {
    let y = 0;
    for (const w of wells) {
      const dx = x - w.x, dz = z - w.z;
      y += w.a * Math.exp(-(dx * dx + dz * dz) / (2 * w.s * w.s));
    }
    return y;
  };
  // analytic gradient of the same field
  const grad = (x: number, z: number, out: THREE.Vector2) => {
    let gx = 0, gz = 0;
    for (const w of wells) {
      const dx = x - w.x, dz = z - w.z;
      const e = w.a * Math.exp(-(dx * dx + dz * dz) / (2 * w.s * w.s));
      gx += e * (-dx / (w.s * w.s));
      gz += e * (-dz / (w.s * w.s));
    }
    out.set(gx, gz);
  };

  // ---- surface as a colored wireframe ----
  const plane = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  plane.rotateX(-Math.PI / 2); // lie flat; height goes into y
  const pos = plane.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = loss(x, z);
    pos.setY(i, y);
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const f = (y - minY) / (maxY - minY); // 0 valley .. 1 peak
    // valley = cyan, mid = blue, peak = violet
    if (f < 0.5) tmp.copy(mixColor(PALETTE.cyan, PALETTE.blue, f * 2));
    else tmp.copy(mixColor(PALETTE.blue, PALETTE.violet, (f - 0.5) * 2));
    const b = 0.45 + (1 - f) * 0.55; // valleys glow a touch brighter
    col[i * 3] = tmp.r * b; col[i * 3 + 1] = tmp.g * b; col[i * 3 + 2] = tmp.b * b;
  }
  plane.setAttribute('color', new THREE.BufferAttribute(col, 3));
  pos.needsUpdate = true;
  plane.computeVertexNormals();

  const wire = new THREE.WireframeGeometry(plane);
  // WireframeGeometry drops vertex colors; re-derive per-line color from height.
  const wpos = wire.attributes.position as THREE.BufferAttribute;
  const wcol = new Float32Array(wpos.count * 3);
  for (let i = 0; i < wpos.count; i++) {
    const y = wpos.getY(i);
    const f = (y - minY) / (maxY - minY);
    if (f < 0.5) tmp.copy(mixColor(PALETTE.cyan, PALETTE.blue, f * 2));
    else tmp.copy(mixColor(PALETTE.blue, PALETTE.violet, (f - 0.5) * 2));
    const b = 0.35 + (1 - f) * 0.4;
    wcol[i * 3] = tmp.r * b; wcol[i * 3 + 1] = tmp.g * b; wcol[i * 3 + 2] = tmp.b * b;
  }
  wire.setAttribute('color', new THREE.BufferAttribute(wcol, 3));
  const wireMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const surface = new THREE.LineSegments(wire, wireMat);

  const group = new THREE.Group();
  group.add(surface);
  group.position.y = -2;
  scene.add(group);

  // ---- descending marker ----
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 16, 16),
    new THREE.MeshBasicMaterial({ color: PALETTE.amber }),
  );
  group.add(ball);

  // glow sprite-ish: a second additive shell
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 16, 16),
    new THREE.MeshBasicMaterial({
      color: PALETTE.amber, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  group.add(halo);

  // ---- trail ----
  const TRAIL = 90;
  const trailPos = new Float32Array(TRAIL * 3);
  const trailCol = new Float32Array(TRAIL * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeo.setDrawRange(0, 0);
  const trailMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.Line(trailGeo, trailMat));

  const g2 = new THREE.Vector2();
  const cHot = new THREE.Color(PALETTE.amber);
  let px = 0, pz = 0;
  let trailLen = 0;
  let settleTimer = 0;
  const LR = 0.9;          // learning-rate-ish step scale
  const LIFT = 0.9;        // hover the ball above the surface

  const respawn = () => {
    px = (Math.random() * 2 - 1) * HALF * 0.9;
    pz = (Math.random() * 2 - 1) * HALF * 0.9;
    trailLen = 0;
    trailGeo.setDrawRange(0, 0);
    settleTimer = 0;
  };
  respawn();

  const pushTrail = (x: number, y: number, z: number) => {
    if (trailLen < TRAIL) {
      const i = trailLen * 3;
      trailPos[i] = x; trailPos[i + 1] = y; trailPos[i + 2] = z;
      trailLen++;
    } else {
      // shift left by one (cheap; TRAIL is small)
      trailPos.copyWithin(0, 3);
      const i = (TRAIL - 1) * 3;
      trailPos[i] = x; trailPos[i + 1] = y; trailPos[i + 2] = z;
    }
    // recolor with a head-bright gradient
    for (let k = 0; k < trailLen; k++) {
      const f = k / Math.max(1, trailLen - 1);
      trailCol[k * 3] = cHot.r * f;
      trailCol[k * 3 + 1] = cHot.g * f;
      trailCol[k * 3 + 2] = cHot.b * f;
    }
    trailGeo.setDrawRange(0, trailLen);
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
  };

  onFrame((t, dt) => {
    const step = Math.min(dt, 0.05);
    // gradient-descent update (clamped step for stability)
    grad(px, pz, g2);
    const gmag = Math.hypot(g2.x, g2.y);
    px -= g2.x * LR * step * 8;
    pz -= g2.y * LR * step * 8;
    px = Math.max(-HALF, Math.min(HALF, px));
    pz = Math.max(-HALF, Math.min(HALF, pz));

    const y = loss(px, pz);
    ball.position.set(px, y + LIFT, pz);
    halo.position.copy(ball.position);
    const pulse = 1 + 0.15 * Math.sin(t * 4);
    halo.scale.setScalar(pulse);

    pushTrail(px, y + LIFT, pz);

    // when the gradient is ~flat we've converged; pause then respawn
    if (gmag < 0.05) {
      settleTimer += step;
      if (settleTimer > 1.4) respawn();
    } else settleTimer = 0;

    group.rotation.y += step * 0.12; // slow turntable so the surface reads in 3D
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, ctx.pointer.x * 6, 0.04);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, 11 + ctx.pointer.y * 4, 0.04);
    camera.lookAt(0, -3, 0);
  });

  onDispose(() => {
    plane.dispose(); wire.dispose(); wireMat.dispose();
    ball.geometry.dispose(); (ball.material as THREE.Material).dispose();
    halo.geometry.dispose(); (halo.material as THREE.Material).dispose();
    trailGeo.dispose(); trailMat.dispose();
  });
}
