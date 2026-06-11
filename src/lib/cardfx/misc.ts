/**
 * A collection of the remaining compact Canvas2D card animations, one factory
 * each. Kept together because individually they are small and share helpers.
 *
 *   oscillator — damped harmonic wave + phase dot       (Oscillations)
 *   waveform   — audio waveform / piano-roll bars        (musalpha, Simple Bible Audio)
 *   puzzle     — rotating Square-1 style sliced disc      (squanmate)
 *   mazehash   — maze walls + hashing block stack         (Pacman + Bitcoin Miner)
 *   notegraph  — linked-note knowledge graph              (obsidian-vault-sync)
 *   packets    — mail envelopes flowing along a wire       (thunderbird-mcp)
 *   agents     — central hub dispatching to agent nodes   (Gas Town)
 *   zipf       — ranked frequency (Zipf) decay bars + curve (zipfai)
 *   gridworld  — RL agent moving on a value gridworld      (DRL for Total Synthesis)
 */
import type { CardFxCtx, Drawer } from './types';
import { rng, rgba, clamp, lerp, TAU } from './util';

/* ------------------------------------------------------------------ oscillator */
export function oscillator(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  let phase = 0;
  return {
    resize(w, h) {
      W = w;
      H = h;
    },
    frame(_t, dt, hot) {
      phase += dt;
      ctx.clearRect(0, 0, W, H);
      const mid = H * 0.52;
      // axis
      ctx.strokeStyle = rgba(colors.faint, 0.12);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(W, mid);
      ctx.stroke();
      // damped sine: A e^{-x/τ} sin(kx - ωt)
      const tau = W * 0.55;
      const k = (TAU * 2.2) / W;
      const A = H * 0.3;
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = rgba(colors.cyan, 0.7 + hot * 0.25);
      ctx.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const env = Math.exp(-x / tau);
        const y = mid + A * env * Math.sin(k * x - phase * 3);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // decay envelope (faint amber)
      ctx.strokeStyle = rgba(colors.amber, 0.22);
      ctx.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const y = mid - A * Math.exp(-x / tau);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // moving phase dot
      const px = ((phase * 60) % W);
      const env = Math.exp(-px / tau);
      ctx.beginPath();
      ctx.fillStyle = rgba(colors.cyanSoft, 0.9);
      ctx.arc(px, mid + A * env * Math.sin(k * px - phase * 3), 3.5, 0, TAU);
      ctx.fill();
    },
  };
}

/* -------------------------------------------------------------------- waveform */
export function waveform(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  const rand = rng(c.seed + 17);
  let bars = 0;
  let bw = 0;
  let seeds: number[] = [];
  function build() {
    bw = 8;
    bars = Math.max(8, Math.floor(W / bw));
    seeds = Array.from({ length: bars }, () => rand() * TAU);
  }
  build();
  let phase = 0;
  return {
    resize(w, h) {
      W = w;
      H = h;
      build();
    },
    frame(_t, dt, hot) {
      phase += dt * 4;
      ctx.clearRect(0, 0, W, H);
      const mid = H * 0.55;
      for (let i = 0; i < bars; i++) {
        const env =
          0.3 +
          0.7 *
            Math.abs(
              Math.sin(seeds[i] + phase * (0.6 + (i % 5) * 0.12)) *
                Math.sin(phase * 0.5 + i * 0.2),
            );
        const hgt = env * H * 0.42 * (1 + hot * 0.3);
        const x = i * bw + 1;
        // piano-roll color: cyan body, occasional amber accent note
        const accent = i % 7 === 0;
        ctx.fillStyle = rgba(accent ? colors.amber : colors.cyan, 0.55 + env * 0.35);
        ctx.fillRect(x, mid - hgt, bw - 2, hgt);
        ctx.fillStyle = rgba(accent ? colors.amber : colors.blue, 0.3 + env * 0.25);
        ctx.fillRect(x, mid, bw - 2, hgt * 0.7);
      }
    },
  };
}

