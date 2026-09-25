/**
 * Typed emission helpers the app's lifecycle code calls at durable state transitions (spec §2.4).
 * They build the `NotificationEvent` (stable dedupeKey, title/body/deep-link) and hand it to
 * `notify()`. All best-effort — callers `void` them; nothing here throws into the lifecycle path.
 */
import { getRun, getExecution, getTrigger, getChatSession } from '@/lib/db/queries';
import { notify, queueNotification, type NotifyOptions, type QueuedNotification } from './notify';
import type { NotificationEvent } from './types';
import { isQuietHeartbeatRun } from '@/lib/heartbeat/quiet';

/**
 * A run reached a terminal status. Picks the event by target:
 *   - orchestrator-target scheduled run (no execution) → `trigger.run_completed` (binding routing,
 *     delivered to the trigger's `deliverResultTo[]`);
 *   - any execution run (manual or scheduled) → `execution.finished` (matrix routing).
 * dedupeKey is the runId, so calling this from multiple terminal call-sites never double-sends.
 */
export function runTerminalNotification(runId: string): { event: NotificationEvent; options?: NotifyOptions } | null {
  const run = getRun(runId);
  if (!run || (run.status !== 'completed' && run.status !== 'failed')) return null;
  // A quiet heartbeat check-in had nothing to report. Delivering its reply
  // would ping the user every interval with "nothing needed".
  if (isQuietHeartbeatRun(run)) return null;
  const ok = run.status === 'completed';
  const trigger = run.triggerId ? getTrigger(run.triggerId) : undefined;

  if (!run.executionId && trigger?.targetKind === 'orchestrator') {
    const deliverTo = trigger.deliverResultTo ?? [];
    if (deliverTo.length === 0) return null; // digest not bound to any channel
    return {
      event: {
        type: 'trigger.run_completed',
        userId: trigger.userId,
        dedupeKey: `trigger.run_completed:${runId}`,
        title: trigger.name,
        body: run.summary ?? (ok ? 'Scheduled run completed.' : 'Scheduled run failed.'),
        url: `/triggers/${trigger.id}`,
      },
      options: { deliverTo },
    };
  }

  if (!run.executionId) return null;
  const execution = getExecution(run.executionId);
  if (!execution) return null;
  return {
    event: {
      type: 'execution.finished',
      userId: execution.userId,
      dedupeKey: `execution.finished:${runId}`,
      title: `${ok ? '✅' : '❌'} ${execution.label ?? 'Execution'}`,
      body: run.summary ?? (ok ? 'Execution completed.' : 'Execution failed.'),
      // Deep-link opens the chat where the transcript lives. The home route is
      // the only surface that renders a session (`?session=<chatSessionId>`);
      // there is no `/executions/<id>` page. `runs.chatSessionId` is the exact
      // chat that ran (null for orchestration/content chats → fall back to home).
      url: run.chatSessionId ? `/?session=${run.chatSessionId}` : '/',
    },
  };
}

/**
 * A run reached a terminal status: notify now. `queueRunTerminal` is the same notification
 * recorded inside a transaction, to send after commit.
 */
export async function notifyRunTerminal(runId: string): Promise<void> {
  const built = runTerminalNotification(runId);
  if (built) await notify(built.event, built.options);
}

export function queueRunTerminal(runId: string): QueuedNotification | null {
  const built = runTerminalNotification(runId);
  return built ? queueNotification(built.event, built.options) : null;
}

/** An agent asked the human for input (a permission/question request was persisted, spec §2.4). */
export interface NeedsInputArgs {
  sessionId: string;
  requestId: string;
  title: string;
  body: string;
}

function needsInputNotification(args: NeedsInputArgs): NotificationEvent | null {
  const session = getChatSession(args.sessionId);
  if (!session) return null;
  return {
    type: 'execution.needs_input',
    userId: session.userId,
    dedupeKey: `execution.needs_input:${args.requestId}`,
    title: args.title,
    body: args.body,
    // `?session=` opens the chat that needs input; `args.sessionId` is already
    // that chat's id (there is no `/executions/<id>` page).
    url: `/?session=${args.sessionId}`,
  };
}

export async function notifyNeedsInput(args: NeedsInputArgs): Promise<void> {
  const event = needsInputNotification(args);
  if (event) await notify(event);
}

/** The needs-input notification recorded inside a transaction, to send after commit. */
export function queueNeedsInput(args: NeedsInputArgs): QueuedNotification | null {
  const event = needsInputNotification(args);
  return event ? queueNotification(event) : null;
}
