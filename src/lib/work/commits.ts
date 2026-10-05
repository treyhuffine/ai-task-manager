/**
 * Commits for the work view, read from git (docs/work-view.md, "Commits").
 * Git is its own index, so nothing is stored: each agent's repo is asked for
 * the range, cached for a minute so the calendar's refreshes stay cheap.
 *
 * Only your commits on local branches count: execution worktrees share the
 * repo's branches, while remote branches carry teammates' work and rebased
 * copies. Each commit is sized by `commitEffortHours`.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { commitEffortHours, effortLines, type CommitInput, type FileChange } from './model';

const run = promisify(execFile);
const TTL_MS = 60_000;
const SEP = '\u001f';

export interface Repo {
  cwd: string;
  agentIds: string[];
}

const cache = new Map<string, { at: number; value: Promise<CommitInput[]> }>();
const emails = new Map<string, Promise<string>>();

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024, timeout: 20_000 });
  return stdout;
}

function authorEmail(cwd: string): Promise<string> {
  let email = emails.get(cwd);
  if (!email) {
    email = git(cwd, ['config', 'user.email']).then((s) => s.trim()).catch(() => '');
    emails.set(cwd, email);
  }
  return email;
}

/** Parse `git log --numstat` with `@hash<US>committed<US>subject` headers. */
export function parseLog(out: string): Array<{ hash: string; at: string; subject: string; files: FileChange[] }> {
  const commits: Array<{ hash: string; at: string; subject: string; files: FileChange[] }> = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('@')) {
      const [hash, at, subject] = line.slice(1).split(SEP);
      if (hash && at) commits.push({ hash, at, subject: subject ?? '', files: [] });
      continue;
    }
    const parts = line.split('\t');
    const current = commits[commits.length - 1];
    // Binary files show "-": they're not lines of effort.
    if (current && parts.length === 3 && /^\d+$/.test(parts[0]!) && /^\d+$/.test(parts[1]!)) {
      current.files.push({ added: Number(parts[0]), deleted: Number(parts[1]), path: parts[2]! });
    }
  }
  return commits;
}

async function repoCommits(repo: Repo, from: string, to: string): Promise<CommitInput[]> {
  const email = await authorEmail(repo.cwd);
  const out = await git(repo.cwd, [
    'log',
    '--branches',
    '--no-merges',
    ...(email ? [`--author=${email}`] : []),
    `--since=${from}`,
    `--until=${to}`,
    '--numstat',
    `--format=@%H${SEP}%cI${SEP}%s`,
  ]).catch(() => '');
  const seen = new Set<string>();
  const commits: CommitInput[] = [];
  for (const c of parseLog(out)) {
    if (seen.has(c.hash)) continue;
    seen.add(c.hash);
    const lines = effortLines(c.files);
    commits.push({
      hash: c.hash.slice(0, 12),
      at: new Date(c.at).toISOString(),
      subject: c.subject,
      lines,
      effortHours: commitEffortHours(lines),
      agentIds: repo.agentIds,
    });
  }
  return commits;
}

/** Commits in [from, to) across repos, one git call per repo. */
export async function commitsForRange(repos: readonly Repo[], from: string, to: string): Promise<CommitInput[]> {
  const now = Date.now();
  const results = await Promise.all(
    repos.map((repo) => {
      const key = `${repo.cwd}|${repo.agentIds.join(',')}|${from}|${to}`;
      const hit = cache.get(key);
      if (hit && now - hit.at < TTL_MS) return hit.value;
      const value = repoCommits(repo, from, to);
      cache.set(key, { at: now, value });
      return value;
    }),
  );
  return results.flat().filter((c) => c.at >= from && c.at < to);
}
