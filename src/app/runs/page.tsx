'use client';

/**
 * Runs list at /runs.
 *
 * Newest-first across all triggers. Filter pills:
 *   all | manual | scheduled (= cron/every/at) | webhook
 *
 * Per docs/async-agents-v1.md §4.8 the goal is a single executions view
 * with trigger badges; in V1 we surface this as a dedicated /runs page
 * since the existing executions view is mid-refactor. The TopHud's
 * `Clock` icon entry routes to /schedules; runs are linked from each
 * schedule's detail view and via the TopHud "Active runs" indicator.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Activity, Hourglass } from 'lucide-react';
import Link from 'next/link';
import { useRuns } from '@/hooks/use-schedules';
import { cn } from '@/lib/utils';
import type { RunRecord, RunTrigger } from '@/db/types';

type Filter = 'all' | 'manual' | 'scheduled' | 'webhook';

const SCHEDULED_TRIGGERS: RunTrigger[] = ['cron', 'every', 'at'];

export default function RunsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const { data: runs, isLoading } = useRuns(
    filter === 'all'
      ? { limit: 100 }
      : filter === 'scheduled'
        ? { trigger: SCHEDULED_TRIGGERS, limit: 100 }
        : { trigger: filter, limit: 100 },
  );

  return (
    <div className="min-h-dvh bg-background text-foreground font-sans">
      <header className="border-b border-border px-6 py-4 flex items-center gap-3 sticky top-0 bg-background z-10">
        <button
          onClick={() => router.push('/')}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
        </button>
        <Activity size={16} className="text-primary" />
        <h1 className="text-base font-semibold">Runs</h1>
        <div className="flex-1" />
        <Link
          href="/schedules"
          className="text-[12px] text-muted-foreground hover:text-foreground"
        >
          Manage schedules →
        </Link>
      </header>

      <div className="px-6 py-3 border-b border-border flex items-center gap-2">
        {(['all', 'manual', 'scheduled', 'webhook'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-2 py-1 rounded-md text-[11px] uppercase tracking-wider border transition-all',
              filter === f
                ? 'border-primary text-primary bg-primary/5'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <main className="px-6 py-6 max-w-4xl mx-auto">
        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {!isLoading && (!runs || runs.length === 0) && (
          <div className="text-center py-16 text-muted-foreground">
            <Hourglass size={20} className="mx-auto opacity-40 mb-2" />
            <p className="text-sm">No runs matching this filter.</p>
          </div>
        )}
        {runs && runs.length > 0 && (
          <div className="space-y-1">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function RunRow({ run }: { run: RunRecord }) {
  return (
    <Link
      href={run.chatSessionId ? `/?session=${run.chatSessionId}` : `/runs/${run.id}`}
      className="flex items-center gap-3 p-3 rounded-md border border-border bg-card hover:bg-muted text-sm"
    >
      <TriggerBadge trigger={run.trigger} />
      <span
        className={cn(
          'px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium',
          run.status === 'completed' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
          run.status === 'running' && 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
          run.status === 'failed' && 'bg-destructive/10 text-destructive',
          run.status === 'skipped' && 'bg-muted text-muted-foreground',
          run.status === 'queued' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
        )}
      >
        {run.status}
      </span>
      <span className="flex-1 truncate text-muted-foreground text-[12px]">
        {run.summary ?? run.errorMessage ?? '—'}
      </span>
      <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
        {run.startedAt ? humanize(run.startedAt) : '—'}
      </span>
      {run.costUsd != null && run.costUsd > 0 && (
        <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
          ${(run.costUsd ?? 0).toFixed(4)}
        </span>
      )}
    </Link>
  );
}

function TriggerBadge({ trigger }: { trigger: RunTrigger }) {
  if (trigger === 'manual') {
    return null; // default — no badge clutter
  }
  return (
    <span
      className={cn(
        'px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded border',
        trigger === 'webhook'
          ? 'border-amber-500/40 text-amber-700 dark:text-amber-400'
          : 'border-blue-500/40 text-blue-700 dark:text-blue-400',
      )}
    >
      {trigger}
    </span>
  );
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
