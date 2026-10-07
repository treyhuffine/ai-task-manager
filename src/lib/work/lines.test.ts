import { describe, expect, it } from 'vitest';
import { COMMIT_MARK, FIELD_SEP, HUMAN_LINES_PER_HOUR, PatchParser, countNewLines, countsAsWork, linesToHours } from './lines';

/** A commit as `git log -p -U0` prints it, one new or changed file at a time. */
function commit(hash: string, at: string, files: Array<{ path: string; add?: string[]; del?: string[]; from?: string }>): string[] {
  const out = [`${COMMIT_MARK}${hash}${FIELD_SEP}${at}${FIELD_SEP}${hash} subject`, ''];
  for (const f of files) {
    const oldPath = f.from ?? f.path;
    out.push(`diff --git a/${oldPath} b/${f.path}`);
    out.push(f.del?.length || f.from ? `--- a/${oldPath}` : '--- /dev/null');
    out.push(`+++ b/${f.path}`);
    out.push(`@@ -1,${f.del?.length ?? 0} +1,${f.add?.length ?? 0} @@`);
    for (const l of f.del ?? []) out.push(`-${l}`);
    for (const l of f.add ?? []) out.push(`+${l}`);
  }
  return out;
}

function parse(...commits: string[][]) {
  const p = new PatchParser();
  for (const line of commits.flat()) p.feed(line);
  return p.finish();
}

const code = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `const ${prefix}${i} = ${i};`);
const counted = (lines: ReturnType<typeof countNewLines>) => [...lines.values()].map((n) => n.lines);
const total = (lines: ReturnType<typeof countNewLines>) => counted(lines).reduce((a, b) => a + b, 0);

describe('new lines', () => {
  it('counts the same lines the same, in one commit or fifty', () => {
    const once = parse(commit('a', '2026-10-01T10:00:00Z', [{ path: 'src/x.ts', add: code(1000) }]));
    const split = parse(
      ...Array.from({ length: 50 }, (_, i) =>
        commit(`c${i}`, `2026-10-01T${String(10 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}:00Z`, [
          { path: 'src/x.ts', add: code(1000).slice(i * 20, i * 20 + 20) },
        ]),
      ),
    );
    expect(total(countNewLines(once, '2026-10-01T00:00:00Z'))).toBe(1000);
    expect(total(countNewLines(split, '2026-10-01T00:00:00Z'))).toBe(1000);
    expect(linesToHours(1000)).toBe(1000 / HUMAN_LINES_PER_HOUR);
  });

  it("doesn't count a squash of work already written on a branch", () => {
    const commits = parse(
      commit('branch1', '2026-10-01T10:00:00Z', [{ path: 'src/feature.ts', add: code(300) }]),
      commit('branch2', '2026-10-02T10:00:00Z', [{ path: 'src/feature.ts', add: code(200, 'more') }]),
      // The squash onto main repeats both, plus one fix made while landing it.
      commit('squash', '2026-10-03T10:00:00Z', [{ path: 'src/feature.ts', add: [...code(300), ...code(200, 'more'), 'export const landed = true;'] }]),
    );
    const n = countNewLines(commits, '2026-09-01T00:00:00Z');
    expect([n.get('branch1')?.lines, n.get('branch2')?.lines, n.get('squash')?.lines]).toEqual([300, 200, 1]);
  });

  it('remembers what was written before the range, and reports only the range', () => {
    const commits = parse(
      commit('lastweek', '2026-09-25T10:00:00Z', [{ path: 'src/feature.ts', add: code(300) }]),
      commit('squash', '2026-10-03T10:00:00Z', [{ path: 'src/feature.ts', add: code(300) }]),
    );
    const n = countNewLines(commits, '2026-09-28T00:00:00Z');
    expect([...n.keys()]).toEqual(['squash']);
    expect(n.get('squash')?.lines).toBe(0);
  });

  it("counts a moved or reindented line neither way, and a removed one at a quarter", () => {
    const [c] = parse(
      commit('refactor', '2026-10-01T10:00:00Z', [
        { path: 'src/old.ts', del: [...code(40), ...code(8, 'gone')] },
        { path: 'src/new.ts', add: [...code(40).map((l) => `    ${l}`), 'export const fresh = 1;'] },
      ]),
    );
    expect(c!.moved).toBe(40);
    expect(countNewLines([c!], '2026-10-01T00:00:00Z').get('refactor')).toEqual({ added: 1, deleted: 8, lines: 3 });
  });

  it('leaves out generated, lock, vendored and data files, and lines that are only brackets', () => {
    const [c] = parse(
      commit('mixed', '2026-10-01T10:00:00Z', [
        { path: 'src/blocks.ts', add: ['export const a = 1;', '}', '', '  );'] },
        { path: 'src/lib/lock/index.ts', add: ['export const b = 2;'] },
        { path: 'pnpm-lock.yaml', add: code(500) },
        { path: 'src/api/schema.generated.ts', add: code(50) },
        { path: 'vendor/lib.js', add: code(50) },
        { path: 'data/prices.json', add: code(301) },
        { path: 'config/small.json', add: ['"a": 1,'] },
      ]),
    );
    expect(countNewLines([c!], '2026-10-01T00:00:00Z').get('mixed')?.lines).toBe(3);
    expect(['src/blocks.ts', 'packages/x/src/lock/file.ts', 'Cargo.lock', 'package-lock.json', 'dist/app.js'].map(countsAsWork)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it('reads deleted files, renames, binary files and lines that look like headers', () => {
    const lines = [
      `${COMMIT_MARK}h1${FIELD_SEP}2026-10-01T10:00:00Z${FIELD_SEP}assorted`,
      'diff --git a/src/gone.ts b/src/gone.ts',
      'deleted file mode 100644',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-export const gone1 = 1;',
      '-export const gone2 = 2;',
      'diff --git a/src/a.ts b/src/b.ts',
      'similarity index 90%',
      'rename from src/a.ts',
      'rename to src/b.ts',
      '--- a/src/a.ts',
      '+++ b/src/b.ts',
      '@@ -3 +3 @@',
      '-export const v = 1;',
      '+export const v = 2;',
      '+++ counts as content inside a hunk',
      '\\ No newline at end of file',
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
    ];
    const [c] = parse(lines);
    expect([c!.added.length, c!.deleted.length]).toEqual([2, 3]);
  });
});
