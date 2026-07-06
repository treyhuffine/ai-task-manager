'use client';

/**
 * Triggers list view at /triggers.
 *
 * Cards/rows with name, cadence (humanized), next fire, last status
 * pill, enabled toggle. "+ New trigger" navigates to /triggers/new.
 * Failure warning icon at consecutive_failures >= 3 (task #25).
 */

import { useRouter } from 'next/navigation';
import { Clock, AlertTriangle, ArrowLeft, ChevronRight, Pause, Play, Plus } from 'lucide-react';
import Link from 'next/link';
import { useTriggers, useUpdateTrigger } from '@/hooks/use-triggers';
import { cn } from '@/lib/utils';
import type { TriggerWithLastRun } from '@/db/types';
import { describeFrequency } from '@/lib/scheduler/frequency';
import { isReservedTrigger } from '@/lib/triggers/reserved';

export default function TriggersPage() {
  const router = useRouter();
  const { data: triggers, isLoading } = useTriggers();
  const updateTrigger = useUpdateTrigger();

  return (
    <div className="min-h-dvh bg-background text-foreground font-sans">
      <header className="border-b border-border px-6 py-4 flex items-center gap-3 sticky top-0 bg-background z-10">
        <button
          onClick={() => router.push('/')}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          aria-label="Back to dashboard"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-primary" />
          <h1 className="text-base font-semibold">Schedules and Triggers</h1>
        </div>
        <div className="flex-1" />
        <Link
          href="/triggers/new"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus size={14} />
          New trigger
        </Link>
      </header>

      <main className="px-6 py-6 max-w-4xl mx-auto">
        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {!isLoading && (!triggers || triggers.length === 0) && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="mb-3">No triggers yet.</p>
            <Link
              href="/triggers/new"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border hover:bg-muted text-sm"
            >
              <Plus size={14} />
              Create your first trigger
            </Link>
          </div>
        )}
        {triggers && triggers.length > 0 && (
          <div className="space-y-2">
            {triggers.map((s) => (
              <TriggerRow
                key={s.id}
                trigger={s}
                onToggle={(enabled) =>
                  updateTrigger.mutate({ id: s.id, enabled })
                }
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function TriggerRow({
  trigger,
  onToggle,
}: {
  trigger: TriggerWithLastRun;
  onToggle: (enabled: boolean) => void;
}) {
  const failing = trigger.consecutiveFailures >= 3;
  return (
    <Link
      href={`/triggers/${trigger.id}`}
      className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card hover:border-muted-foreground/30 transition-colors"
    >
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle(!trigger.enabled);
        }}
        className={cn(
          'flex-shrink-0 p-1.5 rounded-md transition-colors',
          trigger.enabled
            ? 'bg-primary/10 text-primary hover:bg-primary/20'
            : 'bg-muted text-muted-foreground hover:bg-muted/80',
        )}
        title={trigger.enabled ? 'Pause trigger' : 'Resume trigger'}
      >
        {trigger.enabled ? <Play size={14} /> : <Pause size={14} />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{trigger.name}</p>
          {isReservedTrigger(trigger.id) && (
            <span
              className="flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded-md bg-muted text-muted-foreground"
              title="Managed by the app — edit its schedule in Settings › General"
            >
              Managed
            </span>
          )}
          {failing && (
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-md bg-destructive/10 text-destructive"
              title={`${trigger.consecutiveFailures} consecutive failures`}
            >
              <AlertTriangle size={10} />
              {trigger.consecutiveFailures} failed
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {humanizeCadence(trigger)}
          {trigger.nextRunAt && ` · next ${humanize(trigger.nextRunAt)}`}
          {trigger.lastRunStatus && ` · last ${trigger.lastRunStatus}`}
        </p>
      </div>

      <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
    </Link>
  );
}

function humanizeCadence(s: TriggerWithLastRun): string {
  return describeFrequency({
    kind: s.kind,
    cronExpression: s.cronExpression,
    intervalSeconds: s.intervalSeconds,
    runAt: s.runAt,
    timezone: s.timezone,
  });
}

function humanize(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
