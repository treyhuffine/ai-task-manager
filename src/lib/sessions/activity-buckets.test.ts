import { expect, it } from 'vitest';
import type { RailSession } from '@/lib/api/sessions';
import type { AgentAttentionItem } from '@/hooks/use-agent-attention';
import { bucketSessions } from './classification';
import { combineActivityBuckets, activityDestination } from './activity-buckets';

// Only classification, recency and identity fields participate in this pure projection.
const session = (id: string, overrides = {}): RailSession => ({
  id, status: 'active', surfaceKind: null, startedAt: '2026-10-22T10:00:00Z', lastActivityAt: '2026-10-22T10:00:00Z',
  lastOutcomeEventAt: null, unreadMarkerAt: null, lastViewedAt: null, ...overrides,
} as RailSession);
const agent = (id: string, bucket: 'needsApproval' | 'unread'): AgentAttentionItem => ({
  workspace: { id: `agent-${id}` }, chat: { id, lastOutcomeEventAt: '2026-10-22T12:00:00Z', unreadMarkerAt: null },
  activity: bucket === 'needsApproval' ? 'waiting' : 'replied', bucket,
} as AgentAttentionItem);

it('keeps exact classified populations, attention precedence, inactive/import filtering and hotness ordering', () => {
  const sessions = [session('pending'), session('running'), session('new', { lastOutcomeEventAt: '2026-10-22T11:00:00Z' }),
    session('quiet'), session('inactive'), session('import', { surfaceKind: 'imported_agent' }), session('archived', { status: 'archived' }),
    session('pending-newer', { lastActivityAt: '2026-10-22T13:00:00Z' })];
  const buckets = bucketSessions(sessions, new Set(['pending', 'pending-newer']), new Set(['pending', 'running']), (s) => s.id === 'inactive');
  const rows = combineActivityBuckets(buckets, [agent('main', 'needsApproval'), agent('replied', 'unread')]);
  expect(Object.fromEntries(Object.entries(rows).map(([key, items]) => [key, items.map((item) => item.id)]))).toEqual({
    needsApproval: ['pending-newer', 'main', 'pending'], unread: ['replied', 'new'], working: ['running'], waiting: ['quiet'],
  });
  for (const bucket of ['needsApproval', 'unread', 'working', 'waiting'] as const) {
    expect(rows[bucket].length).toBe(buckets[bucket].length + (bucket === 'needsApproval' || bucket === 'unread' ? 1 : 0));
  }
  expect(activityDestination(rows.needsApproval[1])).toEqual({ kind: 'agent', id: 'agent-main' });
  expect(activityDestination(rows.working[0])).toEqual({ kind: 'execution', id: 'running' });
});
it('shows a conversation once if overlapping snapshots repeat it', () => {
  const same = session('main');
  const rows = combineActivityBuckets({ needsApproval: [same, same], unread: [], working: [], waiting: [] }, [agent('main', 'needsApproval'), agent('main', 'needsApproval')]);
  expect(rows.needsApproval).toHaveLength(1);
  expect(rows.needsApproval[0].kind).toBe('agent');
});
