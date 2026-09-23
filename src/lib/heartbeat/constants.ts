/**
 * Heartbeat constants: the fixed identity, defaults, and the quiet-reply
 * contract. Pure values, no imports beyond app constants, so the CLI's static
 * graph, the scheduler, the notifier, and client components can all share them.
 *
 * See docs/heartbeat-spec.md.
 */

import { APP_NAME } from '@/constants/app';

export const HEARTBEAT_TRIGGER_NAME = 'Heartbeat';

/**
 * Used only when a user-created brain-level trigger already holds the name
 * "Heartbeat" (the name index is unique per scope). Never renames the user's row.
 */
export const HEARTBEAT_FALLBACK_TRIGGER_NAME = `${APP_NAME} heartbeat`;

export const HEARTBEAT_TRIGGER_DESCRIPTION = 'Checks in on your work on a schedule.';

/** The check-in cadences the settings offer, in seconds. */
export const HEARTBEAT_INTERVALS = [
  { seconds: 1800, label: '30 minutes' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 7200, label: '2 hours' },
  { seconds: 14400, label: '4 hours' },
  { seconds: 86400, label: 'Once a day' },
] as const;

export type HeartbeatIntervalSeconds = (typeof HEARTBEAT_INTERVALS)[number]['seconds'];

export const HEARTBEAT_INTERVAL_SECONDS: readonly number[] = HEARTBEAT_INTERVALS.map(
  (i) => i.seconds,
);

export function isHeartbeatInterval(seconds: number): seconds is HeartbeatIntervalSeconds {
  return HEARTBEAT_INTERVAL_SECONDS.includes(seconds);
}

export const DEFAULT_HEARTBEAT_INTERVAL_SECONDS: HeartbeatIntervalSeconds = 3600;
export const DEFAULT_HEARTBEAT_ACTIVE_HOURS_START = '09:00';
export const DEFAULT_HEARTBEAT_ACTIVE_HOURS_END = '21:00';

/**
 * A check-in that runs this long is stuck. Nothing else should wait on it, and
 * `skip_if_running` would otherwise hold every later check-in behind it.
 */
export const HEARTBEAT_TIMEOUT_SECONDS = 1800;

/** The exact reply that means "nothing needed attention and I changed nothing". */
export const HEARTBEAT_QUIET_REPLY = 'HEARTBEAT_OK';

/** `runs.statusReason` on a completed check-in that had nothing to report. */
export const HEARTBEAT_QUIET_REASON = 'heartbeat_quiet';

/** `runs.summary` on a quiet check-in, in place of the raw reply token. */
export const HEARTBEAT_QUIET_SUMMARY = 'Nothing needed';

/**
 * Seeded into the trigger's prompt on first boot and restored by "Reset to
 * default". The user owns it after that. Written as things to look for, so a
 * check-in with nothing to find ends quietly.
 */
export const DEFAULT_HEARTBEAT_INSTRUCTIONS = `Each check-in, look for:

- Todo or In progress tasks nobody has touched in 14 days. Ask me whether to do, snooze, or archive each one.
- Tasks with no area. Set the most likely area.
- Executions that failed or stopped without finishing that I haven't looked at.
- Tasks too vague for anyone to start. Ask me the one question that would make each one clear.
- Tasks an agent could finish end to end without my judgment. Offer to start them.

Keep each check-in to the five most important items.`;
