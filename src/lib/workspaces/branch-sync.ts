/**
 * Push an execution's branch and bring its base branch in, the same way
 * here or on the device it runs on (P4.5).
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
import { sanitizeChildEnv } from '@/lib/utils/sanitize-child-env';

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
 * the worktree's own repository, so it works on whichever device has it.
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

/**
 * Where a branch stands, for the git chip. `git status` counts ahead/behind
 * against the branch's upstream, and the first push re-points that upstream
 * from the base (`origin/main`) to the branch's own remote copy
 * (`origin/feat`). So the same two numbers mean "against the base" before the
 * first push and "against my remote copy" after it. This says which, and
 * counts against the base separately.
 */
export interface BranchSync {
  /** The branch's upstream, e.g. `origin/feat`. Null when it tracks nothing. */
  upstream: string | null;
  /**
   * The upstream is the base itself: a branch not pushed yet, or work on the
   * base. Status ahead/behind are then counted against the base. Otherwise
   * they're counted against the branch's own remote copy.
   */
  upstreamIsBase: boolean;
  /** The base as a remote-tracking ref, e.g. `origin/main`. Null when unresolvable. */
  base: string | null;
  /** Commits the base has that this branch lacks, as of the last fetch. Null when the base can't be read. */
  behindBase: number | null;
}

/**
 * Read a worktree's `BranchSync`, measured against the agent's configured
 * base branch on its remote (`origin/main`), never against agentex's recorded
 * base, which every worktree of a repository shares (see `resolveAnchor` in
 * diff-stats.ts). Also refreshes the base and the upstream from the remote in
 * the background, at most every `REFRESH_EVERY_MS`, so the next read is
 * current: counts only move when something fetches, and a status read never
 * waits on the network.
 */
export async function readBranchSync(
  worktreePath: string,
  opts: { baseBranch: string | null; remoteName: string | null },
): Promise<BranchSync> {
  const git = gitIn(worktreePath);
  const [upstream, remotesOut] = await Promise.all([
    git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').catch(() => null),
    git('remote').catch(() => ''),
  ]);
  const remotes = remotesOut.split('\n').filter(Boolean);
  const base = await resolveBaseTrackingRef(git, remotes, opts);
  let behindBase: number | null = null;
  if (base) {
    const counted = await git('rev-list', '--count', `HEAD..refs/remotes/${base}`).catch(() => null);
    behindBase = counted == null ? null : parseInt(counted, 10) || 0;
  }
  refreshInBackground(worktreePath, remotes, [base, upstream || null]);
  return { upstream: upstream || null, upstreamIsBase: !!upstream && upstream === base, base, behindBase };
}

/** The base branch as `<remote>/<branch>`: as configured, else the remote's default branch. */
async function resolveBaseTrackingRef(
  git: ReturnType<typeof gitIn>,
  remotes: string[],
  opts: { baseBranch: string | null; remoteName: string | null },
): Promise<string | null> {
  const remote = opts.remoteName ?? (remotes.includes('origin') ? 'origin' : remotes[0]);
  if (opts.baseBranch) {
    const [head, ...rest] = opts.baseBranch.split('/');
    if (rest.length > 0 && remotes.includes(head!)) return opts.baseBranch;
    return remote ? `${remote}/${opts.baseBranch}` : null;
  }
  if (!remote) return null;
  const defaultBranch = await git('symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`).catch(() => '');
  return defaultBranch || `${remote}/main`;
}

/** How often a worktree's base and upstream are refreshed from the remote. */
export const REFRESH_EVERY_MS = 90_000;
const lastRefresh = new Map<string, number>();

/**
 * Fetch the given remote-tracking refs, fire and forget. Never prompts for
 * credentials and gives up after 30s. A failure (offline, a deleted branch)
 * just leaves the counts as they were.
 */
function refreshInBackground(worktreePath: string, remotes: string[], refs: (string | null)[]): void {
  const now = Date.now();
  if (now - (lastRefresh.get(worktreePath) ?? 0) < REFRESH_EVERY_MS) return;
  lastRefresh.set(worktreePath, now);
  const specsByRemote = new Map<string, string[]>();
  for (const ref of new Set(refs)) {
    const split = splitTrackingRef(ref, remotes);
    if (!split) continue;
    const specs = specsByRemote.get(split.remote) ?? [];
    specs.push(`+refs/heads/${split.branch}:refs/remotes/${split.remote}/${split.branch}`);
    specsByRemote.set(split.remote, specs);
  }
  for (const [remote, specs] of specsByRemote) {
    execFileAsync('git', ['fetch', '--quiet', '--no-tags', remote, ...specs], {
      cwd: worktreePath,
      timeout: 30_000,
      env: sanitizeChildEnv({ GIT_TERMINAL_PROMPT: '0' }),
    }).catch(() => {});
  }
}

/** `origin/feat/x` into its remote and branch, by the remotes this repository has. */
function splitTrackingRef(ref: string | null, remotes: string[]): { remote: string; branch: string } | null {
  if (!ref) return null;
  const remote = remotes
    .filter((r) => ref.startsWith(`${r}/`))
    .sort((a, b) => b.length - a.length)[0];
  return remote ? { remote, branch: ref.slice(remote.length + 1) } : null;
}

/**
 * Bring in commits pushed to this branch's own remote copy from elsewhere:
 * GitHub's "Update branch", a suggestion committed in review, or another
 * clone. Fetches the upstream fresh, then merges (a fast-forward when this
 * side has nothing new). A conflict throws the library's `MergeConflictError`
 * like `pullBaseInto` does.
 */
export async function pullUpstreamInto(
  handle: { path: string; git: { mergeFrom(ref: string, opts?: { strategy?: 'merge' | 'rebase' }): Promise<void> } },
  opts: { strategy: 'merge' | 'rebase' },
): Promise<void> {
  const git = gitIn(handle.path);
  const upstream = await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').catch(() => '');
  if (!upstream) throw new Error('This branch tracks no remote branch to pull from.');
  const remotes = (await git('remote')).split('\n').filter(Boolean);
  const split = splitTrackingRef(upstream, remotes);
  if (!split) throw new Error(`This branch tracks ${upstream}, which isn't on a remote.`);
  await fetchOrSay(git, split.remote, `+refs/heads/${split.branch}:refs/remotes/${split.remote}/${split.branch}`, split.branch);
  await handle.git.mergeFrom(upstream, { strategy: opts.strategy });
}

/** Test seam: forget when each worktree was last refreshed. */
export function resetRefreshThrottle(): void {
  lastRefresh.clear();
}
