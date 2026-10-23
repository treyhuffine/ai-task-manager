'use client';

import type { ComponentProps, ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RailIconButton } from '@/components/workspaces/rail-icon-button';
import { StripFlyout } from '@/components/workspaces/rail-flyout';
import { RailDot, RailCount, type RailTone } from '@/components/workspaces/rail-count';
import { RailFlyout } from '@/components/workspaces/rail-flyout';

export interface RailPlace {
  id: string;
  label: string;
  /** Tooltip in the collapsed strip, where only the icon shows. The wide
   *  rail's row shows `label` and needs none. */
  title: string;
  /** Its glyph: a Lucide icon, or `mark` for something drawn (an app's tile). */
  icon?: LucideIcon;
  mark?: ReactNode;
  /** Under the row above it (an app under Apps). Inset in the wide rail. */
  depth?: 0 | 1;
  onClick: () => void;
  /** The pointer or focus reached it: warm what it opens. */
  onIntent?: () => void;
  /** Showing now: its board, calendar or dialog is open. */
  active: boolean;
  /** Live count beside the label in the wide rail, a dot on the icon in the strip. */
  count?: number;
  /** What the count means: work in flight (blue) or something waiting on you (amber). */
  tone?: RailTone;
  /** Resting on the row peeks this beside the rail (Apps), in both rails. A click still goes where `onClick` goes. */
  flyout?: { label: string; content: ReactNode };
}

/** One row in the wide rail: a glyph, a label, and what's at its right. Spreads its props so a flyout can drive it. */
function RailRow({
  place: { label, icon: Icon, mark, depth, onClick, onIntent, active, count, tone = 'live', flyout },
  pressed = false,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'children'> & { place: RailPlace; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      aria-current={active ? 'page' : undefined}
      {...props}
      className={cn(
        'w-full flex items-center gap-2 py-1.5 pr-2 rounded-md text-[12px] font-medium transition-colors',
        depth === 1 ? 'pl-[22px]' : 'pl-2',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active || pressed ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
        className,
      )}
    >
      {mark ?? (Icon && <Icon size={14} className="flex-shrink-0" />)}
      <span className="truncate">{label}</span>
      {count !== undefined && <RailCount count={count} tone={tone} className="ml-auto" />}
      {flyout && (
        <ChevronRight
          size={13}
          aria-hidden
          className={cn('flex-shrink-0 text-muted-foreground/50', count === undefined && 'ml-auto')}
        />
      )}
    </button>
  );
}

/** Rows for the wide rail: the places, or the verbs. */
export function RailRows({ places, label, expanded = true }: { places: readonly RailPlace[]; label: string; expanded?: boolean }) {
  if (!expanded) return <nav aria-label={label} className="flex flex-col items-center gap-0.5">
    {places.map(({ id, title, icon, mark, onClick, onIntent, active, count, tone = 'live', flyout }) => {
      const badge = count !== undefined ? <RailDot tone={tone} /> : undefined;
      return flyout ? <StripFlyout key={id} icon={icon} mark={mark} label={title} contentLabel={flyout.label} onClick={onClick} onIntent={onIntent} active={active} badge={badge}>{flyout.content}</StripFlyout>
        : <RailIconButton key={id} icon={icon} mark={mark} label={title} onClick={onClick} onPointerEnter={onIntent} onFocus={onIntent} active={active} badge={badge}/>;
    })}
  </nav>;
  return (
    <nav aria-label={label} className="flex flex-col gap-0.5 px-2 pt-1 pb-1.5">
      {places.map((place) =>
        place.flyout ? (
          <RailFlyout
            key={place.id}
            contentLabel={place.flyout.label}
            onClick={place.onClick}
            trigger={({ ref, open }) => <RailRow ref={ref} place={place} pressed={open} onClick={undefined} />}
          >
            {place.flyout.content}
          </RailFlyout>
        ) : (
          <RailRow key={place.id} place={place} />
        ),
      )}
    </nav>
  );
}



/** Common rail structure. Context supplies places, lists and account controls. */
export function RailLayout({ header, actions, children, footer }: { header: ReactNode; actions?: ReactNode; children: ReactNode; footer: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col">{header}{actions}<div aria-hidden className="mx-3 h-px shrink-0 bg-border/50"/><div className="min-h-0 flex-1 overflow-y-auto pb-4">{children}</div>{footer}</div>;
}

/** Same width and overflow contract in personal and Team Homes. */
export function RailContainer({ expanded, compact, children }: { expanded: boolean; compact?: boolean; children: ReactNode }) {
  return <aside className={cn('relative z-30 flex shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 ease-out', expanded ? 'w-[256px]' : 'w-[44px]')} data-compact={compact || undefined} data-expanded={expanded || undefined}>{children}</aside>;
}
