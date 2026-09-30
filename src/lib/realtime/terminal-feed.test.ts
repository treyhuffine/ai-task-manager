/**
 * A terminal in the page stream picks itself back up (P3 review): when its
 * stream ends without the shell ending, it opens it again from where it
 * left off, so the page doesn't reconnect for one terminal. It stops at the
 * exit, or when the terminal isn't there.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

const requestWorker = vi.fn();
vi.mock('@/lib/workers/hub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workers/hub')>();
  return { ...actual, requestWorker: (...args: unknown[]) => requestWorker(...args) };
});

let home: TestHome | undefined;
afterEach(async () => {
  requestWorker.mockReset();
  (await import('@/lib/terminal/remote'))._resetRemoteTerminals();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home?.cleanup();
  home = undefined;
});

async function setup() {
  home = await createTestHome({ prefix: 'ri-terminal-feed-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const folder = path.join(home.root, 'work');
  fs.mkdirSync(folder, { recursive: true });
  const ws = q.createWorkspace({ name: 'Feed', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const created = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'feed' });
  return { q, folder, created };
}

describe('a terminal in the page stream', () => {
  it("opens a remote terminal again once its device answers, and ends at the shell's exit", async () => {
    const { q, created } = await setup();
    const laptop = q.createDevice({ name: 'Laptop', platform: 'darwin', hostname: 'laptop' , kind: 'computer' });
    q.createPlacement({ executionId: created.execution.id, deviceId: laptop.id, startReason: 'created', worktreePath: '/laptop/work' });
    const { WorkerUnavailableError } = await import('@/lib/workers/hub');
    requestWorker
      .mockRejectedValueOnce(new WorkerUnavailableError('laptop'))
      .mockResolvedValueOnce({ status: 200, body: { replay: 'hello', offset: 5, gap: false, exited: false, exitCode: null } });
    const { runTerminalFeed } = await import('./terminal-feed');
    const frames: Array<[string, unknown, string | undefined]> = [];
    const aborter = new AbortController();
    const feed = runTerminalFeed(`/sessions/${created.session.id}`, 't1', null, (e, d, i) => frames.push([e, d, i]), aborter.signal);
    await vi.waitFor(() => expect(frames.map((f) => f[0])).toContain('ready'), { timeout: 6_000 });
    expect(frames.map((f) => f[0])).toEqual(['unavailable', 'ready', 'data']);
    expect(frames[2]).toEqual(['data', 'hello', '5']);
    // The shell's last output and its exit, relayed.
    const { deliverTerminalOutput } = await import('@/lib/terminal/remote');
    deliverTerminalOutput(laptop.id, { chunks: [{ terminalId: 't1', data: ' bye', offset: 9 }], exits: [{ terminalId: 't1', code: 0, signal: null }] });
    await feed;
    expect(frames.slice(3)).toEqual([
      ['data', ' bye', '9'],
      ['exit', { code: 0, signal: null }, undefined],
    ]);
    // The second ask resumed where the first left off: nothing was replayed twice.
    expect(requestWorker).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("stops when the terminal isn't there, rather than trying forever", async () => {
    const { created } = await setup();
    const { runTerminalFeed } = await import('./terminal-feed');
    const frames: string[] = [];
    await runTerminalFeed(`/sessions/${created.session.id}`, 'missing', null, (e) => frames.push(e), new AbortController().signal);
    expect(frames).toEqual(['error']);
  });

  it('resumes a shell here from the offset it was given', async () => {
    const { created, folder } = await setup();
    const pty = await import('@/lib/terminal/pty-manager');
    const t = pty.createTerminal({ ownerId: created.execution.id, cwd: folder });
    try {
      pty.writeInput(created.execution.id, t.id, 'echo first-part\r');
      const { runTerminalFeed } = await import('./terminal-feed');
      const first: Array<[string, unknown, string | undefined]> = [];
      const a = new AbortController();
      void runTerminalFeed(`/sessions/${created.session.id}`, t.id, null, (e, d, i) => first.push([e, d, i]), a.signal);
      await vi.waitFor(() => expect(first.some(([e, d]) => e === 'data' && String(d).includes('first-part'))).toBe(true), { timeout: 5_000 });
      a.abort();
      const last = Number(first.filter(([, , i]) => i !== undefined).at(-1)![2]);
      pty.writeInput(created.execution.id, t.id, 'echo second-part\r');
      const second: Array<[string, unknown, string | undefined]> = [];
      const b = new AbortController();
      void runTerminalFeed(`/sessions/${created.session.id}`, t.id, last, (e, d, i) => second.push([e, d, i]), b.signal);
      await vi.waitFor(() => expect(second.some(([e, d]) => e === 'data' && String(d).includes('second-part'))).toBe(true), { timeout: 5_000 });
      b.abort();
      expect(second[0]).toEqual(['ready', { id: t.id, resumed: true }, undefined]);
      // It picks up exactly where the first left off: its first chunk starts at that offset.
      const [, data, id] = second.find(([e]) => e === 'data')!;
      expect(Number(id) - String(data).length).toBe(last);
    } finally {
      pty.killTerminal(created.execution.id, t.id);
    }
  }, 15_000);
});
