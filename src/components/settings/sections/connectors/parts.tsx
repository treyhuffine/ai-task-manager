'use client';

/**
 * Shared building blocks for the Connectors pane: the catalog tile, the
 * drill-in chrome (back link + detail header), and the small labels both views
 * use. Kept presentational so the pane's state and API calls stay in
 * `connectors-section.tsx`.
 */
import type { ReactNode } from 'react';
import { ArrowLeft, ChevronRight, Loader2, Server } from 'lucide-react';
import { HOTKEYS } from '@/constants/commands';
import { cn } from '@/lib/utils';

export type Tone = 'ok' | 'warn' | 'error' | 'off';

const DOT: Record<Tone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-destructive',
  off: 'bg-muted-foreground/40',
};

const CHIP: Record<Tone | 'neutral', string> = {
  ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  error: 'bg-destructive/10 text-destructive',
  off: 'bg-muted text-muted-foreground',
  neutral: 'bg-muted/70 text-muted-foreground',
};

/** Small uppercase label over a group of tiles or a detail section. */
export function GroupHeading({
  children,
  count,
  action,
}: {
  children: ReactNode;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
        {typeof count === 'number' && (
          <span className="ml-1.5 font-medium tabular-nums text-muted-foreground/60">{count}</span>
        )}
      </h3>
      {action}
    </div>
  );
}

/** Rounded pill for status and facts in a detail header or account row. */
export function Chip({ tone = 'neutral', children }: { tone?: Tone | 'neutral'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        CHIP[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * One catalog entry. The whole tile is the button, so there is exactly one
 * thing to do with it: open the connector's detail view, where every action
 * lives. A status dot next to the name carries connection health.
 */
export function CatalogTile({
  logo,
  name,
  subtitle,
  tone,
  toneLabel,
  onOpen,
}: {
  logo: ReactNode;
  name: string;
  subtitle?: ReactNode;
  tone?: Tone;
  /** Spoken + hover text for the status dot. */
  toneLabel?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card/20 p-3 text-left transition-colors hover:border-foreground/15 hover:bg-muted/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {logo}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          {tone && (
            <span className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} title={toneLabel}>
              <span className="sr-only">{toneLabel}</span>
            </span>
          )}
        </div>
        {subtitle && <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{subtitle}</p>}
      </div>
      <ChevronRight
        size={14}
        className="shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground/70"
      />
    </button>
  );
}

/**
 * Top row of a detail view: the way back to the catalog (Esc does the same) and,
 * while a request is in flight, a quiet working indicator that never shifts the
 * layout below it.
 */
export function BackLink({ onBack, busy = false }: { onBack: () => void; busy?: boolean }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-2">
      <button
        type="button"
        onClick={onBack}
        title={`Back to all connectors (${HOTKEYS.slideoutBack.label})`}
        className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={12} /> All connectors
      </button>
      {busy && (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Working…
        </span>
      )}
    </div>
  );
}

/** Logo, name, and one line of context at the top of a detail view. */
export function DetailHeader({
  logo,
  title,
  subtitle,
  meta,
  actions,
}: {
  logo: ReactNode;
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3.5">
      {logo}
      <div className="min-w-0 flex-1 space-y-0.5">
        <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
        {subtitle && <div className="text-xs leading-snug text-muted-foreground">{subtitle}</div>}
        {meta && <div className="flex flex-wrap items-center gap-1.5 pt-1.5">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Stand-in logo for MCP servers, which have no brand mark. Matches ConnectorLogo's tile. */
export function McpLogo({ size = 36, dim = false }: { size?: number; dim?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground ring-1 ring-inset ring-border/50',
        dim && 'opacity-50',
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Server size={Math.round(size * 0.45)} />
    </span>
  );
}
