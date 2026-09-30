'use client';

import type { ReactNode } from 'react';
import { Check, Timer } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useInactivity, useSetInactiveAfterDays } from '@/hooks/use-inactivity';
import { useFoldShown } from '@/lib/client/rail-fold';
import {
  DEFAULT_INACTIVE_AFTER_DAYS,
  formatInactiveAfter,
  INACTIVE_AFTER_PRESETS,
} from '@/lib/sessions/inactive';
import { cn } from '@/lib/utils';
import { FoldRow } from './fold-row';

/**
 * The foot of a list section: "N inactive hidden" with Show, folded by
 * default. The toggle shows or hides that section's inactive executions in
 * place (each section remembers its own choice), and the timer beside it
 * changes when executions go inactive, for the whole app. Renders nothing
 * when the section has none.
 *
 * `children` are the inactive rows, already rendered by the section in its
 * own row component. They show dimmed, so the section still reads as its
 * active work first.
 */
export function InactiveFold({
  sectionId,
  count,
  children,
  className,
  rowClassName,
  touch = false,
}: {
  /** Stable id for this section's show/hide memory, e.g. `agent:<id>` or `status:unread`. */
  sectionId: string;
  count: number;
  children: ReactNode;
  className?: string;
  /** On the toggle itself, e.g. a height that matches the rows it folds. */
  rowClassName?: string;
  /** Phone sizing: a taller row and the timer always visible, since nothing hovers. */
  touch?: boolean;
}) {
  const [shown, setShown] = useFoldShown(`inactive:${sectionId}`);
  if (count === 0) return null;
  return (
    <div>
      <FoldRow
        count={count}
        noun="inactive"
        shown={shown}
        onToggle={() => setShown(!shown)}
        touch={touch}
        className={className}
        rowClassName={rowClassName}
        accessory={
          <InactiveAfterPopover
            className={
              touch
                ? 'p-2'
                : 'opacity-0 group-hover/fold:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100'
            }
            size={touch ? 14 : 11}
          />
        }
      />
      {shown && <div className={cn('mt-0.5', touch ? 'space-y-1' : 'space-y-0.5')}>{children}</div>}
    </div>
  );
}

/**
 * The timer button and its popover: when executions go inactive, for the
 * whole app, including never. Shared by every fold row.
 */
export function InactiveAfterPopover({ className, size = 11 }: { className?: string; size?: number }) {
  const { stored } = useInactivity();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="When executions go inactive"
          title="When executions go inactive"
          className={cn(
            'flex-shrink-0 rounded p-1 text-muted-foreground/60 transition-opacity hover:bg-muted/40 hover:text-foreground',
            className,
          )}
        >
          <Timer size={size} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-60 p-1" onClick={(e) => e.stopPropagation()}>
        <InactiveAfterOptions stored={stored} />
      </PopoverContent>
    </Popover>
  );
}

function InactiveAfterOptions({ stored }: { stored: number | null | undefined }) {
  const set = useSetInactiveAfterDays();
  // The effective choice: null means the default, so the default row is checked.
  const current = stored === undefined ? undefined : stored ?? DEFAULT_INACTIVE_AFTER_DAYS;
  const presets = INACTIVE_AFTER_PRESETS.includes(current ?? -1) || current === undefined || current === 0
    ? INACTIVE_AFTER_PRESETS
    : [...INACTIVE_AFTER_PRESETS, current].sort((a, b) => a - b);
  const choose = (days: number) => {
    // Picking the default stores null, so a later change of default applies.
    set.mutate(days === DEFAULT_INACTIVE_AFTER_DAYS ? null : days);
  };
  return (
    <div>
      <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Go inactive after
      </div>
      {presets.map((days) => (
        <Option key={days} active={current === days} onClick={() => choose(days)}>
          {formatInactiveAfter(days)} with no activity
          {days === DEFAULT_INACTIVE_AFTER_DAYS && <span className="text-muted-foreground/60"> (default)</span>}
        </Option>
      ))}
      <Option active={current === 0} onClick={() => set.mutate(0)}>
        Never
      </Option>
      <p className="px-2 pb-1.5 pt-1 text-[10.5px] leading-snug text-muted-foreground/70">
        Applies across Ri. Inactive executions fold to the bottom of each list. Nothing is archived, and new activity brings one back.
      </p>
    </div>
  );
}

function Option({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
        active ? 'bg-primary/10 text-foreground' : 'text-foreground/85 hover:bg-muted/60',
      )}
    >
      <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center">
        {active && <Check size={12} className="text-primary" strokeWidth={3} />}
      </span>
      <span>{children}</span>
    </button>
  );
}
