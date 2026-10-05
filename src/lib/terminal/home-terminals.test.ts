/**
 * Home's terminals (Home, More, Terminal): shells on the box the home runs
 * on, opening in the home folder of the user the server runs as. The folder
 * comes from the server, never the caller, and the shells are the home's,
 * apart from every execution's and agent's.
 *
 * Real shells through the real router, with `$HOME` pointed at a temp
 * folder so `os.homedir()` is one we can check (and no rc files load).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestKey } from '@/lib/auth/request-key';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

vi.mock('@/lib/sessions/workstream', () => ({ coordinateLifecycleChange: async () => {} }));
vi.mock('@/lib/sessions/workstream-runtime', () => ({ inProcessWorkstreamRuntime: {} }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listRunningSessions: () => [] }));

let home: TestHome;
let boxHome: string;
const savedHome = process.env.HOME;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-home-terminal-' });
  // Resolved, so it matches what the shell's `pwd` prints on macOS (/private/var/...).
  boxHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-box-home-')));
  process.env.HOME = boxHome;
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
});

afterEach(async () => {
  const pty = await import('@/lib/terminal/pty-manager');
  pty.killAllForOwner('home');
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  // A killed shell can still be writing its history there for a moment.
  fs.rmSync(boxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

async function viewer() {
  const { appRouter } = await import('@/lib/trpc/router');
  const key: RequestKey = { apiKeyId: 'key', location: 'home', scope: 'viewer', workerDeviceId: null, sessionChatId: null };
  return appRouter.createCaller({ key, request: new Request('http://localhost/api/trpc/home') });
}

/** Everything the shell prints, read the way the page reads it. */
async function readUntil(terminalId: string, text: string): Promise<string> {
  const { runTerminalFeed } = await import('@/lib/realtime/terminal-feed');
  let out = '';
  const aborter = new AbortController();
  void runTerminalFeed('/home', terminalId, null, (event, data) => {
    if (event === 'data') out += String(data);
  }, aborter.signal);
  try {
    await vi.waitFor(() => expect(out).toContain(text), { timeout: 8_000 });
    return out;
  } finally {
    aborter.abort();
  }
}

describe("Home's terminal", () => {
  it('opens a shell on the box, in its home folder, and says where', async () => {
    const api = await viewer();
    const q = await import('@/lib/db/queries');
    const hostName = q.getDevice(q.getHome()!.hostDeviceId!)!.name;

    const shell = await api.home.terminalsPost({ body: { cols: 100, rows: 30 } });
    expect(shell).toMatchObject({ cwd: boxHome, isHome: true, deviceName: hostName });

    await api.home.terminalsInputTerminalIdPost({ params: { terminalId: shell.id }, body: { data: 'pwd; echo "at-$PWD-done"\r' } });
    expect(await readUntil(shell.id, `at-${boxHome}-done`)).toContain(boxHome);

    expect(await api.home.terminalsResizeTerminalIdPost({ params: { terminalId: shell.id }, body: { cols: 120, rows: 40 } })).toEqual({ ok: true });
    expect(await api.home.terminalsTerminalIdGet({ params: { terminalId: shell.id } })).toMatchObject({ id: shell.id, cols: 120, rows: 40 });
  }, 20_000);

  it('never takes a folder from the caller', async () => {
    const api = await viewer();
    await expect(api.home.terminalsPost({ body: { cwd: '/etc' } } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(api.home.terminalsPost({ params: { id: 'x' }, body: {} } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await api.home.terminalsGet({})).toEqual([]);
  });

  it("keeps Home's shells apart from an agent's, and closes them", async () => {
    const api = await viewer();
    const q = await import('@/lib/db/queries');
    const folder = path.join(home.root, 'agent');
    fs.mkdirSync(folder, { recursive: true });
    const ws = q.createWorkspace({ name: 'Agent', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });

    const homeShell = await api.home.terminalsPost({ body: {} });
    const agentShell = await api.workspaces.terminalsPost({ params: { id: ws.id }, body: {} });
    try {
      expect((await api.home.terminalsGet({})).map((t) => t.id)).toEqual([homeShell.id]);
      expect((await api.workspaces.terminalsGet({ params: { id: ws.id } })).map((t) => t.id)).toEqual([agentShell.id]);
      // Neither reaches the other's shell by id.
      await expect(api.home.terminalsTerminalIdGet({ params: { terminalId: agentShell.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(api.home.terminalsTerminalIdDelete({ params: { terminalId: agentShell.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(api.home.terminalsInputTerminalIdPost({ params: { terminalId: agentShell.id }, body: { data: 'x' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(api.workspaces.terminalsTerminalIdGet({ params: { id: ws.id, terminalId: homeShell.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(await api.home.terminalsTerminalIdDelete({ params: { terminalId: homeShell.id } })).toEqual({ ok: true });
      expect(await api.home.terminalsGet({})).toEqual([]);
      expect((await api.workspaces.terminalsGet({ params: { id: ws.id } })).map((t) => t.id)).toEqual([agentShell.id]);
    } finally {
      (await import('@/lib/terminal/pty-manager')).killAllForOwner(`workspace:${ws.id}`);
    }
  }, 20_000);

  it('starts no shell when the home folder is gone', async () => {
    process.env.HOME = path.join(boxHome, 'gone');
    const api = await viewer();
    await expect(api.home.terminalsPost({ body: {} })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await api.home.terminalsGet({})).toEqual([]);
  });

  it('streams only for the one Home base', async () => {
    const { isTerminalBase } = await import('@/lib/realtime/terminal-feed');
    expect(isTerminalBase('/home')).toBe(true);
    for (const base of ['/home/', '/home/x', '/homes', '/home/../sessions/x', 'home']) expect(isTerminalBase(base)).toBe(false);
  });
});
