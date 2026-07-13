/**
 * App-managed stream triage triggers (spec §3.9), built on the existing
 * scheduler + reserved-sentinel pattern (src/lib/triggers/reserved.ts):
 *
 *   1. Debounce — a `kind:'at'` row whose runAt the capture path keeps
 *      pushing to now+20min. Row-based, so the pending timer survives
 *      restarts. The threshold rule sets it to fire immediately.
 *   2. Morning sweep — cron before the deck pre-bake.
 *   3. Weekly meta-digest — cron, Sunday afternoon.
 *
 * All three are visible in the Triggers UI, schedule-editable, and
 * disable-able (reserved rows block delete; disable is the off switch).
 *
 * NOTE: anything that transitively loads the executor (`dispatchRun`) is
 * imported dynamically — this module is CLI-reachable via the registry.
 */

import {
  getTrigger,
  createTrigger,
  updateTrigger,
  listStream,
  getOrCreateDefaultOrchestrator,
  getStreamAutonomy,
  setStreamAutonomy,
} from '@/lib/db/queries';
import { RESERVED_TRIGGER_IDS } from '@/lib/triggers/reserved';
import { computeNextRun } from '@/lib/scheduler/cron';
import { SWEEP_TRIGGER_PROMPT, WEEKLY_DIGEST_TRIGGER_PROMPT } from './prompt';
import { SWEEP_DEBOUNCE_MINUTES, SWEEP_PENDING_THRESHOLD } from './constants';

export const STREAM_DEBOUNCE_TRIGGER_NAME = 'Stream triage sweep';
export const MORNING_STREAM_TRIGGER_NAME = 'Morning stream triage';
export const WEEKLY_STREAM_DIGEST_TRIGGER_NAME = 'Weekly stream digest';

/** Before the 04:00 deck pre-bake so the deck sees fresh triage output. */
const MORNING_SWEEP_TIME_CRON = '30 3 * * *';
/** Sunday 16:00 local. */
const WEEKLY_DIGEST_CRON = '0 16 * * 0';

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Create-if-absent seeding, called once per server boot from
 * instrumentation.ts. Never flips `enabled` on existing rows — a user's
 * disable survives reboots.
 */
export function ensureStreamTriageTriggers(): void {
  const timezone = localTimezone();
  const orchestrator = getOrCreateDefaultOrchestrator();

  if (!getTrigger(RESERVED_TRIGGER_IDS.streamSweepDebounce)) {
    createTrigger({
      id: RESERVED_TRIGGER_IDS.streamSweepDebounce,
      name: STREAM_DEBOUNCE_TRIGGER_NAME,
      description:
        'Triages new captures a short while after you stop capturing. Each new capture pushes the timer.',
      enabled: true,
      agentId: orchestrator.id,
      workspaceId: null,
      targetKind: 'orchestrator',
      prompt: SWEEP_TRIGGER_PROMPT,
      kind: 'at',
      runAt: null,
      timezone,
      nextRunAt: null, // armed by the first capture
    });
  }

  if (!getTrigger(RESERVED_TRIGGER_IDS.morningStreamSweep)) {
    createTrigger({
      id: RESERVED_TRIGGER_IDS.morningStreamSweep,
      name: MORNING_STREAM_TRIGGER_NAME,
      description: 'Triages anything still waiting in the stream before the deck is prepared.',
      enabled: true,
      agentId: orchestrator.id,
      workspaceId: null,
      targetKind: 'orchestrator',
      prompt: SWEEP_TRIGGER_PROMPT,
      kind: 'cron',
      cronExpression: MORNING_SWEEP_TIME_CRON,
      timezone,
      nextRunAt: computeNextRun({
        kind: 'cron',
        cronExpression: MORNING_SWEEP_TIME_CRON,
        intervalSeconds: null,
        runAt: null,
        timezone,
        lastFiredAt: null,
      }),
    });
  }

  if (!getTrigger(RESERVED_TRIGGER_IDS.weeklyStreamDigest)) {
    createTrigger({
      id: RESERVED_TRIGGER_IDS.weeklyStreamDigest,
      name: WEEKLY_STREAM_DIGEST_TRIGGER_NAME,
      description: 'A weekly look at how stream triage went, with any autonomy offers.',
      enabled: true,
      agentId: orchestrator.id,
      workspaceId: null,
      targetKind: 'orchestrator',
      prompt: WEEKLY_DIGEST_TRIGGER_PROMPT,
      kind: 'cron',
      cronExpression: WEEKLY_DIGEST_CRON,
      timezone,
      nextRunAt: computeNextRun({
        kind: 'cron',
        cronExpression: WEEKLY_DIGEST_CRON,
        intervalSeconds: null,
        runAt: null,
        timezone,
        lastFiredAt: null,
      }),
    });
  }
}

