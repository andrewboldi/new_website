/**
 * Pathfinder animation — a grid graph with a BFS/A*-style search frontier
 * (a wavefront) sweeping out from a start node, then the shortest PATH lighting
 * up between start and goal. Loops forever. Some cells are walls the search
 * flows around, so it reads unmistakably as pathfinding.
 */
import type { CardFxCtx, Drawer } from './types';
import { rng, rgba, clamp, TAU } from './util';

interface Cell {
  wall: boolean;
  dist: number; // BFS distance from start (Infinity if unreached)
  onPath: boolean;
}

export function pathfind(c: CardFxCtx): Drawer {
  const { ctx, colors } = c;
  let W = c.width;
  let H = c.height;
  const rand = rng(c.seed + 7);

  // grid sizing — aim for ~ 22px cells
  let cols = 0;
  let rows = 0;
  let grid: Cell[] = [];
  let order: number[] = []; // cell indices in BFS visitation order
  let path: number[] = [];
  let cw = 0;
  let chh = 0;
  let startI = 0;
  let goalI = 0;

  const at = (x: number, y: number) => grid[y * cols + x];

  function build() {
    cols = Math.max(6, Math.round(W / 24));
    rows = Math.max(5, Math.round(H / 24));
    cw = W / cols;
    chh = H / rows;
    grid = new Array(cols * rows);
    for (let i = 0; i < grid.length; i++) {
      grid[i] = { wall: rand() < 0.16, dist: Infinity, onPath: false };
    }
    // start = upper-left, goal = lower-right (vertically separated) so the
    // shortest path sweeps diagonally across the card and reads clearly rather
    // than hiding behind a single line of text.
    const sy = Math.floor(rows * (0.12 + rand() * 0.18));
    const gy = Math.floor(rows * (0.7 + rand() * 0.18));
    startI = sy * cols + 1;
    goalI = gy * cols + (cols - 2);
    grid[startI].wall = false;
    grid[goalI].wall = false;

    // BFS from start, recording visitation order + parent for path
    const parent = new Array<number>(grid.length).fill(-1);
    const q: number[] = [startI];
    grid[startI].dist = 0;
    order = [];
    const neigh = (i: number): number[] => {
      const x = i % cols;
      const y = (i / cols) | 0;
      const out: number[] = [];
      if (x > 0) out.push(i - 1);
      if (x < cols - 1) out.push(i + 1);
      if (y > 0) out.push(i - cols);
      if (y < rows - 1) out.push(i + cols);
      return out;
    };
    let qi = 0;
    let reached = false;
    while (qi < q.length) {
      const cur = q[qi++];
      order.push(cur);
      if (cur === goalI) {
        reached = true;
        break;
      }
      for (const nb of neigh(cur)) {
        if (grid[nb].wall || grid[nb].dist !== Infinity) continue;
        grid[nb].dist = grid[cur].dist + 1;
        parent[nb] = cur;
        q.push(nb);
      }
    }
    // reconstruct path
    path = [];
    if (reached) {
      let cur = goalI;
      while (cur !== -1) {
        path.push(cur);
        grid[cur].onPath = true;
        cur = parent[cur];
      }
    }
    // if no path (walls blocked it), retry once with fewer walls
    if (!reached && retries < 3) {
      retries++;
      for (const g of grid) g.wall = g.wall && rand() < 0.4;
      // recompute quickly by recursion-lite: just rebuild
      build();
    }
  }

  let retries = 0;
  build();

  // animation phases (seconds): reveal frontier, then trace path, then hold the
  // lit shortest path on screen for a good while (it's the signature moment),
  // then reset and search again.
  const FRONTIER_T = 2.4;
  const PATH_T = 1.4;
  const HOLD_T = 2.6;
  const CYCLE = FRONTIER_T + PATH_T + HOLD_T;
  let phase = 0;

  function dot(i: number, color: string, r: number) {
    const x = (i % cols) * cw + cw / 2;
    const y = ((i / cols) | 0) * chh + chh / 2;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  return {
    resize(w, h) {
      W = w;
      H = h;
      retries = 0;
      build();
    },
    frame(_t, dt, hot) {
      phase = (phase + dt) % CYCLE;
      ctx.clearRect(0, 0, W, H);

      // how far through the frontier reveal (0..1) and path trace (0..1)
      const fProg = clamp(phase / FRONTIER_T, 0, 1);
      const pProg = clamp((phase - FRONTIER_T) / PATH_T, 0, 1);
      const visN = Math.floor(fProg * order.length);

      // faint wall cells as a grid texture
      ctx.lineWidth = 1;
      for (let i = 0; i < grid.length; i++) {
        if (!grid[i].wall) continue;
        const x = (i % cols) * cw;
        const y = ((i / cols) | 0) * chh;
        ctx.fillStyle = rgba(colors.faint, 0.18 + hot * 0.1);
        ctx.fillRect(x + cw * 0.18, y + chh * 0.18, cw * 0.64, chh * 0.64);
      }

      // explored frontier: blue cells, brighter at the wave edge
      const edge = visN;
      for (let k = 0; k < visN; k++) {
        const i = order[k];
        const age = (visN - k) / Math.max(8, order.length * 0.18);
        const near = clamp(1 - age, 0, 1); // 1 at the leading edge
        const a = 0.1 + near * (0.55 + hot * 0.25);
        dot(i, rgba(colors.blue, a), Math.min(cw, chh) * (0.14 + near * 0.12));
      }
      // bright leading wave ring
      if (edge > 0 && edge < order.length) {
        for (let k = Math.max(0, edge - cols); k < edge; k++) {
          dot(order[k], rgba(colors.blueSoft, 0.5 + hot * 0.3), Math.min(cw, chh) * 0.2);
        }
      }

      // shortest path: bright cyan with a glow so it punches through the
      // blue frontier — this is the signature "shortest route" moment.
      if (phase >= FRONTIER_T && path.length) {
        const showN = Math.floor(pProg * path.length);
        ctx.save();
        ctx.shadowColor = rgba(colors.cyan, 0.9);
        ctx.shadowBlur = Math.min(cw, chh) * 0.9;
        ctx.strokeStyle = rgba(colors.cyanSoft, 0.95);
        ctx.lineWidth = Math.max(2.5, Math.min(cw, chh) * 0.2);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let k = 0; k <= showN && k < path.length; k++) {
          const i = path[k];
          const x = (i % cols) * cw + cw / 2;
          const y = ((i / cols) | 0) * chh + chh / 2;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
        // bright nodes punctuating the path so it reads as a route of cells
        for (let k = 0; k <= showN && k < path.length; k++) {
          dot(path[k], rgba(colors.cyanSoft, 0.8), Math.min(cw, chh) * 0.14);
        }
        // travelling pulse along the revealed path head
        const head = path[Math.min(showN, path.length - 1)];
        if (head != null) {
          ctx.save();
          ctx.shadowColor = rgba(colors.cyanSoft, 1);
          ctx.shadowBlur = Math.min(cw, chh);
          dot(head, rgba(colors.cyanSoft, 1), Math.min(cw, chh) * 0.28);
          ctx.restore();
        }
      }

      // start (cyan) & goal (amber) markers, gently pulsing
      const pulse = 0.7 + 0.3 * Math.sin(phase * 3);
      dot(startI, rgba(colors.cyanSoft, 0.9), Math.min(cw, chh) * 0.3 * pulse);
      dot(goalI, rgba(colors.amber, 0.9), Math.min(cw, chh) * 0.3 * pulse);
    },
  };
}
