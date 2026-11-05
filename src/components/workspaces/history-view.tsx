'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useHistorySessions, useRailSessions } from '@/hooks/use-workspaces';
import { openLauncher } from './launcher/launcher-store';
import { useDashboard } from '@/contexts/dashboard-context';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { cn } from '@/lib/utils';
import { sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import { normalizeTimestamp } from '@/lib/utils/timestamps';
import type { RailSession } from '@/lib/api/sessions';
import { HistoryRow } from './history-row';
import { InactiveFold } from './inactive-fold';
import { useInactivity } from '@/hooks/use-inactivity';
import { Tip } from '@/components/ui/tip';
import { useWorkspaceSelection } from './workspace-selection-context';

const PILL_SCROLL_PRESETS = {
  bar: 'flex gap-1 overflow-x-auto -mx-2 px-2 py-1 scrollbar-thin',
} as const;

/**
 * The rail's Recent tab. Cross-workspace chronological feed of
 * executions, grouped into Today / Yesterday / N-days-ago / weeks-ago /
 * months-ago buckets. Includes active AND archived sessions — this is
 * the only rail tab that surfaces past work, so archived rows belong
 * here even though they're invisible in the Agents tab.
 *
 * Controls:
 *   - Workspace pill row for multi-select scoping. Pills derive from
 *     the sessions actually present in the history feed (not the
 *     workspaces table) so an empty workspace never gets a chip.
 *
 * Inactive work folds away like every other list: what was touched within
 * the inactive threshold shows, whatever its status (archived included), and
 * the rest sits behind "N inactive" · Show at the foot, in its own date
 * groups. The chat open right now always shows.
 *
 * Full-text search over transcripts lives in the chat search modal (the
 * rail's Search button, `ChatSearchModal`), not here — it searches every chat's
 * content, not just this feed's labels.
 *
 * Selecting chats to archive from here (the list header's Select chats to
 * archive) stays here. Then the list is every active execution, from the
 * rail's live record rather than the feed: archived work has nothing to
 * archive, so it's left out, and the feed's cap of 200 can't hide old work,
 * the work you'd most want to clear. An execution's chats are one row, as
 * archiving takes them all. The fold's Select all ticks every inactive chat.
 */
export function HistoryView() {
  const { data, isLoading } = useHistorySessions();
  // The history feed refreshes once a minute, while the rail's record of an
  // active execution is live (the session stream, read and unread, pins). Use
  // it wherever there is one, so Recent shows the same status and order as
  // the agent tree. Archived work only lives in the feed.
  const { data: rail } = useRailSessions();
  const selecting = useWorkspaceSelection()?.selecting ?? false;
  const sessions = useMemo(() => {
    if (selecting) return rail?.sessions ?? [];
    const live = new Map((rail?.sessions ?? []).map((s) => [s.id, s] as const));
    return (data?.sessions ?? []).map((s) => live.get(s.id) ?? s);
  }, [selecting, data?.sessions, rail?.sessions]);
  const loading = selecting ? !rail : isLoading && !data;
  const { openAgent, activeSessionId } = useDashboard();
  const { isInactive } = useInactivity();
  const [selectedWs, setSelectedWs] = useState<ReadonlySet<string>>(new Set());
  // Session row menus open the agent's setup: its view, on the Setup tab.
  const openSetup = (id: string) => openAgent(id, 'setup');

  // Workspaces represented in this feed. Order by first-appearance
  // (which the server already sorted by recency) so the most-recently
  // touched workspace's chip sits leftmost — the same place the user
  // expects to find it in the by-workspace tree.
  const workspacePills = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; emoji: string | null; image: string | null }>();
    for (const s of sessions) {
      if (!s.workspaceId || seen.has(s.workspaceId)) continue;
      seen.set(s.workspaceId, {
        id: s.workspaceId,
        name: s.workspaceName ?? 'Agent',
        emoji: s.workspaceEmoji,
        image: coverAttachmentUrl(s.workspaceAttachments),
      });
    }
    return Array.from(seen.values());
  }, [sessions]);

  const filtered = useMemo(() => {
    const wsScope = selectedWs.size > 0 ? selectedWs : null;
    if (!wsScope) return sessions;
    return sessions.filter(
      (s) => s.workspaceId && wsScope.has(s.workspaceId),
    );
  }, [sessions, selectedWs]);

  // Re-sort before bucketing. The server orders by `last_activity_at`, but
  // this is the one rail surface that used to render the server list
  // verbatim, which meant it inherited every ordering quirk the SQL had.
  // Running the shared key here keeps Recent agreeing with the header's
  // status pills and the workspace tree.
  const { grouped, older, olderIds } = useMemo(() => {
    const recent: RailSession[] = [];
    const folded: RailSession[] = [];
    for (const s of sortSessionsHotnessDesc(filtered)) {
      (isInactive(s) && s.id !== activeSessionId ? folded : recent).push(s);
    }
    return { grouped: groupByDateBucket(recent), older: groupByDateBucket(folded), olderIds: folded.map((s) => s.id) };
  }, [filtered, isInactive, activeSessionId]);

  const togglePill = (id: string) => {
    const next = new Set(selectedWs);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedWs(next);
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
              >
                <X size={9} /> Clear
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-1 px-1 pt-1">
          <HistoryRowSkeleton />
          <HistoryRowSkeleton />
          <HistoryRowSkeleton />
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-3 py-4 text-center text-[10px] text-muted-foreground/70 leading-relaxed">
          {sessions.length > 0 ? 'Nothing matches your filter.' : selecting ? 'No chats to archive.' : 'No chats yet.'}
        </div>
      ) : (
        <div className="flex flex-col pt-1">
          <DateGroups groups={grouped} onOpenWorkspaceSettings={openSetup} />
          <InactiveFold sectionId="recent" count={olderIds.length} className="pl-3" selectIds={olderIds}>
            {/* Dimmed so the list reads as its recent work first. Not while
                ticking them, when a dimmed tick would read as half there. */}
            <div className={cn(!selecting && 'opacity-60 transition-opacity hover:opacity-100')}>
              <DateGroups groups={older} onOpenWorkspaceSettings={openSetup} />
            </div>
          </InactiveFold>
        </div>
      )}
    </>
  );
}

function DateGroups({
  groups,
  onOpenWorkspaceSettings,
}: {
  groups: DateGroup[];
  onOpenWorkspaceSettings: (id: string) => void;
}) {
  return (
    <>
      {groups.map((group) => (
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
                onOpenWorkspaceSettings={onOpenWorkspaceSettings}
                onOpenLauncher={openLauncher}
              />
            ))}
          </div>
        </section>
      ))}
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
    <Tip label={name} onlyWhenTextHidden>
      <button
        onClick={onClick}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-medium transition-colors flex-shrink-0 max-w-[120px]',
          selected
            ? 'bg-foreground text-background'
            : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
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
    </Tip>
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
    // Bucket on activity, not outcome. A month-old execution worked on today
    // belongs under "Today" — keying off `lastOutcomeEventAt` filed it by
    // when the agent last spoke, so a session you spent the afternoon in the
    // terminal on (or explicitly marked unread) sat weeks down the feed.
    const ts = s.lastActivityAt ?? s.lastOutcomeEventAt ?? s.startedAt;
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
  // Normalize first: a SQLite space-format value parses as LOCAL time even
  // though `datetime('now')` is UTC, which skewed the bucket by the viewer's
  // offset and could file an evening session under the wrong calendar day.
  const then = new Date(normalizeTimestamp(iso));
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
