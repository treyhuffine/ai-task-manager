import { isSessionUnread } from '@/lib/utils/session-sort';

/**
 * The rules behind an agent in the agents-first rail
 * (docs/rail-agents-first.md). Pure, so the rows stay views.
 *
 * Two kinds of conversation live under an agent: its own (the main chat, the
 * agent talking to you) and its work (executions). Both have the same states,
 * and each row shows only its own: the agent's row says what the agent wants,
 * each execution's dot says what that execution wants.
 */

/** Quiet executions shown under an agent before the rest fold into a count. */
export const QUIET_THREADS = 3;

/**
 * Which of an agent's executions hang under it: every live one (needs you,
 * working, unread, pinned, or the one open right now), then the most recent
 * quiet ones up to `quiet`. Keeps the order they arrive in, which is the
 * rail's hotness order. `hidden` is what's left.
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

/**
 * What the agent's main chat is doing. Waiting on you wins over thinking (a
 * blocked turn is still a live process), and a new reply only counts once
 * the turn has ended.
 */
export type AgentActivity = 'waiting' | 'thinking' | 'replied' | null;

export function mainChatActivity(
  chat: { id: string; lastOutcomeEventAt: string | null; unreadMarkerAt: string | null; lastViewedAt: string | null } | null | undefined,
  pending: ReadonlySet<string>,
  streaming: ReadonlySet<string>,
): AgentActivity {
  if (!chat) return null;
  if (pending.has(chat.id)) return 'waiting';
  if (streaming.has(chat.id)) return 'thinking';
  if (isSessionUnread(chat)) return 'replied';
  return null;
}

/**
 * Whether the agent itself wants you, and in which attention bucket it
 * belongs: waiting on you is `needsApproval`, a new reply is `unread`.
 * Thinking is activity, not attention, so it never counts as wanting you.
 */
export function agentAttention(activity: AgentActivity): 'needsApproval' | 'unread' | null {
  if (activity === 'waiting') return 'needsApproval';
  if (activity === 'replied') return 'unread';
  return null;
}

export type VoiceTone = 'attention' | 'working' | 'strong' | 'muted';
export interface Voice {
  text: string;
  tone: VoiceTone;
}

/**
 * The agent's second line: what it's saying, so you can tell from the rail
 * whether to go in. The question it's waiting on, that it's thinking, its
 * new reply, or (quiet) what it last said. An agent that hasn't spoken yet
 * shows its purpose.
 */
export function agentVoice(input: {
  activity: AgentActivity;
  waitingOn: string | null;
  preview: string | null;
  purpose: string | null;
}): Voice {
  if (input.activity === 'waiting') return { text: input.waitingOn ?? 'Waiting on you', tone: 'attention' };
  if (input.activity === 'thinking') return { text: 'Thinking…', tone: 'working' };
  if (input.activity === 'replied') return { text: input.preview ?? 'New reply', tone: 'strong' };
  if (input.preview) return { text: input.preview, tone: 'muted' };
  const purpose = input.purpose?.trim();
  return { text: purpose || 'No messages yet', tone: 'muted' };
}

export interface SummarySegment {
  text: string;
  tone: 'attention' | 'working' | 'muted';
}

/**
 * The one line an agent's executions fold into when hidden: how many, then
 * what wants you and what's running, so hiding them never hides that.
 */
export function threadSummary(input: { total: number; needsYou: number; working: number }): SummarySegment[] {
  const segments: SummarySegment[] = [
    { text: `${input.total} execution${input.total === 1 ? '' : 's'}`, tone: 'muted' },
  ];
  if (input.needsYou > 0) segments.push({ text: `${input.needsYou} need${input.needsYou === 1 ? 's' : ''} you`, tone: 'attention' });
  if (input.working > 0) segments.push({ text: `${input.working} working`, tone: 'working' });
  return segments;
}
