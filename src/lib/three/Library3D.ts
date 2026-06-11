/**
 * Library3D — a wooden bookcase of several shelves. Hovering a spine eases it
 * out; clicking it physically pulls the book off the shelf, turns it to face
 * you and opens it — the SAME object — with the title on the left page and the
 * review handwritten on the right. A dedicated top shelf labelled WRITING holds
 * Andrew's essays as scrolls that unroll when clicked.
 *
 * The scene reads a { books, writings } payload from the page.
 */
import * as THREE from 'three';
import type { SceneHandle } from './core';
import { PALETTE, smoothstep } from './core';

export interface BookData {
  title: string; author: string;
  status: 'reading' | 'read' | 'queued';
  rating?: number; spine: string; tags?: string[]; review?: string;
}
export interface WritingData { title: string; date: string; body: string; accent?: string; }

const STATUS_COLOR: Record<BookData['status'], string> = {
  reading: '#38e8c8', read: '#0099ff', queued: '#9d7bff',
};
const STATUS_LABEL: Record<BookData['status'], string> = {
  reading: 'Currently reading', read: 'Read', queued: 'On the queue',
};

/* ---------------- canvas art ---------------- */
function spineTexture(book: BookData): THREE.CanvasTexture {
  const W = 256, H = 1024;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d')!;
  const base = new THREE.Color(book.spine);
  const lighter = base.clone().offsetHSL(0, 0, 0.08), darker = base.clone().offsetHSL(0, 0, -0.1);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, `#${darker.getHexString()}`); g.addColorStop(0.12, `#${lighter.getHexString()}`);
  g.addColorStop(0.5, `#${base.getHexString()}`); g.addColorStop(0.88, `#${lighter.getHexString()}`);
  g.addColorStop(1, `#${darker.getHexString()}`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = `#${darker.clone().offsetHSL(0, 0, -0.05).getHexString()}`;
  ctx.fillRect(0, 0, W, 44); ctx.fillRect(0, H - 44, W, 44);
  ctx.fillStyle = STATUS_COLOR[book.status];
  ctx.beginPath(); ctx.arc(W / 2, 92, 13, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lum = base.r * 0.299 + base.g * 0.587 + base.b * 0.114;
  ctx.fillStyle = lum > 0.5 ? '#10131c' : '#f3f6ff';
  ctx.font = '600 60px "Familjen Grotesk", system-ui, sans-serif';
  const lines = wrapText(ctx, book.title.toUpperCase(), 760);
  lines.forEach((ln, i) => ctx.fillText(ln, 0, (i - (lines.length - 1) / 2) * 66 - 30));
  ctx.font = '400 32px "JetBrains Mono", monospace';
  ctx.fillStyle = lum > 0.5 ? 'rgba(16,19,28,0.7)' : 'rgba(243,246,255,0.6)';
  ctx.fillText(book.author.toUpperCase(), 0, 130);
  ctx.restore();
  return canvasTex(c);
}

function coverTexture(book: BookData): THREE.CanvasTexture {
  const W = 620, H = 820;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d')!;
  const base = new THREE.Color(book.spine);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `#${base.clone().offsetHSL(0, 0, 0.05).getHexString()}`);
  g.addColorStop(1, `#${base.clone().offsetHSL(0, 0, -0.12).getHexString()}`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 3; ctx.strokeRect(28, 28, W - 56, H - 56);
  const lum = base.r * 0.299 + base.g * 0.587 + base.b * 0.114;
  ctx.fillStyle = lum > 0.5 ? '#10131c' : '#f3f6ff';
  ctx.textAlign = 'center';
  ctx.font = '64px "Instrument Serif", Georgia, serif';
  const lines = wrapText(ctx, book.title, W - 120);
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, 240 + i * 72));
  ctx.font = 'italic 32px "Instrument Serif", Georgia, serif';
  ctx.fillStyle = lum > 0.5 ? 'rgba(16,19,28,0.7)' : 'rgba(243,246,255,0.7)';
  ctx.fillText(book.author, W / 2, H - 140);
  return canvasTex(c);
}

