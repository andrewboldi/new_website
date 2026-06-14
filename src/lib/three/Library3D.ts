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
import { PALETTE, smoothstep, prefersReducedMotion } from './core';

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
type Material = 'leather' | 'cloth' | 'paper';
/** Deterministic per-book binding material from the title, so a given book is
 * always the same kind across reloads (no flicker) but the shelf is mixed. */
function materialOf(book: BookData): Material {
  let h = 0; for (let i = 0; i < book.title.length; i++) h = (h * 31 + book.title.charCodeAt(i)) >>> 0;
  return (['leather', 'cloth', 'paper', 'leather', 'cloth'] as const)[h % 5];
}
const ROUGH_OF: Record<Material, number> = { leather: 0.52, cloth: 0.86, paper: 0.7 };

function spineTexture(book: BookData): THREE.CanvasTexture {
  const W = 256, H = 1024;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d')!;
  const mat = materialOf(book);
  const base = new THREE.Color(book.spine);
  const lighter = base.clone().offsetHSL(0, 0, 0.08), darker = base.clone().offsetHSL(0, 0, -0.1);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, `#${darker.getHexString()}`); g.addColorStop(0.12, `#${lighter.getHexString()}`);
  g.addColorStop(0.5, `#${base.getHexString()}`); g.addColorStop(0.88, `#${lighter.getHexString()}`);
  g.addColorStop(1, `#${darker.getHexString()}`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // --- material character ---
  if (mat === 'leather') {
    // fine pebble grain + soft mottled patina
    for (let i = 0; i < 2600; i++) {
      const x = (i * 53) % W, y = (i * 137) % H;
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(x, y, 2, 2);
    }
    // raised hubs across the spine (classic bound leather)
    for (let b = 1; b <= 4; b++) {
      const y = (H / 5) * b;
      const bg = ctx.createLinearGradient(0, y - 16, 0, y + 16);
      bg.addColorStop(0, 'rgba(0,0,0,0.28)'); bg.addColorStop(0.5, 'rgba(255,255,255,0.10)'); bg.addColorStop(1, 'rgba(0,0,0,0.28)');
      ctx.fillStyle = bg; ctx.fillRect(0, y - 16, W, 32);
    }
  } else if (mat === 'cloth') {
    // woven cross-hatch
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
    for (let y = 0; y < H; y += 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + 2); ctx.stroke(); }
    ctx.strokeStyle = '#000000';
    for (let x = 0; x < W; x += 4) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 2, H); ctx.stroke(); }
    ctx.globalAlpha = 1;
  } else {
    // paper — faint fibres + a touch of foxing
    for (let i = 0; i < 900; i++) { const x = (i * 97) % W, y = (i * 211) % H; ctx.fillStyle = 'rgba(120,90,50,0.05)'; ctx.fillRect(x, y, 2, 1); }
  }
  // shelf-worn patina: darkened, scuffed head & tail and a faint sun-faded streak
  const wear = ctx.createLinearGradient(0, 0, 0, H);
  wear.addColorStop(0, 'rgba(0,0,0,0.22)'); wear.addColorStop(0.08, 'rgba(0,0,0,0)');
  wear.addColorStop(0.92, 'rgba(0,0,0,0)'); wear.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = wear; ctx.fillRect(0, 0, W, H);

  // head/tail bands (cap strips)
  ctx.fillStyle = `#${darker.clone().offsetHSL(0, 0, -0.05).getHexString()}`;
  ctx.fillRect(0, 0, W, 44); ctx.fillRect(0, H - 44, W, 44);
  ctx.fillStyle = STATUS_COLOR[book.status];
  ctx.beginPath(); ctx.arc(W / 2, 92, 13, 0, 7); ctx.fill();

  // embossed title band: a recessed panel with gilt-ish foil text
  const lum = base.r * 0.299 + base.g * 0.587 + base.b * 0.114;
  const gilt = lum > 0.5 ? '#1c1408' : '#e8cf86';
  const bandY = H * 0.5;
  ctx.save(); ctx.translate(W / 2, bandY); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 60px "Familjen Grotesk", system-ui, sans-serif';
  const lines = wrapText(ctx, book.title.toUpperCase(), 760);
  // emboss: dark drop then bright foil
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  lines.forEach((ln, i) => ctx.fillText(ln, 2, (i - (lines.length - 1) / 2) * 66 - 30 + 2));
  ctx.fillStyle = gilt;
  lines.forEach((ln, i) => ctx.fillText(ln, 0, (i - (lines.length - 1) / 2) * 66 - 30));
  ctx.font = '400 32px "JetBrains Mono", monospace';
  ctx.fillStyle = lum > 0.5 ? 'rgba(16,19,28,0.7)' : 'rgba(232,207,134,0.7)';
  ctx.fillText(book.author.toUpperCase(), 0, 130);
  ctx.restore();
  // thin gilt rules framing the title block
  ctx.strokeStyle = lum > 0.5 ? 'rgba(28,20,8,0.45)' : 'rgba(232,207,134,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(26, bandY - 250, W - 52, 500);
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

