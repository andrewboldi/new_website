/**
 * RouteGraph — a retrosynthesis / reaction-route search tree ("AlphaFold for
 * synthesis"). A target molecule at the top is recursively disconnected into
 * precursor fragments; a Monte-Carlo-tree-search-style frontier EXPANDS the
 * tree outward node by node, then a single root-to-leaf SOLUTION ROUTE ignites
 * step by step from the target down to its purchasable building blocks before
 * the search resets and explores a different route.
 *
 * Detail budget:
 *  - every node carries a little MOLECULE GLYPH (atoms as colored points,
 *    bonds as line segments) whose size/complexity shrinks down the tree, so
 *    the target reads as a big molecule and leaves as small fragments;
 *  - parent->child links are reaction CONNECTORS with a forward ARROWHEAD;
 *  - the tree grows progressively (nodes/edges fade in as the frontier reaches
 *    them) instead of appearing all at once;
 *  - the favored route glows amber and sweeps downward step by step.
 *
 * All geometry is preallocated; the frame loop only writes colors/scales/arrow
 * vertices into existing buffers.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

interface Node {
  x: number; y: number; z: number;
  parent: number;     // index into nodes, -1 for root
  depth: number;
  born: number;       // frontier order in which this node is revealed (0..N-1)
  glyphStart: number; // first atom index in the shared glyph buffers
  glyphAtoms: number; // atom count for this node's molecule glyph
  bondStart: number;  // first bond index
  bondCount: number;
}

export function routeGraph(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);

  const mobile = ctx.width < 760;
  const DEPTH = mobile ? 4 : 5;        // levels of the tree (deeper = richer)
  const BRANCH = 2;                    // children per node (binary stays legible)
  const SPREAD = mobile ? 30 : 42;     // horizontal extent at the leaves
  const VSTEP = mobile ? 9 : 8.6;      // vertical gap between levels

  // ---- build the tree breadth-first ----
  const nodes: Node[] = [];
  const childrenOf: number[][] = [];
  const leaves: number[] = [];
  const topY = (DEPTH * VSTEP) / 2;

  nodes.push({ x: 0, y: topY, z: 0, parent: -1, depth: 0, born: 0, glyphStart: 0, glyphAtoms: 0, bondStart: 0, bondCount: 0 });
  childrenOf.push([]);

  let level = [0];
  for (let d = 1; d <= DEPTH; d++) {
    const next: number[] = [];
    const y = topY - d * VSTEP;
    const total = level.length * BRANCH;
    let slot = 0;
    for (const p of level) {
      for (let b = 0; b < BRANCH; b++) {
        const frac = total === 1 ? 0.5 : slot / (total - 1);
        const x = (frac - 0.5) * SPREAD * (d / DEPTH);
        const fx = nodes[p].x * 0.42 + x * 0.58; // pull toward parent
        const z = (Math.sin(slot * 7.3 + d * 2.1) * 0.5) * 6;
        const idx = nodes.length;
        nodes.push({ x: fx, y, z, parent: p, depth: d, born: 0, glyphStart: 0, glyphAtoms: 0, bondStart: 0, bondCount: 0 });
        childrenOf.push([]);
        childrenOf[p].push(idx);
        next.push(idx);
        slot++;
      }
    }
    level = next;
  }
  for (let i = 0; i < nodes.length; i++) if (childrenOf[i].length === 0) leaves.push(i);
  const N = nodes.length;

  // breadth-first "born" order so the tree reveals top-down, left-to-right
  {
    const q = [0]; let order = 0;
    while (q.length) {
      const i = q.shift()!;
      nodes[i].born = order++;
      for (const c of childrenOf[i]) q.push(c);
    }
  }

  // ---- build molecule glyphs per node (atoms + bonds) ----
  // A glyph is a small ring/chain of atoms; bigger near the target, smaller at
  // the leaves. Atoms get element-ish colors; bonds connect consecutive atoms
  // plus a couple of cross-links so it reads as a fused structure.
  const atomColorC = (kind: number) => {
    // 0 carbon (cool steel-blue), 1 hetero N (cyan), 2 hetero O (amber), 3 ring (violet)
    // carbons are kept a desaturated blue (not pure white) so additive bloom
    // doesn't blow the glyphs out to featureless blobs.
    if (kind === 0) return new THREE.Color(PALETTE.blue).lerp(new THREE.Color(PALETTE.white), 0.35);
    if (kind === 1) return new THREE.Color(PALETTE.cyan);
    if (kind === 2) return new THREE.Color(PALETTE.amber);
    return new THREE.Color(PALETTE.violet);
  };

  // First pass: decide atom/bond counts and total sizes.
  const glyphAtomCount = (depth: number) => {
    const f = depth / DEPTH;
    return Math.max(4, Math.round((mobile ? 7 : 9) - f * 5)); // 9..4 atoms
  };
  let totalAtoms = 0, totalBonds = 0;
  for (let i = 0; i < N; i++) {
    const na = glyphAtomCount(nodes[i].depth);
    nodes[i].glyphStart = totalAtoms;
    nodes[i].glyphAtoms = na;
    nodes[i].bondStart = totalBonds;
    // ring bonds (na) + ~na/2 substituent/cross bonds
    const nb = na + Math.floor(na / 2);
    nodes[i].bondCount = nb;
    totalAtoms += na;
    totalBonds += nb;
  }

  // Atom buffers (one big Points cloud for all glyphs).
  const atomPos = new Float32Array(totalAtoms * 3);
  const atomBaseCol = new Float32Array(totalAtoms * 3);
  const atomCol = new Float32Array(totalAtoms * 3);
  const atomScale = new Float32Array(totalAtoms);
  const atomNode = new Int32Array(totalAtoms);
  // local (glyph-space) offsets so glyphs can be repositioned/scaled cheaply
  const atomLocal = new Float32Array(totalAtoms * 3);

  // Bond buffers (one big LineSegments for all glyph bonds).
  const bondPos = new Float32Array(totalBonds * 6);
  const bondBaseCol = new Float32Array(totalBonds * 6);
  const bondCol = new Float32Array(totalBonds * 6);
  const bondNode = new Int32Array(totalBonds);
  // store which two local atom indices a bond connects, for repositioning
  const bondA = new Int32Array(totalBonds);
  const bondB = new Int32Array(totalBonds);

  const tmpC = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const nd = nodes[i];
    const na = nd.glyphAtoms;
    const glyphR = nd.depth === 0 ? 2.6 : Math.max(1.0, 2.2 - nd.depth * 0.3);
    // lay atoms around a slightly noisy ring (a couple pushed inward = fused)
    for (let k = 0; k < na; k++) {
      const ai = nd.glyphStart + k;
      const ang = (k / na) * Math.PI * 2 + (i * 0.7);
      const rr = glyphR * (k % 3 === 0 ? 0.55 : 1.0); // some interior atoms
      const lx = Math.cos(ang) * rr;
      const ly = Math.sin(ang) * rr;
      const lz = Math.sin(ang * 2 + i) * glyphR * 0.25;
      atomLocal[ai * 3] = lx; atomLocal[ai * 3 + 1] = ly; atomLocal[ai * 3 + 2] = lz;
      // element kind: carbons mostly, occasional hetero/ring accent
      const kind = (k === 1) ? 1 : (k === 2 ? 2 : (k % 4 === 0 ? 3 : 0));
      tmpC.copy(atomColorC(kind));
      // keep resting brightness modest so bloom never washes glyphs to white;
      // target glyph only a touch brighter than its precursors.
      const dim = nd.depth === 0 ? 0.55 : 0.42;
      atomBaseCol[ai * 3] = tmpC.r * dim; atomBaseCol[ai * 3 + 1] = tmpC.g * dim; atomBaseCol[ai * 3 + 2] = tmpC.b * dim;
      atomScale[ai] = (nd.depth === 0 ? 1.9 : 1.35) * (kind === 0 ? 1.0 : 1.2);
      atomNode[ai] = i;
    }
    // bonds: ring (consecutive) then cross-links
    let bi = nd.bondStart;
    for (let k = 0; k < na; k++) {
      bondA[bi] = k; bondB[bi] = (k + 1) % na;
      bondNode[bi] = i; bi++;
    }
    const cross = nd.bondCount - na;
    for (let c = 0; c < cross; c++) {
      bondA[bi] = c; bondB[bi] = (c + Math.floor(na / 2)) % na;
      bondNode[bi] = i; bi++;
    }
  }

  // Place each glyph at its node position (atoms = local + node, bonds derived).
  const placeGlyph = (i: number) => {
    const nd = nodes[i];
    const ox = nd.x, oy = nd.y, oz = nd.z;
    for (let k = 0; k < nd.glyphAtoms; k++) {
      const ai = nd.glyphStart + k;
      atomPos[ai * 3] = ox + atomLocal[ai * 3];
      atomPos[ai * 3 + 1] = oy + atomLocal[ai * 3 + 1];
      atomPos[ai * 3 + 2] = oz + atomLocal[ai * 3 + 2];
    }
    for (let b = 0; b < nd.bondCount; b++) {
      const bi = nd.bondStart + b;
      const a0 = nd.glyphStart + bondA[bi];
      const a1 = nd.glyphStart + bondB[bi];
      bondPos[bi * 6] = atomPos[a0 * 3]; bondPos[bi * 6 + 1] = atomPos[a0 * 3 + 1]; bondPos[bi * 6 + 2] = atomPos[a0 * 3 + 2];
      bondPos[bi * 6 + 3] = atomPos[a1 * 3]; bondPos[bi * 6 + 4] = atomPos[a1 * 3 + 1]; bondPos[bi * 6 + 5] = atomPos[a1 * 3 + 2];
      // bond base color = blend of its endpoints, dimmed
      const dim = nd.depth === 0 ? 0.55 : 0.32;
      bondBaseCol[bi * 6] = (atomBaseCol[a0 * 3] + atomBaseCol[a1 * 3]) * 0.5 * dim;
      bondBaseCol[bi * 6 + 1] = (atomBaseCol[a0 * 3 + 1] + atomBaseCol[a1 * 3 + 1]) * 0.5 * dim;
      bondBaseCol[bi * 6 + 2] = (atomBaseCol[a0 * 3 + 2] + atomBaseCol[a1 * 3 + 2]) * 0.5 * dim;
      bondBaseCol[bi * 6 + 3] = bondBaseCol[bi * 6];
      bondBaseCol[bi * 6 + 4] = bondBaseCol[bi * 6 + 1];
      bondBaseCol[bi * 6 + 5] = bondBaseCol[bi * 6 + 2];
    }
  };
  for (let i = 0; i < N; i++) placeGlyph(i);
  atomCol.set(atomBaseCol);
  bondCol.set(bondBaseCol);

  const group = new THREE.Group();

  // atoms cloud
  const atomGeo = new THREE.BufferGeometry();
  atomGeo.setAttribute('position', new THREE.BufferAttribute(atomPos, 3));
  atomGeo.setAttribute('aColor', new THREE.BufferAttribute(atomCol, 3).setUsage(THREE.DynamicDrawUsage));
  atomGeo.setAttribute('aScale', new THREE.BufferAttribute(atomScale, 1));
  const atomMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aScale; attribute vec3 aColor; varying vec3 vColor;
      uniform float uTime;
      void main() { vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float pulse = 1.0 + 0.10 * sin(uTime * 1.8 + position.x + position.y);
        gl_PointSize = aScale * pulse * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() { vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.55), smoothstep(0.5, 0.14, d)); }`,
  });
  group.add(new THREE.Points(atomGeo, atomMat));

  // glyph bonds
  const bondGeo = new THREE.BufferGeometry();
  bondGeo.setAttribute('position', new THREE.BufferAttribute(bondPos, 3));
  bondGeo.setAttribute('color', new THREE.BufferAttribute(bondCol, 3).setUsage(THREE.DynamicDrawUsage));
  const bondMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.LineSegments(bondGeo, bondMat));

  // ---- reaction connectors (parent -> child) with arrowheads ----
  // Each connector contributes 3 segments: the shaft + two arrowhead barbs.
  const C = N - 1;                 // connectors
  const SEGS_PER = 3;
  const conPos = new Float32Array(C * SEGS_PER * 6);
  const conBase = new Float32Array(C * SEGS_PER * 6);
  const conCol = new Float32Array(C * SEGS_PER * 6);
  const conChild = new Int32Array(C);
  const edgeForChild = new Int32Array(N).fill(-1);

  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vD = new THREE.Vector3();
  const vPerp = new THREE.Vector3(), vTip = new THREE.Vector3();
  const buildConnector = (ci: number, childIdx: number) => {
    const p = nodes[childIdx].parent;
    const nd = nodes[childIdx], pd = nodes[p];
    // shrink the shaft so it runs between glyph edges, not through their centers
    vA.set(pd.x, pd.y, pd.z);
    vB.set(nd.x, nd.y, nd.z);
    vD.subVectors(vB, vA);
    const len = vD.length() || 1;
    vD.multiplyScalar(1 / len);
    const startGap = 3.0, endGap = 3.0;
    const sx = vA.x + vD.x * startGap, sy = vA.y + vD.y * startGap, sz = vA.z + vD.z * startGap;
    const ex = vB.x - vD.x * endGap, ey = vB.y - vD.y * endGap, ez = vB.z - vD.z * endGap;
    const o = ci * SEGS_PER * 6;
    // shaft
    conPos[o] = sx; conPos[o + 1] = sy; conPos[o + 2] = sz;
    conPos[o + 3] = ex; conPos[o + 4] = ey; conPos[o + 5] = ez;
    // arrowhead barbs at the child end
    vPerp.set(-vD.y, vD.x, 0).normalize();
    const barb = 1.4;
    vTip.set(ex, ey, ez);
    // barb 1
    conPos[o + 6] = ex; conPos[o + 7] = ey; conPos[o + 8] = ez;
    conPos[o + 9] = ex - vD.x * barb + vPerp.x * barb; conPos[o + 10] = ey - vD.y * barb + vPerp.y * barb; conPos[o + 11] = ez - vD.z * barb + vPerp.z * barb;
    // barb 2
    conPos[o + 12] = ex; conPos[o + 13] = ey; conPos[o + 14] = ez;
    conPos[o + 15] = ex - vD.x * barb - vPerp.x * barb; conPos[o + 16] = ey - vD.y * barb - vPerp.y * barb; conPos[o + 17] = ez - vD.z * barb - vPerp.z * barb;
    // base color: cyan-blue reaction wiring, bright enough to read between glyphs
    const cb = new THREE.Color(PALETTE.cyan).lerp(new THREE.Color(PALETTE.blue), 0.5).multiplyScalar(0.5);
    for (let s = 0; s < SEGS_PER * 2; s++) {
      conBase[o + s * 3] = cb.r; conBase[o + s * 3 + 1] = cb.g; conBase[o + s * 3 + 2] = cb.b;
    }
  };
  {
    let ci = 0;
    for (let i = 1; i < N; i++) {
      buildConnector(ci, i);
      conChild[ci] = i;
      edgeForChild[i] = ci;
      ci++;
    }
  }
  conCol.set(conBase);
  const conGeo = new THREE.BufferGeometry();
  conGeo.setAttribute('position', new THREE.BufferAttribute(conPos, 3));
  conGeo.setAttribute('color', new THREE.BufferAttribute(conCol, 3).setUsage(THREE.DynamicDrawUsage));
  const conMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.LineSegments(conGeo, conMat));
  scene.add(group);

  // ---- the favored route: cycle a glowing path root -> a chosen leaf ----
  const pathColor = new THREE.Color(PALETTE.amber);
  let activeLeaf = leaves[(Math.random() * leaves.length) | 0];
  let pathNodes: number[] = [];
  let pathEdges: number[] = [];
  const onPath = new Uint8Array(N);
  const rebuildPath = () => {
    pathNodes = []; pathEdges = []; onPath.fill(0);
    let cur = activeLeaf;
    while (cur !== -1) {
      pathNodes.push(cur); onPath[cur] = 1;
      const ei = edgeForChild[cur];
      if (ei >= 0) pathEdges.push(ei);
      cur = nodes[cur].parent;
    }
  };
  rebuildPath();

  // cycle: EXPAND (tree grows in) -> SOLVE (route lights down) -> reset
  const EXPAND = 2.4, SOLVE = 3.0, HOLD = 0.8;
  const PERIOD = EXPAND + SOLVE + HOLD;
  let lastCycle = 0;
  const tmp = new THREE.Color();

  // per-node reveal: 0..1 (eased), reaches 1 as frontier passes
  const reveal = new Float32Array(N);

  const writeNodeColor = (i: number, glow: number, rev: number) => {
    const nd = nodes[i];
    for (let k = 0; k < nd.glyphAtoms; k++) {
      const ai = nd.glyphStart + k;
      tmp.set(atomBaseCol[ai * 3], atomBaseCol[ai * 3 + 1], atomBaseCol[ai * 3 + 2]).lerp(pathColor, glow);
      atomCol[ai * 3] = tmp.r * rev; atomCol[ai * 3 + 1] = tmp.g * rev; atomCol[ai * 3 + 2] = tmp.b * rev;
    }
    for (let b = 0; b < nd.bondCount; b++) {
      const bi = nd.bondStart + b;
      tmp.set(bondBaseCol[bi * 6], bondBaseCol[bi * 6 + 1], bondBaseCol[bi * 6 + 2]).lerp(pathColor, glow);
      for (let s = 0; s < 2; s++) {
        bondCol[bi * 6 + s * 3] = tmp.r * rev; bondCol[bi * 6 + s * 3 + 1] = tmp.g * rev; bondCol[bi * 6 + s * 3 + 2] = tmp.b * rev;
      }
    }
  };

  const updateFrame = (phaseT: number) => {
    // frontier of the expansion: how many nodes are revealed
    const expandFrac = Math.min(1, phaseT / EXPAND);
    const frontierBorn = expandFrac * (N - 1);

    // SOLVE phase reach along the path depth
    const solveT = Math.max(0, phaseT - EXPAND);
    const solveFrac = Math.min(1, solveT / SOLVE);
    const reach = solveFrac * (DEPTH + 1);

    for (let i = 0; i < N; i++) {
      // reveal node when frontier passes its born index
      const target = nodes[i].born <= frontierBorn ? 1 : 0;
      reveal[i] = THREE.MathUtils.lerp(reveal[i], target, 0.25);

      let glow = 0;
      if (onPath[i]) {
        const lead = reach - nodes[i].depth;
        if (lead >= 0) glow = Math.min(1, Math.max(0, 1 - Math.abs(lead - 0.6) * 0.5) + 0.35);
      }
      writeNodeColor(i, glow, reveal[i]);
    }

    // connectors: reveal with child, glow on path
    for (let ci = 0; ci < C; ci++) {
      const child = conChild[ci];
      const rev = reveal[child];
      let glow = 0;
      if (onPath[child]) {
        const lead = reach - nodes[child].depth;
        if (lead >= 0) glow = Math.min(1, 0.5 + Math.max(0, 1 - Math.abs(lead - 0.4)) * 0.8);
      }
      const o = ci * SEGS_PER * 6;
      for (let s = 0; s < SEGS_PER * 2; s++) {
        const br = conBase[o + s * 3], bg = conBase[o + s * 3 + 1], bb = conBase[o + s * 3 + 2];
        tmp.set(br, bg, bb).lerp(pathColor, glow);
        conCol[o + s * 3] = tmp.r * rev; conCol[o + s * 3 + 1] = tmp.g * rev; conCol[o + s * 3 + 2] = tmp.b * rev;
      }
    }

    atomGeo.attributes.aColor.needsUpdate = true;
    bondGeo.attributes.color.needsUpdate = true;
    conGeo.attributes.color.needsUpdate = true;
  };

  // Seed a rich static first frame: fully expanded tree + route mid-ignition.
  updateFrame(EXPAND + SOLVE * 0.6);

  onFrame((t) => {
    atomMat.uniforms.uTime.value = t;
    if (t - lastCycle > PERIOD) {
      lastCycle = t;
      let nl = activeLeaf;
      while (nl === activeLeaf && leaves.length > 1) nl = leaves[(Math.random() * leaves.length) | 0];
      activeLeaf = nl;
      reveal.fill(0); // re-grow the tree for the new search
      rebuildPath();
    }
    updateFrame(t - lastCycle);

    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, ctx.pointer.x * 0.4, 0.05);
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, -0.05 + ctx.pointer.y * 0.2, 0.05);
  });

  onDispose(() => {
    atomGeo.dispose(); atomMat.dispose();
    bondGeo.dispose(); bondMat.dispose();
    conGeo.dispose(); conMat.dispose();
  });
}
