/**
 * NeuralNet — a layered network with an activation wave sweeping forward through
 * it, layer by layer, the way signal (or relevance, backward) propagates. For
 * the machine-learning and interpretability writing.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

export function neuralNet(handle: SceneHandle, opts: { reverse?: boolean } = {}) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  camera.position.set(0, 0, 34);

  const group = new THREE.Group();
  scene.add(group);

  const layers = ctx.width < 760 ? [4, 6, 6, 3] : [5, 8, 9, 7, 3];
  const L = layers.length;
  const W = 26, H = 17;

  const nodes: { x: number; y: number; z: number }[] = [];
  const layerOf: number[] = [];
  layers.forEach((count, li) => {
    const x = (li / (L - 1) - 0.5) * W;
    for (let n = 0; n < count; n++) {
      const y = count > 1 ? (n / (count - 1) - 0.5) * H : 0;
      nodes.push({ x, y, z: (Math.random() - 0.5) * 1.2 });
      layerOf.push(li);
    }
  });

  // ---- edges between adjacent layers ----
  const edgePairs: [number, number][] = [];
  let offset = 0;
  for (let li = 0; li < L - 1; li++) {
    const aStart = offset, aCount = layers[li];
    const bStart = offset + aCount, bCount = layers[li + 1];
    for (let a = 0; a < aCount; a++)
      for (let b = 0; b < bCount; b++) edgePairs.push([aStart + a, bStart + b]);
    offset += aCount;
  }

  const edgePos = new Float32Array(edgePairs.length * 6);
  const edgeCol = new Float32Array(edgePairs.length * 6);
  const edgeMidX = new Float32Array(edgePairs.length * 2);
  edgePairs.forEach(([a, b], i) => {
    const na = nodes[a], nb = nodes[b];
    edgePos.set([na.x, na.y, na.z, nb.x, nb.y, nb.z], i * 6);
    edgeMidX[i * 2] = (na.x + nb.x) / 2;
    edgeMidX[i * 2 + 1] = (na.x + nb.x) / 2;
  });
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
  edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeCol, 3).setUsage(THREE.DynamicDrawUsage));
  const edges = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  group.add(edges);

  // ---- nodes ----
  const nodePos = new Float32Array(nodes.length * 3);
  const nodeX = new Float32Array(nodes.length);
  nodes.forEach((n, i) => { nodePos.set([n.x, n.y, n.z], i * 3); nodeX[i] = n.x; });
  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
  nodeGeo.setAttribute('aX', new THREE.BufferAttribute(nodeX, 1));
  const nodeMat = new THREE.ShaderMaterial({
    uniforms: { uFront: { value: -W / 2 }, uHalf: { value: W / 2 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aX; uniform float uFront; varying float vAct;
      void main() {
        float d = abs(aX - uFront);
        vAct = exp(-d * d / 8.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (10.0 + vAct * 26.0) * (300.0 / -mv.z) / 14.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAct;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        vec3 cool = vec3(0.0, 0.6, 1.0);
        vec3 hot = vec3(0.22, 0.91, 0.78);
        vec3 c = mix(cool, hot, vAct);
        c = mix(c, vec3(1.0), vAct * 0.6);
        gl_FragColor = vec4(c, smoothstep(0.5, 0.1, d) * (0.4 + vAct * 0.6));
      }`,
  });
  group.add(new THREE.Points(nodeGeo, nodeMat));

  const cool = new THREE.Color(PALETTE.blue);
  const hot = new THREE.Color(PALETTE.cyan);
  const tmp = new THREE.Color();
  const dir = opts.reverse ? -1 : 1;
  let front = -W / 2;

  onFrame((t, dt) => {
    front += dir * dt * 14;
    if (front > W / 2 + 4) front = -W / 2 - 4;
    if (front < -W / 2 - 4) front = W / 2 + 4;
    nodeMat.uniforms.uFront.value = front;

    // light edges whose midpoint the front is crossing
    for (let i = 0; i < edgePairs.length; i++) {
      const d = Math.abs(edgeMidX[i * 2] - front);
      const act = Math.exp(-(d * d) / 10);
      tmp.copy(cool).lerp(hot, act);
      const base = 0.12 + act * 0.9;
      edgeCol[i * 6] = tmp.r * base; edgeCol[i * 6 + 1] = tmp.g * base; edgeCol[i * 6 + 2] = tmp.b * base;
      edgeCol[i * 6 + 3] = tmp.r * base; edgeCol[i * 6 + 4] = tmp.g * base; edgeCol[i * 6 + 5] = tmp.b * base;
    }
    edgeGeo.attributes.color.needsUpdate = true;

    group.rotation.y = Math.sin(t * 0.15) * 0.25 + ctx.pointer.x * 0.3;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, ctx.pointer.y * 0.2, 0.05);
  });

  onDispose(() => {
    edgeGeo.dispose(); nodeGeo.dispose();
    (edges.material as THREE.Material).dispose(); nodeMat.dispose();
  });
}
