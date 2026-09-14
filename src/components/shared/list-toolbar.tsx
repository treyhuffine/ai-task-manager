"use client";

/**
 * Shared control row for the tasks and notes list surfaces.
 *
 * Both lists used to hand-roll their own toolbar with one-off pixel sizes
 * (`text-[8.5px]`, `p-1.5`, `text-xs`), so the two drifted and every control
 * was a slightly different size. This module is the single source of truth for
 * that row: consistent sizing off the design-system `buttonVariants`, and a
 * primary segmented control that stays usable as the panel narrows.
 *
 * Responsiveness keys off the PANEL, not the viewport. The lists render inside
 * a multi-panel dashboard where a panel is a fraction of the window, so
 * viewport breakpoints (`md:`) fire at the wrong moments — a wide window can
 * still hold a cramped panel. `ListToolbar` opens a named container (`@.../lt`)
 * and the controls collapse against it with container queries.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The control row. Owns the container context the controls collapse against. */
export function ListToolbar({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        '@container/lt flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-1.5 flex-shrink-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Shared trigger/toggle sizing. Every non-segmented control in the row (filter
 * menu, sort menu, decisions/archived toggles) uses this so heights, radius and
 * icon sizes match. `active` gives the accented, "this is doing something" look.
 */
export function toolbarButtonClass({ active, className }: { active?: boolean; className?: string } = {}) {
  return cn(
    buttonVariants({ variant: 'outline', size: 'sm' }),
    'gap-1.5 rounded-lg text-xs font-medium',
    active && 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15',
    className,
  );
}

/** Small dot that flags a filter as active when its label is hidden for space. */
export function ToolbarActiveDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-1.5 shrink-0 rounded-full bg-primary', className)}
    />
  );
}

/** Icon-only search button, right-pinned by convention. */
export function ToolbarSearchButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(buttonVariants({ variant: 'outline', size: 'icon-sm' }), 'rounded-lg')}
    >
      <Search className="size-3.5" />
    </button>
  );
}

/** A pressable filter toggle (Decisions, Archived) with the shared sizing. */
export function ToolbarToggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={toolbarButtonClass({ active, className: 'uppercase tracking-wide' })}
    >
      {children}
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Optional trailing count (task lanes). Zero and nullish render nothing. */
  count?: number | null;
}

/**
 * The primary filter as a segmented control (task lanes, note statuses). It is
 * always visible and single-select. When the options can't fit the panel it
 * scrolls horizontally with edge fades signalling more, rather than clipping or
 * vanishing behind a breakpoint. This replaces the old desktop `hidden md:flex`
 * segment plus its duplicate mobile scroller.
 */
export function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  grow = true,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<SegmentOption<T>>;
  ariaLabel: string;
  /** Fill available width and scroll when cramped (primary filter). When false,
   *  the control is content-width — for compact toggles like List/Board. */
  grow?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setEdges({
      left: scrollLeft > 1,
      right: scrollLeft + clientWidth < scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [measure, options.length]);

  // Keep the active tab in view when it changes off-screen (e.g. after scroll).
  useEffect(() => {
    const el = scrollRef.current;
    const active = el?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  const mask = edgeMask(edges.left, edges.right);

  return (
    <div className={cn('relative flex min-w-0', grow && 'flex-1')}>
      <div
        ref={scrollRef}
        role="group"
        aria-label={ariaLabel}
        className="no-scrollbar overflow-x-auto"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        <div className="flex w-max items-center gap-0.5 rounded-lg bg-muted/70 p-0.5">
          {options.map((opt) => {
            const isActive = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                data-active={isActive}
                aria-pressed={isActive}
                onClick={() => onChange(opt.value)}
                className={cn(
                  'inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
                {opt.count != null && opt.count > 0 && (
                  <span className={cn('tabular-nums', isActive ? 'opacity-70' : 'opacity-50')}>
                    {opt.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * A CSS mask that fades whichever edges can still be scrolled, so hidden tabs
 * are discoverable without matching the toolbar's translucent background.
 */
function edgeMask(left: boolean, right: boolean): string | undefined {
  if (!left && !right) return undefined;
  const l = left ? '24px' : '0px';
  const r = right ? '24px' : '0px';
  return `linear-gradient(to right, transparent 0, #000 ${l}, #000 calc(100% - ${r}), transparent 100%)`;
}