function paper(ctx: CanvasRenderingContext2D, W: number, H: number, spineSide: 'left' | 'right') {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#e4d8b6'); g.addColorStop(0.5, '#dccfa8'); g.addColorStop(1, '#d2c399');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120,100,60,0.05)';
  for (let i = 0; i < 200; i++) ctx.fillRect((i * 97) % W, (i * 173) % H, 2, 2);
  const sg = ctx.createLinearGradient(spineSide === 'left' ? 0 : W, 0, spineSide === 'left' ? 90 : W - 90, 0);
  sg.addColorStop(0, 'rgba(40,28,10,0.3)'); sg.addColorStop(1, 'rgba(40,28,10,0)');
  ctx.fillStyle = sg; ctx.fillRect(spineSide === 'left' ? 0 : W - 90, 0, 90, H);
  ctx.strokeStyle = 'rgba(80,60,30,0.16)'; ctx.lineWidth = 3; ctx.strokeRect(8, 8, W - 16, H - 16);
}

function leftPage(book: BookData): THREE.CanvasTexture {
  const W = 760, H = 1000;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d')!; paper(ctx, W, H, 'right');
  const M = 80; const ink = '#2b2417';
  const accent = new THREE.Color(book.spine).offsetHSL(0, 0.1, -0.18);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = '600 26px "JetBrains Mono", monospace'; ctx.fillStyle = `#${accent.getHexString()}`;
  ctx.fillText(STATUS_LABEL[book.status].toUpperCase(), M, 110);
  ctx.fillStyle = ink; ctx.font = '64px "Instrument Serif", Georgia, serif';
  const tl = wrapText(ctx, book.title, W - M * 2);
  tl.forEach((ln, i) => ctx.fillText(ln, M, 160 + i * 70));
  let y = 170 + tl.length * 70 + 20;
  ctx.font = 'italic 34px "Instrument Serif", Georgia, serif'; ctx.fillStyle = 'rgba(43,36,23,0.75)';
  ctx.fillText(book.author, M, y); y += 80;
  ctx.strokeStyle = 'rgba(43,36,23,0.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
  if (book.rating) {
    const full = Math.round(book.rating);
    ctx.font = '40px serif'; ctx.fillStyle = '#c79a3a';
    ctx.fillText('★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full), M, y + 36);
  }
  if (book.tags?.length) {
    ctx.font = '600 24px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(43,36,23,0.6)';
    ctx.fillText(book.tags.join('  ·  ').toUpperCase(), M, H - 120);
  }
  return canvasTex(c, 8);
}

function rightPage(book: BookData): THREE.CanvasTexture {
  const W = 760, H = 1000;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d')!; paper(ctx, W, H, 'left');
  const M = 90; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = '600 26px "JetBrains Mono", monospace'; ctx.fillStyle = '#7a6a3a';
  ctx.fillText('NOTES', M, 110);
  ctx.font = '36px "Instrument Serif", Georgia, serif'; ctx.fillStyle = '#2b2417';
  wrapText(ctx, book.review || '', W - M - 70).forEach((ln, i) => ctx.fillText(ln, M, 170 + i * 54));
  ctx.font = 'italic 28px "Instrument Serif", Georgia, serif'; ctx.fillStyle = 'rgba(43,36,23,0.5)';
  ctx.textAlign = 'center'; ctx.fillText('~', W / 2, H - 100);
  return canvasTex(c, 8);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/); const lines: string[] = []; let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function canvasTex(c: HTMLCanvasElement, aniso = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t;
}

/* ---------------- scene ---------------- */
interface Book {
  group: THREE.Group; cover: THREE.Group; index: number;
  shelfPos: THREE.Vector3; H: number; W: number;
  textures: THREE.Texture[]; mats: THREE.Material[];
}

export function library3D(handle: SceneHandle, payload: { books: BookData[]; writings: WritingData[] }) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera, renderer } = ctx;
  const books = payload.books;

  scene.add(new THREE.AmbientLight(0x8093b5, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(5, 12, 14); scene.add(key);
  const warm = new THREE.PointLight(PALETTE.amber, 36, 90); warm.position.set(-10, 6, 14); scene.add(warm);
  const cool = new THREE.PointLight(PALETTE.cyan, 28, 90); cool.position.set(10, -4, 12); scene.add(cool);

  const root = new THREE.Group();
  scene.add(root);

  const mobile = ctx.width < 760;
  const perShelf = mobile ? 6 : 10;
  const COVER_W = 4.4;          // book depth into the shelf
  const ROW_H = 8.0;            // vertical pitch between shelves
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a2017, roughness: 0.78, metalness: 0.05 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x1a130c, roughness: 0.85 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xded3b6, roughness: 0.85 });

  // ---- lay books out across shelves (bottom shelf = first books) ----
  const rows = Math.ceil(books.length / perShelf);
  const totalH = rows * ROW_H;
  const topY = totalH / 2 - ROW_H / 2;     // centre the case at the origin
  const thicknessOf = (i: number) => 1.0 + ((i * 13) % 9) * 0.06;

  // width of the widest shelf row (sum of thicknesses)
  let maxRowW = 0;
  for (let r = 0; r < rows; r++) {
    let w = 0;
    for (let i = r * perShelf; i < Math.min(books.length, (r + 1) * perShelf); i++) w += thicknessOf(i) + 0.18;
    maxRowW = Math.max(maxRowW, w);
  }
  const innerW = Math.max(maxRowW, 6) + 1.2;

  const bookObjs: Book[] = [];
  for (let r = 0; r < rows; r++) {
    const rowBooks = books.slice(r * perShelf, (r + 1) * perShelf);
    let totW = 0; rowBooks.forEach((_, k) => (totW += thicknessOf(r * perShelf + k) + 0.18));
    let x = -totW / 2;
    const y = topY - r * ROW_H;
    rowBooks.forEach((book, k) => {
      const idx = r * perShelf + k;
      const T = thicknessOf(idx);
      const H = 6.0 + ((idx * 7) % 10) * 0.14;
      x += T / 2 + 0.09;
      bookObjs.push(buildBook(book, idx, new THREE.Vector3(x, y - ROW_H / 2 + H / 2 + 0.3, 0), T, H, COVER_W));
      x += T / 2 + 0.09;
    });
    // shelf board under this row
    addBox(root, innerW, 0.4, COVER_W + 1.2, 0, y - ROW_H / 2, 0, wood);
  }

  // ---- bookcase frame ----
  const caseH = totalH + 1.2, caseW = innerW + 1.6, depth = COVER_W + 1.4;
  addBox(root, caseW, 0.6, depth, 0, topY + ROW_H / 2 + 0.1, 0, wood);              // top
  addBox(root, caseW, 0.6, depth, 0, topY - totalH + ROW_H / 2 - 0.1, 0, wood);     // bottom
  addBox(root, 0.7, caseH, depth, -caseW / 2 + 0.35, 0, 0, wood);                   // left side
  addBox(root, 0.7, caseH, depth, caseW / 2 - 0.35, 0, 0, wood);                    // right side
  addBox(root, caseW, caseH, 0.4, 0, 0, -depth / 2 + 0.1, woodDark);                // back panel

  function buildBook(book: BookData, index: number, shelfPos: THREE.Vector3, T: number, H: number, W: number): Book {
    const group = new THREE.Group();
    group.position.copy(shelfPos);
    group.rotation.y = Math.PI / 2; // spine faces the camera on the shelf
    const textures: THREE.Texture[] = [];
    const mats: THREE.Material[] = [];
    const mk = (m: THREE.Material) => { mats.push(m); return m; };
    const sTex = spineTexture(book), cTex = coverTexture(book), lTex = leftPage(book), rTex = rightPage(book);
    textures.push(sTex, cTex, lTex, rTex);
    const spineMat = mk(new THREE.MeshStandardMaterial({ map: sTex, roughness: 0.6 }));
    const paperEdge = mk(new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.9 }));
    const coverPlain = mk(new THREE.MeshStandardMaterial({ color: new THREE.Color(book.spine).offsetHSL(0, 0, -0.05), roughness: 0.7 }));

    const Tb = T * 0.62, Tc = T * 0.3;
    // base: back cover + page block (right page on +z top)
    const baseMat = [paperEdge, spineMat, paperEdge, paperEdge,
      mk(new THREE.MeshBasicMaterial({ map: rTex })), coverPlain];
    const base = new THREE.Mesh(new THREE.BoxGeometry(W, H, Tb), baseMat);
    base.position.z = -Tc / 2;
    group.add(base);
    // front cover, hinged at the spine (x = -W/2). +z = cover art, -z = left page
    const cover = new THREE.Group();
    cover.position.set(-W / 2, 0, Tb / 2);
    const coverMesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, Tc),
      [paperEdge, spineMat, paperEdge, paperEdge,
        mk(new THREE.MeshBasicMaterial({ map: cTex })), mk(new THREE.MeshBasicMaterial({ map: lTex }))]);
    coverMesh.position.set(W / 2, 0, Tc / 2);
    cover.add(coverMesh);
    group.add(cover);
    group.userData.index = index;
    root.add(group);
    return { group, cover, index, shelfPos: shelfPos.clone(), H, W, textures, mats };
  }

  // ---- camera fit ----
  const bb = new THREE.Box3().setFromObject(root);
  const size = bb.getSize(new THREE.Vector3());
  const vFOV = THREE.MathUtils.degToRad(camera.fov);
  const distH = (size.y / 2) / Math.tan(vFOV / 2);
  const distW = (size.x / 2) / (Math.tan(vFOV / 2) * camera.aspect);
  const camZ = Math.max(distH, distW) * 1.02 + depth * 0.5;
  camera.position.set(0, 0, camZ);
  camera.lookAt(0, 0, 0);

  const readZ = camZ * 0.42;
  const visH = 2 * (camZ - readZ) * Math.tan(vFOV / 2);
  const readScale = (visH * 0.72) / 7;

  // ---- interaction ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = -1, selected = -1;
  const hitMeshes: THREE.Object3D[] = bookObjs.map((b) => b.group);
  const anim = new Float32Array(books.length); // per-book open progress

  const onMove = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  };
  const setSel = (i: number) => { selected = i; window.dispatchEvent(new CustomEvent('book:select', { detail: i })); };
  const onClick = () => {
    if (selected >= 0) { if (hovered >= 0 && hovered !== selected) setSel(hovered); else setSel(-1); }
    else if (hovered >= 0) setSel(hovered);
  };
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('click', onClick);
  const onExternal = (e: Event) => setSel((e as CustomEvent).detail);
  window.addEventListener('book:set', onExternal);

  let lastHover = -1;
  const v = new THREE.Vector3();

  onFrame((_t, dt) => {
    const open = selected >= 0 && anim[selected] > 0.25;
    ray.setFromCamera(ndc, camera);
    const hit = open ? null : ray.intersectObjects(hitMeshes, true)[0];
    let h = -1;
    if (hit) { let o: THREE.Object3D | null = hit.object; while (o && o.userData.index === undefined) o = o.parent; if (o) h = o.userData.index; }
    hovered = h;
    renderer.domElement.style.cursor = hovered >= 0 || open ? 'pointer' : 'default';
    if (hovered !== lastHover && !open) { lastHover = hovered; window.dispatchEvent(new CustomEvent('book:hover', { detail: hovered })); }

    for (const b of bookObjs) {
      const isSel = b.index === selected;
      anim[b.index] = THREE.MathUtils.lerp(anim[b.index], isSel ? 1 : 0, 0.1);
      const p = anim[b.index];
      const isHot = b.index === hovered && !open && p < 0.02;

      if (p < 0.002) {
        // resting on the shelf (+ a small hover nudge out toward the camera)
        b.group.position.lerp(v.copy(b.shelfPos).setZ(isHot ? 2.2 : 0), 0.18);
        b.group.rotation.y = THREE.MathUtils.lerp(b.group.rotation.y, Math.PI / 2, 0.18);
        b.group.scale.setScalar(THREE.MathUtils.lerp(b.group.scale.x, isHot ? 1.04 : 1, 0.18));
        b.cover.rotation.y = THREE.MathUtils.lerp(b.cover.rotation.y, 0, 0.2);
      } else {
        const present = smoothstep(0.16, 0.62, p);
        const openA = smoothstep(0.6, 1, p) * Math.PI;
        // pull out of the shelf, carry to the reading spot, turn to face us.
        // the opened spread extends to the left of the spine, so offset right to centre it.
        const readX = b.W * readScale * 0.5 * smoothstep(0.6, 1, p);
        b.group.position.set(
          THREE.MathUtils.lerp(b.shelfPos.x, readX, present),
          THREE.MathUtils.lerp(b.shelfPos.y, 0, present),
          THREE.MathUtils.lerp(b.shelfPos.z, readZ, present) + Math.sin(smoothstep(0, 0.6, p) * Math.PI) * 4,
        );
        b.group.rotation.y = THREE.MathUtils.lerp(Math.PI / 2, 0, present);
        b.group.scale.setScalar(THREE.MathUtils.lerp(1, readScale, present));
        b.cover.rotation.y = openA;
      }
    }

    const px = open ? 0 : ctx.pointer.x * 0.28, py = open ? 0 : -ctx.pointer.y * 0.14;
    root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, px, 0.05);
    root.rotation.x = THREE.MathUtils.lerp(root.rotation.x, py, 0.05);
  });

  onDispose(() => {
    renderer.domElement.removeEventListener('pointermove', onMove);
    renderer.domElement.removeEventListener('click', onClick);
    window.removeEventListener('book:set', onExternal);
    bookObjs.forEach((b) => { b.textures.forEach((t) => t.dispose()); b.mats.forEach((m) => m.dispose()); });
    [wood, woodDark, edgeMat].forEach((m) => m.dispose());
  });
}

function addBox(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); parent.add(m); return m;
}
