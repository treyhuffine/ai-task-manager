'use client';

/**
 * The Schedules window. Opened from the rail and from a chat's Schedule
 * button (src/lib/client/schedules-window.ts), mounted once in the
 * dashboard. Its body is one of:
 *
 *   - `list`: every schedule, with pause/resume and "New scheduled task"
 *   - `edit`: one schedule, every field editable (`TriggerDetail`), with
 *     its builder chat beside it
 *   - `new`: the empty form with the new-schedule chat beside it. When the
 *     chat creates the schedule, the window opens it and the conversation
 *     comes along (`useScheduleChat`'s `movedTo`).
 *   - `webhook`: a new webhook's secret, shown only once
 *
 * The /triggers pages show the same parts for deep links.
 */

import { useEffect, useState } from 'react';
import { ArrowLeft, Clock, Pause, Play, Plus, X } from 'lucide-react';
import { useTrigger, useTriggers, useUpdateTrigger } from '@/hooks/use-triggers';
import { describeFrequency } from '@/lib/scheduler/frequency';
import { closeSchedulesWindow, useSchedulesWindow } from '@/lib/client/schedules-window';
import { NEW_SCHEDULE_REF } from '@/lib/triggers/schedule-chat';
import {
  TriggerCreateForm,
  WebhookCredentialsPanel,
  type WebhookCredentials,
} from './trigger-create-form';
import { TriggerDetail } from './trigger-detail';
import { ScheduleChatPanel } from './schedule-chat-panel';
import { useAdoptMovedScheduleChat, useScheduleChat } from './use-schedule-chat';
import { cn } from '@/lib/utils';
import type { TriggerWithLastRun } from '@/db/types';
import { isReservedTrigger } from '@/lib/triggers/reserved';
import { isTriggerInactive } from '@/lib/triggers/inactive';
import { useFoldShown } from '@/lib/client/rail-fold';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { FoldRow } from '@/components/workspaces/fold-row';
import { findProvider } from '@/lib/harness/options';
import { AwakeNote } from '@/components/triggers/awake-note';
import { Tip } from '@/components/ui/tip';

type View =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'edit'; id: string }
  | { kind: 'webhook'; credentials: WebhookCredentials };

