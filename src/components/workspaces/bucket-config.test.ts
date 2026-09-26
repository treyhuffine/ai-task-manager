import { describe, expect, it } from 'vitest';
import { classifySession, executionActivity } from './bucket-config';
import type { RailSession } from '@/lib/api/sessions';

const NONE: ReadonlySet<string> = new Set();

/**
 * Only the fields `classifySession` reads. Cast at the boundary rather than
 * building a whole RailSession — the extra 40 columns would obscure which four
 * actually drive the decision.
 */
function session(over: Partial<RailSession> = {}): RailSession {
  return {
    id: 's1',
    status: 'active',
    surfaceKind: null,
    lastOutcomeEventAt: null,
    unreadMarkerAt: null,
    lastViewedAt: null,
    ...over,
  } as RailSession;
}

describe('classifySession', () => {
  it('puts a settled native session in waiting', () => {
    expect(classifySession(session({
      lastOutcomeEventAt: '2026-07-01T00:00:00.000Z',
      lastViewedAt: '2026-07-01T00:00:00.000Z',
    }), NONE, NONE)).toBe('waiting');
  });

  it('keeps a settled import out of the status buckets entirely', () => {
    // The regression this exists for: imports land active now, and `waiting` is
    // the only bucket they could fall into. Left there, one bulk import (the
    // onboarding step offers select-all up to 1,000) fills "Waiting response"
    // with finished transcripts and buries the rows that need a human.
    expect(classifySession(session({
      surfaceKind: 'imported_agent',
      lastOutcomeEventAt: '2026-03-01T00:00:00.000Z',
      lastViewedAt: '2026-03-01T00:00:00.000Z',
    }), NONE, NONE)).toBeNull();
  });

  it('lets an import back in as unread once a sync brings new messages', () => {
    // Catching up a stale import advances lastOutcomeEventAt past lastViewedAt.
    // That's genuinely new material and has to surface, so the exclusion must
    // sit *after* the unread check, not in front of it.
    expect(classifySession(session({
      surfaceKind: 'imported_agent',
      lastOutcomeEventAt: '2026-07-29T00:00:00.000Z',
      lastViewedAt: '2026-03-01T00:00:00.000Z',
    }), NONE, NONE)).toBe('unread');
  });

  it('lets an import back in as working while it streams', () => {
    // Continuing an imported chat makes it live work like any other.
    expect(classifySession(session({
      id: 'live',
      surfaceKind: 'imported_agent',
      lastOutcomeEventAt: '2026-03-01T00:00:00.000Z',
      lastViewedAt: '2026-03-01T00:00:00.000Z',
    }), NONE, new Set(['live']))).toBe('working');
  });

  it('lets an import back in when it is waiting on approval', () => {
    expect(classifySession(session({
      id: 'ask',
      surfaceKind: 'imported_agent',
      lastOutcomeEventAt: '2026-03-01T00:00:00.000Z',
      lastViewedAt: '2026-03-01T00:00:00.000Z',
    }), new Set(['ask']), NONE)).toBe('needsApproval');
  });

  it('treats a never-viewed import with no recorded activity as settled', () => {
    // Both timestamps null. The unread test requires real activity, so this
    // falls through — and must fall through to null, not to waiting, or an
    // import whose transcript carried no usable timestamps would slip back in.
    expect(classifySession(session({ surfaceKind: 'imported_agent' }), NONE, NONE)).toBeNull();
  });

  it('still counts a never-viewed native session as unread', () => {
    expect(classifySession(session({
      lastOutcomeEventAt: '2026-07-29T00:00:00.000Z',
      lastViewedAt: null,
    }), NONE, NONE)).toBe('unread');
  });
});

describe('executionActivity', () => {
  it("doesn't count the main chat, which is running but isn't an execution", () => {
    const executions = [session({ id: 'exec' })];
    expect(executionActivity(executions, NONE, new Set(['main-chat']))).toEqual({ pending: 0, working: 0 });
    expect(executionActivity(executions, new Set(['main-chat']), NONE)).toEqual({ pending: 0, working: 0 });
  });

  it('counts executions working, and one waiting on the user once, as waiting', () => {
    const executions = [session({ id: 'a' }), session({ id: 'b' }), session({ id: 'c' })];
    expect(executionActivity(executions, new Set(['a']), new Set(['a', 'b', 'main-chat']))).toEqual({ pending: 1, working: 1 });
  });

  it('skips archived executions', () => {
    expect(executionActivity([session({ id: 'a', status: 'archived' })], NONE, new Set(['a']))).toEqual({ pending: 0, working: 0 });
  });
});
