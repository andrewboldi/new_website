/**
 * RouteGraph — a retrosynthesis / reaction-route tree.
 *
 * Molecule nodes branch outward from a single target at the top into precursor
 * fragments; reaction edges connect them. A "search" repeatedly lights up one
 * full root-to-leaf path — the synthetic route the planner currently favors —
 * then fades and tries another. A nod to deep-RL route planning ("AlphaFold/
 * AlphaGo for synthesis"): a tree of molecules with a glowing solution path.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

interface Node {
  x: number; y: number; z: number;
  parent: number; // index into nodes, -1 for root
  depth: number;
}

export function routeGraph(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  camera.position.set(0, 0, 46);
  camera.lookAt(0, 0, 0);

  const mobile = ctx.width < 760;
  const DEPTH = 4;                 // levels of the tree
  const BRANCH = mobile ? 2 : 2;   // children per node (binary keeps it legible)
  const SPREAD = 30;               // horizontal extent at the leaves
  const VSTEP = 9;                 // vertical gap between levels

  // ---- build the tree breadth-first ----
  const nodes: Node[] = [];
  const childrenOf: number[][] = [];
  const leaves: number[] = [];
  const topY = (DEPTH * VSTEP) / 2; // center the tree vertically

  // root (the target molecule) at top
  nodes.push({ x: 0, y: topY, z: 0, parent: -1, depth: 0 });
  childrenOf.push([]);

  let level = [0];
  for (let d = 1; d <= DEPTH; d++) {
    const next: number[] = [];
    const y = topY - d * VSTEP;
    const total = level.length * BRANCH; // nodes on this level
    let slot = 0;
    for (const p of level) {
      for (let b = 0; b < BRANCH; b++) {
        const frac = total === 1 ? 0.5 : slot / (total - 1);
        const x = (frac - 0.5) * SPREAD * (d / DEPTH);
        // pull children toward their parent for an organic, branching look
        const fx = nodes[p].x * 0.45 + x * 0.55;
        const z = (Math.random() - 0.5) * 5;
        const idx = nodes.length;
        nodes.push({ x: fx, y, z, parent: p, depth: d });
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

  // ---- node points ----
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const scales = new Float32Array(N);
  const baseColor = new Float32Array(N * 3);

  const cTarget = new THREE.Color(PALETTE.amber);
  const cMid = new THREE.Color(PALETTE.cyan);
  const cLeaf = new THREE.Color(PALETTE.blue);
  const tmp = new THREE.Color();

  for (let i = 0; i < N; i++) {
    const n = nodes[i];
    positions[i * 3] = n.x;
    positions[i * 3 + 1] = n.y;
    positions[i * 3 + 2] = n.z;
    const f = n.depth / DEPTH;
    if (i === 0) tmp.copy(cTarget);
    else tmp.copy(cMid).lerp(cLeaf, f);
    baseColor[i * 3] = tmp.r; baseColor[i * 3 + 1] = tmp.g; baseColor[i * 3 + 2] = tmp.b;
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    scales[i] = i === 0 ? 6.5 : 3.4 - f * 1.0;
  }

  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  nodeGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  nodeGeo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1).setUsage(THREE.DynamicDrawUsage));
  const nodeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aScale; attribute vec3 aColor; varying vec3 vColor;
      uniform float uTime;
      void main() { vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float pulse = 1.0 + 0.12 * sin(uTime * 1.6 + position.y);
        gl_PointSize = aScale * pulse * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() { vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.5), smoothstep(0.5, 0.16, d)); }`,
  });
  const group = new THREE.Group();
  group.add(new THREE.Points(nodeGeo, nodeMat));

  // ---- edges (one segment per non-root node -> parent) ----
  const E = N - 1;
  const edgePos = new Float32Array(E * 6);
  const edgeCol = new Float32Array(E * 6);
  const edgeBase = new Float32Array(E * 6); // dim base colors
  const edgeChild = new Int32Array(E);      // child node index for each edge
  let e = 0;
  for (let i = 1; i < N; i++) {
    const p = nodes[i].parent;
    edgePos[e * 6] = nodes[p].x; edgePos[e * 6 + 1] = nodes[p].y; edgePos[e * 6 + 2] = nodes[p].z;
    edgePos[e * 6 + 3] = nodes[i].x; edgePos[e * 6 + 4] = nodes[i].y; edgePos[e * 6 + 5] = nodes[i].z;
    // dim blue base color for both endpoints
    const cb = new THREE.Color(PALETTE.blue).multiplyScalar(0.35);
    edgeBase[e * 6] = cb.r; edgeBase[e * 6 + 1] = cb.g; edgeBase[e * 6 + 2] = cb.b;
    edgeBase[e * 6 + 3] = cb.r; edgeBase[e * 6 + 4] = cb.g; edgeBase[e * 6 + 5] = cb.b;
    edgeChild[e] = i;
    e++;
  }
  edgeCol.set(edgeBase);
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
  edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeCol, 3).setUsage(THREE.DynamicDrawUsage));
  const edgeMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.LineSegments(edgeGeo, edgeMat));
  scene.add(group);

  // map a child-node index -> its edge index
  const edgeForChild = new Int32Array(N).fill(-1);
  for (let k = 0; k < E; k++) edgeForChild[edgeChild[k]] = k;

  // ---- the "search": cycle a glowing path root -> a chosen leaf ----
  const pathColor = new THREE.Color(PALETTE.amber);
  let activeLeaf = leaves[Math.floor(Math.random() * leaves.length)];
  let pathNodes: number[] = [];
  let pathEdges: number[] = [];
  const onPath = new Uint8Array(N); // fast membership test in the frame loop
  const rebuildPath = () => {
    pathNodes = []; pathEdges = [];
    onPath.fill(0);
    let cur = activeLeaf;
    while (cur !== -1) {
      pathNodes.push(cur);
      onPath[cur] = 1;
      const ei = edgeForChild[cur];
      if (ei >= 0) pathEdges.push(ei);
      cur = nodes[cur].parent;
    }
  };
  rebuildPath();

  const PERIOD = 3.2; // seconds per route
  let lastCycle = 0;

  onFrame((t, dt) => {
    nodeMat.uniforms.uTime.value = t;

    if (t - lastCycle > PERIOD) {
      lastCycle = t;
      // pick a new leaf (different from current)
      let nl = activeLeaf;
      while (nl === activeLeaf && leaves.length > 1) nl = leaves[Math.floor(Math.random() * leaves.length)];
      activeLeaf = nl;
      rebuildPath();
    }
    // phase 0..1 across the period; sweep light down the path
    const phase = (t - lastCycle) / PERIOD;
    const reach = phase * (DEPTH + 1); // how deep the glow has traveled

    // reset to base
    colors.set(baseColor);
    edgeCol.set(edgeBase);

    // light the active path up to `reach` depth, with a soft falloff
    for (const ni of pathNodes) {
      const d = nodes[ni].depth;
      const lead = reach - d;
      if (lead < 0) continue;
      const glow = Math.max(0, 1 - Math.abs(lead - 0.6) * 0.5) * (1 - phase * 0.25);
      const g = Math.min(1, 0.4 + glow);
      tmp.set(baseColor[ni * 3], baseColor[ni * 3 + 1], baseColor[ni * 3 + 2]).lerp(pathColor, g);
      colors[ni * 3] = tmp.r; colors[ni * 3 + 1] = tmp.g; colors[ni * 3 + 2] = tmp.b;
      scales[ni] = (ni === 0 ? 6.5 : 3.4) * (1 + g * 0.5);
    }
    for (const ei of pathEdges) {
      const childDepth = nodes[edgeChild[ei]].depth;
      const lead = reach - childDepth;
      if (lead < 0) continue;
      const g = Math.min(1, 0.5 + Math.max(0, 1 - Math.abs(lead - 0.4)) * 0.8);
      const cb = pathColor;
      for (let s = 0; s < 2; s++) {
        edgeCol[ei * 6 + s * 3] = cb.r * g;
        edgeCol[ei * 6 + s * 3 + 1] = cb.g * g;
        edgeCol[ei * 6 + s * 3 + 2] = cb.b * g;
      }
    }
    // decay non-path scales back toward base
    for (let i = 0; i < N; i++) {
      if (!onPath[i]) {
        const base = i === 0 ? 6.5 : 3.4 - (nodes[i].depth / DEPTH);
        scales[i] = THREE.MathUtils.lerp(scales[i], base, 0.2);
      }
    }

    nodeGeo.attributes.aColor.needsUpdate = true;
    nodeGeo.attributes.aScale.needsUpdate = true;
    edgeGeo.attributes.color.needsUpdate = true;

    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, ctx.pointer.x * 0.4, 0.05);
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, -0.05 + ctx.pointer.y * 0.2, 0.05);
  });

  onDispose(() => { nodeGeo.dispose(); nodeMat.dispose(); edgeGeo.dispose(); edgeMat.dispose(); });
}
