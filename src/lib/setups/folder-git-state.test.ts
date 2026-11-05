/**
 * Whether an agent is a git agent is a fact about its folder on the home, so
 * it follows the folder. An agent pointed at a repository used to stay marked
 * as plain (and the other way round), since only creating an agent looked.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentSession } from '@agentex/agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from '@/lib/server/operations/workspaces/[id]';
import { operationContext } from '@/lib/server/operation';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
let q: typeof import('@/lib/db/queries');
let folders: typeof import('./folders');
let hostId: string;
let laptopId: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-folder-git-state-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  hostId = identity.ensureHomeIdentity().device.id;
  q = await import('@/lib/db/queries');
  folders = await import('./folders');
  const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: null, deviceName: 'MacBook', createdByApiKeyId: null });
  laptopId = q.redeemEnrollGrant({ secret: grant.secret, name: 'MacBook' }).device.id;
});
afterEach(async () => {
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

function plain(name: string): string {
  const dir = path.join(home.root, name);
  fs.mkdirSync(dir);
  return dir;
}

function repo(name: string): string {
  const dir = plain(name);
  const env = { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@b' };
  execSync('git init -q -b main && git commit -q --allow-empty -m init && git update-ref refs/remotes/origin/main HEAD', { cwd: dir, env });
  return dir;
}

const plainAgent = (cwd: string) =>
  q.createWorkspace({ name: 'Blog', cwd, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });

describe('choosing an agent\'s folder on the home', () => {
  it('makes it a git agent when the new folder is a repository', async () => {
    const ws = plainAgent(plain('home-folder'));
    const target = repo('blog');

    await folders.chooseWorkspaceFolder(ws.id, hostId, target);

    expect(q.getWorkspace(ws.id)).toMatchObject({ cwd: target, isGit: true, baseBranch: 'main', remoteName: 'origin' });
  });

  it('makes it a plain agent when the new folder is not', async () => {
    const before = repo('was-repo');
    const ws = q.createWorkspace({ name: 'Blog', cwd: before, isGit: true, baseBranch: 'main', remoteName: 'origin', worktreeRoot: '/worktrees', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
    const target = plain('now-plain');

    await folders.chooseWorkspaceFolder(ws.id, hostId, target);

    expect(q.getWorkspace(ws.id)).toMatchObject({ cwd: target, isGit: false, baseBranch: null, remoteName: null, worktreeRoot: null });
  });

  it('corrects an agent whose record is wrong when the same folder is saved again', async () => {
    const target = repo('already-here');
    const ws = plainAgent(target);
    q.setAgentFolder(ws.id, hostId, target);
    expect(q.getWorkspace(ws.id)?.isGit).toBe(false);

    await folders.chooseWorkspaceFolder(ws.id, hostId, target);

    expect(q.getWorkspace(ws.id)?.isGit).toBe(true);
  });

  it('leaves a chat from before in the folder, where it was', async () => {
    const start = plain('start');
    const ws = plainAgent(start);
    const { session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Earlier work' });
    const target = repo('blog');

    await folders.chooseWorkspaceFolder(ws.id, hostId, target);

    const read = q.getChatSessionWithExecution(session.id);
    expect(read?.worktreePath).toBe(target);
    expect(read?.execution?.worktreePath).toBeNull();
  });

  it('refuses a folder that is not there, and changes nothing', async () => {
    const start = plain('start');
    const ws = plainAgent(start);

    await expect(folders.chooseWorkspaceFolder(ws.id, hostId, path.join(home.root, 'missing'))).rejects.toThrow(/isn't a folder/);

    expect(q.getWorkspace(ws.id)).toMatchObject({ cwd: start, isGit: false });
  });
});

describe('a live session of the agent', () => {
  /** A main chat with a harness running, whose tools depend on the agent being a git agent. */
  async function liveMainChat(workspaceId: string) {
    const executor = await import('@/lib/executor/adapter');
    const chat = q.createChatSession({ harness: 'codex', model: 'gpt-6.1-sol', workspaceId, type: 'orchestration' });
    const close = vi.fn(async () => {});
    executor._cacheHarnessSession(chat.id, { close, send: vi.fn() } as unknown as AgentSession);
    return close;
  }

  it('restarts when saving the same folder changes whether the agent is a git agent', async () => {
    const target = repo('already-here');
    const ws = plainAgent(target);
    q.setAgentFolder(ws.id, hostId, target);
    const close = await liveMainChat(ws.id);

    await folders.chooseWorkspaceFolder(ws.id, hostId, target);

    expect(close).toHaveBeenCalledOnce();
  });

  it('carries on when saving the same folder changes nothing', async () => {
    const target = repo('already-right');
    const ws = q.createWorkspace({ name: 'Blog', cwd: target, isGit: true, baseBranch: 'main', remoteName: 'origin', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
    q.setAgentFolder(ws.id, hostId, target);
    const close = await liveMainChat(ws.id);

    await folders.chooseWorkspaceFolder(ws.id, hostId, target);

    expect(close).not.toHaveBeenCalled();
  });
});

describe("changing the folder through the agent's settings", () => {
  const request = () => operationContext(new Request('http://fixture/'), {}, '/fixture');

  it('reads the git state from the new folder', async () => {
    const ws = plainAgent(plain('start'));
    const target = repo('blog');

    expect(await PATCH({ params: { id: ws.id }, body: { cwd: target } }, request())).toMatchObject({ ok: true, status: 200 });

    expect(q.getWorkspace(ws.id)).toMatchObject({ cwd: target, isGit: true, baseBranch: 'main', remoteName: 'origin' });
  });

  it('lets a patch that names a field keep it', async () => {
    const ws = plainAgent(plain('start'));
    const target = repo('blog');

    await PATCH({ params: { id: ws.id }, body: { cwd: target, baseBranch: 'trunk' } }, request());

    expect(q.getWorkspace(ws.id)).toMatchObject({ isGit: true, baseBranch: 'trunk' });
  });

  it('leaves the git state alone when the folder stays the same', async () => {
    const target = repo('blog');
    const ws = plainAgent(target);

    await PATCH({ params: { id: ws.id }, body: { cwd: target, name: 'Renamed' } }, request());

    expect(q.getWorkspace(ws.id)).toMatchObject({ name: 'Renamed', isGit: false });
  });
});

describe('choosing it on another device', () => {
  it('leaves the agent as the home knows it', async () => {
    const start = repo('at-home');
    const ws = q.createWorkspace({ name: 'Blog', cwd: start, isGit: true, baseBranch: 'main', remoteName: 'origin', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });

    await folders.chooseWorkspaceFolder(ws.id, laptopId, '/Users/laptop/blog');

    expect(q.getWorkspace(ws.id)).toMatchObject({ cwd: start, isGit: true, baseBranch: 'main' });
    expect(q.getWorkspaceSetup(ws.id, laptopId)?.sourcePath).toBe('/Users/laptop/blog');
  });
});
