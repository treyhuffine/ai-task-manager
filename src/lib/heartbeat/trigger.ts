/**
 * The heartbeat trigger: the fifth app-managed ("reserved") trigger.
 *
 * Every heartbeat setting lives on this one row: instructions (`prompt`),
 * cadence (`intervalSeconds`), active hours, timezone, harness, model, effort,
 * and result delivery. Nothing else stores heartbeat state. The scheduler
 * fires it like any `every` trigger; the dispatcher wraps its prompt in the
 * ground rules (prompt.ts) and archives quiet check-ins (quiet.ts).
 *
 * Seeded off. The user turns it on from Settings > Heartbeat or the deck chip.
 * See docs/heartbeat-spec.md.
 *
 * CLI-reachable through the registry (get_heartbeat / update_heartbeat), so
 * nothing here may statically import the executor.
 */

import {
  createTrigger,
  defaultTriggerHarness,
  findActiveRunForTrigger,
  findTriggerByName,
  getChatSession,
  getTrigger,
  getUserState,
  listRuns,
  updateTrigger,
} from '@/lib/db/queries';
import { RESERVED_TRIGGER_IDS } from '@/lib/triggers/reserved';
import { isWithinActiveHours } from '@/lib/scheduler/cron';
import { isSessionUnread } from '@/lib/utils/session-sort';
import type { RunRecord, TriggerRecord, UpdateTriggerInput } from '@/db/types';
import {
  DEFAULT_HEARTBEAT_ACTIVE_HOURS_END,
  DEFAULT_HEARTBEAT_ACTIVE_HOURS_START,
  DEFAULT_HEARTBEAT_INSTRUCTIONS,
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  HEARTBEAT_FALLBACK_TRIGGER_NAME,
  HEARTBEAT_TIMEOUT_SECONDS,
  HEARTBEAT_TRIGGER_DESCRIPTION,
  HEARTBEAT_TRIGGER_NAME,
} from './constants';
import { isQuietHeartbeatRun } from './quiet';
import type { HeartbeatCheckIn, HeartbeatConfig, HeartbeatPatch } from './types';

export const HEARTBEAT_TRIGGER_ID = RESERVED_TRIGGER_IDS.heartbeat;

function serverTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The user's chosen timezone (Settings > General), else the host's. */
function defaultTimezone(): string {
  return getUserState()?.timezone || serverTimezone();
}

/**
 * Create the reserved heartbeat row if it's missing. Create-if-absent only: it
 * never flips `enabled` on an existing row, so turning it off survives
 * restarts. Called once per server boot from instrumentation.ts, and lazily by
 * `getHeartbeatConfig` so a CLI on a fresh database sees it too.
 */
export function ensureHeartbeatTrigger(): TriggerRecord | null {
  const existing = getTrigger(HEARTBEAT_TRIGGER_ID);
  if (existing) return existing;

  // The brain-level name index is unique. If the user already made their own
  // trigger called "Heartbeat", leave it alone and take the fallback name.
  let name = HEARTBEAT_TRIGGER_NAME;
  if (findTriggerByName(name, null)) name = HEARTBEAT_FALLBACK_TRIGGER_NAME;
  if (findTriggerByName(name, null)) {
    console.warn(`[heartbeat] both "${HEARTBEAT_TRIGGER_NAME}" and "${name}" are taken; not seeding`);
    return null;
  }

  return createTrigger({
    id: HEARTBEAT_TRIGGER_ID,
    name,
    description: HEARTBEAT_TRIGGER_DESCRIPTION,
    enabled: false,
    harness: defaultTriggerHarness(),
    workspaceId: null,
    targetKind: 'orchestrator',
    prompt: DEFAULT_HEARTBEAT_INSTRUCTIONS,
    kind: 'every',
    intervalSeconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    timezone: defaultTimezone(),
    activeHoursStart: DEFAULT_HEARTBEAT_ACTIVE_HOURS_START,
    activeHoursEnd: DEFAULT_HEARTBEAT_ACTIVE_HOURS_END,
    concurrencyPolicy: 'skip_if_running',
    catchUpPolicy: 'skip_missed',
    timeoutSeconds: HEARTBEAT_TIMEOUT_SECONDS,
    deliverResultTo: [],
    // Scheduled only once it's turned on (see scheduleFirstCheckIn).
    nextRunAt: null,
  });
}

export function getHeartbeatTrigger(): TriggerRecord | null {
  return getTrigger(HEARTBEAT_TRIGGER_ID) ?? null;
}

type HoursWindow = Pick<TriggerRecord, 'activeHoursStart' | 'activeHoursEnd' | 'timezone'>;

/**
 * The first minute at or after `from` inside the active hours. The scheduler
 * silently consumes out-of-hours slots but keeps the cadence anchored to them,
 * so an anchor outside the window would never fire for a daily cadence (22:30
 * every day with hours 09:00 to 21:00). Anchoring the first check-in inside
 * the window keeps every later slot there too.
 */
export function firstInWindow(from: Date, hours: HoursWindow): Date {
  if (isWithinActiveHours(hours, from)) return from;
  let at = from;
  for (let i = 0; i < 2 * 24 * 60; i++) {
    at = new Date(at.getTime() + 60_000);
    if (isWithinActiveHours(hours, at)) return at;
  }
  return from; // an empty window never fires; nothing better to pick
}

/**
 * When the first check-in after turning it on (or rescheduling) should run:
 * one interval out, moved into the active hours. When it's switched on
 * outside the hours, the window opening can come sooner than that (a daily
 * heartbeat turned on at 22:30 should check in at 09:00 tomorrow, not the
 * morning after), so take whichever is earlier.
 */
