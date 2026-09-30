import { describe, expect, it } from 'vitest';
import {
  agentAttention,
  agentVoice,
  mainChatActivity,
  pickRailThreads,
  QUIET_THREADS,
  threadSummary,
} from './agent-rail';

describe('pickRailThreads', () => {
  const rows = (spec: string) => spec.split('').map((c, i) => ({ id: i, live: c === 'L' }));
  const live = (r: { live: boolean }) => r.live;

  it('shows every live execution and the first few quiet ones, in the order given', () => {
    const { shown, hidden } = pickRailThreads(rows('qLqqLqqq'), live, 3);
    expect(shown.map((r) => r.id)).toEqual([0, 1, 2, 3, 4]);
    expect(hidden).toBe(3);
  });

  it('never hides a live execution, however many there are', () => {
    const { shown, hidden } = pickRailThreads(rows('qqqqLLLL'), live, 2);
    expect(shown.map((r) => r.id)).toEqual([0, 1, 4, 5, 6, 7]);
    expect(hidden).toBe(2);
  });

  it('shows everything when the list is short', () => {
    expect(pickRailThreads(rows('qq'), live)).toEqual({ shown: rows('qq'), hidden: 0 });
    expect(pickRailThreads([], live)).toEqual({ shown: [], hidden: 0 });
    expect(QUIET_THREADS).toBe(3);
  });
});

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

  it('when quiet, shows what it last said, then its purpose, then that it has not spoken', () => {
    expect(agentVoice({ ...base, preview: 'Filed 4 notes', purpose: 'Research' })).toEqual({ text: 'Filed 4 notes', tone: 'muted' });
    expect(agentVoice({ ...base, purpose: '  Research notes  ' })).toEqual({ text: 'Research notes', tone: 'muted' });
    expect(agentVoice(base)).toEqual({ text: 'No messages yet', tone: 'muted' });
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
