'use client';

import { useDashboard } from '@/contexts/dashboard-context';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { cn } from '@/lib/utils';
import type { RailSession } from '@/lib/api/sessions';
import { SessionRowMenu } from './session-row-menu';
import { useSessionRowHover } from './session-hover-context';

interface StatusSessionRowProps {
  session: RailSession;
  /** What bucket this row is rendered under — drives the right-side
   *  indicator (working pulse, needs-approval dot, etc.). */
  bucket: 'needsApproval' | 'working' | 'unread' | 'waiting';
  isUnread: boolean;
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
  onCreateExecution?: (workspaceId: string) => void;
  onOpenCreateFrom?: (workspaceId: string) => void;
}

/**
 * Two-line row in the rail's "by status" view. Execution label takes
 * the primary line so the user reads "what task is this" first; the
 * workspace name sits underneath as orienting context. The avatar on
 * the left identifies the workspace (image / emoji / colored initial).
 */
export function StatusSessionRow({
  session,
  bucket,
  isUnread,
  onOpenWorkspaceSettings,
  onCreateExecution,
  onOpenCreateFrom,
}: StatusSessionRowProps) {
  const { activeView, setActiveView } = useDashboard();
  const { rowRef, onMouseEnter, onMouseLeave, closeNow } = useSessionRowHover(session.id);

  const isActive = activeView === session.id;

  // Read receipt fires when the user navigates AWAY from the session
  // (handled in ExecutionView's cleanup), not when clicking in. That
  // way the rail doesn't reshuffle while the user is still looking at
  // the row they just opened.
  const handleOpen = () => {
    closeNow();
    setActiveView(session.id);
  };
  // Status rows are one-per-execution, so title by the stable execution
  // label (survives "new chat"); fall back to the chat label otherwise.
  const label = session.execution?.label ?? session.label ?? 'Untitled';
  const labelIsPlaceholder = !(session.execution?.label ?? session.label);

  const wsName = session.workspaceName ?? 'No workspace';
  const wsImage = coverAttachmentUrl(session.workspaceAttachments);
  const wsEmoji = session.workspaceEmoji;

  const lastOutcome = session.lastOutcomeEventAt;
  const timestamp = lastOutcome ?? session.startedAt;

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
        'group flex items-start gap-1.5 pl-4 pr-1.5 py-1.5 rounded-md transition-colors text-left cursor-pointer',
        isActive
          ? 'bg-secondary'
          : 'hover:bg-muted/40',
      )}
    >
      <WorkspaceAvatar
        wsImage={wsImage}
        wsEmoji={wsEmoji}
        wsName={wsName}
        badge={bucket === 'needsApproval' ? 'amber' : null}
      />

      <div className="flex-1 min-w-0 leading-tight">
        <div className={cn(
          'text-[11.5px] truncate',
          labelIsPlaceholder ? 'italic text-muted-foreground/70' : 'text-foreground/80',
          isUnread && !labelIsPlaceholder && 'font-semibold',
          !isUnread && !labelIsPlaceholder && 'font-medium',
        )}>
          {label}
        </div>
        <div className="text-[10px] truncate mt-0.5 text-muted-foreground/70">
          {wsName}
        </div>
      </div>

      <div className="relative flex items-center gap-1 flex-shrink-0 text-[9px] min-h-[1.25rem]">
        <span className="flex items-center gap-1 transition-opacity group-hover:opacity-0 group-has-data-[state=open]:opacity-0">
          <BucketIndicator bucket={bucket} timestamp={timestamp} />
        </span>
        <SessionRowMenu
          sessionId={session.id}
          workspaceId={session.workspaceId ?? null}
          workspaceIsGit={session.workspaceIsGit ?? false}
          isUnread={isUnread}
          label={label}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          onCreateExecution={onCreateExecution}
          onOpenCreateFrom={onOpenCreateFrom}
          className="absolute right-0 top-1/2 -translate-y-1/2"
        />
      </div>
    </div>
  );
}

// ─── Workspace avatar ─────────────────────────────────────────
//
// Identity glyph for a workspace. Resolution: cover image > emoji >
// neutral initial circle. The fallback intentionally stays grayscale
// so the rail doesn't broadcast a fake-color "brand" for every
// workspace — color in this app is reserved for status (working,
// approve, etc.), and shouldn't compete with that on every row.
//
// Replaces the previous Folder-icon fallback — folders read as a tree
// affordance, not an identity.

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
  badge,
}: {
  wsImage: string | null;
  wsEmoji: string | null;
  wsName: string;
  badge: 'amber' | null;
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
      {badge === 'amber' && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500 ring-2 ring-background"
        />
      )}
    </span>
  );
}

function BucketIndicator({
  bucket,
  timestamp,
}: {
  bucket: StatusSessionRowProps['bucket'];
  timestamp: string;
}) {
  if (bucket === 'working') {
    // The "Working" group header already says the state — the row just
    // needs the live pulse to signal it's actively running.
    return <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />;
  }
  if (bucket === 'needsApproval') {
    return (
      <span className="text-amber-500/90 font-medium">approve</span>
    );
  }
  return <span className="text-muted-foreground/70">{formatCompactRelative(timestamp)}</span>;
}
