/**
 * The morning deck cron — opt-in overnight pre-bake.
 *
 * Built on the existing scheduler (`src/lib/scheduler/runner.ts`): an
 * orchestrator-targeted `cron` schedule that fires at the user's chosen local
 * time and asks the orchestrator to refresh today's deck. This is the "it's
 * already right before you wake" path; the lazy first-look ensure remains the
 * load-bearing guarantee (the scheduler only ticks while the app is running).
 *
 * Default off — the user opts in via the conductor toggle.
 */

import {
  findScheduleByName,
  createSchedule,
  updateSchedule,
  getOrCreateDefaultOrchestrator,
} from '@/lib/db/queries';
import { computeNextRun } from '@/lib/scheduler/cron';
import type { ScheduleRecord } from '@/db/types';

export const MORNING_DECK_SCHEDULE_NAME = 'Morning deck refresh';
const DEFAULT_TIME = '04:00';

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

export function getMorningDeckSchedule(): ScheduleRecord | null {
  return findScheduleByName(MORNING_DECK_SCHEDULE_NAME, null) ?? null;
}

export function getMorningDeckConfig(): MorningDeckConfig {
  const s = getMorningDeckSchedule();
  if (!s) return { enabled: false, time: DEFAULT_TIME, timezone: localTimezone() };
  return { enabled: s.enabled, time: cronToTime(s.cronExpression), timezone: s.timezone ?? localTimezone() };
}

/**
 * Create or update the morning deck schedule. Idempotent — safe to call
 * repeatedly. Returns the resulting config.
 */
export function setMorningDeckConfig(input: { enabled?: boolean; time?: string }): MorningDeckConfig {
  const existing = getMorningDeckSchedule();
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
    updateSchedule(existing.id, { enabled, cronExpression, timezone, nextRunAt });
  } else {
    createSchedule({
      name: MORNING_DECK_SCHEDULE_NAME,
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
