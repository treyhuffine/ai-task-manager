import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as q from '@/lib/db/queries';
import { getAppJob } from './builder';
import { appLogs, appStatus, lastJsonObject, parseStatus, restartApp } from './status';

vi.setConfig({ testTimeout: 60_000 });

/**
 * An app folder whose kit command is a stand-in: it answers status, restart and logs the way the
 * kit's docs/safe-change.md says, from files the test writes, and records what it was asked.
 */
function app(options: { old?: boolean } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-app-status-'));
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'tide-log', private: true, scripts: { start: 'fake-kit serve' } }));
  const bin = path.join(folder, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  // An older kit prints its help and exits 0 for a command it doesn't have, as the kit did before status.
  const script = options.old
    ? '#!/bin/sh\nprintf "App Kit\\nfake-kit create <folder> | dev | build | serve [--install [<ref>] [--json]|--uninstall] | change [<ref>] [--json]\\n"\n'
    : `#!/bin/sh
echo "$@" >> "${folder}/asked"
case "$1" in
  status) cat "${folder}/status.json" ;;
  restart) cat "${folder}/restart.json"; exit "$(cat "${folder}/restart.code" 2>/dev/null || echo 0)" ;;
  logs) [ -f "${folder}/empty-log" ] && exit 0
        printf '%s\\n' '{"time":"2026-11-12T19:04:13.512Z","text":"Tide Log is ready"}' 'not a log line' '{"time":null,"text":"    at stack (x.js:1)"}' '{"time":"2026-11-12T19:04:14.000Z","text":"\\u001b[32m✓ built in 66ms\\u001b[39m"}' ;;
  *) echo "Usage: fake-kit <command>"; exit 64 ;;
esac
`;
  fs.writeFileSync(path.join(bin, 'fake-kit'), script, { mode: 0o755 });
  const source = q.createAppSource({ name: 'Tide Log', folder, createdByRi: true, url: 'http://127.0.0.1:4310/mcp' });
  const write = (name: string, value: unknown) => fs.writeFileSync(path.join(folder, name), typeof value === 'string' ? value : JSON.stringify(value));
  const asked = () => (fs.existsSync(path.join(folder, 'asked')) ? fs.readFileSync(path.join(folder, 'asked'), 'utf8').trim().split('\n') : []);
  return { folder, source, write, asked };
}

const running = {
  app: 'tide-log', name: 'Tide Log', service: 'launchd', installed: true, state: 'running', pid: 41237, since: '2026-11-12T19:04:13.000Z',
  release: '3f2a9c1d0b7e', answering: '3f2a9c1d0b7e', core: '0.2.1', address: 'http://127.0.0.1:4310', mcp: 'http://127.0.0.1:4310/mcp', port: 4310,
  dataDir: '/Users/x/.local/share/tide-log', logFile: '/Users/x/.local/share/tide-log/server.log',
  lastChange: { at: '2026-11-12T19:04:11.204Z', outcome: 'switched', release: '3f2a9c1d0b7e', previous: 'a81c03e4f5d2', message: 'Tide Log is running 3f2a9c1d0b7e.', log: '/x' },
  lastError: null,
};

