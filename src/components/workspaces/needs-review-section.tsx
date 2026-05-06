'use client';

import { useMemo } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useNeedsReviewSessions, useWorkspaces } from '@/hooks/use-workspaces';
import { SessionRow } from './session-row';

/**
 * Top-of-rail surface listing sessions where the agent has produced output
 * the user hasn't read. Hidden when there's nothing to triage — never an
 * empty header.
 */
export function NeedsReviewSection() {
  const { streamingSessionIds } = useDashboard();
  const { data: candidates } = useNeedsReviewSessions();
  const { data: workspaces } = useWorkspaces({ status: 'active' });

  const filtered = useMemo(
    () => (candidates ?? []).filter((s) => !streamingSessionIds.has(s.id)),
    [candidates, streamingSessionIds],
  );

  if (filtered.length === 0) return null;

  const wsName = (id: string | null): string | undefined => {
    if (!id) return undefined;
    return workspaces?.find((w) => w.id === id)?.name;
  };

  return (
    <div className="px-0.5 py-2 border-b border-border/60">
      <div className="px-1.5 pb-1.5 flex items-center justify-between">
        <span className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-amber-500/80">
          Needs Review
        </span>
        <span className="text-[9px] text-muted-foreground/70 font-mono">{filtered.length}</span>
      </div>
      <div className="space-y-0.5">
        {filtered.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            showWorkspaceLabel={wsName(session.workspace_id)}
          />
        ))}
      </div>
    </div>
  );
}