export function scheduleFirstCheckIn(
  intervalSeconds: number,
  hours: HoursWindow,
  now: Date = new Date(),
): string {
  const oneInterval = firstInWindow(new Date(now.getTime() + intervalSeconds * 1000), hours);
  if (isWithinActiveHours(hours, now)) return oneInterval.toISOString();
  const nextOpening = firstInWindow(now, hours);
  return (nextOpening < oneInterval ? nextOpening : oneInterval).toISOString();
}

/**
 * The next check-in that will actually run: the stored slot, stepped past any
 * slots the scheduler will skip for falling outside the active hours.
 */
export function nextCheckInAt(trigger: TriggerRecord): string | null {
  if (!trigger.enabled || !trigger.nextRunAt) return null;
  const step = (trigger.intervalSeconds ?? 0) * 1000;
  if (step <= 0) return null;
  let at = new Date(trigger.nextRunAt);
  for (let i = 0; i < 500; i++) {
    if (isWithinActiveHours(trigger, at)) return at.toISOString();
    at = new Date(at.getTime() + step);
  }
  return null;
}

function toCheckIn(run: RunRecord): HeartbeatCheckIn {
  const chat = run.chatSessionId ? getChatSession(run.chatSessionId) : undefined;
  return {
    runId: run.id,
    at: run.startedAt ?? run.queuedAt,
    completedAt: run.completedAt ?? null,
    status: run.status,
    quiet: isQuietHeartbeatRun(run),
    chatSessionId: run.chatSessionId ?? null,
    unread: !!chat && chat.status === 'active' && isSessionUnread(chat),
    changedCount: (run.artifactRefs ?? []).length,
    summary: run.summary ?? null,
    errorMessage: run.errorMessage ?? null,
  };
}

/** The heartbeat's settings and status, seeding the row first if needed. */
export function getHeartbeatConfig(): HeartbeatConfig {
  const trigger = ensureHeartbeatTrigger() ?? getHeartbeatTrigger();
  if (!trigger) throw new Error('The heartbeat trigger could not be created');
  const [last] = listRuns({
    triggerId: trigger.id,
    status: ['completed', 'failed', 'cancelled'],
    limit: 1,
  });
  return {
    triggerId: trigger.id,
    enabled: trigger.enabled,
    instructions: trigger.prompt,
    instructionsAreDefault: trigger.prompt.trim() === DEFAULT_HEARTBEAT_INSTRUCTIONS.trim(),
    intervalSeconds: trigger.intervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    activeHoursStart: trigger.activeHoursStart ?? null,
    activeHoursEnd: trigger.activeHoursEnd ?? null,
    timezone: trigger.timezone ?? null,
    provider: trigger.harness,
    model: trigger.model ?? null,
    effort: trigger.effort ?? null,
    deliverResultTo: trigger.deliverResultTo ?? [],
    nextCheckInAt: nextCheckInAt(trigger),
    running: !!findActiveRunForTrigger(trigger.id),
    lastCheckIn: last ? toCheckIn(last) : null,
    disabledReason: trigger.disabledReason ?? null,
    consecutiveFailures: trigger.consecutiveFailures,
  };
}

/**
 * Apply a validated patch (the `update_heartbeat` action validates first).
 * Turning it on, or changing when it runs, reschedules the next check-in one
 * interval out and inside the active hours. Turning it on also clears an
 * app-set `disabledReason` (e.g. the budget pause), since the user just chose
 * to run it.
 */
export function updateHeartbeat(patch: HeartbeatPatch, now: Date = new Date()): HeartbeatConfig {
  const current = ensureHeartbeatTrigger() ?? getHeartbeatTrigger();
  if (!current) throw new Error('The heartbeat trigger could not be created');

  const update: UpdateTriggerInput = {};
  if (patch.instructions !== undefined) update.prompt = patch.instructions.trim();
  if (patch.intervalSeconds !== undefined) update.intervalSeconds = patch.intervalSeconds;
  if (patch.activeHoursStart !== undefined) update.activeHoursStart = patch.activeHoursStart;
  if (patch.activeHoursEnd !== undefined) update.activeHoursEnd = patch.activeHoursEnd;
  if (patch.timezone !== undefined) update.timezone = patch.timezone;
  if (patch.harness !== undefined) update.harness = patch.harness;
  if (patch.model !== undefined) update.model = patch.model;
  if (patch.effort !== undefined) update.effort = patch.effort;
  if (patch.deliverResultTo !== undefined) update.deliverResultTo = patch.deliverResultTo;
  if (patch.enabled !== undefined) update.enabled = patch.enabled;

  const turningOn = patch.enabled === true && !current.enabled;
  // Only a real change reschedules, so retrying the same patch is a no-op.
  const timingChanged =
    (patch.intervalSeconds !== undefined && patch.intervalSeconds !== current.intervalSeconds) ||
    (patch.activeHoursStart !== undefined && patch.activeHoursStart !== current.activeHoursStart) ||
    (patch.activeHoursEnd !== undefined && patch.activeHoursEnd !== current.activeHoursEnd) ||
    (patch.timezone !== undefined && patch.timezone !== current.timezone);
  const enabledAfter = patch.enabled ?? current.enabled;

  if (turningOn) update.disabledReason = null;
  if (enabledAfter && (turningOn || timingChanged)) {
    update.nextRunAt = scheduleFirstCheckIn(
      update.intervalSeconds ?? current.intervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
      {
        activeHoursStart: update.activeHoursStart !== undefined ? update.activeHoursStart : current.activeHoursStart,
        activeHoursEnd: update.activeHoursEnd !== undefined ? update.activeHoursEnd : current.activeHoursEnd,
        timezone: update.timezone ?? current.timezone,
      },
      now,
    );
  }

  if (Object.keys(update).length > 0) updateTrigger(current.id, update);
  return getHeartbeatConfig();
}
