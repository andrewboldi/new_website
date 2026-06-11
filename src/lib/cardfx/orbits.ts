/**
 * orbits — three gravitating bodies tracing chaotic looping trails. Used for the
 * Three-Body Invariants project. A light gravity sim with trail fade.
 */
import type { CardFxCtx, Drawer } from './types';
import { rng, rgba, TAU } from './util';

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  m: number;
  color: string;
  trail: number[]; // flattened x,y pairs
}

export function orbits(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  const rand = rng(c.seed + 5);
  let bodies: Body[] = [];
  const TRAIL = 60;

  function build() {
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) * 0.22;
    const pal = [colors.cyan, colors.blueSoft, colors.amber];
    bodies = [0, 1, 2].map((i) => {
      const a = (i / 3) * TAU + rand() * 0.4;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      // tangential velocity for some orbital motion
      const sp = 14 + rand() * 8;
      return {
        x,
        y,
        vx: -Math.sin(a) * sp,
        vy: Math.cos(a) * sp,
        m: 60 + rand() * 40,
        color: pal[i],
        trail: [],
      };
    });
  }
  build();

  function step(dt: number) {
    const G = 1400;
    for (let i = 0; i < bodies.length; i++) {
      let ax = 0;
      let ay = 0;
      for (let j = 0; j < bodies.length; j++) {
        if (i === j) continue;
        const dx = bodies[j].x - bodies[i].x;
        const dy = bodies[j].y - bodies[i].y;
        const d2 = dx * dx + dy * dy + 400; // soften
        const inv = 1 / Math.sqrt(d2);
        const f = (G * bodies[j].m) / d2;
        ax += f * dx * inv;
        ay += f * dy * inv;
      }
      bodies[i].vx += ax * dt;
      bodies[i].vy += ay * dt;
    }
    const cx = W / 2;
    const cy = H / 2;
    for (const b of bodies) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // soft central pull keeps them on-card
      b.vx += (cx - b.x) * 0.25 * dt;
      b.vy += (cy - b.y) * 0.25 * dt;
      b.trail.push(b.x, b.y);
      if (b.trail.length > TRAIL * 2) b.trail.splice(0, 2);
    }
  }

  let acc = 0;

  return {
    resize(w, h) {
      W = w;
      H = h;
      build();
    },
    frame(_t, dt, hot) {
      // fixed-step integration for stability
      acc += Math.min(dt, 0.05);
      const h = 1 / 120;
      let guard = 0;
      while (acc >= h && guard++ < 8) {
        step(h * (1 + hot * 0.4));
        acc -= h;
      }
      ctx.clearRect(0, 0, W, H);
      for (const b of bodies) {
        // trail
        ctx.lineWidth = 1.4;
        for (let k = 2; k < b.trail.length; k += 2) {
          const a = (k / b.trail.length) * (0.5 + hot * 0.25);
          ctx.strokeStyle = rgba(b.color, a);
          ctx.beginPath();
          ctx.moveTo(b.trail[k - 2], b.trail[k - 1]);
          ctx.lineTo(b.trail[k], b.trail[k + 1]);
          ctx.stroke();
        }
        // body
        ctx.beginPath();
        ctx.fillStyle = rgba(b.color, 0.95);
        ctx.arc(b.x, b.y, 3.5, 0, TAU);
        ctx.fill();
      }
    },
  };
}
