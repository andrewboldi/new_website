/**
 * MoleculeViewer — loads a real molecule from a PDB file and renders it as a
 * glowing ball-and-stick model that the visitor can spin. Organic chemistry,
 * made tangible.
 */
import * as THREE from 'three';
import { PDBLoader } from 'three/examples/jsm/loaders/PDBLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

interface Opts {
  /** resolved URL to a .pdb file */
  url: string;
  scale?: number;
  autoRotate?: number;
}

export function moleculeViewer(handle: SceneHandle, opts: Opts) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera, renderer } = ctx;

  camera.position.set(0, 0, 26);

  scene.add(new THREE.AmbientLight(0x99bbff, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(6, 8, 10);
  scene.add(key);
  const rim = new THREE.PointLight(PALETTE.cyan, 60, 120);
  rim.position.set(-8, -4, 6);
  scene.add(rim);
  const fill = new THREE.PointLight(PALETTE.blue, 40, 120);
  fill.position.set(8, 2, -8);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = opts.autoRotate ?? 1.6;
  controls.rotateSpeed = 0.6;

  const root = new THREE.Group();
  scene.add(root);

  const sphereGeo = new THREE.IcosahedronGeometry(1, 3);
  const bondGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 12, 1, true);
  const S = opts.scale ?? 3.2;
  const up = new THREE.Vector3(0, 1, 0);

  const loader = new PDBLoader();
  loader.load(
    opts.url,
    (pdb) => {
      const geoAtoms = pdb.geometryAtoms;
      const geoBonds = pdb.geometryBonds;
      const json = pdb.json;

      const box = new THREE.Box3().setFromBufferAttribute(
        geoAtoms.getAttribute('position') as THREE.BufferAttribute,
      );
      const offset = box.getCenter(new THREE.Vector3()).negate();

      const posA = geoAtoms.getAttribute('position');
      const colA = geoAtoms.getAttribute('color');
      const p = new THREE.Vector3();
      const c = new THREE.Color();

      for (let i = 0; i < posA.count; i++) {
        p.fromBufferAttribute(posA, i).add(offset).multiplyScalar(S);
        c.fromBufferAttribute(colA, i);
        const element = json.atoms[i]?.[4] ?? 'C';
        const radius = element === 'H' ? 0.34 : 0.62;
        const mat = new THREE.MeshStandardMaterial({
          color: c,
          roughness: 0.35,
          metalness: 0.1,
          emissive: c.clone().multiplyScalar(0.18),
        });
        const atom = new THREE.Mesh(sphereGeo, mat);
        atom.position.copy(p);
        atom.scale.setScalar(radius);
        root.add(atom);
      }

      // bonds: pairs of positions
      const posB = geoBonds.getAttribute('position');
      const start = new THREE.Vector3();
      const end = new THREE.Vector3();
      const bondMat = new THREE.MeshStandardMaterial({
        color: 0xcfdcff,
        roughness: 0.5,
        metalness: 0.2,
        emissive: 0x0a1830,
      });
      for (let i = 0; i < posB.count; i += 2) {
        start.fromBufferAttribute(posB, i).add(offset).multiplyScalar(S);
        end.fromBufferAttribute(posB, i + 1).add(offset).multiplyScalar(S);
        const bond = new THREE.Mesh(bondGeo, bondMat);
        bond.position.copy(start).lerp(end, 0.5);
        bond.scale.y = start.distanceTo(end);
        bond.quaternion.setFromUnitVectors(
          up,
          end.clone().sub(start).normalize(),
        );
        root.add(bond);
      }

      // frame the molecule
      const r = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length();
      camera.position.set(0, 0, r * 0.92 + 6);
      controls.update();
    },
    undefined,
    () => { /* swallow load errors gracefully */ },
  );

  onFrame(() => controls.update());
  onDispose(() => {
    controls.dispose();
    sphereGeo.dispose();
    bondGeo.dispose();
  });
}
