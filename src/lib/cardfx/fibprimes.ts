/**
 * fibprimes animation — a Fibonacci golden spiral with the integers 1,2,3,5,8…
 * placed along it. PRIMES among them are highlighted and pulse like struck
 * musical notes (the project sonifies Fibonacci + primes into MIDI). A faint
 * staff of horizontal lines underneath reinforces the music mapping.
 */
import type { CardFxCtx, Drawer } from './types';
import { rgba, isPrime, clamp, TAU } from './util';

interface Node {
  n: number; // the integer
  ang: number; // angle along spiral
  rad: number; // radius along spiral
  prime: boolean;
}

export function fibprimes(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;

  const GOLD = (1 + Math.sqrt(5)) / 2;
  const GOLDEN_ANGLE = TAU * (1 - 1 / GOLD); // ~137.5°

  let nodes: Node[] = [];
  let maxRad = 0;
  const COUNT = 90; // integers placed along the spiral

  function build() {
    maxRad = Math.min(W, H) * 0.46;
    nodes = [];
    // phyllotaxis / golden-spiral placement: r = k*sqrt(i), theta = i*goldenAngle
    const k = maxRad / Math.sqrt(COUNT);
    for (let i = 1; i <= COUNT; i++) {
      nodes.push({
        n: i,
        ang: i * GOLDEN_ANGLE,
        rad: k * Math.sqrt(i),
        prime: isPrime(i),
      });
    }
  }
  build();

  let phase = 0;
  // a "playhead" sweeps outward repeatedly; primes near it light up like notes
  const SWEEP = 6; // seconds per outward sweep

  return {
    resize(w, h) {
      W = w;
      H = h;
      build();
    },
    frame(_t, dt, hot) {
      phase += dt;
      ctx.clearRect(0, 0, W, H);
      const cx = W * 0.5;
      const cy = H * 0.54;

      // faint music staff behind everything
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(colors.faint, 0.1 + hot * 0.05);
      for (let s = 0; s < 5; s++) {
        const y = H * 0.32 + s * (H * 0.09);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // the continuous golden spiral curve
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = rgba(colors.blue, 0.28 + hot * 0.12);
      ctx.beginPath();
      const k = maxRad / Math.sqrt(COUNT);
      for (let i = 1; i <= COUNT; i += 0.5) {
        const a = i * GOLDEN_ANGLE;
        const r = k * Math.sqrt(i);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 1) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // playhead radius sweeps outward
      const headRad = ((phase % SWEEP) / SWEEP) * maxRad;

      // integers along the spiral; primes pulse as the playhead passes
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const nd of nodes) {
        const x = cx + Math.cos(nd.ang) * nd.rad;
        const y = cy + Math.sin(nd.ang) * nd.rad;

        // proximity of playhead to this node's radius -> "struck note" envelope
        const d = Math.abs(nd.rad - headRad);
        const strike = clamp(1 - d / (maxRad * 0.12), 0, 1);

        if (nd.prime) {
          // prime "note": cyan, blooms + ring when struck
          const r = 2.2 + strike * 5.5 * (1 + hot * 0.4);
          ctx.beginPath();
          ctx.fillStyle = rgba(colors.cyan, 0.5 + strike * 0.5);
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
          if (strike > 0.15) {
            ctx.beginPath();
            ctx.strokeStyle = rgba(colors.cyanSoft, strike * 0.7);
            ctx.lineWidth = 1.5;
            ctx.arc(x, y, r + 4 + strike * 8, 0, TAU);
            ctx.stroke();
          }
        } else {
          // composite integer: small faint blue dot
          ctx.beginPath();
          ctx.fillStyle = rgba(colors.blueSoft, 0.18 + strike * 0.25);
          ctx.arc(x, y, 1.6 + strike * 1.6, 0, TAU);
          ctx.fill();
        }
      }

      // a couple of early integers labelled to read as "Fibonacci/integers"
      ctx.fillStyle = rgba(colors.cyanSoft, 0.5 + hot * 0.2);
      ctx.font = `9px var(--mono, monospace)`;
      for (const lbl of [2, 3, 5, 13]) {
        const nd = nodes[lbl - 1];
        if (!nd) continue;
        const x = cx + Math.cos(nd.ang) * nd.rad;
        const y = cy + Math.sin(nd.ang) * nd.rad;
        ctx.fillText(String(lbl), x + 7, y - 6);
      }
    },
  };
}
