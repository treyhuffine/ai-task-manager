'use client';

/**
 * Schedules list view at /schedules.
 *
 * Cards/rows with name, cadence (humanized), next fire, last status
 * pill, enabled toggle. "+ New schedule" navigates to /schedules/new.
 * Failure warning icon at consecutive_failures >= 3 (task #25).
 */

import { useRouter } from 'next/navigation';
import { Clock, AlertTriangle, ArrowLeft, ChevronRight, Pause, Play, Plus } from 'lucide-react';
import Link from 'next/link';
import { useSchedules, useUpdateSchedule } from '@/hooks/use-schedules';
import { cn } from '@/lib/utils';
import type { ScheduleWithLastRun } from '@/db/types';
import { describeFrequency } from '@/lib/scheduler/frequency';

export default function SchedulesPage() {
  const router = useRouter();
  const { data: schedules, isLoading } = useSchedules();
  const updateSchedule = useUpdateSchedule();

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
          href="/schedules/new"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus size={14} />
          New schedule
        </Link>
      </header>

      <main className="px-6 py-6 max-w-4xl mx-auto">
        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {!isLoading && (!schedules || schedules.length === 0) && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="mb-3">No schedules yet.</p>
            <Link
              href="/schedules/new"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border hover:bg-muted text-sm"
            >
              <Plus size={14} />
              Create your first schedule
            </Link>
          </div>
        )}
        {schedules && schedules.length > 0 && (
          <div className="space-y-2">
            {schedules.map((s) => (
              <ScheduleRow
                key={s.id}
                schedule={s}
                onToggle={(enabled) =>
                  updateSchedule.mutate({ id: s.id, enabled })
                }
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ScheduleRow({
  schedule,
  onToggle,
}: {
  schedule: ScheduleWithLastRun;
  onToggle: (enabled: boolean) => void;
}) {
  const failing = schedule.consecutiveFailures >= 3;
  return (
    <Link
      href={`/schedules/${schedule.id}`}
      className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card hover:border-muted-foreground/30 transition-colors"
    >
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle(!schedule.enabled);
        }}
        className={cn(
          'flex-shrink-0 p-1.5 rounded-md transition-colors',
          schedule.enabled
            ? 'bg-primary/10 text-primary hover:bg-primary/20'
            : 'bg-muted text-muted-foreground hover:bg-muted/80',
        )}
        title={schedule.enabled ? 'Pause schedule' : 'Resume schedule'}
      >
        {schedule.enabled ? <Play size={14} /> : <Pause size={14} />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{schedule.name}</p>
          {failing && (
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-md bg-destructive/10 text-destructive"
              title={`${schedule.consecutiveFailures} consecutive failures`}
            >
              <AlertTriangle size={10} />
              {schedule.consecutiveFailures} failed
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {humanizeCadence(schedule)}
          {schedule.nextRunAt && ` · next ${humanize(schedule.nextRunAt)}`}
          {schedule.lastRunStatus && ` · last ${schedule.lastRunStatus}`}
        </p>
      </div>

      <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
    </Link>
  );
}

function humanizeCadence(s: ScheduleWithLastRun): string {
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
