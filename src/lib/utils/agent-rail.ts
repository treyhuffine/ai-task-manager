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

interface VoiceInput {
  activity: AgentActivity;
  waitingOn: string | null;
  preview: string | null;
  purpose: string | null;
}

/**
 * The agent's second line: what it's saying, so you can tell from the rail
 * whether to go in. The question it's waiting on, that it's thinking, its
 * new reply, or (quiet) what it last said. An agent that hasn't spoken yet
 * shows its purpose, and one with no purpose either has no second line.
 * Nothing stands in for it: the line is about the agent's own chat, and
 * "No messages yet" under an agent read as the agent having no executions.
 */
export function agentVoice(input: VoiceInput & { activity: Exclude<AgentActivity, null> }): Voice;
export function agentVoice(input: VoiceInput): Voice | null;
export function agentVoice(input: VoiceInput): Voice | null {
  if (input.activity === 'waiting') return { text: input.waitingOn ?? 'Waiting on you', tone: 'attention' };
  if (input.activity === 'thinking') return { text: 'Thinking…', tone: 'working' };
  if (input.activity === 'replied') return { text: input.preview ?? 'New reply', tone: 'strong' };
  if (input.preview) return { text: input.preview, tone: 'muted' };
  const purpose = input.purpose?.trim();
  return purpose ? { text: purpose, tone: 'muted' } : null;
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

/**
 * One of an agent's chats as the agents-only rail sees it: no row of its
 * own, just the state its agent rolls up.
 */
export interface ThreadState {
  id: string;
  /** The chat's title, or null until its first message names it. */
  label: string | null;
  /** Blocked on you: a permission prompt or a question. */
  pending: boolean;
  /** A turn is running. */
  streaming: boolean;
  /** Something new since you last looked: a fresh outcome or Mark as unread. */
  unread: boolean;
}

export interface AgentRollup {
  /** The dot on the agent's icon, for the agent and its chats together. */
  activity: AgentActivity;
  /** What the dot means, for its tooltip. */
  activityLabel: string | null;
  /** The name goes bold: the agent or one of its chats wants you. */
  wantsYou: boolean;
  /** The second line: whatever explains the dot, or what the agent last said. */
  voice: Voice | null;
  /**
   * What Mark as read clears so the row stops wanting you: the main chat and
   * every unread chat under it. Empty when nothing is unread.
   */
  unreadIds: string[];
}

interface RollupInput {
  /** The agent's own state (`mainChatActivity`). */
  activity: AgentActivity;
  /** The main chat, when the agent has one, and whether it's unread. */
  mainChat: { id: string; unread: boolean } | null;
  waitingOn: string | null;
  preview: string | null;
  purpose: string | null;
  /** Its chats that count: active and not inactive. */
  threads: readonly ThreadState[];
}

const UNTITLED = 'Untitled';

/**
 * An agent in the agents-only rail (docs/rail-agents-first.md), where its
 * chats have no rows. The agent's row is the only place its work can say it
 * wants you, so the row stands for both: the agent's own state and its
 * chats', each chat read by the rail's usual rule (waiting on you wins over
 * working, unread counts once the turn is over).
 *
 * Wanting you beats working, so the dot is amber while anything waits or is
 * unread, green while something only runs. The line explains the dot, most
 * urgent first: the agent's question, a chat waiting on you, the agent's
 * reply, an unread chat, the agent thinking, a chat working. When nothing
 * does, it's what the agent last said, as in the agents-first rail.
 */
export function agentRollup(input: RollupInput): AgentRollup {
  const waiting: ThreadState[] = [];
  const unread: ThreadState[] = [];
  const working: ThreadState[] = [];
  for (const t of input.threads) {
    if (t.pending) waiting.push(t);
    else if (t.streaming) working.push(t);
    else if (t.unread) unread.push(t);
  }
  const needsYou = [...waiting, ...unread];
  const own = input.activity;

  const activity: AgentActivity =
    own === 'waiting' || waiting.length > 0
      ? 'waiting'
      : own === 'replied' || unread.length > 0
        ? 'replied'
        : own === 'thinking' || working.length > 0
          ? 'thinking'
          : null;

  const agentLine = (activity: AgentActivity) =>
    agentVoice({ activity, waitingOn: input.waitingOn, preview: input.preview, purpose: input.purpose });
  const chatsLine = (): Voice => {
    if (needsYou.length === 1) {
      const t = needsYou[0]!;
      return { text: `${t.label ?? UNTITLED}: ${t.pending ? 'waiting on you' : 'new reply'}`, tone: 'attention' };
    }
    const more = working.length > 0 ? ` · ${working.length} working` : '';
    return { text: `${needsYou.length} chats need you${more}`, tone: 'attention' };
  };
  const workingLine = (): Voice =>
    working.length === 1
      ? { text: `${working[0]!.label ?? UNTITLED}: working`, tone: 'working' }
      : { text: `${working.length} chats working`, tone: 'working' };

  let voice: Voice | null;
  if (own === 'waiting') voice = agentLine('waiting');
  else if (waiting.length > 0) voice = chatsLine();
  else if (own === 'replied') voice = agentLine('replied');
  else if (unread.length > 0) voice = chatsLine();
  else if (own === 'thinking') voice = agentLine('thinking');
  else if (working.length > 0) voice = workingLine();
  else voice = agentLine(null);

  const activityLabel =
    activity === 'waiting'
      ? 'Waiting on you'
      : activity === 'replied'
        ? own === 'replied' ? 'New reply' : 'Unread'
        : activity === 'thinking'
          ? own === 'thinking' ? 'Thinking' : 'Working'
          : null;

  const unreadIds = [
    ...(input.mainChat?.unread ? [input.mainChat.id] : []),
    ...input.threads.filter((t) => t.unread).map((t) => t.id),
  ];

  return { activity, activityLabel, wantsYou: activity === 'waiting' || activity === 'replied', voice, unreadIds };
}
