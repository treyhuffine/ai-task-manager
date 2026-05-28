'use client';

import { useMemo, useState } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useNeedsReviewSessions, useWorkspaces } from '@/hooks/use-workspaces';
import { SessionRow } from './session-row';
import { WorkspaceSettingsSheet } from './workspace-settings-sheet';

/**
 * Top-of-rail surface listing sessions where the agent has produced output
 * the user hasn't read. Hidden when there's nothing to triage — never an
 * empty header.
 */
export function NeedsReviewSection() {
  const { streamingSessionIds, pendingInputSessionIds } = useDashboard();
  const { data: candidates } = useNeedsReviewSessions();
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const [settingsId, setSettingsId] = useState<string | null>(null);

  // Hide mid-turn sessions — a fresh outcome is imminent. Exception:
  // streaming-but-blocked-on-user-input is the most actionable state
  // there is, so let those through even though they look "streaming."
  const filtered = useMemo(
    () =>
      (candidates ?? []).filter(
        (s) => pendingInputSessionIds.has(s.id) || !streamingSessionIds.has(s.id),
      ),
    [candidates, streamingSessionIds, pendingInputSessionIds],
  );

  if (filtered.length === 0) return null;

  const wsName = (id: string | null): string | undefined => {
    if (!id) return undefined;
    return workspaces?.find((w) => w.id === id)?.name;
  };

  return (
    <>
      <div className="px-1 py-2 border-b border-border/60">
        <div className="px-1.5 pb-1.5 flex items-center justify-between">
          <span className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-amber-500/80">
            Unread
          </span>
          <span className="text-[9px] text-muted-foreground/70 font-mono">{filtered.length}</span>
        </div>
        <div className="space-y-0.5">
          {filtered.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              variant="needs-review"
              showWorkspaceLabel={wsName(session.workspaceId)}
              onOpenWorkspaceSettings={setSettingsId}
            />
          ))}
        </div>
      </div>
      <WorkspaceSettingsSheet workspaceId={settingsId} onClose={() => setSettingsId(null)} />
    </>
  );
}
