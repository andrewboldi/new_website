/**
 * AMC Trainer animation — competition-math motif. Drifting equations and
 * mathematical glyphs rise like rising answers, a faint answer-grid (the AMC
 * bubble sheet feel), and a thin countdown ring in the corner (timed contest).
 */
import type { CardFxCtx, Drawer } from './types';
import { rng, rgba, TAU } from './util';

const GLYPHS = [
  'x²', '√2', 'π', 'Σ', '∫', 'n!', 'a+b', 'φ', 'θ', '∞', '½', '∠',
  'C(n,k)', 'lim', 'sin', 'p/q', '3·5', '2ⁿ', 'mod', '≡', 'Δ', '∛',
];

interface Tok {
  s: string;
  x: number;
  y: number;
  vy: number;
  size: number;
  a: number;
  hue: 0 | 1 | 2; // blue / cyan / amber
}

export function mathcomp(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  const rand = rng(c.seed + 31);
  const hueColors = [colors.blue, colors.cyan, colors.amber];

  let toks: Tok[] = [];

  function spawn(initial: boolean): Tok {
    const hue = (rand() < 0.18 ? 2 : rand() < 0.5 ? 1 : 0) as 0 | 1 | 2;
    return {
      s: GLYPHS[(rand() * GLYPHS.length) | 0],
      x: rand() * W,
      y: initial ? rand() * H : H + 14,
      vy: 8 + rand() * 14, // px/s upward
      size: 11 + rand() * 12,
      a: 0.25 + rand() * 0.5,
      hue,
    };
  }

  function build() {
    const n = Math.max(7, Math.round((W * H) / 9000));
    toks = Array.from({ length: n }, () => spawn(true));
  }
  build();

  let phase = 0;
  const COUNTDOWN = 8; // seconds per countdown loop

  return {
    resize(w, h) {
      W = w;
      H = h;
      build();
    },
    frame(_t, dt, hot) {
      phase += dt;
      ctx.clearRect(0, 0, W, H);

      // faint answer-bubble grid (A-E columns vibe)
      ctx.save();
      const gx = 26;
      const gy = 22;
      ctx.fillStyle = rgba(colors.faint, 0.05 + hot * 0.04);
      for (let y = gy / 2; y < H; y += gy) {
        for (let x = gx / 2; x < W; x += gx) {
          ctx.beginPath();
          ctx.arc(x, y, 2.1, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();

      // drifting glyphs
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const t of toks) {
        t.y -= t.vy * dt * (1 + hot * 0.5);
        if (t.y < -16) {
          Object.assign(t, spawn(false));
        }
        ctx.font = `${t.size}px var(--mono, monospace)`;
        ctx.fillStyle = rgba(hueColors[t.hue], t.a * (0.7 + hot * 0.3));
        ctx.fillText(t.s, t.x, t.y);
      }

      // countdown ring, top-right — the "timed contest" cue
      const r = Math.min(W, H) * 0.13;
      const cx = W - r - 10;
      const cy = r + 10;
      const frac = 1 - (phase % COUNTDOWN) / COUNTDOWN;
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = rgba(colors.faint, 0.18);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba(colors.amber, 0.7 + hot * 0.25);
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
      ctx.stroke();
    },
  };
}