async function waitFor(jobId: string) {
  for (let i = 0; i < 300; i++) {
    const job = getAppJob(jobId);
    if (job && job.state !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('still running');
}

describe('an app\'s state', () => {
  it('reads it from the kit\'s status --json, keeping what Ri shows and not where its data is', async () => {
    const { source, write, asked } = app();
    write('status.json', JSON.stringify(running) + '\n');
    const status = await appStatus(source.id, { fresh: true });
    expect(status).toMatchObject({ state: 'running', pid: 41237, release: '3f2a9c1d0b7e', core: '0.2.1', address: 'http://127.0.0.1:4310', lastError: null });
    expect(status.lastChange).toMatchObject({ outcome: 'switched', previous: 'a81c03e4f5d2' });
    expect(status).not.toHaveProperty('dataDir');
    expect(asked()).toEqual(['status --json']);
    // Views asking at once share one answer for a few seconds.
    await appStatus(source.id);
    expect(asked()).toHaveLength(1);
    await appStatus(source.id, { fresh: true });
    expect(asked()).toHaveLength(2);
  });

  it('shows a stopped app with the last error the kit found', async () => {
    const { source, write } = app();
    write('status.json', JSON.stringify({ ...running, state: 'stopped', pid: null, since: null, lastError: 'Error: listen EADDRINUSE 127.0.0.1:4310' }));
    expect(await appStatus(source.id, { fresh: true })).toMatchObject({ state: 'stopped', pid: null, lastError: 'Error: listen EADDRINUSE 127.0.0.1:4310' });
  });

  it('says when the app\'s kit is too old to report, or it isn\'t installed in its folder yet', async () => {
    expect(await appStatus(app({ old: true }).source.id, { fresh: true })).toMatchObject({ state: 'unknown', problem: 'kit_too_old' });
    const { source, folder } = app();
    fs.rmSync(path.join(folder, 'node_modules'), { recursive: true });
    expect(await appStatus(source.id, { fresh: true })).toMatchObject({ state: 'unknown', problem: 'not_prepared' });
  });

  it('takes only the states the kit documents', () => {
    expect(parseStatus({ state: 'exploded' }, 'now')).toMatchObject({ state: 'unknown', problem: 'failed' });
    expect(lastJsonObject('pnpm says hi\n{"state":"stopped"}\n\n')).toEqual({ state: 'stopped' });
    expect(lastJsonObject('no json here')).toBeNull();
  });
});

describe('Restart', () => {
  it('runs the kit\'s restart --json as a job and reports its message', async () => {
    const { source, write, asked } = app();
    write('restart.json', '{"event":"result","outcome":"restarted","release":"3f2a9c1d0b7e","message":"Tide Log is running 3f2a9c1d0b7e."}\n');
    const job = await waitFor(restartApp(source.id).id);
    expect(job).toMatchObject({ kind: 'restart', state: 'done', result: { outcome: 'restarted', message: 'Tide Log is running 3f2a9c1d0b7e.' } });
    expect(asked()).toEqual(['restart --json']);
  });

  it('fails the job when the app didn\'t come back', async () => {
    const { source, write } = app();
    write('restart.json', '{"event":"result","outcome":"failed","message":"Tide Log didn’t answer in 60 seconds. Check its logs."}\n');
    write('restart.code', '1');
    expect(await waitFor(restartApp(source.id).id)).toMatchObject({ state: 'failed', result: { outcome: 'failed' } });
  });

  it('says an older kit can\'t restart', async () => {
    expect(await waitFor(restartApp(app({ old: true }).source.id).id)).toMatchObject({ state: 'failed', error: expect.stringMatching(/older app kit/) });
  });
});

describe('Logs', () => {
  it('asks the kit for the end of the log and keeps only its log lines', async () => {
    const { source, asked } = app();
    const logs = await appLogs(source.id, { lines: 500, since: '2h' });
    expect(logs).toEqual({ lines: [
      { time: '2026-11-12T19:04:13.512Z', text: 'Tide Log is ready' },
      { time: null, text: '    at stack (x.js:1)' },
      // Terminal colors are left out.
      { time: '2026-11-12T19:04:14.000Z', text: '✓ built in 66ms' },
    ], message: null });
    await appLogs(source.id, { change: true });
    expect(asked()).toEqual(['logs --json --lines 500 --since 2h', 'logs --json --lines 500 --change']);
  });

  it('takes only a span or an ISO time for since, and says when the kit can\'t show logs', async () => {
    const { source } = app();
    await expect(appLogs(source.id, { since: '$(rm -rf ~)' })).rejects.toThrow(/15m, 2h/);
    // An empty log is just empty.
    fs.writeFileSync(path.join(source.folder!, 'empty-log'), '');
    expect(await appLogs(source.id)).toEqual({ lines: [], message: null });
    expect((await appLogs(app({ old: true }).source.id)).message).toMatch(/older app kit/);
  });
});
