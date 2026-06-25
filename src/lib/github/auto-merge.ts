/**
 * GitHub auto-merge: enable/disable "merge when ready" on a PR via `gh`,
 * with a GraphQL preflight so we never fire a command GitHub would reject.
 *
 * Auto-merge can fail to enable for several non-obvious reasons (repo
 * setting off, PR already mergeable, viewer lacks permission, no allowed
 * merge methods). The preflight surfaces a precise reason instead of a raw
 * gh error. Enable/disable shell out to `gh pr merge --auto|--disable-auto`.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type MergeMethod = 'squash' | 'merge' | 'rebase';

export interface AutoMergeEligibility {
  /** True when auto-merge can be enabled right now. */
  canEnable: boolean;
  /** Human-readable reason when `canEnable` is false. */
  reason?: string;
  /** Merge methods the repository allows (intersection of repo settings). */
  allowedMethods: MergeMethod[];
  /** Whether auto-merge is already enabled on this PR. */
  enabled: boolean;
}

const PREFLIGHT_QUERY = `query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    autoMergeAllowed
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    pullRequest(number:$number){
      viewerCanEnableAutoMerge
      autoMergeRequest{ enabledAt }
    }
  }
}`;

interface PreflightResp {
  data?: {
    repository?: {
      autoMergeAllowed?: boolean;
      mergeCommitAllowed?: boolean;
      squashMergeAllowed?: boolean;
      rebaseMergeAllowed?: boolean;
      pullRequest?: {
        viewerCanEnableAutoMerge?: boolean;
        autoMergeRequest?: { enabledAt?: string } | null;
      } | null;
    } | null;
  };
}

async function resolveOwnerRepo(cwd: string): Promise<{ owner: string; repo: string }> {
  const { stdout } = await exec(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
    { cwd, encoding: 'utf8' },
  );
  const [owner, repo] = stdout.trim().split('/');
  if (!owner || !repo) throw new Error('Could not resolve repository owner/name');
  return { owner, repo };
}

/**
 * Preflight: can auto-merge be enabled on this PR, and with which methods?
 * Throws on an unexpected gh/GraphQL failure — callers may catch and fall
 * back to attempting the enable directly.
 */
export async function getAutoMergeEligibility(
  cwd: string,
  prNumber: number,
): Promise<AutoMergeEligibility> {
  const { owner, repo } = await resolveOwnerRepo(cwd);
  const { stdout } = await exec(
    'gh',
    [
      'api',
      'graphql',
      '-f',
      `query=${PREFLIGHT_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `repo=${repo}`,
      '-F',
      `number=${prNumber}`,
    ],
    { cwd, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout) as PreflightResp;
  const r = parsed.data?.repository;
  const pr = r?.pullRequest;

  const allowedMethods: MergeMethod[] = [];
  if (r?.squashMergeAllowed) allowedMethods.push('squash');
  if (r?.mergeCommitAllowed) allowedMethods.push('merge');
  if (r?.rebaseMergeAllowed) allowedMethods.push('rebase');

  const enabled = !!pr?.autoMergeRequest;

  let canEnable = true;
  let reason: string | undefined;
  if (enabled) {
    canEnable = false;
    reason = 'Auto-merge is already enabled for this PR.';
  } else if (!r?.autoMergeAllowed) {
    canEnable = false;
    reason = "Auto-merge is disabled in this repository's settings.";
  } else if (!pr?.viewerCanEnableAutoMerge) {
    canEnable = false;
    reason =
      "Auto-merge can't be enabled. The PR may already be mergeable, blocked by branch protection, or you lack permission.";
  } else if (allowedMethods.length === 0) {
    canEnable = false;
    reason = 'No merge methods are allowed on this repository.';
  }

  return { canEnable, reason, allowedMethods, enabled };
}

export async function enableAutoMerge(
  cwd: string,
  prNumber: number,
  method: MergeMethod,
): Promise<void> {
  const flag = method === 'squash' ? '--squash' : method === 'rebase' ? '--rebase' : '--merge';
  await exec('gh', ['pr', 'merge', String(prNumber), '--auto', flag], { cwd, encoding: 'utf8' });
}

export async function disableAutoMerge(cwd: string, prNumber: number): Promise<void> {
  await exec('gh', ['pr', 'merge', String(prNumber), '--disable-auto'], { cwd, encoding: 'utf8' });
}
