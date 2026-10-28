/**
 * A non-git agent's chat works in the agent's own folder, and its Files view
 * reads that folder: the tree, a file, a save. It used to get an empty tree
 * (no stored worktree path), which the view showed as loading rows forever.
 * Archiving the chat leaves the folder alone, since it is the person's own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
let folder: string;
let chatId: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();

beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-plain-agent-files-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  folder = path.join(home.root, 'reading-app');
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  fs.mkdirSync(path.join(folder, 'node_modules', 'vite'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), '# Reading app\n');
  fs.writeFileSync(path.join(folder, 'src', 'main.ts'), 'export {};\n');
  fs.writeFileSync(path.join(folder, 'node_modules', 'vite', 'index.js'), '');
  const q = await import('@/lib/db/queries');
  const ws = q.createWorkspace({ name: 'Reading app', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  chatId = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Build the reader' }).session.id;
});

afterEach(async () => {
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
  vi.unstubAllEnvs();
});

async function tree(): Promise<{ status: number; paths: string[]; entries: { path: string; status?: string }[] }> {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest(`http://ri.local/api/sessions/${chatId}/tree`), { params: Promise.resolve({ id: chatId }) });
  const body = (await res.json()) as { entries: { path: string; status?: string }[] };
  return { status: res.status, entries: body.entries, paths: body.entries.map((e) => e.path).sort() };
}

it("lists the agent's folder, without dependency folders", async () => {
  const listed = await tree();
  expect(listed.status).toBe(200);
  expect(listed.paths).toEqual(['README.md', 'src/main.ts']);
});

it('lists a folder that became a repository after the agent was added, with its uncommitted files marked', async () => {
  // The chat that surfaced this: the agent's instructions said to commit as
  // it went, so it ran `git init` in a folder the agent records as plain.
  git(folder, 'init', '-q', '-b', 'main');
  git(folder, 'config', 'user.name', 'T');
  git(folder, 'config', 'user.email', 't@example.invalid');
  fs.writeFileSync(path.join(folder, '.gitignore'), 'node_modules/\n');
  git(folder, 'add', '.');
  git(folder, 'commit', '-q', '-m', 'start');
  fs.writeFileSync(path.join(folder, 'src', 'lesson.ts'), 'export {};\n');

  const listed = await tree();
  expect(listed.status).toBe(200);
  expect(listed.paths).toEqual(['.gitignore', 'README.md', 'src/lesson.ts', 'src/main.ts']);
  expect(listed.entries.find((e) => e.path === 'src/lesson.ts')?.status).toBe('untracked');
});

it('opens and saves a file in the folder', async () => {
  const { GET, PUT } = await import('../file/route');
  const url = `http://ri.local/api/sessions/${chatId}/file?path=src/main.ts`;
  const read = await GET(new NextRequest(url), { params: Promise.resolve({ id: chatId }) });
  expect(read.status).toBe(200);
  expect(((await read.json()) as { content: string }).content).toBe('export {};\n');

  const saved = await PUT(
    new NextRequest(url, { method: 'PUT', body: JSON.stringify({ content: 'export const ready = true;\n' }), headers: { 'content-type': 'application/json' } }),
    { params: Promise.resolve({ id: chatId }) },
  );
  expect(saved.status).toBe(200);
  expect(fs.readFileSync(path.join(folder, 'src', 'main.ts'), 'utf8')).toBe('export const ready = true;\n');
});

it("archiving the chat keeps the agent's folder", async () => {
  const { archiveExecutionSession } = await import('@/lib/sessions/dispatch');
  const archived = await archiveExecutionSession({ sessionId: chatId });
  expect(archived?.status).toBe('archived');
  expect(fs.readdirSync(folder).sort()).toEqual(['README.md', 'node_modules', 'src']);
});
