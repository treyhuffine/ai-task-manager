import { describe, it, expect } from 'vitest';
import { computeEditDiff, lineDiff, isEditTool } from './edit-diff';

describe('lineDiff', () => {
  it('reports adds, dels, and context', () => {
    const d = lineDiff('a\nb\nc', 'a\nB\nc\nd');
    expect(d.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual(['B', 'd']);
    expect(d.filter((l) => l.kind === 'del').map((l) => l.text)).toEqual(['b']);
    expect(d.filter((l) => l.kind === 'ctx').map((l) => l.text)).toEqual(['a', 'c']);
  });
});

describe('computeEditDiff', () => {
  it('Edit: counts +/− from old/new strings', () => {
    const d = computeEditDiff('Edit', {
      file_path: '/repo/src/foo.ts',
      old_string: 'const a = 1;\nconst b = 2;',
      new_string: 'const a = 1;\nconst b = 3;\nconst c = 4;',
    })!;
    expect(d.kind).toBe('edit');
    expect(d.path).toBe('/repo/src/foo.ts');
    expect(d.additions).toBe(2); // "const b = 3;" + "const c = 4;"
    expect(d.deletions).toBe(1); // "const b = 2;"
  });

  it('MultiEdit: sums across edits', () => {
    const d = computeEditDiff('MultiEdit', {
      file_path: '/repo/x.ts',
      edits: [
        { old_string: 'a', new_string: 'A' },
        { old_string: 'b\nc', new_string: 'b' },
      ],
    })!;
    expect(d.additions).toBe(1); // A
    expect(d.deletions).toBe(2); // a, c
  });

  it('Write: all content lines are additions', () => {
    const d = computeEditDiff('Write', { file_path: '/repo/new.ts', content: 'line1\nline2\nline3' })!;
    expect(d.kind).toBe('write');
    expect(d.additions).toBe(3);
    expect(d.deletions).toBe(0);
  });

  it('apply_patch: parses +/− from the V4A body and the file path', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/screens/TickerRow.tsx',
      '@@',
      ' const x = 1;',
      '-const y = 2;',
      '+const y = 3;',
      '+const z = 4;',
      '*** End Patch',
    ].join('\n');
    const d = computeEditDiff('apply_patch', patch)!;
    expect(d.kind).toBe('patch');
    expect(d.path).toBe('src/screens/TickerRow.tsx');
    expect(d.additions).toBe(2);
    expect(d.deletions).toBe(1);
  });

  it('returns null for non-edit tools', () => {
    expect(computeEditDiff('Read', { file_path: '/x' })).toBeNull();
    expect(computeEditDiff('Bash', { command: 'ls' })).toBeNull();
  });

  it('isEditTool covers the edit family', () => {
    expect(isEditTool('Edit')).toBe(true);
    expect(isEditTool('apply_patch')).toBe(true);
    expect(isEditTool('Read')).toBe(false);
  });
});