function scrollTexture(w: WritingData): THREE.CanvasTexture {
  const W = 760, H = 1180;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d')!;
  // warmer parchment for the scrolls
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#e8dcb8'); g.addColorStop(0.5, '#e0d2a6'); g.addColorStop(1, '#d6c79a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120,100,60,0.05)';
  for (let i = 0; i < 260; i++) ctx.fillRect((i * 97) % W, (i * 211) % H, 2, 2);
  // aged foxing — soft amber blotches scattered toward the margins
  for (let i = 0; i < 26; i++) {
    const bx = (i * 137) % W, by = (i * 271) % H, br = 14 + (i % 5) * 9;
    const fg = ctx.createRadialGradient(bx, by, 1, bx, by, br);
    fg.addColorStop(0, `rgba(150,110,55,${0.05 + (i % 3) * 0.02})`); fg.addColorStop(1, 'rgba(150,110,55,0)');
    ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.fill();
  }
  // tanned, weathered deckle edges all the way round
  const edge = 70;
  for (const [gx0, gy0, gx1, gy1, ex, ey, ew, eh] of [
    [0, 0, edge, 0, 0, 0, edge, H], [W, 0, W - edge, 0, W - edge, 0, edge, H],
    [0, 0, 0, edge, 0, 0, W, edge], [0, H, 0, H - edge, 0, H - edge, W, edge],
  ] as const) {
    const eg = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    eg.addColorStop(0, 'rgba(70,48,18,0.30)'); eg.addColorStop(1, 'rgba(70,48,18,0)');
    ctx.fillStyle = eg; ctx.fillRect(ex, ey, ew, eh);
  }
  // top/bottom curl shadows
  for (const yy of [0, H - 60]) {
    const cg = ctx.createLinearGradient(0, yy, 0, yy + 60);
    cg.addColorStop(0, yy === 0 ? 'rgba(40,28,10,0.28)' : 'rgba(40,28,10,0)');
    cg.addColorStop(1, yy === 0 ? 'rgba(40,28,10,0)' : 'rgba(40,28,10,0.28)');
    ctx.fillStyle = cg; ctx.fillRect(0, yy, W, 60);
  }
  const M = 86; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = '600 24px "JetBrains Mono", monospace'; ctx.fillStyle = '#8a6a2a';
  ctx.fillText(`ESSAY · ${w.date}`, M, 90);
  ctx.fillStyle = '#2b2417'; ctx.font = '56px "Instrument Serif", Georgia, serif';
  let y = 134;
  wrapText(ctx, w.title, W - M * 2).forEach((ln) => { ctx.fillText(ln, M, y); y += 60; });
  y += 8;
  ctx.strokeStyle = 'rgba(43,36,23,0.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke(); y += 30;
  // body — shrink to fit the available height
  const avail = H - y - 80;
  let fs = 33, lh = 47;
  ctx.font = `${fs}px "Instrument Serif", Georgia, serif`;
  let lines = wrapText(ctx, w.body, W - M * 2);
  while (lines.length * lh > avail && fs > 20) {
    fs -= 2; lh -= 3; ctx.font = `${fs}px "Instrument Serif", Georgia, serif`;
    lines = wrapText(ctx, w.body, W - M * 2);
  }
  ctx.fillStyle = '#2b2417'; ctx.font = `${fs}px "Instrument Serif", Georgia, serif`;
  lines.forEach((ln, i) => ctx.fillText(ln, M, y + i * lh));
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

/* ---------------- procedural wood ----------------
 * One reusable walnut-ish CanvasTexture: long cathedral grain arcs, fine pore
 * flecks, a few darker plank seams and knots, plus baked edge-darkening so the
 * case corners feel recessed (a cheap ambient-occlusion read). Tiled per-face by
 * setting .repeat on cheap clones that share the same image. */
function woodColorTexture(): THREE.CanvasTexture {
  const W = 512, H = 512;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d')!;
  // warm base
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#3a2c1d'); g.addColorStop(0.5, '#33271a'); g.addColorStop(1, '#281d12');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // cathedral grain — nested arcs sweeping up the board (board runs vertically)
  ctx.lineWidth = 1;
  for (let i = 0; i < 130; i++) {
    const t = i / 130;
    const cx = W * (0.5 + Math.sin(i * 1.7) * 0.08);
    const rx = 24 + i * 5.2, ry = 150 + i * 6;
    const shade = 18 + (i % 5) * 7;
    ctx.strokeStyle = `rgba(${20 + shade},${14 + shade * 0.7},${8 + shade * 0.5},${0.10 + (i % 3) * 0.03})`;
    ctx.beginPath(); ctx.ellipse(cx, H * 0.62, rx, ry, 0, Math.PI * 0.92, Math.PI * 2.08); ctx.stroke();
  }
  // straight long fibres
  for (let i = 0; i < 240; i++) {
    const x = (i * 53) % W;
    ctx.strokeStyle = `rgba(60,44,26,${0.04 + ((i * 7) % 5) * 0.012})`;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (((i * 31) % 14) - 7), H); ctx.stroke();
  }
  // pore flecks
  for (let i = 0; i < 1400; i++) {
    const x = (i * 97) % W, y = (i * 181) % H;
    ctx.fillStyle = i % 4 ? 'rgba(20,13,6,0.16)' : 'rgba(96,72,42,0.10)';
    ctx.fillRect(x, y, 1, 1 + (i % 2));
  }
  // a couple of knots
  for (const [kx, ky, kr] of [[120, 360, 16], [380, 150, 11]] as const) {
    const rg = ctx.createRadialGradient(kx, ky, 1, kx, ky, kr);
    rg.addColorStop(0, 'rgba(18,11,5,0.85)'); rg.addColorStop(0.5, 'rgba(40,27,14,0.5)'); rg.addColorStop(1, 'rgba(40,27,14,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(kx, ky, kr, 0, 7); ctx.fill();
  }
  // baked edge darkening (AO-ish vignette so seams read as recessed)
  const eg = ctx.createRadialGradient(W / 2, H / 2, W * 0.28, W / 2, H / 2, W * 0.72);
  eg.addColorStop(0, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H);
  const t = canvasTex(c, 8); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

/* A matching low-contrast roughness map: grain valleys read slightly rougher
 * than the polished crests, so the key light grazes the surface believably. */
function woodRoughTexture(): THREE.CanvasTexture {
  const W = 256, H = 256;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#b8b8b8'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 220; i++) {
    const x = (i * 53) % W;
    ctx.strokeStyle = `rgba(255,255,255,${0.05 + ((i * 7) % 4) * 0.04})`;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (((i * 31) % 12) - 6), H); ctx.stroke();
  }
  for (let i = 0; i < 1200; i++) { const x = (i * 97) % W, y = (i * 181) % H; ctx.fillStyle = 'rgba(60,60,60,0.18)'; ctx.fillRect(x, y, 1, 1); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

function labelTexture(text: string): THREE.CanvasTexture {
  const W = 512, H = 96;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 52px "JetBrains Mono", monospace';
  ctx.fillStyle = '#38e8c8';
  ctx.fillText(text, W / 2, H / 2 + 4);
  return canvasTex(c, 4);
}

/* ---------------- scene ---------------- */
interface Item {
  group: THREE.Group; index: number; shelfPos: THREE.Vector3;
  apply: (p: number, isHot: boolean) => void;
  dur: number;                 // seconds for the full open/close morph
  kind: 'book' | 'scroll'; ref: number;  // ref = index into books / writings
  textures: THREE.Texture[]; mats: THREE.Material[];
}

export function library3D(handle: SceneHandle, payload: { books: BookData[]; writings: WritingData[] }) {
  const { ctx, onFrame, onDispose } = handle;
  const { scene, camera, renderer } = ctx;
  const books = payload.books;
  const writings = payload.writings ?? [];

  // --- cozy lit-nook lighting -------------------------------------------------
  // A dim cool ambient sets the night-time room; a warm amber key hung just in
  // front of the case (like a reading lamp) does the real work and casts the
  // soft shadows that give the shelves depth; a faint cyan rim keeps Andrew's
  // palette alive on the right edge; a gentle hemisphere fills the undersides.
  const reduced = prefersReducedMotion();
  scene.add(new THREE.AmbientLight(0x6a7ba0, 0.7));
  scene.add(new THREE.HemisphereLight(0xfff0d8, 0x14100a, 0.55));
  const key = new THREE.DirectionalLight(0xfff1d6, 1.35); key.position.set(4, 13, 16); scene.add(key);
  const warm = new THREE.PointLight(PALETTE.amber, 46, 120, 1.8); warm.position.set(-7, 7, 17); scene.add(warm);
  const fill = new THREE.PointLight(0xffd9a0, 16, 110, 2.0); fill.position.set(8, -2, 16); scene.add(fill);
  const rim = new THREE.PointLight(PALETTE.cyan, 14, 90); rim.position.set(12, -3, 11); scene.add(rim);
  // shadows: enable once on this scene's renderer. The bookcase is mostly static,
  // so the cast-shadow map is the single biggest GPU cost here — a 512 map
  // re-rendered every frame from the warm key. We slash that two ways:
  //   1) PCF (not PCFSoft) + a 512 map at full quality — visually near-identical
  //      for these soft contact shadows, roughly a quarter of the fill cost.
  //   2) shadow.autoUpdate = false — the map is NOT re-rendered every frame.
  //      We flag needsUpdate only while the scene is actually moving (a book
  //      pulls out, a scroll opens, a hover eases) and for the first frames, so
  //      a still shelf costs zero shadow re-renders.
  const prevShadow = renderer.shadowMap.enabled;
  const prevShadowType = renderer.shadowMap.type;
  const prevAutoUpdate = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  warm.castShadow = true;
  const SHADOW_FULL = 512, SHADOW_LOW = 256; // map size at full / GPU-bound quality
  warm.shadow.mapSize.set(SHADOW_FULL, SHADOW_FULL);
  warm.shadow.bias = -0.0015; warm.shadow.radius = 4;
  warm.shadow.camera.near = 2; warm.shadow.camera.far = 90;
  // Drive shadow refreshes ourselves instead of every frame.
  warm.shadow.autoUpdate = false;
  warm.shadow.needsUpdate = true; // render it once up front
  // Quality state, driven by handle.onQuality below. shadowsOn=false (q<=0.5)
  // disables cast shadows entirely; the warm interior wash + lighting still
  // give the nook a cozy, softly-occluded read. updateEvery throttles how often
  // an in-motion scene re-bakes the map (1 = every frame it moves, 2 = every
  // other) so a degraded GPU does even less work.
  let shadowsOn = true;
  let shadowUpdateEvery = 1;
  let shadowFrame = 0;
  // Request a shadow re-bake on the next N frames of motion. Coalesced so a book
  // pull, scroll open, hover ease, or quality change all flow through one path.
  let shadowDirtyFrames = 0;
  const markShadowDirty = (frames = 1) => { shadowDirtyFrames = Math.max(shadowDirtyFrames, frames); };
  markShadowDirty(3); // first few frames: settle textures/lights before freezing

  // ── adaptive quality: degrade shadows under a GPU-bound governor ───────────
  // q=1.0  full: 512 PCF map, refresh on every motion frame (cozy + crisp).
  // q=0.75 mid : 256 map, refresh every other motion frame (softer, ~1/4 cost).
  // q<=0.5 low : cast shadows OFF entirely — the warm interior wash + lamp
  //              lighting keep the nook reading as a softly-occluded cozy nook
  //              with no shadow-map pass at all. Restores gracefully on recovery.
  let curQ = 1;
  const applyQuality = (q: number) => {
    if (q === curQ) return;
    curQ = q;
    if (q <= 0.5) {
      // drop cast shadows; lighting + baked AO wash carry the look
      shadowsOn = false;
      renderer.shadowMap.enabled = false;
    } else {
      const mid = q < 0.9;
      shadowsOn = true;
      renderer.shadowMap.enabled = true;
      shadowUpdateEvery = mid ? 2 : 1;
      const target = mid ? SHADOW_LOW : SHADOW_FULL;
      if (warm.shadow.mapSize.x !== target) {
        warm.shadow.mapSize.set(target, target);
        // a resized shadow map must drop its old render target so three rebuilds it
        warm.shadow.map?.dispose();
        warm.shadow.map = null;
      }
      markShadowDirty(2); // re-bake at the new size/cadence right away
    }
  };
  handle.onQuality(applyQuality);
  // Dev-only bridge so the adaptive degradation can be exercised in tests without
  // waiting on the real GPU governor. Mirrors core's __sceneStats debug hook;
  // stripped from production builds.
  if (import.meta.env.DEV) {
    const w = window as unknown as {
      __libQuality?: (q: number) => void;
      __libShadowState?: () => { enabled: boolean; mapSize: number; updateEvery: number; on: boolean };
    };
    w.__libQuality = applyQuality;
    w.__libShadowState = () => ({
      enabled: renderer.shadowMap.enabled,
      mapSize: warm.shadow.mapSize.x,
      updateEvery: shadowUpdateEvery,
      on: shadowsOn,
    });
  }

  const root = new THREE.Group();
  scene.add(root);

  // Shared procedural wood — one image, cloned per face with its own .repeat so
  // grain scale stays consistent across the big panels and the thin trims.
  const woodMap = woodColorTexture();
  const woodRough = woodRoughTexture();

  const mobile = ctx.width < 760;
  const perShelf = mobile ? 6 : 10;
  const COVER_W = 4.4;          // book depth into the shelf
  const ROW_H = 8.0;            // vertical pitch between shelves
  const wood = new THREE.MeshStandardMaterial({
    color: 0x5a4329, map: woodMap, roughnessMap: woodRough, roughness: 0.82, metalness: 0.04,
  });
  const woodDark = new THREE.MeshStandardMaterial({
    color: 0x3a2c1c, map: woodMap, roughnessMap: woodRough, roughness: 0.9, metalness: 0.03,
  });
  // honey-toned moulding for the bevelled front trims (slightly polished, lit warm)
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x6e4f2c, map: woodMap, roughness: 0.55, metalness: 0.06 });
  // map the colour through tone-mapping so the wood doesn't blow out under the key
  woodMap.colorSpace = THREE.SRGBColorSpace;

  // shared reading params, filled after the camera fit (apply closures read live)
  const R = { readZ: 0, bookScale: 1, scrollScale: 1 };
  const v = new THREE.Vector3();
  const thicknessOf = (i: number) => 1.0 + ((i * 13) % 9) * 0.06;

  const bookRows = Math.ceil(books.length / perShelf);
  const hasWriting = writings.length > 0;
  const totalRows = bookRows + (hasWriting ? 1 : 0);
  const totalH = totalRows * ROW_H;
  const rowCenterY = (r: number) => ((totalRows - 1) / 2 - r) * ROW_H; // r=0 is the top shelf
  const SLOT = Math.max(2.4, Math.min(3.6, 26 / Math.max(1, writings.length)));

  // widest row → inner case width
  let maxRowW = 6;
  for (let r = 0; r < bookRows; r++) {
    let w = 0;
    for (let i = r * perShelf; i < Math.min(books.length, (r + 1) * perShelf); i++) w += thicknessOf(i) + 0.18;
    maxRowW = Math.max(maxRowW, w);
  }
  if (hasWriting) maxRowW = Math.max(maxRowW, (writings.length - 1) * SLOT + 3);
  const innerW = maxRowW + 1.2;
  const depth = COVER_W + 1.4;

  const items: Item[] = [];
  const extra: { tex: THREE.Texture[]; mat: THREE.Material[] } = { tex: [], mat: [] };

  // ---- writing shelf (top): scrolls ----
  if (hasWriting) {
    const boardTop = rowCenterY(0) - ROW_H / 2 + 0.2;
    let x = -((writings.length - 1) * SLOT) / 2;
    writings.forEach((w, wi) => {
      items.push(buildScroll(w, items.length, wi, new THREE.Vector3(x, boardTop + 2.7, 0.4)));
      x += SLOT;
    });
    // WRITING nameplate on the back panel
    const lt = labelTexture('WRITING'); extra.tex.push(lt);
    const lm = new THREE.MeshBasicMaterial({ map: lt, transparent: true }); extra.mat.push(lm);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.3), lm);
    plate.position.set(0, rowCenterY(0) + ROW_H / 2 - 1.1, -depth / 2 + 0.32);
    root.add(plate);
  }

  // ---- book shelves ----
  for (let r = 0; r < bookRows; r++) {
    const rowBooks = books.slice(r * perShelf, (r + 1) * perShelf);
    let totW = 0; rowBooks.forEach((_, k) => (totW += thicknessOf(r * perShelf + k) + 0.04));
    let x = -totW / 2;
    const y = rowCenterY(r + (hasWriting ? 1 : 0));
    rowBooks.forEach((book, k) => {
      const idx = r * perShelf + k;
      const T = thicknessOf(idx), H = 6.0 + ((idx * 7) % 10) * 0.14;
      x += T / 2 + 0.02;
      items.push(buildBook(book, items.length, idx, new THREE.Vector3(x, y - ROW_H / 2 + H / 2 + 0.3, 0), T, H, COVER_W));
      x += T / 2 + 0.02;
    });
  }

  // ---- shelf boards + bookcase frame ----
  const frontZ = (COVER_W + 1.2) / 2;   // front face of a shelf board
  for (let r = 0; r < totalRows; r++) {
    const sy = rowCenterY(r) - ROW_H / 2;
    addBox(root, innerW, 0.4, COVER_W + 1.2, 0, sy, 0, wood);
    // bevelled moulding lip along the front edge of every shelf — a slim honey
    // strip that catches the warm key and gives the board a turned, milled edge.
    const lip = addBox(root, innerW, 0.5, 0.28, 0, sy - 0.04, frontZ + 0.13, edgeMat);
    lip.castShadow = false; // thin trim — skip self-shadow cost, still receives
  }
  const caseH = totalH + 1.2, caseW = innerW + 1.6;
  addBox(root, caseW, 0.6, depth, 0, rowCenterY(0) + ROW_H / 2 + 0.1, 0, wood);                 // top
  addBox(root, caseW, 0.6, depth, 0, rowCenterY(totalRows - 1) - ROW_H / 2 - 0.1, 0, wood);     // bottom
  addBox(root, 0.7, caseH, depth, -caseW / 2 + 0.35, 0, 0, wood);                               // left side
  addBox(root, 0.7, caseH, depth, caseW / 2 - 0.35, 0, 0, wood);                                // right side
  addBox(root, caseW, caseH, 0.4, 0, 0, -depth / 2 + 0.1, woodDark);                            // back panel

  // crown moulding above the top board + a plinth below the bottom — gives the
  // case a built piece-of-furniture silhouette instead of a plain rectangle.
  const crown = addBox(root, caseW + 0.5, 0.7, depth + 0.6, 0, rowCenterY(0) + ROW_H / 2 + 0.55, 0.1, edgeMat);
  crown.castShadow = true;
  const plinth = addBox(root, caseW + 0.3, 0.9, depth + 0.4, 0, rowCenterY(totalRows - 1) - ROW_H / 2 - 0.65, 0.05, edgeMat);
  plinth.castShadow = true;

  // Warm interior wash: an unlit gradient panel sitting just in front of the back
  // board pools amber light in the centre of the nook and lets the corners fall
  // into soft shadow — a painterly, baked ambient-occlusion feel for free.
  {
    const gw = caseW - 1.0, gh = caseH - 1.0;
    const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 512 });
    const g2 = cv.getContext('2d')!;
    const rg = g2.createRadialGradient(128, 256, 20, 128, 256, 300);
    rg.addColorStop(0, 'rgba(120,80,34,0.55)'); rg.addColorStop(0.55, 'rgba(70,46,20,0.22)'); rg.addColorStop(1, 'rgba(8,5,2,0)');
    g2.fillStyle = rg; g2.fillRect(0, 0, 256, 512);
    const gt = canvasTex(cv, 2); extra.tex.push(gt);
    const gm = new THREE.MeshBasicMaterial({ map: gt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    extra.mat.push(gm);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), gm);
    glow.position.set(0, 0, -depth / 2 + 0.34);
    root.add(glow);
  }

  function buildBook(book: BookData, index: number, ref: number, shelfPos: THREE.Vector3, T: number, H: number, W: number): Item {
    const group = new THREE.Group();
    group.position.copy(shelfPos);
    group.rotation.y = Math.PI / 2; // spine faces the camera on the shelf
    // Every 7th book leans against its neighbour — a couple of relaxed tilts so
    // the row isn't a perfect picket fence. Lean is applied only at rest and
    // unwinds to 0 the instant a book is pulled, so it never fights the open.
    const lean = ref % 7 === 4 ? (ref % 14 === 4 ? 0.14 : -0.12) : 0;
    const textures: THREE.Texture[] = [];
    const mats: THREE.Material[] = [];
    const mk = (m: THREE.Material) => { mats.push(m); return m; };
    const sTex = spineTexture(book), cTex = coverTexture(book), lTex = leftPage(book), rTex = rightPage(book);
    textures.push(sTex, cTex, lTex, rTex);
    const rough = ROUGH_OF[materialOf(book)];
    // leather bindings get a faint sheen; cloth/paper stay matte.
    const spineMat = mk(new THREE.MeshStandardMaterial({ map: sTex, roughness: rough, metalness: rough < 0.6 ? 0.08 : 0.0 }));
    // page block: warm cream, lightly varied per book so no two stacks match.
    const edgeCol = new THREE.Color(0x9a906f).offsetHSL(0, 0, ((ref * 17) % 7) * 0.006 - 0.018);
    const paperEdge = mk(new THREE.MeshStandardMaterial({ color: edgeCol, roughness: 0.96 }));
    const coverPlain = mk(new THREE.MeshStandardMaterial({ color: new THREE.Color(book.spine).offsetHSL(0, 0, -0.05), roughness: rough }));
    const Tb = T * 0.62, Tc = T * 0.3;
    const base = new THREE.Mesh(new THREE.BoxGeometry(W, H, Tb),
      [paperEdge, spineMat, paperEdge, paperEdge, mk(new THREE.MeshBasicMaterial({ map: rTex })), coverPlain]);
    base.position.z = -Tc / 2; base.castShadow = true; base.receiveShadow = true; group.add(base);
    const cover = new THREE.Group();
    // Seat the front cover flush against the base's front face so the closed
    // spine reads as one continuous strip — no beige page block peeking through
    // the seam. (A hair of overlap avoids z-fighting on the shared plane.)
    cover.position.set(-W / 2, 0, Tb / 2 - Tc / 2 - 0.01);
    const coverMesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, Tc),
      [paperEdge, spineMat, paperEdge, paperEdge, mk(new THREE.MeshBasicMaterial({ map: cTex })), mk(new THREE.MeshBasicMaterial({ map: lTex }))]);
    coverMesh.position.set(W / 2, 0, Tc / 2); coverMesh.castShadow = true; coverMesh.receiveShadow = true; cover.add(coverMesh); group.add(cover);

    // a "currently reading" book wears a slim satin bookmark ribbon poking from
    // the top of the page block — a small, alive detail on the shelf.
    if (book.status === 'reading') {
      const ribCol = new THREE.Color(STATUS_COLOR[book.status]);
      const ribMat = mk(new THREE.MeshStandardMaterial({ color: ribCol, roughness: 0.4, emissive: ribCol, emissiveIntensity: 0.12, side: THREE.DoubleSide }));
      const rib = new THREE.Mesh(new THREE.PlaneGeometry(Tb * 0.5, H * 0.34), ribMat);
      rib.position.set(0, H / 2 + H * 0.1, -Tc / 2); rib.rotation.x = -0.12;
      rib.castShadow = true; group.add(rib);
    }
    group.userData.index = index; root.add(group);

    const apply = (p: number, isHot: boolean) => {
      if (p < 0.002) {
        group.position.lerp(v.copy(shelfPos).setZ(isHot ? 2.2 : 0), 0.18);
        group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, Math.PI / 2, 0.18);
        // a hovered book straightens up as it eases forward; otherwise it rests at its lean
        group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, isHot ? 0 : lean, 0.18);
        group.scale.setScalar(THREE.MathUtils.lerp(group.scale.x, isHot ? 1.04 : 1, 0.18));
        cover.rotation.y = THREE.MathUtils.lerp(cover.rotation.y, 0, 0.2);
      } else {
        const present = smoothstep(0.16, 0.62, p);
        const readX = W * R.bookScale * 0.5 * smoothstep(0.6, 1, p);
        group.position.set(
          THREE.MathUtils.lerp(shelfPos.x, readX, present),
          THREE.MathUtils.lerp(shelfPos.y, 0, present),
          THREE.MathUtils.lerp(shelfPos.z, R.readZ, present) + Math.sin(smoothstep(0, 0.6, p) * Math.PI) * 4,
        );
        group.rotation.y = THREE.MathUtils.lerp(Math.PI / 2, 0, present);
        group.rotation.z = THREE.MathUtils.lerp(lean, 0, present); // unwind the lean as it pulls out
        group.scale.setScalar(THREE.MathUtils.lerp(1, R.bookScale, present));
        // Open toward the reader: the front cover lifts up through +z and
        // swings left over the spine hinge, revealing the right-hand page.
        cover.rotation.y = smoothstep(0.6, 1, p) * -Math.PI;
      }
    };
    return { group, index, shelfPos: shelfPos.clone(), apply, dur: 3.4, kind: 'book', ref, textures, mats };
  }

  function buildScroll(w: WritingData, index: number, ref: number, shelfPos: THREE.Vector3): Item {
    const group = new THREE.Group();
    group.position.copy(shelfPos);
    const textures: THREE.Texture[] = [];
    const mats: THREE.Material[] = [];
    const mk = (m: THREE.Material) => { mats.push(m); return m; };
    const ROLL = 5.2, Wp = 7, Hp = 11, rr = 0.55;
    const accent = new THREE.Color(w.accent || '#caa86a');
    // closed roll. The wound paper + rings + ribbon live in an inner spin group
    // so the roll can be laid horizontal (roll.rotation.z) and spun about its own
    // long axis (rollSpin.rotation.y) independently while it rides down the sheet.
    const roll = new THREE.Group();
    const rollSpin = new THREE.Group();
    const wound = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, ROLL, 24), mk(new THREE.MeshStandardMaterial({ color: 0xe2d4a8, roughness: 0.85 })));
    wound.castShadow = true; rollSpin.add(wound);
    const ringMat = mk(new THREE.MeshStandardMaterial({ color: 0xb6a373, roughness: 0.8 }));
    for (const yy of [ROLL / 2 - 0.12, -ROLL / 2 + 0.12]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(rr * 1.14, rr * 1.14, 0.26, 24), ringMat);
      ring.position.y = yy; ring.castShadow = true; rollSpin.add(ring);
    }
    // turned wooden finials capping each end of the rod, with a brass collar
    const capWoodMat = mk(new THREE.MeshStandardMaterial({ color: 0x6b563a, roughness: 0.6, metalness: 0.05 }));
    const brassMat = mk(new THREE.MeshStandardMaterial({ color: 0xb08a3c, roughness: 0.35, metalness: 0.55 }));
    for (const yy of [ROLL / 2 + 0.18, -ROLL / 2 - 0.18]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(rr * 0.78, 18, 12), capWoodMat);
      knob.position.y = yy; knob.castShadow = true; rollSpin.add(knob);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.5, rr * 0.5, 0.16, 18), brassMat);
      collar.position.y = yy + (yy > 0 ? -0.42 : 0.42); rollSpin.add(collar);
    }
    rollSpin.add(new THREE.Mesh(new THREE.CylinderGeometry(rr * 1.05, rr * 1.05, 0.5, 24),
      mk(new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5, emissive: accent, emissiveIntensity: 0.18 }))));
    // a silk tie ribbon cinched around the closed roll (wax-seal accent at centre)
    const tieMat = mk(new THREE.MeshStandardMaterial({ color: accent.clone().offsetHSL(0, 0, -0.12), roughness: 0.45, side: THREE.DoubleSide }));
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(rr * 1.18, rr * 1.18, 0.5, 24, 1, true), tieMat);
    tie.position.y = ROLL * 0.16; tie.castShadow = true; rollSpin.add(tie);
    roll.add(rollSpin);
    group.add(roll);
    // unrolled sheet (hidden until opened). The top edge is pinned to a fixed top
    // rod; the sheet grows downward as the bottom roll rides down and unwinds.
    const sheetWrap = new THREE.Group();
    sheetWrap.position.y = ROLL / 2; sheetWrap.visible = false;
    const tex = scrollTexture(w); textures.push(tex);
    const rodMat = mk(new THREE.MeshStandardMaterial({ color: 0x6b563a, roughness: 0.7 }));
    const topRod = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, Wp + 0.7, 16), rodMat);
    topRod.rotation.z = Math.PI / 2; topRod.castShadow = true; sheetWrap.add(topRod);
    // brass finials on the top rod to match the bottom roll
    for (const xx of [(Wp + 0.7) / 2, -(Wp + 0.7) / 2]) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), capWoodMat);
      f.position.x = xx; sheetWrap.add(f);
    }
    const planeGeo = new THREE.PlaneGeometry(Wp, Hp); planeGeo.translate(0, -Hp / 2, 0);
    const sheet = new THREE.Mesh(planeGeo, mk(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })));
    sheet.scale.y = 0.001; // rolled up — keep it out of the camera-fit bounding box
    sheetWrap.add(sheet);
    group.add(sheetWrap);
    // invisible proxy so the thin scroll is easy to click
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, ROLL + 1.5, 8), mk(new THREE.MeshBasicMaterial({ visible: false })));
    group.add(proxy);
    group.userData.index = index; root.add(group);

    const apply = (p: number, isHot: boolean) => {
      if (p < 0.002) {
        group.position.lerp(v.copy(shelfPos).setZ(isHot ? 2 : 0), 0.18);
        group.scale.setScalar(THREE.MathUtils.lerp(group.scale.x, isHot ? 1.06 : 1, 0.18));
        // settle back to the closed, upright tube standing in its slot
        roll.visible = true; roll.scale.setScalar(THREE.MathUtils.lerp(roll.scale.x, 1, 0.2));
        roll.rotation.z = THREE.MathUtils.lerp(roll.rotation.z, 0, 0.2);
        roll.position.set(0, THREE.MathUtils.lerp(roll.position.y, 0, 0.2), 0);
        rollSpin.rotation.y = 0;
        tie.visible = true; // the ribbon is cinched on while it stands closed
        sheetWrap.visible = false;
      } else {
        const present = smoothstep(0.1, 0.55, p);
        const unroll = smoothstep(0.42, 1, p);
        const scale = THREE.MathUtils.lerp(1, R.scrollScale, present);
        group.position.set(
          THREE.MathUtils.lerp(shelfPos.x, 0, present),
          THREE.MathUtils.lerp(shelfPos.y, R.scrollScale * (Hp - ROLL) / 2, present),
          THREE.MathUtils.lerp(shelfPos.z, R.readZ, present) + Math.sin(smoothstep(0, 0.6, p) * Math.PI) * 3,
        );
        group.scale.setScalar(scale);
        // tip the tube from upright to a horizontal roll as it comes forward
        roll.rotation.z = present * (Math.PI / 2);
        tie.visible = unroll < 0.04; // ribbon slips off the moment it starts to unfurl
        sheetWrap.visible = true;
        // top edge pinned to the fixed top rod; sheet unfurls downward
        sheet.scale.y = Math.max(0.001, unroll);
        // the wound roll rides down to the growing bottom edge, shrinks as paper
        // transfers onto the flat sheet, and spins as if rolling it out
        roll.visible = true;
        roll.position.set(0, ROLL / 2 - Hp * unroll, rr * 1.1);
        roll.scale.setScalar(THREE.MathUtils.lerp(1, 0.34, unroll));
        rollSpin.rotation.y = unroll * Math.PI * 4;
      }
    };
    return { group, index, shelfPos: shelfPos.clone(), apply, dur: 4.6, kind: 'scroll', ref, textures, mats };
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
  R.readZ = camZ * 0.42;
  const visH = 2 * (camZ - R.readZ) * Math.tan(vFOV / 2);
  R.bookScale = (visH * 0.72) / 7;
  R.scrollScale = (visH * 0.82) / 11;

  // ---- atmosphere: dust motes + vignette ----
  // Fine specks suspended in the lamp light, drifting almost imperceptibly in
  // front of the shelves. Static when reduced-motion is requested.
  const MOTES = mobile ? 70 : 150;
  const motePos = new Float32Array(MOTES * 3);
  const moteSpan = { x: caseW * 0.62, y: caseH * 0.55, z: depth * 0.6 + 4 };
  for (let i = 0; i < MOTES; i++) {
    motePos[i * 3] = (Math.random() * 2 - 1) * moteSpan.x;
    motePos[i * 3 + 1] = (Math.random() * 2 - 1) * moteSpan.y;
    motePos[i * 3 + 2] = Math.random() * moteSpan.z;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  // round soft sprite so motes glow rather than read as square pixels
  const moteCanvas = Object.assign(document.createElement('canvas'), { width: 32, height: 32 });
  const mctx = moteCanvas.getContext('2d')!;
  const mg = mctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  mg.addColorStop(0, 'rgba(255,224,170,0.9)'); mg.addColorStop(1, 'rgba(255,224,170,0)');
  mctx.fillStyle = mg; mctx.beginPath(); mctx.arc(16, 16, 16, 0, 7); mctx.fill();
  const moteTex = canvasTex(moteCanvas, 1);
  const moteMat = new THREE.PointsMaterial({
    size: visH * 0.012, map: moteTex, transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.position.z = depth * 0.1; scene.add(motes);

  // Soft vignette: a screen-space ring darkening the frame edges so the eye
  // settles on the warmly-lit nook. A big plane locked just in front of the cam.
  const vigCanvas = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
  const vctx = vigCanvas.getContext('2d')!;
  const vgr = vctx.createRadialGradient(256, 256, 130, 256, 256, 360);
  vgr.addColorStop(0, 'rgba(0,0,0,0)'); vgr.addColorStop(0.7, 'rgba(4,4,8,0.18)'); vgr.addColorStop(1, 'rgba(2,3,6,0.62)');
  vctx.fillStyle = vgr; vctx.fillRect(0, 0, 512, 512);
  const vigTex = canvasTex(vigCanvas, 1);
  const vigMat = new THREE.MeshBasicMaterial({ map: vigTex, transparent: true, depthWrite: false, depthTest: false });
  const vigDist = 3;
  const vigH = 2 * vigDist * Math.tan(vFOV / 2) * 1.15;
  const vignette = new THREE.Mesh(new THREE.PlaneGeometry(vigH * camera.aspect, vigH), vigMat);
  vignette.position.set(0, 0, camZ - vigDist); vignette.renderOrder = 999;
  scene.add(vignette);

  // ---- interaction ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = -1, selected = -1;
  const hitMeshes = items.map((it) => it.group);
  const anim = new Float32Array(items.length);
  // Tracks whether we've already announced the current selection's open
  // animation as finished, so `library:scroll-ready` fires exactly once per open
  // (at the frame its progress first reaches 1), not every frame after.
  let readyFired = false;

  // The shared GL canvas is fixed + pointer-events:none, so interaction binds to
  // the scene's HOST element (it overlays this scene's exact screen rect and DOES
  // receive events). Raycasting reads the host's rect — identical to the rect the
  // scene is rendered into.
  const onMove = (e: PointerEvent) => {
    const r = ctx.host.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  };
  const setSel = (i: number) => {
    selected = i;
    readyFired = false; // arm the completion signal for this new selection
    // A book/scroll is about to move through its full open/close morph — keep the
    // shadow map refreshing for the duration of that motion (handled per-frame
    // below while anim values are changing).
    markShadowDirty(2);
    const it = i >= 0 ? items[i] : null;
    window.dispatchEvent(new CustomEvent('library:open', { detail: it ? { kind: it.kind, ref: it.ref } : { kind: null, ref: -1 } }));
  };
  const onClick = () => {
    if (selected >= 0) { if (hovered >= 0 && hovered !== selected) setSel(hovered); else setSel(-1); }
    else if (hovered >= 0) setSel(hovered);
  };
  ctx.host.addEventListener('pointermove', onMove);
  ctx.host.addEventListener('click', onClick);
  const onExternal = (e: Event) => setSel((e as CustomEvent).detail);
  window.addEventListener('book:set', onExternal);

  onFrame((_t, dt) => {
    const open = selected >= 0 && anim[selected] > 0.2;
    ray.setFromCamera(ndc, camera);
    const hit = open ? null : ray.intersectObjects(hitMeshes, true)[0];
    let h = -1;
    if (hit) { let o: THREE.Object3D | null = hit.object; while (o && o.userData.index === undefined) o = o.parent; if (o) h = o.userData.index; }
    const hoverChanged = h !== hovered; // hover enter/leave kicks off an easing motion
    hovered = h;
    ctx.host.style.cursor = hovered >= 0 || open ? 'pointer' : 'default';
    // A new hover (or un-hover) starts a short ease that moves geometry — refresh
    // the shadow for a couple of frames so the contact shadow tracks the lift.
    if (hoverChanged) markShadowDirty(2);

    // time-based morph so it's slow + buttery smooth (frame-rate independent)
    const d = Math.min(dt, 0.05);
    for (const it of items) {
      const dir = it.index === selected ? 1 : -1;
      const prev = anim[it.index];
      anim[it.index] = Math.min(1, Math.max(0, prev + (dir * d) / it.dur));
      // While any item's open/close progress is changing, the scene is in motion
      // and the frozen shadow map must be re-baked to follow it.
      if (anim[it.index] !== prev) markShadowDirty(1);
      it.apply(anim[it.index], it.index === hovered && !open && anim[it.index] < 0.02);
      // Announce the exact frame a selected scroll's take-out + unroll finishes
      // (progress crosses to 1). The HTML reader modal listens for this so it
      // only unrolls AFTER the 3D scroll has fully presented — one continuous,
      // uninterrupted sequence rather than a mid-animation pop. Fires once.
      if (!readyFired && it.index === selected && it.kind === 'scroll' && prev < 1 && anim[it.index] >= 1) {
        readyFired = true;
        window.dispatchEvent(new CustomEvent('library:scroll-ready', { detail: { kind: it.kind, ref: it.ref } }));
      }
    }

    // dust motes drift down through the lamp light and wrap — imperceptibly
    // slow, and frozen entirely under prefers-reduced-motion.
    if (!reduced) {
      const a = moteGeo.attributes.position as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      for (let i = 0; i < MOTES; i++) {
        const j = i * 3;
        arr[j + 1] -= d * (0.18 + (i % 5) * 0.03);
        arr[j] += Math.sin(_t * 0.2 + i) * d * 0.05;
        if (arr[j + 1] < -moteSpan.y) arr[j + 1] = moteSpan.y;
      }
      a.needsUpdate = true;
    }

    // While a book/scroll is hovered (not yet open) it eases forward off the
    // shelf each frame — a lerp that keeps the geometry drifting for a beat. Keep
    // the contact shadow tracking that lift until it settles.
    if (hovered >= 0 && !open) markShadowDirty(1);

    // ── frozen-shadow bake gate ──────────────────────────────────────────────
    // The shadow map is NOT auto-updated. We re-bake it only when the scene is
    // in motion (shadowDirtyFrames > 0), and even then no more than once every
    // `shadowUpdateEvery` frames when the GPU is degraded. A still shelf re-bakes
    // zero shadows — the big win for this mostly-static scene.
    if (shadowsOn && shadowDirtyFrames > 0) {
      if (shadowFrame % shadowUpdateEvery === 0) warm.shadow.needsUpdate = true;
      shadowDirtyFrames--;
    }
    shadowFrame++;

    // The bookcase intentionally does NOT react to the cursor — moving it makes
    // the interaction janky. Keep it perfectly still. (Per Andrew's request.)
  });

  onDispose(() => {
    ctx.host.removeEventListener('pointermove', onMove);
    ctx.host.removeEventListener('click', onClick);
    window.removeEventListener('book:set', onExternal);
    items.forEach((it) => { it.textures.forEach((t) => t.dispose()); it.mats.forEach((m) => m.dispose()); });
    extra.tex.forEach((t) => t.dispose()); extra.mat.forEach((m) => m.dispose());
    [wood, woodDark, edgeMat].forEach((m) => m.dispose());
    woodMap.dispose(); woodRough.dispose();
    moteGeo.dispose(); moteMat.dispose(); moteTex.dispose();
    vignette.geometry.dispose(); vigMat.dispose(); vigTex.dispose();
    if (import.meta.env.DEV) {
      const w = window as unknown as { __libQuality?: unknown; __libShadowState?: unknown };
      delete w.__libQuality; delete w.__libShadowState;
    }
    // leave the renderer as we found it
    warm.shadow.map?.dispose();
    renderer.shadowMap.enabled = prevShadow;
    renderer.shadowMap.type = prevShadowType;
    renderer.shadowMap.autoUpdate = prevAutoUpdate;
  });
}

function addBox(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
