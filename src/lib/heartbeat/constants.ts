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

export const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 1800;

/** The shortest gap between check-ins. Each one is a whole agent session. */
export const MIN_HEARTBEAT_INTERVAL_SECONDS = 300;

/** Where "Between" starts when someone limits the hours. The default is no limit. */
export const HEARTBEAT_LIMITED_HOURS_START = '09:00';
export const HEARTBEAT_LIMITED_HOURS_END = '21:00';

/**
 * A check-in that runs this long is stuck. Nothing else should wait on it, and
 * `skip_if_running` would otherwise hold every later check-in behind it.
 */
export const HEARTBEAT_TIMEOUT_SECONDS = 1800;

/** The exact reply that means "nothing needed attention and I changed nothing". */
export const HEARTBEAT_QUIET_REPLY = 'HEARTBEAT_OK';

/** The main agent's reply when a check-in's note doesn't need to reach the user. Never shown or pushed. */
export const NO_MESSAGE_REPLY = 'NO_REPLY';

/** `runs.statusReason` on a completed check-in that had nothing to pass along. */
export const HEARTBEAT_QUIET_REASON = 'heartbeat_quiet';

/** `runs.statusReason` on a completed check-in that told the main agent something right away. */
export const HEARTBEAT_TOLD_REASON = 'heartbeat_told';

/** `runs.statusReason` on a completed check-in that saved something for later. */
export const HEARTBEAT_HELD_REASON = 'heartbeat_held';

/** How long a check-in is told what earlier check-ins raised, so it doesn't raise them again. */
export const HEARTBEAT_MEMORY_DAYS = 3;

/** `runs.summary` on a quiet check-in, in place of the raw reply token. */
export const HEARTBEAT_QUIET_SUMMARY = 'Nothing needed';

/**
 * Seeded into the trigger's prompt on first boot and restored by "Reset to
 * default". The user owns it after that. All of the heartbeat's rhythm lives
 * here, so tuning it is editing text: each check-in is told the time and what
 * earlier ones did, which is what lets "once" and "up to twice" work. The tidy
 * fills gaps and clears clutter on its own, never overrules something the
 * person chose, and doesn't ask: the person shouldn't have to maintain a system.
 */
export const DEFAULT_HEARTBEAT_INSTRUCTIONS = `Every check-in:
- Review my emails since the last check-in, plus a few minutes of overlap so none are missed. The goal isn't to find things, it's to find the right things, so restraint is important, and so is sizing the impact of an email. A good heuristic: if it can't wait until the next check-in, surface it for me.
- Look for chats that stopped without finishing and aren't waiting on me. If the next step is clear and safe, tell the chat to continue. If not, tell me what's stuck.

Once overnight, on the first check-in after 3:00 AM, tidy up, at most 10 changes a night:
- Archive tasks that are clearly dead: blank, gibberish, or an exact duplicate.
- Move Todo tasks last updated more than 6 months ago to Consider, unless they have a deadline or repeat.
- File tasks with no area when the right area is obvious.
- Leave everything else alone. Never change an area, rank or date I've set.

Once each morning, on the first check-in after 7:00 AM:
- Tell me the few decisions that would unblock the most work, with what you recommend for each, so I can answer in a word.
- Tell me about anything due in the next 2 days that isn't moving.
- Say in one line what you tidied. Don't ask me about it.

Up to twice a day, when I have nothing waiting to review:
- Offer one task an agent could finish on its own. Prefer ones with a deadline or on today's deck.`;