/* ---------------------------------------------------------------------- puzzle */
export function puzzle(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  // Square-1 vibe: a disc split into top/bottom layers of kite/triangle wedges
  let topRot = 0;
  let botRot = 0;
  let twist = 0;
  return {
    resize(w, h) {
      W = w;
      H = h;
    },
    frame(_t, dt, hot) {
      twist += dt;
      // occasional quarter-turn "moves"
      const speed = 0.6 + hot * 0.6;
      topRot += dt * speed;
      botRot -= dt * speed * 0.7;
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.4;

      const drawLayer = (rot: number, y0: number, y1: number, n: number, color: string) => {
        for (let i = 0; i < n; i++) {
          const a0 = rot + (i / n) * TAU;
          const a1 = rot + ((i + 1) / n) * TAU;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R * 0.5);
          ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R * 0.5);
          ctx.closePath();
          const lit = i % 2 === 0;
          ctx.fillStyle = rgba(color, lit ? 0.22 : 0.1);
          ctx.fill();
          ctx.strokeStyle = rgba(colors.blueSoft, 0.3);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      };
      // bottom layer (slightly larger ellipse), then top
      ctx.save();
      drawLayer(botRot, cy, cy + R * 0.5, 8, colors.blue);
      drawLayer(topRot, cy - R * 0.5, cy, 6, colors.cyan);
      ctx.restore();

      // equator line
      ctx.strokeStyle = rgba(colors.cyan, 0.4 + hot * 0.2);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx - R, cy);
      ctx.lineTo(cx + R, cy);
      ctx.stroke();
    },
  };
}

/* -------------------------------------------------------------------- mazehash */
export function mazehash(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  const rand = rng(c.seed + 23);
  let cols = 0;
  let rows = 0;
  let cw = 0;
  let chh = 0;
  let walls: boolean[] = [];
  // a pac-dot traveller
  let pi = 0;
  let pj = 0;
  let dir = 0;
  // hash blocks scrolling up the right edge
  interface Blk { y: number; hex: string; }
  let blocks: Blk[] = [];
  function hex8() {
    let s = '';
    for (let i = 0; i < 6; i++) s += '0123456789abcdef'[(rand() * 16) | 0];
    return s;
  }
  function build() {
    cw = 20;
    chh = 20;
    cols = Math.max(4, Math.floor((W * 0.62) / cw));
    rows = Math.max(4, Math.floor(H / chh));
    walls = Array.from({ length: cols * rows }, () => rand() < 0.28);
    pi = 0;
    pj = (rows / 2) | 0;
    walls[pj * cols + pi] = false;
    blocks = [];
  }
  build();
  let moveAcc = 0;
  let blkAcc = 0;
  return {
    resize(w, h) {
      W = w;
      H = h;
      build();
    },
    frame(_t, dt, hot) {
      ctx.clearRect(0, 0, W, H);
      // maze area on the left ~62%
      ctx.strokeStyle = rgba(colors.blue, 0.3 + hot * 0.12);
      ctx.lineWidth = 2;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          if (!walls[j * cols + i]) continue;
          const x = i * cw;
          const y = j * chh;
          ctx.strokeRect(x + 3, y + 3, cw - 6, chh - 6);
        }
      }
      // pac traveller moves on a timer along open cells
      moveAcc += dt;
      const stepEvery = 0.18 / (1 + hot * 0.6);
      while (moveAcc >= stepEvery) {
        moveAcc -= stepEvery;
        // try to keep going; pick a random open neighbor
        const opts: Array<[number, number, number]> = [];
        const tryc = (ni: number, nj: number, d: number) => {
          if (ni >= 0 && ni < cols && nj >= 0 && nj < rows && !walls[nj * cols + ni]) opts.push([ni, nj, d]);
        };
        tryc(pi + 1, pj, 0);
        tryc(pi, pj + 1, 1);
        tryc(pi - 1, pj, 2);
        tryc(pi, pj - 1, 3);
        if (opts.length) {
          // prefer current direction
          const keep = opts.find((o) => o[2] === dir);
          const pick = keep && rand() < 0.7 ? keep : opts[(rand() * opts.length) | 0];
          pi = pick[0];
          pj = pick[1];
          dir = pick[2];
        } else {
          pi = 0;
          pj = (rows / 2) | 0;
        }
      }
      // pac dot
      const mouth = 0.18 + 0.18 * Math.abs(Math.sin(_t * 8));
      const px = pi * cw + cw / 2;
      const py = pj * chh + chh / 2;
      ctx.beginPath();
      ctx.fillStyle = rgba(colors.amber, 0.9);
      ctx.moveTo(px, py);
      const base = dir * (TAU / 4);
      ctx.arc(px, py, cw * 0.34, base + mouth, base + TAU - mouth);
      ctx.closePath();
      ctx.fill();

      // hashing blocks scroll up the right strip
      const rx = W * 0.66;
      blkAcc += dt;
      if (blkAcc > 0.9) {
        blkAcc = 0;
        blocks.push({ y: H + 10, hex: hex8() });
      }
      ctx.font = '10px var(--mono, monospace)';
      ctx.textBaseline = 'middle';
      blocks = blocks.filter((b) => b.y > -20);
      for (const b of blocks) {
        b.y -= dt * 22 * (1 + hot * 0.4);
        ctx.fillStyle = rgba(colors.cyan, 0.12);
        ctx.fillRect(rx, b.y - 8, W - rx - 6, 16);
        ctx.strokeStyle = rgba(colors.cyan, 0.4);
        ctx.lineWidth = 1;
        ctx.strokeRect(rx, b.y - 8, W - rx - 6, 16);
        ctx.fillStyle = rgba(colors.cyanSoft, 0.7);
        ctx.fillText('0x' + b.hex, rx + 4, b.y);
      }
    },
  };
}

