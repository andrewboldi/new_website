/**
 * Damped page scroll with a hard velocity ceiling.
 *
 * WHY: the scroll-linked background (MorphField) maps six shape stages onto the
 * whole document, so a trackpad fling or a flicked scrollbar crossed all six in
 * ~0.4s — the morph read as a smear rather than a transformation. Two SEPARATE
 * problems, both fixed here:
 *
 *  1. DAMPING (Lenis). Wheel input arrives in discrete chunks (and on Linux/
 *     Windows mice, in 100px+ steps), so scroll-linked animation gets a stair-
 *     stepped input signal. Lenis drives a virtual target that the real scroll
 *     eases toward, turning those steps into continuous motion.
 *
 *     Lenis writes the REAL window scroll position every frame, so `window
 *     .scrollY` stays truthful and every existing scroll reader — MorphField
 *     .scrollProgress(), HeroField.heroProgress(), SiteFeatures' progress bar —
 *     keeps working untouched. The native scrollbar stays real too.
 *
 *  2. VELOCITY CEILING. Damping alone only smooths the INPUT: a hard fling still
 *     sets a far target and Lenis eases there in ~1s, which is still too fast to
 *     read a six-stage morph. So we meter the target.
 *
 *     `desired` holds the user's full accumulated scroll intent; `targetScroll`
 *     is only ever allowed to sit `maxGap` ahead of the current position. For
 *     exponential damping the speed is `gap / tau`, so capping the gap at
 *     `V * tau` caps the speed at V — while `desired` retains the rest of the
 *     intent, so the scroll keeps travelling at the ceiling until it arrives.
 *     Nothing is discarded; it is paced. Gentle scrolling never reaches the gap,
 *     so the ceiling is invisible unless you actually fling.
 *
 * TICKED FROM THE SCENE SCHEDULER (core.setPreFrame), not its own rAF: the
 * scroll position must advance BEFORE any scroll-linked scene reads it in the
 * same frame. Two independent rAF loops would leave the background trailing the
 * page by one frame — the exact jitter this is meant to remove.
 *
 * NOT SMOOTHED, deliberately:
 *   - touch (native touch scrolling beats anything we'd simulate)
 *   - keyboard (End/Home/PageDown stay instant; hijacking them is an a11y trap,
 *     and they're explicit "take me there" gestures. MorphField's own eased
 *     progress still cushions the jump.)
 *   - prefers-reduced-motion (never initialises at all)
 */
import Lenis from 'lenis';
import { setPreFrame } from '@/lib/three/core';

/** Lenis damping strength, expressed per 60fps-equivalent frame. */
const LERP = 0.085;
/** Time constant of that damping, in seconds. Exponential damp ⇒ tau ≈ 1/(lerp·60). */
const TAU = 1 / (LERP * 60);
/**
 * Scroll speed ceiling, in viewport-heights per second.
 *
 * The six-stage morph spans the whole document (~7vh on home), so 2.2vh/s means
 * the full sequence can never take less than ~3s however hard you fling, while a
 * normal reading scroll (~1vh/s) never touches the limit. Lower = more
 * cinematic but the page starts to feel stuck; this is the single tuning knob.
 */
const MAX_VH_PER_SEC = 2.2;

let lenis: Lenis | null = null;
/** Full accumulated scroll intent in px — the ceiling meters `targetScroll` toward this. */
let desired = 0;
/** Previous frame's `targetScroll`, to detect how much new input Lenis folded in. */
let prevTarget = 0;
/** Set while a programmatic scrollTo animates, so the ceiling doesn't fight it. */
let programmatic = false;

const tick = (nowMs: number) => {
  const l = lenis;
  if (!l) return;

  if (programmatic) {
    // A scrollTo owns the target; just stay in sync so the ceiling resumes
    // cleanly from wherever it lands.
    desired = l.targetScroll;
  } else {
    // Fold in whatever new input Lenis added to its own target since last frame,
    // then meter our accumulated intent back into it.
    desired += l.targetScroll - prevTarget;
    desired = Math.min(l.limit, Math.max(0, desired));

    const maxGap = MAX_VH_PER_SEC * (window.innerHeight || 1) * TAU;
    const gap = desired - l.animatedScroll;
    const capped = Math.abs(gap) <= maxGap
      ? desired
      : l.animatedScroll + Math.sign(gap) * maxGap;

    // Re-drive Lenis toward the metered target. Assigning `l.targetScroll`
    // directly is NOT enough: Lenis captures its destination when the animation
    // is created (`animate.fromTo`, lenis.mjs:821) and never re-reads the field,
    // so a bare assignment is ignored by the in-flight animation — the metered
    // remainder of `desired` would never be delivered and a fling would stop
    // short of where the user actually asked to go.
    //
    // `programmatic: false` is required: the default (true) rewrites
    // `targetScroll` on every onUpdate (lenis.mjs:837), which would corrupt the
    // `prevTarget` delta accounting above into double-counting its own output.
    if (Math.abs(capped - l.targetScroll) > 0.05) {
      l.scrollTo(capped, { lerp: LERP, programmatic: false });
    }
  }

  prevTarget = l.targetScroll;
  l.raf(nowMs);
};

/**
 * Scroll to an absolute Y, bypassing the velocity ceiling. Use for deliberate
 * "take me there" jumps (back-to-top, filter re-anchoring) — pacing those would
 * just feel broken. Falls back to native smooth scroll when Lenis is inactive
 * (reduced motion).
 */
export function scrollToY(top: number, duration = 0.9) {
  const l = lenis;
  if (!l) {
    window.scrollTo({ top, behavior: 'smooth' });
    return;
  }
  programmatic = true;
  l.scrollTo(top, {
    duration,
    onComplete: () => {
      programmatic = false;
      desired = l.targetScroll;
      prevTarget = l.targetScroll;
    },
  });
}

function destroy() {
  if (!lenis) return;
  setPreFrame(null);
  lenis.destroy();
  lenis = null;
}

function init() {
  if (lenis) return;
  // Reduced motion: leave scrolling entirely native. Damping IS motion.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  lenis = new Lenis({
    lerp: LERP,
    smoothWheel: true,
    syncTouch: false, // touch stays native
    autoRaf: false,   // we drive raf() from the scene scheduler
    anchors: false,   // the only in-page anchor is the skip link — it must jump instantly
  });

  desired = lenis.animatedScroll;
  prevTarget = lenis.targetScroll;

  // A browser-driven scroll (scrollbar drag, keyboard, find-in-page, anchor)
  // moves the position out from under us. Re-seed the intent from reality so the
  // ceiling resumes from where the user actually is instead of snapping back.
  lenis.on('scroll', () => {
    if (lenis && !programmatic && lenis.isScrolling === 'native') {
      desired = lenis.animatedScroll;
      prevTarget = lenis.targetScroll;
    }
  });

  setPreFrame(tick);
}

// Window-level singleton: created once, resized per page, torn down on swap so
// the SPA router never leaves a Lenis bound to a replaced document.
document.addEventListener('astro:page-load', () => {
  init();
  lenis?.resize();
});
document.addEventListener('astro:before-swap', destroy);
init();
