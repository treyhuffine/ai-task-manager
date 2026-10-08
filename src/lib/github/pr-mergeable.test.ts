import { beforeEach, describe, expect, it, vi } from 'vitest';

const exec = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => {
  const execFile = (() => { throw new Error('Use the promisified execFile'); }) as unknown as Record<symbol, typeof exec>;
  execFile[Symbol.for('nodejs.util.promisify.custom')] = exec;
  return { execFile };
});

import { getPrStatus } from './pr-mergeable';

const sha = 'a'.repeat(40);
beforeEach(() => { exec.mockReset(); });

describe('commit-bound GitHub PR status', () => {
  it('reads the exact head and both check shapes in one provider response', async () => {
    exec.mockResolvedValue({ stdout: JSON.stringify({ headRefOid: sha.toUpperCase(), mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED', autoMergeRequest: { enabledAt: 'today' }, statusCheckRollup: [
        { status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'FAILURE' }, { state: 'EXPECTED' },
      ] }) });
    expect(await getPrStatus('/repo', 17)).toEqual({ headSha: sha, mergeable: 'MERGEABLE',
      reviewDecision: 'approved', autoMergeEnabled: true, outOfDate: false,
      checks: { state: 'failing', total: 4, passed: 2, failed: 1, pending: 1 } });
    const [command, args, options] = exec.mock.calls[0];
    expect(command).toBe('gh');
    expect(args).toEqual(['pr', 'view', '17', '--json', expect.stringContaining('headRefOid')]);
    expect(options).toEqual({ cwd: '/repo', encoding: 'utf8' });
  });

  it.each([undefined, null, '', 'abc123', 'x'.repeat(40), 123])('keeps an unavailable or malformed head unknown (%s)', async (headRefOid) => {
    exec.mockResolvedValue({ stdout: JSON.stringify({ headRefOid,
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] }) });
    const status = await getPrStatus('/repo', 17);
    expect(status.headSha).toBeNull();
    expect(status.checks?.state).toBe('passing');
  });

  it('does not turn an absent check rollup into a successful check', async () => {
    exec.mockResolvedValue({ stdout: JSON.stringify({ headRefOid: sha, statusCheckRollup: [] }) });
    expect(await getPrStatus('/repo', 17)).toMatchObject({ headSha: sha, checks: null });
  });

  it.each(['provider failure', 'invalid JSON'])('drops the head and check claims when observation fails (%s)', async (failure) => {
    if (failure === 'provider failure') exec.mockRejectedValue(new Error('offline'));
    else exec.mockResolvedValue({ stdout: '{broken' });
    expect(await getPrStatus('/repo', 17)).toEqual({ headSha: null, checks: null,
      mergeable: 'UNKNOWN', reviewDecision: null, autoMergeEnabled: false, outOfDate: false });
  });

  it('retains main branch out-of-date detection alongside the exact head snapshot', async () => {
    exec.mockResolvedValue({ stdout: JSON.stringify({ headRefOid: sha, mergeStateStatus: 'BEHIND', mergeable: 'MERGEABLE' }) });
    expect(await getPrStatus('/repo', 17)).toMatchObject({ headSha: sha, mergeable: 'MERGEABLE', outOfDate: true });
    expect(exec.mock.calls[0][1].at(-1)).toContain('mergeStateStatus');
  });
});
