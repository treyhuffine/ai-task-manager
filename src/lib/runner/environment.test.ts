/**
 * An execution's environment, resolved on the computer running it
 * (docs/homes-build.md, P2.7): the agent's folder and references from that
 * computer's own setup files, the mode, and the checked-out commit, over
 * what the home expected.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionEnvironment } from './environment';

let root: string;
const saved = process.env.RI_CONFIG_DIR;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-environment-')));
  process.env.RI_CONFIG_DIR = path.join(root, 'config');
});
afterEach(() => {
  if (saved === undefined) delete process.env.RI_CONFIG_DIR;
  else process.env.RI_CONFIG_DIR = saved;
  fs.rmSync(root, { recursive: true, force: true });
});

/** The agent's repository here, set up for the home with its references. */
async function setUp(references: Record<string, string | null>) {
  const source = path.join(root, 'projects', 'demo');
  fs.mkdirSync(source, { recursive: true });
  git(source, 'init', '-q', '-b', 'main');
  git(source, 'config', 'user.email', 'test@example.com');
  git(source, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(source, 'README.md'), '# demo\n');
  git(source, 'add', '.');
  git(source, 'commit', '-q', '-m', 'first');
  fs.mkdirSync(path.join(root, 'projects', 'docs'));
  const { writeSetupFile } = await import('@/lib/setups/local-file');
  writeSetupFile(source, { version: 1, homeId: 'home-1', agents: { 'agent-1': { references } } }, null);
  const { registerLocation } = await import('@/lib/setups/registry');
  registerLocation(source);
  return source;
}

const expected = (cwd: string, sourceFolder: string | null): ExecutionEnvironment => ({
  homeId: 'home-1',
  homeName: 'My Ri',
  computerName: 'MacBook',
  agent: { id: 'agent-1', name: 'Demo' },
  executionId: 'exec-1',
  isGit: true,
  cwd,
  sourceFolder,
  branch: null,
  baseBranch: 'main',
  baseSha: 'abc123',
  references: ['docs', 'design', 'secrets', 'gone'].map((alias) => ({ alias, description: `${alias} folder`, path: null, state: 'missing' as const })),
  tools: { connectors: false, browser: true },
  harness: 'claude',
  model: 'fake-model',
  permissionMode: 'ask',
});

describe('the environment', () => {
  it("resolves the agent's folder and each reference from this computer's own setup", async () => {
    const source = await setUp({ docs: '../docs', design: null, gone: '../not-there' });
    const worktree = path.join(root, 'worktrees', 'demo-1');
    git(source, 'worktree', 'add', '-q', '-b', 'demo/fix', worktree);
    const { resolveEnvironment } = await import('./environment');
    const env = await resolveEnvironment(expected(worktree, '/the/home/thought/it/was/here'));
    expect(env).toMatchObject({ sourceFolder: source, mode: 'worktree', branch: 'demo/fix' });
    expect(env.head).toBe(git(worktree, 'rev-parse', 'HEAD'));
    expect(env.references.map((r) => [r.alias, r.state, r.path])).toEqual([
      ['docs', 'ready', path.join(root, 'projects', 'docs')],
      ['design', 'omitted', null],
      ['secrets', 'unconfigured', null],
      ['gone', 'missing', path.join(root, 'projects', 'not-there')],
    ]);
  });

  it("is live when it works in the agent's folder itself, and keeps the home's view when there's no setup here", async () => {
    const source = await setUp({});
    const { resolveEnvironment } = await import('./environment');
    expect(await resolveEnvironment(expected(source, null))).toMatchObject({ mode: 'live', sourceFolder: source, branch: 'main' });

    const elsewhere = path.join(root, 'plain');
    fs.mkdirSync(elsewhere);
    const env = await resolveEnvironment({ ...expected(elsewhere, '/home/view'), agent: { id: 'agent-2', name: 'Other' }, isGit: false });
    expect(env).toMatchObject({ mode: 'folder', sourceFolder: '/home/view', head: null });
    expect(env.references.every((r) => r.state === 'missing')).toBe(true);
  });

  it('renders a short block that names its file and every expected folder', async () => {
    const source = await setUp({ docs: '../docs', design: null });
    const { resolveEnvironment, renderEnvironment } = await import('./environment');
    const text = renderEnvironment(await resolveEnvironment(expected(source, null)), '/work/session-instructions/chat-1.environment.json');
    expect(text).toContain('## Your environment');
    expect(text).toContain('running on MacBook, for My Ri, as the "Demo" agent');
    expect(text).toContain('`/work/session-instructions/chat-1.environment.json`');
    expect(text).toContain("the agent's folder itself (live mode");
    expect(text).toContain('- docs: `' + path.join(root, 'projects', 'docs') + '`. docs folder');
    expect(text).toContain('- design: left out on this computer. design folder');
    expect(text).toContain('- secrets: not set up on this computer');
    expect(text).toContain('Tools from My Ri: the agent browser.');
    expect(text).not.toMatch(/[—;]/);
  });
});
