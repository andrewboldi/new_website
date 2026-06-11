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

/**
 * A shape generator fills `pos` (N*3) and `col` (N*3). It MAY optionally fill an
 * `aux` lane (N floats) with a per-point *render weight* in roughly [0.4, 2.2]:
 * bright structural points (nuclei, backbones, atom cores) get large values,
 * diffuse cloud points get small ones. ShapeScene reads this to drive sprite
 * size + glow so the scenes get real chiaroscuro instead of a uniform fuzz.
 * `aux` is optional and undefined in the morph field (which only needs pos+col),
 * so every generator must remain correct when `aux` is not supplied.
 */
export type ShapeGen = (
  pos: Float32Array,
  col: Float32Array,
  N: number,
  R: number,
  aux?: Float32Array,
) => void;

const C = {
  blue: new THREE.Color(PALETTE.blue),
  cyan: new THREE.Color(PALETTE.cyan),
  violet: new THREE.Color(PALETTE.violet),
  amber: new THREE.Color(PALETTE.amber),
  white: new THREE.Color(0xdfeaff),
  rose: new THREE.Color(0xff7eb6),   // base pair A–T
  green: new THREE.Color(0x57e08a),  // base pair G–C
};
const set = (col: Float32Array, i: number, c: THREE.Color) => {
  col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** standard-normal-ish sample (sum of uniforms), for soft gaussian clusters */
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.9;
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

/**
 * B-form DNA double helix — molecular biology. Two antiparallel sugar-phosphate
 * backbones wind around a common axis; rigid base-pair RUNGS bridge them at the
 * discrete ~10.5 bp/turn rise, colored by base pair (A–T rose, G–C green) with a
 * cyan/amber junction where each base meets its strand. The two strands are
 * offset by ~140° (not a flat 180°), which is what opens B-DNA's wide MAJOR and
 * narrow MINOR grooves — so the silhouette reads as real DNA, not a double coil.
 */
export const helix: ShapeGen = (pos, col, N, R, aux) => {
  const BP = 21;                       // base pairs shown
  const RISE = R * 1.92 / BP;          // axial rise per base pair
  const turns = BP / 10.5;             // B-DNA: ~10.5 bp per helical turn
  const rad = R * 0.40;                // backbone helix radius
  const H = RISE * (BP - 1);
  const groove = (140 * Math.PI) / 180; // strand-2 angular offset → grooves
  const W = 1.7;                       // base-pair half-shrink (bases sit inside)

  // Backbone point on strand `k` (0|1) at fractional height t∈[0,1].
  const back = (t: number, k: number) => {
    const a = t * turns * Math.PI * 2 + (k ? groove : 0);
    return [Math.cos(a) * rad, (t - 0.5) * H, Math.sin(a) * rad] as const;
  };

  // Budget: dense beaded backbones + bright phosphate beads, then base-pair rungs.
  const bbStrand = Math.round(N * 0.26);       // points per backbone ribbon
  const phos = Math.round(N * 0.10);           // bright phosphate beads (both strands)
  const rungBudget = N - bbStrand * 2 - phos;  // base-pair rungs
  let i = 0;

  // --- two sugar-phosphate backbones (smooth beaded tubes) ---
  for (let k = 0; k < 2; k++) {
    const bcol = k ? C.blue : C.cyan;
    for (let n = 0; n < bbStrand; n++, i++) {
      const t = n / (bbStrand - 1);
      const [x, y, z] = back(t, k);
      const rr = rand(0, R * 0.05);            // tube thickness
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = x + Math.cos(a) * rr;
      pos[i * 3 + 1] = y + gauss() * R * 0.012;
      pos[i * 3 + 2] = z + Math.sin(a) * rr;
      tmp.copy(bcol).lerp(C.white, Math.random() * 0.25);
      set(col, i, tmp);
      if (aux) aux[i] = 1.0 + Math.random() * 0.3;
    }
  }

  // --- bright phosphate beads pinned at each backbone residue (the "pearls") ---
  for (let n = 0; n < phos; n++, i++) {
    const k = n & 1;
    const t = ((n >> 1) % BP) / (BP - 1);
    const [x, y, z] = back(t, k);
    pos[i * 3] = x + gauss() * R * 0.02;
    pos[i * 3 + 1] = y + gauss() * R * 0.02;
    pos[i * 3 + 2] = z + gauss() * R * 0.02;
    tmp.copy(k ? C.blue : C.cyan).lerp(C.white, 0.5);
    set(col, i, tmp);
    if (aux) aux[i] = 1.9 + Math.random() * 0.4;
  }

  // --- base-pair rungs: a straight ladder rung between the two backbones ---
  for (let r = 0; r < rungBudget; r++, i++) {
    const bp = r % BP;                         // which base pair
    const t = bp / (BP - 1);
    const a0 = back(t, 0), a1 = back(t, 1);
    // bring the bases inward so the pair is shorter than the full diameter
    const cx = (a0[0] + a1[0]) / 2, cz = (a0[2] + a1[2]) / 2;
    const e0x = cx + (a0[0] - cx) / W, e0z = cz + (a0[2] - cz) / W;
    const e1x = cx + (a1[0] - cx) / W, e1z = cz + (a1[2] - cz) / W;
    const s = Math.random();                   // position along the rung
    const isAT = (bp * 7 + 3) % 5 < 3;         // pseudo-random but stable A–T vs G–C
    const baseCol = isAT ? C.rose : C.green;
    // junction near the backbone tints toward that strand's color
    const edge = Math.min(s, 1 - s) * 2;       // 0 at ends, 1 at center
    tmp.copy(s < 0.5 ? C.cyan : C.blue).lerp(baseCol, 0.25 + 0.75 * edge);
    pos[i * 3] = e0x + (e1x - e0x) * s + gauss() * R * 0.018;
    pos[i * 3 + 1] = a0[1] + gauss() * R * 0.012;
    pos[i * 3 + 2] = e0z + (e1z - e0z) * s + gauss() * R * 0.018;
    set(col, i, tmp);
    if (aux) aux[i] = 0.8 + edge * 0.5;        // brighter toward the H-bonded center
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

/**
 * 3d_z² atomic orbital — quantum / physical chemistry. The real thing: two large
 * axial lobes along ±y (the "dumbbell") of POSITIVE wavefunction phase, wrapped
 * by an equatorial TORUS of NEGATIVE phase, separated by the two nodal cones at
 * the magic angle θ≈54.7°. Point density follows |ψ|² (rejection-sampled radial
 * shell × angular weight) so it bunches in the high-probability lobe/ring caps
 * and thins through the nodes — reading as a real orbital, not a fuzzy ball.
 * A bright nucleus marker sits at the origin, and faint points trace the nodal
 * cones so the geometry is legible. Two-tone phase coloring: cyan (+) / violet (−).
 */
export const orbital: ShapeGen = (pos, col, N, R, aux) => {
  // d_z² angular function Y ∝ (3cos²θ − 1); |Y| peaks on-axis (lobes) and in-plane (torus).
  const Y = (ct: number) => 3 * ct * ct - 1;
  const NODE = Math.acos(1 / Math.sqrt(3));    // ≈ 0.9553 rad, the nodal cone angle

  const nucleus = Math.round(N * 0.05);        // dense glowing core marker
  const nodeRing = Math.round(N * 0.06);       // faint tracers on the two nodal cones
  let i = 0;

  // --- nucleus: a tight bright cluster at the origin ---
  for (let n = 0; n < nucleus; n++, i++) {
    const r = R * 0.07 * Math.cbrt(Math.random());
    const th = Math.acos(2 * Math.random() - 1), ph = Math.random() * Math.PI * 2;
    pos[i * 3] = r * Math.sin(th) * Math.cos(ph);
    pos[i * 3 + 1] = r * Math.cos(th);
    pos[i * 3 + 2] = r * Math.sin(th) * Math.sin(ph);
    tmp.copy(C.white).lerp(C.amber, 0.35 * Math.random());
    set(col, i, tmp);
    if (aux) aux[i] = 2.1 + Math.random() * 0.3;
  }

  // --- the orbital cloud: |ψ|²-weighted rejection sampling ---
  // radial part of 3d: ρ²·e^(−ρ/3) shape; we use a peaked shell ~0.45R with falloff.
  const RMAX = R * 0.95;
  let placed = i;
  const cloud = N - nodeRing;
  let guard = 0;
  while (placed < cloud && guard < cloud * 60) {
    guard++;
    const ct = 2 * Math.random() - 1;          // cosθ uniform on sphere
    const th = Math.acos(ct);
    const ph = Math.random() * Math.PI * 2;
    const yv = Y(ct);
    const ang2 = (yv * yv) / 4;                // angular |Y|² weight, ~[0,1]
    // radial: sample r, weight by a peaked 3d-like radial probability
    const rho = Math.random() * 3;             // ρ in units where peak ~ 2
    const radW = (rho * rho) * Math.exp(-rho * 0.9);
    const w = ang2 * radW;
    if (Math.random() > w * 1.15) continue;    // reject low-probability points
    const r = (rho / 3) * RMAX * (0.85 + 0.15 * Math.random());
    const st = Math.sin(th);
    pos[placed * 3] = r * st * Math.cos(ph);
    pos[placed * 3 + 1] = r * ct;
    pos[placed * 3 + 2] = r * st * Math.sin(ph);
    // phase coloring: + lobes cyan, − torus violet; brighten the dense caps
    const positive = yv >= 0;
    const base = positive ? C.cyan : C.violet;
    tmp.copy(base).lerp(C.white, 0.18 * Math.min(1, w * 2));
    set(col, placed, tmp);
    if (aux) aux[placed] = 0.7 + Math.min(1.1, w * 1.4);
    placed++;
  }
  // fill any rejection-sampling shortfall on the dominant +y lobe so N is exact
  for (i = placed; i < cloud; i++) {
    const r = RMAX * (0.4 + 0.5 * Math.random());
    const th = rand(0, 0.5), ph = Math.random() * Math.PI * 2;
    const sgn = Math.random() < 0.5 ? 1 : -1;
    const st = Math.sin(th);
    pos[i * 3] = r * st * Math.cos(ph);
    pos[i * 3 + 1] = sgn * r * Math.cos(th);
    pos[i * 3 + 2] = r * st * Math.sin(ph);
    set(col, i, C.cyan);
    if (aux) aux[i] = 0.8;
  }

  // --- nodal cones: faint dim tracers at θ = NODE and π−NODE (the sign change) ---
  for (let n = 0; n < nodeRing; n++, i++) {
    const sgn = n & 1 ? 1 : -1;
    const th = sgn > 0 ? NODE : Math.PI - NODE;
    const ph = Math.random() * Math.PI * 2;
    const r = RMAX * (0.2 + 0.7 * Math.random());
    const st = Math.sin(th);
    pos[i * 3] = r * st * Math.cos(ph);
    pos[i * 3 + 1] = r * Math.cos(th);
    pos[i * 3 + 2] = r * st * Math.sin(ph);
    tmp.copy(C.white).lerp(C.blue, 0.6);
    set(col, i, tmp);
    if (aux) aux[i] = 0.5;                      // faint, thin — just a hint of the node
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

/**
 * Rock-salt (NaCl) crystal — solid state / condensed matter. A clear 3×3×3 grid
 * of lattice sites forming two interpenetrating FCC sublattices: alternating
 * cations (small, warm amber) and anions (large, cool cyan) by the parity of
 * (ix+iy+iz), the textbook NaCl checkerboard. Nearest neighbors are joined by
 * BONDS running along the x/y/z axes (octahedral coordination) rendered as point
 * lines, so the repeating cubic UNIT CELL is unmistakable. Each atom is a soft
 * gaussian ball (denser core) and carries a small thermal-displacement jitter so
 * it reads as a warm crystal rather than a cold dot grid. Reads as a crystal.
 */
export const lattice: ShapeGen = (pos, col, N, R, aux) => {
  const G = 3;                                  // 3×3×3 sites → clean unit cell
  const span = R * 1.5;
  const step = span / (G - 1);
  const site = (g: number) => (g / (G - 1) - 0.5) * span;

  // collect sites and the axis-aligned nearest-neighbour bonds once
  type Site = { x: number; y: number; z: number; cation: boolean };
  const sites: Site[] = [];
  const bonds: [number, number][] = [];
  const idx = (ix: number, iy: number, iz: number) => (ix * G + iy) * G + iz;
  for (let ix = 0; ix < G; ix++)
    for (let iy = 0; iy < G; iy++)
      for (let iz = 0; iz < G; iz++) {
        sites.push({ x: site(ix), y: site(iy), z: site(iz), cation: ((ix + iy + iz) & 1) === 0 });
        if (ix + 1 < G) bonds.push([idx(ix, iy, iz), idx(ix + 1, iy, iz)]);
        if (iy + 1 < G) bonds.push([idx(ix, iy, iz), idx(ix, iy + 1, iz)]);
        if (iz + 1 < G) bonds.push([idx(ix, iy, iz), idx(ix, iy, iz + 1)]);
      }
  const S = sites.length;       // 27
  const B = bonds.length;       // 54

  // Budget: ~62% to atom balls, ~38% to bonds, so both the sites and the cubic
  // bond cage are clearly legible.
  const atomBudget = Math.round(N * 0.62);
  const cationR = R * 0.07, anionR = R * 0.12;  // anion (Cl⁻) larger than cation (Na⁺)
  let i = 0;
  for (let n = 0; n < atomBudget; n++, i++) {
    const s = sites[n % S];
    const rad = s.cation ? cationR : anionR;
    const r = rad * Math.cbrt(Math.random()) * (0.6 + 0.4 * Math.random());
    const th = Math.acos(2 * Math.random() - 1), ph = Math.random() * Math.PI * 2;
    const thermal = R * 0.012;                  // small thermal smear
    pos[i * 3] = s.x + r * Math.sin(th) * Math.cos(ph) + gauss() * thermal;
    pos[i * 3 + 1] = s.y + r * Math.cos(th) + gauss() * thermal;
    pos[i * 3 + 2] = s.z + r * Math.sin(th) * Math.sin(ph) + gauss() * thermal;
    const baseCol = s.cation ? C.amber : C.cyan;
    tmp.copy(C.white).lerp(baseCol, Math.min(1, r / rad + 0.2));
    set(col, i, tmp);
    if (aux) aux[i] = (s.cation ? 1.3 : 1.6) + Math.random() * 0.3;
  }

  // bonds: thin point lines between nearest neighbours, tinted between the two ions
  const bondBudget = N - i;
  for (let b = 0; b < bondBudget; b++, i++) {
    const [ia, ib] = bonds[b % B];
    const a = sites[ia], c = sites[ib];
    const s = Math.random();
    const j = R * 0.012;
    pos[i * 3] = a.x + (c.x - a.x) * s + gauss() * j;
    pos[i * 3 + 1] = a.y + (c.y - a.y) * s + gauss() * j;
    pos[i * 3 + 2] = a.z + (c.z - a.z) * s + gauss() * j;
    tmp.copy(C.amber).lerp(C.cyan, s).lerp(C.blue, 0.3);
    set(col, i, tmp);
    if (aux) aux[i] = 0.6 + Math.random() * 0.2; // dim, thin struts
  }
};

export const SHAPES: Record<string, ShapeGen> = {
  cloud, molecule, helix, benzene, orbital, wave, neural, lattice,
};

/**
 * Caffeine TARGET bake for the GPGPU hero — one (x,y,z) + (r,g,b) per particle,
 * ready to write into a square DataTexture (one texel per particle). It places
 * particles on the real ball-and-stick skeleton: a budget split of dense atom
 * clusters (heavier atoms = denser glowing balls, weighted by element) and thin
 * point-lines along the bonds, colored by element. Reuses the same baked
 * `caffeine.pdb` geometry as `molecule` (no faking) but writes into a single flat
 * target so the GPU vertex shader can `mix(simPos, targetPos, progress)`.
 *
 * `scale` lets the caller fit the molecule to its world radius (HeroField uses a
 * world-space R). A domed z (matching `molecule`) gives the near-planar PDB real
 * relief so it reads as solid from any spin angle. Deterministic-ish via Math.random
 * (called once at bake time), so the cloud denoises into a recognizable molecule.
 */
export function caffeineTarget(
  outPos: Float32Array,
  outCol: Float32Array,
  N: number,
  scale: number,
): void {
  // domed z per atom (forward center, receding rim) — same recipe as `molecule`
  const zdome = new Float32Array(MOL_ATOMS);
  for (let a = 0; a < MOL_ATOMS; a++) {
    const x = MOL_XYZ[a * 3], y = MOL_XYZ[a * 3 + 1], z0 = MOL_XYZ[a * 3 + 2];
    const rr = Math.hypot(x, y) / MOL_MAX;
    const dome = (0.5 - rr * rr) * 0.9;
    const pucker = Math.sin(x * 1.3) * Math.cos(y * 1.3) * 0.18;
    zdome[a] = (z0 + (dome + pucker) * MOL_MAX) * scale;
  }
  const atomBudget = Math.round(N * 0.54);
  let wSum = 0;
  for (let a = 0; a < MOL_ATOMS; a++) wSum += ELEM_WEIGHT[MOL_ELEM[a]];
  let written = 0;
  for (let a = 0; a < MOL_ATOMS; a++) {
    const el = MOL_ELEM[a];
    const ax = MOL_XYZ[a * 3] * scale, ay = MOL_XYZ[a * 3 + 1] * scale, az = zdome[a];
    const rad = ELEM_RADIUS[el] * scale;
    let cnt = a === MOL_ATOMS - 1
      ? atomBudget - written
      : Math.round((atomBudget * ELEM_WEIGHT[el]) / wSum);
    if (cnt < 0) cnt = 0;
    const baseCol = ELEM_COLOR[el];
    for (let k = 0; k < cnt && written < atomBudget; k++, written++) {
      const r = rad * Math.cbrt(Math.random()) * (0.55 + 0.45 * Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const i = written;
      outPos[i * 3] = ax + r * Math.sin(phi) * Math.cos(theta);
      outPos[i * 3 + 1] = ay + r * Math.sin(phi) * Math.sin(theta);
      outPos[i * 3 + 2] = az + r * Math.cos(phi);
      tmp.copy(C.white).lerp(baseCol, Math.min(1, r / rad + 0.15));
      outCol[i * 3] = tmp.r; outCol[i * 3 + 1] = tmp.g; outCol[i * 3 + 2] = tmp.b;
    }
  }
  const a0 = written;
  const bondParticles = N - a0;
  for (let b = 0; b < bondParticles; b++) {
    const i = a0 + b;
    const e = b % MOL_BOND_COUNT;
    const ia = MOL_BONDS[e * 2], ib = MOL_BONDS[e * 2 + 1];
    const x1 = MOL_XYZ[ia * 3] * scale, y1 = MOL_XYZ[ia * 3 + 1] * scale, z1 = zdome[ia];
    const x2 = MOL_XYZ[ib * 3] * scale, y2 = MOL_XYZ[ib * 3 + 1] * scale, z2 = zdome[ib];
    const s = Math.random();
    const jx = (Math.random() - 0.5) * 0.12 * scale;
    const jy = (Math.random() - 0.5) * 0.12 * scale;
    const jz = (Math.random() - 0.5) * 0.12 * scale;
    outPos[i * 3] = x1 + (x2 - x1) * s + jx;
    outPos[i * 3 + 1] = y1 + (y2 - y1) * s + jy;
    outPos[i * 3 + 2] = z1 + (z2 - z1) * s + jz;
    tmp.copy(ELEM_COLOR[MOL_ELEM[ia]]).lerp(ELEM_COLOR[MOL_ELEM[ib]], s).lerp(C.cyan, 0.35);
    outCol[i * 3] = tmp.r; outCol[i * 3 + 1] = tmp.g; outCol[i * 3 + 2] = tmp.b;
  }
}

/** Molecule radius (Å, pre-scale) of the baked caffeine coords — lets callers
 *  fit it to a target world radius: `scale = worldR / CAFFEINE_RADIUS`. */
export const CAFFEINE_RADIUS = MOL_MAX;
