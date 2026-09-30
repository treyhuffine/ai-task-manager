'use client';

import { useMemo } from 'react';
import { openLauncher } from './launcher/launcher-store';
import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions } from '@/hooks/use-workspaces';
import { BucketSection } from './bucket-section';
import { InactiveFold } from './inactive-fold';
import { useInactivity } from '@/hooks/use-inactivity';
import { StatusSessionRow } from './status-session-row';
import { BUCKET_CONFIG, BUCKET_ORDER, classifySession, type BucketId } from './bucket-config';
import { sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import type { RailSession } from '@/lib/api/sessions';
import { useAgentAttention } from '@/hooks/use-agent-attention';
import { AgentAttentionRow } from './agent-attention-row';

// ─── View ─────────────────────────────────────────────────────

export function StatusView() {
  const { data, isLoading } = useRailSessions();
  // Agents that want you sit in the same buckets as their work, first, so the
  // counts here match the header pills row for row.
  const agents = useAgentAttention();
  const { streamingSessionIds, pendingInputSessionIds, setActiveView, openAgent } = useDashboard();
  // Session row menus open the agent's setup: its view, on the Setup tab.
  const openSetup = (id: string) => openAgent(id, 'setup');
  const { partition } = useInactivity();

  const buckets = useMemo(() => {
    const map: Record<BucketId, RailSession[]> = {
      needsApproval: [],
      unread: [],
      waiting: [],
      working: [],
    };
    const sessions = data?.sessions ?? [];
    for (const s of sessions) {
      // Defense-in-depth: listRailSessions already filters by status,
      // but if any archived row slips through (stale cache during the
      // archive mutation, future API drift) we skip it here so it
      // never lands in a bucket.
      if (s.status !== 'active') continue;
      const id = classifySession(s, pendingInputSessionIds, streamingSessionIds);
      // null = not live work (a settled import). Skipped in both readers so the
      // HUD pill counts keep matching the rail body row for row.
      if (!id) continue;
      map[id].push(s);
    }
    // Sort each bucket independently so the hottest row sits at the
    // top of every section. The server already returns sessions in
    // recency order, but we re-sort client-side to (a) survive any
    // future API ordering shifts and (b) factor unreadMarkerAt,
    // which the SQL ORDER BY doesn't consider.
    for (const key of Object.keys(map) as BucketId[]) {
      map[key] = sortSessionsHotnessDesc(map[key]);
    }
    return map;
  }, [data?.sessions, pendingInputSessionIds, streamingSessionIds]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-1 px-1 pt-1">
        <StatusRowSkeleton />
        <StatusRowSkeleton />
        <StatusRowSkeleton />
        <StatusRowSkeleton />
      </div>
    );
  }

  // Count what actually landed in a bucket, not the raw row count. Since
  // settled imports classify to null, a home whose only active sessions are
  // imported transcripts has rows but nothing to show — counting rows would
  // skip the empty state and render four zero-count headers instead of saying
  // what's true.
  const agentsIn = (id: BucketId) => agents.filter((a) => a.bucket === id);
  const total = BUCKET_ORDER.reduce((sum, id) => sum + buckets[id].length + agentsIn(id).length, 0);
  if (total === 0) {
    return (
      <div className="px-3 py-4 text-center text-[10px] text-muted-foreground/70 leading-relaxed">
        No active sessions yet.
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col">
        {BUCKET_ORDER.map((bucketId) => {
          const cfg = BUCKET_CONFIG[bucketId];
          // Idle rows fold to the foot of their bucket. The count is active
          // work, like the header's pills, and a bucket holding only inactive
          // rows still shows, one click away.
          const { active, inactive } = partition(buckets[bucketId]);
          const row = (s: RailSession, isInactive: boolean) => (
            <StatusSessionRow
              key={s.id}
              session={s}
              bucket={bucketId}
              isUnread={bucketId === 'unread' || bucketId === 'needsApproval'}
              onOpenWorkspaceSettings={openSetup}
              onOpenLauncher={openLauncher}
              inactive={isInactive}
            />
          );
          return (
            <BucketSection
              key={cfg.id}
              id={cfg.id}
              label={cfg.label}
              count={active.length + agentsIn(bucketId).length}
              hideWhenEmpty={buckets[bucketId].length + agentsIn(bucketId).length === 0}
              accentClass={cfg.accentClass}
              countBgClass={cfg.countBgClass}
              headerBgClass={cfg.headerBgClass}
              icon={cfg.icon}
            >
              {agentsIn(bucketId).map((item) => (
                <AgentAttentionRow key={item.workspace.id} item={item} variant="status" />
              ))}
              {active.map((s) => row(s, false))}
              <InactiveFold sectionId={`status:${bucketId}`} count={inactive.length} className="pl-9">
                {inactive.map((s) => row(s, true))}
              </InactiveFold>
            </BucketSection>
          );
        })}
      </div>
    </>
  );
}

function StatusRowSkeleton() {
  return (
    <div className="flex items-start gap-1.5 pl-4 pr-1.5 py-1.5">
      <div className="w-5 h-5 rounded bg-muted/60 animate-pulse flex-shrink-0 mt-px" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="h-2.5 w-3/5 rounded bg-muted/60 animate-pulse" />
        <div className="h-2 w-2/5 rounded bg-muted/40 animate-pulse" />
      </div>
    </div>
  );
}
