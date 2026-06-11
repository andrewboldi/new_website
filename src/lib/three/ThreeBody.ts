/**
 * ThreeBody — three masses orbiting under mutual gravity, leaving glowing trails.
 * The chaotic dance Andrew chased invariants in (his `tbp` repo). It re-seeds
 * whenever the system flings a body off to infinity.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

interface Body { p: THREE.Vector3; v: THREE.Vector3; m: number; color: THREE.Color; mesh: THREE.Mesh; trail: Float32Array; head: number; line: THREE.Line; }

export function threeBody(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;
  camera.position.set(0, 0, 42);

  const group = new THREE.Group();
  scene.add(group);
  scene.add(new THREE.AmbientLight(0x556699, 0.8));

  const COLORS = [PALETTE.cyan, PALETTE.blue, PALETTE.amber];
  const TRAIL = 260;
  const bodies: Body[] = [];
  const sphere = new THREE.IcosahedronGeometry(0.9, 3);

  const seed = () => {
    for (const b of bodies) { group.remove(b.mesh); group.remove(b.line); (b.line.geometry as THREE.BufferGeometry).dispose(); (b.mesh.material as THREE.Material).dispose(); }
    bodies.length = 0;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.random() * 0.4;
      const r = 7 + Math.random() * 3;
      const p = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 3);
      const v = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(1.1 + Math.random() * 0.3);
      const color = new THREE.Color(COLORS[i]);
      const mesh = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color }));
      group.add(mesh);
      const trail = new THREE.Float32Array(TRAIL * 3);
      for (let k = 0; k < TRAIL; k++) { trail[k * 3] = p.x; trail[k * 3 + 1] = p.y; trail[k * 3 + 2] = p.z; }
      const tgeo = new THREE.BufferGeometry();
      tgeo.setAttribute('position', new THREE.BufferAttribute(trail, 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(tgeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
      group.add(line);
      bodies.push({ p, v, m: 1, color, mesh, trail, head: 0, line });
    }
  };
  seed();

  const G = 1.4, soft = 1.2;
  const acc = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let resetT = 0;

  onFrame((t, dt) => {
    const h = Math.min(dt, 0.033);
    for (let sub = 0; sub < 3; sub++) {
      for (let i = 0; i < 3; i++) acc[i].set(0, 0, 0);
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        const d = bodies[j].p.clone().sub(bodies[i].p);
        const r2 = d.lengthSq() + soft;
        const f = (G * bodies[i].m * bodies[j].m) / r2;
        d.normalize().multiplyScalar(f);
        acc[i].add(d); acc[j].sub(d);
      }
      for (let i = 0; i < 3; i++) {
        bodies[i].v.addScaledVector(acc[i], h);
        bodies[i].p.addScaledVector(bodies[i].v, h);
      }
    }
    let diverged = false;
    for (const b of bodies) {
      b.mesh.position.copy(b.p);
      if (b.p.length() > 60) diverged = true;
      b.head = (b.head + 1) % TRAIL;
      b.trail[b.head * 3] = b.p.x; b.trail[b.head * 3 + 1] = b.p.y; b.trail[b.head * 3 + 2] = b.p.z;
      (b.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    group.rotation.y = Math.sin(t * 0.08) * 0.3;
    group.rotation.x = -0.15 + ctx.pointer.y * 0.15;
    resetT += dt;
    if (diverged || resetT > 26) { resetT = 0; seed(); }
  });

  onDispose(() => {
    sphere.dispose();
    bodies.forEach((b) => { (b.line.geometry as THREE.BufferGeometry).dispose(); (b.line.material as THREE.Material).dispose(); (b.mesh.material as THREE.Material).dispose(); });
  });
}
