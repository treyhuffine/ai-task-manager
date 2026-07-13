import { describe, expect, it } from 'vitest';
import type { RailSession } from '@/lib/api/sessions';
import { groupByDateBucket } from './history-view';

// Synthetic RailSession factory — only the timestamp matters for the
// bucketing test. Every other field gets a stable dummy so a future
// type change forces an explicit update here.
function s(id: string, iso: string): RailSession {
  return {
    id,
    createdAt: iso,
    updatedAt: iso,
    userId: 'local',
    agentId: 'a',
    type: 'execution',
    surfaceKind: null,
    surfaceRef: null,
    status: 'active',
    label: 'Test',
    scratchPad: null,
    workspaceId: 'ws-1',
    executionId: null,
    createdByRunId: null,
    execution: null,
    worktreePath: null,
    branchName: null,
    baseSha: null,
    prNumber: null,
    setupError: null,
    setupStartedAt: null,
    setupScriptStatus: null,
    setupScriptError: null,
    lastOutcomeEventAt: iso,
    lastViewedAt: null,
    unreadMarkerAt: null,
    externalSessionId: null,
    externalTranscriptPath: null,
    externalSyncOffset: null,
    externalSyncLastEventId: null,
    externalHistoryCheckpoint: null,
    permissionMode: 'bypass',
    model: null,
    modelVariant: null,
    effort: null,
    prePlanMode: null,
    takeoverStartedAt: null,
    takeoverBaseSha: null,
    takeoverBranch: null,
    takeoverToken: null,
    takeoverTokenExpiresAt: null,
    startedAt: iso,
    archivedAt: null,
    workspaceName: 'Workspace',
    workspaceEmoji: null,
    workspaceAttachments: null,
    workspaceAreaId: null,
    workspaceIsGit: false,
  };
}

describe('groupByDateBucket', () => {
  // Pin "now" so tests are independent of wall-clock time.
  const now = new Date('2026-05-22T12:00:00Z');

  // Build an ISO timestamp `days` calendar days back from `now`.
  function daysAgo(days: number): string {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString();
  }

  it('buckets by Today / Yesterday / N days ago', () => {
    const groups = groupByDateBucket(
      [
        s('today', daysAgo(0)),
        s('yest', daysAgo(1)),
        s('three', daysAgo(3)),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', '3 days ago']);
  });

  it('collapses 7-13 days into "1 week ago" and 14-27 into N weeks ago', () => {
    const groups = groupByDateBucket(
      [
        s('w1', daysAgo(7)),
        s('w1b', daysAgo(13)),
        s('w2', daysAgo(14)),
        s('w3', daysAgo(21)),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['1 week ago', '2 weeks ago', '3 weeks ago']);
    // First bucket should hold both 7-day-ago entries.
    expect(groups[0]!.sessions.map((x) => x.id)).toEqual(['w1', 'w1b']);
  });

  it('produces "1 month ago" then "N months ago"', () => {
    const groups = groupByDateBucket(
      [
        s('m1', daysAgo(30)),
        s('m2', daysAgo(75)),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['1 month ago', '2 months ago']);
  });

  it('collapses past-year entries into a single "Older" bucket', () => {
    const groups = groupByDateBucket(
      [
        s('o1', daysAgo(400)),
        s('o2', daysAgo(900)),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['Older']);
    expect(groups[0]!.sessions).toHaveLength(2);
  });

  it('orders buckets newest-first regardless of input order', () => {
    const groups = groupByDateBucket(
      [
        s('mid', daysAgo(5)),
        s('today', daysAgo(0)),
        s('old', daysAgo(60)),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual([
      'Today',
      '5 days ago',
      '2 months ago',
    ]);
  });

  it('compares by calendar day, not by elapsed hours', () => {
    // 4-hour gap that crosses local-calendar midnight at 12:00 today
    // looks like "Yesterday" — the local calendar advanced even
    // though only 16 hours of wall-clock passed. Construct "now" at
    // local noon, and "then" at noon the previous local day so this
    // assertion holds in every timezone.
    const localNoonToday = new Date(2026, 4, 22, 12, 0, 0);
    const localNoonYesterday = new Date(2026, 4, 21, 12, 0, 0).toISOString();
    const groups = groupByDateBucket([s('crossed', localNoonYesterday)], localNoonToday);
    expect(groups[0]!.label).toBe('Yesterday');
  });
});
