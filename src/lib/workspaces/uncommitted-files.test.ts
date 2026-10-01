import { describe, expect, it } from 'vitest';
import { describeUncommittedFiles, listUncommittedFiles, MAX_LISTED_FILES, uncommittedFilesOf } from './uncommitted-files';

describe('listUncommittedFiles', () => {
  it('lists each path once, sorted, a file both staged and edited as one change', () => {
    expect(
      listUncommittedFiles({
        untracked: ['scratch/', 'notes.md'],
        modified: ['src/login.ts', 'README.md'],
        staged: ['src/login.ts', 'src/new.ts'],
      }),
    ).toEqual([
      { path: 'notes.md', change: 'untracked' },
      { path: 'README.md', change: 'changed' },
      { path: 'scratch/', change: 'untracked' },
      { path: 'src/login.ts', change: 'changed' },
      { path: 'src/new.ts', change: 'changed' },
    ]);
  });

  it('is empty for a clean worktree', () => {
    expect(listUncommittedFiles({ untracked: [], modified: [], staged: [] })).toEqual([]);
  });
});

describe('uncommittedFilesOf', () => {
  it("reads agentex's status off its DirtyWorktreeError", () => {
    const err = Object.assign(new Error('dirty'), {
      status: { dirty: true, untracked: ['a.txt'], modified: [], staged: [], ahead: 2, behind: 0 },
    });
    expect(uncommittedFilesOf(err)).toEqual({ files: [{ path: 'a.txt', change: 'untracked' }], omitted: 0 });
  });

  it('lists up to the cap and counts the rest', () => {
    const untracked = Array.from({ length: MAX_LISTED_FILES + 7 }, (_, i) => `build/${String(i).padStart(4, '0')}.js`);
    const list = uncommittedFilesOf({ status: { untracked, modified: [], staged: [] } });
    expect(list?.files).toHaveLength(MAX_LISTED_FILES);
    expect(list?.files[0]).toEqual({ path: 'build/0000.js', change: 'untracked' });
    expect(list?.omitted).toBe(7);
  });

  it('is null for anything without a status', () => {
    expect(uncommittedFilesOf(new Error('other'))).toBeNull();
    expect(uncommittedFilesOf(null)).toBeNull();
    expect(uncommittedFilesOf({ status: { untracked: 'nope' } })).toBeNull();
  });
});

describe('describeUncommittedFiles', () => {
  it('names each file with its change, and counts the rest past the cap', () => {
    const files = [
      { path: 'a.ts', change: 'changed' as const },
      { path: 'b.md', change: 'untracked' as const },
      { path: 'c.ts', change: 'changed' as const },
    ];
    expect(describeUncommittedFiles(files)).toBe('a.ts (changed), b.md (untracked), c.ts (changed)');
    expect(describeUncommittedFiles(files, 0, 2)).toBe('a.ts (changed), b.md (untracked) and 1 more');
    // Files the server already left out of the list count too.
    expect(describeUncommittedFiles(files, 40)).toBe('a.ts (changed), b.md (untracked), c.ts (changed) and 40 more');
  });
});
