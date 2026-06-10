/**
 * ElectronDensity — marching-cubes metaballs read as a molecular electron
 * density / orbital isosurface: smooth lobes that merge and split as the
 * underlying "atoms" drift. Glassy, env-lit, and bloom-friendly.
 */
import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

export function electronDensity(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera, renderer } = ctx;

  camera.position.set(0, 0, 1100);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;

  scene.add(new THREE.AmbientLight(0x335577, 1.2));
  const l1 = new THREE.DirectionalLight(0xffffff, 2.4); l1.position.set(1, 1, 1); scene.add(l1);
  const l2 = new THREE.PointLight(PALETTE.cyan, 2.0, 0, 0); l2.position.set(-400, 200, 300); scene.add(l2);
  const l3 = new THREE.PointLight(PALETTE.blue, 1.6, 0, 0); l3.position.set(400, -200, -200); scene.add(l3);

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(PALETTE.blue),
    roughness: 0.12,
    metalness: 0.0,
    transmission: 0.55,
    thickness: 1.4,
    ior: 1.35,
    clearcoat: 1.0,
    clearcoatRoughness: 0.2,
    emissive: new THREE.Color(PALETTE.cyan),
    emissiveIntensity: 0.12,
    envMapIntensity: 1.4,
    transparent: true,
  });

  const resolution = ctx.width < 760 ? 40 : 56;
  const effect = new MarchingCubes(resolution, material, true, false, 60000);
  effect.position.set(0, 0, 0);
  effect.scale.set(640, 640, 640);
  effect.enableUvs = false;
  effect.enableColors = false;
  scene.add(effect);

  const numBlobs = 9;
  const subtract = 12;
  const strength = 1.1;

  onFrame((t) => {
    effect.reset();
    for (let i = 0; i < numBlobs; i++) {
      const ballx = Math.sin(i + 1.26 * t * (1.03 + 0.5 * Math.cos(0.21 * i))) * 0.27 + 0.5;
      const bally = Math.abs(Math.cos(i + 1.12 * t * Math.cos(1.22 + 0.1424 * i))) * 0.77;
      const ballz = Math.cos(i + 1.32 * t * 0.1 * Math.sin(0.92 + 0.53 * i)) * 0.27 + 0.5;
      effect.addBall(ballx, bally, ballz, strength, subtract);
    }
    effect.update();

    effect.rotation.y = t * 0.12 + ctx.pointer.x * 0.4;
    effect.rotation.z = ctx.pointer.y * 0.25;
  });

  onDispose(() => {
    material.dispose();
    pmrem.dispose();
    env.dispose();
  });
}
