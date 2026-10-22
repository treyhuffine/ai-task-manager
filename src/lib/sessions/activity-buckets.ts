import type { RailSession } from '@/lib/api/sessions';
import type { AgentAttentionItem } from '@/hooks/use-agent-attention';
import type { BucketId } from './classification';
import { latestActivityAt, sessionHotnessKey } from '@/lib/utils/session-sort';
import { timestampEpoch } from '@/lib/utils/timestamps';

export type ActivityItem = { kind: 'execution'; id: string; session: RailSession } | { kind: 'agent'; id: string; item: AgentAttentionItem };
export type ActivityBuckets = Record<BucketId, ActivityItem[]>;

/** The HUD and Board read exactly the same rows, once each, newest first. */
export function combineActivityBuckets(sessions: Record<BucketId, RailSession[]>, agents: readonly AgentAttentionItem[]): ActivityBuckets {
  const result: ActivityBuckets = { needsApproval: [], unread: [], working: [], waiting: [] };
  const seen = new Set<string>();
  // Main chats retain their agent destination even if a stale rail row overlaps.
  for (const item of agents) {
    if (seen.has(item.chat.id)) continue;
    seen.add(item.chat.id);
    result[item.bucket].push({ kind: 'agent', id: item.chat.id, item });
  }
  for (const bucket of Object.keys(result) as BucketId[]) {
    for (const session of sessions[bucket]) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      result[bucket].push({ kind: 'execution', id: session.id, session });
    }
    const at = (row: ActivityItem) => row.kind === 'execution' ? sessionHotnessKey(row.session) : timestampEpoch(latestActivityAt(row.item.chat));
    result[bucket].sort((a, b) => at(b) - at(a));
  }
  return result;
}

export function activityDestination(row: ActivityItem): { kind: 'agent' | 'execution'; id: string } {
  return row.kind === 'agent' ? { kind: 'agent', id: row.item.workspace.id } : { kind: 'execution', id: row.session.id };
}
