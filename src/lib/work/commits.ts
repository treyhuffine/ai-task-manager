/**
 * Commits for the work view, read from git (docs/work-view.md, "Commits").
 * Git is its own index, so nothing is stored on disk: each agent's repo is
 * asked for the range, cached for a minute so the calendar's refreshes stay
 * cheap.
 *
 * Only your commits on local branches count: execution worktrees share the
 * repo's branches, while remote branches carry teammates' work and rebased
 * copies. Each commit counts for the new lines it wrote (`lines.ts`), so
 * the range also reads back `LOOKBACK_DAYS`: work squashed onto main this
 * week that was written on a branch last week isn't counted twice.
 */

import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { COMMIT_MARK, FIELD_SEP, PatchParser, countNewLines, linesToHours, type CommitLines } from './lines';
import type { CommitInput } from './model';

const run = promisify(execFile);
const TTL_MS = 60_000;
/** How far back a line counts as already written. */
const LOOKBACK_DAYS = 28;
/** Diffs for this many commits at once: one git process, a bounded stdin. */
const DIFF_BATCH = 200;
/** Lines remembered across every repo's commits before the oldest are forgotten. */
const MAX_REMEMBERED_LINES = 8_000_000;
const DIFF_TIMEOUT_MS = 120_000;

export interface Repo {
  cwd: string;
  agentIds: string[];
}

const cache = new Map<string, { at: number; value: Promise<CommitInput[]> }>();
const emails = new Map<string, Promise<string>>();
/**
 * Each commit's lines, by repo and hash. A commit never changes, so it's
 * read from git once per process, and the oldest are forgotten past
 * `MAX_REMEMBERED_LINES` (a Map keeps insertion order).
 */
const commitLines = new Map<string, CommitLines>();
let rememberedLines = 0;

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

/** Parse `--format=%H<US>%cI<US>%s` lines. */
export function parseCommitList(out: string): Array<{ hash: string; at: string; subject: string }> {
  const commits: Array<{ hash: string; at: string; subject: string }> = [];
  for (const line of out.split('\n')) {
    const [hash, at, subject] = line.split(FIELD_SEP);
    if (hash && at) commits.push({ hash, at, subject: subject ?? '' });
  }
  return commits;
}

/**
 * Stream the diffs of `hashes` through the parser. Line by line from git's
 * output, so a long history never sits in memory as text and the server
 * keeps answering between chunks.
 */
async function readCommitLines(cwd: string, hashes: readonly string[]): Promise<CommitLines[]> {
  const child = spawn(
    'git',
    ['-C', cwd, 'log', '--no-walk=unsorted', '--stdin', '-p', '-U0', '-M', '--no-color', '--no-ext-diff', `--format=${COMMIT_MARK}%H${FIELD_SEP}%cI${FIELD_SEP}%s`],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const timer = setTimeout(() => child.kill(), DIFF_TIMEOUT_MS);
  child.stdin.end(`${hashes.join('\n')}\n`);
  const parser = new PatchParser();
  try {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) parser.feed(line);
  } finally {
    clearTimeout(timer);
  }
  return parser.finish();
}

function remember(key: string, lines: CommitLines): void {
  const prior = commitLines.get(key);
  if (prior) rememberedLines -= prior.added.length + prior.deleted.length;
  commitLines.set(key, lines);
  rememberedLines += lines.added.length + lines.deleted.length;
  for (const [oldKey, old] of commitLines) {
    if (rememberedLines <= MAX_REMEMBERED_LINES) break;
    commitLines.delete(oldKey);
    rememberedLines -= old.added.length + old.deleted.length;
  }
}

async function repoCommits(repo: Repo, from: string, to: string): Promise<CommitInput[]> {
  const email = await authorEmail(repo.cwd);
  const since = new Date(Date.parse(from) - LOOKBACK_DAYS * 86_400_000).toISOString();
  const listed = parseCommitList(
    await git(repo.cwd, [
      'log',
      '--branches',
      '--no-merges',
      ...(email ? [`--author=${email}`] : []),
      `--since=${since}`,
      `--until=${to}`,
      `--format=%H${FIELD_SEP}%cI${FIELD_SEP}%s`,
    ]).catch(() => ''),
  );
  const key = (hash: string) => `${repo.cwd}\u0000${hash}`;
  const missing = [...new Set(listed.map((c) => c.hash))].filter((h) => !commitLines.has(key(h)));
  for (let i = 0; i < missing.length; i += DIFF_BATCH) {
    const read = await readCommitLines(repo.cwd, missing.slice(i, i + DIFF_BATCH)).catch(() => []);
    for (const c of read) remember(key(c.hash), c);
  }

  const known = listed.map((c) => commitLines.get(key(c.hash))).filter((c): c is CommitLines => !!c);
  const counts = countNewLines(known, from);
  const seen = new Set<string>();
  const commits: CommitInput[] = [];
  for (const c of listed) {
    const at = new Date(c.at).toISOString();
    if (seen.has(c.hash) || at < from || at >= to) continue;
    seen.add(c.hash);
    const lines = counts.get(c.hash)?.lines ?? 0;
    commits.push({
      hash: c.hash.slice(0, 12),
      at,
      subject: c.subject,
      lines,
      effortHours: linesToHours(lines),
      agentIds: repo.agentIds,
    });
  }
  return commits;
}

/** Commits in [from, to) across repos, one listing per repo plus the diffs it hasn't read yet. */
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
  return results.flat();
}
