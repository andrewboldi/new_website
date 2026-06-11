/**
 * MoleculeViewer — loads a real molecule from a PDB file and renders it as a
 * premium, glowing BALL-AND-STICK model the visitor can spin.
 *
 * Detail: specular env-lit CPK-colored atom spheres (instanced) with a subtle
 * rim light and a faint per-atom electron-cloud halo; bonds as shaded cylinders
 * (instanced), with DOUBLE bonds drawn as twin parallel rods where the geometry
 * implies them; a gentle breathing + auto-rotate; soft bloom. The PDB-loading
 * interface is unchanged.
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

  const reduced =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  camera.position.set(0, 0, 26);

  // Environment for real specular reflections on the clearcoat/iridescent
  // atoms. We start from a cheap on-brand gradient CanvasTexture, then try to
  // PMREM-prefilter a tiny emissive "studio" so roughness maps to mip blur and
  // the glossy coat picks up soft colored highlights (cool key, blue fill, a
  // faint amber rim) instead of a flat smear. environmentIntensity is kept LOW
  // so the dark mood survives. PMREM is a one-time init cost (free per frame);
  // if it throws on software-GL we silently keep the raw gradient.
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 4; envCanvas.height = 64;
  const ectx = envCanvas.getContext('2d')!;
  const grad = ectx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0.0, '#0a1426');
  grad.addColorStop(0.4, '#16314a');
  grad.addColorStop(0.6, '#3a6488');
  grad.addColorStop(0.78, '#bcd6ee');
  grad.addColorStop(1.0, '#0a1426');
  ectx.fillStyle = grad; ectx.fillRect(0, 0, 4, 64);
  const env = new THREE.CanvasTexture(envCanvas);
  env.mapping = THREE.EquirectangularReflectionMapping;
  env.colorSpace = THREE.SRGBColorSpace;

  let envTexture: THREE.Texture = env;
  let pmremRT: THREE.WebGLRenderTarget | null = null;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    // tiny palette studio: a few emissive planes in the brand colors. Rendered
    // once into a PMREM cube, then disposed. Gives on-brand colored reflections
    // without any HDR download.
    const envScene = new THREE.Scene();
    const panel = (color: number, intensity: number, pos: [number, number, number], s: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(s, s),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: intensity }),
      );
      m.position.set(...pos);
      m.lookAt(0, 0, 0);
      envScene.add(m);
    };
    envScene.add(new THREE.Mesh(
      new THREE.SphereGeometry(50, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x070b14, side: THREE.BackSide }),
    ));
    panel(0xbcd6ee, 0.95, [6, 9, 8], 22);   // cool key
    panel(PALETTE.blue, 0.55, [-9, 2, 6], 18);  // blue fill
    panel(PALETTE.cyan, 0.4, [-3, -7, -8], 14); // cyan under-bounce
    panel(PALETTE.amber, 0.22, [8, 1, -9], 10); // faint amber rim
    pmremRT = pmrem.fromScene(envScene, 0.04);
    envTexture = pmremRT.texture;
    envScene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
    pmrem.dispose();
  } catch {
    envTexture = env; // software-GL fallback: raw gradient still lights PBR
  }
  scene.environment = envTexture;
  // keep IBL subtle so the scene stays dark/scientific, not studio-bright
  scene.environmentIntensity = 0.62;

  // Three-point-ish rig. The PMREM env now supplies soft IBL fill + the
  // reflections the clearcoat/iridescence need, so the raw key is eased a touch
  // (2.4 -> 2.0) to keep the lacquer highlight crisp without driving pixels to
  // white (bloom threshold is 0.45). Ambient is lowered for the same reason —
  // the env carries the ambient now.
  scene.add(new THREE.AmbientLight(0x99bbff, 0.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(6, 8, 10);
  scene.add(key);
  const rim = new THREE.PointLight(PALETTE.cyan, 85, 140, 2);
  rim.position.set(-9, -4, 7);
  scene.add(rim);
  const fill = new THREE.PointLight(PALETTE.blue, 50, 140, 2);
  fill.position.set(9, 3, -9);
  scene.add(fill);
  // a tighter back rim to pop the silhouette against the dark interlude bg
  const back = new THREE.DirectionalLight(0xbfe0ff, 1.25);
  back.position.set(-4, 2, -11);
  scene.add(back);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = opts.autoRotate ?? 1.4;
  controls.rotateSpeed = 0.6;

  const root = new THREE.Group();
  scene.add(root);
  // a separate group for halos so we can pulse them independently
  const haloGroup = new THREE.Group();
  root.add(haloGroup);

  const sphereGeo = new THREE.IcosahedronGeometry(1, 4);
  const bondGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
  const haloGeo = new THREE.IcosahedronGeometry(1, 2);
  const S = opts.scale ?? 3.2;
  const up = new THREE.Vector3(0, 1, 0);

  const disposables: Array<{ dispose: () => void }> = [sphereGeo, bondGeo, haloGeo];

  // halo shader: soft fresnel shell that reads as an electron cloud
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(PALETTE.cyan) }, uPulse: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vView;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vView; uniform vec3 uColor; uniform float uPulse;
      void main() {
        float ndv = max(0.0, dot(normalize(vN), normalize(vView)));
        // crisp fresnel rim for silhouette pop (thin, bright edge) ...
        float rim = pow(1.0 - ndv, 3.4);
        // ... plus a soft broad shell so it still reads as an electron cloud.
        float cloud = pow(1.0 - ndv, 1.7) * 0.32;
        float f = rim + cloud;
        // capped so it stays a halo, never a blown-out blob (bloom threshold 0.45)
        gl_FragColor = vec4(uColor, min(0.62, f * 0.5 * uPulse));
      }`,
  });
  disposables.push(haloMat);

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
      const nAtoms = posA.count;

      // ---- store atom data (positions in scaled local space + element radius) ----
      const atomPos: THREE.Vector3[] = [];
      const atomRadius = new Float32Array(nAtoms);
      const p = new THREE.Vector3();
      const c = new THREE.Color();
      const m4 = new THREE.Matrix4();

      // CPK-ish van-der-Waals scaling (relative)
      const radiusFor = (el: string) =>
        el === 'H' ? 0.32 : el === 'C' ? 0.62 : el === 'N' ? 0.58 :
        el === 'O' ? 0.56 : el === 'S' ? 0.78 : el === 'P' ? 0.8 : 0.6;

      // ---- instanced atoms ----
      // Premium PBR: a glossy lacquered clearcoat over the CPK base, plus a
      // whisper of iridescence so the specular highlights pick up a soap-film
      // color shift (on-brand "molecular/optical" flourish). Both are cheap
      // shader additions — no transmission (would cost a back-buffer per frame
      // and risks blowing out a dark scene).
      const atomMat = new THREE.MeshPhysicalMaterial({
        vertexColors: false, color: 0xffffff, roughness: 0.22, metalness: 0.0,
        clearcoat: 1.0, clearcoatRoughness: 0.1,
        iridescence: 0.32, iridescenceIOR: 1.32,
        iridescenceThicknessRange: [120, 380],
        envMapIntensity: 1.15,
        emissiveIntensity: 0.0,
      });
      disposables.push(atomMat);
      const atoms = new THREE.InstancedMesh(sphereGeo, atomMat, nAtoms);
      atoms.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nAtoms * 3), 3);

      // halos (instanced, slightly larger than atoms)
      const halos = new THREE.InstancedMesh(haloGeo, haloMat, nAtoms);

      for (let i = 0; i < nAtoms; i++) {
        p.fromBufferAttribute(posA, i).add(offset).multiplyScalar(S);
        c.fromBufferAttribute(colA, i);
        const el = (json.atoms[i]?.[4] as string) ?? 'C';
        const radius = radiusFor(el);
        atomPos.push(p.clone());
        atomRadius[i] = radius;

        m4.makeScale(radius, radius, radius);
        m4.setPosition(p);
        atoms.setMatrixAt(i, m4);
        atoms.setColorAt(i, c);

        m4.makeScale(radius * 1.85, radius * 1.85, radius * 1.85);
        m4.setPosition(p);
        halos.setMatrixAt(i, m4);
      }
      atoms.instanceMatrix.needsUpdate = true;
      if (atoms.instanceColor) atoms.instanceColor.needsUpdate = true;
      halos.instanceMatrix.needsUpdate = true;
      root.add(atoms);
      haloGroup.add(halos);

      // ---- bonds (instanced cylinders) with DOUBLE-bond detection ----
      const posB = geoBonds.getAttribute('position');
      const nBondsRaw = Math.floor(posB.count / 2);
      const start = new THREE.Vector3();
      const end = new THREE.Vector3();

      // collect bond endpoints; detect short C–C / C–O / C–N pairs that PDBLoader
      // may have emitted twice or that are short enough to render as doubles.
      interface B { a: THREE.Vector3; b: THREE.Vector3; len: number; }
      const rawBonds: B[] = [];
      for (let i = 0; i < posB.count; i += 2) {
        start.fromBufferAttribute(posB, i).add(offset).multiplyScalar(S);
        end.fromBufferAttribute(posB, i + 1).add(offset).multiplyScalar(S);
        rawBonds.push({ a: start.clone(), b: end.clone(), len: start.distanceTo(end) });
      }

      // figure out which bonds to draw doubled: shorter-than-typical bonds get a
      // twin offset rod. (Heuristic — PDB has no explicit order; this just adds
      // visual richness consistent with the structure.)
      const lens = rawBonds.map((x) => x.len).sort((a, b) => a - b);
      const medLen = lens.length ? lens[Math.floor(lens.length / 2)] : 1;
      const doubleThresh = medLen * 0.92;

      // count total rods (singles=1, doubles=2)
      let rodCount = 0;
      for (const bd of rawBonds) rodCount += bd.len < doubleThresh ? 2 : 1;

      const bondMat = new THREE.MeshPhysicalMaterial({
        color: 0xcdd9f2, roughness: 0.32, metalness: 0.15,
        clearcoat: 0.9, clearcoatRoughness: 0.16,
        iridescence: 0.18, iridescenceIOR: 1.3,
        iridescenceThicknessRange: [140, 360],
        envMapIntensity: 1.0,
        // keep emissive low: bloom threshold is 0.45, so this must not push the
        // rods over the cutoff and wash the silhouette to white.
        emissive: 0x0a1626, emissiveIntensity: 0.35,
      });
      disposables.push(bondMat);
      const bonds = new THREE.InstancedMesh(bondGeo, bondMat, rodCount);

      const dir = new THREE.Vector3();
      const mid = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const perp = new THREE.Vector3();
      const scl = new THREE.Vector3();
      let ri = 0;
      const placeRod = (a: THREE.Vector3, b: THREE.Vector3, off: THREE.Vector3, rad: number) => {
        dir.subVectors(b, a);
        const len = dir.length();
        mid.addVectors(a, b).multiplyScalar(0.5).add(off);
        quat.setFromUnitVectors(up, dir.clone().normalize());
        scl.set(rad, len, rad);
        m4.compose(mid, quat, scl);
        bonds.setMatrixAt(ri++, m4);
      };
      const ZERO = new THREE.Vector3();
      for (const bd of rawBonds) {
        if (bd.len < doubleThresh) {
          // double: offset perpendicular to bond, in a stable plane
          dir.subVectors(bd.b, bd.a).normalize();
          perp.set(dir.y, -dir.x, 0);
          if (perp.lengthSq() < 1e-4) perp.set(0, dir.z, -dir.y);
          perp.normalize().multiplyScalar(0.13 * S * 0.3 + 0.11);
          placeRod(bd.a, bd.b, perp, 0.075 * S * 0.45 + 0.05);
          placeRod(bd.a, bd.b, perp.clone().negate(), 0.075 * S * 0.45 + 0.05);
        } else {
          placeRod(bd.a, bd.b, ZERO, 0.11 * S * 0.35 + 0.06);
        }
      }
      bonds.instanceMatrix.needsUpdate = true;
      root.add(bonds);

      // frame the molecule
      const r = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length();
      camera.position.set(0, 0, r * 0.92 + 6);
      controls.update();
    },
    undefined,
    () => { /* swallow load errors gracefully */ },
  );

  onFrame((t) => {
    controls.update();
    if (!reduced) {
      // gentle breathing of the whole molecule
      root.scale.setScalar(1 + Math.sin(t * 0.9) * 0.018);
      // halo pulse
      (haloMat.uniforms.uPulse.value as number) = 0.8 + Math.sin(t * 1.3) * 0.25;
    }
  });
  onDispose(() => {
    controls.dispose();
    for (const d of disposables) { try { d.dispose(); } catch { /* noop */ } }
    env.dispose();
    if (pmremRT) { try { pmremRT.dispose(); } catch { /* noop */ } }
  });
}
