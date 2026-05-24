"use client";

import { useMemo } from 'react';
import {
  ChevronRight,
  Folder,
  FolderPlus,
  GitBranch,
  Inbox,
} from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import {
  useWorkspaces,
  useNeedsReviewSessions,
  useWorkspaceSessions,
  useUpdateWorkspace,
} from '@/hooks/use-workspaces';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { useAreas } from '@/hooks/use-areas';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { cn } from '@/lib/utils';
import type { ChatSessionRecord, WorkspaceWithCounts } from '@/db/types';

/**
 * Mobile-tab "Agents" surface. Mirrors the desktop rail's structure
 * (Needs Review at the top, then workspaces grouped with collapsible
 * children) but with phone-sized tap targets — rows ~44px tall, larger
 * text, no hover-only affordances.
 *
 * Tapping a session row sets `activeView` to the session id; the
 * mobile shell flips to render `<ExecutionView>` full-screen.
 */
export function MobileAgentsView() {
  const { data: workspaces, isLoading } = useWorkspaces({ status: 'active' });

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <NeedsReviewBlock />

      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          Workspaces
        </span>
      </div>

      <div className="px-3 pb-24 space-y-1">
        {isLoading && (
          <div className="px-3 py-3 text-[12px] italic text-muted-foreground/60">
            Loading…
          </div>
        )}
        {!isLoading && (workspaces?.length ?? 0) === 0 && <EmptyWorkspaces />}
        {workspaces?.map((ws) => <WorkspaceBlock key={ws.id} workspace={ws} />)}
      </div>
    </div>
  );
}

// ─── Needs Review block ───────────────────────────────────────────

function NeedsReviewBlock() {
  const { streamingSessionIds, pendingInputSessionIds } = useDashboard();
  const { data: candidates } = useNeedsReviewSessions();
  const { data: workspaces } = useWorkspaces({ status: 'active' });

  // Exclude sessions that are mid-turn — they'll generate a fresh
  // outcome shortly. Exception: a streaming session blocked on user
  // input is the most actionable kind, so let it through.
  const filtered = useMemo(
    () =>
      (candidates ?? []).filter(
        (s) => pendingInputSessionIds.has(s.id) || !streamingSessionIds.has(s.id),
      ),
    [candidates, streamingSessionIds, pendingInputSessionIds],
  );

  if (filtered.length === 0) return null;

  const wsName = (id: string | null) =>
    (id && workspaces?.find((w) => w.id === id)?.name) || undefined;

  return (
    <section className="px-3 pt-3 pb-2 border-b border-border/60">
      <div className="px-1.5 pb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-amber-500/90">
          Needs Review
        </span>
        <span className="text-[11px] font-mono text-muted-foreground/70">
          {filtered.length}
        </span>
      </div>
      <div className="space-y-1">
        {filtered.map((session) => (
          <MobileSessionRow
            key={session.id}
            session={session}
            workspaceLabel={wsName(session.workspace_id)}
            forceState="needs_review"
          />
        ))}
      </div>
    </section>
  );
}

// ─── Workspace block (collapsible) ────────────────────────────────

function WorkspaceBlock({ workspace }: { workspace: WorkspaceWithCounts }) {
  const { streamingSessionIds } = useDashboard();
  const { data: areas } = useAreas();
  const updateWs = useUpdateWorkspace();
  const expanded = !workspace.collapsed;
  const { data: sessions } = useWorkspaceSessions(expanded ? workspace.id : null);

  const linkedArea = workspace.area_id
    ? areas?.find((a) => a.id === workspace.area_id)
    : undefined;
  const wsImage = coverAttachmentUrl(workspace.attachments);
  const areaImage = linkedArea ? coverAttachmentUrl(linkedArea.attachments) : null;
  const iconImage = wsImage ?? (workspace.emoji ? null : areaImage);
  const iconEmoji = workspace.emoji ?? (wsImage ? null : linkedArea?.emoji ?? null);

  const childSessions = sessions ?? [];
  const streamingCount = childSessions.filter((s) => streamingSessionIds.has(s.id)).length;
  const reviewCount = Math.max(workspace.needs_review_candidate_count - streamingCount, 0);

  const toggle = () => updateWs.mutate({ id: workspace.id, collapsed: expanded });

  return (
    <div className="rounded-xl">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg active:bg-muted/40 transition-colors"
      >
        <span className="w-8 h-8 flex items-center justify-center flex-shrink-0">
          {iconImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={iconImage} alt="" className="w-7 h-7 rounded-md object-cover" />
          ) : iconEmoji ? (
            <span className="text-2xl leading-none">{iconEmoji}</span>
          ) : (
            <Folder size={18} className="text-muted-foreground/60" />
          )}
        </span>
        <span className="flex-1 min-w-0 text-left">
          <span className="block text-[14px] font-semibold text-foreground truncate">
            {workspace.name}
          </span>
          <span className="block text-[11px] text-muted-foreground/70">
            {workspace.session_count}{' '}
            {workspace.session_count === 1 ? 'execution' : 'executions'}
          </span>
        </span>
        <Badge streaming={streamingCount} review={reviewCount} />
        <ChevronRight
          size={16}
          className={cn(
            'text-muted-foreground/60 transition-transform flex-shrink-0',
            expanded && 'rotate-90',
          )}
        />
      </button>

      {expanded && (
        <div className="pl-3 pr-1 pt-1 pb-2 space-y-1">
          {childSessions.length === 0 ? (
            <p className="pl-9 py-2 text-[11px] italic text-muted-foreground/50">
              No sessions yet
            </p>
          ) : (
            childSessions.map((s) => <MobileSessionRow key={s.id} session={s} />)
          )}
        </div>
      )}
    </div>
  );
}

