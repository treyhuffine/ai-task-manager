'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HoverCard as HoverCardPrimitive } from 'radix-ui';
import { Gauge } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { ageLabel, rateLimitRows, type RateLimitRow } from '@/lib/harness/rate-limit-display';
import { cn } from '@/lib/utils';

// Top-HUD rate limits, beside the status pills. A quiet icon that shows each
// harness account's limits on hover. Limits belong to the account, so every
// chat on Claude Code shares the Claude windows listed here. They come from
// the last chat that ran on each harness, nothing is polled
// (src/lib/harness/rate-limits.ts), so each block says how old it is.

export function RateLimitsPill() {
  const [open, setOpen] = useState(false);
  const { data, isPending } = useQuery({
    ...trpc.harness.rateLimitsGet.queryOptions({}),
    enabled: open,
    staleTime: 15_000,
  });
  const harnesses = data?.harnesses ?? [];

  return (
    <HoverCardPrimitive.Root open={open} onOpenChange={setOpen} openDelay={150} closeDelay={80}>
      <HoverCardPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="Rate limits"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            'flex items-center px-1.5 h-[18px] rounded text-[10px] text-muted-foreground transition-colors',
            'hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground',
          )}
        >
          <Gauge size={11} />
        </button>
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          align="start"
          sideOffset={6}
          className="z-50 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md outline-none"
        >
          <p className="pb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Rate limits</p>
          {isPending ? (
            <p className="text-xs text-muted-foreground">Loading</p>
          ) : harnesses.length === 0 ? (
            <p className="text-xs leading-normal text-muted-foreground">
              None reported yet. Limits show here after a Claude Code or Codex chat runs.
            </p>
          ) : (
            <div className="space-y-3">
              {harnesses.map((entry) => (
                <section key={entry.harness} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium">{entry.name}</span>
                    <span className="text-[10.5px] text-muted-foreground">{ageLabel(entry.observedAt)}</span>
                  </div>
                  {rateLimitRows(entry.buckets).map((row) => <LimitRow key={row.key} row={row} />)}
                </section>
              ))}
            </div>
          )}
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}

function LimitRow({ row }: { row: RateLimitRow }) {
  const percent = row.percent === undefined ? undefined : Math.round(row.percent);
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="min-w-0 flex-1 truncate">{row.label}</span>
        {percent !== undefined ? (
          <>
            {row.reset && <span className="shrink-0 text-muted-foreground">{row.reset}</span>}
            <span className={cn('w-9 shrink-0 text-right font-mono tabular-nums', row.blocked && 'text-destructive')}>{percent}%</span>
          </>
        ) : (
          <span className={cn('shrink-0 text-muted-foreground', row.blocked && 'text-destructive')}>
            {[row.detail, row.reset].filter(Boolean).join(', ')}
          </span>
        )}
      </div>
      {percent !== undefined && (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', row.blocked ? 'bg-destructive' : 'bg-foreground/40')}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
