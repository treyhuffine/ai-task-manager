import type { StructuredDiff, StructuredDiffFile } from '@/lib/api/sessions';

export type ChangeLetter = 'M' | 'A' | 'D' | 'R';

export interface ChangedFileSummary {
  file: StructuredDiffFile;
  letter: ChangeLetter;
  /** Directory part with a trailing slash, or '' at the root. */
  dir: string;
  name: string;
  additions: number;
  deletions: number;
  /** Binary files (and empty ones) come back without hunks. */
  binary: boolean;
}

export interface ChangesSummary {
  files: ChangedFileSummary[];
  additions: number;
  deletions: number;
}

const LETTER: Record<StructuredDiffFile['status'], ChangeLetter> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
};

/**
 * Per-file and total line counts for the Changes view, computed from the
 * structured diff (the server doesn't send numstat per file). Counting add
 * and del lines matches `git diff --numstat` for text files, and untracked
 * files arrive as all-add hunks. Sorted by path so the list is stable while
 * the agent keeps editing.
 */
export function summarizeChanges(diff: StructuredDiff | undefined | null): ChangesSummary {
  const files = (diff?.files ?? [])
    .map((file): ChangedFileSummary => {
      let additions = 0;
      let deletions = 0;
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.kind === 'add') additions++;
          else if (line.kind === 'del') deletions++;
        }
      }
      const slash = file.path.lastIndexOf('/');
      return {
        file,
        letter: LETTER[file.status],
        dir: slash >= 0 ? file.path.slice(0, slash + 1) : '',
        name: slash >= 0 ? file.path.slice(slash + 1) : file.path,
        additions,
        deletions,
        binary: file.hunks.length === 0 && file.status !== 'deleted' && file.status !== 'renamed',
      };
    })
    .sort((a, b) => (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0));
  return {
    files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };
}

/** "1 file" / "8 files". */
export function filesLabel(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}
