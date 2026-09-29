/**
 * How the app draws a chat's live activity, everywhere a status dot appears
 * (rail rows, chat tabs, the Agents view, the execution header, the
 * background-task strip). Two states that must never look alike:
 *
 *   - working: the agent is running a turn right now. Green, pulsing.
 *   - background: the turn is over, but something the agent started is
 *     still running (a dev server, a long test run). Sky blue, a ring, and
 *     never pulsing, because nothing is waiting on the agent.
 *
 * Pulse means the agent. Sky means something running on its own.
 */

/** A small ring for "background work running". Size it with the caller's w/h classes. */
export const BACKGROUND_DOT = 'rounded-full bg-transparent ring-[1.5px] ring-inset ring-sky-500';

/**
 * The unread dot for a chat that is also running background work: the amber
 * dot with a sky ring around it, so both facts read at a glance.
 */
export const UNREAD_WITH_BACKGROUND_DOT = 'rounded-full bg-amber-500 ring-[1.5px] ring-sky-500 ring-offset-1 ring-offset-background';

export const BACKGROUND_LABEL = 'Background task running';