/**
 * The rolling debounce, called after every capture (spec §3.9): push the
 * sweep to now+20min; at or past the pending threshold, fire now instead.
 * Row-based so it survives restarts; the 60s scheduler tick picks it up.
 * No-op when the user disabled the trigger — their off switch is real.
 */
export function bumpStreamSweepDebounce(now: Date = new Date()): void {
  const trigger = getTrigger(RESERVED_TRIGGER_IDS.streamSweepDebounce);
  if (!trigger || !trigger.enabled) return;

  const pendingCount = listStream({ status: 'pending', limit: 1000 }).length;
  const fireAt =
    pendingCount >= SWEEP_PENDING_THRESHOLD
      ? now
      : new Date(now.getTime() + SWEEP_DEBOUNCE_MINUTES * 60_000);
  const iso = fireAt.toISOString();
  updateTrigger(trigger.id, { runAt: iso, nextRunAt: iso });
}

/**
 * Immediate sweep dispatch, bypassing the tick — the manual Triage button
 * and the lane-1 urgency path. `payloadNote` is appended to the sweep
 * prompt (e.g. "URGENT: focus on item <id>"). Returns the run + session or
 * null when dispatch could not start.
 */
export async function dispatchImmediateSweep(
  payloadNote?: string,
): Promise<{ runId: string; chatSessionId: string | null } | null> {
  const trigger = getTrigger(RESERVED_TRIGGER_IDS.streamSweepDebounce);
  if (!trigger) return null;
  // Executor transitively loads @agentex/agent — dynamic import only
  // (see project rule on the tsx CLI boot graph).
  const { dispatchRun } = await import('@/lib/runs/dispatch');
  const { run, chatSession } = await dispatchRun({
    trigger,
    triggerKind: 'manual',
    triggerPayload: payloadNote ?? null,
  });
  return { runId: run.id, chatSessionId: chatSession?.id ?? null };
}

// ── The single automation-level control (spec §3.15: no toggle wall) ──
//
//   handle_obvious    — kill switch off; sweeps run on their cadence and
//                       apply what the user has delegated (the default)
//   review_everything — sweeps still run, but everything is proposed
//   manual_only       — everything proposes AND the automatic cadences are
//                       off; triage runs only when the user asks

export type StreamAutomationMode = 'handle_obvious' | 'review_everything' | 'manual_only';

export function getStreamAutomationMode(): StreamAutomationMode {
  if (!getStreamAutonomy().killSwitch) return 'handle_obvious';
  const debounce = getTrigger(RESERVED_TRIGGER_IDS.streamSweepDebounce);
  const morning = getTrigger(RESERVED_TRIGGER_IDS.morningStreamSweep);
  return debounce?.enabled || morning?.enabled ? 'review_everything' : 'manual_only';
}

export function setStreamAutomationMode(mode: StreamAutomationMode): StreamAutomationMode {
  setStreamAutonomy({ killSwitch: mode !== 'handle_obvious' });
  const cadenceEnabled = mode !== 'manual_only';
  for (const id of [RESERVED_TRIGGER_IDS.streamSweepDebounce, RESERVED_TRIGGER_IDS.morningStreamSweep]) {
    const trigger = getTrigger(id);
    if (trigger && trigger.enabled !== cadenceEnabled) {
      updateTrigger(id, { enabled: cadenceEnabled });
    }
  }
  return getStreamAutomationMode();
}

/**
 * Capture-side hook: everything that should happen when a new stream item
 * lands. Debounce bump is synchronous and cheap; the urgency lane runs
 * fire-and-forget — it must never delay or fail a capture.
 */
export function onStreamCaptured(itemId: string): void {
  try {
    bumpStreamSweepDebounce();
  } catch (err) {
    console.warn('[stream-triage] debounce bump failed:', err);
  }
  void (async () => {
    try {
      const { runUrgencyLane } = await import('./urgency');
      await runUrgencyLane(itemId);
    } catch (err) {
      console.warn('[stream-triage] urgency lane failed:', err);
    }
  })();
}
