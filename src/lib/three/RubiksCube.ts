/**
 * RubiksCube — a GAN-style 3×3×3 speedcube that endlessly SOLVES itself, for
 * the cubing easter egg (Andrew solves the 3×3 in 9.42s, and blindfolded).
 *
 * It is not faked: each cycle generates a random scramble sequence S, applies S
 * quickly to reach a genuinely scrambled state, then animates the inverse
 * solution reverse(S)⁻¹ move-by-move at a satisfying speed, ending in a
 * perfectly solved cube — a real algorithmic solution with valid moves. Holds
 * on the solved cube, then scrambles and solves again, forever.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SceneHandle } from './core';
import { prefersReducedMotion } from './core';

// Standard speedcube sticker scheme (GAN-style bright), dark plastic body.
const FACE = {
  R: 0xc41e3a, // red
  L: 0xff5800, // orange
  U: 0xffffff, // white
  D: 0xffd500, // yellow
  F: 0x009b48, // green
  B: 0x0046ad, // blue
};
const BODY = 0x0a0c12; // near-black plastic

type Axis = 'x' | 'y' | 'z';
type Move = { axis: Axis; coord: number; dir: number };

/** Build a "GAN" wordmark sticker as a CanvasTexture (clean bold sans). */
function ganLogoTexture(bg: number): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const col = new THREE.Color(bg);
  g.fillStyle = `#${col.getHexString()}`;
  g.fillRect(0, 0, s, s);
  // subtle inner vignette so the logo reads as an inset cap
  const grad = g.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.7);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  g.font = `900 ${s * 0.32}px "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.letterSpacing = '1px';
  // crisp deep-red wordmark with a faint dark outline so it reads on white
  g.lineWidth = s * 0.012;
  g.strokeStyle = 'rgba(40,0,0,0.35)';
  g.strokeText('GAN', s / 2, s / 2 + s * 0.02);
  g.fillStyle = '#b00d28';
  g.fillText('GAN', s / 2, s / 2 + s * 0.02);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function rubiksCube(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;
  const reduced = prefersReducedMotion();

  camera.position.set(4.6, 4.4, 6.6);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(6, 9, 7); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.7); fill.position.set(-7, -3, 4); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(-4, 6, -8); scene.add(rim);

  const cube = new THREE.Group();
  cube.rotation.x = -0.28;
  cube.rotation.y = -0.55;
  scene.add(cube);

  // ---- geometry / materials (GAN look: rounded plastic + inset glossy stickers) ----
  const disposables: Array<{ dispose: () => void }> = [];
  const BODY_SIZE = 0.96;
  const bodyGeo = new RoundedBoxGeometry(BODY_SIZE, BODY_SIZE, BODY_SIZE, 5, 0.14);
  disposables.push(bodyGeo);
  const bodyMat = new THREE.MeshStandardMaterial({ color: BODY, roughness: 0.55, metalness: 0.12 });
  disposables.push(bodyMat);

  // a slightly rounded thin tile for stickers, sits proud of and inset from each face
  const STICKER = 0.80;
  const stickerGeo = new RoundedBoxGeometry(STICKER, STICKER, 0.04, 4, 0.06);
  disposables.push(stickerGeo);

  const ganTex = ganLogoTexture(FACE.U);
  disposables.push(ganTex);

  type FaceDef = { col: number; n: THREE.Vector3; cond: (x: number, y: number, z: number) => boolean };
  const half = BODY_SIZE / 2 + 0.001;
  const faceDefs: FaceDef[] = [
    { col: FACE.R, n: new THREE.Vector3(1, 0, 0), cond: (x) => x === 1 },
    { col: FACE.L, n: new THREE.Vector3(-1, 0, 0), cond: (x) => x === -1 },
    { col: FACE.U, n: new THREE.Vector3(0, 1, 0), cond: (_x, y) => y === 1 },
    { col: FACE.D, n: new THREE.Vector3(0, -1, 0), cond: (_x, y) => y === -1 },
    { col: FACE.F, n: new THREE.Vector3(0, 0, 1), cond: (_x, _y, z) => z === 1 },
    { col: FACE.B, n: new THREE.Vector3(0, 0, -1), cond: (_x, _y, z) => z === -1 },
  ];

  const cubies: { mesh: THREE.Group; pos: THREE.Vector3; home: THREE.Vector3 }[] = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    g.add(body);
    for (const f of faceDefs) {
      if (!f.cond(x, y, z)) continue;
      const isGanCap = f.col === FACE.U && x === 0 && y === 1 && z === 0;
      const mat = new THREE.MeshStandardMaterial({
        color: isGanCap ? 0xffffff : f.col,
        map: isGanCap ? ganTex : null,
        roughness: 0.22,
        metalness: 0.04,
        emissive: new THREE.Color(f.col).multiplyScalar(isGanCap ? 0.04 : 0.08),
      });
      disposables.push(mat);
      const tile = new THREE.Mesh(stickerGeo, mat);
      // orient the thin tile so its face points along the normal, then push it out
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.n);
      tile.quaternion.copy(q);
      tile.position.copy(f.n).multiplyScalar(half);
      g.add(tile);
    }
    g.position.set(x, y, z);
    cube.add(g);
    cubies.push({ mesh: g, pos: new THREE.Vector3(x, y, z), home: new THREE.Vector3(x, y, z) });
  }

  // ---- move engine (reuses pivot attach/detach + integer coordinate update) ----
  const TAU4 = Math.PI / 2;
  let active: { axis: Axis; coord: number; dir: number; angle: number; target: number; pivot: THREE.Group; speed: number } | null = null;

  const beginMove = (m: Move, speed: number) => {
    const pivot = new THREE.Group();
    cube.add(pivot);
    cubies.filter((c) => Math.round(c.pos[m.axis]) === m.coord).forEach((c) => pivot.attach(c.mesh));
    active = { axis: m.axis, coord: m.coord, dir: m.dir, angle: 0, target: m.dir * TAU4, pivot, speed };
  };

  const finishMove = () => {
    if (!active) return;
    const { axis: a, coord, dir: d, target, pivot } = active;
    pivot.rotation[a] = target;
    pivot.updateMatrixWorld(true);
    [...pivot.children].forEach((ch) => cube.attach(ch));
    cube.remove(pivot);
    cubies.forEach((c) => {
      if (Math.round(c.pos[a]) !== coord) return;
      const p = c.pos;
      if (a === 'x') { const y = p.y, z = p.z; p.y = -d * z; p.z = d * y; }
      else if (a === 'y') { const x = p.x, z = p.z; p.x = d * z; p.z = -d * x; }
      else { const x = p.x, y = p.y; p.x = -d * y; p.y = d * x; }
      c.mesh.position.set(Math.round(p.x), Math.round(p.y), Math.round(p.z));
    });
    active = null;
  };

  // ---- scramble / solve sequencing ----
  const axes: Axis[] = ['x', 'y', 'z'];
  // Build a scramble with no trivially-cancelling consecutive moves (same axis+coord).
  const makeScramble = (n: number): Move[] => {
    const seq: Move[] = [];
    let prevAxis: Axis | null = null;
    let prevCoord = NaN;
    while (seq.length < n) {
      const axis = axes[(Math.random() * 3) | 0];
      const coord = [-1, 0, 1][(Math.random() * 3) | 0];
      const dir = Math.random() < 0.5 ? 1 : -1;
      // avoid acting on the same slice twice in a row (would cancel / look stuttery)
      if (axis === prevAxis && coord === prevCoord) continue;
      seq.push({ axis, coord, dir });
      prevAxis = axis; prevCoord = coord;
    }
    return seq;
  };
  const invert = (seq: Move[]): Move[] =>
    [...seq].reverse().map((m) => ({ axis: m.axis, coord: m.coord, dir: -m.dir }));

  const SCRAMBLE_LEN = 22;
  const SCRAMBLE_SPEED = 13.5; // rad/s — fast flurry
  const SOLVE_SPEED = 6.4;     // rad/s — satisfying, watchable
  const HOLD_SCRAMBLED = 0.45; // s
  const HOLD_SOLVED = 1.6;     // s

  type Phase = 'scramble' | 'holdScrambled' | 'solve' | 'holdSolved';
  let phase: Phase = 'scramble';
  // Solved ⇔ every cubie's logical cell equals its home cell. Because the solve
  // sequence is the exact inverse permutation of the scramble, this is the true
  // solved invariant (sticker orientation follows from the permutation here).
  const isSolved = () =>
    cubies.every((c) => c.pos.x === c.home.x && c.pos.y === c.home.y && c.pos.z === c.home.z);
  let queue: Move[] = makeScramble(SCRAMBLE_LEN);
  let qi = 0;
  let solution: Move[] = invert(queue);
  let holdT = 0;

  const startCycle = () => {
    queue = makeScramble(SCRAMBLE_LEN);
    solution = invert(queue);
    qi = 0;
    phase = 'scramble';
  };

  // Verify-page-only telemetry: the temporary rubikscheck page sets
  // window.__RUBIKS_DEBUG = true to opt in; ships inert otherwise.
  const debug = !!(globalThis as Record<string, unknown>).__RUBIKS_DEBUG;

  // Reduced motion: build a statically-scrambled cube and stop (no turning).
  if (reduced) {
    const fixed = makeScramble(SCRAMBLE_LEN);
    for (const m of fixed) { beginMove(m, 0); finishMove(); }
    onDispose(() => disposables.forEach((d) => d.dispose()));
    return;
  }

  onFrame((_t, dt) => {
    // gentle idle turntable so the solve is shown from changing angles
    cube.rotation.y += dt * 0.28;

    if (active) {
      active.angle += dt * active.speed * Math.sign(active.target);
      if (Math.abs(active.angle) >= Math.abs(active.target)) finishMove();
      else active.pivot.rotation[active.axis] = active.angle;
    } else if (phase === 'scramble') {
      if (qi < queue.length) beginMove(queue[qi++], SCRAMBLE_SPEED);
      else { phase = 'holdScrambled'; holdT = 0; }
    } else if (phase === 'holdScrambled') {
      holdT += dt;
      if (holdT >= HOLD_SCRAMBLED) { qi = 0; phase = 'solve'; }
    } else if (phase === 'solve') {
      if (qi < solution.length) beginMove(solution[qi++], SOLVE_SPEED);
      else { phase = 'holdSolved'; holdT = 0; }
    } else { // holdSolved
      holdT += dt;
      if (holdT >= HOLD_SOLVED) startCycle();
    }

    if (debug) {
      (globalThis as Record<string, unknown>).__rubiks = {
        phase, qi, total: queue.length, solved: isSolved(), cube, camera,
      };
    }
  });

  onDispose(() => disposables.forEach((d) => d.dispose()));
}
