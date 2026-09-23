import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * The agent's own folder (docs/agents-view-spec.md Phase 5): tree, file and
 * terminals on the workspace itself, with no execution. Tree and file run
 * against a real git checkout and a real plain folder. The terminal manager
 * is stubbed (no native pty in tests), so these pin cwd and ownership.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-agent-folder-'));
const TEST_DB = path.join(ROOT, 'data.db');
const saved = { root: process.env.RI_ROOT, db: process.env.RI_DB_PATH };
process.env.RI_ROOT = ROOT;

const GIT = path.join(ROOT, 'repo');
const PLAIN = path.join(ROOT, 'plain');
fs.mkdirSync(GIT);
fs.mkdirSync(PLAIN);
fs.writeFileSync(path.join(GIT, 'tracked.txt'), 'committed\n');
fs.writeFileSync(path.join(GIT, '.gitignore'), '.env\nnode_modules/\n');
execSync('git init -q -b main && git add -A && git -c user.email=a@b -c user.name=a commit -q -m init', { cwd: GIT });
fs.writeFileSync(path.join(GIT, 'tracked.txt'), 'edited\n');
fs.writeFileSync(path.join(GIT, 'new.txt'), 'untracked\n');
fs.writeFileSync(path.join(GIT, '.env'), 'SECRET=1\n');
fs.mkdirSync(path.join(GIT, 'node_modules'));
fs.writeFileSync(path.join(GIT, 'node_modules', 'dep.js'), '');
fs.mkdirSync(path.join(PLAIN, 'notes'));
fs.writeFileSync(path.join(PLAIN, 'notes', 'a.md'), '# A\n');

const createTerminal = vi.fn((input: { ownerId: string; cwd: string }) => ({
  id: 't1', ownerId: input.ownerId, cwd: input.cwd, shell: '/bin/zsh', cols: 80, rows: 24,
  exited: false, exitCode: null, createdAt: '2026-01-01T00:00:00.000Z',
}));
const listTerminals = vi.fn<(owner: string) => unknown[]>(() => []);
const writeInput = vi.fn<(owner: string, id: string, data: string) => boolean>(() => true);
const resizeTerminal = vi.fn<(owner: string, id: string, cols: number, rows: number) => boolean>(() => true);
const killTerminal = vi.fn<(owner: string, id: string) => boolean>(() => true);
const getTerminal = vi.fn<(owner: string, id: string) => unknown>(() => null);
const killAllForOwner = vi.fn<(owner: string) => number>(() => 0);
vi.mock('@/lib/terminal/pty-manager', () => ({
  createTerminal: (input: { ownerId: string; cwd: string }) => createTerminal(input),
  listTerminals: (owner: string) => listTerminals(owner),
  writeInput: (o: string, id: string, d: string) => writeInput(o, id, d),
  resizeTerminal: (o: string, id: string, c: number, r: number) => resizeTerminal(o, id, c, r),
  killTerminal: (o: string, id: string) => killTerminal(o, id),
  getTerminal: (o: string, id: string) => getTerminal(o, id),
  killAllForOwner: (o: string) => killAllForOwner(o),
  subscribe: () => null,
  TerminalSpawnError: class TerminalSpawnError extends Error {},
}));
const close = vi.fn<(id: string) => Promise<void>>(async () => {});
vi.mock('@/lib/executor/adapter', () => ({ close: (id: string) => close(id) }));

