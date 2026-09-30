/**
 * A repository's own local files in a new worktree (its agentex.workspace.json
 * `fromSource`: links and copies such as .env.local). What the agent's folder
 * has is brought in. What it doesn't have is skipped and named, and never
 * fails the worktree: a fresh copy of a project on another device has no
 * .env.local, and every execution there failed to set up (found in gate B).
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { createGitFixture, git, type GitFixture } from '@/test/fixtures/git';
import type { WorkspaceRecord } from '@/db/types';

vi.setConfig({ testTimeout: 30_000 });

let home: TestHome;
let fixture: GitFixture;
let folder: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-local-files-' });
  fixture = createGitFixture();
  const remote = fixture.remote('app', {
    'package.json': '{"name":"app"}\n',
    'agentex.workspace.json': JSON.stringify({ fromSource: { link: ['.env.local'], copy: ['config/*.local.json'] } }),
    '.gitignore': '.env.local\nconfig/*.local.json\n',
  });
  folder = fixture.clone(remote, path.join(home.root, 'app'));
});

afterEach(async () => {
  fixture.cleanup();
  await home.cleanup();
});

function workspace(): WorkspaceRecord {
  return { id: 'agent', name: 'App', slug: 'app', cwd: folder, isGit: true, baseBranch: 'main', remoteName: 'origin', worktreeRoot: null } as unknown as WorkspaceRecord;
}

it('makes the worktree when a linked local file is missing, and says which', async () => {
  const { createWorktreeForSession } = await import('./index');
  const made = await createWorktreeForSession({ ws: workspace(), sessionId: '01a0e000-0000-7000-8000-00000000aaaa', sessionLabel: 'First' });
  expect(fs.existsSync(path.join(made.path, 'package.json'))).toBe(true);
  expect(fs.existsSync(path.join(made.path, '.env.local'))).toBe(false);
  expect(made.warning).toContain("App's folder on this device has no .env.local, so this worktree has none.");
});

it('links and copies what the folder has', async () => {
  fs.writeFileSync(path.join(folder, '.env.local'), 'SECRET=1\n');
  fs.mkdirSync(path.join(folder, 'config'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'config', 'dev.local.json'), '{}\n');
  const { createWorktreeForSession } = await import('./index');
  const made = await createWorktreeForSession({ ws: workspace(), sessionId: '01a0e000-0000-7000-8000-00000000bbbb', sessionLabel: 'Second' });
  expect(fs.lstatSync(path.join(made.path, '.env.local')).isSymbolicLink()).toBe(true);
  expect(fs.readFileSync(path.join(made.path, '.env.local'), 'utf8')).toBe('SECRET=1\n');
  expect(fs.readFileSync(path.join(made.path, 'config', 'dev.local.json'), 'utf8')).toBe('{}\n');
  expect(made.warning ?? '').not.toContain('.env.local');
  // Tracked files are untouched by any of it.
  expect(git(made.path, 'status', '--porcelain')).toBe('');
});
