/**
 * molecule — a small floating molecular graph: atoms (nodes) joined by bonds,
 * gently rotating/jiggling, with one ring highlighted. Used for the chemistry
 * projects (Trennen, Polyphenols).
 */
import type { CardFxCtx, Drawer } from './types';
import { rng, rgba, TAU } from './util';

interface Atom {
  x: number;
  y: number;
  z: number;
  kind: number; // 0 carbon-ish, 1 heteroatom (colored)
}

export function molecule(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  const rand = rng(c.seed + 11);

  let atoms: Atom[] = [];
  let bonds: [number, number][] = [];
  let ringIdx: number[] = [];
  let R = 0;

  function build() {
    R = Math.min(W, H) * 0.32;
    atoms = [];
    bonds = [];
    // a hexagon ring + a few pendant atoms — reads as a molecule
    const ringN = 6;
    ringIdx = [];
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * TAU;
      atoms.push({ x: Math.cos(a) * R, y: Math.sin(a) * R * 0.7, z: Math.sin(a * 2) * R * 0.3, kind: i % 3 === 0 ? 1 : 0 });
      ringIdx.push(i);
      bonds.push([i, (i + 1) % ringN]);
    }
    // pendants
    const pend = 4 + ((rand() * 3) | 0);
    for (let p = 0; p < pend; p++) {
      const anchor = (rand() * ringN) | 0;
      const a = rand() * TAU;
      const len = R * (0.5 + rand() * 0.5);
      const ax = atoms[anchor].x + Math.cos(a) * len;
      const ay = atoms[anchor].y + Math.sin(a) * len * 0.7;
      atoms.push({ x: ax, y: ay, z: (rand() - 0.5) * R, kind: rand() < 0.4 ? 1 : 0 });
      bonds.push([anchor, atoms.length - 1]);
    }
  }
  build();

  let rot = 0;

  return {
    resize(w, h) {
      W = w;
      H = h;
      build();
    },
    frame(t, dt, hot) {
      rot += dt * (0.35 + hot * 0.4);
      ctx.clearRect(0, 0, W, H);
      const cx = W * 0.5;
      const cy = H * 0.52;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);

      // project (rotate around Y axis)
      const pts = atoms.map((a) => {
        const x = a.x * cos - a.z * sin;
        const z = a.x * sin + a.z * cos;
        const jig = Math.sin(t * 2 + a.y) * 2;
        const scale = 1 + z / (R * 4);
        return { sx: cx + x, sy: cy + a.y + jig, scale, kind: a.kind };
      });

      // bonds
      ctx.lineWidth = 1.6;
      for (const [i, j] of bonds) {
        ctx.strokeStyle = rgba(colors.blue, 0.3 + hot * 0.15);
        ctx.beginPath();
        ctx.moveTo(pts[i].sx, pts[i].sy);
        ctx.lineTo(pts[j].sx, pts[j].sy);
        ctx.stroke();
      }

      // highlighted ring fill
      ctx.beginPath();
      ringIdx.forEach((i, k) => {
        if (k === 0) ctx.moveTo(pts[i].sx, pts[i].sy);
        else ctx.lineTo(pts[i].sx, pts[i].sy);
      });
      ctx.closePath();
      ctx.fillStyle = rgba(colors.cyan, 0.06 + hot * 0.05);
      ctx.fill();

      // atoms
      for (const p of pts) {
        const r = (p.kind === 1 ? 4.5 : 3) * p.scale;
        ctx.beginPath();
        ctx.fillStyle = p.kind === 1 ? rgba(colors.cyan, 0.85) : rgba(colors.blueSoft, 0.6);
        ctx.arc(p.sx, p.sy, Math.max(1.5, r), 0, TAU);
        ctx.fill();
      }
    },
  };
}
