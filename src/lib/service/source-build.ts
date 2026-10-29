/**
 * Releases built from a checkout (docs/always-on-spec.md section 8). Only
 * when the owner runs `ri update`, never on a schedule. The same packaging
 * script as a published release, so the owner's Homes run what users get.
 *
 * The checkout itself is never touched: not its working tree, index or
 * branch. The build happens in a separate worktree at the chosen commit,
 * inside the installation's build folder, and that worktree is removed after.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { getRuntimeBaseDir } from './paths';
import { stageRelease } from './store';
import { freeBytes } from './snapshot';
import { untraced } from '@/lib/utils/untraced';

/** Room a build needs: the build output, the packaged release before it moves
 * into the store, and the build's own scratch files. */
export const BUILD_FREE_BYTES = 8 * 1024 ** 3;

export class DivergedBranchesError extends Error {}

export interface CommitChoice {
  commit: string;
  /** Which branch it came from. Both contain it when they are equal. */
  ref: 'main' | 'origin/main';
  fetched: boolean;
}

function git(checkout: string, args: string[]) {
  return execFileSync(untraced('git'), ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function revision(checkout: string, ref: string) {
  try { return git(checkout, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) || null; } catch { return null; }
}
function contains(checkout: string, newer: string, older: string) {
  try { git(checkout, ['merge-base', '--is-ancestor', older, newer]); return true; } catch { return false; }
}

/** Of `main` and `origin/main`, the one that contains the other: the newest
 * committed main, pushed or not. Uncommitted changes are never built. */
export function selectCommit(checkout: string, options: { fetch?: boolean } = {}): CommitChoice {
  if (!fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ checkout, '.git'))) throw new Error(`${checkout} isn't a git checkout.`);
  let fetched = false;
  if (options.fetch !== false) {
    try {
      if (git(checkout, ['remote']).split('\n').includes('origin')) { git(checkout, ['fetch', '--quiet', 'origin', 'main']); fetched = true; }
    } catch { /* offline: build what this checkout already has */ }
  }
  const local = revision(checkout, 'refs/heads/main');
  const remote = revision(checkout, 'refs/remotes/origin/main');
  if (!local && !remote) throw new Error(`${checkout} has no main branch.`);
  if (!remote || remote === local) return { commit: local!, ref: 'main', fetched };
  if (!local) return { commit: remote, ref: 'origin/main', fetched };
  if (contains(checkout, remote, local)) return { commit: remote, ref: 'origin/main', fetched };
  if (contains(checkout, local, remote)) return { commit: local, ref: 'main', fetched };
  throw new DivergedBranchesError(`main and origin/main have diverged in ${checkout}. Merge or rebase them, then run ri update again.`);
}

export interface Run { (command: string, args: string[], options: { cwd: string; env?: Record<string, string>; log: number }): Promise<void> }

/** Lower CPU and disk priority, so the Homes keep their share while it runs.
 * It reserves no memory: a build that needs more slows the computer, and
 * `scripts/next-build.mjs` stops only a true runaway. */
export function background(command: string, args: string[]): [string, string[]] {
  if (process.platform === 'darwin') return ['/usr/sbin/taskpolicy', ['-c', 'utility', command, ...args]];
  return ['nice', ['-n', '10', command, ...args]];
}

const runCommand: Run = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(untraced(command), args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ['ignore', options.log, options.log] });
  child.once('error', reject);
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} ${args.slice(0, 3).join(' ')} failed (${signal ?? `exit ${code}`})`)));
});

export interface BuildOptions {
  checkout: string;
  commit: string;
  base?: string;
  /** Each step as it starts, for the person waiting on `ri update`. */
  step?: (description: string) => void;
  run?: Run;
  /** Free bytes where the build goes. Tests pass a fixed value. */
  free?: (directory: string) => number;
}
export interface BuildResult { id: string; version: string; commit: string; log: string }

async function removeWorktree(checkout: string, worktree: string, run: Run, log: number) {
  if (fs.existsSync(/* turbopackIgnore: true */ worktree)) await run('git', ['-C', checkout, 'worktree', 'remove', '--force', worktree], { cwd: checkout, log }).catch(() => {});
  fs.rmSync(/* turbopackIgnore: true */ worktree, { recursive: true, force: true });
  await run('git', ['-C', checkout, 'worktree', 'prune'], { cwd: checkout, log }).catch(() => {});
}

/** Build the commit into a release and stage it in the shared store. The Homes
 * keep running the current release throughout, and still do if this fails. */
export async function buildRelease(options: BuildOptions): Promise<BuildResult> {
  const base = options.base ?? getRuntimeBaseDir();
  const run = options.run ?? runCommand;
  const builds = path.join(/* turbopackIgnore: true */ base, 'builds');
  fs.mkdirSync(/* turbopackIgnore: true */ builds, { recursive: true, mode: 0o700 });
  const free = (options.free ?? freeBytes)(builds);
  if (free < BUILD_FREE_BYTES) throw new Error(`Not enough free disk space to build Ri. A build needs ${(BUILD_FREE_BYTES / 1024 ** 3).toFixed(0)} GiB free and ${(free / 1024 ** 3).toFixed(1)} GiB is.`);
  const short = options.commit.slice(0, 12);
  const worktree = path.join(/* turbopackIgnore: true */ builds, short);
  const output = path.join(/* turbopackIgnore: true */ builds, `${short}.release`);
  const logPath = path.join(/* turbopackIgnore: true */ builds, `${short}.log`);
  const log = fs.openSync(/* turbopackIgnore: true */ logPath, 'w', 0o600);
  try {
    // A worktree or release a crashed build left behind.
    await removeWorktree(options.checkout, worktree, run, log);
    fs.rmSync(/* turbopackIgnore: true */ output, { recursive: true, force: true });
    options.step?.(`Preparing ${short}`);
    await run('git', ['-C', options.checkout, 'worktree', 'add', '--detach', worktree, options.commit], { cwd: options.checkout, log });
    try {
      // The portable Node download is the same for every build.
      const cache = path.join(/* turbopackIgnore: true */ builds, 'downloads');
      fs.mkdirSync(/* turbopackIgnore: true */ cache, { recursive: true, mode: 0o700 });
      fs.symlinkSync(cache, path.join(/* turbopackIgnore: true */ worktree, '.electron-demo'));
      options.step?.('Installing dependencies');
      await run(...background('pnpm', ['install', '--frozen-lockfile']), { cwd: worktree, log });
      options.step?.('Building (a few minutes)');
      await run(...background(process.execPath, ['desktop/package.mjs', '--headless', '--release-dir', output]), { cwd: worktree, log, env: { RI_RELEASE_COMMIT: options.commit } });
      options.step?.('Adding it to this computer');
      const version = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ worktree, 'package.json'), 'utf8')).version as string;
      const manifest = stageRelease(output, base, { move: true });
      return { id: manifest.id, version, commit: options.commit, log: logPath };
    } finally {
      await removeWorktree(options.checkout, worktree, run, log);
      fs.rmSync(/* turbopackIgnore: true */ output, { recursive: true, force: true });
    }
  } finally { fs.closeSync(log); }
}

/** The commit a staged release was built from, if it came from a checkout. */
export function releaseCommit(repo: string): string | null {
  try {
    const { commit } = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ repo, 'ri-release.json'), 'utf8')) as { commit?: string };
    return typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit) ? commit : null;
  } catch { return null; }
}
