'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-to-resize for floating panels (slideouts, drawers, sidebars).
 *
 * Unlike react-resizable-panels (which splits a container and shrinks siblings),
 * this returns a single size that the caller applies to its own element — leaving
 * surrounding layout untouched. Use it for overlays drawn on top of the main UI.
 *
 * Behavior:
 *   - Pointer-event based (mouse, touch, pen)
 *   - Clamps against [min, max] AND the current viewport, so a slideout sized on
 *     a wide monitor doesn't overflow when the window is resized smaller or moved
 *     to a smaller screen.
 *   - Optional localStorage persistence, debounced so a single drag doesn't write
 *     hundreds of times.
 */

type Edge = 'left' | 'right' | 'top' | 'bottom';

interface UseDragResizeOptions {
  /** Which edge of the resized panel hosts the handle. Determines axis + direction. */
  edge: Edge;
  min: number;
  max: number;
  defaultSize: number;
  /** localStorage key. Omit to disable persistence. */
  storageKey?: string;
}

interface UseDragResizeReturn {
  size: number;
  isResizing: boolean;
  handleResizeStart: (e: React.PointerEvent) => void;
}

const WRITE_DEBOUNCE_MS = 300;
const VIEWPORT_MARGIN = 0;

function isHorizontal(edge: Edge): boolean {
  return edge === 'left' || edge === 'right';
}

function viewportLimit(edge: Edge): number {
  if (typeof window === 'undefined') return Infinity;
  return (isHorizontal(edge) ? window.innerWidth : window.innerHeight) - VIEWPORT_MARGIN;
}

function clamp(value: number, min: number, max: number, edge: Edge): number {
  const effectiveMax = Math.min(max, viewportLimit(edge));
  const effectiveMin = Math.min(min, effectiveMax);
  return Math.min(effectiveMax, Math.max(effectiveMin, value));
}

function readStored(key: string | undefined, fallback: number, edge: Edge, min: number, max: number): number {
  if (!key || typeof window === 'undefined') return clamp(fallback, min, max, edge);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return clamp(fallback, min, max, edge);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return clamp(fallback, min, max, edge);
    return clamp(parsed, min, max, edge);
  } catch {
    return clamp(fallback, min, max, edge);
  }
}

export function useDragResize({
  edge,
  min,
  max,
  defaultSize,
  storageKey,
}: UseDragResizeOptions): UseDragResizeReturn {
  const [size, setSize] = useState<number>(() =>
    readStored(storageKey, defaultSize, edge, min, max),
  );
  const [isResizing, setIsResizing] = useState(false);

  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    (next: number) => {
      if (!storageKey || typeof window === 'undefined') return;
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
      writeTimerRef.current = setTimeout(() => {
        try {
          window.localStorage.setItem(storageKey, String(next));
        } catch {
          /* quota or unavailable — drop the write */
        }
      }, WRITE_DEBOUNCE_MS);
    },
    [storageKey],
  );

  // Re-clamp when the viewport shrinks (window resize, monitor change).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      setSize((current) => {
        const clamped = clamp(current, min, max, edge);
        if (clamped !== current) persist(clamped);
        return clamped;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [edge, min, max, persist]);

  useEffect(() => {
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    };
  }, []);

  const handleResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const horizontal = isHorizontal(edge);
      const startPos = horizontal ? e.clientX : e.clientY;
      const startSize = size;
      // For handles on the LEFT edge of a right-anchored panel: moving left grows it
      // (delta = start - current). For handles on the RIGHT edge of a left-anchored
      // panel: moving right grows it (delta = current - start). Same idea on the
      // vertical axis: top-edge handles invert, bottom-edge handles don't.
      const invert = edge === 'left' || edge === 'top';

      const handleMove = (ev: PointerEvent) => {
        const current = horizontal ? ev.clientX : ev.clientY;
        const delta = invert ? startPos - current : current - startPos;
        const next = clamp(startSize + delta, min, max, edge);
        setSize(next);
        persist(next);
      };

      const handleUp = () => {
        setIsResizing(false);
        document.removeEventListener('pointermove', handleMove);
        document.removeEventListener('pointerup', handleUp);
        document.removeEventListener('pointercancel', handleUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('pointermove', handleMove);
      document.addEventListener('pointerup', handleUp);
      document.addEventListener('pointercancel', handleUp);
    },
    [edge, min, max, size, persist],
  );

  return { size, isResizing, handleResizeStart };
}
