'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Shared composer composition. Contextual controls supply only the allowed actions. */
export function ChatComposer({ children, disabled, hint, status, statusIsError }: {
  children: ReactNode;
  disabled?: boolean;
  hint?: ReactNode;
  status?: ReactNode;
  statusIsError?: boolean;
}) {
  return <div className="mx-auto w-full max-w-3xl shrink-0 px-5 pb-3">
    <div className={cn('flex flex-col gap-1 rounded-xl border border-border bg-card transition-colors focus-within:border-primary/50', disabled && 'opacity-60')}>
      {children}
    </div>
    <div className="mt-1 flex min-h-[14px] items-center justify-between gap-2 px-1">
      <span className="hidden text-[10px] text-muted-foreground/60 sm:inline">{hint}</span>
      {status && <span role={statusIsError ? 'alert' : 'status'} className={cn('text-[10px]', statusIsError ? 'text-destructive' : 'text-muted-foreground/70')}>{status}</span>}
    </div>
  </div>;
}