// ─── Session row (mobile sized) ───────────────────────────────────

interface MobileSessionRowProps {
  session: ChatSessionRecord;
  /** When set, shown as a small chip after the label (e.g. workspace
   *  name in the Needs Review surface where we cross workspaces). */
  workspaceLabel?: string;
  /** Force the status pill to "needs_review" — used by the Needs Review
   *  block where we already filtered for that. */
  forceState?: 'needs_review';
}

function MobileSessionRow({ session, workspaceLabel, forceState }: MobileSessionRowProps) {
  const { activeView, setActiveView, streamingSessionIds, pendingInputSessionIds, setMobileTab } =
    useDashboard();
  const isPending = pendingInputSessionIds.has(session.id);
  // Pending wins over streaming: when the agent is blocked on user input
  // the process is still "running," but a green "working" pip would
  // mislead — nothing is happening until the user responds.
  const isStreaming = !isPending && streamingSessionIds.has(session.id);
  const lastOutcome = session.last_outcome_event_at;
  const needsReview =
    forceState === 'needs_review'
      ? true
      : !isStreaming && !isPending && lastOutcome && lastOutcome > (session.last_viewed_at ?? '1970-01-01');
  const timestamp = lastOutcome ?? session.started_at;
  const isActive = activeView === session.id;

  const label = session.label ?? 'Untitled';
  const labelIsPlaceholder = !session.label;

  const open = () => {
    // Stay on the agents tab — MobileLayout swaps the agents content for
    // ExecutionView when activeView !== 'command'.
    setMobileTab('agents');
    setActiveView(session.id);
  };

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        'w-full flex items-center gap-2 pl-7 pr-2 py-2 rounded-lg text-left transition-colors',
        isActive ? 'bg-secondary' : 'active:bg-muted/40',
      )}
    >
      <GitBranch size={12} className="flex-shrink-0 text-muted-foreground/60" />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'text-[13px] truncate',
              labelIsPlaceholder
                ? 'italic text-muted-foreground/70'
                : 'font-medium text-foreground',
            )}
          >
            {label}
          </span>
          {workspaceLabel && (
            <span className="text-[10px] text-muted-foreground/60 truncate">
              · {workspaceLabel}
            </span>
          )}
        </span>
      </span>
      <span className="flex items-center gap-1.5 flex-shrink-0 text-[10px]">
        {isPending ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-amber-500/90 font-medium">needs input</span>
          </>
        ) : isStreaming ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-emerald-500/90 font-medium">working</span>
          </>
        ) : needsReview ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full border border-amber-500" />
            <span className="text-muted-foreground/70">{formatCompactRelative(timestamp)}</span>
          </>
        ) : (
          <span className="text-muted-foreground/60">{formatCompactRelative(timestamp)}</span>
        )}
      </span>
    </button>
  );
}

// ─── Status badge for a workspace header ──────────────────────────

function Badge({ streaming, review }: { streaming: number; review: number }) {
  if (streaming > 0) {
    return (
      <span className="flex items-center gap-1 text-[10px] flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-emerald-500/90 font-medium">working</span>
      </span>
    );
  }
  if (review > 0) {
    return (
      <span className="flex items-center gap-1 text-[10px] flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        <span className="text-amber-500/90 font-medium">{review}</span>
      </span>
    );
  }
  return null;
}

// ─── Empty state ──────────────────────────────────────────────────

function EmptyWorkspaces() {
  return (
    <div className="px-6 py-10 text-center text-muted-foreground">
      <Inbox className="w-8 h-8 mx-auto opacity-30 mb-3" />
      <p className="text-[13px] font-medium text-foreground">No workspaces yet</p>
      <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">
        Create one from the desktop to start running agents.
      </p>
      <p className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
        <FolderPlus size={11} />
        Add from desktop
      </p>
    </div>
  );
}
