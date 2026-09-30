/**
 * The rules behind an agent's row in the agents-first rail
 * (docs/rail-agents-first.md). Pure, so the row stays a view.
 */

/** Quiet executions shown under an agent before the rest fold into a count. */
export const QUIET_THREADS = 3;

/**
 * Which of an agent's executions hang under it: every live one (needs you,
 * working, unread, pinned, or the one open right now), then the most recent
 * quiet ones up to `quiet`. Keeps the order they arrive in, which is the
 * rail's hotness order. `hidden` is what's left, one click away in the
 * agent's view.
 */
export function pickRailThreads<T>(
  sessions: readonly T[],
  isLive: (session: T) => boolean,
  quiet: number = QUIET_THREADS,
): { shown: T[]; hidden: number } {
  const shown: T[] = [];
  let quietShown = 0;
  for (const s of sessions) {
    if (isLive(s)) shown.push(s);
    else if (quietShown < quiet) {
      shown.push(s);
      quietShown++;
    }
  }
  return { shown, hidden: sessions.length - shown.length };
}

export type SummaryTone = 'attention' | 'working' | 'muted';
export interface SummarySegment {
  text: string;
  tone: SummaryTone;
}

/** What the agent's main chat is doing, from the runtime sets and its read state. */
export type MainChatActivity = 'waiting' | 'thinking' | 'replied' | null;

/**
 * The agent row's second line, in words. The agent itself first (its main
 * chat), then its work, needs-you before working. With nothing going on, its
 * purpose, else how much work it holds.
 */
export function agentSummary(input: {
  mainChat: MainChatActivity;
  needsYou: number;
  working: number;
  total: number;
  purpose: string | null;
}): SummarySegment[] {
  const segments: SummarySegment[] = [];
  if (input.mainChat === 'waiting') segments.push({ text: 'Waiting on you', tone: 'attention' });
  else if (input.mainChat === 'replied') segments.push({ text: 'New reply', tone: 'attention' });
  else if (input.mainChat === 'thinking') segments.push({ text: 'Thinking', tone: 'working' });
  if (input.needsYou > 0) segments.push({ text: `${input.needsYou} need${input.needsYou === 1 ? 's' : ''} you`, tone: 'attention' });
  if (input.working > 0) segments.push({ text: `${input.working} working`, tone: 'working' });
  if (segments.length > 0) return segments;
  const purpose = input.purpose?.trim();
  if (purpose) return [{ text: purpose, tone: 'muted' }];
  if (input.total > 0) return [{ text: `${input.total} execution${input.total === 1 ? '' : 's'}`, tone: 'muted' }];
  return [{ text: 'No work yet', tone: 'muted' }];
}
