import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildRelease, DivergedBranchesError, releaseCommit, selectCommit, type Run } from './source-build';
import { writeRuntimeFixture } from './runtime-fixture';
import { latestRelease, storeDirectory } from './store';

let root: string;
let origin: string;
let checkout: string;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commit(cwd: string, file: string, content: string) {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, 'add', file);
  git(cwd, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '-m', `edit ${file}`);
  return git(cwd, 'rev-parse', 'HEAD');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-source-build-test-'));
  vi.stubEnv('RI_ROOT', path.join(root, 'home'));
  vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
  origin = path.join(root, 'origin.git');
  checkout = path.join(root, 'checkout');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, checkout], { stdio: 'ignore' });
  git(checkout, 'checkout', '-q', '-b', 'main');
  commit(checkout, 'package.json', JSON.stringify({ version: '0.3.0' }));
  git(checkout, 'push', '-q', 'origin', 'main');
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it('builds whichever of main and origin/main contains the other', () => {
  const pushed = git(checkout, 'rev-parse', 'HEAD');
  expect(selectCommit(checkout)).toMatchObject({ commit: pushed, fetched: true });
  // Ahead: an unpushed commit on main.
  const local = commit(checkout, 'a.txt', 'local');
  expect(selectCommit(checkout)).toMatchObject({ commit: local, ref: 'main' });
  // Behind: someone pushed from elsewhere.
  git(checkout, 'push', '-q', 'origin', 'main');
  const other = path.join(root, 'other');
  execFileSync('git', ['clone', '-q', origin, other], { stdio: 'ignore' });
  const remote = commit(other, 'b.txt', 'remote');
  git(other, 'push', '-q', 'origin', 'main');
  expect(selectCommit(checkout)).toMatchObject({ commit: remote, ref: 'origin/main' });
});

it('refuses diverged branches instead of guessing', () => {
  const other = path.join(root, 'other');
  execFileSync('git', ['clone', '-q', origin, other], { stdio: 'ignore' });
  commit(other, 'b.txt', 'remote');
  git(other, 'push', '-q', 'origin', 'main');
  commit(checkout, 'a.txt', 'local');
  expect(() => selectCommit(checkout)).toThrow(DivergedBranchesError);
});

it('ignores uncommitted changes and leaves the checkout exactly as it was', async () => {
  const head = git(checkout, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ version: 'uncommitted' }));
  const before = git(checkout, 'status', '--porcelain');
  const seen: string[] = [];
  const run: Run = async (command, args, options) => {
    // Stand in for pnpm install and the packaging script.
    if (args.includes('desktop/package.mjs')) {
      seen.push(fs.readFileSync(path.join(options.cwd, 'package.json'), 'utf8'));
      const output = args[args.indexOf('--release-dir') + 1];
      writeRuntimeFixture(output, { version: '0.3.0', files: { 'server/ri-release.json': JSON.stringify({ commit: options.env!.RI_RELEASE_COMMIT }) } });
      return;
    }
    if (command === 'git') { execFileSync('git', args, { stdio: 'ignore' }); return; }
  };
  const steps: string[] = [];
  const result = await buildRelease({ checkout, commit: selectCommit(checkout).commit, run, step: step => steps.push(step) });
  expect(seen).toEqual([JSON.stringify({ version: '0.3.0' })]);
  expect(result).toMatchObject({ version: '0.3.0', commit: head });
  expect(latestRelease()).toBe(result.id);
  expect(releaseCommit(path.join(storeDirectory(), result.id, 'server'))).toBe(head);
  // Built in its own worktree, which is gone, and the checkout is untouched.
  expect(git(checkout, 'worktree', 'list').split('\n')).toHaveLength(1);
  expect(git(checkout, 'status', '--porcelain')).toBe(before);
  expect(git(checkout, 'rev-parse', 'HEAD')).toBe(head);
  expect(fs.readdirSync(path.join(root, 'installed/builds')).sort()).toEqual([`${head.slice(0, 12)}.log`, 'downloads']);
  expect(steps).toEqual([`Preparing ${head.slice(0, 12)}`, 'Installing dependencies', 'Building (a few minutes)', 'Adding it to this computer']);
});

it('cleans up a failed build and keeps nothing half-staged', async () => {
  const run: Run = async (command, args) => {
    if (args.includes('desktop/package.mjs')) throw new Error('next build failed');
    if (command === 'git') execFileSync('git', args, { stdio: 'ignore' });
  };
  await expect(buildRelease({ checkout, commit: selectCommit(checkout).commit, run })).rejects.toThrow('next build failed');
  expect(git(checkout, 'worktree', 'list').split('\n')).toHaveLength(1);
  expect(latestRelease()).toBeNull();
});
