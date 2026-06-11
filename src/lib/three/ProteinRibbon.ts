/**
 * ProteinRibbon — Green Fluorescent Protein (PDB 1EMA) rendered as a proper
 * molecular CARTOON and folded into being, the way an AlphaFold trace resolves
 * into structure. GFP is a 221-residue, 11-stranded β-barrel wrapping a central
 * α-helix that carries the chromophore — the molecule behind the cyan glow this
 * whole site borrows.
 *
 * The cartoon is built the way PyMOL builds one:
 *   • β-STRANDS  → flat extruded ribbons that flare into an arrowhead at their
 *                  C-terminal end; eleven of them close into the barrel.
 *   • α-HELIX    → a flat ribbon that twists like coiled tape, threaded through
 *                  the barrel's core.
 *   • COIL/LOOPS → smooth thin tubes stitching the elements together.
 * Secondary structure drives the color (cyan/blue sheets, amber helix, slate
 * loops) and MeshStandard + bloom give it depth.
 *
 * The FOLD: every cartoon vertex carries its native position AND an "extended"
 * position (the chain unfurled into a loose ribbon). A fold-front sweeps N→C and
 * each vertex is lerped extended→native as the front passes it, so the barrel
 * assembles strand by strand. All geometry is built ONCE; each frame only writes
 * into preallocated position buffers — no per-frame allocation. The chromophore
 * ignites the instant the fold completes around it.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, prefersReducedMotion } from './core';
import { GFP } from './proteinData';

type SS = 'H' | 'E' | 'C';
interface Seg { type: SS; start: number; end: number } // inclusive residue range

export function proteinRibbon(handle: SceneHandle) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera } = ctx;
  const reduced = prefersReducedMotion();

  // ---------- lighting: a warm key against cool cyan rim, for Rembrandt depth ----------
  scene.add(new THREE.AmbientLight(0x47648f, 0.95));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.1); key.position.set(7, 10, 12); scene.add(key);
  const rim = new THREE.PointLight(PALETTE.cyan, 75, 280); rim.position.set(-15, 9, 11); scene.add(rim);
  const fill = new THREE.PointLight(PALETTE.blue, 42, 280); fill.position.set(13, -7, -9); scene.add(fill);

  const group = new THREE.Group();
  scene.add(group);

  // ---------- backbone curve & a smooth, resampled centerline ----------
  const ca = GFP.ca.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const n = ca.length;
  const ssStr = GFP.ss;
  const backbone = new THREE.CatmullRomCurve3(ca, false, 'catmullrom', 0.5);

  // Per-residue native frame (point, tangent, normal=outward-from-axis, binormal).
  // GFP's barrel axis is roughly the structure's principal axis; we approximate
  // "outward" as the component of each Cα perpendicular to the local tangent,
  // which makes strand ribbons lie flat on the barrel wall and the helix tape
  // face outward. Frames are smoothed so ribbons don't flicker between residues.
  const center = new THREE.Vector3();
  for (const p of ca) center.add(p); center.multiplyScalar(1 / n);

  const P: THREE.Vector3[] = ca.map((p) => p.clone());
  const T: THREE.Vector3[] = [];
  const N: THREE.Vector3[] = [];
  const B: THREE.Vector3[] = [];
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const prev = ca[Math.max(0, i - 1)];
    const next = ca[Math.min(n - 1, i + 1)];
    const t = tmpA.subVectors(next, prev).normalize().clone();
    // outward = (Cα - center) projected off the tangent
    const radial = tmpB.copy(ca[i]).sub(center);
    radial.addScaledVector(t, -radial.dot(t));
    if (radial.lengthSq() < 1e-4) radial.set(0, 1, 0);
    radial.normalize();
    T.push(t);
    N.push(radial.clone());
    B.push(new THREE.Vector3().crossVectors(t, radial).normalize());
  }
  // smooth the frames (3-tap) so flat ribbons read clean
  const smooth = (arr: THREE.Vector3[]) => {
    const out = arr.map((v) => v.clone());
    for (let k = 0; k < 2; k++) {
      for (let i = 1; i < n - 1; i++) {
        out[i].copy(arr[i - 1]).add(arr[i]).add(arr[i]).add(arr[i + 1]).multiplyScalar(0.25).normalize();
      }
      for (let i = 0; i < n; i++) arr[i].copy(out[i]);
    }
  };
  smooth(N); smooth(B);
  // re-orthogonalize B against (T,N) after smoothing
  for (let i = 0; i < n; i++) {
    B[i].crossVectors(T[i], N[i]).normalize();
    N[i].crossVectors(B[i], T[i]).normalize();
  }

  // ---------- "extended" target: the chain unfurled into a loose, lazy ribbon ----------
  // A gentle helical sprawl along x with slow y/z waves — reads as an unfolded
  // polypeptide that then collapses into the barrel. Centered like the native.
  const EXT: THREE.Vector3[] = [];
  const span = 92;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    EXT.push(new THREE.Vector3(
      (u - 0.5) * span,
      Math.sin(u * Math.PI * 3.0) * 7 + Math.sin(u * 41) * 0.6,
      Math.cos(u * Math.PI * 2.3) * 7 + Math.cos(u * 37) * 0.6,
    ));
  }
  // extended frames: flat-ish, tangent along the sprawl, normal mostly +z
  const extT: THREE.Vector3[] = [];
  const extN: THREE.Vector3[] = [];
  const extB: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const prev = EXT[Math.max(0, i - 1)];
    const next = EXT[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(next, prev).normalize();
    let up = new THREE.Vector3(0, 0, 1);
    if (Math.abs(t.dot(up)) > 0.9) up = new THREE.Vector3(0, 1, 0);
    const b = new THREE.Vector3().crossVectors(t, up).normalize();
    const nrm = new THREE.Vector3().crossVectors(b, t).normalize();
    extT.push(t); extN.push(nrm); extB.push(b);
  }

  // ---------- secondary-structure segmentation ----------
  const segs: Seg[] = [];
  {
    let s = 0;
    for (let i = 1; i <= n; i++) {
      const cur = (ssStr[i - 1] as SS) ?? 'C';
      const nxt = i < n ? ((ssStr[i] as SS) ?? 'C') : null;
      if (nxt !== cur) { segs.push({ type: cur, start: s, end: i - 1 }); s = i; }
    }
  }

  // ---------- colors ----------
  const C_SHEET = new THREE.Color(0x46d6ff);
  const C_SHEET2 = new THREE.Color(PALETTE.blue);
  const C_HELIX = new THREE.Color(PALETTE.amber);
  const C_HELIX2 = new THREE.Color(0xff8a3d);
  const C_COIL = new THREE.Color(0x6f88b8);
  const C_N = new THREE.Color(PALETTE.cyan);
  const C_C = new THREE.Color(PALETTE.violet);
  const ctmp = new THREE.Color();

  /**
   * Geometry builders write into shared, growing arrays. Each vertex records:
   *   nativePos (3), extPos (3), color (3), and a residue parameter `resf`
   *   (0..1 along the chain) used to time the fold. We build ONE merged mesh per
   *   material family so draw calls stay tiny.
   */
  interface Buf {
    pos: number[]; ext: number[]; col: number[]; res: number[]; idx: number[]; nrm: number[];
  }
  const sheetBuf: Buf = { pos: [], ext: [], col: [], res: [], idx: [], nrm: [] };
  const helixBuf: Buf = { pos: [], ext: [], col: [], res: [], idx: [], nrm: [] };
  const coilBuf: Buf = { pos: [], ext: [], col: [], res: [], idx: [], nrm: [] };

  const pushVert = (buf: Buf, p: THREE.Vector3, e: THREE.Vector3, c: THREE.Color, resf: number, nrm: THREE.Vector3) => {
    buf.pos.push(p.x, p.y, p.z);
    buf.ext.push(e.x, e.y, e.z);
    buf.col.push(c.r, c.g, c.b);
    buf.res.push(resf);
    buf.nrm.push(nrm.x, nrm.y, nrm.z);
    return buf.pos.length / 3 - 1;
  };

  // Catmull-Rom sample of an arbitrary set of P/EXT indices, returning both
  // native and extended sample + interpolated frame, at sub-residue resolution.
  const sampleSeg = (
    i0: number, i1: number, steps: number,
    outNat: THREE.Vector3[], outExt: THREE.Vector3[],
    outN: THREE.Vector3[], outB: THREE.Vector3[], outRes: number[],
  ) => {
    // include one residue of overlap each side for tangent continuity
    const a = Math.max(0, i0 - 1), b = Math.min(n - 1, i1 + 1);
    const natPts: THREE.Vector3[] = [];
    const extPts: THREE.Vector3[] = [];
    for (let i = a; i <= b; i++) { natPts.push(P[i]); extPts.push(EXT[i]); }
    const natCurve = new THREE.CatmullRomCurve3(natPts, false, 'catmullrom', 0.5);
    const extCurve = new THREE.CatmullRomCurve3(extPts, false, 'catmullrom', 0.5);
    // parameter window that maps to [i0, i1]
    const denom = (b - a);
    const ua = (i0 - a) / denom;
    const ub = (i1 - a) / denom;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const u = ua + (ub - ua) * f;
      outNat.push(natCurve.getPoint(u));
      outExt.push(extCurve.getPoint(u));
      // nearest-residue frame (smoothed already), lerped between neighbors
      const ridF = i0 + (i1 - i0) * f;
      const ri = Math.min(n - 2, Math.floor(ridF));
      const rf = ridF - ri;
      outN.push(N[ri].clone().lerp(N[ri + 1], rf).normalize());
      outB.push(B[ri].clone().lerp(B[ri + 1], rf).normalize());
      outRes.push(ridF / (n - 1));
    }
  };

  // ---- build a flat ribbon (strand arrow or helix tape) along sampled centerline ----
  const buildRibbon = (
    buf: Buf, seg: Seg, opts: { width: number; thickness: number; arrow: boolean; twist: number; colorA: THREE.Color; colorB: THREE.Color },
  ) => {
    const len = seg.end - seg.start;
    const steps = Math.max(6, len * 3);
    const nat: THREE.Vector3[] = [], ext: THREE.Vector3[] = [], nv: THREE.Vector3[] = [], bv: THREE.Vector3[] = [], rs: number[] = [];
    sampleSeg(seg.start, seg.end, steps, nat, ext, nv, bv, rs);
    const ring = steps + 1;

    const half = opts.width / 2;
    const th = opts.thickness / 2;
    const startIndex = buf.pos.length / 3;
    const right = new THREE.Vector3();
    const upN = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const offExt = new THREE.Vector3();
    const colA = opts.colorA, colB = opts.colorB;

    // four corners per cross-section: top-left, top-right, bottom-right, bottom-left
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      // arrowhead: last ~28% flares wide then snaps to a point at the very tip
      let w = half;
      if (opts.arrow) {
        if (f > 0.72) {
          const k = (f - 0.72) / 0.28;          // 0..1 over the head
          w = half * (1.7 * (1 - k) + 0.02);     // wide base → sharp point
        } else {
          w = half * 0.62;                       // slim shaft
        }
      }
      // helix tape twists about its tangent
      const ang = opts.twist * f * Math.PI * 2 * (len / 3.6);
      const ca2 = Math.cos(ang), sa = Math.sin(ang);
      right.copy(bv[s]).multiplyScalar(ca2).addScaledVector(nv[s], sa);
      upN.copy(nv[s]).multiplyScalar(ca2).addScaledVector(bv[s], -sa);

      // gentle N→C tint along the whole chain, blended onto the SS color
      ctmp.copy(colA).lerp(colB, rs[s]);

      for (const sign of [1, -1] as const) {     // +right then -right
        // top vertex (native + extended)
        offset.copy(nat[s]).addScaledVector(right, sign * w).addScaledVector(upN, th);
        offExt.copy(ext[s]).addScaledVector(right.clone(), sign * w * 0.5).addScaledVector(upN, th);
        pushVert(buf, offset, offExt, ctmp, rs[s], upN);
      }
      for (const sign of [1, -1] as const) {     // bottom pair
        offset.copy(nat[s]).addScaledVector(right, sign * w).addScaledVector(upN, -th);
        offExt.copy(ext[s]).addScaledVector(right.clone(), sign * w * 0.5).addScaledVector(upN, -th);
        pushVert(buf, offset, offExt, ctmp, rs[s], upN.clone().negate());
      }
    }
    // stitch the 4-rail strip (top, bottom, two sides) into quads
    const rails = 4; // 0:top+ 1:top- 2:bot+ 3:bot-
    const vert = (s: number, r: number) => startIndex + s * rails + r;
    const quad = (a: number, b: number, c: number, d: number) => { buf.idx.push(a, b, c, a, c, d); };
    for (let s = 0; s < steps; s++) {
      // top face (top+ , top-)
      quad(vert(s, 0), vert(s, 1), vert(s + 1, 1), vert(s + 1, 0));
      // bottom face
      quad(vert(s, 3), vert(s, 2), vert(s + 1, 2), vert(s + 1, 3));
      // +right side
      quad(vert(s, 2), vert(s, 0), vert(s + 1, 0), vert(s + 1, 2));
      // -right side
      quad(vert(s, 1), vert(s, 3), vert(s + 1, 3), vert(s + 1, 1));
    }
    void ring;
  };

  // ---- build a smooth thin tube for a coil segment ----
  const buildCoil = (buf: Buf, seg: Seg) => {
    const len = Math.max(1, seg.end - seg.start);
    const steps = Math.max(4, len * 3);
    const nat: THREE.Vector3[] = [], ext: THREE.Vector3[] = [], nv: THREE.Vector3[] = [], bv: THREE.Vector3[] = [], rs: number[] = [];
    sampleSeg(seg.start, seg.end, steps, nat, ext, nv, bv, rs);
    const RAD = 0.34, sides = 6;
    const startIndex = buf.pos.length / 3;
    const v = new THREE.Vector3();
    const e = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    for (let s = 0; s <= steps; s++) {
      ctmp.copy(C_COIL).lerp(C_N, 0.18).lerp(C_C, rs[s] * 0.25);
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        nrm.copy(nv[s]).multiplyScalar(Math.cos(a)).addScaledVector(bv[s], Math.sin(a)).normalize();
        v.copy(nat[s]).addScaledVector(nrm, RAD);
        e.copy(ext[s]).addScaledVector(nrm, RAD);
        pushVert(buf, v, e, ctmp, rs[s], nrm);
      }
    }
    const vert = (s: number, k: number) => startIndex + s * sides + (k % sides);
    for (let s = 0; s < steps; s++) {
      for (let k = 0; k < sides; k++) {
        const a = vert(s, k), b = vert(s, k + 1), c = vert(s + 1, k + 1), d = vert(s + 1, k);
        buf.idx.push(a, b, c, a, c, d);
      }
    }
  };

  // ---------- walk the segments, emit cartoon geometry ----------
  for (const seg of segs) {
    if (seg.type === 'E') {
      buildRibbon(sheetBuf, seg, { width: 2.6, thickness: 0.5, arrow: true, twist: 0.0, colorA: C_SHEET, colorB: C_SHEET2 });
    } else if (seg.type === 'H') {
      buildRibbon(helixBuf, seg, { width: 2.2, thickness: 0.55, arrow: false, twist: 0.5, colorA: C_HELIX, colorB: C_HELIX2 });
    } else {
      buildCoil(coilBuf, seg);
    }
  }

  // ---------- materialize the three cartoon meshes ----------
  const makeMesh = (buf: Buf, mat: THREE.Material) => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(buf.pos);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
    g.setIndex(buf.idx);
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
    // keep the native + extended buffers for the fold morph
    return {
      mesh, geom: g, pos,
      nat: new Float32Array(buf.pos),
      ext: new Float32Array(buf.ext),
      res: new Float32Array(buf.res),
    };
  };

  const sheetMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.34, metalness: 0.16,
    emissive: new THREE.Color(0x06283a), emissiveIntensity: 0.6, side: THREE.DoubleSide,
    flatShading: false,
  });
  const helixMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.3, metalness: 0.2,
    emissive: new THREE.Color(0x3a1f06), emissiveIntensity: 0.6, side: THREE.DoubleSide,
  });
  const coilMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.5, metalness: 0.1,
    emissive: new THREE.Color(0x0a1622), emissiveIntensity: 0.4, side: THREE.DoubleSide,
  });

  const sheet = makeMesh(sheetBuf, sheetMat);
  const helix = makeMesh(helixBuf, helixMat);
  const coil = makeMesh(coilBuf, coilMat);
  const parts = [sheet, helix, coil];

  // recompute smooth normals once geometry exists (overrides our per-vertex hint
  // for nicer shading) — done once, not per frame
  sheet.geom.computeVertexNormals();
  helix.geom.computeVertexNormals();
  coil.geom.computeVertexNormals();

  // ---------- side-chain stubs: faint bristle, revealed with the fold ----------
  const stubPos = new Float32Array(n * 6);
  const stubExt = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const out = N[i];
    const len = 1.3 + ((i * 7) % 5) * 0.16;
    stubPos[i * 6] = P[i].x; stubPos[i * 6 + 1] = P[i].y; stubPos[i * 6 + 2] = P[i].z;
    stubPos[i * 6 + 3] = P[i].x + out.x * len; stubPos[i * 6 + 4] = P[i].y + out.y * len; stubPos[i * 6 + 5] = P[i].z + out.z * len;
    const eo = extN[i];
    stubExt[i * 6] = EXT[i].x; stubExt[i * 6 + 1] = EXT[i].y; stubExt[i * 6 + 2] = EXT[i].z;
    stubExt[i * 6 + 3] = EXT[i].x + eo.x * len; stubExt[i * 6 + 4] = EXT[i].y + eo.y * len; stubExt[i * 6 + 5] = EXT[i].z + eo.z * len;
  }
  const stubGeo = new THREE.BufferGeometry();
  const stubArr = new Float32Array(stubPos); // live buffer we morph
  stubGeo.setAttribute('position', new THREE.BufferAttribute(stubArr, 3));
  stubGeo.setDrawRange(0, 0);
  const stubs = new THREE.LineSegments(
    stubGeo,
    new THREE.LineBasicMaterial({ color: 0x9ec3ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  stubs.frustumCulled = false;
  group.add(stubs);

  // ---------- chromophore: the glowing heart of GFP ----------
  const chromoPos = P[Math.min(n - 1, GFP.chromophore)].clone();
  const chromo = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.45, 3),
    new THREE.MeshStandardMaterial({ color: 0x9bffe6, emissive: PALETTE.cyan, emissiveIntensity: 2.4, roughness: 0.18, metalness: 0.0 }),
  );
  chromo.position.copy(chromoPos);
  chromo.scale.setScalar(0.001);
  group.add(chromo);
  // a soft halo shell so the bloom blooms
  const halo = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.4, 2),
    new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  halo.position.copy(chromoPos);
  group.add(halo);
  const chromoLight = new THREE.PointLight(PALETTE.cyan, 0, 70);
  chromoLight.position.copy(chromoPos);
  group.add(chromoLight);

  // ---------- frame the camera to the folded barrel ----------
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  bounds.expandByObject(sheet.mesh);
  bounds.expandByObject(helix.mesh);
  const size = bounds.getSize(new THREE.Vector3());
  const ctr = bounds.getCenter(new THREE.Vector3());
  group.position.sub(ctr);
  const vFOV = THREE.MathUtils.degToRad(camera.fov);
  const fit = Math.max(size.x, size.y) / 2 / Math.tan(vFOV / 2);
  camera.position.set(0, 0, fit * 1.18 + 7);
  camera.lookAt(0, 0, 0);

  // ---------- fold driver ----------
  // foldAmount(resf, front): a residue's vertices are extended until the moving
  // front (0..1, N→C) reaches them, then ease into native over a soft window.
  const WINDOW = 0.16;
  const foldOf = (resf: number, front: number) => {
    const x = (front - resf) / WINDOW + 0.5;
    return easeInOut(Math.min(1, Math.max(0, x)));
  };

  const vNat = new THREE.Vector3();
  const morphPart = (part: typeof sheet, front: number) => {
    const { pos, nat, ext, res } = part;
    const count = pos.length / 3;
    for (let i = 0; i < count; i++) {
      const a = foldOf(res[i], front);
      const j = i * 3;
      pos[j] = ext[j] + (nat[j] - ext[j]) * a;
      pos[j + 1] = ext[j + 1] + (nat[j + 1] - ext[j + 1]) * a;
      pos[j + 2] = ext[j + 2] + (nat[j + 2] - ext[j + 2]) * a;
    }
    part.geom.attributes.position.needsUpdate = true;
    void nat; void vNat;
  };

  const morphStubs = (front: number) => {
    for (let i = 0; i < n; i++) {
      const a = foldOf(i / (n - 1), front);
      for (let k = 0; k < 6; k++) {
        const j = i * 6 + k;
        stubArr[j] = stubExt[j] + (stubPos[j] - stubExt[j]) * a;
      }
    }
    stubGeo.attributes.position.needsUpdate = true;
  };

  // initial pose
  if (reduced) {
    for (const p of parts) morphPart(p, 2); // fully native
    morphStubs(2);
    stubGeo.setDrawRange(0, n * 2);
    chromo.scale.setScalar(1);
    halo.scale.setScalar(1);
    (halo.material as THREE.MeshBasicMaterial).opacity = 0.22;
    chromoLight.intensity = 95;
    group.rotation.set(-0.18, 0.7, 0.05);
  } else {
    for (const p of parts) morphPart(p, -0.3); // start extended
    morphStubs(-0.3);
  }

  let folded = reduced ? 1 : 0;
  const foldTime = 6.0;
  let holdT = 0;

  onFrame((t, dt) => {
    if (reduced) return; // static frame already posed

    if (folded < 1) folded = Math.min(1, folded + dt / foldTime);
    else holdT += dt;
    const reveal = easeInOut(folded);
    // fold-front travels a touch past 1 so the C-terminus fully seats
    const front = reveal * 1.18 - 0.06;

    for (const p of parts) morphPart(p, front);
    morphStubs(front);
    stubGeo.setDrawRange(0, Math.floor(Math.min(1, Math.max(0, front)) * n) * 2);

    // chromophore ignites once the fold front has wrapped around it
    const lit = front >= GFP.chromophore / (n - 1) + 0.02;
    const pulse = 1 + 0.16 * Math.sin(t * 2.5);
    const targetS = lit ? pulse : 0.001;
    chromo.scale.setScalar(THREE.MathUtils.lerp(chromo.scale.x, targetS, 0.12));
    halo.scale.setScalar(THREE.MathUtils.lerp(halo.scale.x, lit ? 1 + 0.1 * Math.sin(t * 1.7) : 0.001, 0.1));
    const haloMat = halo.material as THREE.MeshBasicMaterial;
    haloMat.opacity = THREE.MathUtils.lerp(haloMat.opacity, lit ? 0.22 : 0, 0.08);
    chromoLight.intensity = THREE.MathUtils.lerp(chromoLight.intensity, lit ? 95 : 0, 0.08);

    // slow tumble + parallax from the eased pointer
    group.rotation.y += dt * 0.16;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, -0.16 + ctx.pointer.y * 0.4, 0.05);
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, ctx.pointer.x * 0.12, 0.05);

    // hold the lit barrel, then refold
    if (holdT > 12) { holdT = 0; folded = 0; }
  });

  onDispose(() => {
    for (const p of parts) { p.geom.dispose(); }
    sheetMat.dispose(); helixMat.dispose(); coilMat.dispose();
    stubGeo.dispose(); (stubs.material as THREE.Material).dispose();
    chromo.geometry.dispose(); (chromo.material as THREE.Material).dispose();
    halo.geometry.dispose(); (halo.material as THREE.Material).dispose();
  });
}

function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}
