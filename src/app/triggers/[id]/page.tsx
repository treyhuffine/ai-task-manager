'use client';

/**
 * Trigger detail at /triggers/<id>.
 *
 * Displays prompt + cadence + next 3 fires (via croner preview),
 * recent runs (links to the chat session), edit/pause/delete actions.
 *
 * Failure banner (task #25): when consecutive_failures >= 3, show a
 * persistent banner at top with the last error and quick actions
 * (view last failed run, pause, reset failure count).
 */

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  PauseCircle,
  PlayCircle,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import {
  useTrigger,
  useUpdateTrigger,
  useDeleteTrigger,
  useRunTrigger,
  useResetTriggerFailures,
  useRuns,
} from '@/hooks/use-triggers';
import { cn } from '@/lib/utils';
import type { RunRecord } from '@/db/types';
import { describeFrequency } from '@/lib/scheduler/frequency';
import { RunActivityBadge } from '@/components/runs/run-activity-badge';
import { isReservedTrigger } from '@/lib/triggers/reserved';
import { openSettings } from '@/components/settings/settings-store';

export default function TriggerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const { data: trigger, isLoading } = useTrigger(id ?? null);
  const { data: recentRuns } = useRuns(id ? { triggerId: id, limit: 20 } : undefined);
  const update = useUpdateTrigger();
  const deleteTrigger = useDeleteTrigger();
  const runTrigger = useRunTrigger();
  const resetFailures = useResetTriggerFailures();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (isLoading || !trigger || !id) {
    return (
      <div className="min-h-dvh bg-background text-foreground flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const failing = trigger.consecutiveFailures >= 3;
  const lastFailedRun = (recentRuns ?? []).find((r) => r.status === 'failed');
  const managed = isReservedTrigger(id);

  return (
    <div className="min-h-dvh bg-background text-foreground font-sans">
      <header className="border-b border-border px-6 py-4 flex items-center gap-3 sticky top-0 bg-background z-10">
        <button
          onClick={() => router.push('/triggers')}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold truncate">{trigger.name}</h1>
            {managed && (
              <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded-md bg-muted text-muted-foreground">
                Managed
              </span>
            )}
          </div>
          {trigger.description && (
            <p className="text-[12px] text-muted-foreground truncate">
              {trigger.description}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {describeFrequency({
              kind: trigger.kind,
              cronExpression: trigger.cronExpression,
              intervalSeconds: trigger.intervalSeconds,
              runAt: trigger.runAt,
              timezone: trigger.timezone,
            })}
            {trigger.enabled ? '' : ' · paused'}
          </p>
        </div>
      </header>

      {failing && (
        <div className="px-6 py-3 bg-destructive/10 border-b border-destructive/30 flex items-start gap-3">
          <AlertTriangle size={16} className="text-destructive mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-destructive">
              This trigger has failed {trigger.consecutiveFailures} times in a row.
            </p>
            {(trigger.disabledReason || lastFailedRun?.errorMessage) && (
              <p className="text-[12px] text-muted-foreground mt-1">
                Last error:{' '}
                <span className="font-mono">
                  {trigger.disabledReason ?? lastFailedRun?.errorMessage}
                </span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {lastFailedRun && (
                <Link
                  href={`/runs/${lastFailedRun.id}`}
                  className="px-2 py-1 rounded-md text-[12px] border border-border bg-card hover:bg-muted"
                >
                  View last failed run
                </Link>
              )}
              {trigger.enabled && (
                <button
                  onClick={() => update.mutate({ id, enabled: false })}
                  className="px-2 py-1 rounded-md text-[12px] border border-border bg-card hover:bg-muted"
                >
                  Pause trigger
                </button>
              )}
              <button
                onClick={() => resetFailures.mutate(id)}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] border border-border bg-card hover:bg-muted"
              >
                <RotateCcw size={11} />
                Reset failure count
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="px-6 py-6 max-w-3xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => runTrigger.mutate(id)}
            disabled={runTrigger.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90 disabled:opacity-50"
          >
            <Play size={14} />
            {runTrigger.isPending ? 'Firing…' : 'Run now'}
          </button>
          <button
            onClick={() => update.mutate({ id, enabled: !trigger.enabled })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted"
          >
            {trigger.enabled ? (
              <>
                <PauseCircle size={14} />
                Pause
              </>
            ) : (
              <>
                <PlayCircle size={14} />
                Resume
              </>
            )}
          </button>
          {!managed && (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-destructive/30 text-destructive text-sm hover:bg-destructive/10 ml-auto"
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}
        </div>

        {managed && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
            <span className="flex-1">
              This trigger is managed by the app. Its name, prompt, and target are locked, and it is
              disabled rather than deleted. Edit its schedule in settings.
            </span>
            <button
              onClick={() => openSettings('general')}
              className="flex-shrink-0 font-medium text-foreground hover:underline"
            >
              Open settings
            </button>
          </div>
        )}

        <section>
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Prompt
          </h2>
          <pre className="p-4 rounded-md border border-border bg-card text-sm whitespace-pre-wrap font-sans">
            {trigger.prompt}
          </pre>
        </section>

        {trigger.kind === 'webhook' && trigger.webhookPublicId && (
          <section>
            <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              Webhook endpoint
            </h2>
            <code className="block p-3 rounded-md border border-border bg-card text-xs font-mono break-all">
              POST /api/webhooks/triggers/{trigger.webhookPublicId}
            </code>
            <p className="text-[11px] text-muted-foreground mt-1">
              Sign body with HMAC-SHA256 using your stored secret. Send
              hex as <code>X-Signature</code> and the plaintext as{' '}
              <code>X-Webhook-Secret</code>.
            </p>
          </section>
        )}

        <section>
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Recent runs
          </h2>
          {recentRuns && recentRuns.length === 0 && (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          )}
          {recentRuns && recentRuns.length > 0 && (
            <div className="space-y-1">
              {recentRuns.slice(0, 10).map((run) => (
                <RunRowSmall key={run.id} run={run} />
              ))}
            </div>
          )}
        </section>
      </main>

      {confirmingDelete && (
        <div className="fixed inset-0 bg-background/80 z-50 flex items-center justify-center p-6">
          <div className="bg-card border border-border rounded-lg p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-semibold">Delete trigger?</h3>
            <p className="text-sm text-muted-foreground">
              Existing runs survive, only the trigger and its future fires
              are removed.
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setConfirmingDelete(false)}
                className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  deleteTrigger.mutate(id, {
                    onSuccess: () => router.push('/triggers'),
                  })
                }
                disabled={deleteTrigger.isPending}
                className="px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-sm hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RunRowSmall({ run }: { run: RunRecord }) {
  const terminal =
    run.status === 'completed' || run.status === 'failed' || run.status === 'skipped'
      ? run.status
      : undefined;
  return (
    <Link
      href={run.chatSessionId ? `/?session=${run.chatSessionId}` : `/runs/${run.id}`}
      className="flex items-center gap-3 p-2 rounded-md border border-border bg-card hover:bg-muted text-sm"
    >
      <RunActivityBadge runId={run.id} terminalStatus={terminal} />
      <span className="flex-1 truncate text-muted-foreground text-[12px]">
        {run.summary ?? run.errorMessage ?? '-'}
      </span>
      <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
        {run.startedAt ? humanize(run.startedAt) : '-'}
      </span>
      {run.costUsd != null && run.costUsd > 0 && (
        <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
          ${(run.costUsd ?? 0).toFixed(4)}
        </span>
      )}
    </Link>
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
