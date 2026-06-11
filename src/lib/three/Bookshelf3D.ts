/**
 * Bookshelf3D — an interactive shelf of books rendered as 3D spines. Hover pulls
 * a book out; clicking it selects (dispatches `book:select` with the index so the
 * page can show the review). Spine art is drawn to a canvas per book.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE } from './core';

export interface BookData {
  title: string;
  author: string;
  status: 'reading' | 'read' | 'queued';
  rating?: number;
  spine: string;
}

const STATUS_COLOR: Record<BookData['status'], string> = {
  reading: '#38e8c8',
  read: '#0099ff',
  queued: '#9d7bff',
};

function makeSpineTexture(book: BookData): THREE.CanvasTexture {
  const W = 256, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;

  // base
  const base = new THREE.Color(book.spine);
  const lighter = base.clone().offsetHSL(0, 0, 0.08);
  const darker = base.clone().offsetHSL(0, 0, -0.1);
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, `#${darker.getHexString()}`);
  grad.addColorStop(0.12, `#${lighter.getHexString()}`);
  grad.addColorStop(0.5, `#${base.getHexString()}`);
  grad.addColorStop(0.88, `#${lighter.getHexString()}`);
  grad.addColorStop(1, `#${darker.getHexString()}`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // top/bottom bands (cloth binding)
  ctx.fillStyle = `#${darker.clone().offsetHSL(0, 0, -0.05).getHexString()}`;
  ctx.fillRect(0, 0, W, 40);
  ctx.fillRect(0, H - 40, W, 40);

  // status pip
  ctx.fillStyle = STATUS_COLOR[book.status];
  ctx.beginPath();
  ctx.arc(W / 2, 90, 14, 0, Math.PI * 2);
  ctx.fill();

  // rating dots
  if (book.rating) {
    const full = Math.round(book.rating);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < full ? '#ffd27a' : 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(W / 2 - 56 + i * 28, H - 90, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // title (rotated, reading bottom -> top)
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lum = base.r * 0.299 + base.g * 0.587 + base.b * 0.114;
  const ink = lum > 0.5 ? '#10131c' : '#f3f6ff';
  ctx.fillStyle = ink;
  ctx.font = '600 62px "Familjen Grotesk", system-ui, sans-serif';

  // wrap title to fit length (H is now horizontal extent ~820 usable)
  const words = book.title.toUpperCase().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > 760 && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  const lineH = 70;
  lines.forEach((ln, i) => ctx.fillText(ln, 0, (i - (lines.length - 1) / 2) * lineH - 40));

  // author
  ctx.font = '400 34px "JetBrains Mono", monospace';
  ctx.fillStyle = lum > 0.5 ? 'rgba(16,19,28,0.7)' : 'rgba(243,246,255,0.65)';
  ctx.fillText(book.author.toUpperCase(), 0, 120);
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function bookshelf3D(handle: SceneHandle, books: BookData[]) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera, renderer } = ctx;

  scene.add(new THREE.AmbientLight(0x8099bb, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(4, 10, 12); scene.add(key);
  const warm = new THREE.PointLight(PALETTE.amber, 30, 60); warm.position.set(-6, 4, 8); scene.add(warm);
  const cool = new THREE.PointLight(PALETTE.cyan, 24, 60); cool.position.set(8, -2, 6); scene.add(cool);

  const root = new THREE.Group();
  scene.add(root);

  // ---- layout across rows ----
  // The host is a wide, short canvas, so a single row reads best on desktop;
  // narrow screens wrap to a few rows.
  const mobile = ctx.width < 760;
  const perRow = mobile ? 5 : books.length;
  const rowGap = 8.4;
  const slot = 1.42;

  const bookMeshes: THREE.Mesh[] = [];
  const restState: { x: number; y: number; z: number; rot: number }[] = [];

  const rows = Math.ceil(books.length / perRow);
  const shelfDepth = 4.2;
  const darkSide = new THREE.MeshStandardMaterial({ color: 0x0a0e18, roughness: 0.85 });

  books.forEach((book, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const inRow = Math.min(perRow, books.length - row * perRow);

    const height = 6.0 + ((i * 7) % 11) * 0.13;
    const thickness = 0.9 + ((i * 13) % 9) * 0.055;

    const geo = new THREE.BoxGeometry(thickness, height, shelfDepth);
    const spineTex = makeSpineTexture(book);
    const spineMat = new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.62, metalness: 0.04 });
    const pages = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.9 });
    // face order: +x,-x,+y,-y,+z,-z  → spine on +z
    const mats = [darkSide, darkSide, pages, pages, spineMat, darkSide];
    const mesh = new THREE.Mesh(geo, mats);

    const x = (col - (inRow - 1) / 2) * slot;
    const y = (rows - 1) * rowGap * 0.5 - row * rowGap;
    const lean = (((i * 17) % 7) - 3) * 0.012;
    mesh.position.set(x, y, 0);
    mesh.rotation.z = lean;
    mesh.userData.index = i;
    root.add(mesh);
    bookMeshes.push(mesh);
    restState.push({ x, y, z: 0, rot: lean });

    // shelf board beneath each row (once per row)
    if (col === 0) {
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(inRow * slot + 1.4, 0.32, shelfDepth + 0.6),
        new THREE.MeshStandardMaterial({ color: 0x11141d, roughness: 0.7, metalness: 0.1 }),
      );
      board.position.set(0, y - height / 2 - 0.2, 0);
      root.add(board);
    }
  });

  // frame camera to fit the whole shelf (FOV-based)
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const vFOV = THREE.MathUtils.degToRad(camera.fov);
  const distH = (size.y / 2) / Math.tan(vFOV / 2);
  const distW = (size.x / 2) / (Math.tan(vFOV / 2) * camera.aspect);
  camera.position.set(0, 0.4, Math.max(distH, distW) * 1.06 + size.z * 0.5 + 1.5);
  camera.lookAt(0, 0, 0);

  // ---- interaction ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2(0, 0);
  let hovered = -1;
  let selected = -1;

  const onMove = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  };
  const onClick = () => {
    if (hovered >= 0) {
      selected = selected === hovered ? -1 : hovered;
      window.dispatchEvent(new CustomEvent('book:select', { detail: selected }));
    }
  };
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('click', onClick);
  renderer.domElement.style.cursor = 'default';
  // allow external deselect / select
  const onExternal = (e: Event) => { selected = (e as CustomEvent).detail; };
  window.addEventListener('book:set', onExternal);

  let lastHover = -1;
  onFrame((t, dt) => {
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(bookMeshes, false)[0];
    hovered = hit ? (hit.object.userData.index as number) : -1;
    renderer.domElement.style.cursor = hovered >= 0 ? 'pointer' : 'default';
    if (hovered !== lastHover) {
      lastHover = hovered;
      window.dispatchEvent(new CustomEvent('book:hover', { detail: hovered }));
    }

    for (let i = 0; i < bookMeshes.length; i++) {
      const m = bookMeshes[i];
      const rest = restState[i];
      const isHot = i === hovered;
      const isSel = i === selected;
      // pop forward + scale up so the spine reads; lean back only when selected
      const outZ = isSel ? 3.6 : isHot ? 2.3 : 0;
      const tilt = isSel ? -0.16 : 0;
      const lift = isSel ? 0.5 : isHot ? 0.18 : 0;
      const scl = isSel ? 1.08 : isHot ? 1.05 : 1;
      m.position.z = THREE.MathUtils.lerp(m.position.z, outZ, 0.16);
      m.position.y = THREE.MathUtils.lerp(m.position.y, rest.y + lift, 0.16);
      m.rotation.x = THREE.MathUtils.lerp(m.rotation.x, tilt, 0.16);
      m.rotation.z = THREE.MathUtils.lerp(m.rotation.z, isHot || isSel ? 0 : rest.rot, 0.16);
      m.scale.setScalar(THREE.MathUtils.lerp(m.scale.x, scl, 0.16));
      // gently lift the spine on hover/select (subtle — bloom amplifies this)
      const mats = m.material as THREE.MeshStandardMaterial[];
      const spine = mats[4];
      const target = isSel ? 0.22 : isHot ? 0.13 : 0;
      spine.emissive.set(0x2a3550);
      spine.emissiveIntensity = THREE.MathUtils.lerp(spine.emissiveIntensity ?? 0, target, 0.16);
    }

    // gentle parallax
    root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, ctx.pointer.x * 0.3, 0.05);
    root.rotation.x = THREE.MathUtils.lerp(root.rotation.x, -ctx.pointer.y * 0.16, 0.05);
  });

  onDispose(() => {
    renderer.domElement.removeEventListener('pointermove', onMove);
    renderer.domElement.removeEventListener('click', onClick);
    window.removeEventListener('book:set', onExternal);
    bookMeshes.forEach((m) => {
      m.geometry.dispose();
      (m.material as THREE.Material[]).forEach((mat) => {
        const mm = mat as THREE.MeshStandardMaterial;
        mm.map?.dispose();
        mm.dispose();
      });
    });
  });
}