/* ------------------------------------------------------------------- notegraph */
export function notegraph(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  const rand = rng(c.seed + 41);
  interface N { x: number; y: number; vx: number; vy: number; }
  let nodes: N[] = [];
  let edges: [number, number][] = [];
  let pulse: { e: number; t: number }[] = [];
  function build() {
    const n = Math.max(7, Math.round((W * H) / 11000));
    nodes = Array.from({ length: n }, () => ({
      x: rand() * W,
      y: rand() * H,
      vx: (rand() - 0.5) * 6,
      vy: (rand() - 0.5) * 6,
    }));
    edges = [];
    for (let i = 0; i < n; i++) {
      const links = 1 + ((rand() * 2) | 0);
      for (let l = 0; l < links; l++) {
        const j = (rand() * n) | 0;
        if (j !== i) edges.push([i, j]);
      }
    }
    pulse = [];
  }
  build();
  let pAcc = 0;
  return {
    resize(w, h) {
      W = w;
      H = h;
      build();
    },
    frame(_t, dt, hot) {
      ctx.clearRect(0, 0, W, H);
      // drift + bounce
      for (const nd of nodes) {
        nd.x += nd.vx * dt;
        nd.y += nd.vy * dt;
        if (nd.x < 6 || nd.x > W - 6) nd.vx *= -1;
        if (nd.y < 6 || nd.y > H - 6) nd.vy *= -1;
        nd.x = clamp(nd.x, 6, W - 6);
        nd.y = clamp(nd.y, 6, H - 6);
      }
      // edges
      ctx.lineWidth = 1;
      for (const [i, j] of edges) {
        ctx.strokeStyle = rgba(colors.blue, 0.18 + hot * 0.08);
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);
        ctx.stroke();
      }
      // travelling sync pulses along edges (the "sync" idea)
      pAcc += dt;
      if (pAcc > 0.6 && edges.length) {
        pAcc = 0;
        pulse.push({ e: (rand() * edges.length) | 0, t: 0 });
      }
      pulse = pulse.filter((p) => p.t < 1);
      for (const p of pulse) {
        p.t += dt * 1.2;
        const [i, j] = edges[p.e];
        const x = lerp(nodes[i].x, nodes[j].x, p.t);
        const y = lerp(nodes[i].y, nodes[j].y, p.t);
        ctx.beginPath();
        ctx.fillStyle = rgba(colors.cyanSoft, 0.9 * (1 - p.t));
        ctx.arc(x, y, 3, 0, TAU);
        ctx.fill();
      }
      // nodes
      for (const nd of nodes) {
        ctx.beginPath();
        ctx.fillStyle = rgba(colors.cyan, 0.7);
        ctx.arc(nd.x, nd.y, 3.2, 0, TAU);
        ctx.fill();
      }
    },
  };
}

