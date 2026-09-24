import { describe, it, expect } from 'vitest';
import type { StructuredDiffFile } from '@/lib/api/sessions';
import { summarizeChanges, filesLabel } from './changes-summary';

const hunk = (lines: ('add' | 'del' | 'ctx')[]) => ({
  oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
  lines: lines.map((kind, i) => ({ kind, text: `l${i}` })),
});

const file = (path: string, status: StructuredDiffFile['status'], hunks = [hunk(['add'])]): StructuredDiffFile => ({ path, status, hunks });

describe('summarizeChanges', () => {
  it('counts additions and deletions per file and in total', () => {
    const s = summarizeChanges({
      files: [
        file('src/a.ts', 'modified', [hunk(['ctx', 'del', 'add', 'add']), hunk(['del'])]),
        file('README.md', 'added', [hunk(['add', 'add', 'add'])]),
      ],
    });
    const a = s.files.find((f) => f.file.path === 'src/a.ts')!;
    expect(a).toMatchObject({ additions: 2, deletions: 2, letter: 'M', dir: 'src/', name: 'a.ts' });
    expect(s).toMatchObject({ additions: 5, deletions: 2 });
  });

  it('sorts by path so the list holds still while the agent edits', () => {
    const s = summarizeChanges({ files: [file('z.ts', 'modified'), file('a/b.ts', 'added'), file('a/a.ts', 'deleted')] });
    expect(s.files.map((f) => f.file.path)).toEqual(['a/a.ts', 'a/b.ts', 'z.ts']);
  });

  it('marks files without hunks as binary, except deletes and renames', () => {
    const s = summarizeChanges({
      files: [file('logo.png', 'added', []), file('old.ts', 'deleted', []), file('moved.ts', 'renamed', [])],
    });
    expect(s.files.map((f) => [f.file.path, f.binary])).toEqual([
      ['logo.png', true],
      ['moved.ts', false],
      ['old.ts', false],
    ]);
  });

  it('maps statuses to letters', () => {
    const s = summarizeChanges({ files: [file('a', 'added'), file('d', 'deleted'), file('m', 'modified'), file('r', 'renamed')] });
    expect(s.files.map((f) => f.letter)).toEqual(['A', 'D', 'M', 'R']);
  });

  it('handles no diff yet', () => {
    expect(summarizeChanges(undefined)).toEqual({ files: [], additions: 0, deletions: 0 });
  });
});

describe('filesLabel', () => {
  it('pluralizes', () => {
    expect(filesLabel(1)).toBe('1 file');
    expect(filesLabel(8)).toBe('8 files');
    expect(filesLabel(0)).toBe('0 files');
  });
});
