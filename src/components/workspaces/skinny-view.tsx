'use client';

import { useMemo } from 'react';
import { useRailSessions, useWorkspaces } from '@/hooks/use-workspaces';
import { sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import type { RailSession } from '@/lib/api/sessions';
import { SkinnySessionRow } from './skinny-session-row';

interface SkinnyViewProps {
  /** Which tab the user last had open in wide mode — drives ordering
   *  only. The rail itself looks identical for all variants. `history`
   *  reuses the by-status ordering (flat, hot-first) since the skinny
   *  rail can't represent date buckets at 44px wide. */
  tab: 'status' | 'workspace' | 'history';
}

/**
 * Icon-strip rendering of the rail. Same data source as the wide views
 * (`useRailSessions`), just rendered as a vertical column of workspace
 * glyphs with status overlays. Ordering follows the user's last tab
 * selection so expanding back to wide doesn't reshuffle:
 *
 *   - `status` — flat list, hot-first (working → needs approval →
 *                unread → idle, by recency within each).
 *   - `workspace` — grouped by workspace in workspace order, sessions
 *                within each workspace also hot-first.
 *
 * Bucket headers and workspace headers are intentionally omitted; the
 * rail's width is too small for text and the existing hover preview
 * supplies execution + workspace context on demand.
 */
export function SkinnyView({ tab }: SkinnyViewProps) {
  const { data, isLoading } = useRailSessions();
  const { data: workspaces } = useWorkspaces({ status: 'active' });

  const ordered = useMemo(() => orderSessions(data?.sessions ?? [], workspaces, tab), [data?.sessions, workspaces, tab]);

  if (isLoading && !data) {
    return (
      <div className="flex flex-col items-center gap-1.5 pt-1">
        <SkinnyRowSkeleton />
        <SkinnyRowSkeleton />
        <SkinnyRowSkeleton />
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div className="px-1 pt-2 text-center text-[9px] text-muted-foreground/60 italic">
        Empty
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 py-1">
      {ordered.map((s) => (
        <SkinnySessionRow key={s.id} session={s} />
      ))}
    </div>
  );
}

function orderSessions(
  sessions: RailSession[],
  workspaces: ReadonlyArray<{ id: string }> | undefined,
  tab: 'status' | 'workspace' | 'history',
): RailSession[] {
  const active = sessions.filter((s) => s.status === 'active');
  // History falls back to status ordering in skinny mode — the rail
  // is too narrow to draw date buckets, and "most recent first" is the
  // closest approximation of what the wide history list shows.
  if (tab === 'status' || tab === 'history') return sortSessionsHotnessDesc(active);

  // Workspace tab: respect workspace list order; sessions within each
  // workspace come out hot-first. Sessions without a known workspace
  // bucket land at the end so they don't disappear silently.
  const order = new Map((workspaces ?? []).map((w, i) => [w.id, i] as const));
  const byWs = new Map<string | null, RailSession[]>();
  for (const s of active) {
    const key = s.workspaceId ?? null;
    const arr = byWs.get(key) ?? [];
    arr.push(s);
    byWs.set(key, arr);
  }
  const sortedKeys = [...byWs.keys()].sort((a, b) => {
    const ai = a == null ? Infinity : order.get(a) ?? Infinity;
    const bi = b == null ? Infinity : order.get(b) ?? Infinity;
    return ai - bi;
  });
  const out: RailSession[] = [];
  for (const k of sortedKeys) {
    out.push(...sortSessionsHotnessDesc(byWs.get(k) ?? []));
  }
  return out;
}

function SkinnyRowSkeleton() {
  return <div className="w-7 h-7 rounded-md bg-muted/60 animate-pulse" />;
}
