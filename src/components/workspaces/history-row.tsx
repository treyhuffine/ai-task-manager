'use client';

import { GitBranch } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useDiffStats } from '@/hooks/use-workspaces';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { splitHighlight } from '@/lib/search/highlight';
import { cn } from '@/lib/utils';
import type { RailSession } from '@/lib/api/sessions';
import { DiffStatsPair } from './diff-stats';
import { SessionRowMenu } from './session-row-menu';
import { useSessionRowHover } from './session-hover-context';

interface HistoryRowProps {
  session: RailSession;
  /** When set (search results), renders a highlighted transcript snippet
   *  beneath the workspace/branch line. Match terms are wrapped in the
   *  `@/lib/search/highlight` sentinels. */
  snippet?: string | null;
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
  onCreateExecution?: (workspaceId: string) => void;
  onOpenCreateFrom?: (workspaceId: string) => void;
}

/**
 * One row in the "By history" rail tab. Two-line layout:
 *
 *   Line 1 — execution label, with the right-edge date stamp.
 *   Line 2 — workspace name · branch · diff stats (+/-).
 *
 * The avatar carries the workspace identity so a vertical scan parses
 * "which project did this work happen in" before reading the label.
 * Diff stats come from the existing on-demand `useDiffStats` endpoint
 * — the row mounts only when scrolled into view-ish, and React Query
 * dedupes the same session across multiple surfaces.
 *
 * Archived sessions render muted but still navigable so the user can
 * jump back into past work; the row's `isArchived` flag just tones the
 * left edge so the eye reads the active rows first.
 */
export function HistoryRow({
  session,
  snippet,
  onOpenWorkspaceSettings,
  onCreateExecution,
  onOpenCreateFrom,
}: HistoryRowProps) {
  const { activeView, setActiveView } = useDashboard();
  const { data: diffStats } = useDiffStats(session.worktreePath ? session.id : null);
  const { rowRef, onMouseEnter, onMouseLeave, closeNow } = useSessionRowHover(session.id);

  const isActive = activeView === session.id;
  const isArchived = session.status === 'archived';

  const handleOpen = () => {
    closeNow();
    setActiveView(session.id);
  };

  // History is one-per-chat: prefer the chat's own label so sibling chats on
  // one execution stay distinguishable, falling back to the execution title
  // for a brand-new chat whose label hasn't been derived yet.
  const label = session.label ?? session.execution?.label ?? 'Untitled';
  const labelIsPlaceholder = !(session.label ?? session.execution?.label);

  const wsName = session.workspaceName ?? 'Workspace removed';
  const wsImage = coverAttachmentUrl(session.workspaceAttachments);
  const wsEmoji = session.workspaceEmoji;
  const branch = session.branchName;

  const timestamp = session.lastOutcomeEventAt ?? session.startedAt;

  return (
    <div
      ref={rowRef}
      onClick={handleOpen}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
      className={cn(
        'relative group flex items-start gap-1.5 px-2 py-1.5 rounded-md transition-colors text-left cursor-pointer',
        isActive ? 'bg-secondary' : 'hover:bg-muted/40',
        isArchived && !isActive && 'opacity-60',
      )}
    >
      <WorkspaceAvatar wsImage={wsImage} wsEmoji={wsEmoji} wsName={wsName} />

      <div className="flex-1 min-w-0 leading-tight">
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'flex-1 text-[11.5px] truncate',
              labelIsPlaceholder
                ? 'italic text-muted-foreground/70'
                : 'font-medium text-foreground/90',
            )}
          >
            {label}
          </span>
          <span className="text-[9px] text-muted-foreground/60 flex-shrink-0 transition-opacity group-hover:opacity-0 group-has-data-[state=open]:opacity-0">
            {formatCompactRelative(timestamp)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[9.5px] text-muted-foreground/70 mt-0.5 min-w-0">
          <span className="truncate">{wsName}</span>
          {branch && (
            <span className="flex items-center gap-0.5 truncate min-w-0">
              <GitBranch size={8} className="opacity-60 flex-shrink-0" />
              <span className="truncate">{branch}</span>
            </span>
          )}
          <DiffStatsPair stats={diffStats} className="ml-auto flex-shrink-0" />
        </div>
        {snippet && <SearchSnippet snippet={snippet} />}
      </div>

      <SessionRowMenu
        sessionId={session.id}
        workspaceId={session.workspaceId ?? null}
        workspaceIsGit={session.workspaceIsGit ?? false}
        isUnread={false}
        label={label}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        onCreateExecution={onCreateExecution}
        onOpenCreateFrom={onOpenCreateFrom}
        className="absolute right-1 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </div>
  );
}

/**
 * Transcript snippet line for search results. Splits on the highlight
 * sentinels and wraps matched terms so the reason this row matched is obvious
 * at a glance. Two-line clamp keeps rows scannable.
 */
function SearchSnippet({ snippet }: { snippet: string }) {
  const segments = splitHighlight(snippet);
  return (
    <p className="mt-0.5 text-[9.5px] leading-snug text-muted-foreground/75 line-clamp-2">
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <mark
            key={i}
            className="rounded-[2px] bg-primary/20 px-0.5 text-foreground/90"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  );
}

function initialsFor(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '·';
  const words = cleaned.split(/\s+/);
  if (words.length === 1) return words[0]!.charAt(0).toUpperCase();
  return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
}

function WorkspaceAvatar({
  wsImage,
  wsEmoji,
  wsName,
}: {
  wsImage: string | null;
  wsEmoji: string | null;
  wsName: string;
}) {
  return (
    <span className="relative w-5 h-5 flex items-center justify-center flex-shrink-0 mt-px">
      {wsImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={wsImage} alt="" className="w-5 h-5 rounded object-cover" />
      ) : wsEmoji ? (
        <span className="text-base leading-none">{wsEmoji}</span>
      ) : (
        <span
          aria-hidden
          className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold tracking-wide bg-muted text-muted-foreground"
        >
          {initialsFor(wsName)}
        </span>
      )}
    </span>
  );
}
