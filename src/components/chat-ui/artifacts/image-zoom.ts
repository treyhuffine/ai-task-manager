/**
 * The geometry of a zoomable image preview (`zoomable-image.tsx`), kept pure
 * so it can be tested without a browser.
 *
 * The image is drawn at its fit size (the whole image inside the view, less
 * a margin) times `zoom`, so `zoom` 1 is fit. `x` and `y` move its center
 * from the view's center, in screen pixels. Points are measured the same
 * way: from the view's center.
 */

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type ZoomView = { zoom: number; x: number; y: number };

export const FIT_VIEW: ZoomView = { zoom: 1, x: 0, y: 0 };

/** Space kept around the image at fit, as the preview always had. */
export const FIT_MARGIN = 12;

/** How far one step of the buttons or keys zooms. */
export const ZOOM_STEP = 1.5;

/** How far the deepest zoom reaches, in the image's own pixels, and the least
 * it reaches past fit for an image that already fills the view. */
const MAX_ACTUAL = 8;
const MAX_PAST_FIT = 4;

/** The least a click zooms past fit, for an image already near its own size. */
const CLICK_PAST_FIT = 2;

/** The scale that fits the whole image in `box`: its own pixels times this.
 * A small image grows to fill the view, as the preview always drew it. */
export function fitScale(natural: Size, box: Size): number {
  if (natural.width <= 0 || natural.height <= 0) return 1;
  const width = Math.max(1, box.width - FIT_MARGIN * 2);
  const height = Math.max(1, box.height - FIT_MARGIN * 2);
  return Math.min(width / natural.width, height / natural.height);
}

export function maxZoom(fit: number): number {
  return Math.max(MAX_PAST_FIT, MAX_ACTUAL / fit);
}

/** Where a click zooms to from fit: the image's own size, or twice fit when
 * that is barely bigger (or smaller) than fit. */
export function clickZoom(fit: number): number {
  return Math.max(CLICK_PAST_FIT, 1 / fit);
}

/** The zoom as a percent of the image's own size, as image viewers show it. */
export function zoomPercent(fit: number, zoom: number): number {
  return Math.round(fit * zoom * 100);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Keep the image covering the view on each side it overflows, and centered
 * on each side it doesn't, so it can never be moved out of sight. */
export function clampView(view: ZoomView, base: Size, box: Size): ZoomView {
  const spanX = Math.max(0, (base.width * view.zoom - box.width) / 2);
  const spanY = Math.max(0, (base.height * view.zoom - box.height) / 2);
  // `+ 0` turns a -0 from clamping into 0, so a reset view compares equal.
  return { zoom: view.zoom, x: clamp(view.x, -spanX, spanX) + 0, y: clamp(view.y, -spanY, spanY) + 0 };
}

/** Zoom to `zoom`, moving the image point that was under `from` to `to`:
 * the pointer for a click or wheel (the same point), the view's center for
 * a button or key, a pinch's middle as the fingers move. */
export function zoomAround(view: ZoomView, zoom: number, from: Point, to: Point, limits: { fit: number; base: Size; box: Size }): ZoomView {
  const next = clamp(zoom, 1, maxZoom(limits.fit));
  const ratio = next / view.zoom;
  return clampView({ zoom: next, x: to.x - (from.x - view.x) * ratio, y: to.y - (from.y - view.y) * ratio }, limits.base, limits.box);
}

/** Pixels a wheel event moves, whatever unit the device reports it in. */
export function wheelPixels(delta: number, mode: number, page: number): number {
  return mode === 1 ? delta * 16 : mode === 2 ? delta * page : delta;
}

/** How much one wheel event zooms. A trackpad pinch sends many small
 * deltas, a mouse wheel one large one per notch: capping it keeps a notch
 * near a quarter. */
export function wheelZoomFactor(pixels: number): number {
  return Math.exp(-clamp(pixels, -25, 25) * 0.01);
}
