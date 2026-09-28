import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sanitizeChildEnv } from '@/lib/utils/sanitize-child-env';

const execFileAsync = promisify(execFile);

/**
 * A pull request's GitHub address, worked out from the repo's own `origin`
 * remote instead of asking GitHub. The execution only stores the PR number,
 * and the live `gh` lookup can fail (gh missing or signed out, offline, rate
 * limited), so this is what keeps a linked PR one click away regardless.
 */

/**
 * "owner/repo" for a github.com remote URL, or null for anything else. Covers
 * the forms git accepts: `git@github.com:o/r.git`, `ssh://git@github.com/o/r`,
 * `https://github.com/o/r.git`, with or without `.git` or a trailing slash.
 */
export function githubRepoFromRemoteUrl(remote: string): string | null {
  const m = remote
    .trim()
    .match(/^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|[^@\s]+@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

export function githubPullUrl(repo: string, prNumber: number): string {
  return `https://github.com/${repo}/pull/${prNumber}`;
}

/** The GitHub address of PR `prNumber` in the repo at `cwd`, or null when `origin` isn't on GitHub. */
export async function linkedPullUrl(cwd: string, prNumber: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      env: sanitizeChildEnv(),
      timeout: 5_000,
    });
    const repo = githubRepoFromRemoteUrl(stdout);
    return repo ? githubPullUrl(repo, prNumber) : null;
  } catch {
    return null;
  }
}
