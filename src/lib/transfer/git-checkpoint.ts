/**
 * The Git side of moving work between computers (docs/homes-spec.md §8,
 * P4.1 and P4.2). Git owns code versions and their transfer: the source
 * commits what's tracked, plus untracked files the person chose, and pushes
 * without force. The destination fetches and checks the exact commit, not
 * just a branch name, before it builds a worktree there.
 *
 * Git and the filesystem only, no database, so the home and a worker run the
 * same code on their own folders. Nothing here stashes, resets, force-pushes
 * or deletes: a step that can't go ahead stops and says why, and leaves every
 * file and branch as it was.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import picomatch from 'picomatch';
import { expandFilesToCopyPatterns } from '@/lib/workspaces/files-to-copy';
import { sanitizeChildEnv } from '@/lib/utils/sanitize-child-env';

const run = promisify(execFile);

/** Why a step stopped. `stage` in the transfer names where. */
export class CheckpointError extends Error {
  constructor(
    readonly code:
      | 'not_on_branch'
      | 'no_remote'
      | 'push_rejected'
      | 'push_failed'
      | 'commit_failed'
      | 'not_published'
      | 'checkpoint_mismatch'
      | 'divergent_branch'
      | 'branch_in_use'
      | 'target_exists'
      | 'invalid_untracked',
    message: string,
  ) {
    super(message);
    this.name = 'CheckpointError';
  }
}

async function git(cwd: string, args: string[], opts: { allowFail?: boolean } = {}): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run('git', args, {
      cwd,
      env: { ...sanitizeChildEnv(), GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    if (!opts.allowFail) throw err;
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? '').trim() };
  }
}

/** Never offered for inclusion, and never included: local setup and secrets. */
const ALWAYS_LOCAL = ['.ri.local.json', '.env', '.env.*', '*.pem', '*.key', 'id_rsa*', '.npmrc', '.netrc'];

function localOnlyMatcher(filesToCopy: readonly string[]): (file: string) => boolean {
  const patterns = expandFilesToCopyPatterns([...ALWAYS_LOCAL, ...filesToCopy]);
  const matchers = patterns.map((p) => picomatch(p, { dot: true }));
  return (file) => matchers.some((m) => m(file));
}

export interface WorkingState {
  branch: string | null;
  head: string | null;
  /** Tracked files with changes, staged or not. */
  changed: string[];
  /** Untracked files that could be included: not ignored, not local setup or secrets. */
  untracked: string[];
  /** Untracked files that stay behind whatever is chosen: local setup and secrets. */
  localOnly: string[];
}

/** What a checkpoint would take, for the person to choose untracked files from. */
export async function workingState(worktree: string, filesToCopy: readonly string[] = []): Promise<WorkingState> {
  const branch = (await git(worktree, ['branch', '--show-current'])).stdout || null;
  const head = (await git(worktree, ['rev-parse', 'HEAD'], { allowFail: true })).stdout || null;
  const changed = (await git(worktree, ['diff', 'HEAD', '--name-only'], { allowFail: true })).stdout.split('\n').filter(Boolean);
  const others = (await git(worktree, ['ls-files', '--others', '--exclude-standard'])).stdout.split('\n').filter(Boolean);
  const isLocal = localOnlyMatcher(filesToCopy);
  return {
    branch,
    head,
    changed,
    untracked: others.filter((f) => !isLocal(f)),
    localOnly: others.filter((f) => isLocal(f)),
  };
}

export interface SavedCheckpoint {
  branch: string;
  remote: string;
  sha: string;
  /** Whether a commit was made for this checkpoint (false when there was nothing to save). */
  committed: boolean;
  /** Files the checkpoint commit took. */
  files: string[];
}

/**
 * Commit tracked changes and the chosen untracked files, and push the
 * branch without force. Idempotent: run again after a crash, it finds the
 * work already committed and the branch already pushed.
 */
