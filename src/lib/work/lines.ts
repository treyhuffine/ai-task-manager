/**
 * How much code a commit really wrote (docs/work-view.md, "Human time"):
 * its new lines, each counted once. Pure, no git: `commits.ts` streams
 * `git log -p -U0` through `PatchParser`, and `countNewLines` does the rest.
 *
 * A line counts when it's written for the first time. Not when it's only
 * moved (a refactor deletes it in one place and adds it in another, in the
 * same commit), not when it's added again (a branch squashed onto main, a
 * rebase, a cherry-pick: the same line in the same file, seen earlier), and
 * not in generated, lock, vendored or data files. Blank lines and lines of
 * only brackets don't count either. Deleting a line counts a quarter.
 *
 * Then a person writes `HUMAN_LINES_PER_HOUR`, whatever the commits' sizes:
 * the same thousand lines in one commit or in fifty is the same work.
 */

/**
 * The pace of a fast, skilled engineer: finished code, docs and comments
 * alike. A judgment, not a measurement, kept round on purpose. Could become
 * a setting if anyone ever needs it to, nobody has yet.
 */
export const HUMAN_LINES_PER_HOUR = 100;

/** A deleted line is worth this much of a written one: removing is quicker. */
export const DELETED_LINE_WEIGHT = 0.25;

/** Hours a person would need for this many lines. */
export function linesToHours(lines: number): number {
  return lines / HUMAN_LINES_PER_HOUR;
}

/**
 * Files whose lines say nothing about effort: dependencies, build output,
 * vendored code, lock files, minified, snapshots, source maps, media and
 * data, migration snapshots, and anything marked generated.
 */
const NOT_EFFORT =
  /(^|\/)(node_modules|dist|build|out|\.next|vendor|coverage|__generated__|generated)\/|(^|\/)[^/]*-lock\.(json|ya?ml)$|\.lock$|(^|\/)yarn\.lock$|\.min\.|\.generated\.|\.snap$|\.map$|\.(csv|tsv|svg|png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|mp[34]|wav)$|drizzle\/meta\//i;

/** A JSON file changed this much in one commit is data, not work. */
const JSON_DATA_LINES = 300;

/** Blank, or only brackets and separators: formatting, not writing. */
const TRIVIAL = /^[\s{}()[\];,]*$/;

export function countsAsWork(path: string): boolean {
  return !NOT_EFFORT.test(path);
}

/** A commit's lines, hashed: the lines it added (moves left out) and deleted, each by file and text. */
export interface CommitLines {
  hash: string;
  at: string;
  subject: string;
  added: Uint32Array;
  deleted: Uint32Array;
  /** Added lines that were moves within the commit, for the record. */
  moved: number;
}