export function TriggersModal() {
  const { open, openId, triggerId } = useSchedulesWindow();
  const [view, setView] = useState<View>({ kind: 'list' });

  // Each opening starts where it was asked to. Reset while rendering, so a
  // reopened window never flashes the view it was closed on.
  const [openedFor, setOpenedFor] = useState(openId);
  if (openId !== openedFor) {
    setOpenedFor(openId);
    setView(triggerId ? { kind: 'edit', id: triggerId } : { kind: 'list' });
  }

  // Escape closes the window, unless something inside it (a menu, the
  // chat's composer) already used the key.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeSchedulesWindow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const withChat = view.kind === 'new' || view.kind === 'edit';
  const toList = () => setView({ kind: 'list' });

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={closeSchedulesWindow}
      role="dialog"
      aria-modal="true"
      aria-label="Schedules and Triggers"
    >
      <div
        // Height: capped at 88% of the viewport and ~896px, floored for short
        // screens, in rem so it scales with the user's font size. A steady
        // height keeps the window from jumping between views; the body
        // scrolls instead. Wider with the chat beside the form.
        className={cn(
          'w-full h-[min(88vh,56rem)] min-h-[36rem] bg-background border border-border rounded-lg shadow-2xl flex flex-col',
          withChat ? 'max-w-6xl' : 'max-w-4xl',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Header view={view} onBack={toList} />

        {view.kind === 'list' && (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            <ListBody onNew={() => setView({ kind: 'new' })} onOpen={(id) => setView({ kind: 'edit', id })} />
          </div>
        )}
        {view.kind === 'new' && (
          <NewBody
            onOpen={(id) => setView({ kind: 'edit', id })}
            onWebhook={(credentials) => setView({ kind: 'webhook', credentials })}
            onCancel={toList}
          />
        )}
        {view.kind === 'edit' && <EditBody key={view.id} id={view.id} onGone={toList} />}
        {view.kind === 'webhook' && (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            <WebhookCredentialsPanel
              publicId={view.credentials.publicId}
              secret={view.credentials.secret}
              onContinue={toList}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** The form on the left and the schedule's chat on the right; stacked on a phone. */
function WithChat({ children, chat }: { children: React.ReactNode; chat: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden flex flex-col md:flex-row">
      <div className="md:flex-1 md:min-w-0 md:overflow-y-auto px-6 py-5">{children}</div>
      <div className="h-[32rem] md:h-auto md:w-[26rem] flex-shrink-0 border-t md:border-t-0 md:border-l border-border min-h-0">
        {chat}
      </div>
    </div>
  );
}

function NewBody({
  onOpen,
  onWebhook,
  onCancel,
}: {
  onOpen: (id: string) => void;
  onWebhook: (credentials: WebhookCredentials) => void;
  onCancel: () => void;
}) {
  const chat = useScheduleChat(NEW_SCHEDULE_REF);
  const adopt = useAdoptMovedScheduleChat();
  // The chat made the schedule: open it, with the conversation beside it.
  const movedTo = chat.movedTo;
  useEffect(() => {
    if (!movedTo) return;
    adopt(NEW_SCHEDULE_REF, movedTo);
    onOpen(movedTo);
  }, [movedTo, adopt, onOpen]);

  return (
    <WithChat chat={<ScheduleChatPanel chat={chat} scheduleRef={NEW_SCHEDULE_REF} />}>
      <TriggerCreateForm
        onCreated={(trigger, webhook) => (webhook ? onWebhook(webhook) : onOpen(trigger.id))}
        onCancel={onCancel}
      />
    </WithChat>
  );
}

function EditBody({ id, onGone }: { id: string; onGone: () => void }) {
  const { data: trigger, isLoading, error } = useTrigger(id);
  const chat = useScheduleChat(id);
  return (
    <WithChat chat={<ScheduleChatPanel chat={chat} scheduleRef={id} />}>
      {trigger ? (
        <TriggerDetail trigger={trigger} onDeleted={onGone} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{error ? 'This schedule could not be loaded.' : 'This schedule no longer exists.'}</p>
          <button type="button" onClick={onGone} className="font-medium text-foreground hover:underline">
            Back to all schedules
          </button>
        </div>
      )}
    </WithChat>
  );
}

// ── Window chrome ────────────────────────────────────────────

function Header({ view, onBack }: { view: View; onBack: () => void }) {
  const editing = view.kind === 'edit' ? view.id : null;
  const { data: trigger } = useTrigger(editing);
  const title =
    view.kind === 'list'
      ? 'Schedules and Triggers'
      : view.kind === 'new'
        ? 'New scheduled task'
        : view.kind === 'webhook'
          ? 'Webhook ready'
          : trigger?.name ?? 'Schedule';

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
      {view.kind !== 'list' ? (
        <Tip label="All schedules">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label="Back to schedules"
          >
            <ArrowLeft size={16} />
          </button>
        </Tip>
      ) : (
        <Clock size={16} className="text-primary mx-1.5" />
      )}
      <h2 className="text-sm font-semibold truncate">{title}</h2>
      {trigger && view.kind === 'edit' && (
        <span className="flex-shrink-0 text-[11px] text-muted-foreground truncate">
          {describeFrequency(trigger)}
          {trigger.enabled ? '' : ' · paused'}
        </span>
      )}
      <div className="flex-1" />
      <button
        type="button"
        onClick={closeSchedulesWindow}
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
  onOpen,
}: {
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const { data: triggers, isLoading } = useTriggers();
  const updateTrigger = useUpdateTrigger();
  // Paused triggers and one-time ones that already fired fold below the rest,
  // the same toggle as every other list (src/lib/triggers/inactive.ts).
  const [inactiveShown, setInactiveShown] = useFoldShown('inactive:triggers');

  const hasContent = !!triggers && triggers.length > 0;
  const active = (triggers ?? []).filter((t) => !isTriggerInactive(t));
  const inactive = (triggers ?? []).filter((t) => isTriggerInactive(t));
  const row = (s: TriggerWithLastRun) => (
    <Row
      key={s.id}
      trigger={s}
      onToggle={(enabled) => updateTrigger.mutate({ id: s.id, enabled })}
      onOpen={() => onOpen(s.id)}
    />
  );

  return (
    <div className="space-y-3">
      {hasContent && (
        // With existing rows above/below, the "+ New" button lives in
        // a header strip — auto-width, right-aligned so it doesn't
        // dominate the visual hierarchy.
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
            {triggers.length} trigger{triggers.length === 1 ? '' : 's'}
          </p>
          <NewTriggerButton onClick={onNew} />
        </div>
      )}
      {hasContent && <AwakeNote lead="Schedules run" />}

      {isLoading && (
        <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>
      )}

      {!isLoading && !hasContent && <EmptyState onNew={onNew} />}

      {hasContent && (
        <div className="space-y-1.5">
          {active.map(row)}
          {inactive.length > 0 && (
            <>
              {inactiveShown && <div className="space-y-1.5 opacity-60">{inactive.map(row)}</div>}
              <FoldRow
                label={`${inactive.length} paused or finished`}
                shown={inactiveShown}
                onToggle={() => setInactiveShown(!inactiveShown)}
                rowClassName="py-1.5 text-[11px]"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NewTriggerButton({ onClick }: { onClick: () => void }) {
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
        <p className="text-sm font-medium text-foreground">No triggers yet</p>
        <p className="text-[12px] text-muted-foreground max-w-xs">
          Save a prompt that runs on a cadence or on demand. Daily
          briefings, inbox triage, webhook handlers, anything the
          agent can do.
        </p>
      </div>
      <NewTriggerButton onClick={onNew} />
    </div>
  );
}

function Row({
  trigger,
  onToggle,
  onOpen,
}: {
  trigger: TriggerWithLastRun;
  onToggle: (enabled: boolean) => void;
  onOpen: () => void;
}) {
  const cadence = describeFrequency({
    kind: trigger.kind,
    cronExpression: trigger.cronExpression,
    intervalSeconds: trigger.intervalSeconds,
    runAt: trigger.runAt,
    timezone: trigger.timezone,
  });
  return (
    <div className="flex items-center gap-3 p-3 rounded-md border border-border bg-card hover:bg-muted/40 transition-colors">
      <Tip label={trigger.enabled ? 'Pause trigger' : 'Resume trigger'}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(!trigger.enabled);
          }}
          className={cn(
            'flex-shrink-0 p-1.5 rounded-md transition-colors',
            trigger.enabled
              ? 'bg-primary/10 text-primary hover:bg-primary/20'
              : 'bg-muted text-muted-foreground hover:bg-muted/80',
          )}
          aria-label={trigger.enabled ? 'Pause' : 'Resume'}
        >
          {trigger.enabled ? <Play size={12} /> : <Pause size={12} />}
        </button>
      </Tip>

      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{trigger.name}</p>
          {isReservedTrigger(trigger.id) && (
            <Tip label="Managed by the app. Its schedule and who runs it can change, the rest is fixed.">
              <span
                className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-medium bg-muted text-muted-foreground"
              >
                Managed
              </span>
            </Tip>
          )}
          {trigger.lastRunStatus && (
            <span
              className={cn(
                'px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-medium',
                trigger.lastRunStatus === 'completed' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                trigger.lastRunStatus === 'failed' && 'bg-destructive/10 text-destructive',
                trigger.lastRunStatus === 'skipped' && 'bg-muted text-muted-foreground',
              )}
            >
              {trigger.lastRunStatus}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {cadence}
          {trigger.targetKind === 'session'
            ? ' · sends to a chat'
            : trigger.provider && ` · ${findProvider(trigger.provider)?.name ?? trigger.provider}`}
          {trigger.lastFiredAt && ` · ran ${ranAgo(trigger.lastFiredAt)}`}
        </p>
      </button>

    </div>
  );
}

/** "now", "5m ago", "3d ago", or a date for anything older than a month. */
function ranAgo(at: string): string {
  const rel = formatCompactRelative(at);
  return rel === 'now' || /^[A-Z]/.test(rel) ? rel : `${rel} ago`;
}
