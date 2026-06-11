/**
 * Pinned horizontal-scroll gallery controller for the Work page.
 *
 * Maps vertical scroll over a tall outer section onto a horizontal translateX
 * of an inner card track, with inertial LERP smoothing (never 1:1 jank).
 * Drives, each rAF:
 *   - track translateX  (eased glide)
 *   - scroll velocity    -> a tasteful skew/streak that settles when you pause
 *   - per-card reveal    -> `.is-focused` as a card's centre crosses mid-viewport
 *                            (CSS does the mask-wipe + stagger + blur->sharp)
 *   - a progress rail    -> "NN / total" index + scrub-bar width
 *
 * Zero dependencies: rAF only. Honors prefers-reduced-motion (caller decides
 * not to start us; we also bail defensively). Pauses its loop offscreen.
 */

export interface HScrollController {
  destroy(): void;
}

interface El {
  section: HTMLElement; // tall outer, provides scroll length
  sticky: HTMLElement; // position:sticky; height:100svh
  viewport: HTMLElement; // clips the track horizontally
  track: HTMLElement; // flex row, transformed in X
  cards: HTMLElement[];
  railFill: HTMLElement | null;
  railIndex: HTMLElement | null;
  railTotal: HTMLElement | null;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function startWorkHScroll(root: ParentNode = document): HScrollController | null {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const section = root.querySelector<HTMLElement>('[data-hscroll]');
  if (reduced || !section) return null;

  const sticky = section.querySelector<HTMLElement>('[data-hscroll-sticky]');
  const viewport = section.querySelector<HTMLElement>('[data-hscroll-viewport]');
  const track = section.querySelector<HTMLElement>('[data-hscroll-track]');
  if (!sticky || !viewport || !track) return null;

  const el: El = {
    section,
    sticky,
    viewport,
    track,
    cards: Array.from(track.querySelectorAll<HTMLElement>('.proj')),
    railFill: section.querySelector<HTMLElement>('[data-rail-fill]'),
    railIndex: section.querySelector<HTMLElement>('[data-rail-index]'),
    railTotal: section.querySelector<HTMLElement>('[data-rail-total]'),
  };

  // --- live geometry (recomputed on resize + filter changes) ---
  // All layout reads happen HERE, never in the rAF loop, so the loop forces
  // zero reflow (buttery; never competes with the WebGL/cardfx frame).
  let viewportW = 0;
  let maxShift = 0; // px the track can travel left
  let scrollRange = 1; // px of vertical scroll that maps to full travel
  let sectionTop = 0;
  let trackPadLeft = 0; // track content offset inside the viewport
  let sectionH = 0; // section's pinned-section content height (for withinView)
  // cached per-visible-card geometry: centre within the track + half width
  let geo: { centre: number; half: number; el: HTMLElement }[] = [];

  function visibleCards(): HTMLElement[] {
    return el.cards.filter((c) => !c.classList.contains('proj--out'));
  }

  function measure() {
    viewportW = el.viewport.clientWidth;
    // scrollWidth includes the track's trailing padding so the last card clears
    maxShift = Math.max(0, el.track.scrollWidth - viewportW);
    // Section is tall enough to scrub the whole track at a comfortable pace.
    // height = maxShift + one viewport (set in JS so it tracks content/filters).
    const stickyH = el.sticky.offsetHeight || window.innerHeight;
    el.section.style.height = `${maxShift + stickyH}px`;
    sectionH = el.section.offsetHeight;
    scrollRange = Math.max(1, sectionH - stickyH);
    const rect = el.section.getBoundingClientRect();
    sectionTop = rect.top + window.scrollY;
    // viewport's left edge relative to the page (track lives inside it)
    trackPadLeft = el.viewport.getBoundingClientRect().left;
    // cache each visible card's centre offset within the track + its half-width
    const cards = visibleCards();
    geo = cards.map((c) => ({
      el: c,
      centre: c.offsetLeft + c.offsetWidth / 2,
      half: c.offsetWidth / 2,
    }));
    if (el.railTotal) el.railTotal.textContent = String(cards.length).padStart(2, '0');
  }

  // --- animation state ---
  let target = 0; // 0..1 raw scroll progress
  let current = 0; // 0..1 eased
  let lastTarget = 0;
  let vel = 0; // eased signed velocity
  let lastFocused = -1;
  let raf = 0;
  let running = false;

  function computeTarget() {
    const y = window.scrollY;
    target = clamp((y - sectionTop) / scrollRange, 0, 1);
  }

  // reflow-free: compare cached scroll geometry to scrollY
  function withinView(): boolean {
    const top = sectionTop - window.scrollY;
    return top + sectionH > 0 && top < window.innerHeight;
  }

  // reflow-free reveal: a card's on-screen centre is derived analytically from
  // the current track translateX (x) — no getBoundingClientRect per frame.
  function updateReveal(x: number) {
    const mid = window.innerWidth / 2;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < geo.length; i++) {
      const g = geo[i];
      const centre = trackPadLeft + g.centre + x; // on-screen centre
      const dist = Math.abs(centre - mid);
      // a card "focuses" once its centre is within ~62% of its half-width of mid
      g.el.classList.toggle('is-focused', dist < g.half * 1.24);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best !== lastFocused) {
      lastFocused = best;
      if (el.railIndex) el.railIndex.textContent = String(best + 1).padStart(2, '0');
    }
  }

  const tick = () => {
    raf = requestAnimationFrame(tick);
    computeTarget();

    // inertial glide toward target (buttery, never 1:1)
    current += (target - current) * 0.085;

    // signed velocity, eased; drives skew/streak then settles to 0 when paused
    const rawVel = target - lastTarget;
    lastTarget = target;
    vel += (rawVel - vel) * 0.18;
    // clamp the felt velocity so a hard flick never nauseates
    const feltVel = clamp(vel * 14, -1, 1);

    const x = -current * maxShift;
    // skew is subtle (max ~3.2deg) and proportional to travel speed
    const skew = feltVel * 3.2;
    el.track.style.transform = `translate3d(${x.toFixed(2)}px,0,0) skewX(${skew.toFixed(3)}deg)`;
    // expose magnitude for the CSS-driven velocity streak/scrim on the track
    el.section.style.setProperty('--vel', Math.abs(feltVel).toFixed(3));

    if (el.railFill) el.railFill.style.transform = `scaleX(${current.toFixed(4)})`;

    updateReveal(x);

    // sleep the loop once motion has settled & we're offscreen
    if (!withinView() && Math.abs(target - current) < 0.0002 && Math.abs(vel) < 0.0002) {
      running = false;
      cancelAnimationFrame(raf);
    }
  };

  function wake() {
    if (running) return;
    running = true;
    lastTarget = (() => {
      computeTarget();
      return target;
    })();
    raf = requestAnimationFrame(tick);
  }

  // --- listeners ---
  const onScroll = () => wake();
  const onResize = () => {
    measure();
    wake();
  };
  // re-measure when the filter changes the set of cards (custom event from the page)
  const onFilter = () => {
    // wait one frame for layout (display:none collapses) to settle
    requestAnimationFrame(() => {
      measure();
      wake();
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  el.section.addEventListener('work:filter', onFilter as EventListener);

  // fonts/images can shift track width after first paint
  if (document.fonts?.ready) document.fonts.ready.then(() => onResize());

  measure();
  wake();

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      el.section.removeEventListener('work:filter', onFilter as EventListener);
      el.section.style.height = '';
      el.track.style.transform = '';
      el.cards.forEach((c) => c.classList.remove('is-focused'));
    },
  };
}
