'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useHistorySessions, useCreateExecution } from '@/hooks/use-workspaces';
import { useDashboard } from '@/contexts/dashboard-context';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { cn } from '@/lib/utils';
import type { RailSession } from '@/lib/api/sessions';
import { WorkspaceSettingsSheet } from './workspace-settings-sheet';
import { CreateFromModal } from './create-from-modal';
import { HistoryRow } from './history-row';

const PILL_SCROLL_PRESETS = {
  bar: 'flex gap-1 overflow-x-auto -mx-2 px-2 py-1 scrollbar-thin',
} as const;

/**
 * "By history" rail surface. Cross-workspace chronological feed of
 * executions, grouped into Today / Yesterday / N-days-ago / weeks-ago /
 * months-ago buckets. Includes active AND archived sessions — this is
 * the only rail tab that surfaces past work, so archived rows belong
 * here even though they're invisible in the other two tabs.
 *
 * Controls:
 *   - Workspace pill row for multi-select scoping. Pills derive from
 *     the sessions actually present in the history feed (not the
 *     workspaces table) so an empty workspace never gets a chip.
 *
 * Full-text search over transcripts lives in the always-visible rail search
 * box (see `RailTabs` / `SessionSearchResults`), not here — it searches every
 * chat's content, not just this feed's labels.
 */
