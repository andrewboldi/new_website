/**
 * Bookshelf3D — an interactive shelf of books rendered as 3D spines. Hovering a
 * spine pulls it out; clicking it lifts the book to the front and *opens it*,
 * with the title on the left page and the review handwritten on the right. Click
 * again (or anywhere) to close it back onto the shelf.
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
  tags?: string[];
  review?: string;
}

const STATUS_COLOR: Record<BookData['status'], string> = {
  reading: '#38e8c8',
  read: '#0099ff',
  queued: '#9d7bff',
};
const STATUS_LABEL: Record<BookData['status'], string> = {
  reading: 'Currently reading',
  read: 'Read',
  queued: 'On the queue',
};

function makeSpineTexture(book: BookData): THREE.CanvasTexture {
  const W = 256, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
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
  ctx.fillStyle = `#${darker.clone().offsetHSL(0, 0, -0.05).getHexString()}`;
  ctx.fillRect(0, 0, W, 40);
  ctx.fillRect(0, H - 40, W, 40);
  ctx.fillStyle = STATUS_COLOR[book.status];
  ctx.beginPath(); ctx.arc(W / 2, 90, 14, 0, Math.PI * 2); ctx.fill();
  if (book.rating) {
    const full = Math.round(book.rating);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < full ? '#ffd27a' : 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(W / 2 - 56 + i * 28, H - 90, 7, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lum = base.r * 0.299 + base.g * 0.587 + base.b * 0.114;
  ctx.fillStyle = lum > 0.5 ? '#10131c' : '#f3f6ff';
  ctx.font = '600 62px "Familjen Grotesk", system-ui, sans-serif';
  const words = book.title.toUpperCase().split(' ');
  const lines: string[] = []; let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > 760 && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  lines.forEach((ln, i) => ctx.fillText(ln, 0, (i - (lines.length - 1) / 2) * 70 - 40));
  ctx.font = '400 34px "JetBrains Mono", monospace';
  ctx.fillStyle = lum > 0.5 ? 'rgba(16,19,28,0.7)' : 'rgba(243,246,255,0.65)';
  ctx.fillText(book.author.toUpperCase(), 0, 120);
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

/** Draw a parchment page background with a soft vignette and a spine-side shadow. */
function paper(ctx: CanvasRenderingContext2D, W: number, H: number, spineSide: 'left' | 'right') {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#e4d8b6'); g.addColorStop(0.5, '#dccfa8'); g.addColorStop(1, '#d2c399');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // freckles
  ctx.fillStyle = 'rgba(120,100,60,0.05)';
  for (let i = 0; i < 220; i++) ctx.fillRect((i * 97) % W, (i * 173) % H, 2, 2);
  // spine-side shadow
  const sx = spineSide === 'left' ? 0 : W;
  const sg = ctx.createLinearGradient(sx, 0, spineSide === 'left' ? 90 : W - 90, 0);
  sg.addColorStop(0, 'rgba(40,28,10,0.32)'); sg.addColorStop(1, 'rgba(40,28,10,0)');
  ctx.fillStyle = sg; ctx.fillRect(spineSide === 'left' ? 0 : W - 90, 0, 90, H);
  // outer edge vignette
  ctx.strokeStyle = 'rgba(80,60,30,0.18)'; ctx.lineWidth = 3; ctx.strokeRect(8, 8, W - 16, H - 16);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/); const lines: string[] = []; let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function makeLeftPage(book: BookData): THREE.CanvasTexture {
  const W = 760, H = 1000;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  paper(ctx, W, H, 'right');
  const M = 80;
  const ink = '#2b2417', accent = new THREE.Color(book.spine).offsetHSL(0, 0.1, -0.15);
  ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  // eyebrow
  ctx.font = '600 26px "JetBrains Mono", monospace'; ctx.fillStyle = `#${accent.getHexString()}`;
  ctx.fillText(STATUS_LABEL[book.status].toUpperCase(), M, 110);
  // title
  ctx.fillStyle = ink; ctx.font = '64px "Instrument Serif", Georgia, serif';
  const titleLines = wrap(ctx, book.title, W - M * 2);
  titleLines.forEach((ln, i) => ctx.fillText(ln, M, 160 + i * 70));
  let y = 170 + titleLines.length * 70 + 20;
  // author
  ctx.font = 'italic 34px "Instrument Serif", Georgia, serif'; ctx.fillStyle = 'rgba(43,36,23,0.75)';
  ctx.fillText(book.author, M, y); y += 80;
  // rule
  ctx.strokeStyle = 'rgba(43,36,23,0.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
  // rating
  if (book.rating) {
    const full = Math.round(book.rating);
    ctx.font = '40px serif'; ctx.fillStyle = '#c79a3a';
    ctx.fillText('★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full), M, y + 40);
  }
  // tags at the bottom
  if (book.tags?.length) {
    ctx.font = '600 24px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(43,36,23,0.6)';
    ctx.fillText(book.tags.join('  ·  ').toUpperCase(), M, H - 120);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

function makeRightPage(book: BookData): THREE.CanvasTexture {
  const W = 760, H = 1000;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  paper(ctx, W, H, 'left');
  const M = 90;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = '600 26px "JetBrains Mono", monospace'; ctx.fillStyle = '#7a6a3a';
  ctx.fillText('NOTES', M, 110);
  ctx.font = '36px "Instrument Serif", Georgia, serif'; ctx.fillStyle = '#2b2417';
  const lines = wrap(ctx, book.review || 'A note is coming for this one.', W - M - 70);
  const lh = 54;
  lines.forEach((ln, i) => ctx.fillText(ln, M, 170 + i * lh));
  // page number flourish
  ctx.font = 'italic 28px "Instrument Serif", Georgia, serif'; ctx.fillStyle = 'rgba(43,36,23,0.5)';
  ctx.textAlign = 'center'; ctx.fillText('~', W / 2, H - 110);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

export function bookshelf3D(handle: SceneHandle, books: BookData[]) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera, renderer } = ctx;

  scene.add(new THREE.AmbientLight(0x8099bb, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(4, 10, 12); scene.add(key);
  const warm = new THREE.PointLight(PALETTE.amber, 30, 60); warm.position.set(-6, 4, 8); scene.add(warm);
  const cool = new THREE.PointLight(PALETTE.cyan, 24, 60); cool.position.set(8, -2, 6); scene.add(cool);

  const root = new THREE.Group();
  scene.add(root);

  const mobile = ctx.width < 760;
  const perRow = mobile ? 5 : books.length;
  const rowGap = 8.4;
  const slot = 1.42;
  const bookMeshes: THREE.Mesh[] = [];
  const restState: { x: number; y: number; rot: number }[] = [];
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
    const spineMat = new THREE.MeshStandardMaterial({ map: makeSpineTexture(book), roughness: 0.62, metalness: 0.04 });
    const pages = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, [darkSide, darkSide, pages, pages, spineMat, darkSide]);
    const x = (col - (inRow - 1) / 2) * slot;
    const y = (rows - 1) * rowGap * 0.5 - row * rowGap;
    const lean = (((i * 17) % 7) - 3) * 0.012;
    mesh.position.set(x, y, 0); mesh.rotation.z = lean; mesh.userData.index = i;
    root.add(mesh); bookMeshes.push(mesh); restState.push({ x, y, rot: lean });
    if (col === 0) {
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(inRow * slot + 1.4, 0.32, shelfDepth + 0.6),
        new THREE.MeshStandardMaterial({ color: 0x11141d, roughness: 0.7, metalness: 0.1 }),
      );
      board.position.set(0, y - height / 2 - 0.2, 0); root.add(board);
    }
  });

  // frame camera to fit the whole shelf
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const vFOV = THREE.MathUtils.degToRad(camera.fov);
  const distH = (size.y / 2) / Math.tan(vFOV / 2);
  const distW = (size.x / 2) / (Math.tan(vFOV / 2) * camera.aspect);
  camera.position.set(0, 0.4, Math.max(distH, distW) * 1.06 + size.z * 0.5 + 1.5);
  camera.lookAt(0, 0, 0);

  // ===================== open-book reader =====================
  const PW = 6.2, PH = 8.2, PT = 0.4;
  const coverMat = new THREE.MeshStandardMaterial({ color: 0x10131d, roughness: 0.7 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe8dfc6, roughness: 0.85 });
  const reader = new THREE.Group();
  reader.visible = false;
  scene.add(reader);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.5, PH + 0.3, PT + 0.06), coverMat);
  reader.add(spine);
  const makeLeaf = (side: 'left' | 'right') => {
    const pivot = new THREE.Group();
    const pageMat = new THREE.MeshBasicMaterial({ color: 0xf1e9d4 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, PT), [edgeMat, edgeMat, edgeMat, edgeMat, pageMat, coverMat]);
    box.position.x = side === 'right' ? PW / 2 : -PW / 2;
    pivot.add(box); reader.add(pivot);
    return { pivot, pageMat };
  };
  const right = makeLeaf('right');
  const left = makeLeaf('left');

  const readerZ = camera.position.z * 0.44;
  reader.position.set(0, 0, readerZ);
  const camDist = camera.position.z - readerZ;
  const targetScale = (2 * camDist * Math.tan(vFOV / 2) * 0.66) / PH;

  // invisible plane in front of the open book — catches clicks to close it
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ visible: false }));
  catcher.position.set(0, 0, readerZ + PT);
  catcher.scale.set(2.4 * PW * targetScale, PH * targetScale * 1.15, 1);
  scene.add(catcher);

  let readerBook = -1;
  let leftTex: THREE.CanvasTexture | null = null;
  let rightTex: THREE.CanvasTexture | null = null;
  const setReaderBook = (i: number) => {
    leftTex?.dispose(); rightTex?.dispose();
    leftTex = makeLeftPage(books[i]); rightTex = makeRightPage(books[i]);
    left.pageMat.map = leftTex; left.pageMat.needsUpdate = true;
    right.pageMat.map = rightTex; right.pageMat.needsUpdate = true;
    readerBook = i;
  };

  // ---- interaction ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2(0, 0);
  let hovered = -1;
  let selected = -1;
  let anim = 0; // 0 closed/hidden → 1 open

  const onMove = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  };
  const select = (i: number) => {
    selected = i;
    window.dispatchEvent(new CustomEvent('book:select', { detail: selected }));
  };
  const onClick = () => {
    if (selected >= 0) {
      // reading: clicking a different spine switches; clicking the book/empty closes
      if (hovered >= 0 && hovered !== selected) select(hovered);
      else select(-1);
    } else if (hovered >= 0) {
      select(hovered);
    }
  };
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('click', onClick);
  const onExternal = (e: Event) => { select((e as CustomEvent).detail); };
  window.addEventListener('book:set', onExternal);

  let lastHover = -1;
  const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

  onFrame((_t, dt) => {
    // raycast (include the close-catcher once the book is open)
    ray.setFromCamera(ndc, camera);
    const open = selected >= 0 && anim > 0.25;
    const targets = open ? [catcher as THREE.Object3D, ...bookMeshes] : bookMeshes;
    const hit = ray.intersectObjects(targets, false)[0];
    hovered = !hit ? -1 : hit.object === catcher ? -1 : (hit.object.userData.index as number);
    renderer.domElement.style.cursor = (hovered >= 0 || open) ? 'pointer' : 'default';
    if (hovered !== lastHover && !open) {
      lastHover = hovered;
      window.dispatchEvent(new CustomEvent('book:hover', { detail: hovered }));
    }

    // shelf books
    for (let i = 0; i < bookMeshes.length; i++) {
      const m = bookMeshes[i];
      const rest = restState[i];
      const isHot = i === hovered && !open;
      const isSel = i === selected;
      // the selected book lifts out and shrinks away as the reader opens in front
      const outZ = isSel ? 3.0 : isHot ? 2.3 : 0;
      const lift = isSel ? 1.0 : isHot ? 0.18 : 0;
      const scl = isSel ? Math.max(0.001, 1 - anim) : isHot ? 1.05 : 1;
      m.visible = !(isSel && anim > 0.96);
      m.position.z = THREE.MathUtils.lerp(m.position.z, outZ, 0.16);
      m.position.y = THREE.MathUtils.lerp(m.position.y, rest.y + lift, 0.16);
      m.rotation.z = THREE.MathUtils.lerp(m.rotation.z, isHot || isSel ? 0 : rest.rot, 0.16);
      m.scale.setScalar(THREE.MathUtils.lerp(m.scale.x, scl, 0.18));
      const spineM = (m.material as THREE.MeshStandardMaterial[])[4];
      spineM.emissive.set(0x2a3550);
      spineM.emissiveIntensity = THREE.MathUtils.lerp(spineM.emissiveIntensity ?? 0, isSel ? 0.2 : isHot ? 0.13 : 0, 0.16);
    }

    // open-book reader
    if (selected >= 0 && selected !== readerBook) setReaderBook(selected);
    anim = THREE.MathUtils.lerp(anim, selected >= 0 ? 1 : 0, 0.13);
    reader.visible = anim > 0.01;
    catcher.position.z = readerZ + PT;
    if (reader.visible) {
      const e = easeOut(Math.min(1, anim));
      reader.scale.setScalar(Math.max(0.001, targetScale * e));
      const ang = (1 - e) * 1.5;            // leaves fold open from ~85° to flat
      right.pivot.rotation.y = -ang;
      left.pivot.rotation.y = ang;
      reader.rotation.y = ctx.pointer.x * 0.12;
      reader.rotation.x = -0.05 + ctx.pointer.y * 0.08;
    }
    if (anim < 0.02 && selected < 0) readerBook = -1;

    // gentle parallax (paused while reading so the page stays still)
    const px = open ? 0 : ctx.pointer.x * 0.3;
    const py = open ? 0 : -ctx.pointer.y * 0.16;
    root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, px, 0.05);
    root.rotation.x = THREE.MathUtils.lerp(root.rotation.x, py, 0.05);
  });

  onDispose(() => {
    renderer.domElement.removeEventListener('pointermove', onMove);
    renderer.domElement.removeEventListener('click', onClick);
    window.removeEventListener('book:set', onExternal);
    leftTex?.dispose(); rightTex?.dispose();
    bookMeshes.forEach((m) => {
      m.geometry.dispose();
      (m.material as THREE.Material[]).forEach((mat) => { (mat as THREE.MeshStandardMaterial).map?.dispose(); mat.dispose(); });
    });
    reader.traverse((o) => { const mm = o as THREE.Mesh; mm.geometry?.dispose?.(); });
    [coverMat, edgeMat, left.pageMat, right.pageMat].forEach((m) => m.dispose());
  });
}
