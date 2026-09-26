/**
 * The workbench of work on a connected computer (docs/homes-build.md, P3.5,
 * spec §5.6), end to end through the home's own routes, with the worker in
 * its own process running real shells. Terminals: an execution's in the
 * worktree the laptop prepared, an agent's in its folder there, output
 * streamed and resumed after a reconnect, the placement checked on every
 * operation, and the laptop going away: said, input refused, and never a
 * shell at home. And the Files of an agent that lives on the laptop.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import { startWorkerProcess, type WorkerProcess } from '@/test/fixtures/worker-process';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';

let home: TestHome;
let server: HomeServer;
let worker: WorkerProcess | null = null;
let laptopRoot: string;
let computerId: string;
let workspaceId: string;
let repo: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-remote-workbench-' });
  laptopRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-remote-workbench-laptop-')));
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  const homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  const laptop = q.createApiKey({ name: 'Laptop CLI', deviceType: 'computer' });
  computerId = q.registerComputerForApiKey({ apiKeyId: laptop.key.id, name: 'Laptop', platform: 'darwin' }).computer.id;
  server = await startHomeServer();

  // The agent lives on the laptop: its folder at home doesn't exist.
  workspaceId = q.createWorkspace({
    name: 'Demo',
    cwd: path.join(home.root, 'demo-on-the-mini'),
    isGit: true,
    baseBranch: 'main',
    filesToCopy: [],
    collapsed: false,
    skipLiveConfirm: false,
    browserEnabled: false,
  }).id;
  repo = path.join(laptopRoot, 'projects', 'demo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'README.md'), '# demo\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'first');
  const { writeSetupFile } = await import('@/lib/setups/local-file');
  writeSetupFile(repo, { version: 1, homeId, agents: { [workspaceId]: { references: {} } } }, null);
  fs.mkdirSync(path.join(laptopRoot, '.config'), { recursive: true });
  fs.writeFileSync(
    path.join(laptopRoot, '.config', 'setups.json'),
    JSON.stringify({ version: 1, locations: [{ dir: repo, registeredAt: new Date().toISOString() }] }),
  );
  q.recordAgentSetupReports(
    computerId,
    [{ agentId: workspaceId, sourcePath: repo, configRevision: null, references: [], status: 'ready', problem: null }],
    { complete: true },
  );

  const grant = await fetch(`${server.url}/api/workers/grants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${laptop.token.plaintext}`, 'content-type': 'application/json' },
    body: '{}',
  }).then((r) => r.json() as Promise<{ code: string }>);
  const { workerKey } = await fetch(`${server.url}/api/workers/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: grant.code, name: 'laptop', protocol: WORKER_PROTOCOL, version: 'test' }),
  }).then((r) => r.json() as Promise<{ workerKey: string }>);
  worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
  await until(() => (q.getComputer(computerId)?.harnesses?.length ?? 0) > 0, "the laptop's harness report");
}, 60_000);

afterEach(async () => {
  await worker?.stop();
  worker = null;
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/executor/remote-live'))._resetRemoteLive();
  (await import('@/lib/terminal/remote'))._resetRemoteTerminals();
  await server.close();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
  fs.rmSync(laptopRoot, { recursive: true, force: true });
});

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${what}.\n${worker?.output() ?? ''}`);
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

/** Call one of the home's terminal routes in process, as the browser would. */
async function route(base: 'sessions' | 'workspaces', id: string, sub: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  const { NextRequest } = await import('next/server');
  const file = sub === '' ? 'terminals' : `terminals/[terminalId]${sub.includes('/') ? `/${sub.split('/')[1]}` : ''}`;
  const terminalId = sub.split('/')[0] || undefined;
  const mod = (await import(`@/app/api/${base}/[id]/${file}/route`)) as Record<string, Handler>;
  const url = `http://127.0.0.1/api/${base}/${id}/terminals${terminalId ? `/${sub}` : ''}`;
  const req = new NextRequest(url, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return mod[method](req, { params: Promise.resolve({ id, ...(terminalId ? { terminalId } : {}) }) });
}

async function json(res: Response | Promise<Response>) {
  const r = await res;
  return { status: r.status, body: (await r.json()) as Record<string, unknown> & Array<Record<string, unknown>> };
}

/** A terminal's output stream, read event by event. */
function reader(res: Response) {
  const stream = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: Array<{ event: string; data: unknown; id?: string }> = [];
  let done = false;
  void (async () => {
    for (;;) {
      const { value, done: finished } = await stream.read().catch(() => ({ value: undefined, done: true }));
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const lines = frame.split('\n');
        const event = lines.find((l) => l.startsWith('event: '))?.slice(7);
        const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
        const id = lines.find((l) => l.startsWith('id: '))?.slice(4);
        if (event && data !== undefined) events.push({ event, data: JSON.parse(data), id });
      }
    }
    done = true;
  })();
  return {
    events,
    closed: () => done,
    text: () => events.filter((e) => e.event === 'data').map((e) => e.data as string).join(''),
    lastId: () => events.filter((e) => e.id).at(-1)?.id,
    cancel: () => stream.cancel().catch(() => {}),
  };
}