export function HistoryView() {
  const { data, isLoading } = useHistorySessions();
  const { setActiveView } = useDashboard();
  const [selectedWs, setSelectedWs] = useState<Set<string>>(new Set());
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [createFromId, setCreateFromId] = useState<string | null>(null);
  const createExecution = useCreateExecution();

  // Workspaces represented in this feed. Order by first-appearance
  // (which the server already sorted by recency) so the most-recently
  // touched workspace's chip sits leftmost — the same place the user
  // expects to find it in the by-workspace tree.
  const workspacePills = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; emoji: string | null; image: string | null }>();
    for (const s of data?.sessions ?? []) {
      if (!s.workspaceId || seen.has(s.workspaceId)) continue;
      seen.set(s.workspaceId, {
        id: s.workspaceId,
        name: s.workspaceName ?? 'Workspace',
        emoji: s.workspaceEmoji,
        image: coverAttachmentUrl(s.workspaceAttachments),
      });
    }
    return Array.from(seen.values());
  }, [data?.sessions]);

  const filtered = useMemo(() => {
    const wsScope = selectedWs.size > 0 ? selectedWs : null;
    if (!wsScope) return data?.sessions ?? [];
    return (data?.sessions ?? []).filter(
      (s) => s.workspaceId && wsScope.has(s.workspaceId),
    );
  }, [data?.sessions, selectedWs]);

  const grouped = useMemo(() => groupByDateBucket(filtered), [filtered]);

  const togglePill = (id: string) => {
    setSelectedWs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createFromName = createFromId
    ? data?.sessions.find((s) => s.workspaceId === createFromId)?.workspaceName ?? null
    : null;
  const handleCreateExecution = (workspaceId: string) => {
    if (createExecution.isPending) return;
    createExecution.mutate(
      { workspaceId },
      {
        onSuccess: (session) => setActiveView(session.id),
      },
    );
  };

  return (
    <>
      {workspacePills.length > 0 && (
        <div className="flex flex-col gap-1.5 px-2 pt-1.5 pb-2 border-b border-border/40">
          <div className={PILL_SCROLL_PRESETS.bar}>
            {workspacePills.map((ws) => (
              <WorkspacePill
                key={ws.id}
                name={ws.name}
                emoji={ws.emoji}
                image={ws.image}
                selected={selectedWs.has(ws.id)}
                onClick={() => togglePill(ws.id)}
              />
            ))}
            {selectedWs.size > 0 && (
              <button
                onClick={() => setSelectedWs(new Set())}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium text-muted-foreground/80 hover:text-foreground hover:bg-muted/40 transition-colors flex-shrink-0"
                title="Clear workspace filter"
              >
                <X size={9} /> Clear
              </button>
            )}
          </div>
        </div>
      )}

      {isLoading && !data ? (
        <div className="flex flex-col gap-1 px-1 pt-1">
          <HistoryRowSkeleton />
          <HistoryRowSkeleton />
          <HistoryRowSkeleton />
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-3 py-4 text-center text-[10px] text-muted-foreground/70 leading-relaxed">
          {(data?.sessions.length ?? 0) === 0 ? 'No executions yet.' : 'Nothing matches your filter.'}
        </div>
      ) : (
        <div className="flex flex-col pt-1">
          {grouped.map((group) => (
            <section key={group.id} className="flex flex-col">
              <h3 className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                {group.label}
                <span className="ml-1.5 text-muted-foreground/50 font-normal lowercase tracking-normal">
                  {group.sessions.length}
                </span>
              </h3>
              <div className="flex flex-col px-1">
                {group.sessions.map((s) => (
                  <HistoryRow
                    key={s.id}
                    session={s}
                    onOpenWorkspaceSettings={setSettingsId}
                    onCreateExecution={handleCreateExecution}
                    onOpenCreateFrom={s.workspaceIsGit ? setCreateFromId : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <WorkspaceSettingsSheet workspaceId={settingsId} onClose={() => setSettingsId(null)} />
      <CreateFromModal
        workspaceId={createFromId}
        workspaceName={createFromName}
        onClose={() => setCreateFromId(null)}
      />
    </>
  );
}

// ─── Workspace pill ───────────────────────────────────────────

function WorkspacePill({
  name,
  emoji,
  image,
  selected,
  onClick,
}: {
  name: string;
  emoji: string | null;
  image: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-medium transition-colors flex-shrink-0 max-w-[120px]',
        selected
          ? 'bg-foreground text-background'
          : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      title={name}
    >
      <span className="w-3 h-3 flex items-center justify-center flex-shrink-0">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="w-3 h-3 rounded-sm object-cover" />
        ) : emoji ? (
          <span className="text-[10px] leading-none">{emoji}</span>
        ) : (
          <span className={cn(
            'w-3 h-3 rounded-sm flex items-center justify-center text-[7px] font-bold',
            selected ? 'bg-background/20' : 'bg-background/60',
          )}>
            {name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <span className="truncate">{name}</span>
    </button>
  );
}

// ─── Date bucketing ───────────────────────────────────────────

interface DateGroup {
  id: string;
  label: string;
  sessions: RailSession[];
}

/**
 * Conductor-style date buckets. `now` is parameterizable so tests can
 * pin the clock; production callers omit it. Order returned is
 * "most recent first" — matches the input ordering.
 *
 *   Today          (same calendar day)
 *   Yesterday      (1 calendar day back)
 *   N days ago     (2-6)
 *   1 week ago     (7-13)
 *   N weeks ago    (14-27)
 *   1 month ago    (28-59)
 *   N months ago   (60-364)
 *   Older          (one bucket for everything past a year)
 */
export function groupByDateBucket(sessions: RailSession[], now: Date = new Date()): DateGroup[] {
  const groups = new Map<string, DateGroup>();

  for (const s of sessions) {
    const ts = s.lastOutcomeEventAt ?? s.startedAt;
    const bucket = describeBucket(ts, now);
    const existing = groups.get(bucket.id);
    if (existing) {
      existing.sessions.push(s);
    } else {
      groups.set(bucket.id, { id: bucket.id, label: bucket.label, sessions: [s] });
    }
  }

  // Sort bucket entries by their canonical position so a session that
  // moves from "today" to "yesterday" doesn't reorder its siblings.
  // The bucket id is `idx`-prefixed (e.g. `0|today`, `2|days|3`) — a
  // simple lexicographic sort is enough.
  return Array.from(groups.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function describeBucket(iso: string, now: Date): { id: string; label: string } {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return { id: '99|unknown', label: 'Unknown' };

  const days = calendarDaysBetween(then, now);

  if (days <= 0) return { id: '00|today', label: 'Today' };
  if (days === 1) return { id: '01|yesterday', label: 'Yesterday' };
  if (days < 7) return { id: `02|days|${pad(days)}`, label: `${days} days ago` };
  if (days < 14) return { id: '03|week|1', label: '1 week ago' };
  if (days < 28) {
    const weeks = Math.floor(days / 7);
    return { id: `04|weeks|${pad(weeks)}`, label: `${weeks} weeks ago` };
  }
  if (days < 60) return { id: '05|month|1', label: '1 month ago' };
  if (days < 365) {
    const months = Math.floor(days / 30);
    return { id: `06|months|${pad(months)}`, label: `${months} months ago` };
  }
  return { id: '99|older', label: 'Older' };
}

function calendarDaysBetween(then: Date, now: Date): number {
  // Compare at calendar-day granularity so "5 minutes ago but past
  // midnight" reads as Yesterday — matches what a human means by "X
  // days ago" without dragging in a date library.
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((b - a) / 86_400_000);
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

// ─── Skeleton ─────────────────────────────────────────────────

function HistoryRowSkeleton() {
  return (
    <div className="flex items-start gap-1.5 px-2 py-1.5">
      <div className="w-5 h-5 rounded bg-muted/60 animate-pulse flex-shrink-0 mt-px" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="h-2.5 w-3/5 rounded bg-muted/60 animate-pulse" />
        <div className="h-2 w-2/5 rounded bg-muted/40 animate-pulse" />
      </div>
    </div>
  );
}
