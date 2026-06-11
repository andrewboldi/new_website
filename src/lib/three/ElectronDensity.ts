/**
 * ElectronDensity — a marching-cubes electron-density / orbital isosurface.
 *
 * Smooth lobes merge and split as the underlying "atoms" drift. Detail added:
 * two-tone WAVEFUNCTION-PHASE coloring (cyan +lobes / violet−blue −lobes) driven
 * by per-ball sign, a faint WIREFRAME overlay tracing the surface, glowing
 * NUCLEUS markers at the orbital centers, and a slow morph. Glassy, env-lit,
 * additive-glow, bloom-friendly.
 */
import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

export function electronDensity(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;

  const reduced =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  camera.position.set(0, 0, 1100);

  // cheap gradient env (no PMREM prefilter, which can stall software-GL renderers)
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 4; envCanvas.height = 64;
  const ectx = envCanvas.getContext('2d')!;
  const grad = ectx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0.0, '#08111f');
  grad.addColorStop(0.45, '#12283c');
  grad.addColorStop(0.62, '#2f5575');
  grad.addColorStop(0.8, '#9cc4e4');
  grad.addColorStop(1.0, '#08111f');
  ectx.fillStyle = grad; ectx.fillRect(0, 0, 4, 64);
  const env = new THREE.CanvasTexture(envCanvas);
  env.mapping = THREE.EquirectangularReflectionMapping;
  env.colorSpace = THREE.SRGBColorSpace;
  scene.environment = env;

  scene.add(new THREE.AmbientLight(0x223a52, 0.5));
  const l1 = new THREE.DirectionalLight(0xffffff, 1.3); l1.position.set(1, 1, 1); scene.add(l1);
  const l2 = new THREE.PointLight(PALETTE.cyan, 1.1, 0, 0); l2.position.set(-400, 250, 350); scene.add(l2);
  const l3 = new THREE.PointLight(PALETTE.violet, 0.9, 0, 0); l3.position.set(400, -220, -200); scene.add(l3);

  // ---- phase-colored physical material (two-tone via vertex colors) ----
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.28,
    metalness: 0.0,
    transmission: 0.45,
    thickness: 1.5,
    ior: 1.32,
    clearcoat: 0.7,
    clearcoatRoughness: 0.3,
    emissive: new THREE.Color(PALETTE.cyan),
    emissiveIntensity: 0.04,
    envMapIntensity: 0.6,
    transparent: true,
    side: THREE.DoubleSide,
  });

  const resolution = ctx.width < 760 ? 40 : 52;
  const effect = new MarchingCubes(resolution, material, true, true, 70000);
  effect.position.set(0, 0, 0);
  effect.scale.set(640, 640, 640);
  effect.enableUvs = false;
  effect.enableColors = true; // we paint phase via addBall colors
  scene.add(effect);

  // faint wireframe overlay sharing the same field — a second marching-cubes at
  // lower res rendered as wire, tracing the lobe topology.
  const wireMat = new THREE.MeshBasicMaterial({
    color: PALETTE.cyan, wireframe: true, transparent: true, opacity: 0.10,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const wireRes = ctx.width < 760 ? 20 : 28;
  const wire = new MarchingCubes(wireRes, wireMat, false, false, 30000);
  wire.scale.copy(effect.scale);
  wire.enableUvs = false; wire.enableColors = false;
  scene.add(wire);

  // ---- glowing nucleus markers (one per orbital center) ----
  const numBlobs = 9;
  const nucGeo = new THREE.SphereGeometry(11, 16, 12);
  const nucMat = new THREE.MeshBasicMaterial({
    color: 0xbfe0ff, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const nuclei = new THREE.InstancedMesh(nucGeo, nucMat, numBlobs);
  nuclei.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  effect.add(nuclei); // child of effect so it shares the local 0..1 -> scale frame? No: effect uses internal field. Keep separate.
  effect.remove(nuclei);
  scene.add(nuclei);

  const subtract = 12;
  const strength = 1.15;
  const cPos = new Color3Cache();
  const m4 = new THREE.Matrix4();
  const tmpC = new THREE.Color();
  // dim the phase colors so the translucent surface doesn't bloom to white
  const cPlus = new THREE.Color(PALETTE.cyan).multiplyScalar(0.32);
  const cMinus = new THREE.Color(PALETTE.violet).lerp(new THREE.Color(PALETTE.blue), 0.4).multiplyScalar(0.32);

  // precompute per-blob sign (phase) — alternating + structured
  const sign: number[] = [];
  for (let i = 0; i < numBlobs; i++) sign.push(i % 2 === 0 ? 1 : -1);

  const addField = (target: MarchingCubes, t: number, withColor: boolean) => {
    for (let i = 0; i < numBlobs; i++) {
      const ballx = Math.sin(i + 1.26 * t * (1.03 + 0.5 * Math.cos(0.21 * i))) * 0.27 + 0.5;
      const bally = Math.abs(Math.cos(i + 1.12 * t * Math.cos(1.22 + 0.1424 * i))) * 0.77;
      const ballz = Math.cos(i + 1.32 * t * 0.1 * Math.sin(0.92 + 0.53 * i)) * 0.27 + 0.5;
      if (withColor) {
        const col = sign[i] > 0 ? cPlus : cMinus;
        target.addBall(ballx, bally, ballz, strength, subtract, col);
      } else {
        target.addBall(ballx, bally, ballz, strength, subtract);
      }
      cPos.set(i, ballx, bally, ballz);
    }
  };

  const positionNuclei = () => {
    // map field-space [0..1] to world: effect spans roughly [-scale/2, scale/2]
    const sx = effect.scale.x, sy = effect.scale.y, sz = effect.scale.z;
    for (let i = 0; i < numBlobs; i++) {
      const fx = cPos.x[i], fy = cPos.y[i], fz = cPos.z[i];
      const wx = (fx - 0.5) * sx;
      const wy = (fy - 0.5) * sy;
      const wz = (fz - 0.5) * sz;
      m4.makeScale(1, 1, 1);
      m4.setPosition(wx, wy, wz);
      nuclei.setMatrixAt(i, m4);
    }
    nuclei.instanceMatrix.needsUpdate = true;
  };

  onFrame((t) => {
    effect.reset();
    addField(effect, t, true);
    effect.update();

    wire.reset();
    addField(wire, t, false);
    wire.update();

    positionNuclei();

    const rotY = (reduced ? 0.6 : t * 0.12) + ctx.pointer.x * 0.4;
    const rotZ = ctx.pointer.y * 0.25;
    effect.rotation.set(0, rotY, rotZ);
    wire.rotation.copy(effect.rotation);
    nuclei.rotation.copy(effect.rotation);

    if (!reduced) {
      material.emissiveIntensity = 0.06 + Math.sin(t * 0.8) * 0.02;
    }
  });

  onDispose(() => {
    material.dispose();
    wireMat.dispose();
    nucGeo.dispose();
    nucMat.dispose();
    env.dispose();
  });
}

/** tiny struct-of-arrays cache for blob centers (avoids per-frame allocation) */
class Color3Cache {
  x: number[] = [];
  y: number[] = [];
  z: number[] = [];
  set(i: number, x: number, y: number, z: number) { this.x[i] = x; this.y[i] = y; this.z[i] = z; }
}
