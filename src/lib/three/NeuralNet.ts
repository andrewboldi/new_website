/**
 * NeuralNet — a deep, multi-layer network rendered as clean 3D strata with
 * weighted connections, a forward activation WAVE that lights neurons and the
 * edges feeding them in sequence (layer by layer), and discrete signal packets
 * that travel along the wired connections as the wave passes. Reads as a deep
 * network thinking. For the machine-learning and interpretability writing.
 *
 * Detail budget: every neuron is a glowing point with a per-node bias glow and
 * a subtle breathing idle; every edge carries a weight (sign + magnitude) that
 * drives its thickness/opacity and tint (excitatory cyan / inhibitory violet);
 * a gaussian activation front sweeps in x, and only the strongest weighted
 * edges spawn travelling signal sprites so the data-flow reads without clutter.
 *
 * Everything is preallocated; the frame loop only writes into existing typed
 * arrays — no per-frame allocation, no GC churn.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

export function neuralNet(handle: SceneHandle, opts: { reverse?: boolean } = {}) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  camera.position.set(0, 0, 36);

  const group = new THREE.Group();
  scene.add(group);

  const mobile = ctx.width < 760;
  // Deeper, denser strata than before — reads unmistakably as a deep net.
  const layers = mobile ? [5, 8, 8, 6, 3] : [6, 11, 13, 11, 8, 3];
  const L = layers.length;
  const W = mobile ? 26 : 32;
  const H = mobile ? 17 : 20;
  const xOf = (li: number) => (li / (L - 1) - 0.5) * W;

  // ---- neuron layout (clean strata in x, slight z scatter for depth) ----
  type Neuron = { x: number; y: number; z: number; li: number; bias: number; phase: number };
  const nodes: Neuron[] = [];
  const layerStart: number[] = [];
  layers.forEach((count, li) => {
    layerStart[li] = nodes.length;
    const x = xOf(li);
    for (let n = 0; n < count; n++) {
      const y = count > 1 ? (n / (count - 1) - 0.5) * H : 0;
      // small deterministic-ish z so each layer is a thin slab with parallax
      const z = (Math.sin(n * 12.9898 + li * 4.1414) * 0.5) * 2.4;
      nodes.push({ x, y, z, li, bias: Math.random(), phase: Math.random() * Math.PI * 2 });
    }
  });
  const NODES = nodes.length;

  // ---- fully-connected edges between adjacent layers, each with a weight ----
  type Edge = { a: number; b: number; w: number; midX: number };
  const edgeList: Edge[] = [];
  for (let li = 0; li < L - 1; li++) {
    const aS = layerStart[li], aC = layers[li];
    const bS = layerStart[li + 1], bC = layers[li + 1];
    for (let a = 0; a < aC; a++) {
      for (let b = 0; b < bC; b++) {
        const ia = aS + a, ib = bS + b;
        // signed weight in [-1,1]; bias slightly toward strong connections so
        // the picture has clear "wires" rather than uniform mush.
        let w = Math.random() * 2 - 1;
        w = Math.sign(w) * Math.pow(Math.abs(w), 0.6);
        edgeList.push({ a: ia, b: ib, w, midX: (nodes[ia].x + nodes[ib].x) * 0.5 });
      }
    }
  }
  const E = edgeList.length;

  // Two passes of line geometry so weight can drive apparent thickness:
  //  - a thin base line for every edge (the full wiring diagram)
  //  - a second, brighter line only for strong edges (fakes thickness via overdraw)
  const edgePos = new Float32Array(E * 6);
  const edgeBaseCol = new Float32Array(E * 6); // dim resting tint per endpoint
  const edgeCol = new Float32Array(E * 6);     // animated
  const edgeMidX = new Float32Array(E);
  const edgeW = new Float32Array(E);
  const edgeStrong = new Uint8Array(E);

  const exc = new THREE.Color(PALETTE.cyan);    // excitatory (w > 0)
  const inh = new THREE.Color(PALETTE.violet);  // inhibitory (w < 0)
  const tmpC = new THREE.Color();

  for (let i = 0; i < E; i++) {
    const e = edgeList[i];
    const na = nodes[e.a], nb = nodes[e.b];
    edgePos.set([na.x, na.y, na.z, nb.x, nb.y, nb.z], i * 6);
    edgeMidX[i] = e.midX;
    edgeW[i] = e.w;
    const mag = Math.abs(e.w);
    edgeStrong[i] = mag > 0.5 ? 1 : 0;
    tmpC.copy(e.w >= 0 ? exc : inh);
    const b = 0.05 + mag * 0.12; // resting wiring is faint
    edgeBaseCol[i * 6] = tmpC.r * b; edgeBaseCol[i * 6 + 1] = tmpC.g * b; edgeBaseCol[i * 6 + 2] = tmpC.b * b;
    edgeBaseCol[i * 6 + 3] = tmpC.r * b; edgeBaseCol[i * 6 + 4] = tmpC.g * b; edgeBaseCol[i * 6 + 5] = tmpC.b * b;
  }
  edgeCol.set(edgeBaseCol);

  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
  edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeCol, 3).setUsage(THREE.DynamicDrawUsage));
  const edges = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  group.add(edges);

  // Strong-edge overlay (separate geometry, indexed into the strong subset).
  const strongIdx: number[] = [];
  for (let i = 0; i < E; i++) if (edgeStrong[i]) strongIdx.push(i);
  const SE = strongIdx.length;
  const sPos = new Float32Array(SE * 6);
  const sCol = new Float32Array(SE * 6);
  for (let k = 0; k < SE; k++) {
    const i = strongIdx[k];
    sPos[k * 6] = edgePos[i * 6]; sPos[k * 6 + 1] = edgePos[i * 6 + 1]; sPos[k * 6 + 2] = edgePos[i * 6 + 2];
    sPos[k * 6 + 3] = edgePos[i * 6 + 3]; sPos[k * 6 + 4] = edgePos[i * 6 + 4]; sPos[k * 6 + 5] = edgePos[i * 6 + 5];
  }
  const strongGeo = new THREE.BufferGeometry();
  strongGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  strongGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3).setUsage(THREE.DynamicDrawUsage));
  const strongEdges = new THREE.LineSegments(
    strongGeo,
    new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.62,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  group.add(strongEdges);

  // ---- neurons ----
  const nodePos = new Float32Array(NODES * 3);
  const nodeX = new Float32Array(NODES);
  const nodeBias = new Float32Array(NODES);
  const nodePhase = new Float32Array(NODES);
  nodes.forEach((n, i) => {
    nodePos.set([n.x, n.y, n.z], i * 3);
    nodeX[i] = n.x; nodeBias[i] = n.bias; nodePhase[i] = n.phase;
  });
  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
  nodeGeo.setAttribute('aX', new THREE.BufferAttribute(nodeX, 1));
  nodeGeo.setAttribute('aBias', new THREE.BufferAttribute(nodeBias, 1));
  nodeGeo.setAttribute('aPhase', new THREE.BufferAttribute(nodePhase, 1));
  const nodeMat = new THREE.ShaderMaterial({
    uniforms: { uFront: { value: -W / 2 }, uTime: { value: 0 }, uSigma: { value: mobile ? 7.0 : 6.0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aX; attribute float aBias; attribute float aPhase;
      uniform float uFront; uniform float uTime; uniform float uSigma;
      varying float vAct; varying float vBias;
      void main() {
        float d = aX - uFront;
        vAct = exp(-d * d / uSigma);          // gaussian activation front
        vBias = aBias;
        float breathe = 0.85 + 0.15 * sin(uTime * 1.3 + aPhase); // idle life
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float size = (6.0 + aBias * 4.0 + vAct * 20.0) * breathe;
        gl_PointSize = size * (300.0 / -mv.z) / 14.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAct; varying float vBias;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        vec3 cool = vec3(0.0, 0.6, 1.0);     // resting blue
        vec3 warm = vec3(0.22, 0.91, 0.78);  // firing cyan
        vec3 c = mix(cool, warm, vAct);
        c = mix(c, vec3(1.0), vAct * 0.45);  // warm core when firing (not blown to white)
        float core = smoothstep(0.5, 0.0, d);
        float halo = smoothstep(0.5, 0.12, d);
        // Keep node + halo readable rather than a drowning glow.
        float a = halo * (0.22 + vBias * 0.16 + vAct * 0.40) + core * vAct * 0.30;
        gl_FragColor = vec4(c, a);
      }`,
  });
  group.add(new THREE.Points(nodeGeo, nodeMat));

  // ---- signal packets: sprites that ride strong edges as the wave passes ----
  // Preallocated pool; each packet is parametrized by (edge, t along edge).
  const PACKETS = mobile ? 90 : 160;
  const pkPos = new Float32Array(PACKETS * 3);
  const pkCol = new Float32Array(PACKETS * 3);
  const pkAlive = new Float32Array(PACKETS); // 0 = dead
  // per-packet state
  const pkEdge = new Int32Array(PACKETS).fill(-1);
  const pkT = new Float32Array(PACKETS);     // 0..1 along edge
  const pkSpeed = new Float32Array(PACKETS);
  const pkGeo = new THREE.BufferGeometry();
  pkGeo.setAttribute('position', new THREE.BufferAttribute(pkPos, 3).setUsage(THREE.DynamicDrawUsage));
  pkGeo.setAttribute('aColor', new THREE.BufferAttribute(pkCol, 3).setUsage(THREE.DynamicDrawUsage));
  pkGeo.setAttribute('aAlive', new THREE.BufferAttribute(pkAlive, 1).setUsage(THREE.DynamicDrawUsage));
  const pkMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aAlive; varying vec3 vColor; varying float vA;
      void main() { vColor = aColor; vA = aAlive;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (aAlive > 0.5 ? 7.0 : 0.0) * (300.0 / -mv.z) / 14.0;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vA;
      void main() { if (vA < 0.5) discard;
        float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
        gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.25), smoothstep(0.5, 0.0, d) * 0.8); }`,
  });
  group.add(new THREE.Points(pkGeo, pkMat));

  let nextPacket = 0;
  const spawnPacket = (edgeIdx: number) => {
    // find a free-ish slot via round-robin (cheap, bounded)
    let slot = -1;
    for (let s = 0; s < PACKETS; s++) {
      const idx = (nextPacket + s) % PACKETS;
      if (pkAlive[idx] < 0.5) { slot = idx; break; }
    }
    if (slot < 0) return;
    nextPacket = (slot + 1) % PACKETS;
    pkEdge[slot] = edgeIdx;
    pkT[slot] = 0;
    pkSpeed[slot] = 1.6 + Math.random() * 1.2;
    pkAlive[slot] = 1;
    const w = edgeW[edgeIdx];
    tmpC.copy(w >= 0 ? exc : inh).lerp(new THREE.Color(0xffffff), 0.15);
    pkCol[slot * 3] = tmpC.r * 0.78; pkCol[slot * 3 + 1] = tmpC.g * 0.78; pkCol[slot * 3 + 2] = tmpC.b * 0.78;
  };

  // Precompute, per strong edge, endpoint coords for fast packet interpolation.
  const exc2 = new THREE.Color(PALETTE.cyan);
  const inh2 = new THREE.Color(PALETTE.violet);
  const hot = new THREE.Color(PALETTE.cyan);
  const tmp = new THREE.Color();

  const dir = opts.reverse ? -1 : 1;
  let front = -W / 2 - 5;
  let spawnAccum = 0;

  // Seed a rich static state for reduced-motion / first frame: place the wave
  // mid-network and light a band of edges + a scatter of packets.
  const seedStatic = () => {
    front = 0;
    nodeMat.uniforms.uFront.value = front;
    nodeMat.uniforms.uTime.value = 0;
    // light edges near the front
    for (let i = 0; i < E; i++) {
      const d = edgeMidX[i] - front;
      const act = Math.exp(-(d * d) / 12);
      const w = edgeW[i];
      tmp.copy(w >= 0 ? exc2 : inh2);
      const base = 0.05 + Math.abs(w) * 0.12;
      const lvl = base + act * (0.34 + Math.abs(w) * 0.42);
      edgeCol[i * 6] = tmp.r * lvl; edgeCol[i * 6 + 1] = tmp.g * lvl; edgeCol[i * 6 + 2] = tmp.b * lvl;
      edgeCol[i * 6 + 3] = tmp.r * lvl; edgeCol[i * 6 + 4] = tmp.g * lvl; edgeCol[i * 6 + 5] = tmp.b * lvl;
    }
    for (let k = 0; k < SE; k++) {
      const i = strongIdx[k];
      const d = edgeMidX[i] - front;
      const act = Math.exp(-(d * d) / 12);
      const w = edgeW[i];
      tmp.copy(w >= 0 ? exc2 : inh2).lerp(hot, act);
      const lvl = act * (0.42 + Math.abs(w) * 0.7);
      for (let s = 0; s < 2; s++) {
        sCol[k * 6 + s * 3] = tmp.r * lvl; sCol[k * 6 + s * 3 + 1] = tmp.g * lvl; sCol[k * 6 + s * 3 + 2] = tmp.b * lvl;
      }
    }
    // scatter a handful of packets on strong edges near the front
    for (let k = 0; k < SE && k < PACKETS; k += Math.max(1, (SE / 40) | 0)) {
      const i = strongIdx[k];
      if (Math.abs(edgeMidX[i] - front) < 6) {
        spawnPacket(i);
        const slot = (nextPacket - 1 + PACKETS) % PACKETS;
        pkT[slot] = Math.random();
      }
    }
    edgeGeo.attributes.color.needsUpdate = true;
    strongGeo.attributes.color.needsUpdate = true;
  };
  seedStatic();

  onFrame((t, dt) => {
    nodeMat.uniforms.uTime.value = t;
    // advance the activation front; wrap with a lead-in margin
    front += dir * dt * 16;
    if (front > W / 2 + 6) front = -W / 2 - 6;
    if (front < -W / 2 - 6) front = W / 2 + 6;
    nodeMat.uniforms.uFront.value = front;

    // ---- light base edges by proximity of the front to their midpoint ----
    for (let i = 0; i < E; i++) {
      const d = edgeMidX[i] - front;
      const act = Math.exp(-(d * d) / 12);
      const w = edgeW[i];
      tmp.copy(w >= 0 ? exc2 : inh2);
      const base = 0.05 + Math.abs(w) * 0.12;
      const lvl = base + act * (0.34 + Math.abs(w) * 0.42);
      edgeCol[i * 6] = tmp.r * lvl; edgeCol[i * 6 + 1] = tmp.g * lvl; edgeCol[i * 6 + 2] = tmp.b * lvl;
      edgeCol[i * 6 + 3] = tmp.r * lvl; edgeCol[i * 6 + 4] = tmp.g * lvl; edgeCol[i * 6 + 5] = tmp.b * lvl;
    }
    edgeGeo.attributes.color.needsUpdate = true;

    // ---- strong-edge overlay flares hotter (fakes thickness) ----
    for (let k = 0; k < SE; k++) {
      const i = strongIdx[k];
      const d = edgeMidX[i] - front;
      const act = Math.exp(-(d * d) / 12);
      const w = edgeW[i];
      tmp.copy(w >= 0 ? exc2 : inh2).lerp(hot, act * 0.8);
      const lvl = act * (0.42 + Math.abs(w) * 0.7);
      for (let s = 0; s < 2; s++) {
        sCol[k * 6 + s * 3] = tmp.r * lvl; sCol[k * 6 + s * 3 + 1] = tmp.g * lvl; sCol[k * 6 + s * 3 + 2] = tmp.b * lvl;
      }
    }
    strongGeo.attributes.color.needsUpdate = true;

    // ---- spawn packets on strong edges the front is currently crossing ----
    spawnAccum += dt;
    if (spawnAccum > 0.05) {
      spawnAccum = 0;
      for (let k = 0; k < SE; k++) {
        const i = strongIdx[k];
        if (Math.abs(edgeMidX[i] - front) < 1.6 && Math.random() < 0.5) spawnPacket(i);
      }
    }

    // ---- advance + render packets ----
    for (let s = 0; s < PACKETS; s++) {
      if (pkAlive[s] < 0.5) continue;
      pkT[s] += pkSpeed[s] * dt * 0.5;
      if (pkT[s] >= 1) { pkAlive[s] = 0; continue; }
      const i = pkEdge[s];
      const ax = edgePos[i * 6], ay = edgePos[i * 6 + 1], az = edgePos[i * 6 + 2];
      const bx = edgePos[i * 6 + 3], by = edgePos[i * 6 + 4], bz = edgePos[i * 6 + 5];
      const u = pkT[s];
      pkPos[s * 3] = ax + (bx - ax) * u;
      pkPos[s * 3 + 1] = ay + (by - ay) * u;
      pkPos[s * 3 + 2] = az + (bz - az) * u;
    }
    pkGeo.attributes.position.needsUpdate = true;
    pkGeo.attributes.aColor.needsUpdate = true;
    pkGeo.attributes.aAlive.needsUpdate = true;

    group.rotation.y = Math.sin(t * 0.13) * 0.22 + ctx.pointer.x * 0.3;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, ctx.pointer.y * 0.18, 0.05);
  });

  onDispose(() => {
    edgeGeo.dispose(); strongGeo.dispose(); nodeGeo.dispose(); pkGeo.dispose();
    (edges.material as THREE.Material).dispose();
    (strongEdges.material as THREE.Material).dispose();
    nodeMat.dispose(); pkMat.dispose();
  });
}
