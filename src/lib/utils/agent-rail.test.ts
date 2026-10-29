import { describe, expect, it } from 'vitest';
import {
  agentAttention,
  agentRollup,
  agentVoice,
  mainChatActivity,
  threadSummary,
  type ThreadState,
} from './agent-rail';

describe('mainChatActivity', () => {
  const chat = (read: boolean) => ({
    id: 'm',
    lastOutcomeEventAt: '2026-09-30T10:00:00Z',
    unreadMarkerAt: null,
    lastViewedAt: read ? '2026-09-30T11:00:00Z' : '2026-09-30T09:00:00Z',
  });
  const none = new Set<string>();
  const has = new Set(['m']);

  it('puts waiting on you ahead of thinking, and a reply only when the turn is over', () => {
    expect(mainChatActivity(chat(false), has, has)).toBe('waiting');
    expect(mainChatActivity(chat(false), none, has)).toBe('thinking');
    expect(mainChatActivity(chat(false), none, none)).toBe('replied');
    expect(mainChatActivity(chat(true), none, none)).toBeNull();
  });

  it('is quiet for an agent with no main chat yet', () => {
    expect(mainChatActivity(null, has, has)).toBeNull();
    expect(mainChatActivity(undefined, none, none)).toBeNull();
  });
});

describe('agentAttention', () => {
  it('counts waiting and a new reply as wanting you, and thinking as activity only', () => {
    expect(agentAttention('waiting')).toBe('needsApproval');
    expect(agentAttention('replied')).toBe('unread');
    expect(agentAttention('thinking')).toBeNull();
    expect(agentAttention(null)).toBeNull();
  });
});

describe('agentVoice', () => {
  const base = { activity: null, waitingOn: null, preview: null, purpose: null } as const;

  it('says what the agent wants: its question, that it is thinking, or its reply', () => {
    expect(agentVoice({ ...base, activity: 'waiting', waitingOn: 'OK to run the migration?' })).toEqual({
      text: 'OK to run the migration?',
      tone: 'attention',
    });
    expect(agentVoice({ ...base, activity: 'waiting' })).toEqual({ text: 'Waiting on you', tone: 'attention' });
    expect(agentVoice({ ...base, activity: 'thinking', preview: 'old' })).toEqual({ text: 'Thinking…', tone: 'working' });
    expect(agentVoice({ ...base, activity: 'replied', preview: 'Login page is ready' })).toEqual({
      text: 'Login page is ready',
      tone: 'strong',
    });
    expect(agentVoice({ ...base, activity: 'replied' })).toEqual({ text: 'New reply', tone: 'strong' });
  });

  it('when quiet, shows what it last said, then its purpose', () => {
    expect(agentVoice({ ...base, preview: 'Filed 4 notes', purpose: 'Research' })).toEqual({ text: 'Filed 4 notes', tone: 'muted' });
    expect(agentVoice({ ...base, purpose: '  Research notes  ' })).toEqual({ text: 'Research notes', tone: 'muted' });
  });

  it('says nothing when it has not spoken and has no purpose, rather than "No messages yet"', () => {
    // The agent may well have executions: an empty main chat is not an empty agent.
    expect(agentVoice(base)).toBeNull();
    expect(agentVoice({ ...base, purpose: '   ' })).toBeNull();
    expect(agentVoice({ ...base, preview: '' })).toBeNull();
  });
});

describe('threadSummary', () => {
  it('keeps what wants you and what runs visible when the executions are hidden', () => {
    expect(threadSummary({ total: 4, needsYou: 1, working: 2 })).toEqual([
      { text: '4 executions', tone: 'muted' },
      { text: '1 needs you', tone: 'attention' },
      { text: '2 working', tone: 'working' },
    ]);
    expect(threadSummary({ total: 1, needsYou: 0, working: 0 })).toEqual([{ text: '1 execution', tone: 'muted' }]);
    expect(threadSummary({ total: 3, needsYou: 2, working: 0 })[1]).toEqual({ text: '2 need you', tone: 'attention' });
  });
});

