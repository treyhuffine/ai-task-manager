import { describe, expect, it } from 'vitest';
import { narrativePr } from './narrative-pr';
import type { OpenablePr } from '@/hooks/use-execution-actions';

const url = 'https://github.com/o/r/pull/402';
const linked: OpenablePr = { number: 7, url: 'https://github.com/o/r/pull/7', closed: false };

describe('narrativePr', () => {
  it("names an open PR state's own PR over the linked one", () => {
    for (const kind of ['prOpenInSync', 'prMergeable', 'prMerged'] as const) {
      expect(narrativePr({ kind, prNumber: 402, prUrl: url }, linked)).toEqual({ number: 402, url, closed: false });
    }
    expect(narrativePr({ kind: 'prOpenAhead', prNumber: 402, prUrl: url, ahead: 2 }, linked)?.number).toBe(402);
    expect(narrativePr({ kind: 'prOpenBehindBase', prNumber: 402, prUrl: url, behind: 3 }, linked)?.number).toBe(402);
    expect(narrativePr({ kind: 'prConflictingWithBase', prNumber: 402, prUrl: url, behind: 1 }, null)?.number).toBe(402);
  });

  it('marks a closed PR state as closed', () => {
    expect(narrativePr({ kind: 'prClosed', prNumber: 402, prUrl: url }, null)).toEqual({ number: 402, url, closed: true });
  });

  it("names a dirty tree's open PR, else the linked one", () => {
    const dirty = { kind: 'dirty', staged: 1, unstaged: 0, untracked: 0 } as const;
    expect(narrativePr({ ...dirty, pr: { prNumber: 402, prUrl: url } }, linked)).toEqual({ number: 402, url, closed: false });
    const closedLink = { ...linked, closed: true };
    expect(narrativePr(dirty, closedLink)).toBe(closedLink);
  });

  it('falls back to the linked PR in states that carry none', () => {
    expect(narrativePr({ kind: 'behindBase', behind: 4 }, linked)).toBe(linked);
    expect(narrativePr({ kind: 'aheadNoPr', ahead: 1 }, linked)).toBe(linked);
    expect(narrativePr({ kind: 'branchNoPr', files: 2 }, linked)).toBe(linked);
    expect(narrativePr({ kind: 'localDiverged' }, linked)).toBe(linked);
    expect(narrativePr({ kind: 'setupFailed', error: 'x', prNumber: 7 }, linked)).toBe(linked);
    expect(narrativePr({ kind: 'aheadNoPr', ahead: 1 }, null)).toBeNull();
  });
});
