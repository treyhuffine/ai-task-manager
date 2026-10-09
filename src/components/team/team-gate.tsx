'use client';

import type { ReactNode } from 'react';
import { APP_NAME } from '@/constants/app';

/**
 * The calm, centered frame a team shows before someone is in: signed out,
 * joining, signing in elsewhere, or finishing setup.
 */
export function TeamGate({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-[400px]">
        <p className="mb-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{APP_NAME}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <div className="mt-4 space-y-4 text-sm text-muted-foreground">{children}</div>
        {footer && <div className="mt-8 text-xs text-muted-foreground/80">{footer}</div>}
      </div>
    </main>
  );
}

export function GateField({
  id,
  label,
  hint,
  ...input
}: React.ComponentProps<'input'> & { id: string; label: string; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        {...input}
        className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-ring/40"
      />
      {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export function GateButton({ busy, children, ...button }: React.ComponentProps<'button'> & { busy?: boolean }) {
  return (
    <button
      {...button}
      disabled={button.disabled || busy}
      className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {busy ? 'One moment…' : children}
    </button>
  );
}

export function GateNotice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        tone === 'error'
          ? 'rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300'
          : 'rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground'
      }
    >
      {children}
    </p>
  );
}
