'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { cn } from '@/lib/utils';
import { FIT_MARGIN, FIT_VIEW, ZOOM_STEP, clampView, clickZoom, fitScale, maxZoom, wheelPixels, wheelZoomFactor, zoomAround, zoomPercent, type Point, type Size, type ZoomView } from './image-zoom';

/**
 * Marks the element whose keys zoom the image inside it: the large preview
 * dialog and the view beside the chat. Focus anywhere in either (its header's
 * buttons included) reaches the image, as the arrow keys do.
 */
export const PREVIEW_KEY_SCOPE = 'data-preview-key-scope';

/** Keys typed into a field stay the field's. */
const TEXT_FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** How far a press moves before it pans instead of clicking. */
const DRAG_DISTANCE = 4;

type Limits = { fit: number; base: Size; box: Size };
type Gesture = {
  start: ZoomView;
  /** Where the pointer, or a pinch's middle, started. */
  from: Point;
  /** A pinch's starting finger distance. */
  distance?: number;
  /** Moved or pinched, so lifting it is not a click. */
  moved: boolean;
};

/** Safari's trackpad pinch, which it sends instead of a Ctrl+wheel. */
type SafariGesture = Event & { scale: number; clientX: number; clientY: number };

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * A full-size image that zooms as image viewers do. It opens fit to the
 * view. A click zooms in at the pointer (to the image's own size, or twice
 * fit when that is near fit) and another click goes back to fit. A pinch,
 * on a trackpad or a touch screen, and Ctrl or ⌘ with the wheel zoom at the
 * pointer. Zoomed in, dragging or scrolling moves the image, which always
 * keeps the view covered. The control at the bottom zooms out, in, and back
 * to fit, and so do −, + and 0 while focus is in the preview. Another file
 * (Previous, Next) opens fit again.
 */
