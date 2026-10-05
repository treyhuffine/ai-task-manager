import { describe, expect, it } from 'vitest';
import { parseLog } from './commits';

const US = '\u001f';

describe('parseLog', () => {
  it('reads commits and their numstat, skipping binary files', () => {
    const out = [
      `@abc123${US}2026-10-01T09:30:00-07:00${US}feat(rail): places and verbs`,
      '',
      '120\t40\tsrc/components/rail.tsx',
      '-\t-\tpublic/logo.png',
      `@def456${US}2026-10-01T10:00:00-07:00${US}fix: a | pipe in the subject`,
      '3\t1\tREADME.md',
    ].join('\n');
    expect(parseLog(out)).toEqual([
      {
        hash: 'abc123',
        at: '2026-10-01T09:30:00-07:00',
        subject: 'feat(rail): places and verbs',
        files: [{ added: 120, deleted: 40, path: 'src/components/rail.tsx' }],
      },
      {
        hash: 'def456',
        at: '2026-10-01T10:00:00-07:00',
        subject: 'fix: a | pipe in the subject',
        files: [{ added: 3, deleted: 1, path: 'README.md' }],
      },
    ]);
  });

  it('is empty for no output', () => {
    expect(parseLog('')).toEqual([]);
  });
});
