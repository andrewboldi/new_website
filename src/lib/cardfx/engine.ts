/**
 * cardfx engine — drives every project card's background <canvas> from a SINGLE
 * shared requestAnimationFrame loop. This is the performance contract for the
 * Work page: 16 cards, but ZERO WebGL contexts and only ONE rAF.
 *
 * Per card it:
 *   - lazily sizes a Canvas2D backing store to the card (DPR-aware, ResizeObserver)
 *   - only ticks while the card is on screen (IntersectionObserver) AND not
 *     filtered out (display:none cards report zero size -> skipped)
 *   - caps to ~30fps by accumulating dt
 *   - ramps a `hot` intensity toward 1 while hovered/focused, back to 0 otherwise
 *   - respects prefers-reduced-motion: paints exactly one static frame, no loop
 *   - tears everything down on disconnect()
 */
import type { Drawer, CardFxColors } from './types';
import { getFactory } from './registry';

const FPS_CAP = 30;
const FRAME_MIN = 1 / FPS_CAP;

function readColors(): CardFxColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => {
    const got = cs.getPropertyValue(name).trim();
    return got || fb;
  };
  return {
    blue: v('--blue', '#0099ff'),
    blueSoft: v('--blue-soft', '#57b8ff'),
    cyan: v('--cyan', '#38e8c8'),
    cyanSoft: v('--cyan-soft', '#7df3dc'),
    amber: v('--amber', '#ffb347'),
    ink: v('--ink', '#dfe7f5'),
    faint: v('--ink-faint', '#59647e'),
  };
}

interface CardState {
  card: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  drawer: Drawer | null;
  key: string;
  seed: number;
  visible: boolean;
  cssW: number;
  cssH: number;
  dpr: number;
  t: number; // accumulated animation seconds
  acc: number; // dt accumulator for fps cap
  hot: number; // 0..1 hover intensity
  hovered: boolean;
  ro: ResizeObserver;
}

export interface CardFxController {
  destroy(): void;
}

export function startCardFx(root: ParentNode = document): CardFxController {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const colors = readColors();
  const states: CardState[] = [];

  const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-cardfx]'));

  // ----- sizing -----
  function size(s: CardState) {
    const rect = s.card.getBoundingClientRect();
    // a display:none (filtered out) card has zero size -> we skip drawing it
    const cssW = Math.max(0, Math.round(rect.width));
    const cssH = Math.max(0, Math.round(rect.height));
    if (cssW === s.cssW && cssH === s.cssH) return;
    s.cssW = cssW;
    s.cssH = cssH;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    s.dpr = dpr;
    s.canvas.width = Math.max(1, Math.round(cssW * dpr));
    s.canvas.height = Math.max(1, Math.round(cssH * dpr));
    s.canvas.style.width = cssW + 'px';
    s.canvas.style.height = cssH + 'px';
    s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (s.drawer && cssW > 0 && cssH > 0) {
      s.drawer.resize?.(cssW, cssH);
    }
  }

  function ensureDrawer(s: CardState) {
    if (s.drawer || s.cssW <= 0 || s.cssH <= 0) return;
    const factory = getFactory(s.key);
    s.drawer = factory({
      ctx: s.ctx,
      width: s.cssW,
      height: s.cssH,
      dpr: s.dpr,
      colors,
      seed: s.seed,
    });
  }

  for (const card of cards) {
    const canvas = card.querySelector<HTMLCanvasElement>('canvas.cardfx-canvas');
    if (!canvas) continue;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) continue;
    const key = card.dataset.cardfx || '';
    let seed = 0;
    for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) | 0;
    seed ^= (card.dataset.cardfxSeed ? parseInt(card.dataset.cardfxSeed, 10) : 0) | 0;

    const s: CardState = {
      card,
      canvas,
      ctx,
      drawer: null,
      key,
      seed: seed || 1,
      visible: false,
      cssW: -1,
      cssH: -1,
      dpr: 1,
      t: Math.random() * 3, // desync identical animations
      acc: 0,
      hot: 0,
      hovered: false,
      ro: null as unknown as ResizeObserver,
    };

    const ro = new ResizeObserver(() => size(s));
    ro.observe(card);
    s.ro = ro;
    size(s);

    // hover/focus intensifies
    const enter = () => (s.hovered = true);
    const leave = () => (s.hovered = false);
    card.addEventListener('pointerenter', enter);
    card.addEventListener('pointerleave', leave);
    card.addEventListener('focusin', enter);
    card.addEventListener('focusout', leave);

    states.push(s);
  }

  // ----- visibility gating -----
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const s = states.find((st) => st.card === e.target);
        if (s) s.visible = e.isIntersecting && e.intersectionRatio > 0;
      }
    },
    { threshold: [0, 0.01] },
  );
  for (const s of states) io.observe(s.card);

  // ----- reduced motion: paint one static frame each, then stop -----
  if (reduced) {
    // wait a tick so layout/sizes settle
    requestAnimationFrame(() => {
      for (const s of states) {
        size(s);
        ensureDrawer(s);
        if (s.drawer && s.cssW > 0 && s.cssH > 0) {
          s.drawer.frame(1.2, 0, 0); // a representative still
        }
      }
    });
    return {
      destroy() {
        io.disconnect();
        for (const s of states) {
          s.ro.disconnect();
          s.drawer?.dispose?.();
        }
      },
    };
  }

  // ----- single shared animation loop, fps-capped -----
  let raf = 0;
  let last = performance.now();
  let running = !document.hidden;

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = FRAME_MIN; // tab was backgrounded -> avoid jumps

    for (const s of states) {
      // ramp hover intensity smoothly regardless of draw gating
      const target = s.hovered ? 1 : 0;
      s.hot += (target - s.hot) * Math.min(1, dt * 6);

      if (!s.visible || s.cssW <= 0 || s.cssH <= 0) continue;
      ensureDrawer(s);
      if (!s.drawer) continue;

      // per-card fps cap via accumulator
      s.acc += dt;
      if (s.acc < FRAME_MIN) continue;
      const step = s.acc;
      s.acc = 0;
      s.t += step;
      s.drawer.frame(s.t, step, s.hot);
    }
  };

  const onVis = () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!running) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };
  document.addEventListener('visibilitychange', onVis);
  raf = requestAnimationFrame(tick);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect();
      for (const s of states) {
        s.ro.disconnect();
        s.drawer?.dispose?.();
      }
    },
  };
}
