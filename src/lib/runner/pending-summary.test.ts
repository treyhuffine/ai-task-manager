import { describe, expect, it } from 'vitest';
import type { PendingInput } from './pending';
import { pendingSummary } from './pending-summary';

const base = { requestId: 'r', sessionId: 's', toolUseId: 't', createdAt: '2026-09-30T00:00:00Z' };

describe('pendingSummary', () => {
  it('says the question, falling back to its header', () => {
    const q = (question: string, header = 'Deploy') =>
      ({ ...base, kind: 'question', originalInput: {}, questions: [{ question, header, options: [] }] }) as PendingInput;
    expect(pendingSummary(q('OK to run the migration now?'))).toBe('OK to run the migration now?');
    expect(pendingSummary(q('', 'Pick a branch'))).toBe('Pick a branch');
    expect(pendingSummary({ ...base, kind: 'question', originalInput: {}, questions: [] } as PendingInput)).toBe('It has a question for you');
  });

  it('says what a permission is for, falling back to the tool', () => {
    const p = (extra: Partial<Extract<PendingInput, { kind: 'permission' }>>) =>
      ({ ...base, kind: 'permission', toolName: 'Bash', input: {}, title: null, description: null, ...extra }) as PendingInput;
    expect(pendingSummary(p({ title: 'Run npm run migrate' }))).toBe('Run npm run migrate');
    expect(pendingSummary(p({ description: 'Writes to prod' }))).toBe('Writes to prod');
    expect(pendingSummary(p({}))).toBe('Allow Bash?');
  });

  it('keeps it to one short line', () => {
    const p = { ...base, kind: 'permission', toolName: 'Bash', input: {}, title: `a\n${'b'.repeat(200)}`, description: null } as PendingInput;
    const out = pendingSummary(p, 30);
    expect(out).not.toContain('\n');
    expect(out.length).toBe(30);
  });
});