/* --------------------------------------------------------------------- packets */
export function packets(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  const rand = rng(c.seed + 53);
  interface P { lane: number; x: number; speed: number; }
  let lanes: number[] = [];
  let pk: P[] = [];
  function build() {
    const n = Math.max(3, Math.floor(H / 34));
    lanes = Array.from({ length: n }, (_, i) => (H * (i + 0.5)) / n);
    pk = [];
  }
  build();
  let spawnAcc = 0;
  function envelope(x: number, y: number, w: number, hot: number) {
    const h = w * 0.66;
    ctx.strokeStyle = rgba(colors.cyan, 0.7 + hot * 0.2);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, y - h / 2, w, h);
    // flap
    ctx.beginPath();
    ctx.moveTo(x, y - h / 2);
    ctx.lineTo(x + w / 2, y + h / 6);
    ctx.lineTo(x + w, y - h / 2);
    ctx.stroke();
  }
  return {
    resize(w, h) {
      W = w;
      H = h;
      build();
    },
    frame(_t, dt, hot) {
      ctx.clearRect(0, 0, W, H);
      // wires
      ctx.strokeStyle = rgba(colors.faint, 0.12);
      ctx.lineWidth = 1;
      for (const y of lanes) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      spawnAcc += dt;
      if (spawnAcc > 0.55) {
        spawnAcc = 0;
        pk.push({ lane: (rand() * lanes.length) | 0, x: -16, speed: 30 + rand() * 40 });
      }
      pk = pk.filter((p) => p.x < W + 20);
      for (const p of pk) {
        p.x += p.speed * dt * (1 + hot * 0.5);
        envelope(p.x, lanes[p.lane], 16, hot);
      }
    },
  };
}

/* ---------------------------------------------------------------------- agents */
export function agents(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  const rand = rng(c.seed + 67);
  interface A { x: number; y: number; busy: number; }
  let workers: A[] = [];
  let tasks: { wi: number; t: number; out: boolean }[] = [];
  function build() {
    const n = 5;
    workers = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * TAU - Math.PI / 2;
      const r = Math.min(W, H) * 0.34;
      return { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r * 0.85, busy: 0 };
    });
    tasks = [];
  }
  build();
  let acc = 0;
  return {
    resize(w, h) {
      W = w;
      H = h;
      build();
    },
    frame(_t, dt, hot) {
      ctx.clearRect(0, 0, W, H);
      const hx = W / 2;
      const hy = H / 2;
      // spokes
      ctx.lineWidth = 1;
      for (const w of workers) {
        ctx.strokeStyle = rgba(colors.blue, 0.16 + w.busy * 0.2);
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(w.x, w.y);
        ctx.stroke();
      }
      // dispatch tasks from hub to a worker (out) and results back (in)
      acc += dt;
      if (acc > 0.5) {
        acc = 0;
        tasks.push({ wi: (rand() * workers.length) | 0, t: 0, out: true });
      }
      tasks = tasks.filter((tk) => tk.t < 1);
      for (const tk of tasks) {
        tk.t += dt * 1.1;
        const w = workers[tk.wi];
        const a = tk.out ? tk.t : 1 - tk.t;
        const x = lerp(hx, w.x, a);
        const y = lerp(hy, w.y, a);
        ctx.beginPath();
        ctx.fillStyle = rgba(tk.out ? colors.cyanSoft : colors.amber, 0.9 * (1 - Math.abs(tk.t - 0.5)));
        ctx.arc(x, y, 3, 0, TAU);
        ctx.fill();
        if (tk.t > 0.6) w.busy = clamp(w.busy + dt, 0, 1);
      }
      for (const w of workers) w.busy = clamp(w.busy - dt * 0.4, 0, 1);
      // worker nodes
      for (const w of workers) {
        ctx.beginPath();
        ctx.fillStyle = rgba(colors.cyan, 0.6 + w.busy * 0.4);
        ctx.arc(w.x, w.y, 5 + w.busy * 2, 0, TAU);
        ctx.fill();
      }
      // hub
      const pulse = 0.7 + 0.3 * Math.sin(_t * 3);
      ctx.beginPath();
      ctx.fillStyle = rgba(colors.amber, 0.85);
      ctx.arc(hx, hy, 6 * pulse + 2, 0, TAU);
      ctx.fill();
    },
  };
}