export async function saveCheckpoint(args: {
  worktree: string;
  message: string;
  includeUntracked: readonly string[];
  filesToCopy?: readonly string[];
}): Promise<SavedCheckpoint> {
  const { worktree, message } = args;
  const state = await workingState(worktree, args.filesToCopy ?? []);
  if (!state.branch) throw new CheckpointError('not_on_branch', "The worktree isn't on a branch, so there's nothing to push and continue from.");
  const branch = state.branch;

  const chosen = [...new Set(args.includeUntracked)];
  const refused = chosen.filter((f) => !state.untracked.includes(f));
  if (refused.length > 0) {
    throw new CheckpointError(
      'invalid_untracked',
      `These can't be included: ${refused.join(', ')}. Only untracked files that aren't ignored, local setup or secrets can.`,
    );
  }

  await git(worktree, ['add', '--update']);
  if (chosen.length > 0) await git(worktree, ['add', '--', ...chosen]);
  const staged = (await git(worktree, ['diff', '--cached', '--name-only'])).stdout.split('\n').filter(Boolean);
  let committed = false;
  if (staged.length > 0) {
    const commit = await git(worktree, ['commit', '--no-verify', '-m', message], { allowFail: true });
    if (!commit.ok) throw new CheckpointError('commit_failed', `Git couldn't commit the work: ${commit.stderr || commit.stdout}`);
    committed = true;
  }
  const sha = (await git(worktree, ['rev-parse', 'HEAD'])).stdout;

  const remote = (await git(worktree, ['config', `branch.${branch}.remote`], { allowFail: true })).stdout || (await firstRemote(worktree));
  if (!remote) throw new CheckpointError('no_remote', 'The repository has no remote to publish the work to.');
  const pushed = await git(worktree, ['push', remote, `HEAD:refs/heads/${branch}`], { allowFail: true });
  if (!pushed.ok) {
    const text = `${pushed.stderr}\n${pushed.stdout}`;
    if (/\[rejected\]|non-fast-forward|fetch first|stale info/i.test(text)) {
      throw new CheckpointError(
        'push_rejected',
        `${remote}/${branch} has commits this worktree doesn't. Nothing was forced: bring them in on this computer, then continue again.`,
      );
    }
    throw new CheckpointError('push_failed', `Git couldn't push ${branch} to ${remote}: ${pushed.stderr || pushed.stdout}`);
  }
  await git(worktree, ['branch', `--set-upstream-to=${remote}/${branch}`], { allowFail: true });
  const published = (await git(worktree, ['ls-remote', remote, `refs/heads/${branch}`])).stdout.split(/\s+/)[0] ?? '';
  if (published !== sha) {
    throw new CheckpointError('push_failed', `${remote}/${branch} is at ${published.slice(0, 7) || 'nothing'} after the push, not ${sha.slice(0, 7)}.`);
  }
  return { branch, remote, sha, committed, files: staged };
}

async function firstRemote(cwd: string): Promise<string | null> {
  const remotes = (await git(cwd, ['remote'], { allowFail: true })).stdout.split('\n').filter(Boolean);
  return remotes.includes('origin') ? 'origin' : remotes[0] ?? null;
}

/** The commit a branch is published at, or null when it isn't on the remote. */
export async function publishedCommit(repo: string, branch: string, remote?: string | null): Promise<{ remote: string; sha: string } | null> {
  const name = remote || (await firstRemote(repo));
  if (!name) return null;
  const listed = await git(repo, ['ls-remote', name, `refs/heads/${branch}`], { allowFail: true });
  const sha = listed.ok ? listed.stdout.split(/\s+/)[0] : '';
  return sha ? { remote: name, sha } : null;
}

/**
 * Fetch a published checkpoint into this computer's clone and check it's the
 * exact commit. A branch that only has the same name isn't enough.
 */
export async function fetchCheckpoint(repo: string, checkpoint: { remote: string; branch: string; sha: string }): Promise<void> {
  const { remote, branch, sha } = checkpoint;
  const fetched = await git(repo, ['fetch', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], { allowFail: true });
  if (!fetched.ok) throw new CheckpointError('not_published', `Couldn't fetch ${branch} from ${remote}: ${fetched.stderr}`);
  const at = (await git(repo, ['rev-parse', `refs/remotes/${remote}/${branch}`])).stdout;
  if (at !== sha) {
    throw new CheckpointError(
      'checkpoint_mismatch',
      `${remote}/${branch} is at ${at.slice(0, 7)}, not the checkpoint ${sha.slice(0, 7)}. It changed after the work was saved.`,
    );
  }
}