describe('agentRollup', () => {
  const thread = (id: string, state: Partial<ThreadState> = {}): ThreadState => ({
    id,
    label: `Chat ${id}`,
    pending: false,
    streaming: false,
    unread: false,
    ...state,
  });
  const base = {
    activity: null,
    mainChat: { id: 'main', unread: false },
    waitingOn: null,
    preview: 'Last thing I said',
    purpose: 'Ships the app',
    threads: [],
  } as const;

  it('is the agents-first row when the agent has no chats that want anything', () => {
    expect(agentRollup(base)).toEqual({
      activity: null,
      activityLabel: null,
      wantsYou: false,
      voice: { text: 'Last thing I said', tone: 'muted' },
      unreadIds: [],
    });
    const quiet = agentRollup({ ...base, threads: [thread('a'), thread('b')] });
    expect(quiet.activity).toBeNull();
    expect(quiet.voice).toEqual({ text: 'Last thing I said', tone: 'muted' });
  });

  it("lights the agent for a chat's state, naming the chat when it's the only one", () => {
    const waiting = agentRollup({ ...base, threads: [thread('a', { pending: true })] });
    expect(waiting).toMatchObject({ activity: 'waiting', activityLabel: 'Waiting on you', wantsYou: true });
    expect(waiting.voice).toEqual({ text: 'Chat a: waiting on you', tone: 'attention' });

    const unread = agentRollup({ ...base, threads: [thread('a', { unread: true })] });
    expect(unread).toMatchObject({ activity: 'replied', activityLabel: 'Unread', wantsYou: true, unreadIds: ['a'] });
    expect(unread.voice).toEqual({ text: 'Chat a: new reply', tone: 'attention' });

    const working = agentRollup({ ...base, threads: [thread('a', { streaming: true })] });
    expect(working).toMatchObject({ activity: 'thinking', activityLabel: 'Working', wantsYou: false });
    expect(working.voice).toEqual({ text: 'Chat a: working', tone: 'working' });

    const untitled = agentRollup({ ...base, threads: [thread('a', { label: null, unread: true })] });
    expect(untitled.voice?.text).toBe('Untitled: new reply');
  });

  it('counts several chats, and says what else is running', () => {
    const many = agentRollup({
      ...base,
      threads: [thread('a', { pending: true }), thread('b', { unread: true }), thread('c', { streaming: true })],
    });
    expect(many.activity).toBe('waiting');
    expect(many.voice).toEqual({ text: '2 chats need you · 1 working', tone: 'attention' });
    expect(agentRollup({ ...base, threads: [thread('a', { streaming: true }), thread('b', { streaming: true })] }).voice)
      .toEqual({ text: '2 chats working', tone: 'working' });
  });

  it('puts wanting you ahead of working, for the dot and the line', () => {
    const thinkingWithUnread = agentRollup({ ...base, activity: 'thinking', threads: [thread('a', { unread: true })] });
    expect(thinkingWithUnread.activity).toBe('replied');
    expect(thinkingWithUnread.voice).toEqual({ text: 'Chat a: new reply', tone: 'attention' });
  });

  it("keeps the agent's own question and reply ahead of the chats they outrank", () => {
    const asking = agentRollup({
      ...base,
      activity: 'waiting',
      waitingOn: 'Which branch?',
      threads: [thread('a', { pending: true })],
    });
    expect(asking.voice).toEqual({ text: 'Which branch?', tone: 'attention' });

    // A chat blocked on you outranks the agent's reply, an unread chat doesn't.
    const replied = { ...base, activity: 'replied' as const, mainChat: { id: 'main', unread: true } };
    expect(agentRollup({ ...replied, threads: [thread('a', { pending: true })] }).voice?.text).toBe('Chat a: waiting on you');
    const reply = agentRollup({ ...replied, threads: [thread('a', { unread: true })] });
    expect(reply.voice).toEqual({ text: 'Last thing I said', tone: 'strong' });
    expect(reply.activityLabel).toBe('New reply');
    expect(reply.unreadIds).toEqual(['main', 'a']);
  });

  it('marks read what the row shows as unread, including a chat that is also waiting', () => {
    const rollup = agentRollup({
      ...base,
      mainChat: { id: 'main', unread: true },
      activity: 'replied',
      threads: [thread('a', { pending: true, unread: true }), thread('b'), thread('c', { unread: true })],
    });
    expect(rollup.unreadIds).toEqual(['main', 'a', 'c']);
    expect(agentRollup({ ...base, mainChat: null }).unreadIds).toEqual([]);
  });
});
