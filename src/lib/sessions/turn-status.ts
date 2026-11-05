/**
 * A chat's status line (docs/chat-status-lines.md): where the chat stands at
 * the end of its last turn, written by the agent itself through
 * `set_chat_status`. One short line, and whether it waits on the person,
 * how much of their time their part takes and what answering unblocks.
 *
 * Pure and dependency-free, so the schema, the server and every row that
 * draws a chat share it.
 */

/** How much of the person's time their part takes. */
export const TURN_STATUS_EFFORTS = ['quick', 'minutes', 'block'] as const;
export type TurnStatusEffort = (typeof TURN_STATUS_EFFORTS)[number];

export interface ChatTurnStatus {
  /** One line: where things stand, or what the person needs to do, verb first. */
  line: string;
  /** The agent is waiting on the person. The row's line reads stronger, and read or unread doesn't change. */
  needsYou: boolean;
  /** Their part's size, when it waits on them. */
  effort: TurnStatusEffort | null;
  /** What answering unblocks, briefly. */
  unblocks: string | null;
  /** When the agent set it. */
  at: string;
}

/**
 * The size, in the words a row shows. Each says it's the person's time: on its
 * own, "Few min" beside a row's "5m" read as how long ago.
 */
export const TURN_STATUS_EFFORT_LABEL: Record<TurnStatusEffort, string> = {
  quick: 'Quick for you',
  minutes: 'Few min for you',
  block: 'Needs your time',
};
