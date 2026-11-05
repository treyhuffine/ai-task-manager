import { expect, it } from 'vitest';
import type { ServiceStatus } from './client';
import { describeHomeStatus, homeIsDown, summarizeHome, type HomeStatusFacts } from './home-status';

const now = Date.parse('2026-10-29T18:00:00Z');
const MIB = 1024 * 1024;
const running = {
  phase: 'running', origin: 'http://localhost:4224', since: '2026-10-29T15:00:00Z',
  release: { release: { version: '0.1.0', build: 'a'.repeat(64), source: 'packaged' } },
  restarts: { count: 1, crashLoop: false, last: { at: '2026-10-29T14:55:00Z', reason: 'The server stopped answering, so it was restarted' } },
  memory: { heapUsed: 1024 * MIB, heapLimit: 4096 * MIB, rss: 1800 * MIB },
  update: { phase: 'idle' },
} as unknown as ServiceStatus;
const facts = (change: Partial<HomeStatusFacts>): HomeStatusFacts => ({ status: running, supervised: true, stopped: null, computer: null, homeCommit: null, now, ...change });

it('says a running Home is up, since when, why it last restarted and what it runs', () => {
  expect(describeHomeStatus(facts({ homeCommit: 'a8eb63982446'.padEnd(40, '0'), computer: { version: '0.1.0', commit: 'c625eb62'.padEnd(40, '0') } }))).toEqual([
    ['state', 'running since 3 h ago at http://localhost:4224'],
    ['restart', '3 h ago: The server stopped answering, so it was restarted'],
    ['version', 'main a8eb6398, and main c625eb62 on this computer'],
    ['kept up', 'yes, by the OS, after crashes and restarts'],
    ['memory', '1024 of 4096 MiB heap (25%), 1800 MiB in all'],
    ['update', 'up to date'],
  ]);
});

it('makes a forgotten stop visible', () => {
  expect(describeHomeStatus(facts({ status: null, stopped: { at: '2026-10-27T18:00:00Z' } }))[0])
    .toEqual(['state', 'stopped by you 2 days ago. It stays stopped until `ri start`.']);
  expect(describeHomeStatus(facts({ status: null, supervised: false }))).toContainEqual(['kept up', 'no. `ri start` keeps it running']);
});

it('shows a crash loop with its error and the next try', () => {
  const crashing = { ...running, phase: 'restarting', error: 'The server exited (exit 1)',
    restarts: { count: 6, crashLoop: true, last: { at: '2026-10-29T17:59:00Z', reason: 'The server exited (exit 1)' }, nextAttemptAt: '2026-10-29T18:14:00Z' } } as unknown as ServiceStatus;
  const lines = describeHomeStatus(facts({ status: crashing }));
  expect(lines[0][1]).toMatch(/^restarting, slowly because it keeps crashing\. Next try /);
  expect(lines[1]).toEqual(['error', 'The server exited (exit 1)']);
});

it('says what a downloaded update and a planned restart wait for', () => {
  const busy = { ...running, restartPending: { reason: 'its memory reached 80% of Node\'s limit', waitingFor: '2 chats' },
    update: { phase: 'waiting', reason: 'Waiting for 2 chats to finish', release: { version: '0.2.0' } } } as unknown as ServiceStatus;
  const lines = describeHomeStatus(facts({ status: busy }));
  expect(lines).toContainEqual(['restart', "waiting for 2 chats, then: its memory reached 80% of Node's limit"]);
  expect(lines).toContainEqual(['update', 'waiting: Waiting for 2 chats to finish']);
});

it('knows a Home started by hand is up, and how to move it', () => {
  const lines = describeHomeStatus(facts({ status: null, supervised: false, manual: 'http://localhost:4224' }));
  expect(lines[0]).toEqual(['state', 'running at http://localhost:4224, started by hand']);
  expect(lines).toContainEqual(['kept up', 'no. `ri stop`, then `ri start` keeps it running']);
  expect(homeIsDown({ status: null, stopped: null, manual: 'http://localhost:4224' })).toBe(false);
});

it('calls a Home down unless it serves, or its owner stopped it', () => {
  expect(homeIsDown({ status: running, stopped: null })).toBe(false);
  expect(homeIsDown({ status: null, stopped: { at: '2026-10-27T18:00:00Z' } })).toBe(false);
  expect(homeIsDown({ status: null, stopped: null })).toBe(true);
  expect(homeIsDown({ status: { ...running, phase: 'restarting' }, stopped: null })).toBe(true);
});

it('fits a Home on one line for the list of everything on this computer', () => {
  expect(summarizeHome(facts({ homeCommit: 'a8eb63982446'.padEnd(40, '0') }))).toBe('running since 3 h ago at http://localhost:4224, main a8eb6398, kept up by the OS');
  const crashing = { ...running, phase: 'restarting', error: 'Port in use', restarts: { ...running.restarts!, nextAttemptAt: undefined } } as unknown as ServiceStatus;
  expect(summarizeHome(facts({ status: crashing, supervised: false }))).toBe('restarting, Port in use, 0.1.0, not kept up');
  expect(summarizeHome(facts({ status: null, supervised: false }))).toBe('not running, not kept up');
  expect(summarizeHome(facts({ status: null, stopped: { at: '2026-10-27T18:00:00Z' } }))).toBe('stopped by you 2 days ago, kept up by the OS');
});
