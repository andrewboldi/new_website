/**
 * Point-cloud shape generators. Each fills a positions Float32Array (N*3) and a
 * matching colors array, normalized to roughly fit radius R. They're shared by
 * the morphing background field and several standalone scenes, so every
 * visualization across the site speaks the same visual language.
 *
 * Each shape maps to one of Andrew's fields:
 *   cloud → latent chemical space / ML      helix → molecular biology
 *   benzene → organic chemistry             orbital → quantum / phys chem
 *   wave → statistical mechanics / physics  neural → deep learning
 *   lattice → solid state / E&M             ring → topology / math
 */
import * as THREE from 'three';
import { PALETTE } from './core';

export type ShapeGen = (pos: Float32Array, col: Float32Array, N: number, R: number) => void;

const C = {
  blue: new THREE.Color(PALETTE.blue),
  cyan: new THREE.Color(PALETTE.cyan),
  violet: new THREE.Color(PALETTE.violet),
  amber: new THREE.Color(PALETTE.amber),
  white: new THREE.Color(0xdfeaff),
};
const set = (col: Float32Array, i: number, c: THREE.Color) => {
  col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const tmp = new THREE.Color();

/** Soft glowing sphere — latent chemical space. */
export const cloud: ShapeGen = (pos, col, N, R) => {
  for (let i = 0; i < N; i++) {
    const r = R * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);
    const t = r / R;
    tmp.copy(C.cyan).lerp(C.blue, t).lerp(C.violet, Math.max(0, t - 0.55));
    set(col, i, tmp);
  }
};

/** DNA double helix — molecular biology. */
export const helix: ShapeGen = (pos, col, N, R) => {
  const turns = 3.2, rad = R * 0.42, H = R * 1.9;
  const strand = (t: number, offset: number) => {
    const y = (t - 0.5) * H;
    const a = t * turns * Math.PI * 2 + offset;
    return [Math.cos(a) * rad, y, Math.sin(a) * rad] as const;
  };
  for (let i = 0; i < N; i++) {
    const u = i / N;
    if (u < 0.4) {
      const t = (i / (0.4 * N));
      const [x, y, z] = strand(t, 0);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      set(col, i, C.cyan);
    } else if (u < 0.8) {
      const t = ((i - 0.4 * N) / (0.4 * N));
      const [x, y, z] = strand(t, Math.PI);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      set(col, i, C.blue);
    } else {
      const t = Math.random();
      const s = Math.random();
      const a = strand(t, 0), b = strand(t, Math.PI);
      pos[i * 3] = a[0] + (b[0] - a[0]) * s;
      pos[i * 3 + 1] = a[1] + (b[1] - a[1]) * s;
      pos[i * 3 + 2] = a[2] + (b[2] - a[2]) * s;
      set(col, i, C.amber);
    }
  }
};

/** Aromatic ring + π-electron cloud — organic chemistry. Voluminous so it
 *  always fills the frame as a glowing molecular disc. */
export const benzene: ShapeGen = (pos, col, N, R) => {
  const ringR = R * 0.92;
  const verts: [number, number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    verts.push([Math.cos(a) * ringR, Math.sin(a) * ringR, 0]);
  }
  for (let i = 0; i < N; i++) {
    const u = i / N;
    if (u < 0.5) {
      // sigma framework: along the 6 ring edges
      const e = Math.floor(Math.random() * 6);
      const a = verts[e], b = verts[(e + 1) % 6];
      const s = Math.random();
      pos[i * 3] = a[0] + (b[0] - a[0]) * s + rand(-0.05, 0.05) * R;
      pos[i * 3 + 1] = a[1] + (b[1] - a[1]) * s + rand(-0.05, 0.05) * R;
      pos[i * 3 + 2] = rand(-0.06, 0.06) * R;
      tmp.copy(C.white).lerp(C.cyan, Math.random() * 0.6);
      set(col, i, tmp);
    } else {
      // π cloud: two flattened lobes above/below the ring plane
      const rr = ringR * (0.2 + 0.85 * Math.sqrt(Math.random()));
      const ang = Math.random() * Math.PI * 2;
      const sign = Math.random() < 0.5 ? 1 : -1;
      const zlobe = sign * (R * 0.16 + Math.abs(rand(0, R * 0.34)) * (1 - rr / (ringR * 1.1)));
      pos[i * 3] = Math.cos(ang) * rr;
      pos[i * 3 + 1] = Math.sin(ang) * rr;
      pos[i * 3 + 2] = zlobe;
      tmp.copy(C.violet).lerp(C.blue, Math.random() * 0.5);
      set(col, i, tmp);
    }
  }
};

