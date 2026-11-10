import { describe, expect, it } from 'vitest';
import { FIT_MARGIN, FIT_VIEW, clampView, clickZoom, fitScale, maxZoom, wheelPixels, wheelZoomFactor, zoomAround, zoomPercent } from './image-zoom';

// A 2400 by 1600 screenshot in a 1200 by 700 view: its height limits fit.
const natural = { width: 2400, height: 1600 };
const box = { width: 1200, height: 700 };
const fit = fitScale(natural, box);
const base = { width: natural.width * fit, height: natural.height * fit };
const limits = { fit, base, box };

describe('fitScale', () => {
  it('fits the whole image inside the view, less its margin', () => {
    expect(fit).toBeCloseTo((700 - FIT_MARGIN * 2) / 1600);
    expect(fitScale({ width: 4000, height: 100 }, box)).toBeCloseTo((1200 - FIT_MARGIN * 2) / 4000);
  });

  it('grows a small image to fill the view, as the preview always drew it', () => {
    expect(fitScale({ width: 120, height: 80 }, box)).toBeCloseTo((700 - FIT_MARGIN * 2) / 80);
  });

  it('leaves an image with no size of its own at 1', () => {
    expect(fitScale({ width: 0, height: 0 }, box)).toBe(1);
  });
});

describe('click zoom and limits', () => {
  it('zooms a large image to its own size and a small one to twice fit', () => {
    expect(clickZoom(fit)).toBeCloseTo(1 / fit);
    expect(zoomPercent(fit, clickZoom(fit))).toBe(100);
    expect(clickZoom(0.8)).toBe(2);
    expect(clickZoom(8)).toBe(2);
  });

  it('reaches 800% of the image, and at least 4 times fit', () => {
    expect(zoomPercent(fit, maxZoom(fit))).toBe(800);
    expect(maxZoom(8)).toBe(4);
  });
});

describe('zoomAround', () => {
  it('keeps the point under the pointer where it is', () => {
    const at = { x: 200, y: -100 };
    const zoomed = zoomAround(FIT_VIEW, 2, at, at, limits);
    // The image point under `at` before: (at - offset) / zoom, from the image center.
    const before = { x: (at.x - FIT_VIEW.x) / FIT_VIEW.zoom, y: (at.y - FIT_VIEW.y) / FIT_VIEW.zoom };
    expect(zoomed.zoom).toBe(2);
    expect(zoomed.x + before.x * zoomed.zoom).toBeCloseTo(at.x);
    expect(zoomed.y + before.y * zoomed.zoom).toBeCloseTo(at.y);
  });

  it('zooms about the center when the point is the center', () => {
    expect(zoomAround(FIT_VIEW, 3, { x: 0, y: 0 }, { x: 0, y: 0 }, limits)).toEqual({ zoom: 3, x: 0, y: 0 });
  });

  it('moves the point under a pinch along with the fingers', () => {
    const from = { x: 50, y: 40 };
    const to = { x: 90, y: 10 };
    const start = { zoom: 2, x: 0, y: 0 };
    const next = zoomAround(start, 3, from, to, limits);
    const point = { x: (from.x - start.x) / start.zoom, y: (from.y - start.y) / start.zoom };
    expect(next.x + point.x * next.zoom).toBeCloseTo(to.x);
    expect(next.y + point.y * next.zoom).toBeCloseTo(to.y);
  });

  it('never zooms out past fit or in past its limit, and fit is centered again', () => {
    const zoomed = zoomAround(FIT_VIEW, 4, { x: 300, y: 200 }, { x: 300, y: 200 }, limits);
    expect(zoomAround(zoomed, 0.1, { x: 300, y: 200 }, { x: 300, y: 200 }, limits)).toEqual(FIT_VIEW);
    expect(zoomAround(FIT_VIEW, 1000, { x: 0, y: 0 }, { x: 0, y: 0 }, limits).zoom).toBe(maxZoom(fit));
  });
});

describe('clampView', () => {
  it('keeps a zoomed image covering the view on each side it overflows', () => {
    const zoom = 3;
    const spanX = (base.width * zoom - box.width) / 2;
    const spanY = (base.height * zoom - box.height) / 2;
    expect(clampView({ zoom, x: 1e6, y: -1e6 }, base, box)).toEqual({ zoom, x: spanX, y: -spanY });
    expect(clampView({ zoom, x: 10, y: -10 }, base, box)).toEqual({ zoom, x: 10, y: -10 });
  });

  it('centers the image on a side it doesn\'t fill', () => {
    // A tall, narrow image zoomed a little still leaves room at the sides.
    const narrow = { width: 100, height: 676 };
    expect(clampView({ zoom: 1.5, x: 300, y: 300 }, narrow, box)).toEqual({ zoom: 1.5, x: 0, y: (676 * 1.5 - 700) / 2 });
    expect(clampView({ zoom: 1, x: -5, y: 5 }, base, box)).toEqual(FIT_VIEW);
  });
});

describe('wheel', () => {
  it('reads lines and pages as pixels', () => {
    expect(wheelPixels(3, 0, 700)).toBe(3);
    expect(wheelPixels(3, 1, 700)).toBe(48);
    expect(wheelPixels(1, 2, 700)).toBe(700);
  });

  it('zooms in for a pinch out (up the wheel) and out for a pinch in, a mouse notch by about a quarter', () => {
    expect(wheelZoomFactor(-4)).toBeGreaterThan(1);
    expect(wheelZoomFactor(4)).toBeLessThan(1);
    expect(wheelZoomFactor(-100)).toBeCloseTo(Math.exp(0.25));
    expect(wheelZoomFactor(100)).toBeCloseTo(Math.exp(-0.25));
  });
});
