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

/** Soft glowing sphere — latent chemical space. (Retained in the shape registry;
 *  the morph field's opening stage now uses `molecule` instead.) */
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

/**
 * Caffeine — a real ball-and-stick molecule (the morph field's opening stage,
 * the target of the denoising intro). Atom coordinates are baked from
 * `public/pdb/caffeine.pdb` (centroid-centered, in ångström); bonds come from
 * that file's CONECT records. We don't fake the geometry — this is the actual
 * 1,3,7-trimethylxanthine skeleton (C8N4O2 core + 10 H), so it reads as the
 * iconic med-chem molecule, not a blob.
 *
 * The particle budget is split so atoms become dense glowing clusters and bonds
 * become point-lines between bonded atoms → unmistakably ball-and-stick. Colored
 * by element: carbon soft white-blue, nitrogen cyan, oxygen amber, hydrogen a
 * faint blue. Centroid-centered coords mean MOL_MAX is the molecule's radius, so
 * we scale it to ≈0.95·R to sit at the same scale as the other shapes.
 */
// element index per atom (0..23): 0=C 1=N 2=O 3=H
const MOL_ELEM = [0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3];
// centroid-centered atom coordinates (Å) from caffeine.pdb
const MOL_XYZ = [
  -2.474, 1.279, 0, -3.174, -1.133, 0, 1.621, 2.657, 0, 2.334, -2.148, 0,
  -0.351, -2.4, 0, 3.081, 0.412, 0, 0.071, -1.257, 0, 1.878, 0.236, 0,
  -0.824, -0.166, 0, -0.316, 1.127, 0, -1.358, 1.962, 0, 1.058, 1.305, 0,
  1.399, -1.02, 0, -2.199, -0.04, 0, -3.465, 1.708, 0.004, -3.416, -1.405, 1.028,
  -4.081, -0.812, -0.514, -2.752, -1.997, -0.514, 1.76, 2.993, 1.028, 2.582, 2.651, -0.514,
  0.938, 3.335, -0.514, 2.565, -2.428, -1.028, 3.251, -1.86, 0.513, 1.88, -2.996, 0.514,
];
// bonds (pairs of atom indices) from caffeine.pdb CONECT records
const MOL_BONDS = [
  0, 13, 0, 10, 0, 14, 1, 13, 1, 15, 1, 16, 1, 17, 2, 11, 2, 18, 2, 19, 2, 20,
  3, 12, 3, 21, 3, 22, 3, 23, 4, 6, 5, 7, 6, 8, 6, 12, 7, 11, 7, 12, 8, 9,
  8, 13, 9, 11, 9, 10,
];
const MOL_ATOMS = MOL_ELEM.length;           // 24
const MOL_BOND_COUNT = MOL_BONDS.length / 2;  // 25
// molecule radius (max distance from centroid) for the baked coords above
const MOL_MAX = 4.193;
// per-element render weights: cluster radius (Å, pre-scale), color, point share
const ELEM_COLOR = [
  new THREE.Color(0xcfe0ff), // C — soft white-blue
  C.cyan,                    // N — cyan (ring nitrogens pop)
  C.amber,                   // O — carbonyl oxygens warm
  new THREE.Color(0x6fa8ff), // H — faint blue
];
const ELEM_RADIUS = [0.62, 0.66, 0.7, 0.4]; // C, N, O, H (Å, pre-scale)
const ELEM_WEIGHT = [1.0, 1.15, 1.2, 0.45]; // particle share per atom by element

// scratch: domed z per atom, so the (nearly planar) PDB gains depth and reads
// as a solid ball-and-stick from any spin angle instead of vanishing edge-on.
// Atoms and the bonds joining them share these values, so bonds stay attached.
const MOL_ZDOME = new Float32Array(MOL_ATOMS);
export const molecule: ShapeGen = (pos, col, N, R) => {
  const scale = (R * 0.95) / MOL_MAX;
  // bowl-shaped dome: center pushed forward, rim recedes; small pucker for relief
  for (let a = 0; a < MOL_ATOMS; a++) {
    const x = MOL_XYZ[a * 3], y = MOL_XYZ[a * 3 + 1], z0 = MOL_XYZ[a * 3 + 2];
    const rr = Math.hypot(x, y) / MOL_MAX;            // 0..1 radial
    const dome = (0.5 - rr * rr) * 0.9;                // forward center, receding rim
    const pucker = Math.sin(x * 1.3) * Math.cos(y * 1.3) * 0.18;
    MOL_ZDOME[a] = (z0 + (dome + pucker) * MOL_MAX) * scale;
  }
  // Split budget: ~52% to atom clusters, ~48% to bond lines.
  const atomBudget = Math.round(N * 0.52);
  // Distribute atom particles proportional to element weight so heavy atoms read
  // as denser glowing balls and the many H's don't swamp them.
  let wSum = 0;
  for (let a = 0; a < MOL_ATOMS; a++) wSum += ELEM_WEIGHT[MOL_ELEM[a]];
  let written = 0;
  for (let a = 0; a < MOL_ATOMS; a++) {
    const el = MOL_ELEM[a];
    const ax = MOL_XYZ[a * 3] * scale, ay = MOL_XYZ[a * 3 + 1] * scale, az = MOL_ZDOME[a];
    const rad = ELEM_RADIUS[el] * scale;
    let cnt = a === MOL_ATOMS - 1
      ? atomBudget - written
      : Math.round((atomBudget * ELEM_WEIGHT[el]) / wSum);
    if (cnt < 0) cnt = 0;
    const baseCol = ELEM_COLOR[el];
    for (let k = 0; k < cnt && written < atomBudget; k++, written++) {
      // gaussian-ish cluster (denser core) around the atom
      const r = rad * Math.cbrt(Math.random()) * (0.55 + 0.45 * Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const i = written;
      pos[i * 3] = ax + r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = ay + r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = az + r * Math.cos(phi);
      // bright core fades to element color outward
      tmp.copy(C.white).lerp(baseCol, Math.min(1, r / rad + 0.15));
      set(col, i, tmp);
    }
  }
  // Bonds: remaining particles spread along bond segments as thin point-lines.
  const a0 = written;
  const bondParticles = N - a0;
  for (let b = 0; b < bondParticles; b++) {
    const i = a0 + b;
    const e = b % MOL_BOND_COUNT;
    const ia = MOL_BONDS[e * 2], ib = MOL_BONDS[e * 2 + 1];
    const x1 = MOL_XYZ[ia * 3] * scale, y1 = MOL_XYZ[ia * 3 + 1] * scale, z1 = MOL_ZDOME[ia];
    const x2 = MOL_XYZ[ib * 3] * scale, y2 = MOL_XYZ[ib * 3 + 1] * scale, z2 = MOL_ZDOME[ib];
    const s = Math.random();
    const jx = (Math.random() - 0.5) * 0.12 * scale;
    const jy = (Math.random() - 0.5) * 0.12 * scale;
    const jz = (Math.random() - 0.5) * 0.12 * scale;
    pos[i * 3] = x1 + (x2 - x1) * s + jx;
    pos[i * 3 + 1] = y1 + (y2 - y1) * s + jy;
    pos[i * 3 + 2] = z1 + (z2 - z1) * s + jz;
    // bond color: blend the two atoms' element colors, dimmed toward cyan
    tmp.copy(ELEM_COLOR[MOL_ELEM[ia]]).lerp(ELEM_COLOR[MOL_ELEM[ib]], s).lerp(C.cyan, 0.35);
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
  cloud, molecule, helix, benzene, orbital, wave, neural, lattice,
};
