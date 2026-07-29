import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { APP_SHORT_ID } from '@/constants/app';

// Each test builds real repos and shells out to git several times, and the
// first one also pays for the schema migration on a cold database.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Resolution against a real filesystem and real git repos
 * (docs/reference-folders-spec.md §12). The git probe shells out, so mocking
 * it would test nothing worth testing — the whole point is that the branch and
 * drift we report match what git actually says.
 */
describe('reference folder resolution', () => {
  let tmpDir: string;
  const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
  const saveEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-refresolve-'));
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
    process.env[appRootEnv] = tmpDir;
    process.env[dbPathEnv] = path.join(tmpDir, 'data.db');
    process.env[mirrorDisabledEnv] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) {
      if (saveEnv[k] === undefined) delete process.env[k];
      else process.env[k] = saveEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]): void {
    execFileSync('git', args, {
      cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
  }

  /** A repo with one commit on `main`. */
  function makeRepo(name: string): string {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'README.md'), '# hi\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'initial');
    return dir;
  }

  function makePlainDir(name: string): string {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'note.md'), 'hello\n');
    return dir;
  }

  async function load() {
    const q = await import('@/lib/db/queries');
    const resolve = await import('@/lib/reference-folders/resolve');
    resolve.clearReferenceFolderGitCache();
    return { q, resolve };
  }

  it('resolves a bare path and reports it exists', async () => {
    const { q, resolve } = await load();
    const dir = makePlainDir('vault');
    const ws = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });
    const row = q.createReferenceFolder({ workspaceId: ws.id, alias: 'vault', path: dir });

    const resolved = await resolve.resolveReferenceFolder(row);
    expect(resolved?.absolutePath).toBe(dir);
    expect(resolved?.exists).toBe(true);
    expect(resolved?.git).toBeNull();
    expect(resolved?.global).toBe(false);
  });

  it('resolves a workspace target to that workspace’s cwd', async () => {
    const { q, resolve } = await load();
    const backendDir = makePlainDir('backend');
    const app = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });
    const backend = q.createWorkspace({ name: 'Backend', cwd: backendDir, isGit: false, status: 'active' });
    const row = q.createReferenceFolder({
      workspaceId: app.id,
      alias: 'backend',
      targetWorkspaceId: backend.id,
    });

    const resolved = await resolve.resolveReferenceFolder(row);
    expect(resolved?.absolutePath).toBe(backendDir);
    expect(resolved?.exists).toBe(true);
  });

  it('still resolves when the target workspace is archived', async () => {
    const { q, resolve } = await load();
    const backendDir = makePlainDir('backend');
    const app = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });
    const backend = q.createWorkspace({ name: 'Backend', cwd: backendDir, isGit: false, status: 'active' });
    const row = q.createReferenceFolder({
      workspaceId: app.id,
      alias: 'backend',
      targetWorkspaceId: backend.id,
    });
    q.archiveWorkspace(backend.id);

    // Archiving a workspace is a statement about the rail, not about whether
    // its folder is readable.
    const resolved = await resolve.resolveReferenceFolder(row);
    expect(resolved?.absolutePath).toBe(backendDir);
    expect(resolved?.exists).toBe(true);
  });

  it('marks a missing path as broken instead of throwing', async () => {
    const { q, resolve } = await load();
    const ws = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });
    const row = q.createReferenceFolder({
      workspaceId: ws.id,
      alias: 'gone',
      path: path.join(tmpDir, 'not-here'),
    });
    const resolved = await resolve.resolveReferenceFolder(row);
    expect(resolved?.exists).toBe(false);
  });

  it('treats a file as broken — you cannot point an agent at one', async () => {
    const { q, resolve } = await load();
    const file = path.join(tmpDir, 'a-file.txt');
    fs.writeFileSync(file, 'not a folder\n');
    const ws = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });
    const row = q.createReferenceFolder({ workspaceId: ws.id, alias: 'afile', path: file });
    const resolved = await resolve.resolveReferenceFolder(row);
    expect(resolved?.exists).toBe(false);
  });

  it('reads branch and clean state from a real repo', async () => {
    const { q, resolve } = await load();
    const repo = makeRepo('api');
    const ws = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });
    const row = q.createReferenceFolder({ workspaceId: ws.id, alias: 'api', path: repo });

    const resolved = await resolve.resolveReferenceFolder(row);
    expect(resolved?.git?.branch).toBe('main');
    expect(resolved?.git?.dirty).toBe(false);
    // No upstream configured, so drift is unknown rather than zero.
    expect(resolved?.git?.ahead).toBeNull();
    expect(resolved?.git?.behind).toBeNull();
  });

  it('detects uncommitted changes', async () => {
    const { q, resolve } = await load();
    const repo = makeRepo('api');
    fs.writeFileSync(path.join(repo, 'README.md'), '# changed\n');
    const ws = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });
    const row = q.createReferenceFolder({ workspaceId: ws.id, alias: 'api', path: repo });

    const resolved = await resolve.resolveReferenceFolder(row);
    expect(resolved?.git?.dirty).toBe(true);
  });

  it('reports drift against an upstream — the stale-checkout guard', async () => {
    const { q, resolve } = await load();
    const upstream = makeRepo('upstream');
    const clone = path.join(tmpDir, 'clone');
    execFileSync('git', ['clone', '-q', upstream, clone], { stdio: 'pipe' });

    // Two commits land upstream after the clone, so the clone is 2 behind.
    fs.writeFileSync(path.join(upstream, 'a.txt'), 'a\n');
    git(upstream, 'add', '.');
    git(upstream, 'commit', '-q', '-m', 'a');
    fs.writeFileSync(path.join(upstream, 'b.txt'), 'b\n');
    git(upstream, 'add', '.');
    git(upstream, 'commit', '-q', '-m', 'b');
    git(clone, 'fetch', '-q', 'origin');

    const ws = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });
    const row = q.createReferenceFolder({ workspaceId: ws.id, alias: 'api', path: clone });

    const resolved = await resolve.resolveReferenceFolder(row);
    expect(resolved?.git?.behind).toBe(2);
    expect(resolved?.git?.ahead).toBe(0);
  });

  it('reports a detached HEAD as having no branch', async () => {
    const { q, resolve } = await load();
    const repo = makeRepo('api');
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    git(repo, 'checkout', '-q', sha);
    const ws = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });
    const row = q.createReferenceFolder({ workspaceId: ws.id, alias: 'api', path: repo });

    const resolved = await resolve.resolveReferenceFolder(row);
    expect(resolved?.git).not.toBeNull();
    expect(resolved?.git?.branch).toBeNull();
  });

  it('flags a folder that sits inside the consuming workspace’s own cwd', async () => {
    const { q, resolve } = await load();
    const appDir = makePlainDir('app');
    const inner = path.join(appDir, 'docs');
    fs.mkdirSync(inner);
    const ws = q.createWorkspace({ name: 'App', cwd: appDir, isGit: false, status: 'active' });
    const row = q.createReferenceFolder({ workspaceId: ws.id, alias: 'docs', path: inner });

    const resolved = await resolve.resolveReferenceFolder(row, { consumerCwd: appDir });
    expect(resolved?.redundantWithCwd).toBe(true);

    const outside = q.createReferenceFolder({
      workspaceId: ws.id,
      alias: 'vault',
      path: makePlainDir('vault'),
    });
    const outsideResolved = await resolve.resolveReferenceFolder(outside, { consumerCwd: appDir });
    expect(outsideResolved?.redundantWithCwd).toBe(false);
  });

  it('merges globals into the workspace view with the workspace winning', async () => {
    const { q, resolve } = await load();
    const ownDir = makePlainDir('own-design');
    const globalDir = makePlainDir('global-design');
    const docsDir = makePlainDir('global-docs');
    const ws = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });

    q.createReferenceFolder({ workspaceId: null, alias: 'design', path: globalDir });
    q.createReferenceFolder({ workspaceId: null, alias: 'docs', path: docsDir });
    q.createReferenceFolder({ workspaceId: ws.id, alias: 'design', path: ownDir });

    const resolved = await resolve.listResolvedReferenceFolders(ws.id);
    expect(resolved).toHaveLength(2);
    const design = resolved.find((r) => r.alias === 'design');
    expect(design?.absolutePath).toBe(ownDir);
    expect(design?.global).toBe(false);
    expect(resolved.find((r) => r.alias === 'docs')?.global).toBe(true);
  });

  it('keeps broken references out of what the agent is told', async () => {
    const { q, resolve } = await load();
    const good = makePlainDir('good');
    const ws = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });
    q.createReferenceFolder({ workspaceId: ws.id, alias: 'good', path: good });
    q.createReferenceFolder({ workspaceId: ws.id, alias: 'gone', path: path.join(tmpDir, 'nope') });

    // Settings shows both so the user can fix the broken one...
    expect(await resolve.listResolvedReferenceFolders(ws.id)).toHaveLength(2);
    // ...but the agent only hears about the one that is actually there.
    const usable = await resolve.listUsableReferenceFolders(ws.id);
    expect(usable.map((r) => r.alias)).toEqual(['good']);
  });

  it('drops a reference whose target workspace has vanished', async () => {
    const { q, resolve } = await load();
    const ws = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });
    const backend = q.createWorkspace({
      name: 'Backend',
      cwd: makePlainDir('backend'),
      isGit: false,
      status: 'active',
    });
    const row = q.createReferenceFolder({
      workspaceId: ws.id,
      alias: 'backend',
      targetWorkspaceId: backend.id,
    });

    // Simulate a row that outlived its target (the FK cascade normally
    // prevents this; resolution must not blow up if it ever happens).
    const { getDb } = await import('@/lib/db');
    const { workspaces } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    getDb().delete(workspaces).where(eq(workspaces.id, backend.id)).run();

    expect(resolve.referenceFolderPath({ ...row, targetWorkspaceId: backend.id })).toBeNull();
    expect(await resolve.resolveReferenceFolder({ ...row })).toBeNull();
  });

  it('skips the git probe when asked, for callers that only need paths', async () => {
    const { q, resolve } = await load();
    const repo = makeRepo('api');
    const ws = q.createWorkspace({ name: 'App', cwd: path.join(tmpDir, 'app'), isGit: false, status: 'active' });
    const row = q.createReferenceFolder({ workspaceId: ws.id, alias: 'api', path: repo });

    const resolved = await resolve.resolveReferenceFolder(row, { probeGit: false });
    expect(resolved?.exists).toBe(true);
    expect(resolved?.git).toBeNull();
  });
});