export function ZoomableImage({ src, alt, onLoad, onError }: { src: string; alt: string; onLoad: () => void; onError: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Size | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [view, setView] = useState<ZoomView>(FIT_VIEW);
  // A click, a button or a key glides to its zoom. Wheels, pinches and
  // drags follow the hand directly.
  const [glide, setGlide] = useState(false);
  const [dragging, setDragging] = useState(false);

  const limits = useMemo<Limits | null>(() => {
    if (!box || !natural) return null;
    // An image with no size of its own (an SVG with only a viewBox) fills the view.
    const own = natural.width > 0 && natural.height > 0 ? natural : { width: Math.max(1, box.width - FIT_MARGIN * 2), height: Math.max(1, box.height - FIT_MARGIN * 2) };
    const fit = fitScale(own, box);
    return { fit, base: { width: own.width * fit, height: own.height * fit }, box };
  }, [box, natural]);
  // Resizing the window or the panel keeps the zoom and keeps the image in view.
  const shown = limits ? clampView(view, limits.base, limits.box) : view;

  // Handlers read the latest values without re-subscribing on every frame.
  const live = useRef({ view: shown, limits });
  useLayoutEffect(() => { live.current = { view: shown, limits }; });

  const apply = useCallback((next: ZoomView, glides: boolean) => {
    live.current.view = next;
    setGlide(glides);
    setView(next);
  }, []);

  /** A point on screen, from the view's center. */
  const toView = useCallback((clientX: number, clientY: number): Point => {
    const rect = rootRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }, []);

  const zoomBy = useCallback((factor: number, glides: boolean, at: Point = { x: 0, y: 0 }) => {
    const { view: current, limits: bounds } = live.current;
    if (bounds) apply(zoomAround(current, current.zoom * factor, at, at, bounds), glides);
  }, [apply]);

  const fit = useCallback(() => apply(FIT_VIEW, true), [apply]);

  // Its layout size, not its drawn one: the dialog opens with a small
  // scale animation, which ResizeObserver rightly ignores.
  useLayoutEffect(() => {
    const root = rootRef.current!;
    const measure = () => setBox(previous => previous?.width === root.clientWidth && previous.height === root.clientHeight ? previous : { width: root.clientWidth, height: root.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Wheel and Safari's pinch: listened for directly, since React's wheel
  // listener is passive and can't keep the browser from zooming the page.
  const pointers = useRef(new Map<number, Point>());
  useEffect(() => {
    const root = rootRef.current!;
    const onWheel = (event: WheelEvent) => {
      const { view: current, limits: bounds } = live.current;
      if (!bounds) return;
      if (event.ctrlKey || event.metaKey) {
        // A trackpad pinch arrives as a Ctrl+wheel in Chrome and Firefox.
        event.preventDefault();
        const at = toView(event.clientX, event.clientY);
        apply(zoomAround(current, current.zoom * wheelZoomFactor(wheelPixels(event.deltaY, event.deltaMode, bounds.box.height)), at, at, bounds), false);
        return;
      }
      if (current.zoom <= 1) return;
      event.preventDefault();
      const x = current.x - wheelPixels(event.deltaX, event.deltaMode, bounds.box.width);
      const y = current.y - wheelPixels(event.deltaY, event.deltaMode, bounds.box.height);
      apply(clampView({ zoom: current.zoom, x, y }, bounds.base, bounds.box), false);
    };
    let pinchFrom = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      pinchFrom = live.current.view.zoom;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const { view: current, limits: bounds } = live.current;
      // On a touch screen Safari sends these alongside the touches, which already zoom.
      if (!bounds || pointers.current.size) return;
      const gesture = event as SafariGesture;
      const at = toView(gesture.clientX, gesture.clientY);
      apply(zoomAround(current, pinchFrom * gesture.scale, at, at, bounds), false);
    };
    const preventPageZoom = (event: Event) => event.preventDefault();
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('gesturestart', onGestureStart);
    root.addEventListener('gesturechange', onGestureChange);
    root.addEventListener('gestureend', preventPageZoom);
    return () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('gesturestart', onGestureStart);
      root.removeEventListener('gesturechange', onGestureChange);
      root.removeEventListener('gestureend', preventPageZoom);
    };
  }, [apply, toView]);

  useEffect(() => {
    const root = rootRef.current!;
    const scope = root.closest<HTMLElement>(`[${PREVIEW_KEY_SCOPE}]`) ?? root;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest(TEXT_FIELD)) return;
      if (matchesHotkey(event, HOTKEYS.previewZoomIn) || matchesHotkey(event, HOTKEYS.previewZoomInEquals)) zoomBy(ZOOM_STEP, true);
      else if (matchesHotkey(event, HOTKEYS.previewZoomOut)) zoomBy(1 / ZOOM_STEP, true);
      else if (matchesHotkey(event, HOTKEYS.previewZoomFit)) fit();
      else return;
      event.preventDefault();
    };
    scope.addEventListener('keydown', onKey);
    return () => scope.removeEventListener('keydown', onKey);
  }, [zoomBy, fit]);

  // Pointers: one drags (or clicks), two pinch. Captured, so a drag that
  // leaves the view keeps going until it's let go.
  const gesture = useRef<Gesture | null>(null);
  const begin = (moved: boolean) => {
    const points = [...pointers.current.values()];
    const start = live.current.view;
    gesture.current = points.length >= 2
      ? { start, from: middle(points[0], points[1]), distance: distance(points[0], points[1]), moved: true }
      : points.length === 1 ? { start, from: points[0], moved } : null;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, toView(event.clientX, event.clientY));
    begin(false);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, toView(event.clientX, event.clientY));
    const current = gesture.current;
    const bounds = live.current.limits;
    if (!current || !bounds) return;
    const points = [...pointers.current.values()];
    if (current.distance && points.length >= 2) {
      const to = middle(points[0], points[1]);
      apply(zoomAround(current.start, current.start.zoom * distance(points[0], points[1]) / current.distance, current.from, to, bounds), false);
      return;
    }
    const dx = points[0].x - current.from.x;
    const dy = points[0].y - current.from.y;
    if (!current.moved && Math.hypot(dx, dy) < DRAG_DISTANCE) return;
    current.moved = true;
    if (current.start.zoom <= 1) return;
    setDragging(true);
    apply(clampView({ zoom: current.start.zoom, x: current.start.x + dx, y: current.start.y + dy }, bounds.base, bounds.box), false);
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointers.current.delete(event.pointerId)) return;
    const current = gesture.current;
    const bounds = live.current.limits;
    if (!cancelled && current && !current.moved && !pointers.current.size && bounds) {
      const { view: now } = live.current;
      const at = toView(event.clientX, event.clientY);
      apply(now.zoom > 1 ? FIT_VIEW : zoomAround(now, clickZoom(bounds.fit), at, at, bounds), true);
    }
    // The finger left after a pinch pans on from where it is, never clicks.
    begin(true);
    if (!pointers.current.size) setDragging(false);
  };

  const zoomed = shown.zoom > 1;
  const width = limits ? limits.base.width * shown.zoom : 0;
  const height = limits ? limits.base.height * shown.zoom : 0;
  return (
    <div ref={rootRef} className="group/zoom relative h-full w-full overflow-hidden">
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={event => end(event, false)}
        onPointerCancel={event => end(event, true)}
        // After a release this finds the pointer already gone. Losing it any
        // other way must not leave a stale finger to start the next pinch.
        onLostPointerCapture={event => end(event, true)}
        className={cn('absolute inset-0 touch-none select-none', !limits ? undefined : zoomed ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in')}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          decoding="async"
          onLoad={event => {
            setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
            onLoad();
          }}
          onError={onError}
          // Drawn at its zoomed size rather than scaled, so it stays sharp at every zoom.
          style={limits ? { width, height, transform: `translate(${shown.x - width / 2}px, ${shown.y - height / 2}px)` } : undefined}
          className={cn(
            'absolute left-1/2 top-1/2 max-w-none',
            !limits && 'invisible',
            glide && 'transition-[width,height,transform] duration-200 ease-out motion-reduce:transition-none',
          )}
        />
      </div>
      {limits && <ZoomControls percent={zoomPercent(limits.fit, shown.zoom)} zoomed={zoomed} atMost={shown.zoom >= maxZoom(limits.fit)} onZoom={factor => zoomBy(factor, true)} onFit={fit} />}
    </div>
  );
}

/**
 * −, the zoom as a percent of the image's own size, and +. The percent goes
 * back to fit. It shows while the pointer is over the image, while focus is
 * in it, always on a touch screen, and always while zoomed, so the way back
 * is in sight. A control at its end only looks unavailable (`aria-disabled`),
 * so focus stays on it and the keys go on working.
 */
function ZoomControls({ percent, zoomed, atMost, onZoom, onFit }: { percent: number; zoomed: boolean; atMost: boolean; onZoom: (factor: number) => void; onFit: () => void }) {
  const unavailable = 'aria-disabled:opacity-50 aria-disabled:hover:bg-transparent';
  return (
    <div
      role="group"
      aria-label="Zoom"
      className={cn(
        'absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-background/90 p-0.5 shadow-sm backdrop-blur transition-opacity',
        zoomed ? 'opacity-100' : 'opacity-0 group-hover/zoom:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100',
      )}
    >
      <Tip label="Zoom out" shortcut={HOTKEYS.previewZoomOut.label}>
        <Button variant="ghost" size="icon-xs" className={cn('rounded-full', unavailable)} aria-label="Zoom out" aria-disabled={!zoomed || undefined} onClick={() => { if (zoomed) onZoom(1 / ZOOM_STEP); }}><ZoomOut /></Button>
      </Tip>
      <Tip label="Fit to window" shortcut={HOTKEYS.previewZoomFit.label}>
        <button
          type="button"
          aria-label={`Fit to window, zoom ${percent}%`}
          aria-disabled={!zoomed || undefined}
          onClick={() => { if (zoomed) onFit(); }}
          className={cn('h-6 min-w-12 rounded-full px-1.5 text-center text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', 'aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground')}
        >
          {percent}%
        </button>
      </Tip>
      <Tip label="Zoom in" shortcut={HOTKEYS.previewZoomIn.label}>
        <Button variant="ghost" size="icon-xs" className={cn('rounded-full', unavailable)} aria-label="Zoom in" aria-disabled={atMost || undefined} onClick={() => { if (!atMost) onZoom(ZOOM_STEP); }}><ZoomIn /></Button>
      </Tip>
    </div>
  );
}
