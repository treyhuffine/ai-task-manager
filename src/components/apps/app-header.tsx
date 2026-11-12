'use client';

import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The header the library's surfaces share, in the shape of the agent and
 * skill headers: a mark, a name, one quiet line under it, and the actions at
 * the right. `onBack` is the way to the library, kept for every layout since
 * the phone hides the top bar here.
 */
export function AppHeader({
  onBack,
  mark,
  title,
  subtitle,
  children,
}: {
  onBack?: () => void;
  mark: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="@container min-w-0 flex-shrink-0 border-b border-border">
      <div className="flex min-w-0 items-center gap-3 px-4 py-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="-ml-1.5 flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <ArrowLeft size={12} aria-hidden />
            Apps
          </button>
        )}
        {mark}
        <div className="min-w-0">
          <h1 className="truncate text-[13px] font-semibold text-foreground">{title}</h1>
          {subtitle && <div className="truncate text-[10.5px] text-muted-foreground/75">{subtitle}</div>}
        </div>
        <div className="flex-1" />
        <div className="flex flex-shrink-0 items-center gap-1.5">{children}</div>
      </div>
    </header>
  );
}

/** The header's primary verb: the one thing this surface is for. */
export function PrimaryAction({
  icon,
  children,
  className,
  ...props
}: React.ComponentProps<'button'> & { icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** A quiet labeled action beside the primary one, or a toggle when `pressed` is set. */
export function QuietAction({
  icon,
  pressed,
  children,
  className,
  ...props
}: React.ComponentProps<'button'> & { icon?: ReactNode; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      {...props}
      className={cn(
        'flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        pressed
          ? 'border-border bg-secondary text-foreground'
          : 'border-border/70 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
