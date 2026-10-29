import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ServiceStatus } from '@/lib/service/client';
import { restartHome, showLogs } from './home-control';

function controller(sequence: Partial<ServiceStatus>[]) {
  const requests: unknown[] = [];
  const said: string[] = [];
  let index = 0;
  return {
    requests, said,
    deps: {
      status: async () => (sequence[Math.min(index++, sequence.length - 1)] ?? null) as ServiceStatus | null,
      request: async (route: string, method?: string, timeout?: number, body?: unknown) => { requests.push([route, method, body]); return {} as never; },
      sleep: async () => {},
      say: (line: string) => { said.push(line); },
    },
  };
}

it('restarts at the next idle moment and says what it waits for', async () => {
  const home = controller([
    { phase: 'running', origin: 'http://localhost:4224', restarts: undefined },
    { phase: 'running', origin: 'http://localhost:4224', restartPending: { reason: 'restarted on request', waitingFor: '2 executions' } },
  ]);
  await restartHome({}, home.deps);
  expect(home.requests).toEqual([['/restart', 'POST', { now: false }]]);
  expect(home.said).toEqual(['Ri restarts when 2 executions finish. To restart now and end them: ri restart --now']);
});

it('restarts now when asked, and says when it is back', async () => {
  const home = controller([
    { phase: 'running', origin: 'http://localhost:4224', restarts: { count: 2, crashLoop: false, last: { at: '', reason: '' } } },
    { phase: 'restarting', origin: 'http://localhost:4224', restarts: { count: 3, crashLoop: false, last: { at: '', reason: '' } } },
    { phase: 'running', origin: 'http://localhost:4224', restarts: { count: 3, crashLoop: false, last: { at: '', reason: '' } } },
  ]);
  await restartHome({ now: true }, home.deps);
  expect(home.requests).toEqual([['/restart', 'POST', { now: true }]]);
  expect(home.said).toEqual(['Restarted. Ri is running at http://localhost:4224.']);
});

it("says so when there's nothing running to restart", async () => {
  await expect(restartHome({}, controller([]).deps)).rejects.toThrow("Ri isn't running here. Start it with `ri start`.");
});

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-logs-test-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

it('prints the last lines of the log', async () => {
  const file = path.join(dir, 'service.log');
  fs.writeFileSync(file, Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  let out = '';
  await showLogs({ lines: '3' }, file, text => { out += text; });
  expect(out).toBe('line 298\nline 299\nline 300\n');
  out = '';
  await showLogs({}, path.join(dir, 'missing.log'), text => { out += text; });
  expect(out).toBe('No service log yet.\n');
});
