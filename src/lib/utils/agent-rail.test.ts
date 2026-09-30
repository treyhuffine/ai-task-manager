import { describe, expect, it } from 'vitest';
import { agentSummary, pickRailThreads, QUIET_THREADS } from './agent-rail';

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

  it('shows everything when the list is short, and nothing is hidden', () => {
    expect(pickRailThreads(rows('qq'), live)).toEqual({ shown: rows('qq'), hidden: 0 });
    expect(pickRailThreads([], live)).toEqual({ shown: [], hidden: 0 });
    expect(QUIET_THREADS).toBe(3);
  });
});

describe('agentSummary', () => {
  const base = { mainChat: null, needsYou: 0, working: 0, total: 0, purpose: null } as const;

  it('leads with the agent itself, then its work, needs-you before working', () => {
    expect(agentSummary({ ...base, mainChat: 'waiting', needsYou: 1, working: 2, total: 5 })).toEqual([
      { text: 'Waiting on you', tone: 'attention' },
      { text: '1 needs you', tone: 'attention' },
      { text: '2 working', tone: 'working' },
    ]);
    expect(agentSummary({ ...base, mainChat: 'thinking' })).toEqual([{ text: 'Thinking', tone: 'working' }]);
    expect(agentSummary({ ...base, mainChat: 'replied' })).toEqual([{ text: 'New reply', tone: 'attention' }]);
    expect(agentSummary({ ...base, needsYou: 2 })).toEqual([{ text: '2 need you', tone: 'attention' }]);
  });

  it('falls back to the purpose, then how much work it holds, then no work', () => {
    expect(agentSummary({ ...base, purpose: '  Ship the Ri app  ', total: 4 })).toEqual([{ text: 'Ship the Ri app', tone: 'muted' }]);
    expect(agentSummary({ ...base, purpose: '   ', total: 1 })).toEqual([{ text: '1 execution', tone: 'muted' }]);
    expect(agentSummary({ ...base, total: 3 })).toEqual([{ text: '3 executions', tone: 'muted' }]);
    expect(agentSummary(base)).toEqual([{ text: 'No work yet', tone: 'muted' }]);
  });
});
