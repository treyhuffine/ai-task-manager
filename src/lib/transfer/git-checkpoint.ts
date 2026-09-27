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
import os from 'node:os';
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
      | 'dirty_target'
      | 'invalid_untracked'
      | 'unfinished_operation'
      | 'local_files_staged'
      | 'local_files_in_the_way',
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
      // Paths are paths: a file named `*.ts` or `:x` is that file, never a pattern.
      env: { ...sanitizeChildEnv(), GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' },
      maxBuffer: 64 * 1024 * 1024,
    });
    // A `-z` listing is kept exactly: a name can start or end with a space.
    const out = (text: string) => (args.includes('-z') ? text : text.trim());
    return { ok: true, stdout: out(stdout), stderr: stderr.trim() };
  } catch (err) {
    if (!opts.allowFail) throw err;
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? '').trim() };
  }
}

/** Paths from a `-z` listing. */
function paths(out: string): string[] {
  return out.split('\0').filter(Boolean);
}

/** Run a Git command over a list of paths, passed in a file so no list is too long for a command line. */
async function gitOverPaths(cwd: string, args: string[], list: readonly string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-paths-'));
  const file = path.join(dir, 'paths');
  try {
    fs.writeFileSync(file, list.join('\0'));
    return await git(cwd, [...args, `--pathspec-from-file=${file}`, '--pathspec-file-nul'], { allowFail: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A merge, rebase, cherry-pick or revert left unfinished in the worktree, or
 * conflicts not yet resolved: what it is, or null. Staging its files would
 * mark the conflicts resolved and commit their markers.
 */
async function unfinishedOperation(worktree: string): Promise<string | null> {
  const markers: Array<[string, string]> = [
    ['rebase-merge', 'A rebase'],
    ['rebase-apply', 'A rebase'],
    ['MERGE_HEAD', 'A merge'],
    ['CHERRY_PICK_HEAD', 'A cherry-pick'],
    ['REVERT_HEAD', 'A revert'],
  ];
  const conflicted = paths((await git(worktree, ['diff', '--name-only', '--diff-filter=U', '-z'], { allowFail: true })).stdout);
  for (const [name, what] of markers) {
    const where = (await git(worktree, ['rev-parse', '--git-path', name])).stdout;
    if (fs.existsSync(path.resolve(worktree, where))) {
      return conflicted.length > 0 ? `${what} is in progress, with conflicts in ${listed(conflicted)}` : `${what} is in progress`;
    }
  }
  return conflicted.length > 0 ? `There are unresolved conflicts in ${listed(conflicted)}` : null;
}

function listed(files: readonly string[], max = 5): string {
  const shown = files.slice(0, max).join(', ');
  return files.length > max ? `${shown} and ${files.length - max} more` : shown;
}

/**
 * Local files, untracked or ignored, that moving this worktree from one
 * commit to another would replace: a path the newer commit adds where a
 * local file already is, or a file where one of its folders would go. Git
 * refuses to overwrite an untracked file, but an ignored one it replaces
 * without a word, so this looks first.
 */
async function filesInTheWay(worktree: string, from: string, to: string): Promise<string[]> {
  const added = paths((await git(worktree, ['diff', '--name-only', '--no-renames', '--diff-filter=A', '-z', from, to])).stdout);
  const inTheWay = new Set<string>();
  for (const rel of added) {
    for (let at = rel; at && at !== '.'; at = path.dirname(at)) {
      let stat: fs.Stats | null = null;
      try {
        stat = fs.lstatSync(path.join(worktree, at));
      } catch {
        stat = null;
      }
      if (!stat) continue;
      // The path itself is taken, or a file sits where one of its folders goes.
      if (at === rel || !stat.isDirectory()) inTheWay.add(at);
      break;
    }
  }
  return [...inTheWay];
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
  /** Tracked files with changes, staged or not, that go along. */
  changed: string[];
  /** Untracked files that could be included: not ignored, not local setup or secrets. */
  untracked: string[];
  /**
   * What stays behind whatever is chosen: local setup and secrets, new or
   * changed. A change to a tracked one stays uncommitted where it is.
   */
  localOnly: string[];
  /** Local setup or secrets already staged: the checkpoint refuses rather than publish them. */
  stagedLocal: string[];
  /** Why a checkpoint can't be saved as things are, or null. */
  problem: string | null;
}

/** What a checkpoint would take, for the person to choose untracked files from. */
export async function workingState(worktree: string, filesToCopy: readonly string[] = []): Promise<WorkingState> {
  const branch = (await git(worktree, ['branch', '--show-current'])).stdout || null;
  const head = (await git(worktree, ['rev-parse', 'HEAD'], { allowFail: true })).stdout || null;
  const tracked = paths((await git(worktree, ['diff', 'HEAD', '--name-only', '--no-renames', '-z'], { allowFail: true })).stdout);
  const staged = paths((await git(worktree, ['diff', '--cached', '--name-only', '--no-renames', '-z'], { allowFail: true })).stdout);
  const others = paths((await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout);
  const isLocal = localOnlyMatcher(filesToCopy);
  const stagedLocal = staged.filter(isLocal);
  const unfinished = await unfinishedOperation(worktree);
  const problem = unfinished
    ? `${unfinished}. Finish or abort it there first: a checkpoint never commits a half-done merge.`
    : stagedLocal.length > 0
      ? `${listed(stagedLocal)} ${stagedLocal.length === 1 ? 'is' : 'are'} staged, and local setup and secrets never move. Unstage ${stagedLocal.length === 1 ? 'it' : 'them'} there first (git restore --staged).`
      : null;
  return {
    branch,
    head,
    changed: tracked.filter((f) => !isLocal(f)),
    untracked: others.filter((f) => !isLocal(f)),
    localOnly: [...others.filter(isLocal), ...tracked.filter((f) => isLocal(f) && !stagedLocal.includes(f))],
    stagedLocal,
    problem,
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
 * branch without force. Idempotent: run again after a crash or for Try
 * again, it finds the work already committed (the chosen files with it)
 * and the branch already pushed.
 *
 * Only what may go is staged: changes to local setup and secrets stay
 * uncommitted where they are, and one already staged, or a merge or rebase
 * left unfinished, stops it with nothing touched (P4 review).
 */
export async function saveCheckpoint(args: {
  worktree: string;
  message: string;
  includeUntracked: readonly string[];
  filesToCopy?: readonly string[];
}): Promise<SavedCheckpoint> {
  const { worktree, message } = args;
  const filesToCopy = args.filesToCopy ?? [];
  const state = await workingState(worktree, filesToCopy);
  if (!state.branch) throw new CheckpointError('not_on_branch', "The worktree isn't on a branch, so there's nothing to push and continue from.");
  const branch = state.branch;
  const unfinished = await unfinishedOperation(worktree);
  if (unfinished) {
    throw new CheckpointError('unfinished_operation', `${unfinished} in the worktree. Nothing was changed: finish or abort it there, then continue again.`);
  }
  if (state.stagedLocal.length > 0) {
    throw new CheckpointError(
      'local_files_staged',
      `${listed(state.stagedLocal)} ${state.stagedLocal.length === 1 ? 'is' : 'are'} staged, and local setup and secrets never move. Nothing was changed: unstage ${state.stagedLocal.length === 1 ? 'it' : 'them'} there (git restore --staged), then continue again.`,
    );
  }

  // A chosen file is taken while it's untracked, and accepted as it is once
  // it's tracked (a first attempt already committed it). Local setup,
  // secrets and ignored files are never taken.
  const isLocal = localOnlyMatcher(filesToCopy);
  const chosen = [...new Set(args.includeUntracked)];
  const newlyChosen = chosen.filter((f) => state.untracked.includes(f));
  const rest = chosen.filter((f) => !state.untracked.includes(f));
  const alreadyTracked = rest.length > 0 ? new Set(paths((await git(worktree, ['ls-files', '-z', '--', ...rest])).stdout)) : new Set<string>();
  const refused = rest.filter((f) => isLocal(f) || !alreadyTracked.has(f));
  if (refused.length > 0) {
    throw new CheckpointError(
      'invalid_untracked',
      `These can't be included: ${refused.join(', ')}. Only untracked files that aren't ignored, local setup or secrets can.`,
    );
  }

  const toStage = [...state.changed, ...newlyChosen];
  if (toStage.length > 0) {
    const added = await gitOverPaths(worktree, ['add', '--all'], toStage);
    if (!added.ok) throw new CheckpointError('commit_failed', `Git couldn't stage the work: ${added.stderr || added.stdout}`);
  }
  const staged = paths((await git(worktree, ['diff', '--cached', '--name-only', '--no-renames', '-z'])).stdout);
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
        `${remote}/${branch} has commits this work doesn't have. Nothing was forced. Bring them into its branch, then continue again.`,
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

  // The worktree this computer had for the work when it ran it before, or
  // the one a retry already made: reused on the branch, moved forward to the
  // checkpoint when it's behind and clean. Uncommitted changes there, or
  // commits the checkpoint doesn't have, stop the step with nothing touched.
  if (fs.existsSync(args.path)) {
    const head = await git(args.path, ['rev-parse', 'HEAD'], { allowFail: true });
    const on = await git(args.path, ['branch', '--show-current'], { allowFail: true });
    if (!head.ok || on.stdout !== branch) {
      throw new CheckpointError('target_exists', `${args.path} already exists and isn't on ${branch}. Nothing was changed in it.`);
    }
    // Uncommitted changes to tracked files stop it. Untracked and ignored
    // files stay as they are: one the checkpoint would replace stops it
    // below, before Git could.
    const status = (await git(args.path, ['status', '--porcelain', '--untracked-files=no'], { allowFail: true })).stdout;
    if (status) {
      throw new CheckpointError(
        'dirty_target',
        `${args.path} has changes that aren't committed. Nothing was changed: commit or clear them there, then continue again.`,
      );
    }
    if (head.stdout !== sha) {
      const behind = await git(args.path, ['merge-base', '--is-ancestor', head.stdout, sha], { allowFail: true });
      if (!behind.ok) {
        throw new CheckpointError(
          'divergent_branch',
          `${branch} in ${args.path} has commits that aren't in the checkpoint. Nothing was changed: merge them there, then continue again.`,
        );
      }
      const inTheWay = await filesInTheWay(args.path, head.stdout, sha);
      if (inTheWay.length > 0) {
        throw new CheckpointError(
          'local_files_in_the_way',
          `${listed(inTheWay)} in ${args.path} ${inTheWay.length === 1 ? 'is a local file' : 'are local files'} the checkpoint would replace. Nothing was changed: move ${inTheWay.length === 1 ? 'it' : 'them'} aside there, then continue again.`,
        );
      }
      const merged = await git(args.path, ['merge', '--ff-only', sha], { allowFail: true });
      if (!merged.ok) {
        throw new CheckpointError('dirty_target', `${args.path} couldn't move forward to the checkpoint: ${merged.stderr || merged.stdout}`);
      }
    }
    await git(args.path, ['branch', `--set-upstream-to=${remote}/${branch}`], { allowFail: true });
    return { path: args.path, branch, sha };
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

/** Where this computer keeps its review checkout of an execution: its own folder, never one the home names. */
export function reviewPathFor(workDir: string, workspaceSlug: string, executionId: string): string {
  return path.join(workDir, 'reviews', `${workspaceSlug}-${executionId.slice(-8)}`);
}

/**
 * A review checkout of a published commit (P4.1): detached at the commit, in
 * its own folder, never on the execution's branch, so it can't publish to it
 * by accident. Refreshed only while clean: local edits are kept, never
 * replaced, and so are local files the newer commit would replace
 * (`inTheWay`), ignored ones included.
 */
export async function reviewCheckout(args: {
  repo: string;
  path: string;
  checkpoint: { remote: string; branch: string; sha: string };
}): Promise<{ path: string; sha: string; refreshed: boolean; dirty: boolean; created: boolean; inTheWay?: string[] }> {
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
  const inTheWay = await filesInTheWay(args.path, head, checkpoint.sha);
  if (inTheWay.length > 0) return { path: args.path, sha: head, refreshed: false, dirty: false, created: false, inTheWay };
  await git(args.path, ['checkout', '--detach', checkpoint.sha]);
  return { path: args.path, sha: checkpoint.sha, refreshed: true, dirty: false, created: false };
}
