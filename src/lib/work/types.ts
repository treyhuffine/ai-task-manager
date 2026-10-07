/**
 * The work view's read model (docs/work-view.md): what you and your agents did
 * over a range of days, shaped for the calendar. Client-safe, no imports.
 *
 * Times are ISO instants. Days are server-local dates (the server and the
 * person share a machine, like the calendar's own day shape).
 */

/** One commit, sized like an engineer would estimate it. */
export interface WorkCommit {
  hash: string;
  at: string;
  subject: string;
  agentId: string | null;
  /** Changed lines that count: generated, lock and data files left out. */
  lines: number;
  /** What a person would need for it, by size (`commitEffortHours`). */
  effortHours: number;
}

/** A chat's share of a span. */
export interface WorkChat {
  sessionId: string;
  executionId: string | null;
  label: string;
  /** Agent time in this span, minutes. */
  agentMinutes: number;
  /** You sent at least one message. */
  withYou: boolean;
  /** Started by a schedule or trigger. */
  scheduled: boolean;
}

/**
 * One agent's continuous stretch of work on a day: its chats' blocks merged
 * where they overlap, so parallel chats in one agent read as one span.
 */
export interface WorkSpan {
  id: string;
  /** Null: Ri's own main chat. */
  agentId: string | null;
  start: string;
  end: string;
  agentMinutes: number;
  /** Minutes of your sittings that overlap it. */
  withYouMinutes: number;
  chats: WorkChat[];
  commits: WorkCommit[];
  /** Commits' effort, or agent time where nothing was committed. */
  personHours: number;
}

export interface WorkStats {
  /** Your sittings: your messages, 30 minutes of quiet ends one. */
  handsOnMinutes: number;
  /** Agents running, summed across parallel chats. */
  agentMinutes: number;
  /** Agent time while you weren't hands-on anywhere (outside your sittings). */
  whileAwayMinutes: number;
  /** Wall clock with any work running, overlaps counted once. */
  activeMinutes: number;
  /** Human time for the same work, in hours (docs/work-view.md, "Human time"). */
  personHours: number;
  /** The share of `personHours` from commits. */
  codeHours: number;
  /** Agent minutes in the chats those commits came from. */
  codeAgentMinutes: number;
  commits: number;
  agents: number;
  chats: number;
  agentWords: number;
  yourWords: number;
  /** The most agents' chats working at once, and when. */
  peak: { count: number; at: string } | null;
}

export interface WorkDay {
  date: string;
  spans: WorkSpan[];
  /** Commits no span covers, still counted (work done between chats). */
  looseCommits: WorkCommit[];
  /** Each chat's stretch of work on the day: the ribbon counts these at once. */
  blocks: Array<{ sessionId: string; agentId: string | null; start: string; end: string }>;
  /** When you were hands-on (your sittings) on the day. */
  sittings: Array<{ start: string; end: string }>;
  tasksDone: Array<{ id: string; title: string; at: string }>;
  executionsFinished: Array<{ id: string; label: string; agentId: string | null; at: string }>;
  stats: WorkStats;
}

export interface WorkAgent {
  id: string | null;
  name: string;
  emoji: string | null;
  /** Series slot for its color: 1 to 8, or 0 for "Other" (`agentSlot`). */
  color: number;
  agentMinutes: number;
  personHours: number;
  commits: number;
}

export interface WorkRange {
  start: string;
  days: number;
  generatedAt: string;
  dayList: WorkDay[];
  totals: WorkStats;
  agents: WorkAgent[];
  /** The three-line report: shipped, where time went, leverage. */
  report: string[];
}