/* ------------------------------------------------------------------------ zipf */
export function zipf(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  let phase = 0;
  return {
    resize(w, h) {
      W = w;
      H = h;
    },
    frame(_t, dt, hot) {
      phase += dt;
      ctx.clearRect(0, 0, W, H);
      const baseY = H * 0.82;
      const n = Math.min(26, Math.max(8, Math.floor(W / 14)));
      const bw = (W * 0.92) / n;
      const x0 = W * 0.04;
      // Zipf: freq ∝ 1/rank — bars decay, with a little shimmer
      for (let i = 0; i < n; i++) {
        const f = 1 / (i + 1);
        const jitter = 1 + 0.06 * Math.sin(phase * 2 + i);
        const hgt = f * H * 0.66 * jitter * (1 + hot * 0.15);
        const x = x0 + i * bw;
        ctx.fillStyle = rgba(i === 0 ? colors.amber : colors.blue, 0.35 + (1 - i / n) * 0.4);
        ctx.fillRect(x, baseY - hgt, bw - 2, hgt);
      }
      // smooth 1/x curve overlay (cyan)
      ctx.strokeStyle = rgba(colors.cyan, 0.8 + hot * 0.2);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const f = 1 / (i + 1);
        const x = x0 + i * bw + bw / 2;
        const y = baseY - f * H * 0.66;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // axis
      ctx.strokeStyle = rgba(colors.faint, 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, baseY);
      ctx.lineTo(W * 0.96, baseY);
      ctx.stroke();
    },
  };
}

/* ------------------------------------------------------------------- gridworld */
export function gridworld(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  const rand = rng(c.seed + 71);
  let cols = 0;
  let rows = 0;
  let cw = 0;
  let chh = 0;
  let goal = [0, 0];
  let value: number[] = []; // per-cell value heat, higher near goal
  let ax = 0;
  let ay = 0;
  let path: [number, number][] = [];
  function build() {
    cw = 26;
    chh = 26;
    cols = Math.max(4, Math.floor(W / cw));
    rows = Math.max(4, Math.floor(H / chh));
    goal = [cols - 1, (rows / 2) | 0];
    value = new Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const d = Math.hypot(i - goal[0], j - goal[1]);
        value[j * cols + i] = Math.max(0, 1 - d / (cols + rows) / 0.7);
      }
    }
    ax = 0;
    ay = (rows / 2) | 0;
    path = [[ax, ay]];
  }
  build();
  let moveAcc = 0;
  return {
    resize(w, h) {
      W = w;
      H = h;
      build();
    },
    frame(_t, dt, hot) {
      ctx.clearRect(0, 0, W, H);
      // value heat cells
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const v = value[j * cols + i];
          ctx.fillStyle = rgba(colors.blue, 0.05 + v * 0.3);
          ctx.fillRect(i * cw + 2, j * chh + 2, cw - 4, chh - 4);
        }
      }
      // grid lines
      ctx.strokeStyle = rgba(colors.faint, 0.1);
      ctx.lineWidth = 1;
      for (let i = 0; i <= cols; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cw, 0);
        ctx.lineTo(i * cw, rows * chh);
        ctx.stroke();
      }
      for (let j = 0; j <= rows; j++) {
        ctx.beginPath();
        ctx.moveTo(0, j * chh);
        ctx.lineTo(cols * cw, j * chh);
        ctx.stroke();
      }
      // agent greedily climbs value toward goal
      moveAcc += dt;
      const stepEvery = 0.45 / (1 + hot * 0.5);
      if (moveAcc >= stepEvery) {
        moveAcc = 0;
        if (ax === goal[0] && ay === goal[1]) {
          ax = 0;
          ay = (rows / 2) | 0;
          path = [[ax, ay]];
        } else {
          // pick neighbor with max value (epsilon-greedy)
          let best = -1;
          let bx = ax;
          let by = ay;
          const cand: Array<[number, number]> = [
            [ax + 1, ay],
            [ax, ay + 1],
            [ax, ay - 1],
            [ax - 1, ay],
          ];
          for (const [ni, nj] of cand) {
            if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
            const v = value[nj * cols + ni] + rand() * 0.05;
            if (v > best) {
              best = v;
              bx = ni;
              by = nj;
            }
          }
          ax = bx;
          ay = by;
          path.push([ax, ay]);
          if (path.length > 24) path.shift();
        }
      }
      // path trail
      ctx.strokeStyle = rgba(colors.cyan, 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      path.forEach(([i, j], k) => {
        const x = i * cw + cw / 2;
        const y = j * chh + chh / 2;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // goal star
      ctx.fillStyle = rgba(colors.amber, 0.9);
      ctx.fillRect(goal[0] * cw + cw * 0.3, goal[1] * chh + chh * 0.3, cw * 0.4, chh * 0.4);
      // agent
      ctx.beginPath();
      ctx.fillStyle = rgba(colors.cyanSoft, 0.95);
      ctx.arc(ax * cw + cw / 2, ay * chh + chh / 2, Math.min(cw, chh) * 0.22, 0, TAU);
      ctx.fill();
    },
  };
}
