import { describe, expect, it } from 'vitest';
import { isOutsideFolderPath, toWorktreeRelative } from './open-file-event';

describe('toWorktreeRelative', () => {
  const root = '/Users/agent/ai-task-manager';

  it('strips the worktree from a path inside it', () => {
    expect(toWorktreeRelative(`${root}/src/app/page.tsx`, root)).toBe('src/app/page.tsx');
    expect(toWorktreeRelative(`${root}/src/app/page.tsx`, `${root}/`)).toBe('src/app/page.tsx');
    expect(toWorktreeRelative(root, root)).toBe('');
  });

  it('leaves relative paths, and paths outside the worktree, as they are', () => {
    expect(toWorktreeRelative('src/app/page.tsx', root)).toBe('src/app/page.tsx');
    expect(toWorktreeRelative('/tmp/ri-work/shots/s2-border.png', root)).toBe('/tmp/ri-work/shots/s2-border.png');
    expect(toWorktreeRelative(`${root}-dev/x.ts`, root)).toBe(`${root}-dev/x.ts`);
  });

  it('keeps an absolute path whole while the worktree is not known', () => {
    expect(toWorktreeRelative('/tmp/ri-work/shots/s2-border.png', null)).toBe('/tmp/ri-work/shots/s2-border.png');
  });
});

describe('isOutsideFolderPath', () => {
  it('is true for the absolute paths toWorktreeRelative leaves', () => {
    expect(isOutsideFolderPath('/tmp/a.png')).toBe(true);
    expect(isOutsideFolderPath('C:\\Users\\a.png')).toBe(true);
    expect(isOutsideFolderPath('C:/Users/a.png')).toBe(true);
    expect(isOutsideFolderPath('src/a.png')).toBe(false);
    expect(isOutsideFolderPath('a.png')).toBe(false);
  });
});