describe('a terminal on a connected computer', () => {
  it("runs in the laptop's worktree, streams there and back, and resumes after a reconnect", async () => {
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
    const q = await import('@/lib/db/queries');
    const session = await dispatchExecutionSession({ workspaceId, computerId, label: 'Shell there' });
    await until(() => !!q.getOpenPlacement(session.executionId!)?.worktreePath, 'the worktree');
    const worktree = q.getOpenPlacement(session.executionId!)!.worktreePath!;

    const created = await json(route('sessions', session.id, '', 'POST', { cols: 100, rows: 30 }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ cwd: worktree, cols: 100, rows: 30, computerName: 'Laptop', isHome: false });
    const terminalId = created.body.id as string;
    expect((await json(route('sessions', session.id, '', 'GET'))).body).toEqual([expect.objectContaining({ id: terminalId, computerName: 'Laptop' })]);

    const first = reader(await route('sessions', session.id, `${terminalId}/stream`, 'GET'));
    await until(() => first.events.some((e) => e.event === 'ready'), 'the stream to be ready');
    expect(await json(route('sessions', session.id, `${terminalId}/input`, 'POST', { data: 'echo where-$((40+2)) && pwd\r' }))).toMatchObject({ status: 200 });
    await until(() => first.text().includes('where-42') && first.text().includes(worktree), 'the output from the laptop');
    expect(await json(route('sessions', session.id, `${terminalId}/resize`, 'POST', { cols: 120, rows: 40 }))).toMatchObject({ status: 200 });
    const seen = first.lastId()!;
    await first.cancel();

    // Printed while nobody watched, then caught up from the laptop's ring, and only that.
    await route('sessions', session.id, `${terminalId}/input`, 'POST', { data: 'echo while-away\r' });
    await new Promise((r) => setTimeout(r, 500));
    const second = reader(await route('sessions', session.id, `${terminalId}/stream`, 'GET', undefined, { 'last-event-id': seen }));
    await until(() => second.text().includes('while-away'), 'the missed output');
    expect(second.events.find((e) => e.event === 'ready')?.data).toMatchObject({ resumed: true });
    expect(second.text()).not.toContain('where-42');
    await second.cancel();

    // Never a shell at home for it.
    const pty = await import('@/lib/terminal/pty-manager');
    expect(pty.listTerminals(session.executionId!)).toEqual([]);

    // Only for the placement the laptop holds.
    const { requestWorker } = await import('@/lib/workers/hub');
    expect(await requestWorker(computerId, 'terminal', {
      op: 'input', scope: { kind: 'execution', executionId: session.executionId, generation: 0 }, terminalId, data: 'echo stale\r',
    })).toMatchObject({ status: 409, body: { error: 'moved' } });

    expect(await json(route('sessions', session.id, terminalId, 'DELETE'))).toMatchObject({ status: 200 });
    expect((await json(route('sessions', session.id, '', 'GET'))).body).toEqual([]);
  }, 90_000);

  it("opens the agent's own terminal in its folder on the laptop", async () => {
    const created = await json(route('workspaces', workspaceId, '', 'POST', { cols: 80, rows: 24 }));
    expect(created).toMatchObject({ status: 201, body: { cwd: repo, computerName: 'Laptop', isHome: false } });
    const terminalId = created.body.id as string;
    const out = reader(await route('workspaces', workspaceId, `${terminalId}/stream`, 'GET'));
    await route('workspaces', workspaceId, `${terminalId}/input`, 'POST', { data: 'git rev-parse --abbrev-ref HEAD\r' });
    await until(() => out.text().includes('main'), 'the branch there');
    await out.cancel();
    const pty = await import('@/lib/terminal/pty-manager');
    expect(pty.listTerminals(`workspace:${workspaceId}`)).toEqual([]);
  }, 90_000);

  it('says the laptop went away, refuses input rather than keeping it, and starts nothing at home', async () => {
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
    const q = await import('@/lib/db/queries');
    const session = await dispatchExecutionSession({ workspaceId, computerId, label: 'Shell there' });
    await until(() => !!q.getOpenPlacement(session.executionId!)?.worktreePath, 'the worktree');
    const terminalId = (await json(route('sessions', session.id, '', 'POST', { cols: 80, rows: 24 }))).body.id as string;
    const out = reader(await route('sessions', session.id, `${terminalId}/stream`, 'GET'));
    await until(() => out.events.some((e) => e.event === 'ready'), 'the stream to be ready');

    await worker!.stop();
    worker = null;
    await until(() => out.events.some((e) => e.event === 'unavailable'), 'the stream to say so');
    expect(out.events.find((e) => e.event === 'unavailable')?.data).toEqual({
      message: "Laptop isn't connected. Its terminals are still there and come back when it reconnects.",
    });
    await until(() => out.closed(), 'the stream to close');

    const refused = { status: 409, body: { error: 'unavailable' } };
    expect(await json(route('sessions', session.id, `${terminalId}/input`, 'POST', { data: 'ls\r' }))).toMatchObject(refused);
    expect(await json(route('sessions', session.id, '', 'GET'))).toMatchObject(refused);
    expect(await json(route('sessions', session.id, '', 'POST', { cols: 80, rows: 24 }))).toMatchObject(refused);
    const reopened = reader(await route('sessions', session.id, `${terminalId}/stream`, 'GET'));
    await until(() => reopened.closed(), 'the stream to close');
    expect(reopened.events.map((e) => e.event)).toEqual(['unavailable']);

    const pty = await import('@/lib/terminal/pty-manager');
    expect(pty.listTerminals(session.executionId!)).toEqual([]);
  }, 90_000);
});

