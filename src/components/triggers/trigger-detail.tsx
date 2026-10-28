'use client';

/**
 * One schedule, everything about it: the failure banner when it keeps
 * failing, Run now / Pause / Delete, the managed-by-the-app notice, the
 * whole form (`TriggerForm`, edited in place), the webhook endpoint and its
 * recent runs. Shown in the Schedules window beside the schedule's builder
 * chat, and on the /triggers/<id> page.
 */

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, PauseCircle, Play, PlayCircle, RotateCcw, Trash2 } from 'lucide-react';
import type { RunRecord, TriggerView } from '@/db/types';
import {
  useDeleteTrigger,
  useResetTriggerFailures,
  useRunTrigger,
  useRuns,
  useUpdateTrigger,
} from '@/hooks/use-triggers';
import { openSettings } from '@/components/settings/settings-store';
import { RunActivityBadge } from '@/components/runs/run-activity-badge';
import { isReservedTrigger, lockedFieldsFor, RESERVED_TRIGGER_IDS, type ReservedLockableField } from '@/lib/triggers/reserved';
import { TriggerForm } from './trigger-form';

export function TriggerDetail({ trigger, onDeleted }: { trigger: TriggerView; onDeleted: () => void }) {
  const id = trigger.id;
  const { data: recentRuns } = useRuns({ triggerId: id, limit: 20 });
  const update = useUpdateTrigger();
  const deleteTrigger = useDeleteTrigger();
  const runTrigger = useRunTrigger();
  const resetFailures = useResetTriggerFailures();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const failing = trigger.consecutiveFailures >= 3;
  const lastFailedRun = (recentRuns ?? []).find((r) => r.status === 'failed');
  const managed = isReservedTrigger(id);
  const isHeartbeat = id === RESERVED_TRIGGER_IDS.heartbeat;

  return (
    <div className="space-y-6">
      {failing && (
        <div className="rounded-md px-3 py-3 bg-destructive/10 border border-destructive/30 flex items-start gap-3">
          <AlertTriangle size={16} className="text-destructive mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-destructive">
              This schedule has failed {trigger.consecutiveFailures} times in a row.
            </p>
            {(trigger.disabledReason || lastFailedRun?.errorMessage) && (
              <p className="text-[12px] text-muted-foreground mt-1">
                Last error: <span className="font-mono">{trigger.disabledReason ?? lastFailedRun?.errorMessage}</span>
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
                  Pause it
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

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => runTrigger.mutate(id)}
          disabled={runTrigger.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90 disabled:opacity-50"
        >
          <Play size={14} />
          {runTrigger.isPending ? 'Starting…' : 'Run now'}
        </button>
        <button
          onClick={() => update.mutate({ id, enabled: !trigger.enabled })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted"
        >
          {trigger.enabled ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
          {trigger.enabled ? 'Pause' : 'Resume'}
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
            This schedule is managed by the app. {describeLocks(lockedFieldsFor(id))} It is turned off
            rather than deleted.{isHeartbeat ? ' More options are in Settings > Heartbeat.' : ''}
          </span>
          <button
            onClick={() => openSettings(isHeartbeat ? 'heartbeat' : 'general')}
            className="flex-shrink-0 font-medium text-foreground hover:underline"
          >
            Open settings
          </button>
        </div>
      )}

      <TriggerForm key={id} trigger={trigger} />

      {trigger.kind === 'webhook' && trigger.webhookPublicId && (
        <section>
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Webhook endpoint</h2>
          <code className="block p-3 rounded-md border border-border bg-card text-xs font-mono break-all">
            POST /api/webhooks/triggers/{trigger.webhookPublicId}
          </code>
          <p className="text-[11px] text-muted-foreground mt-1">
            Sign body with HMAC-SHA256 using your stored secret. Send hex as <code>X-Signature</code> and the
            plaintext as <code>X-Webhook-Secret</code>.
          </p>
        </section>
      )}

      <section>
        <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Recent runs</h2>
        {recentRuns && recentRuns.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
        {recentRuns && recentRuns.length > 0 && (
          <div className="space-y-1">
            {recentRuns.slice(0, 10).map((run) => (
              <RunRowSmall key={run.id} run={run} />
            ))}
          </div>
        )}
      </section>

      {confirmingDelete && (
        <div className="fixed inset-0 bg-background/80 z-[60] flex items-center justify-center p-6">
          <div className="bg-card border border-border rounded-lg p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-semibold">Delete this schedule?</h3>
            <p className="text-sm text-muted-foreground">
              Its past runs stay. Only the schedule and its future runs are removed.
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setConfirmingDelete(false)}
                className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteTrigger.mutate(id, { onSuccess: onDeleted })}
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
    run.status === 'completed' || run.status === 'failed' || run.status === 'skipped' || run.status === 'cancelled'
      ? run.status
      : undefined;
  return (
    <Link
      href={run.chatSessionId ? `/?session=${run.chatSessionId}` : `/runs/${run.id}`}
      className="flex items-center gap-3 p-2 rounded-md border border-border bg-card hover:bg-muted text-sm"
    >
      <RunActivityBadge runId={run.id} terminalStatus={terminal} />
      <span className="flex-1 truncate text-muted-foreground text-[12px]">
        {run.status === 'failed'
          ? run.errorMessage ?? run.summary ?? '-'
          : run.status === 'skipped' && run.statusReason
            ? describeSkip(run.statusReason)
            : run.summary ?? '-'}
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

const SKIP_REASONS: Record<string, string> = {
  trigger_busy: 'Skipped: its last run was still going',
  execution_busy: 'Skipped: another run was going in the same folder',
  coalesced_into_active: 'Added to the turn already under way',
  chat_busy: 'Skipped: the chat was busy',
  chat_paused: 'Skipped: the chat’s incoming messages were paused',
};

/** Why a fire didn't run, in words. Unlisted reasons read as their code. */
function describeSkip(reason: string): string {
  return SKIP_REASONS[reason] ?? `Skipped: ${reason.replaceAll('_', ' ')}`;
}

const LOCK_LABELS: Record<ReservedLockableField, string> = {
  name: 'name',
  description: 'description',
  prompt: 'message',
  targetKind: 'target',
  kind: 'timing type',
  concurrencyPolicy: 'overlap rule',
  catchUpPolicy: 'missed-run rule',
  timeoutSeconds: 'time limit',
};

/** "Its name, description, and target are locked." from a lock list. */
function describeLocks(fields: readonly ReservedLockableField[]): string {
  const labels = fields.map((f) => LOCK_LABELS[f]);
  if (labels.length === 0) return '';
  const list =
    labels.length === 1
      ? labels[0]
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
  return `Its ${list} are locked.`;
}

function humanize(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
