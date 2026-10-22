'use client';

import { useEffect, useRef, useState } from 'react';
import { Gauge, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HarnessIcon, harnessLogo } from '@/components/settings/harness-connection-ui';
import { UsageWarningsSetting } from '@/components/settings/usage-warnings-setting';
import { useHarnessRateLimits } from '@/hooks/use-harness-rate-limits';
import { useUserState } from '@/hooks/use-user-state';
import {
  ageLabel, rateLimitRows, rateLimitStatus, rateLimitWarning, RATE_LIMIT_WARNING_MAX_AGE_MS,
  type RateLimitRow, type RateLimitTone,
} from '@/lib/harness/rate-limit-display';
import { type HarnessId } from '@/lib/harness/registry';
import { cn } from '@/lib/utils';
import { isDarkBrandMark } from '@/components/integrations/integration-logo';

// One control for account usage: inspect all windows, or see each provider's
// closest-to-full allowance above 80%. Badges use fresh observations only.
export function RateLimitsPill() {
  const [open, setOpen] = useState(false);
  const preference = useUserState();
  const warningsEnabled = preference.data?.usageWarnings ?? true;
  const { data, isPending, isError, updating } = useHarnessRateLimits(open || (preference.isSuccess && warningsEnabled));
  const harnesses = data?.harnesses;
  const [clock, tick] = useState(0);
  // A reset or expired observation clears its badge even between polls.
  useEffect(() => {
    const now = Date.now();
    const next = harnesses?.flatMap((entry) => entry.buckets.flatMap((bucket) => [
      Date.parse(bucket.observedAt) + RATE_LIMIT_WARNING_MAX_AGE_MS,
      bucket.resetAt ? Date.parse(bucket.resetAt) : NaN,
    ])).filter((at) => Number.isFinite(at) && at > now);
    if (!next?.length) return;
    const timer = setTimeout(() => tick((value) => value + 1), Math.min(...next) - now + 10);
    return () => clearTimeout(timer);
  }, [harnesses, clock]);

  const warnings = warningsEnabled ? (harnesses ?? []).flatMap((entry) => {
    const row = rateLimitWarning(entry.buckets);
    return row ? [{ ...entry, row }] : [];
  }) : [];
  const label = warnings.length
    ? `Usage. ${warnings.map(({ name, row }) => `${name}, ${row.label}, ${row.percent === undefined ? '' : `${Math.round(row.percent)} percent, `}${rateLimitStatus(row)}${row.reset ? `, ${row.reset}` : ''}`).join('. ')}`
    : 'Usage';

  const pinned = useRef(false);
  const pointerInside = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  const cancelHover = () => { clearTimeout(hoverTimer.current); };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const enter = (event: React.PointerEvent) => {
    if (event.pointerType === 'touch') return;
    pointerInside.current = true;
    cancelHover();
    hoverTimer.current = setTimeout(() => setOpen(true), 150);
  };
  const leave = () => {
    pointerInside.current = false;
    cancelHover();
    hoverTimer.current = setTimeout(() => {
      if (!pinned.current && !pointerInside.current && !content.current?.contains(document.activeElement)) setOpen(false);
    }, 120);
  };

  return (
    <Popover open={open} onOpenChange={(next) => { pinned.current = false; setOpen(next); }}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          aria-label={label}
          onPointerEnter={enter}
          onPointerLeave={leave}
          onClick={(event) => {
            // Hover previews. Click pins the same card, and a second click closes.
            event.preventDefault();
            cancelHover();
            pinned.current = !pinned.current;
            setOpen(pinned.current);
            if (pinned.current && event.detail === 0) {
              requestAnimationFrame(() => content.current?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus());
            }
          }}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 rounded px-1.5 text-[10px] text-muted-foreground transition-colors',
            'hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground',
          )}
        >
          <Gauge size={11} aria-hidden="true" />
          {warnings.map(({ harness, row }) => (
            <span key={harness} aria-hidden="true" className="flex min-w-5 flex-col items-center gap-0.5">
              <UsageLogo harness={harness} size={12} />
              <span className={cn('font-mono text-[10px] leading-none tabular-nums', TEXT_TONE[row.tone])}>
                {row.percent === undefined ? '!' : `${Math.round(row.percent)}%`}
              </span>
            </span>
          ))}
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        align="start"
        sideOffset={6}
        aria-label="Subscription usage"
        onPointerEnter={enter}
        onPointerLeave={leave}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) leave(); }}
        onOpenAutoFocus={(event) => { if (!pinned.current) event.preventDefault(); }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus.current) { returnFocus.current = false; trigger.current?.focus(); }
        }}
        onEscapeKeyDown={() => { cancelHover(); returnFocus.current = true; }}
        className="w-72 max-w-[calc(100vw-16px)] bg-popover text-popover-foreground"
      >
        <div className="flex items-center justify-between gap-2 pb-2">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Usage</p>
          {updating && (
            <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground" role="status">
              <Loader2 size={10} className="animate-spin" /> Updating
            </span>
          )}
        </div>
        {isPending ? (
          <p className="text-xs text-muted-foreground">Loading</p>
        ) : isError && !data ? (
          <p className="text-xs text-muted-foreground">Usage is unavailable. We will try again shortly.</p>
        ) : !harnesses?.length ? (
          <p className="text-xs leading-normal text-muted-foreground">
            {updating ? 'Reading your plan limits.' : 'No plan limits to show. Claude Code and Codex report them when signed in with a subscription.'}
          </p>
        ) : (
          <div className="space-y-3">
            {harnesses.map((entry) => (
              <section key={entry.harness} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium"><UsageLogo harness={entry.harness} size={12} />{entry.name}</span>
                  <span className="text-[10.5px] text-muted-foreground">{ageLabel(entry.observedAt)}</span>
                </div>
                {rateLimitRows(entry.buckets).map((row) => <LimitRow key={row.key} row={row} />)}
              </section>
            ))}
          </div>
        )}
        <div className="mt-3 border-t border-border pt-3"><UsageWarningsSetting compact /></div>
      </PopoverContent>
    </Popover>
  );
}