/** d_z² atomic orbital with phase coloring — quantum / physical chemistry. */
export const orbital: ShapeGen = (pos, col, N, R) => {
  for (let i = 0; i < N; i++) {
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = Math.random() * Math.PI * 2;
    const ang = 3 * Math.cos(theta) ** 2 - 1; // d_z² angular part (signed)
    const mag = Math.abs(ang);
    const r = R * 0.82 * (0.35 + 0.65 * Math.cbrt(Math.random())) * (0.25 + mag);
    pos[i * 3] = r * Math.sin(theta) * Math.cos(phi);
    pos[i * 3 + 1] = r * Math.cos(theta);
    pos[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);
    set(col, i, ang >= 0 ? C.cyan : C.violet); // wavefunction phase
  }
};

/** Energy / probability surface in the XY plane (faces the camera) —
 *  statistical mechanics & physics. */
export const wave: ShapeGen = (pos, col, N, R) => {
  const G = Math.floor(Math.sqrt(N));
  const span = R * 2.0;
  for (let i = 0; i < N; i++) {
    const ix = i % G, iy = Math.floor(i / G);
    const x = (ix / (G - 1) - 0.5) * span;
    const y = (iy / (G - 1) - 0.5) * span;
    const z = (Math.sin(x * 0.22) * Math.cos(y * 0.2) + Math.sin(x * 0.1 + y * 0.13)) * R * 0.34;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const t = (z / (R * 0.5)) * 0.5 + 0.5;
    tmp.copy(C.blue).lerp(C.cyan, t).lerp(C.violet, Math.max(0, t - 0.7));
    set(col, i, tmp);
  }
};

/** Layered MLP — deep learning. */
export const neural: ShapeGen = (pos, col, N, R) => {
  const layers = [5, 8, 8, 4];
  const L = layers.length;
  const nodeFrac = 0.4;
  const nodePos: [number, number, number][] = [];
  layers.forEach((count, li) => {
    const x = (li / (L - 1) - 0.5) * R * 1.7;
    for (let n = 0; n < count; n++) {
      const y = (n / Math.max(1, count - 1) - 0.5) * R * 1.3;
      nodePos.push([x, y, rand(-0.06, 0.06) * R]);
    }
  });
  for (let i = 0; i < N; i++) {
    if (i / N < nodeFrac) {
      const p = nodePos[Math.floor(Math.random() * nodePos.length)];
      pos[i * 3] = p[0] + rand(-0.03, 0.03) * R;
      pos[i * 3 + 1] = p[1] + rand(-0.03, 0.03) * R;
      pos[i * 3 + 2] = p[2] + rand(-0.03, 0.03) * R;
      set(col, i, C.cyan);
    } else {
      // a point along an edge between adjacent layers
      let li = 0, base = 0;
      const r = Math.random();
      // pick a layer gap weighted evenly
      const gap = Math.floor(r * (L - 1));
      let start = 0;
      for (let k = 0; k < gap; k++) start += layers[k];
      const aIdx = start + Math.floor(Math.random() * layers[gap]);
      const bIdx = start + layers[gap] + Math.floor(Math.random() * layers[gap + 1]);
      const a = nodePos[aIdx], b = nodePos[bIdx];
      const s = Math.random();
      pos[i * 3] = a[0] + (b[0] - a[0]) * s;
      pos[i * 3 + 1] = a[1] + (b[1] - a[1]) * s;
      pos[i * 3 + 2] = a[2] + (b[2] - a[2]) * s;
      tmp.copy(C.blue).lerp(C.violet, s * 0.5);
      set(col, i, tmp);
      void li; void base;
    }
  }
};

/** Crystalline lattice — solid state / condensed matter. */
export const lattice: ShapeGen = (pos, col, N, R) => {
  const G = Math.max(3, Math.round(Math.cbrt(N / 1.6)));
  const span = R * 1.5;
  let idx = 0;
  for (let i = 0; i < N; i++) {
    const ix = idx % G, iy = Math.floor(idx / G) % G, iz = Math.floor(idx / (G * G)) % G;
    idx++;
    const jitter = R * 0.02;
    pos[i * 3] = (ix / (G - 1) - 0.5) * span + rand(-jitter, jitter);
    pos[i * 3 + 1] = (iy / (G - 1) - 0.5) * span + rand(-jitter, jitter);
    pos[i * 3 + 2] = (iz / (G - 1) - 0.5) * span + rand(-jitter, jitter);
    tmp.copy(C.blue).lerp(C.cyan, ((ix + iy + iz) % 2) ? 0.7 : 0.1);
    set(col, i, tmp);
  }
};

export const SHAPES: Record<string, ShapeGen> = {
  cloud, helix, benzene, orbital, wave, neural, lattice,
};