describe('an agent that lives on a connected computer', () => {
  it("shows its folder there, reads its files from there, and says when it's away", async () => {
    const { runOnFor } = await import('@/lib/setups/run-on');
    expect(runOnFor(workspaceId)!.livesOn).toEqual({ computerId, name: 'Laptop', isHome: false, folder: repo });

    const { NextRequest } = await import('next/server');
    const get = async (sub: string) => {
      const mod = (await import(`@/app/api/workspaces/[id]/${sub.split('?')[0]}/route`)) as Record<string, Handler>;
      const res = await mod.GET(new NextRequest(`http://127.0.0.1/api/workspaces/${workspaceId}/${sub}`), { params: Promise.resolve({ id: workspaceId }) });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    fs.writeFileSync(path.join(repo, 'README.md'), '# demo, edited on the laptop\n');
    const tree = await get('tree');
    expect(tree.status).toBe(200);
    expect(tree.body.entries).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'README.md' })]));
    expect(await get('file?path=README.md')).toMatchObject({ status: 200, body: { content: '# demo, edited on the laptop\n' } });
    expect(await get('file?path=README.md&base=1')).toMatchObject({ status: 200, body: { content: '# demo\n' } });
    expect(await get('file?path=../outside')).toMatchObject({ status: 400 });

    await worker!.stop();
    worker = null;
    expect(await get('tree')).toMatchObject({ status: 409, body: { error: 'unavailable', message: 'Laptop is not connected right now.' } });
  }, 90_000);
});