function UsageLogo({ harness, size }: { harness: HarnessId; size: number }) {
  const logo = harnessLogo(harness);
  // Match the model selector's shared brand colors. Near-black marks use
  // the theme foreground so they stay visible in both appearances.
  const monochrome = isDarkBrandMark(logo.hex);
  return <span className="flex text-foreground" style={monochrome ? undefined : { color: `#${logo.hex}` }}><HarnessIcon id={harness} size={size} /></span>;
}

const BAR_TONE: Record<RateLimitTone, string> = {
  normal: 'bg-blue-500',
  warn: 'bg-amber-400',
  critical: 'bg-red-500',
};
const TEXT_TONE: Record<RateLimitTone, string> = {
  normal: '',
  warn: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
};

function LimitRow({ row }: { row: RateLimitRow }) {
  const percent = row.percent === undefined ? undefined : Math.round(row.percent);
  const status = rateLimitStatus(row);
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="min-w-0 flex-1 truncate">{row.label}</span>
        {percent !== undefined ? (
          <>
            {row.reset && <span className="shrink-0 text-muted-foreground">{row.reset}</span>}
            <span className={cn('w-9 shrink-0 text-right font-mono tabular-nums', TEXT_TONE[row.tone])}>{percent}%</span>
          </>
        ) : (
          <span className={cn('shrink-0 text-muted-foreground', row.blocked && TEXT_TONE.critical)}>{[row.detail, row.reset].filter(Boolean).join(', ')}</span>
        )}
      </div>
      {percent !== undefined && (
        <>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full', BAR_TONE[row.tone])} style={{ width: `${Math.min(percent, 100)}%` }} />
          </div>
          {status && <p className="text-[10px] text-muted-foreground">{status}</p>}
        </>
      )}
    </div>
  );
}