/** FNV-1a, 32 bits: a line's identity. A collision costs one line in a million. */
export function hashLine(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The header `commits.ts` asks git for: `@@@<hash><US><committed><US><subject>`. */
export const COMMIT_MARK = '@@@';
export const FIELD_SEP = '\u001f';

/**
 * Reads `git log -p -U0 --format=@@@%H%x1f%cI%x1f%s` a line at a time, so a
 * long history streams through without holding its text.
 */
export class PatchParser {
  private readonly done: CommitLines[] = [];
  private commit: { hash: string; at: string; subject: string } | null = null;
  /** Kept per commit until it ends: text hashes for moves, keys for counting. */
  private added: Array<{ key: number; text: number }> = [];
  private deleted: Array<{ key: number; text: number }> = [];
  /** The file being read: its paths, and its lines until it ends. */
  private oldPath: string | null = null;
  private newPath: string | null = null;
  private inHunk = false;
  private fileAdded: string[] = [];
  private fileDeleted: string[] = [];

  feed(line: string): void {
    if (line.startsWith(COMMIT_MARK)) {
      this.endCommit();
      const [hash, at, subject] = line.slice(COMMIT_MARK.length).split(FIELD_SEP);
      this.commit = hash && at ? { hash, at, subject: subject ?? '' } : null;
      return;
    }
    if (!this.commit) return;
    if (line.startsWith('diff --git ')) {
      this.endFile();
      this.inHunk = false;
      return;
    }
    if (!this.inHunk) {
      if (line.startsWith('--- ')) this.oldPath = gitPath(line.slice(4));
      else if (line.startsWith('+++ ')) this.newPath = gitPath(line.slice(4));
      else if (line.startsWith('@@')) this.inHunk = true;
      return;
    }
    if (line.startsWith('@@')) return;
    if (line.startsWith('+')) this.fileAdded.push(line.slice(1));
    else if (line.startsWith('-')) this.fileDeleted.push(line.slice(1));
  }

  /** Every commit read, in the order git gave them. */
  finish(): CommitLines[] {
    this.endCommit();
    return this.done;
  }

  private endFile(): void {
    const addPath = this.newPath ?? this.oldPath;
    const delPath = this.oldPath ?? this.newPath;
    const json = (p: string | null) => !!p && p.endsWith('.json');
    const data = (json(addPath) || json(delPath)) && this.fileAdded.length + this.fileDeleted.length > JSON_DATA_LINES;
    if (!data) {
      if (addPath && countsAsWork(addPath)) collect(this.added, addPath, this.fileAdded);
      if (delPath && countsAsWork(delPath)) collect(this.deleted, delPath, this.fileDeleted);
    }
    this.fileAdded = [];
    this.fileDeleted = [];
    this.oldPath = null;
    this.newPath = null;
  }

  private endCommit(): void {
    this.endFile();
    this.inHunk = false;
    if (!this.commit) return;
    // A line deleted and added in the same commit was moved (or reindented),
    // not written and not removed: it counts neither way.
    const count = (lines: ReadonlyArray<{ text: number }>) => {
      const n = new Map<number, number>();
      for (const l of lines) n.set(l.text, (n.get(l.text) ?? 0) + 1);
      return n;
    };
    const addedTexts = count(this.added);
    const deletedTexts = count(this.deleted);
    const moves = new Map<number, number>();
    let moved = 0;
    for (const [text, a] of addedTexts) {
      const m = Math.min(a, deletedTexts.get(text) ?? 0);
      if (m > 0) {
        moves.set(text, m);
        moved += m;
      }
    }
    const keep = (lines: ReadonlyArray<{ key: number; text: number }>) => {
      const left = new Map(moves);
      const kept: number[] = [];
      for (const l of lines) {
        const m = left.get(l.text) ?? 0;
        if (m > 0) left.set(l.text, m - 1);
        else kept.push(l.key);
      }
      return Uint32Array.from(kept);
    };
    this.done.push({ ...this.commit, added: keep(this.added), deleted: keep(this.deleted), moved });
    this.commit = null;
    this.added = [];
    this.deleted = [];
  }
}

function collect(into: Array<{ key: number; text: number }>, path: string, lines: readonly string[]): void {
  for (const raw of lines) {
    const text = normalize(raw);
    if (TRIVIAL.test(text)) continue;
    into.push({ key: hashLine(`${path}\u0000${text}`), text: hashLine(text) });
  }
}

/** `a/src/x.ts` → `src/x.ts`, `/dev/null` → null. Quoted paths keep their quotes off. */
function gitPath(raw: string): string | null {
  const p = raw.trim().replace(/^"(.*)"$/, '$1');
  if (p === '/dev/null') return null;
  return p.replace(/^[ab]\//, '');
}

export interface NewLines {
  /** Lines written for the first time. */
  added: number;
  /** Lines removed for the first time. */
  deleted: number;
  /** Written lines, plus a quarter of the deleted, rounded: what the commit counts for. */
  lines: number;
}

/**
 * Each commit's new lines, oldest first: a line counts for the first commit
 * that adds it and never again. `commits` can reach back before `countFrom`
 * (a branch built last week and squashed this week counts last week), and
 * only commits from `countFrom` on are returned.
 */
export function countNewLines(commits: readonly CommitLines[], countFrom: string): Map<string, NewLines> {
  const from = Date.parse(countFrom);
  const sorted = [...commits].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const seenAdded = new Set<number>();
  const seenDeleted = new Set<number>();
  const out = new Map<string, NewLines>();
  for (const c of sorted) {
    let added = 0;
    for (const k of c.added) {
      if (seenAdded.has(k)) continue;
      seenAdded.add(k);
      added++;
    }
    let deleted = 0;
    for (const k of c.deleted) {
      if (seenDeleted.has(k)) continue;
      seenDeleted.add(k);
      deleted++;
    }
    if (Date.parse(c.at) >= from) out.set(c.hash, { added, deleted, lines: Math.round(added + deleted * DELETED_LINE_WEIGHT) });
  }
  return out;
}
