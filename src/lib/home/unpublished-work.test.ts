/**
 * Before retiring a home (P5.1): which of its executions' worktrees here
 * hold work no remote has, uncommitted or unpushed, and which are gone.
 * Nothing is written, to the home or the worktrees.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { createGitFixture, git, type GitFixture } from '@/test/fixtures/git';

let home: TestHome;
let fixture: GitFixture;
const folders = { clean: '', uncommitted: '', unpushed: '', gone: '' };

beforeEach(async () => {
  process.env.RI_MIRROR_DISABLED = '1';
  home = await createTestHome({ prefix: 'ri-unpublished-' });
  fixture = createGitFixture();
  const remote = fixture.remote('app');
  for (const name of ['clean', 'uncommitted', 'unpushed'] as const) folders[name] = fixture.clone(remote, path.join(fixture.base, 'worktrees', name));
  folders.gone = path.join(fixture.base, 'worktrees', 'gone');
  fs.writeFileSync(path.join(folders.uncommitted, 'draft.ts'), 'wip\n');
  fixture.commit(folders.unpushed, { 'feature.ts': 'done\n' }, 'Not pushed yet');
  const q = await import('@/lib/db/queries');
  const agent = q.createWorkspace({ name: 'App', cwd: home.root, isGit: true, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  for (const [label, worktreePath] of Object.entries(folders)) q.createExecutionWithChat({ workspaceId: agent, harness: 'claude', label, worktreePath });
  (await import('@/lib/db')).resetDb();
});

afterEach(async () => {
  delete process.env.RI_MIRROR_DISABLED;
  fixture.cleanup();
  await home.cleanup();
});

it('names the folders with work no remote has, and the ones no longer here', async () => {
  const { unpublishedWork, describeUnpublishedWork } = await import('./unpublished-work');
  const before = git(folders.uncommitted, 'status', '--porcelain');
  const report = unpublishedWork(home.root);
  expect(report).toMatchObject({ worktrees: 4, here: 3, missing: 1, errors: [] });
  expect(report.withWork.map((w) => [w.label, w.uncommitted, w.unpushed, w.branch]).sort()).toEqual([
    ['uncommitted', 1, 0, 'main'],
    ['unpushed', 0, 1, 'main'],
  ]);
  expect(report.folders).toHaveLength(4);
  const text = describeUnpublishedWork(report);
  expect(text).toContain('4 executions in');
  expect(text).toContain('2 folders have work no remote has:');
  expect(text).toContain(`  ${folders.unpushed}\n    1 unpushed commits on main. App: "unpushed" [active]`);
  // Only read.
  expect(git(folders.uncommitted, 'status', '--porcelain')).toBe(before);
});

it('reads a folder that live executions share once, and says which are inside the home', async () => {
  const q = await import('@/lib/db/queries');
  const { resetDb } = await import('@/lib/db');
  const agent = q.listWorkspaces({ status: 'active' })[0]!.id;
  const worktree = fixture.clone(fixture.remote('inside'), path.join(home.root, '.work', 'worktrees', 'app', 'app-1'));
  fs.writeFileSync(path.join(worktree, 'wip.ts'), 'wip\n');
  q.createExecutionWithChat({ workspaceId: agent, harness: 'claude', label: 'Live one', worktreePath: folders.uncommitted });
  q.createExecutionWithChat({ workspaceId: agent, harness: 'claude', label: 'In the home', worktreePath: worktree });
  resetDb();
  const { unpublishedWork, describeUnpublishedWork } = await import('./unpublished-work');
  const report = unpublishedWork(home.root);
  const shared = report.folders.find((f) => f.path === folders.uncommitted)!;
  expect(shared.executions.map((e) => e.label).sort()).toEqual(['Live one', 'uncommitted']);
  expect(report.folders.find((f) => f.path === worktree)).toMatchObject({ insideHome: true, uncommitted: 1 });
  const text = describeUnpublishedWork(report);
  expect(text).toContain('1 of those here are worktrees inside');
  expect(text).toContain(`  ${worktree} (inside the home)`);
  expect(text).toContain('App: 2 executions');
});