afterAll(() => {
  for (const [key, value] of [['RI_ROOT', saved.root], ['RI_DB_PATH', saved.db]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
  process.env.RI_DB_PATH = TEST_DB;
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  for (const m of [createTerminal, listTerminals, writeInput, resizeTerminal, killTerminal, getTerminal, killAllForOwner, close]) {
    m.mockClear();
  }
});

async function seed(cwd: string, isGit: boolean, extra: { filesToCopy?: string[] } = {}) {
  const q = await import('@/lib/db/queries');
  return q.createWorkspace({ name: path.basename(cwd), cwd, isGit, filesToCopy: extra.filesToCopy ?? [], status: 'active' });
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const get = (url = 'http://127.0.0.1/x') => {
  const u = new URL(url);
  return Object.assign(new Request(u), { nextUrl: u }) as never;
};
const postJson = (body: unknown) =>
  new Request('http://127.0.0.1/x', { method: 'POST', body: JSON.stringify(body) }) as never;

type TreeBody = { entries: Array<{ path: string; status?: string | null }> };

describe('GET /api/workspaces/:id/tree', () => {
  it("lists a git agent's checkout: tracked, untracked, with status, honoring .gitignore", async () => {
    const ws = await seed(GIT, true);
    const { GET } = await import('./tree/route');
    const body = (await (await GET(get(), ctx({ id: ws.id }))).json()) as TreeBody;
    const paths = body.entries.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['tracked.txt', 'new.txt', '.gitignore']));
    expect(paths).not.toContain('.env');
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false);
    expect(body.entries.find((e) => e.path === 'tracked.txt')?.status).toBeTruthy();
  });

  it('surfaces files the agent copies into worktrees even though git ignores them', async () => {
    const ws = await seed(GIT, true, { filesToCopy: ['.env'] });
    const { GET } = await import('./tree/route');
    const body = (await (await GET(get(), ctx({ id: ws.id }))).json()) as TreeBody;
    expect(body.entries.map((e) => e.path)).toContain('.env');
  });

  it('walks a plain folder', async () => {
    const ws = await seed(PLAIN, false);
    const { GET } = await import('./tree/route');
    const body = (await (await GET(get(), ctx({ id: ws.id }))).json()) as TreeBody;
    expect(body.entries.map((e) => e.path)).toContain('notes/a.md');
  });

  it('lists a checkout on a detached HEAD without status flags, and still reads its files', async () => {
    const dir = path.join(ROOT, 'detached');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    execSync('git init -q -b main && git add -A && git -c user.email=a@b -c user.name=a commit -q -m init && git checkout -q --detach', { cwd: dir });
    const ws = await seed(dir, true);
    const tree = await import('./tree/route');
    const body = (await (await tree.GET(get(), ctx({ id: ws.id }))).json()) as TreeBody;
    expect(body.entries.map((e) => e.path)).toEqual(['a.txt']);
    const file = await import('./file/route');
    const read = (await (await file.GET(get('http://127.0.0.1/x?path=a.txt'), ctx({ id: ws.id }))).json()) as { content: string };
    expect(read.content).toBe('one\n');
  });

  it('404s an unknown agent and 409s a folder that is gone', async () => {
    const { GET } = await import('./tree/route');
    expect((await GET(get(), ctx({ id: 'nope' }))).status).toBe(404);
    const ws = await seed(path.join(ROOT, 'vanished'), false);
    const res = await GET(get(), ctx({ id: ws.id }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('does not exist');
  });
});

describe('GET /api/workspaces/:id/file', () => {
  it('reads a file from the checkout, and the committed side with base=1', async () => {
    const ws = await seed(GIT, true);
    const { GET } = await import('./file/route');
    const live = (await (await GET(get('http://127.0.0.1/x?path=tracked.txt'), ctx({ id: ws.id }))).json()) as { content: string };
    expect(live.content).toBe('edited\n');
    const base = (await (await GET(get('http://127.0.0.1/x?path=tracked.txt&base=1'), ctx({ id: ws.id }))).json()) as { content: string };
    expect(base.content).toBe('committed\n');
  });

  it('reads from a plain folder', async () => {
    const ws = await seed(PLAIN, false);
    const { GET } = await import('./file/route');
    const body = (await (await GET(get('http://127.0.0.1/x?path=notes/a.md'), ctx({ id: ws.id }))).json()) as { content: string };
    expect(body.content).toBe('# A\n');
  });

  it('refuses paths outside the folder, and maps missing path and missing file', async () => {
    const ws = await seed(PLAIN, false);
    const { GET } = await import('./file/route');
    expect((await GET(get('http://127.0.0.1/x?path=../repo/tracked.txt'), ctx({ id: ws.id }))).status).toBe(400);
    expect((await GET(get('http://127.0.0.1/x'), ctx({ id: ws.id }))).status).toBe(400);
    expect((await GET(get('http://127.0.0.1/x?path=nope.md'), ctx({ id: ws.id }))).status).toBe(404);
  });
});

describe('/api/workspaces/:id/terminals', () => {
  it("spawns in the agent's folder, owned by the workspace (the source checkout for git)", async () => {
    const ws = await seed(GIT, true);
    const { POST } = await import('./terminals/route');
    const res = await POST(postJson({ cols: 120, rows: 40 }), ctx({ id: ws.id }));
    expect(res.status).toBe(201);
    expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({
      cwd: GIT, ownerId: `workspace:${ws.id}`, cols: 120, rows: 40,
    }));
  });

  it('lists only the workspace owner\'s shells, never an execution\'s', async () => {
    const ws = await seed(PLAIN, false);
    const { GET } = await import('./terminals/route');
    expect((await GET(get(), ctx({ id: ws.id }))).status).toBe(200);
    expect(listTerminals).toHaveBeenCalledWith(`workspace:${ws.id}`);
  });

  it('refuses unknown, archived and missing-folder agents without spawning', async () => {
    const q = await import('@/lib/db/queries');
    const { POST } = await import('./terminals/route');
    expect((await POST(postJson({}), ctx({ id: 'nope' }))).status).toBe(404);
    const archived = await seed(PLAIN, false);
    q.archiveWorkspace(archived.id);
    expect((await POST(postJson({}), ctx({ id: archived.id }))).status).toBe(409);
    const gone = await seed(path.join(ROOT, 'vanished'), false);
    expect((await POST(postJson({}), ctx({ id: gone.id }))).status).toBe(409);
    expect(createTerminal).not.toHaveBeenCalled();
  });

  it('routes input, resize and kill to the workspace owner', async () => {
    const ws = await seed(PLAIN, false);
    const owner = `workspace:${ws.id}`;
    const input = await import('./terminals/[terminalId]/input/route');
    const resize = await import('./terminals/[terminalId]/resize/route');
    const one = await import('./terminals/[terminalId]/route');
    const params = ctx({ id: ws.id, terminalId: 't1' });

    expect((await input.POST(postJson({ data: 'ls\r' }), params)).status).toBe(200);
    expect(writeInput).toHaveBeenCalledWith(owner, 't1', 'ls\r');
    expect((await resize.POST(postJson({ cols: 100, rows: 30 }), params)).status).toBe(200);
    expect(resizeTerminal).toHaveBeenCalledWith(owner, 't1', 100, 30);
    expect((await one.DELETE(get(), params)).status).toBe(200);
    expect(killTerminal).toHaveBeenCalledWith(owner, 't1');
    expect((await one.GET(get(), params)).status).toBe(404); // getTerminal stub has none
    expect((await input.POST(postJson({ data: 'x' }), ctx({ id: 'nope', terminalId: 't1' }))).status).toBe(404);
  });

  it("archiving the agent reaps its own terminals and closes its main chat's process", async () => {
    const ws = await seed(PLAIN, false);
    const q = await import('@/lib/db/queries');
    const main = q.createChatSession({ type: 'orchestration', workspaceId: ws.id, harness: 'claude', status: 'active' });
    const { POST } = await import('./archive/route');
    expect((await POST(postJson({}), ctx({ id: ws.id }))).status).toBe(200);
    expect(killAllForOwner).toHaveBeenCalledWith(`workspace:${ws.id}`);
    expect(close).toHaveBeenCalledWith(main.id);
  });
});

describe('GET /api/workspaces/:id/previews', () => {
  it('404s an unknown agent and lists none for a new one', async () => {
    const { GET } = await import('./previews/route');
    expect((await GET(get(), ctx({ id: 'nope' }))).status).toBe(404);
    const ws = await seed(PLAIN, false);
    expect(await (await GET(get(), ctx({ id: ws.id }))).json()).toEqual({ previews: [] });
  });
});
