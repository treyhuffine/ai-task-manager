import { expect, it } from 'vitest';
import { HangDetector, memoryAction, RestartTracker, serverMissing } from './supervisor';

function clock() {
  let now = 0;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

it('restarts after 1 s, 5 s, 15 s and 60 s, then every 5 minutes', () => {
  const time = clock();
  const tracker = new RestartTracker(undefined, time.now);
  const delays: number[] = [];
  for (let i = 0; i < 4; i++) { delays.push(tracker.failed().delayMs); time.advance(16 * 60_000); }
  expect(delays).toEqual([1000, 5000, 15_000, 60_000]);
  expect(tracker.failed().delayMs).toBe(5 * 60_000);
});

it('starts the delays over after 10 healthy minutes', () => {
  const time = clock();
  const tracker = new RestartTracker(undefined, time.now);
  tracker.failed(); tracker.failed();
  tracker.healthy(); time.advance(10 * 60_000);
  expect(tracker.failed().delayMs).toBe(1000);
});

it('slows a crash loop to one attempt every 15 minutes, and never gives up', () => {
  const time = clock();
  const tracker = new RestartTracker(undefined, time.now);
  const results = Array.from({ length: 5 }, () => { const result = tracker.failed(); time.advance(1000); return result; });
  expect(results.slice(0, 4).every(result => !result.crashLoop)).toBe(true);
  expect(results[4]).toEqual({ delayMs: 15 * 60_000, crashLoop: true });
  expect(tracker.crashLooping).toBe(true);
  // A server that keeps crashing keeps getting tried, every 15 minutes.
  for (let i = 0; i < 10; i++) { time.advance(15 * 60_000); expect(tracker.failed().delayMs).toBeGreaterThan(0); }
});

it('calls a server hung only after 3 minutes without an answer', () => {
  const time = clock();
  const hang = new HangDetector(undefined, time.now);
  time.advance(2 * 60_000);
  expect(hang.hung()).toBe(false);
  hang.answered();
  time.advance(3 * 60_000 - 1);
  expect(hang.hung()).toBe(false);
  time.advance(1);
  expect(hang.hung()).toBe(true);
});

it('restarts when idle past 75% of the heap limit, and now past 90%', () => {
  const limit = 4096;
  expect(memoryAction({ heapUsed: 0.5 * limit, heapLimit: limit, rss: 0 })).toBe('none');
  expect(memoryAction({ heapUsed: 0.8 * limit, heapLimit: limit, rss: 0 })).toBe('when-idle');
  expect(memoryAction({ heapUsed: 0.95 * limit, heapLimit: limit, rss: 0 })).toBe('now');
  expect(memoryAction(undefined)).toBe('none');
});

it('leaves a server alone for memory in its first 10 minutes', () => {
  const memory = { heapUsed: 0.95 * 4096, heapLimit: 4096, rss: 0 };
  expect(memoryAction(memory, 9 * 60_000)).toBe('none');
  expect(memoryAction(memory, 10 * 60_000)).toBe('now');
});

it('owes a Home a server whenever it has none and nothing else owns the moment', () => {
  const missing = { serves: true, running: false, stopping: false, busy: false, unsafe: false, retrying: false };
  expect(serverMissing(missing)).toBe(true);
  // A device with no Home, a running server, a stop, an update, a recovery that
  // needs a person, and a retry already on its way all leave it alone.
  for (const change of [{ serves: false }, { running: true }, { stopping: true }, { busy: true }, { unsafe: true }, { retrying: true }]) {
    expect(serverMissing({ ...missing, ...change })).toBe(false);
  }
});
