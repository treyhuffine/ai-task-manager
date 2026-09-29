/**
 * Push an execution's branch and bring its base branch in, the same way
 * here or on the computer it runs on (P4.5).
 *
 * A worktree starts from `origin/main` (the base refreshed from its remote)
 * and records that as its base, and its branch tracks it. So until the
 * branch is first published a plain `git push` refuses (the names don't
 * match), and the library's pull fetches `origin origin/main`, which isn't a
 * branch on the remote. Both are handled here.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { looksLikeUpstreamMismatch } from './git-errors';

const execFileAsync = promisify(execFile);

function gitIn(cwd: string) {
  return (...args: string[]) => execFileAsync('git', args, { cwd }).then((r) => r.stdout.trim());
}

/**
 * Push to its upstream. The first push publishes the branch under its own
 * name and tracks that from then on, the way the agent's own
 * `git push -u origin HEAD` does. Never forced, so a remote with commits
 * this branch lacks still refuses.
 */
export async function pushExecutionBranch(handle: { path: string; git: { push(): Promise<unknown> } }): Promise<void> {
  try {
    await handle.git.push();
  } catch (err) {
    if (!looksLikeUpstreamMismatch(err)) throw err;
    const git = gitIn(handle.path);
    const branch = await git('branch', '--show-current');
    const remote = (await git('config', `branch.${branch}.remote`).catch(() => '')) || 'origin';
    await git('push', '--set-upstream', remote, 'HEAD');
  }
}

/**
 * Fetch the base from its remote and merge (or rebase) it in: the base the
 * worktree started from (`origin/main`, or a branch it was created from),
 * the agent's base branch when that's another kind of ref, or a pull
 * request's head (`refs/agentex/pr/<N>`), refetched so pulling a session
 * started from a PR picks up what was pushed to it since. Everything runs in
 * the worktree's own repository, so it works on whichever computer has it.
 *
 * A base that can't be fetched fails loudly rather than merging a stale ref.
 * A conflict throws the library's `MergeConflictError` and leaves the
 * worktree mid-merge for the agent to resolve.
 */
export async function pullBaseInto(
  handle: { path: string; git: { base: string; mergeFrom(ref: string, opts?: { strategy?: 'merge' | 'rebase' }): Promise<void> } },
  opts: { strategy: 'merge' | 'rebase'; baseBranch: string | null; base?: string },
): Promise<void> {
  const git = gitIn(handle.path);
  const base = opts.base ?? handle.git.base;
  const remotes = (await git('remote')).split('\n').filter(Boolean);
  const fallbackRemote = remotes.includes('origin') ? 'origin' : remotes[0];
  const pr = /^refs\/agentex\/pr\/(\d+)$/.exec(base);
  if (pr) {
    if (!fallbackRemote) throw new Error("This worktree's repository has no remote to fetch the pull request from.");
    await fetchOrSay(git, fallbackRemote, `+refs/pull/${pr[1]}/head:${base}`, `pull request #${pr[1]}`);
    await handle.git.mergeFrom(base, { strategy: opts.strategy });
    return;
  }
  const recorded = base.startsWith('refs/') ? opts.baseBranch : base;
  if (!recorded) throw new Error('This worktree has no base branch to bring in.');
  const [head, ...rest] = recorded.split('/');
  const known = rest.length > 0 && remotes.includes(head!);
  const remote = known ? head! : fallbackRemote;
  if (!remote) throw new Error("This worktree's repository has no remote to bring the base branch in from.");
  const branch = known ? rest.join('/') : recorded;
  await fetchOrSay(git, remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`, branch);
  await handle.git.mergeFrom(`${remote}/${branch}`, { strategy: opts.strategy });
}

async function fetchOrSay(git: ReturnType<typeof gitIn>, remote: string, refspec: string, what: string): Promise<void> {
  try {
    await git('fetch', remote, refspec);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim() || (err instanceof Error ? err.message : String(err));
    const detail = stderr.split('\n').find((l) => l.trim())?.trim() ?? '';
    throw new Error(`Couldn't fetch ${what} from ${remote}.${detail ? ` ${detail}` : ''}`);
  }
}
