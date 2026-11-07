import { expect, it } from 'vitest';
import { nextTimingStep, QUIET_REASON, updateTiming, type TimingFacts } from './update-timing';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const now = 1_000 * HOUR;
const quiet: TimingFacts = { now, work: [], lastUseAt: now - HOUR, quietFrom: now - HOUR };
const timing = { quietMs: 10 * MINUTE, headsUpMs: MINUTE, holdMs: HOUR, spacingMs: 12 * HOUR, longWaitMs: 24 * HOUR };
const step = (change: Partial<TimingFacts>) => nextTimingStep({ ...quiet, ...change }, timing);

it('reads the defaults from the spec', () => {
  expect(updateTiming()).toEqual(timing);
});

it('gives a heads-up after 10 quiet minutes, then updates a minute later', () => {
  expect(step({})).toEqual({ step: 'heads-up', at: now });
  expect(step({ headsUpAt: now - 30_000 })).toEqual({ step: 'heads-up', at: now - 30_000 });
  expect(step({ headsUpAt: now - MINUTE })).toEqual({ step: 'update' });
});

it('counts the 10 minutes from the last use, an agent over MCP included', () => {
  expect(step({ lastUseAt: now - 9 * MINUTE })).toEqual({ step: 'wait', reason: QUIET_REASON });
  expect(step({ lastUseAt: now - 10 * MINUTE })).toEqual({ step: 'heads-up', at: now });
});

it('counts them from when the wait began too, or from the last work it saw', () => {
  expect(step({ quietFrom: now - 9 * MINUTE })).toEqual({ step: 'wait', reason: QUIET_REASON });
});

it('never stops running work, and says what it waits for', () => {
  expect(step({ work: ['2 chats', '1 background task'] })).toEqual({ step: 'wait', reason: '2 chats, 1 background task' });
  expect(step({ work: ['1 chat'], headsUpAt: now - 2 * MINUTE })).toEqual({ step: 'wait', reason: '1 chat' });
});

it('cancels a heads-up when someone uses Ri during the minute', () => {
  expect(step({ headsUpAt: now - 30_000, lastUseAt: now - 10_000 })).toEqual({ step: 'wait', reason: QUIET_REASON });
});

it('holds for an hour after Not now, then asks again', () => {
  expect(step({ heldUntil: now + 1 })).toEqual({ step: 'wait', reason: 'you asked to update later' });
  expect(step({ heldUntil: now })).toEqual({ step: 'heads-up', at: now });
});

it('updates by itself at most every 12 hours', () => {
  expect(step({ lastAutomaticAt: now - 11 * HOUR })).toMatchObject({ step: 'wait' });
  expect(step({ lastAutomaticAt: now - 12 * HOUR })).toEqual({ step: 'heads-up', at: now });
});

it('honours the test overrides', () => {
  process.env.RI_UPDATE_QUIET_MS = '5';
  try { expect(updateTiming().quietMs).toBe(5); } finally { delete process.env.RI_UPDATE_QUIET_MS; }
});
