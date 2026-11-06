'use client';

import { useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tip } from '@/components/ui/tip';
import { cn } from '@/lib/utils';

interface StatusPillProps {
  label: string;
  count: number;
  icon: ReactNode;
  accentClass: string;
  countBgClass: string;
  headerBgClass?: string;
  action?: (close: () => void) => ReactNode;
  footer?: ReactNode;
  children: (close: () => void) => ReactNode;
}

/** The header's existing status pattern: a stable, dim zero or a live popover. */
export function StatusPill(props: StatusPillProps) {
  if (props.count === 0) {
    return (
      <span
        aria-label={`${props.label}: 0`}
        className="flex items-center gap-1 px-1.5 h-[18px] rounded text-[10px] opacity-30 select-none"
      >
        <span className="flex items-center justify-center [&_svg]:size-[10px]">
          {props.icon}
        </span>
        <span className="font-mono font-semibold tabular-nums text-muted-foreground">0</span>
      </span>
    );
  }
  return <ActiveStatusPill {...props} />;
}

function ActiveStatusPill({ label, count, icon, accentClass, countBgClass, headerBgClass, action, footer, children }: StatusPillProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Tip label={label}>
          <button
            type="button"
            aria-label={`${label}: ${count}`}
            className={cn(
              'flex items-center gap-1 px-1.5 h-[18px] rounded text-[10px] transition-[filter]',
              'hover:brightness-110 dark:hover:brightness-125',
              'data-[state=open]:brightness-110 dark:data-[state=open]:brightness-125',
              countBgClass,
            )}
          >
            <span className="flex items-center justify-center [&_svg]:size-[10px]">{icon}</span>
            <span className="font-mono font-semibold tabular-nums">{count}</span>
          </button>
        </Tip>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 p-0 overflow-hidden">
        <div className={cn('flex items-center gap-1.5 px-3 py-2 border-b border-border/40', headerBgClass)}>
          <span className="flex items-center justify-center">{icon}</span>
          <span className={cn('flex-1 text-[10.5px] font-bold uppercase tracking-[0.12em]', accentClass)}>{label}</span>
          <span className={cn('inline-flex items-center justify-center min-w-[18px] h-[16px] px-1.5 rounded-full text-[9.5px] font-bold font-mono tabular-nums', countBgClass)}>{count}</span>
          {action?.(close)}
        </div>
        <div className="max-h-[min(28rem,60dvh)] overflow-y-auto py-1">{children(close)}</div>
        {footer}
      </PopoverContent>
    </Popover>
  );
}
