/**
 * GradientDescent — optimization on a loss surface, in full topographic detail.
 *
 * A smooth multi-modal loss field (several gaussian wells/bumps + a saddle) is
 * drawn three ways at once: a softly shaded filled surface, a glowing wireframe
 * over it, and a set of CONTOUR rings traced at evenly-spaced heights so the
 * basins and the saddle read like a topographic map. A descending marker rolls
 * downhill along the TRUE negative gradient with momentum, dragging a fading
 * comet trail; a sparse field of little gradient ARROWS shows the flow it's
 * following. On convergence it pauses, then re-spawns in a fresh basin.
 *
 * Surface, contours and arrow field are all built once. The frame loop only
 * advances the marker, writes its trail, and pulses a couple of uniforms — no
 * per-frame allocation.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, mixColor } from './core';

export function gradientDescent(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  camera.position.set(0, 12, 30);
  camera.lookAt(0, -3, 0);

  const mobile = ctx.width < 760;
  const SEG = mobile ? 56 : 88;    // grid resolution (denser = finer relief)
  const SIZE = 30;                  // world extent of the surface
  const HALF = SIZE / 2;

  // Loss as a sum of gaussian wells/bumps — several minima + a central hill,
  // plus an off-center saddle pair so there's a genuine saddle to roll through.
  const wells = [
    { x: -7, z: -5, a: -9, s: 5.5 },
    { x: 6, z: 4, a: -7, s: 4.5 },
    { x: 8, z: -7, a: -5.5, s: 4.0 },
    { x: -5, z: 8, a: -6, s: 5.0 },
    { x: 0, z: 0, a: 4.5, s: 7.0 },   // central hill
    { x: -1, z: -9, a: 3.0, s: 3.4 }, // bump forming a saddle with the SW well
    { x: 10, z: 9, a: -4.0, s: 3.6 }, // shallow corner basin
  ];
  const loss = (x: number, z: number) => {
    let y = 0;
    for (const w of wells) {
      const dx = x - w.x, dz = z - w.z;
      y += w.a * Math.exp(-(dx * dx + dz * dz) / (2 * w.s * w.s));
    }
    return y;
  };
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

  // ---- shaded filled surface ----
  const plane = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  plane.rotateX(-Math.PI / 2);
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
  const heightColor = (y: number, brightenValleys: number) => {
    const f = (y - minY) / (maxY - minY);
    if (f < 0.5) tmp.copy(mixColor(PALETTE.cyan, PALETTE.blue, f * 2));
    else tmp.copy(mixColor(PALETTE.blue, PALETTE.violet, (f - 0.5) * 2));
    const b = 0.4 + (1 - f) * brightenValleys;
    return { f, b };
  };
  for (let i = 0; i < pos.count; i++) {
    const { b } = heightColor(pos.getY(i), 0.5);
    col[i * 3] = tmp.r * b; col[i * 3 + 1] = tmp.g * b; col[i * 3 + 2] = tmp.b * b;
  }
  plane.setAttribute('color', new THREE.BufferAttribute(col, 3));
  pos.needsUpdate = true;
  plane.computeVertexNormals();

  const surfMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const surfFill = new THREE.Mesh(plane, surfMat);

  // ---- glowing wireframe over the fill ----
  const wire = new THREE.WireframeGeometry(plane);
  const wpos = wire.attributes.position as THREE.BufferAttribute;
  const wcol = new Float32Array(wpos.count * 3);
  for (let i = 0; i < wpos.count; i++) {
    const { b } = heightColor(wpos.getY(i), 0.4);
    wcol[i * 3] = tmp.r * b; wcol[i * 3 + 1] = tmp.g * b; wcol[i * 3 + 2] = tmp.b * b;
  }
  wire.setAttribute('color', new THREE.BufferAttribute(wcol, 3));
  const wireMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.26,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const surface = new THREE.LineSegments(wire, wireMat);

  const group = new THREE.Group();
  group.add(surfFill);
  group.add(surface);
  group.position.y = -2;
  scene.add(group);

  // ---- contour lines at evenly spaced heights (marching-squares per cell) ----
  // Build line segments where the surface crosses each level. One-time cost.
  const LEVELS = 9;
  const contourPts: number[] = [];
  const contourCol: number[] = [];
  const gx = (ix: number) => -HALF + (ix / SEG) * SIZE;
  const gz = (iz: number) => -HALF + (iz / SEG) * SIZE;
  // sample loss on the grid once
  const H = new Float32Array((SEG + 1) * (SEG + 1));
  for (let iz = 0; iz <= SEG; iz++)
    for (let ix = 0; ix <= SEG; ix++)
      H[iz * (SEG + 1) + ix] = loss(gx(ix), gz(iz));
  const at = (ix: number, iz: number) => H[iz * (SEG + 1) + ix];
  const lerpEdge = (xa: number, za: number, va: number, xb: number, zb: number, vb: number, lv: number, outPush: (x: number, z: number) => void) => {
    const t = (lv - va) / (vb - va);
    outPush(xa + (xb - xa) * t, za + (zb - za) * t);
  };
  for (let li = 0; li < LEVELS; li++) {
    const lv = minY + ((li + 0.5) / LEVELS) * (maxY - minY);
    const { b } = heightColor(lv, 0.5);
    const cr = tmp.r * (b + 0.25), cg = tmp.g * (b + 0.25), cb = tmp.b * (b + 0.25);
    for (let iz = 0; iz < SEG; iz++) {
      for (let ix = 0; ix < SEG; ix++) {
        const v0 = at(ix, iz), v1 = at(ix + 1, iz), v2 = at(ix + 1, iz + 1), v3 = at(ix, iz + 1);
        const x0 = gx(ix), x1 = gx(ix + 1), z0 = gz(iz), z1 = gz(iz + 1);
        // collect crossing points on the 4 cell edges
        const pts: number[] = [];
        const push = (x: number, z: number) => pts.push(x, z);
        if ((v0 < lv) !== (v1 < lv)) lerpEdge(x0, z0, v0, x1, z0, v1, lv, push);
        if ((v1 < lv) !== (v2 < lv)) lerpEdge(x1, z0, v1, x1, z1, v2, lv, push);
        if ((v2 < lv) !== (v3 < lv)) lerpEdge(x1, z1, v2, x0, z1, v3, lv, push);
        if ((v3 < lv) !== (v0 < lv)) lerpEdge(x0, z1, v3, x0, z0, v0, lv, push);
        // connect pairs of crossings into segments, lifted slightly above surf
        for (let k = 0; k + 3 < pts.length; k += 4) {
          contourPts.push(pts[k], lv + 0.08, pts[k + 1], pts[k + 2], lv + 0.08, pts[k + 3]);
          contourCol.push(cr, cg, cb, cr, cg, cb);
        }
      }
    }
  }
  const contourGeo = new THREE.BufferGeometry();
  contourGeo.setAttribute('position', new THREE.Float32BufferAttribute(contourPts, 3));
  contourGeo.setAttribute('color', new THREE.Float32BufferAttribute(contourCol, 3));
  const contourMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.LineSegments(contourGeo, contourMat));

  // ---- sparse gradient arrow field (downhill direction = -grad) ----
  const AStep = mobile ? 6 : 5;             // grid stride
  const arrowPts: number[] = [];
  const g2tmp = new THREE.Vector2();
  for (let iz = 2; iz < SEG - 1; iz += AStep) {
    for (let ix = 2; ix < SEG - 1; ix += AStep) {
      const x = gx(ix), z = gz(iz);
      grad(x, z, g2tmp);
      const gm = Math.hypot(g2tmp.x, g2tmp.y);
      if (gm < 0.04) continue;
      // downhill unit vector
      const ux = -g2tmp.x / gm, uz = -g2tmp.y / gm;
      const len = Math.min(1.6, 0.6 + gm * 1.2);
      const y = loss(x, z) + 0.14;
      const ex = x + ux * len, ez = z + uz * len, ey = loss(ex, ez) + 0.14;
      // shaft
      arrowPts.push(x, y, z, ex, ey, ez);
      // arrowhead barbs (in-plane perpendicular)
      const px = -uz, pz = ux, bb = len * 0.32;
      arrowPts.push(ex, ey, ez, ex - ux * bb + px * bb, ey, ez - uz * bb + pz * bb);
      arrowPts.push(ex, ey, ez, ex - ux * bb - px * bb, ey, ez - uz * bb - pz * bb);
    }
  }
  const arrowGeo = new THREE.BufferGeometry();
  arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute(arrowPts, 3));
  const arrowMat = new THREE.LineBasicMaterial({
    color: PALETTE.cyan, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.LineSegments(arrowGeo, arrowMat));

  // ---- descending marker + halo ----
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 18, 18),
    new THREE.MeshBasicMaterial({ color: PALETTE.amber }),
  );
  group.add(ball);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 16, 16),
    new THREE.MeshBasicMaterial({
      color: PALETTE.amber, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  group.add(halo);

  // ---- comet trail ----
  const TRAIL = 110;
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
  let vx = 0, vz = 0;          // momentum velocity
  let trailLen = 0;
  let settleTimer = 0;
  const LR = 0.9;             // learning-rate-ish step scale
  const MOMENTUM = 0.82;      // heavy-ball momentum
  const LIFT = 0.9;

  const respawn = () => {
    px = (Math.random() * 2 - 1) * HALF * 0.9;
    pz = (Math.random() * 2 - 1) * HALF * 0.9;
    vx = 0; vz = 0;
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
      trailPos.copyWithin(0, 3);
      const i = (TRAIL - 1) * 3;
      trailPos[i] = x; trailPos[i + 1] = y; trailPos[i + 2] = z;
    }
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

  // Seed a partway-descended static frame so reduced-motion shows the marker
  // mid-slope with a trail behind it, not parked at a random spawn.
  {
    px = 9; pz = 9; // start in the shallow corner basin's ridge
    for (let s = 0; s < 40; s++) {
      grad(px, pz, g2);
      vx = MOMENTUM * vx - g2.x * LR * 0.06 * 8;
      vz = MOMENTUM * vz - g2.y * LR * 0.06 * 8;
      px = Math.max(-HALF, Math.min(HALF, px + vx * 0.06));
      pz = Math.max(-HALF, Math.min(HALF, pz + vz * 0.06));
      pushTrail(px, loss(px, pz) + LIFT, pz);
    }
    const y0 = loss(px, pz);
    ball.position.set(px, y0 + LIFT, pz);
    halo.position.copy(ball.position);
  }

  onFrame((t, dt) => {
    const step = Math.min(dt, 0.05);
    // heavy-ball momentum on the true gradient
    grad(px, pz, g2);
    const gmag = Math.hypot(g2.x, g2.y);
    vx = MOMENTUM * vx - g2.x * LR * step * 8;
    vz = MOMENTUM * vz - g2.y * LR * step * 8;
    px += vx * step;
    pz += vz * step;
    px = Math.max(-HALF, Math.min(HALF, px));
    pz = Math.max(-HALF, Math.min(HALF, pz));

    const y = loss(px, pz);
    ball.position.set(px, y + LIFT, pz);
    halo.position.copy(ball.position);
    halo.scale.setScalar(1 + 0.16 * Math.sin(t * 4));

    pushTrail(px, y + LIFT, pz);

    // converged when both gradient and momentum are ~flat
    const speed = Math.hypot(vx, vz);
    if (gmag < 0.05 && speed < 0.4) {
      settleTimer += step;
      if (settleTimer > 1.4) respawn();
    } else settleTimer = 0;

    group.rotation.y += step * 0.12; // slow turntable
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, ctx.pointer.x * 6, 0.04);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, 12 + ctx.pointer.y * 4, 0.04);
    camera.lookAt(0, -3, 0);
  });

  onDispose(() => {
    plane.dispose(); surfMat.dispose();
    wire.dispose(); wireMat.dispose();
    contourGeo.dispose(); contourMat.dispose();
    arrowGeo.dispose(); arrowMat.dispose();
    ball.geometry.dispose(); (ball.material as THREE.Material).dispose();
    halo.geometry.dispose(); (halo.material as THREE.Material).dispose();
    trailGeo.dispose(); trailMat.dispose();
  });
}
