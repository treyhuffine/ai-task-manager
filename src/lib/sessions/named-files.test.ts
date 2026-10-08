import { describe, expect, it } from 'vitest';
import { placeViewerPath } from './named-files';

describe('placeViewerPath', () => {
  const folder = '/Users/agent/ai-task-manager';

  it('keeps relative paths in the folder, for the reader to judge', () => {
    expect(placeViewerPath('src/app/page.tsx', folder)).toEqual({ kind: 'folder', path: 'src/app/page.tsx' });
    expect(placeViewerPath('../escape.txt', folder)).toEqual({ kind: 'folder', path: '../escape.txt' });
  });

  it('makes an absolute path under the folder relative to it', () => {
    expect(placeViewerPath(`${folder}/src/app/page.tsx`, folder)).toEqual({ kind: 'folder', path: 'src/app/page.tsx' });
    expect(placeViewerPath(`${folder}/src/app/page.tsx`, `${folder}/`)).toEqual({ kind: 'folder', path: 'src/app/page.tsx' });
  });

  it('puts any other absolute path outside, normalized', () => {
    expect(placeViewerPath('/tmp/ri-work/shots/s2-border.png', folder)).toEqual({ kind: 'outside', file: '/tmp/ri-work/shots/s2-border.png' });
    // A sibling folder that shares the prefix is not inside.
    expect(placeViewerPath(`${folder}-dev/x.ts`, folder)).toEqual({ kind: 'outside', file: `${folder}-dev/x.ts` });
    // Traversal out of the folder is judged where it lands.
    expect(placeViewerPath(`${folder}/../secrets.txt`, folder)).toEqual({ kind: 'outside', file: '/Users/agent/secrets.txt' });
    expect(placeViewerPath('/tmp/a.png', null)).toEqual({ kind: 'outside', file: '/tmp/a.png' });
  });
});