/** Branches checked out in a worktree of this repository, with where. */
async function checkedOut(repo: string): Promise<Map<string, string>> {
  const out = (await git(repo, ['worktree', 'list', '--porcelain'])).stdout;
  const map = new Map<string, string>();
  let current: string | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    else if (line.startsWith('branch refs/heads/') && current) map.set(line.slice('branch refs/heads/'.length), current);
  }
  return map;
}

/**
 * A worktree for the checkpoint, on its branch, in this computer's clone.
 * The branch here is made at the checkpoint, or moved forward to it when
 * it's behind. One with commits the checkpoint doesn't have, or checked out
 * somewhere else, stops the step: nothing is reset or taken over.
 */
export async function worktreeAtCheckpoint(args: {
  repo: string;
  path: string;
  checkpoint: { remote: string; branch: string; sha: string };
}): Promise<{ path: string; branch: string; sha: string }> {
  const { repo, checkpoint } = args;
  const { remote, branch, sha } = checkpoint;
  await fetchCheckpoint(repo, checkpoint);

  // Retried after a crash: the worktree it made is the one it wants.
  if (fs.existsSync(args.path)) {
    const head = await git(args.path, ['rev-parse', 'HEAD'], { allowFail: true });
    const on = await git(args.path, ['branch', '--show-current'], { allowFail: true });
    if (head.ok && head.stdout === sha && on.stdout === branch) return { path: args.path, branch, sha };
    throw new CheckpointError('target_exists', `${args.path} already exists and isn't this checkpoint. Nothing was changed in it.`);
  }

  const existing = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true });
  const inUse = (await checkedOut(repo)).get(branch);
  if (existing.ok && existing.stdout) {
    if (inUse) {
      throw new CheckpointError('branch_in_use', `${branch} is checked out in ${inUse} on this computer. Close that worktree or switch its branch, then continue again.`);
    }
    if (existing.stdout !== sha) {
      const behind = await git(repo, ['merge-base', '--is-ancestor', existing.stdout, sha], { allowFail: true });
      if (!behind.ok) {
        throw new CheckpointError(
          'divergent_branch',
          `${branch} here has commits that aren't in the checkpoint. Nothing was changed: merge or rename it on this computer, then continue again.`,
        );
      }
      // Behind the checkpoint: moving it forward loses nothing.
      await git(repo, ['branch', '--force', branch, sha]);
    }
    fs.mkdirSync(path.dirname(args.path), { recursive: true });
    await git(repo, ['worktree', 'add', args.path, branch]);
  } else {
    fs.mkdirSync(path.dirname(args.path), { recursive: true });
    await git(repo, ['worktree', 'add', '-b', branch, args.path, sha]);
  }
  await git(args.path, ['branch', `--set-upstream-to=${remote}/${branch}`], { allowFail: true });
  const head = (await git(args.path, ['rev-parse', 'HEAD'])).stdout;
  if (head !== sha) throw new CheckpointError('checkpoint_mismatch', `The new worktree is at ${head.slice(0, 7)}, not ${sha.slice(0, 7)}.`);
  return { path: args.path, branch, sha };
}

/**
 * A review checkout of a published commit (P4.1): detached at the commit, in
 * its own folder, never on the execution's branch, so it can't publish to it
 * by accident. Refreshed only while clean: local edits are kept, never
 * replaced.
 */
export async function reviewCheckout(args: {
  repo: string;
  path: string;
  checkpoint: { remote: string; branch: string; sha: string };
}): Promise<{ path: string; sha: string; refreshed: boolean; dirty: boolean; created: boolean }> {
  const { repo, checkpoint } = args;
  await fetchCheckpoint(repo, checkpoint);
  if (!fs.existsSync(args.path)) {
    fs.mkdirSync(path.dirname(args.path), { recursive: true });
    await git(repo, ['worktree', 'add', '--detach', args.path, checkpoint.sha]);
    return { path: args.path, sha: checkpoint.sha, refreshed: false, dirty: false, created: true };
  }
  const head = (await git(args.path, ['rev-parse', 'HEAD'])).stdout;
  const status = (await git(args.path, ['status', '--porcelain'])).stdout;
  if (status) return { path: args.path, sha: head, refreshed: false, dirty: true, created: false };
  if (head === checkpoint.sha) return { path: args.path, sha: head, refreshed: false, dirty: false, created: false };
  await git(args.path, ['checkout', '--detach', checkpoint.sha]);
  return { path: args.path, sha: checkpoint.sha, refreshed: true, dirty: false, created: false };
}
