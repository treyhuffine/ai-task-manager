'use client';

import type { ComponentProps, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';

/**
 * An icon button in the collapsed strip (and the wide rail's collapse
 * toggle). The tooltip names it. Extra button props pass through, so it can
 * be a popover trigger. `mark` draws in place of the icon (an app's tile).
 */
export function RailIconButton({
  icon: Icon,
  mark,
  label,
  shortcut,
  hideTip = false,
  active = false,
  badge,
  className,
  'aria-label': ariaLabel,
  ...props
}: Omit<ComponentProps<'button'>, 'children' | 'title'> & {
  icon?: LucideIcon;
  mark?: ReactNode;
  /** Tooltip. Doubles as the accessible name unless `aria-label` is set. */
  label: string;
  /** Shown in the tooltip, e.g. `HOTKEYS.toggleRail.label`. */
  shortcut?: string;
  /** No tooltip, e.g. while the button's own card is open. */
  hideTip?: boolean;
  active?: boolean;
  /** Drawn on the icon's top-right corner. */
  badge?: ReactNode;
}) {
  return (
    <Tip label={hideTip ? undefined : label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={ariaLabel ?? label}
        aria-current={active ? 'page' : undefined}
        {...props}
        className={cn(
          'relative flex-shrink-0 p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          active
            ? 'bg-muted/60 text-foreground'
            : 'text-muted-foreground/80 hover:text-foreground hover:bg-muted/50',
          className,
        )}
      >
        {mark ?? (Icon && <Icon size={14} />)}
        {badge}
      </button>
    </Tip>
  );
}
