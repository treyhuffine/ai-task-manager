'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Circle, Clock, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions, useCreateExecution } from '@/hooks/use-workspaces';
import { WorkspaceSettingsSheet } from './workspace-settings-sheet';
import { CreateFromModal } from './create-from-modal';
import { BucketSection } from './bucket-section';
import { StatusSessionRow } from './status-session-row';
import { sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import type { RailSession } from '@/lib/api/sessions';

// ─── Bucket configuration ─────────────────────────────────────
//
// Top-to-bottom render order. Reorder by editing this array — the rest
// of the file is data-driven. Bucket names are also the keys used by
// `BucketSection`'s localStorage persistence, so changing one resets
// that bucket's open/closed memory for everyone (intentional — folks
// who care about state are also the ones renaming).

type BucketId = 'needs_approval' | 'unread' | 'waiting' | 'working';

const BUCKET_ORDER: readonly BucketId[] = [
  'needs_approval',
  'unread',
  'waiting',
  'working',
] as const;

interface BucketConfig {
  id: BucketId;
  label: string;
  accentClass: string;
  countBgClass: string;
  icon: ReactNode;
}

const BUCKET_CONFIG: Record<BucketId, BucketConfig> = {
  needs_approval: {
    id: 'needs_approval',
    label: 'Needs approval',
    accentClass: 'text-amber-600 dark:text-amber-400',
    countBgClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    icon: <AlertCircle size={13} className="text-amber-500" />,
  },
  unread: {
    id: 'unread',
    label: 'Unread',
    accentClass: 'text-foreground',
    countBgClass: 'bg-foreground/15 text-foreground',
    icon: <Circle size={11} className="fill-foreground text-foreground" />,
  },
  waiting: {
    id: 'waiting',
    label: 'Waiting response',
    accentClass: 'text-muted-foreground',
    countBgClass: 'bg-muted text-muted-foreground',
    icon: <Clock size={13} className="text-muted-foreground" />,
  },
  working: {
    id: 'working',
    label: 'Working',
    accentClass: 'text-emerald-600 dark:text-emerald-400',
    countBgClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    icon: <Zap size={13} className="text-emerald-500" />,
  },
};

// ─── Classification ───────────────────────────────────────────
//
// Each session lives in exactly one bucket. Priority order (resolves
// overlaps) is encoded here, NOT in BUCKET_ORDER — visual order and
// classification priority are independent concerns. The user can
// reshuffle the rail without changing which bucket a session falls in.

function classify(
  session: RailSession,
  pending: ReadonlySet<string>,
  streaming: ReadonlySet<string>,
): BucketId {
  if (pending.has(session.id)) return 'needs_approval';
  if (streaming.has(session.id)) return 'working';

  // Unread = max(last_outcome_event_at, unread_marker_at) > last_viewed_at.
  // Sentinel '1970-01-01' lets nulls compare lexicographically as
  // "earliest possible time" without explicit null handling.
  const outcomes = [
    session.last_outcome_event_at ?? '1970-01-01',
    session.unread_marker_at ?? '1970-01-01',
  ];
  const lastActivity = outcomes[0]! > outcomes[1]! ? outcomes[0]! : outcomes[1]!;
  const lastViewed = session.last_viewed_at ?? '1970-01-01';
  if (lastActivity > lastViewed && lastActivity !== '1970-01-01') {
    return 'unread';
  }

  return 'waiting';
}

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
      const id = classify(s, pendingInputSessionIds, streamingSessionIds);
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
      <div className="px-3 py-2 text-[10px] italic text-muted-foreground/60">
        Loading…
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
