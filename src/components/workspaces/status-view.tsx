'use client';

import { useMemo, useState } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions, useCreateExecution } from '@/hooks/use-workspaces';
import { WorkspaceSettingsSheet } from './workspace-settings-sheet';
import { CreateFromModal } from './create-from-modal';
import { BucketSection } from './bucket-section';
import { StatusSessionRow } from './status-session-row';
import { BUCKET_CONFIG, BUCKET_ORDER, classifySession, type BucketId } from './bucket-config';
import { sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import type { RailSession } from '@/lib/api/sessions';

// ─── View ─────────────────────────────────────────────────────

export function StatusView() {
  const { data, isLoading } = useRailSessions();
  const { streamingSessionIds, pendingInputSessionIds, setActiveView } = useDashboard();
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [createFromId, setCreateFromId] = useState<string | null>(null);
  const createExecution = useCreateExecution();

  // Workspace name lookup for the CreateFromModal header. The rail
  // already carries the join, so we read the name off the same data —
  // no extra fetch.
  const createFromName = createFromId
    ? data?.sessions.find((s) => s.workspace_id === createFromId)?.workspace_name ?? null
    : null;

  const handleCreateExecution = (workspaceId: string) => {
    if (createExecution.isPending) return;
    createExecution.mutate(
      { workspaceId },
      {
        onSuccess: (session) => {
          setActiveView(session.id);
        },
      },
    );
  };

  const buckets = useMemo(() => {
    const map: Record<BucketId, RailSession[]> = {
      needs_approval: [],
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
      map[id].push(s);
    }
    // Sort each bucket independently so the hottest row sits at the
    // top of every section. The server already returns sessions in
    // recency order, but we re-sort client-side to (a) survive any
    // future API ordering shifts and (b) factor unread_marker_at,
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

  const total = (data?.sessions.length ?? 0);
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
          const sessions = buckets[bucketId];
          return (
            <BucketSection
              key={cfg.id}
              id={cfg.id}
              label={cfg.label}
              count={sessions.length}
              accentClass={cfg.accentClass}
              countBgClass={cfg.countBgClass}
              headerBgClass={cfg.headerBgClass}
              icon={cfg.icon}
            >
              {sessions.map((s) => (
                <StatusSessionRow
                  key={s.id}
                  session={s}
                  bucket={bucketId}
                  isUnread={bucketId === 'unread' || bucketId === 'needs_approval'}
                  onOpenWorkspaceSettings={setSettingsId}
                  onCreateExecution={handleCreateExecution}
                  onOpenCreateFrom={setCreateFromId}
                />
              ))}
            </BucketSection>
          );
        })}
      </div>

      <WorkspaceSettingsSheet workspaceId={settingsId} onClose={() => setSettingsId(null)} />
      <CreateFromModal
        workspaceId={createFromId}
        workspaceName={createFromName}
        onClose={() => setCreateFromId(null)}
      />
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
