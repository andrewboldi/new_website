/**
 * Shared types for the per-project card background animations.
 *
 * Every animation is a lightweight Canvas2D routine. A `DrawFactory` is given a
 * 2D context plus sizing/color info and returns a `Drawer` whose `frame(t, dt)`
 * is called by the engine on each animation tick. The engine owns all rAF,
 * IntersectionObserver, fps-capping, reduced-motion and resize concerns — the
 * individual animations only ever describe *what* to paint.
 */

export interface CardFxColors {
  blue: string;
  blueSoft: string;
  cyan: string;
  cyanSoft: string;
  amber: string;
  ink: string;
  faint: string;
}

export interface CardFxCtx {
  ctx: CanvasRenderingContext2D;
  /** CSS pixel size of the canvas (already DPR-corrected in the backing store). */
  width: number;
  height: number;
  /** device pixel ratio actually used for the backing store */
  dpr: number;
  colors: CardFxColors;
  /** deterministic-ish per-card seed so repeated cards differ slightly */
  seed: number;
}

export interface Drawer {
  /**
   * Paint one frame.
   * @param t   seconds since this drawer started (monotonic-ish)
   * @param dt  seconds since the previous painted frame
   * @param hot 0..1 "intensity" — rises toward 1 while the card is hovered
   */
  frame(t: number, dt: number, hot: number): void;
  /** optional: react to a resize (new width/height already applied to ctx) */
  resize?(width: number, height: number): void;
  /** optional cleanup hook */
  dispose?(): void;
}

export type DrawFactory = (c: CardFxCtx) => Drawer;
