'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface ResizeHandleProps {
  /**
   * `columns`: a vertical bar between the chat and the panel; the panel is
   * on the right, so dragging left grows it. `rows`: a horizontal bar above
   * the terminal drawer; dragging up grows it.
   */
  axis: 'columns' | 'rows';
  /** The element whose size is being set (the panel or the drawer). */
  targetRef: React.RefObject<HTMLElement | null>;
  /** The element the percentage is measured against. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Current size, in % of the container. */
  pct: number;
  minPct: number;
  maxPct: number;
  /** The smallest the other side may get, in px (keeps the chat usable). */
  minOtherPx: number;
  /** The smallest the target may get, in px. */
  minTargetPx: number;
  /** Save the final size. Called once, on release. */
  onCommit: (pct: number) => void;
  /** Double-click restores this size. */
  defaultPct: number;
  label: string;
}

/**
 * A drag handle for the workbench's two splits. While dragging it writes
 * the size straight to the target's style (so the chat and transcript don't
 * re-render every frame) and commits once on release. Pointer capture keeps
 * the drag alive over the preview iframe, which would otherwise swallow the
 * pointer. Arrow keys nudge it, and double-click resets it.
 */
export function ResizeHandle({
  axis,
  targetRef,
  containerRef,
  pct,
  minPct,
  maxPct,
  minOtherPx,
  minTargetPx,
  onCommit,
  defaultPct,
  label,
}: ResizeHandleProps) {
  const livePct = useRef(pct);
  useEffect(() => {
    livePct.current = pct;
  }, [pct]);

  const clamp = (value: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const total = rect ? (axis === 'columns' ? rect.width : rect.height) : 0;
    let lo = minPct;
    let hi = maxPct;
    if (total > 0) {
      lo = Math.max(lo, (minTargetPx / total) * 100);
      hi = Math.min(hi, 100 - (minOtherPx / total) * 100);
    }
    return Math.round(Math.min(hi, Math.max(lo, value)) * 10) / 10;
  };

  const apply = (value: number) => {
    const el = targetRef.current;
    if (!el) return;
    if (axis === 'columns') el.style.width = `${value}%`;
    else el.style.height = `${value}%`;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rect = container.getBoundingClientRect();
    let latest = livePct.current;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = axis === 'columns' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      const raw =
        axis === 'columns'
          ? ((rect.right - ev.clientX) / rect.width) * 100
          : ((rect.bottom - ev.clientY) / rect.height) * 100;
      latest = clamp(raw);
      apply(latest);
    };
    const onUp = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = '';
      onCommit(latest);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const grow = axis === 'columns' ? 'ArrowLeft' : 'ArrowUp';
    const shrink = axis === 'columns' ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    const next = clamp(livePct.current + (e.key === grow ? 2 : -2));
    apply(next);
    onCommit(next);
  };

  return (
    <div
      role="separator"
      aria-orientation={axis === 'columns' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={minPct}
      aria-valuemax={maxPct}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        const next = clamp(defaultPct);
        apply(next);
        onCommit(next);
      }}
      title="Drag to resize. Double-click to reset."
      className={cn(
        'group relative z-10 flex-shrink-0 bg-border outline-none transition-colors hover:bg-foreground/25 focus-visible:bg-ring',
        axis === 'columns' ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
      )}
    >
      {/* A wider invisible grab area around the 1px line. */}
      <span aria-hidden className={cn('absolute', axis === 'columns' ? 'inset-y-0 -left-1 -right-1' : 'inset-x-0 -bottom-1 -top-1')} />
    </div>
  );
}
