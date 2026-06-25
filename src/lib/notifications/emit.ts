/**
 * Typed emission helpers the app's lifecycle code calls at durable state transitions (spec §2.4).
 * They build the `NotificationEvent` (stable dedupeKey, title/body/deep-link) and hand it to
 * `notify()`. All best-effort — callers `void` them; nothing here throws into the lifecycle path.
 */
import { getRun, getExecution, getSchedule, getChatSession } from '@/lib/db/queries';
import { notify } from './notify';

/**
 * A run reached a terminal status. Picks the event by target:
 *   - orchestrator-target scheduled run (no execution) → `schedule.run_completed` (binding routing,
 *     delivered to the schedule's `deliverResultTo[]`);
 *   - any execution run (manual or scheduled) → `execution.finished` (matrix routing).
 * dedupeKey is the runId, so calling this from multiple terminal call-sites never double-sends.
 */
export async function notifyRunTerminal(runId: string): Promise<void> {
  const run = getRun(runId);
  if (!run || (run.status !== 'completed' && run.status !== 'failed')) return;
  const ok = run.status === 'completed';
  const schedule = run.scheduleId ? getSchedule(run.scheduleId) : undefined;

  if (!run.executionId && schedule?.targetKind === 'orchestrator') {
    const deliverTo = schedule.deliverResultTo ?? [];
    if (deliverTo.length === 0) return; // digest not bound to any channel
    await notify(
      {
        type: 'schedule.run_completed',
        userId: schedule.userId,
        dedupeKey: `schedule.run_completed:${runId}`,
        title: schedule.name,
        body: run.summary ?? (ok ? 'Scheduled run completed.' : 'Scheduled run failed.'),
        url: `/schedules/${schedule.id}`,
      },
      { deliverTo },
    );
    return;
  }

  if (!run.executionId) return;
  const execution = getExecution(run.executionId);
  if (!execution) return;
  await notify({
    type: 'execution.finished',
    userId: execution.userId,
    dedupeKey: `execution.finished:${runId}`,
    title: `${ok ? '✅' : '❌'} ${execution.label ?? 'Execution'}`,
    body: run.summary ?? (ok ? 'Execution completed.' : 'Execution failed.'),
    url: `/executions/${execution.id}`,
  });
}

/** An agent asked the human for input (a permission/question request was persisted, spec §2.4). */
export async function notifyNeedsInput(args: {
  sessionId: string;
  requestId: string;
  title: string;
  body: string;
}): Promise<void> {
  const session = getChatSession(args.sessionId);
  if (!session) return;
  await notify({
    type: 'execution.needs_input',
    userId: session.userId,
    dedupeKey: `execution.needs_input:${args.requestId}`,
    title: args.title,
    body: args.body,
    url: session.executionId ? `/executions/${session.executionId}` : '/',
  });
}
