/**
 * Chromatography — a realistic COLUMN CHROMATOGRAPHY apparatus.
 *
 * A transparent glass column (with a rounded reservoir bulb on top and a
 * stopcock/valve at the bottom) is packed, bottom-up, with: a glass frit /
 * cotton plug, a thin sand layer, and a tall bed of granular SILICA GEL. Above
 * the silica sits the eluent (mobile-phase solvent) with a visibly curved
 * meniscus. A mixture loaded at the top of the bed resolves into several colored
 * BANDS that migrate downward at different rates (different Rf), broadening into
 * Gaussian zones with a little tailing as they go. Solvent drips from the
 * stopcock into collection vials below, which fill with the colored fractions as
 * each band elutes. A ring-stand + clamp holds the whole thing. Loops smoothly.
 *
 * Glassware reads as glass (transmission + specular highlights + meniscus);
 * bands read as glowing colored zones; everything sits on-brand: dark, additive,
 * bloom-friendly. ~1000 bench hours of column chemistry, distilled.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

export function chromatography(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera, renderer } = ctx;

  const mobile = ctx.width < 760;
  const reduced =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  camera.position.set(0, 1.5, 36);
  camera.lookAt(0, 0.5, 0);

  // ---- environment + lights (so glass actually reads as glass) ----
  // A lightweight gradient env (cheap data texture) instead of a PMREM-processed
  // RoomEnvironment — gives glass something to reflect without the heavy
  // pre-filter pass that can stall software-GL renderers.
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 4; envCanvas.height = 64;
  const ectx = envCanvas.getContext('2d')!;
  const grad = ectx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0.0, '#0a1426');
  grad.addColorStop(0.45, '#16314a');
  grad.addColorStop(0.6, '#2a4f6e');
  grad.addColorStop(0.75, '#7fa8c8');
  grad.addColorStop(1.0, '#0a1426');
  ectx.fillStyle = grad; ectx.fillRect(0, 0, 4, 64);
  const env = new THREE.CanvasTexture(envCanvas);
  env.mapping = THREE.EquirectangularReflectionMapping;
  env.colorSpace = THREE.SRGBColorSpace;
  scene.environment = env;

  scene.add(new THREE.AmbientLight(0x33507a, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(-6, 14, 10);
  scene.add(key);
  const rimCyan = new THREE.PointLight(PALETTE.cyan, 90, 70, 2);
  rimCyan.position.set(7, 2, 7);
  scene.add(rimCyan);
  const rimBlue = new THREE.PointLight(PALETTE.blue, 70, 70, 2);
  rimBlue.position.set(-8, -3, 6);
  scene.add(rimBlue);

  // ---- apparatus geometry constants (column local space, y up) ----
  const R = 2.2;             // inner column radius
  const WALL = 0.18;         // glass wall thickness
  const TOP = 13.0;          // y at top of straight column barrel
  const BOTTOM = -11.0;      // y at the bottom of the barrel (above the taper)
  const BED_TOP = 7.4;       // top of the silica bed
  const SAND_TOP = -8.2;     // top of the sand layer (bottom of silica)
  const FRIT_Y = -9.1;       // glass frit / cotton plug
  const SOLVENT_TOP = 10.4;  // eluent surface (meniscus) above the bed

  const root = new THREE.Group();
  scene.add(root);

  // small disposables registry so onDispose stays tidy
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(x: T): T => { disposables.push(x); return x; };

  // =====================================================================
  // GLASSWARE
  // =====================================================================
  // ONE real transmission glass for the main column barrel only (transmission
  // is expensive — each transmissive material forces an extra scene pass — so we
  // restrict it to the hero piece and fake the rest with cheap transparency).
  const glassMat = track(new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x9fc8e8),
    metalness: 0.0,
    roughness: 0.12,
    transmission: 0.7,
    thickness: 0.8,
    ior: 1.46,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
    reflectivity: 0.35,
    envMapIntensity: 0.7,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
  // cheap "glass-look" for all the small glassware (no transmission pass):
  // clearcoat + env reflections + low opacity read convincingly as glass.
  const glassLite = track(new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xa9d0ee),
    metalness: 0.0,
    roughness: 0.14,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
    reflectivity: 0.4,
    envMapIntensity: 0.9,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));

  // Outer glass shell built as a lathe so we get: a rounded reservoir bulb on
  // top, the straight barrel, then a conical taper down to the stopcock stem.
  const lp: THREE.Vector2[] = [];
  const bulbTop = TOP + 4.2;
  const rimR = R + WALL;
  // stem (bottom) -> taper -> barrel -> bulb shoulder -> bulb -> small neck
  lp.push(new THREE.Vector2(0.34, BOTTOM - 5.6));          // stopcock stem base
  lp.push(new THREE.Vector2(0.34, BOTTOM - 3.4));
  lp.push(new THREE.Vector2(rimR * 0.42, BOTTOM - 2.0));   // taper begins
  lp.push(new THREE.Vector2(rimR, BOTTOM - 0.2));          // taper -> barrel
  lp.push(new THREE.Vector2(rimR, TOP));                   // straight barrel
  lp.push(new THREE.Vector2(rimR * 1.5, TOP + 1.6));       // bulb shoulder out
  lp.push(new THREE.Vector2(rimR * 1.62, TOP + 3.0));      // widest bulb
  lp.push(new THREE.Vector2(rimR * 1.2, bulbTop));         // bulb closes in
  lp.push(new THREE.Vector2(rimR * 0.7, bulbTop + 0.9));   // short neck
  lp.push(new THREE.Vector2(rimR * 0.72, bulbTop + 1.7));  // flared lip
  const outerGeo = track(new THREE.LatheGeometry(lp, 64));
  const outerGlass = new THREE.Mesh(outerGeo, glassMat);
  root.add(outerGlass);

  // Inner wall (slightly smaller, back faces) — gives real double-wall refraction
  const lpIn = lp.map((v) => new THREE.Vector2(Math.max(0.0001, v.x - WALL), v.y));
  const innerGeo = track(new THREE.LatheGeometry(lpIn, 48));
  const innerGlassMat = track(glassLite.clone());
  innerGlassMat.side = THREE.BackSide;
  root.add(new THREE.Mesh(innerGeo, innerGlassMat));

  // A crisp specular highlight streak down the barrel (fakes a window reflection)
  const streakGeo = track(new THREE.PlaneGeometry(0.5, (TOP - BOTTOM) * 0.82));
  const streakMat = track(new THREE.MeshBasicMaterial({
    color: 0xbcd6ee, transparent: true, opacity: 0.05,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  const streak = new THREE.Mesh(streakGeo, streakMat);
  streak.position.set(-R * 0.55, (TOP + BOTTOM) / 2 + 1, R * 0.92);
  streak.rotation.y = 0.2;
  root.add(streak);
  const streak2 = new THREE.Mesh(streakGeo, streakMat);
  streak2.scale.set(0.5, 0.7, 1);
  streak2.position.set(R * 0.62, (TOP + BOTTOM) / 2 + 3, R * 0.86);
  streak2.rotation.y = -0.25;
  root.add(streak2);

  // =====================================================================
  // STOPCOCK / VALVE (PTFE-style) + drip tip
  // =====================================================================
  const stopcockMat = track(new THREE.MeshStandardMaterial({
    color: 0xeef3f8, roughness: 0.35, metalness: 0.05,
    emissive: 0x14202e, emissiveIntensity: 0.4,
  }));
  // horizontal valve barrel
  const valveGeo = track(new THREE.CylinderGeometry(0.55, 0.55, 2.6, 24));
  const valve = new THREE.Mesh(valveGeo, stopcockMat);
  valve.rotation.z = Math.PI / 2;
  valve.position.set(0, BOTTOM - 4.3, 0);
  root.add(valve);
  // valve handle (the wing you twist)
  const handleGeo = track(new THREE.BoxGeometry(2.4, 0.32, 0.7));
  const valveHandle = new THREE.Mesh(handleGeo, track(new THREE.MeshStandardMaterial({
    color: PALETTE.amber, roughness: 0.4, metalness: 0.1,
    emissive: new THREE.Color(PALETTE.amber).multiplyScalar(0.15),
  })));
  valveHandle.position.set(1.55, BOTTOM - 4.3, 0);
  root.add(valveHandle);
  // drip tip cone below the valve
  const tipGeo = track(new THREE.CylinderGeometry(0.05, 0.22, 1.1, 18));
  const tip = new THREE.Mesh(tipGeo, glassLite);
  tip.position.set(0, BOTTOM - 5.9, 0);
  root.add(tip);
  const tipY = BOTTOM - 6.5; // where droplets are born

  // =====================================================================
  // INTERNAL PACKING (frit, sand, silica) — all inside inner radius
  // =====================================================================
  const innerR = R - WALL * 0.5;

  // glass frit / cotton plug — a soft fibrous disc
  const fritGeo = track(new THREE.CylinderGeometry(innerR, innerR * 0.8, 0.7, 40));
  const fritMat = track(new THREE.MeshStandardMaterial({
    color: 0xdfe7ee, roughness: 0.95, metalness: 0.0,
    transparent: true, opacity: 0.55, emissive: 0x0c1420, emissiveIntensity: 0.3,
  }));
  const frit = new THREE.Mesh(fritGeo, fritMat);
  frit.position.y = FRIT_Y;
  root.add(frit);

  // thin sand layer (amber, slightly granular via flat shading)
  const sandGeo = track(new THREE.CylinderGeometry(innerR, innerR, 1.0, 40, 1));
  const sandMat = track(new THREE.MeshStandardMaterial({
    color: 0xd9a05a, roughness: 1.0, metalness: 0.0, flatShading: true,
    emissive: 0x2a1606, emissiveIntensity: 0.3,
  }));
  const sand = new THREE.Mesh(sandGeo, sandMat);
  sand.position.y = SAND_TOP - 0.5;
  root.add(sand);

  // SILICA GEL bed — packed cylinder, made subtly granular with a per-vertex
  // displacement and flat shading so it reads as a matte packed powder, not a
  // smooth plastic tube. Lit cool/white like real silica under lab light.
  const silicaH = BED_TOP - SAND_TOP;
  const silicaGeo = track(new THREE.CylinderGeometry(innerR, innerR, silicaH, 48, 28));
  {
    const pos = silicaGeo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const onWall = Math.abs(Math.hypot(v.x, v.z) - innerR) < 0.02;
      if (onWall) {
        // granular pitting on the cylindrical surface
        const n = Math.sin(v.y * 9.0 + v.x * 7.0) * Math.cos(v.y * 11.0 + v.z * 6.0);
        const s = 1 + n * 0.05;
        v.x *= s; v.z *= s;
        pos.setXYZ(i, v.x, v.y, v.z);
      }
    }
    silicaGeo.computeVertexNormals();
  }
  const silicaMat = track(new THREE.MeshStandardMaterial({
    color: 0x6f7e90, roughness: 1.0, metalness: 0.0, flatShading: true,
    emissive: 0x0a1018, emissiveIntensity: 0.25,
  }));
  const silica = new THREE.Mesh(silicaGeo, silicaMat);
  silica.position.y = (BED_TOP + SAND_TOP) / 2;
  root.add(silica);

  // faint granular speckle inside the bed (points) for texture & depth
  const SPECK = mobile ? 420 : 900;
  {
    const sp = new Float32Array(SPECK * 3);
    for (let i = 0; i < SPECK; i++) {
      const rr = innerR * 0.96 * Math.sqrt(Math.random());
      const th = Math.random() * Math.PI * 2;
      sp[i * 3] = Math.cos(th) * rr;
      sp[i * 3 + 1] = SAND_TOP + Math.random() * silicaH;
      sp[i * 3 + 2] = Math.sin(th) * rr;
    }
    const speckGeo = track(new THREE.BufferGeometry());
    speckGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const speckMat = track(new THREE.PointsMaterial({
      color: 0xdfe9f5, size: 0.07, transparent: true, opacity: 0.35,
      depthWrite: false, sizeAttenuation: true,
    }));
    root.add(new THREE.Points(speckGeo, speckMat));
  }

  // =====================================================================
  // ELUENT (mobile-phase solvent) above the silica, with a CURVED MENISCUS
  // =====================================================================
  const solventH = SOLVENT_TOP - BED_TOP;
  const solventGeo = track(new THREE.CylinderGeometry(innerR, innerR, solventH, 48, 1, true));
  const solventMat = track(new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.cyan), metalness: 0.0, roughness: 0.18,
    transparent: true, opacity: 0.22,
    emissive: new THREE.Color(PALETTE.cyan), emissiveIntensity: 0.04,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 0.8,
  }));
  const solvent = new THREE.Mesh(solventGeo, solventMat);
  solvent.position.y = (SOLVENT_TOP + BED_TOP) / 2;
  root.add(solvent);

  // concave meniscus: a dish-shaped surface that dips in the center & wets edges
  const menGeo = track(new THREE.CircleGeometry(innerR, 48, 0, Math.PI * 2));
  {
    const pos = menGeo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const rr = Math.hypot(v.x, v.y) / innerR;
      // CircleGeometry is in XY; we will rotate to XZ. Dip center, raise rim.
      const z = -0.42 * (1 - rr * rr) + 0.18 * Math.pow(rr, 6);
      pos.setXYZ(i, v.x, v.y, z);
    }
    menGeo.computeVertexNormals();
  }
  const menMat = track(new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xc4f2fb), metalness: 0.0, roughness: 0.08,
    transparent: true, opacity: 0.4,
    clearcoat: 1.0, clearcoatRoughness: 0.05, side: THREE.DoubleSide,
    emissive: new THREE.Color(PALETTE.cyan), emissiveIntensity: 0.06,
    envMapIntensity: 1.1, depthWrite: false,
  }));
  const meniscus = new THREE.Mesh(menGeo, menMat);
  meniscus.rotation.x = -Math.PI / 2;
  meniscus.position.y = SOLVENT_TOP;
  root.add(meniscus);

  // =====================================================================
  // RING STAND + CLAMP
  // =====================================================================
  const steelMat = track(new THREE.MeshStandardMaterial({
    color: 0x8d99a6, roughness: 0.35, metalness: 0.85, envMapIntensity: 1.0,
  }));
  const rodX = R + 8.5;
  const standRod = new THREE.Mesh(track(new THREE.CylinderGeometry(0.28, 0.28, 34, 20)), steelMat);
  standRod.position.set(rodX, 1, -1.2);
  root.add(standRod);
  const baseGeo = track(new THREE.BoxGeometry(7, 0.7, 4.5));
  const base = new THREE.Mesh(baseGeo, steelMat);
  base.position.set(rodX - 1.5, BOTTOM - 6.2, -1.2);
  root.add(base);
  // clamp arm reaching to the column + a colored grip
  const armGeo = track(new THREE.CylinderGeometry(0.2, 0.2, 8.6, 16));
  const arm = new THREE.Mesh(armGeo, steelMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(rodX - 4.2, 4.5, -1.2);
  root.add(arm);
  // clamp jaws (two arcs hugging the barrel)
  const jawMat = track(new THREE.MeshStandardMaterial({
    color: 0x20262d, roughness: 0.6, metalness: 0.3,
  }));
  for (const s of [-1, 1]) {
    const jaw = new THREE.Mesh(track(new THREE.TorusGeometry(R + 0.4, 0.22, 10, 24, Math.PI)), jawMat);
    jaw.position.set(0, 4.5, 0);
    jaw.rotation.x = Math.PI / 2;
    jaw.rotation.z = s > 0 ? 0 : Math.PI;
    root.add(jaw);
  }

  // =====================================================================
  // COLLECTION VIALS / FRACTION TUBES (fill as bands elute)
  // =====================================================================
  const NVIAL = 4;
  const vialR = 0.95;
  const vialH = 4.4;
  const vialY0 = BOTTOM - 9.4;       // base of vials
  const vialSpacing = 2.5;
  const vialX0 = -(NVIAL - 1) * vialSpacing * 0.5;
  interface Vial {
    fillMesh: THREE.Mesh;
    fillMat: THREE.MeshStandardMaterial;
    level: number;       // 0..1 current fill
    x: number;
    targetColor: THREE.Color;
  }
  const vials: Vial[] = [];
  // a little tray rail the vials sit in
  const tray = new THREE.Mesh(
    track(new THREE.BoxGeometry(NVIAL * vialSpacing + 1.2, 0.5, 2.2)),
    steelMat,
  );
  tray.position.set(0, vialY0 - 0.2, 0);
  root.add(tray);

  for (let i = 0; i < NVIAL; i++) {
    const x = vialX0 + i * vialSpacing;
    // glass tube
    const tube = new THREE.Mesh(
      track(new THREE.CylinderGeometry(vialR, vialR, vialH, 24, 1, true)),
      glassLite,
    );
    tube.position.set(x, vialY0 + vialH / 2, 0);
    root.add(tube);
    // rounded bottom
    const bottom = new THREE.Mesh(
      track(new THREE.SphereGeometry(vialR, 20, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5)),
      glassLite,
    );
    bottom.position.set(x, vialY0, 0);
    root.add(bottom);
    // liquid fill (scaled up over time)
    const fillMat = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x102030), roughness: 0.2, metalness: 0.0,
      transparent: true, opacity: 0.85,
      emissive: new THREE.Color(0x000000), emissiveIntensity: 0.6,
    }));
    const fillMesh = new THREE.Mesh(
      track(new THREE.CylinderGeometry(vialR * 0.92, vialR * 0.92, 1, 24)),
      fillMat,
    );
    fillMesh.position.set(x, vialY0 + 0.5, 0);
    fillMesh.scale.y = 0.001;
    root.add(fillMesh);
    vials.push({ fillMesh, fillMat, level: 0, x, targetColor: new THREE.Color(0x102030) });
  }

  // =====================================================================
  // SAMPLE BANDS (the analytes) — instanced glowing discs forming Gaussian
  // zones that broaden + tail as they migrate. Plus a particle haze per band.
  // =====================================================================
  const bandDefs = [
    { color: PALETTE.cyan,   rate: 1.00 },
    { color: PALETTE.violet, rate: 0.74 },
    { color: PALETTE.amber,  rate: 0.52 },
    { color: PALETTE.blue,   rate: 0.34 },
  ];
  const NB = bandDefs.length;

  // particle haze: each band gets PER particles; we animate them as a Gaussian
  // cloud whose center migrates and whose sigma grows (broadening + tailing).
  const PER = mobile ? 70 : 130;
  const NP = NB * PER;
  const pPos = new Float32Array(NP * 3);
  const pCol = new Float32Array(NP * 3);
  const pScale = new Float32Array(NP);
  const pBand = new Uint8Array(NP);
  const pRX = new Float32Array(NP);     // radial position in disc
  const pRZ = new Float32Array(NP);
  const pG = new Float32Array(NP);      // gaussian offset seed (-1..1, tail-skewed)
  const pPhase = new Float32Array(NP);  // for gentle shimmer

  for (let b = 0; b < NB; b++) {
    for (let k = 0; k < PER; k++) {
      const i = b * PER + k;
      pBand[i] = b;
      const rr = innerR * 0.9 * Math.sqrt(Math.random());
      const th = Math.random() * Math.PI * 2;
      pRX[i] = Math.cos(th) * rr;
      pRZ[i] = Math.sin(th) * rr;
      // gaussian via sum of uniforms; bias slightly negative (downstream) -> tail
      let g = (Math.random() + Math.random() + Math.random() + Math.random()) / 4 - 0.5;
      g *= 2;
      pG[i] = g;
      pScale[i] = 0.7 + Math.random() * 0.9;
      pPhase[i] = Math.random() * Math.PI * 2;
    }
  }
  const hazeGeo = new THREE.BufferGeometry();
  hazeGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  hazeGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  hazeGeo.setAttribute('aScale', new THREE.BufferAttribute(pScale, 1));
  const hazeMat = track(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aScale; attribute vec3 aColor; varying vec3 vColor;
      void main() { vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aScale * (220.0 / -mv.z);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() { float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.06, d);
        gl_FragColor = vec4(vColor, a); }`,
  }));
  const haze = new THREE.Points(hazeGeo, hazeMat);
  root.add(haze);

  // solid "band core" — a translucent colored cylinder per band that reads as a
  // saturated colored zone wetting the silica. Scaled in Y to its sigma.
  interface Band { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; base: THREE.Color; rate: number; }
  const bands: Band[] = [];
  for (let b = 0; b < NB; b++) {
    const base = new THREE.Color(bandDefs[b].color);
    const mat = track(new THREE.MeshStandardMaterial({
      color: base.clone(), roughness: 0.55, metalness: 0.0,
      transparent: true, opacity: 0.55, depthWrite: false,
      emissive: base.clone().multiplyScalar(0.35), emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
    }));
    const mesh = new THREE.Mesh(
      track(new THREE.CylinderGeometry(innerR * 0.99, innerR * 0.99, 1, 40, 1, true)),
      mat,
    );
    root.add(mesh);
    bands.push({ mesh, mat, base, rate: bandDefs[b].rate });
  }

  // =====================================================================
  // DROPLETS dripping from the stopcock into the active vial
  // =====================================================================
  const NDROP = 6;
  interface Drop { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; t: number; active: boolean; targetX: number; color: THREE.Color; }
  const drops: Drop[] = [];
  const dropGeo = track(new THREE.SphereGeometry(0.16, 12, 10));
  for (let i = 0; i < NDROP; i++) {
    const mat = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.cyan), roughness: 0.15, metalness: 0.0,
      transparent: true, opacity: 0.9, emissive: new THREE.Color(PALETTE.cyan),
      emissiveIntensity: 0.45,
    }));
    const mesh = new THREE.Mesh(dropGeo, mat);
    mesh.visible = false;
    mesh.scale.set(0.9, 1.3, 0.9); // teardrop-ish
    root.add(mesh);
    drops.push({ mesh, mat, t: 0, active: false, targetX: 0, color: new THREE.Color(PALETTE.cyan) });
  }

  // =====================================================================
  // ANIMATION
  // =====================================================================
  // Migration model: a band's center travels from BED_TOP down past the frit.
  // prog 0..1 over RUN seconds; bands all start as a tight zone at BED_TOP.
  const RUN = 16.0;
  const START = 4.0;                      // begin mid-run so bands pre-separated
  const ELUTE_Y = FRIT_Y - 0.3;           // y at which a band "exits" the column
  const TRAVEL = BED_TOP - ELUTE_Y;       // total migration distance for rate=1
  const tmp = new THREE.Color();
  const tmpV = new THREE.Vector3();
  let dripAccum = 0;
  let lastElutedVial = -1;

  // pick which vial a band drains into (fastest band -> vial 0, etc.)
  const vialForBand = [0, 1, 2, 3];

  const updateBands = (t: number) => {
    const prog = ((t + START) % RUN) / RUN;

    // ---- band cores + haze ----
    let activeBand = -1;     // band currently eluting (near the frit)
    for (let b = 0; b < NB; b++) {
      const rate = bands[b].rate;
      const center = BED_TOP - rate * prog * TRAVEL;
      // sigma grows with distance traveled (diffusion / broadening) + a floor
      const traveled = BED_TOP - center;
      const sigma = 0.55 + Math.max(0, traveled) * 0.085;

      // visibility: present while inside the column window; fade as it elutes
      let vis = 1;
      if (center < ELUTE_Y + 1.5) vis = Math.max(0, (center - (ELUTE_Y - 2.0)) / 3.5);
      if (center > BED_TOP + 0.3) vis = Math.max(0, 1 - (center - BED_TOP) / 1.5);

      // band core mesh
      const bm = bands[b];
      bm.mesh.position.y = center;
      bm.mesh.scale.y = Math.max(0.001, sigma * 2.0);
      bm.mat.opacity = 0.7 * vis;
      bm.mat.emissiveIntensity = 0.65 * vis;

      // is this the band currently dripping out?
      if (center <= ELUTE_Y + 1.2 && center >= ELUTE_Y - 1.0 && vis > 0.05) activeBand = b;

      // haze particles for this band
      for (let k = 0; k < PER; k++) {
        const i = b * PER + k;
        // tail-skewed gaussian: positive g (downstream) stretched a bit
        const gg = pG[i];
        const skew = gg < 0 ? gg : gg * 1.7; // longer downstream tail
        const y = center + skew * sigma;
        const i3 = i * 3;
        pPos[i3] = pRX[i] + Math.sin(t * 0.8 + pPhase[i]) * 0.05;
        pPos[i3 + 1] = y;
        pPos[i3 + 2] = pRZ[i];

        // alpha falls toward the band edges and with elution
        const edge = 1 - Math.min(1, Math.abs(skew) / 2.2);
        let a = edge * vis;
        if (y < ELUTE_Y) a *= Math.max(0, 1 + (y - ELUTE_Y) / 2.0);
        tmp.copy(bands[b].base).multiplyScalar(0.32 * a);
        pCol[i3] = tmp.r; pCol[i3 + 1] = tmp.g; pCol[i3 + 2] = tmp.b;
      }
    }
    hazeGeo.attributes.position.needsUpdate = true;
    hazeGeo.attributes.aColor.needsUpdate = true;

    return activeBand;
  };

  const spawnDrop = (color: THREE.Color, targetX: number) => {
    for (const d of drops) {
      if (!d.active) {
        d.active = true; d.t = 0; d.mesh.visible = true;
        d.color.copy(color); d.mat.color.copy(color); d.mat.emissive.copy(color);
        d.targetX = targetX;
        return;
      }
    }
  };

  onFrame((t, dt) => {
    const activeBand = updateBands(t);

    // ---- dripping: when a band is eluting, spawn droplets at intervals ----
    if (activeBand >= 0 && !reduced) {
      dripAccum += dt;
      const interval = 0.55;
      if (dripAccum >= interval) {
        dripAccum = 0;
        const vIdx = vialForBand[activeBand] ?? 0;
        spawnDrop(bands[activeBand].base, vials[vIdx].x);
      }
    } else {
      dripAccum = Math.min(dripAccum, 0.3);
    }

    // ---- advance droplets (fall from tip to its vial, then fill it) ----
    for (const d of drops) {
      if (!d.active) continue;
      d.t += dt;
      const fall = 1.05;               // seconds to fall
      const f = d.t / fall;
      if (f >= 1) {
        // deposit into the nearest vial
        let vi = 0, best = Infinity;
        for (let i = 0; i < vials.length; i++) {
          const dd = Math.abs(vials[i].x - d.targetX);
          if (dd < best) { best = dd; vi = i; }
        }
        const v = vials[vi];
        v.level = Math.min(1, v.level + 0.05);
        v.targetColor.copy(d.color);
        d.active = false; d.mesh.visible = false;
        continue;
      }
      // teardrop position: ease down from tip toward vial mouth, drift x
      const y0 = tipY, y1 = vials[0].x !== undefined ? (vialY0 + 0.3) : tipY;
      const y = THREE.MathUtils.lerp(y0, vialY0 + 0.3, f * f);
      const x = THREE.MathUtils.lerp(0, d.targetX, Math.min(1, f * 1.3));
      d.mesh.position.set(x, y, 0);
      // stretch while falling
      const stretch = 1 + f * 0.6;
      d.mesh.scale.set(0.85, 1.1 * stretch, 0.85);
      d.mat.opacity = 0.9 * (1 - f * 0.2);
    }

    // ---- vials ease toward their fill level + color ----
    for (const v of vials) {
      const targetH = v.level * (vialH - 0.6);
      v.fillMesh.scale.y = THREE.MathUtils.lerp(v.fillMesh.scale.y, Math.max(0.001, targetH), 0.12);
      v.fillMesh.position.y = vialY0 + 0.3 + v.fillMesh.scale.y / 2;
      v.fillMat.color.lerp(v.targetColor, 0.06);
      v.fillMat.emissive.copy(v.fillMat.color).multiplyScalar(0.5);
    }

    // ---- recycle: once the slowest band has eluted, drain & refill vials ----
    const prog = ((t + START) % RUN) / RUN;
    if (prog < 0.06) {
      for (const v of vials) { v.level = 0; }
    }

    // ---- gentle presentation motion (very slow; user hates jank) ----
    if (!reduced) {
      root.rotation.y = Math.sin(t * 0.12) * 0.18 + ctx.pointer.x * 0.18;
      root.rotation.x = THREE.MathUtils.lerp(root.rotation.x, ctx.pointer.y * 0.06, 0.04);
      // subtle solvent shimmer on the meniscus emissive
      menMat.emissiveIntensity = 0.08 + Math.sin(t * 1.4) * 0.02;
    }
  });

  onDispose(() => {
    for (const d of disposables) { try { d.dispose(); } catch { /* noop */ } }
    hazeGeo.dispose();
    env.dispose();
  });
}
