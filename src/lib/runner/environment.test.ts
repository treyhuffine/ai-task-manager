/**
 * An execution's environment, resolved on the device running it
 * (docs/homes-build.md, P2.7): the agent's folder and linked folders as the
 * home records them (docs/homes-spec.md §4.1), each checked here, the mode,
 * and the checked-out commit.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionEnvironment } from './environment';

let root: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-environment-')));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** The agent's repository here, and a docs folder beside it. */
async function setUp() {
  const source = path.join(root, 'projects', 'demo');
  fs.mkdirSync(source, { recursive: true });
  git(source, 'init', '-q', '-b', 'main');
  git(source, 'config', 'user.email', 'test@example.com');
  git(source, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(source, 'README.md'), '# demo\n');
  git(source, 'add', '.');
  git(source, 'commit', '-q', '-m', 'first');
  fs.mkdirSync(path.join(root, 'projects', 'docs'));
  return source;
}

/** As the home records them: docs beside it, design gone without, secrets not chosen, and one that isn't there. */
const recorded = () => [
  { alias: 'docs', description: 'docs folder', path: path.join(root, 'projects', 'docs'), state: 'ready' as const },
  { alias: 'design', description: 'design folder', path: null, state: 'omitted' as const },
  { alias: 'secrets', description: 'secrets folder', path: null, state: 'unconfigured' as const },
  { alias: 'gone', description: 'gone folder', path: path.join(root, 'projects', 'not-there'), state: 'ready' as const },
];

const expected = (cwd: string, sourceFolder: string | null): ExecutionEnvironment => ({
  homeId: 'home-1',
  homeName: 'My Ri',
  deviceName: 'MacBook',
  agent: { id: 'agent-1', name: 'Demo' },
  executionId: 'exec-1',
  isGit: true,
  cwd,
  sourceFolder,
  branch: null,
  baseBranch: 'main',
  baseSha: 'abc123',
  references: recorded(),
  tools: { integrations: false, browser: true },
  harness: 'claude',
  model: 'fake-model',
  permissionMode: 'ask',
});

describe('the environment', () => {
  it("takes the agent's folders as the home records them, and checks each one here", async () => {
    const source = await setUp();
    const worktree = path.join(root, 'worktrees', 'demo-1');
    git(source, 'worktree', 'add', '-q', '-b', 'demo/fix', worktree);
    const { resolveEnvironment } = await import('./environment');
    const env = await resolveEnvironment(expected(worktree, source));
    expect(env).toMatchObject({ sourceFolder: source, mode: 'worktree', branch: 'demo/fix' });
    expect(env.head).toBe(git(worktree, 'rev-parse', 'HEAD'));
    expect(env.references.map((r) => [r.alias, r.state, r.path])).toEqual([
      ['docs', 'ready', path.join(root, 'projects', 'docs')],
      ['design', 'omitted', null],
      ['secrets', 'unconfigured', null],
      ['gone', 'missing', path.join(root, 'projects', 'not-there')],
    ]);
  });

  it("is live when it works in the agent's folder itself, and names no folder that isn't there", async () => {
    const source = await setUp();
    const { resolveEnvironment } = await import('./environment');
    expect(await resolveEnvironment(expected(source, source))).toMatchObject({ mode: 'live', sourceFolder: source, branch: 'main' });

    const elsewhere = path.join(root, 'plain');
    fs.mkdirSync(elsewhere);
    const env = await resolveEnvironment({ ...expected(elsewhere, path.join(root, 'moved-away')), agent: { id: 'agent-2', name: 'Other' }, isGit: false });
    expect(env).toMatchObject({ mode: 'folder', sourceFolder: null, head: null });
  });

  it('renders a short block that names its file and every expected folder', async () => {
    const source = await setUp();
    const { resolveEnvironment, renderEnvironment } = await import('./environment');
    const text = renderEnvironment(await resolveEnvironment(expected(source, source)), '/work/session-instructions/chat-1.environment.json');
    expect(text).toContain('## Your environment');
    expect(text).toContain('running on MacBook, for My Ri, as the "Demo" agent');
    expect(text).toContain('`/work/session-instructions/chat-1.environment.json`');
    expect(text).toContain("the agent's folder itself (live mode");
    expect(text).toContain('- docs: `' + path.join(root, 'projects', 'docs') + '`. docs folder');
    expect(text).toContain('- design: left out on this device. design folder');
    expect(text).toContain('- secrets: not set up on this device');
    expect(text).toContain('Tools from My Ri: the agent browser.');
    expect(text).not.toMatch(/[—;]/);
  });

  it('marks a read-only folder, and only that one', async () => {
    const source = await setUp();
    const { resolveEnvironment, renderEnvironment } = await import('./environment');
    const env = expected(source, source);
    env.references = env.references.map((ref) => (ref.alias === 'docs' ? { ...ref, readOnly: true } : ref));
    const text = renderEnvironment(await resolveEnvironment(env), '/work/env.json');
    expect(text).toContain('- docs: `' + path.join(root, 'projects', 'docs') + '`, read only. docs folder');
    expect(text.match(/read only/g)).toHaveLength(1);
  });
});
