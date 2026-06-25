'use client';

/**
 * Schedules quick-access modal. Triggered from the rail's "Schedules"
 * button. Body swaps between three states:
 *
 *   - `list` — existing schedules + a "+ New schedule" CTA
 *   - `new`  — `<ScheduleCreateForm>` rendered inline
 *   - `webhook-credentials` — after a webhook save, the secret panel
 *     since the plaintext only shows once
 *
 * Routes (`/schedules`, `/schedules/new`, `/schedules/[id]`) stay
 * intact for deep linking; this modal is a faster surface, not a
 * replacement.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  Pause,
  Play,
  Plus,
  X,
} from 'lucide-react';
import { useSchedules, useUpdateSchedule } from '@/hooks/use-schedules';
import { describeFrequency } from '@/lib/scheduler/frequency';
import {
  ScheduleCreateForm,
  WebhookCredentialsPanel,
  type WebhookCredentials,
} from './schedule-create-form';
import { cn } from '@/lib/utils';
import type { ScheduleWithLastRun } from '@/db/types';

type View = 'list' | 'new' | 'webhook-credentials';

export interface SchedulesModalProps {
  open: boolean;
  onClose: () => void;
}

export function SchedulesModal({ open, onClose }: SchedulesModalProps) {
  const router = useRouter();
  const [view, setView] = useState<View>('list');
  const [createdWebhook, setCreatedWebhook] = useState<WebhookCredentials | null>(null);

  // Reset to list view whenever the modal reopens.
  useEffect(() => {
    if (open) {
      setView('list');
      setCreatedWebhook(null);
    }
  }, [open]);

  // ESC closes the modal at the top level. The form's Cancel button
  // returns to the list view first (handled inline).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        // Width: max-w-4xl (~896px) — wide enough that the form's
        // pills don't crowd and the list rows breathe, narrow enough
        // that the single-column form doesn't look sparse.
        //
        // Height: three units doing three jobs.
        //   - `min(88vh, 56rem)` caps height at 88% of viewport, but
        //     never above ~896px. `rem` (not `px`) so the cap scales
        //     with the user's root font size — bumping browser zoom
        //     for accessibility grows this proportionally instead of
        //     leaving a cramped modal under inflated chrome.
        //   - `min-h-[36rem]` (~576px) floor for short viewports,
        //     also in `rem` for the same reason.
        // Fixed-feeling height keeps the modal from jumping when
        // switching views; the body scrolls instead.
        className="w-full max-w-4xl h-[min(88vh,56rem)] min-h-[36rem] bg-background border border-border rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <Header view={view} onBack={() => setView('list')} onClose={onClose} />

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {view === 'list' && (
            <ListBody
              onNew={() => setView('new')}
              onOpenDetail={(id) => {
                onClose();
                router.push(`/schedules/${id}`);
              }}
            />
          )}
          {view === 'new' && (
            <ScheduleCreateForm
              onCreated={(_schedule, webhook) => {
                if (webhook) {
                  setCreatedWebhook(webhook);
                  setView('webhook-credentials');
                  return;
                }
                setView('list');
              }}
              onCancel={() => setView('list')}
            />
          )}
          {view === 'webhook-credentials' && createdWebhook && (
            <WebhookCredentialsPanel
              publicId={createdWebhook.publicId}
              secret={createdWebhook.secret}
              onContinue={() => {
                setCreatedWebhook(null);
                setView('list');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Modal chrome ─────────────────────────────────────────────

function Header({
  view,
  onBack,
  onClose,
}: {
  view: View;
  onBack: () => void;
  onClose: () => void;
}) {
  const title =
    view === 'list'
      ? 'Schedules and Triggers'
      : view === 'new'
        ? 'Create scheduled task'
        : 'Webhook ready';

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
      {view !== 'list' ? (
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label="Back to schedules"
        >
          <ArrowLeft size={16} />
        </button>
      ) : (
        <Clock size={16} className="text-primary mx-1.5" />
      )}
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onClose}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
        aria-label="Close"
      >
        <X size={16} />
      </button>
    </div>
  );
}

// ── List body ────────────────────────────────────────────────

function ListBody({
  onNew,
  onOpenDetail,
}: {
  onNew: () => void;
  onOpenDetail: (id: string) => void;
}) {
  const { data: schedules, isLoading } = useSchedules();
  const updateSchedule = useUpdateSchedule();

  const hasContent = !!schedules && schedules.length > 0;

  return (
    <div className="space-y-3">
      {hasContent && (
        // With existing rows above/below, the "+ New" button lives in
        // a header strip — auto-width, right-aligned so it doesn't
        // dominate the visual hierarchy.
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
            {schedules.length} schedule{schedules.length === 1 ? '' : 's'}
          </p>
          <NewScheduleButton onClick={onNew} />
        </div>
      )}

      {isLoading && (
        <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>
      )}

      {!isLoading && !hasContent && <EmptyState onNew={onNew} />}

      {hasContent && (
        <div className="space-y-1.5">
          {schedules.map((s) => (
            <Row
              key={s.id}
              schedule={s}
              onToggle={(enabled) => updateSchedule.mutate({ id: s.id, enabled })}
              onOpen={() => onOpenDetail(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NewScheduleButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
    >
      <Plus size={14} />
      New scheduled task
    </button>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
      <div className="p-3 rounded-full bg-primary/10 text-primary">
        <Plus size={24} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">No schedules yet</p>
        <p className="text-[12px] text-muted-foreground max-w-xs">
          Save a prompt that runs on a cadence or on demand. Daily
          briefings, inbox triage, webhook handlers, anything the
          agent can do.
        </p>
      </div>
      <NewScheduleButton onClick={onNew} />
    </div>
  );
}

function Row({
  schedule,
  onToggle,
  onOpen,
}: {
  schedule: ScheduleWithLastRun;
  onToggle: (enabled: boolean) => void;
  onOpen: () => void;
}) {
  const cadence = describeFrequency({
    kind: schedule.kind,
    cronExpression: schedule.cronExpression,
    intervalSeconds: schedule.intervalSeconds,
    runAt: schedule.runAt,
    timezone: schedule.timezone,
  });
  return (
    <div className="flex items-center gap-3 p-3 rounded-md border border-border bg-card hover:bg-muted/40 transition-colors">
      <button
        type="button"
        onClick={(e) => {
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
        aria-label={schedule.enabled ? 'Pause' : 'Resume'}
      >
        {schedule.enabled ? <Play size={12} /> : <Pause size={12} />}
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{schedule.name}</p>
          {schedule.lastRunStatus && (
            <span
              className={cn(
                'px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-medium',
                schedule.lastRunStatus === 'completed' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                schedule.lastRunStatus === 'failed' && 'bg-destructive/10 text-destructive',
                schedule.lastRunStatus === 'skipped' && 'bg-muted text-muted-foreground',
              )}
            >
              {schedule.lastRunStatus}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {cadence}
        </p>
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground"
        aria-label="Open detail"
        title="Open detail"
      >
        <ExternalLink size={12} />
      </button>
    </div>
  );
}
