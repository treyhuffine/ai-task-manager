import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIVITY_REASONS,
  activityReasonForEventSource,
  isActivity,
  resetActivityThrottle,
  shouldThrottledBump,
  type ActivityReason,
} from './activity';

// Module-level: the throttle map is process-global by design, so it has to be
// cleared before every case or state leaks across describe blocks.
beforeEach(() => resetActivityThrottle());

describe('activity policy', () => {
  describe('the two exclusions that matter', () => {
    // These are the whole reason the policy is a named set instead of an
    // inline condition. The composer autofocuses when a session opens, and
    // both `open` and `mark_read` ride that autofocus — so if either counted
    // as activity, merely clicking a rail row would re-sort the rail under
    // the user's cursor.
    it('does not treat opening a session as activity', () => {
      expect(isActivity('open')).toBe(false);
    });

    it('does not treat the read receipt as activity', () => {
      expect(isActivity('mark_read')).toBe(false);
    });
  });

  it('treats marking unread as activity', () => {
    // Deliberate "come back to this" gesture. This is also what lets every
    // ORDER BY key off one column instead of remembering to MAX in
    // unread_marker_at separately.
    expect(isActivity('mark_unread')).toBe(true);
  });

  it('counts human work that produces no agent output', () => {
    expect(isActivity('user_message')).toBe(true);
    expect(isActivity('terminal')).toBe(true);
    expect(isActivity('git')).toBe(true);
  });

  it('counts agent work that produces no assistant text', () => {
    // The old outcome-only rule ignored these, which is how a session could
    // sit hours behind its real last event during a tool-heavy stretch.
    expect(isActivity('tool_call')).toBe(true);
    expect(isActivity('tool_result')).toBe(true);
    expect(isActivity('awaiting_user')).toBe(true);
  });

  it('skips the high-volume noise sources', () => {
    expect(isActivity('thinking')).toBe(false);
    expect(isActivity('system_event')).toBe(false);
  });

  it('exposes the policy as data so the set is the whole definition', () => {
    const excluded: ActivityReason[] = ['open', 'mark_read', 'thinking', 'system_event'];
    for (const reason of excluded) {
      expect(ACTIVITY_REASONS.has(reason)).toBe(false);
    }
  });
});

describe('activityReasonForEventSource', () => {
  it.each([
    ['agent', 'agent_output'],
    ['result', 'turn_complete'],
    ['background_task', 'background_task'],
    ['tool_call', 'tool_call'],
    ['tool_result', 'tool_result'],
    ['user', 'user_message'],
    ['thinking', 'thinking'],
    ['system', 'system_event'],
    ['permission_request', 'awaiting_user'],
    ['question_request', 'awaiting_user'],
    ['permission_response', 'user_answered'],
    ['question_response', 'user_answered'],
    ['error', 'agent_problem'],
    ['rate_limit', 'agent_problem'],
    ['auth_required', 'agent_problem'],
  ] as const)('maps %s to %s', (source, reason) => {
    expect(activityReasonForEventSource(source)).toBe(reason);
  });

  it('falls back to unknown_event, which IS activity', () => {
    // Ranking an unclassifiable event too high is a far cheaper mistake than
    // letting a live session go invisible in the rail.
    expect(activityReasonForEventSource('some_future_source')).toBe('unknown_event');
    expect(isActivity('unknown_event')).toBe(true);
  });
});

describe('shouldThrottledBump', () => {
  it('allows the first bump and suppresses ones inside the window', () => {
    expect(shouldThrottledBump('s1', 0)).toBe(true);
    expect(shouldThrottledBump('s1', 1_000)).toBe(false);
    expect(shouldThrottledBump('s1', 9_999)).toBe(false);
  });

  it('allows again once the window has passed', () => {
    expect(shouldThrottledBump('s1', 0)).toBe(true);
    expect(shouldThrottledBump('s1', 10_000)).toBe(true);
  });

  it('throttles per session, not globally', () => {
    // One noisy terminal must not stop a different session from ranking.
    expect(shouldThrottledBump('s1', 0)).toBe(true);
    expect(shouldThrottledBump('s2', 0)).toBe(true);
  });
});
