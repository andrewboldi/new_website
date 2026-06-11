/**
 * RubiksCube — a 3×3×3 cube that endlessly turns its layers, for the cubing
 * easter egg (Andrew solves the 3×3 in 9.42s, and blindfolded).
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';

const FACE = { R: 0xb71234, L: 0xff5800, U: 0xffffff, D: 0xffd500, F: 0x009b48, B: 0x0046ad, inner: 0x0c0e14 };
type Axis = 'x' | 'y' | 'z';

export function rubiksCube(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;
  camera.position.set(4.4, 4.2, 6.4);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dir = new THREE.DirectionalLight(0xffffff, 1.7); dir.position.set(6, 9, 7); scene.add(dir);

  const cube = new THREE.Group();
  cube.rotation.x = -0.25;
  scene.add(cube);

  const S = 0.94;
  const geo = new THREE.BoxGeometry(S, S, S);
  const cubies: { mesh: THREE.Mesh; pos: THREE.Vector3 }[] = [];
  const mats: THREE.Material[] = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const faceCols = [
      x === 1 ? FACE.R : FACE.inner, x === -1 ? FACE.L : FACE.inner,
      y === 1 ? FACE.U : FACE.inner, y === -1 ? FACE.D : FACE.inner,
      z === 1 ? FACE.F : FACE.inner, z === -1 ? FACE.B : FACE.inner,
    ].map((c) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.42, metalness: 0.05 }); mats.push(m); return m; });
    const m = new THREE.Mesh(geo, faceCols);
    m.position.set(x, y, z);
    cube.add(m);
    cubies.push({ mesh: m, pos: new THREE.Vector3(x, y, z) });
  }

  const axes: Axis[] = ['x', 'y', 'z'];
  let move: { axis: Axis; coord: number; d: number; angle: number; target: number; pivot: THREE.Group } | null = null;
  const pickMove = () => {
    const axis = axes[Math.floor(Math.random() * 3)];
    const coord = [-1, 0, 1][Math.floor(Math.random() * 3)];
    const d = Math.random() < 0.5 ? 1 : -1;
    const pivot = new THREE.Group(); cube.add(pivot);
    cubies.filter((c) => Math.round(c.pos[axis]) === coord).forEach((c) => pivot.attach(c.mesh));
    move = { axis, coord, d, angle: 0, target: (d * Math.PI) / 2, pivot };
  };
  pickMove();

  onFrame((_t, dt) => {
    cube.rotation.y += dt * 0.45;
    if (!move) return;
    move.angle += dt * 5.2 * Math.sign(move.target);
    const done = Math.abs(move.angle) >= Math.abs(move.target);
    move.pivot.rotation[move.axis] = done ? move.target : move.angle;
    if (!done) return;
    move.pivot.updateMatrixWorld(true);
    [...move.pivot.children].forEach((ch) => cube.attach(ch));
    cube.remove(move.pivot);
    const a = move.axis, d = move.d;
    cubies.forEach((c) => {
      if (Math.round(c.pos[a]) !== move!.coord) return;
      const p = c.pos;
      if (a === 'x') { const y = p.y, z = p.z; p.y = -d * z; p.z = d * y; }
      else if (a === 'y') { const x = p.x, z = p.z; p.x = d * z; p.z = -d * x; }
      else { const x = p.x, y = p.y; p.x = -d * y; p.y = d * x; }
      c.mesh.position.set(Math.round(p.x), Math.round(p.y), Math.round(p.z));
    });
    move = null;
    pickMove();
  });

  onDispose(() => { geo.dispose(); mats.forEach((m) => m.dispose()); });
}
