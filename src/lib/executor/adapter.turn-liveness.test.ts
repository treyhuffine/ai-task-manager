import { beforeEach, describe, expect, it } from 'vitest';
import type { StreamEvent } from '@agentex/agent';
import {
  _resetExecutorState,
  listRunningSessions,
  parseStreamEvent,
  persistStreamEvent,
} from './adapter';
import type { EventWriter } from './event-writer';

/**
 * Claude Code ends the root turn when it launches a background task, then
 * opens a new one by itself once that task finishes. `send()` has long since
 * resolved, so a session whose "working" flag comes only from our own dispatch
 * reads finished while the agent is still editing files — eleven minutes, on
 * the session that prompted this work.
 *
 * agentex 0.0.37 reports those turns. These cover Flow consuming them.
 */

const base = {
  providerType: 'claude',
  sessionId: 'sess-1',
  messageId: null,
  eventId: null,
  parentToolCallId: null,
  timestamp: '2026-08-27T00:00:00.000Z',
  raw: {},
};

const turnStart = (trigger: 'send' | 'resume'): StreamEvent =>
  ({ type: 'turn_start', turnId: 't1', trigger, ...base }) as unknown as StreamEvent;
const turnEnd = (): StreamEvent =>
  ({ type: 'turn_end', turnId: 't1', trigger: 'resume', reason: 'result', ...base }) as unknown as StreamEvent;

/** Writer that records nothing — these assert runtime state, not rows. */
const noopWriter: EventWriter = { write: async () => { /* rows are asserted elsewhere */ } };

describe('turn liveness from the provider stream', () => {
  beforeEach(() => {
    _resetExecutorState();
  });

  it('marks a session running on a turn the provider started itself', async () => {
    expect(listRunningSessions()).not.toContain('chat-1');
    await persistStreamEvent('chat-1', turnStart('resume'), noopWriter);
    expect(listRunningSessions()).toContain('chat-1');
  });

  it('clears it when that turn ends', async () => {
    await persistStreamEvent('chat-1', turnStart('resume'), noopWriter);
    await persistStreamEvent('chat-1', turnEnd(), noopWriter);
    expect(listRunningSessions()).not.toContain('chat-1');
  });

  it('does not leak across sessions', async () => {
    await persistStreamEvent('chat-1', turnStart('resume'), noopWriter);
    expect(listRunningSessions()).toEqual(['chat-1']);
  });

  it('keeps turn boundaries out of the transcript', () => {
    // They would otherwise persist as `unknown` rows and render once per turn.
    expect(parseStreamEvent('chat-1', turnStart('send'))).toBeNull();
    expect(parseStreamEvent('chat-1', turnEnd())).toBeNull();
  });
});

/**
 * A completion arrives as two records — a state patch and a result delivery.
 * Both are terminal, so keying the visible row on terminality rendered every
 * finished task twice: once with its summary, once empty. There are ~773 such
 * duplicate pairs in the production database.
 */
describe('background task completion rows', () => {
  beforeEach(() => {
    _resetExecutorState();
  });

  const task = (over: Record<string, unknown>): StreamEvent =>
    ({
      type: 'background_task',
      taskId: 'child-1',
      taskType: 'subagent',
      phase: 'completed',
      status: 'completed',
      description: 'Find playbank page implementation',
      summary: null,
      parentTaskId: null,
      toolUseId: null,
      report: null,
      ...base,
      ...over,
    }) as unknown as StreamEvent;

  it('renders the record that delivered the result', () => {
    const row = parseStreamEvent('chat-1', task({
      toolUseId: 'toolu_1',
      summary: 'Here is my report.',
      report: { summary: 'Here is my report.', outputFile: null, usage: null },
    }));
    expect(row?.source).toBe('background_task');
    expect(row?.content).toBe('Here is my report.');
  });

  it('hides the bare state change that accompanies it', () => {
    // Same task, same instant, no result handed back.
    const row = parseStreamEvent('chat-1', task({ report: null }));
    expect(row?.source).toBe('system');
  });

  it('hides a task that was cut short, which delivered nothing', () => {
    const row = parseStreamEvent('chat-1', task({ status: 'stopped', report: null }));
    expect(row?.source).toBe('system');
  });

  it('still renders a terminal record from a stream with no delivery concept', () => {
    // agentex <= 0.0.36 and any provider emitting one terminal record. Without
    // this fallback those completions would become invisible.
    const legacy = task({ summary: 'done' }) as unknown as Record<string, unknown>;
    delete legacy.report;
    const row = parseStreamEvent('chat-1', legacy as unknown as StreamEvent);
    expect(row?.source).toBe('background_task');
    expect(row?.content).toBe('done');
  });
});
