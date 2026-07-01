/**
 * The morning deck cron — opt-in overnight pre-bake.
 *
 * Built on the existing scheduler (`src/lib/scheduler/runner.ts`): an
 * orchestrator-targeted `cron` trigger that fires at the user's chosen local
 * time and asks the orchestrator to refresh today's deck. This is the "it's
 * already right before you wake" path; the lazy first-look ensure remains the
 * load-bearing guarantee (the scheduler only ticks while the app is running).
 *
 * Default off — the user opts in via the conductor toggle.
 */

import {
  getTrigger,
  findTriggerByName,
  createTrigger,
  updateTrigger,
  deleteTrigger,
  getOrCreateDefaultOrchestrator,
} from '@/lib/db/queries';
import { computeNextRun } from '@/lib/scheduler/cron';
import { RESERVED_TRIGGER_IDS } from '@/lib/triggers/reserved';
import type { TriggerRecord } from '@/db/types';

export const MORNING_DECK_TRIGGER_NAME = 'Morning deck refresh';
const DEFAULT_TIME = '04:00';
/**
 * Whether the morning refresh is enabled the first time it is seeded. Lazy
 * first-look generation is the load-bearing guarantee regardless (see
 * ensure-todays-deck.ts); the cron only pre-bakes. On-by-default is safe:
 * `ensureTodaysDeck` dedupes, so a cron fire shifts the work earlier rather
 * than double-generating, and no-ops harmlessly when the host is asleep.
 */
const DEFAULT_MORNING_ENABLED = true;

const MORNING_PROMPT =
  'A new day has started. Refresh the deck for today: call the regenerate_deck action ' +
  "so it reconciles yesterday's deck into today (carry / defer / drop) and ranks by " +
  'priorities, hard deadlines, and the calendar, sized to the day. Keep it brief. This ' +
  'is an automated morning refresh, no commentary needed.';

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** 'HH:MM' → cron 'M H * * *'. */
function timeToCron(time: string): string {
  const [h, m] = time.split(':').map((x) => parseInt(x, 10));
  return `${Number.isFinite(m) ? m : 0} ${Number.isFinite(h) ? h : 4} * * *`;
}

/** cron 'M H * * *' → 'HH:MM'. */
function cronToTime(cron: string | null): string {
  if (!cron) return DEFAULT_TIME;
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 2) return DEFAULT_TIME;
  const m = parseInt(parts[0], 10);
  const h = parseInt(parts[1], 10);
  if (!Number.isFinite(m) || !Number.isFinite(h)) return DEFAULT_TIME;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface MorningDeckConfig {
  enabled: boolean;
  /** Local HH:MM the refresh fires at. */
  time: string;
  timezone: string;
}

export function getMorningDeckTrigger(): TriggerRecord | null {
  return getTrigger(RESERVED_TRIGGER_IDS.morningDeck) ?? null;
}

export function getMorningDeckConfig(): MorningDeckConfig {
  const s = getMorningDeckTrigger();
  if (!s) return { enabled: false, time: DEFAULT_TIME, timezone: localTimezone() };
  return { enabled: s.enabled, time: cronToTime(s.cronExpression), timezone: s.timezone ?? localTimezone() };
}

/**
 * Create or update the morning deck trigger. Idempotent — safe to call
 * repeatedly. Returns the resulting config.
 */
export function setMorningDeckConfig(input: { enabled?: boolean; time?: string }): MorningDeckConfig {
  const existing = getMorningDeckTrigger();
  const time = input.time ?? (existing ? cronToTime(existing.cronExpression) : DEFAULT_TIME);
  const enabled = input.enabled ?? existing?.enabled ?? true;
  const timezone = existing?.timezone ?? localTimezone();
  const cronExpression = timeToCron(time);
  const nextRunAt = computeNextRun({
    kind: 'cron',
    cronExpression,
    intervalSeconds: null,
    runAt: null,
    timezone,
    lastFiredAt: null,
  });

  if (existing) {
    updateTrigger(existing.id, { enabled, cronExpression, timezone, nextRunAt });
  } else {
    createTrigger({
      id: RESERVED_TRIGGER_IDS.morningDeck,
      name: MORNING_DECK_TRIGGER_NAME,
      description: 'Auto-refreshes the deck each morning, reconciling yesterday into today.',
      enabled,
      agentId: getOrCreateDefaultOrchestrator().id,
      workspaceId: null,
      targetKind: 'orchestrator',
      prompt: MORNING_PROMPT,
      kind: 'cron',
      cronExpression,
      timezone,
      nextRunAt,
    });
  }
  return getMorningDeckConfig();
}

/**
 * Ensure the reserved morning-deck row exists. Called once per server process
 * (from instrumentation). Create-if-absent only — it never flips `enabled` on
 * an existing row, so a user's disable survives reboots.
 *
 * On the first boot after the reserved-id change, it adopts the legacy
 * name-linked row once: it copies that row's schedule into the sentinel row
 * and drops the stray. The stray is deleted BEFORE the sentinel is created so
 * the brain-level unique name index (`uniq_triggers_brain_name`) never sees
 * two "Morning deck refresh" rows at once. The stray's runs get trigger_id
 * nulled (ON DELETE SET NULL); run history survives. Idempotent, retry-safe.
 */
export function ensureMorningDeckTrigger(): void {
  if (getTrigger(RESERVED_TRIGGER_IDS.morningDeck)) return;

  const legacy = findTriggerByName(MORNING_DECK_TRIGGER_NAME, null);
  if (legacy) {
    const enabled = legacy.enabled;
    const time = cronToTime(legacy.cronExpression);
    deleteTrigger(legacy.id); // free the name before recreating under the sentinel id
    setMorningDeckConfig({ enabled, time });
    return;
  }

  setMorningDeckConfig({ enabled: DEFAULT_MORNING_ENABLED, time: DEFAULT_TIME });
}
