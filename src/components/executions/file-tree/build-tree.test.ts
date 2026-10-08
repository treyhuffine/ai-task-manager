import { describe, it, expect } from 'vitest';
import type { TreeEntry } from '@/lib/api/sessions';
import { buildTree, expandableDirPaths, flattenTree } from './build-tree';

const file = (path: string, status?: TreeEntry['status']): TreeEntry =>
  ({ path, name: path.split('/').pop()!, kind: 'file', status }) as TreeEntry;
const dir = (path: string, collapsed?: boolean): TreeEntry =>
  ({ path, name: path.split('/').pop()!, kind: 'dir', collapsed }) as TreeEntry;

describe('expandableDirPaths', () => {
  it('lists every ancestor folder of every entry', () => {
    const out = expandableDirPaths([file('src/components/ui/button.tsx'), file('docs/a.md'), file('README.md')]);
    expect(out).toEqual(new Set(['src', 'src/components', 'src/components/ui', 'docs']));
  });

  it('leaves out a collapsed folder (node_modules), which never opens', () => {
    expect(expandableDirPaths([dir('node_modules', true), file('a.ts')])).toEqual(new Set());
  });

  it('keeps a listed folder that is not collapsed', () => {
    expect(expandableDirPaths([dir('empty')])).toEqual(new Set(['empty']));
  });

  it('matches the folders the built tree renders', () => {
    const entries = [file('a/b/c.ts'), file('a/d.ts'), file('e/f.ts'), dir('node_modules', true)];
    const dirs = expandableDirPaths(entries);
    // Every dir in the tree open: the flattened rows are every entry plus every folder.
    const rows = flattenTree(buildTree(entries), dirs);
    const renderedDirs = rows.filter((r) => r.kind === 'dir' && !r.collapsed).map((r) => r.path);
    expect(new Set(renderedDirs)).toEqual(dirs);
  });
});
