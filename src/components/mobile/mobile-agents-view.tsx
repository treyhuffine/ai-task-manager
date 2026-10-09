"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { BACKGROUND_DOT, BACKGROUND_LABEL } from '@/components/workspaces/activity-style';
import { InactiveFold } from '@/components/workspaces/inactive-fold';
import { WorkspaceCreateModal } from '@/components/workspaces/workspace-create-modal';
import { AgentInitials } from '@/components/agents/agent-icon';
import { useDashboard } from '@/contexts/dashboard-context';
import type { WorkspaceWithCounts } from '@/db/types';
import { useAreas } from '@/hooks/use-areas';
import { useInactivity } from '@/hooks/use-inactivity';
import {
	useNeedsReviewSessions,
	useUpdateWorkspace,
	useWorkspaces,
	useWorkspaceSessions,
} from '@/hooks/use-workspaces';
import type { ChatSessionWithExecution } from '@/lib/api/dto/records';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { executionView } from '@/lib/client/active-view';
import { useAgentViewMode } from '@/lib/client/agent-view-mode';
import { startExecution } from '@/lib/executions/start-execution';
import { cn } from '@/lib/utils';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { isSessionUnread } from '@/lib/utils/session-sort';
import type { AgentTab } from '@/types/dashboard';
import { useQueryClient } from '@tanstack/react-query';
import {
	Bot,
	ChevronRight,
	FileText,
	GitBranch,
	Laptop,
	Moon,
	MoreHorizontal,
	Plus,
	Settings,
	SquareTerminal,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { RunOnSheet } from './run-on-sheet';
import { Tip } from '@/components/ui/tip';
import { MobileReviewAttention } from '@/components/results/mobile-review-attention';

/**
 * Mobile-tab "Agents" surface. Mirrors the desktop rail's structure
 * (Needs Review at the top, then workspaces grouped with collapsible
 * children) but with phone-sized tap targets — rows ~44px tall, larger
 * text, no hover-only affordances.
 *
 * Tapping a session row opens that execution, and tapping an agent opens
 * its view (or folds its list, per the agent-view trial preference); the
 * mobile shell renders either full screen.
 */
export function MobileAgentsView() {
  const { data: workspaces, isLoading } = useWorkspaces({ status: 'active' });
  const [createWsOpen, setCreateWsOpen] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <NeedsReviewBlock />
      <MobileReviewAttention />

      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          Agents
        </span>
        <button
          type="button"
          onClick={() => setCreateWsOpen(true)}
          className="w-8 h-8 -mr-1.5 flex items-center justify-center rounded-lg text-primary bg-primary/10 active:bg-primary/20 transition-colors"
          aria-label="New agent"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="px-3 pb-24 space-y-1">
        {isLoading && (
          <div className="px-3 py-3 text-[12px] italic text-muted-foreground/60">
            Loading…
          </div>
        )}
        {!isLoading && (workspaces?.length ?? 0) === 0 && (
          <EmptyWorkspaces onCreate={() => setCreateWsOpen(true)} />
        )}
        {workspaces?.map((ws) => <WorkspaceBlock key={ws.id} workspace={ws} />)}
      </div>

      <WorkspaceCreateModal open={createWsOpen} onOpenChange={setCreateWsOpen} />
    </div>
  );
}

// ─── Needs Review block ───────────────────────────────────────────

function NeedsReviewBlock() {
  const { streamingSessionIds, pendingInputSessionIds } = useDashboard();
  const { data: candidates } = useNeedsReviewSessions();
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const { partition } = useInactivity();

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
  // Inactive ones fold to the foot, as on the desktop rail.
  const { active, inactive } = useMemo(() => partition(filtered), [partition, filtered]);

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
          {active.length}
        </span>
      </div>
      <div className="space-y-1">
        {active.map((session) => (
          <MobileSessionRow
            key={session.id}
            session={session}
            workspaceLabel={wsName(session.workspaceId)}
            forceState="needs_review"
          />
        ))}
      </div>
      <InactiveFold sectionId="unread" count={inactive.length} touch className="pl-10">
        {inactive.map((session) => (
          <MobileSessionRow
            key={session.id}
            session={session}
            workspaceLabel={wsName(session.workspaceId)}
            forceState="needs_review"
            inactive
          />
        ))}
      </InactiveFold>
    </section>
  );
}

// ─── Workspace block (collapsible) ────────────────────────────────

function WorkspaceBlock({ workspace }: { workspace: WorkspaceWithCounts }) {
  const { streamingSessionIds, pendingInputSessionIds, setActiveView, setMobileTab, openAgent } = useDashboard();
  const { opensView } = useAgentViewMode();
  const { isInactive, partition } = useInactivity();
  const { data: reviewCandidates } = useNeedsReviewSessions();
  const { data: areas } = useAreas();
  const updateWs = useUpdateWorkspace();
  // Guards double-fire only — see WorkspaceNav.handleCreateExecution.
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const expanded = !workspace.collapsed;
  const { data: sessions } = useWorkspaceSessions(expanded ? workspace.id : null);

  // Mirror the desktop rail's WorkspaceNav.handleCreateExecution: navigate
  // into the new ExecutionView immediately and let the create land behind it.
  // The label is null until the first message derives one server-side; the
  // header renders "Untitled" in the meantime.
  const handleCreateExecution = (deviceId?: string) => {
    if (creating) return;
    setCreating(true);
    const { sessionId, done } = startExecution(qc, { workspaceId: workspace.id, deviceId });
    setMobileTab('agents');
    setActiveView(executionView(sessionId));
    void done.finally(() => setCreating(false));
  };
  // + starts where the agent usually runs. Another device, for this one
  // execution, is in the agent's ⋯ menu (spec §3.3).
  const [pickingDevice, setPickingDevice] = useState(false);
  const openAgentTab = (tab: AgentTab) => {
    setMobileTab('agents');
    openAgent(workspace.id, tab);
  };

  const linkedArea = workspace.areaId
    ? areas?.find((a) => a.id === workspace.areaId)
    : undefined;
  const wsImage = coverAttachmentUrl(workspace.attachments);
  const areaImage = linkedArea ? coverAttachmentUrl(linkedArea.attachments) : null;
  const iconImage = wsImage ?? (workspace.emoji ? null : areaImage);
  const iconEmoji = workspace.emoji ?? (wsImage ? null : linkedArea?.emoji ?? null);

  const childSessions = sessions ?? [];
  const { active: activeChildren, inactive: inactiveChildren } = partition(childSessions);
  const streamingCount = childSessions.filter((s) => streamingSessionIds.has(s.id)).length;
  // The agent's unread and waiting work, by the Needs Review block's rule,
  // minus what has gone inactive (it sits folded, so it doesn't badge).
  const reviewCount = (reviewCandidates ?? []).filter(
    (s) =>
      s.workspaceId === workspace.id &&
      (pendingInputSessionIds.has(s.id) || !streamingSessionIds.has(s.id)) &&
      !isInactive(s),
  ).length;

  const toggle = () => updateWs.mutate({ id: workspace.id, collapsed: expanded });

  return (
    <div className="rounded-xl">
      {/* Header row: the label area opens the agent's view (or folds, per
          the trial preference), the chevron folds, and the trailing +
          creates a new execution. Sibling buttons, not nested, so a tap on
          one never also fires another. */}
      <div className="w-full flex items-center gap-2 px-2 py-2.5 rounded-lg active:bg-muted/40 transition-colors">
        <button
          type="button"
          onClick={() => {
            if (!opensView) return toggle();
            setMobileTab('agents');
            openAgent(workspace.id);
          }}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <span className="w-8 h-8 flex items-center justify-center flex-shrink-0">
            {iconImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={iconImage} alt="" className="w-7 h-7 rounded-md object-cover" />
            ) : iconEmoji ? (
              <span className="text-2xl leading-none">{iconEmoji}</span>
            ) : (
              <AgentInitials name={workspace.name} />
            )}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] font-semibold text-foreground truncate">
              {workspace.name}
            </span>
            <span className="block text-[11px] text-muted-foreground/70">
              {workspace.sessionCount}{' '}
              {workspace.sessionCount === 1 ? 'execution' : 'executions'}
            </span>
          </span>
        </button>
        <Badge streaming={streamingCount} review={reviewCount} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground active:bg-muted/60 transition-colors flex-shrink-0"
              aria-label={`More for ${workspace.name}`}
            >
              <MoreHorizontal size={18} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => setPickingDevice(true)} className="gap-2 py-2.5 text-[14px]">
              <Laptop size={15} /> New chat on…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openAgentTab('files')} className="gap-2 py-2.5 text-[14px]">
              <FileText size={15} /> Files
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAgentTab('terminal')} className="gap-2 py-2.5 text-[14px]">
              <SquareTerminal size={15} /> Terminal
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAgentTab('setup')} className="gap-2 py-2.5 text-[14px]">
              <Settings size={15} /> Setup
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={() => handleCreateExecution()}
          disabled={creating}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-primary active:bg-primary/10 transition-colors flex-shrink-0 disabled:opacity-40"
          aria-label="New chat"
        >
          <Plus size={18} />
        </button>
        <button
          type="button"
          onClick={toggle}
          className="w-6 h-8 flex items-center justify-center flex-shrink-0"
          aria-label={expanded ? 'Fold agent' : 'Unfold agent'}
        >
          <ChevronRight
            size={16}
            className={cn(
              'text-muted-foreground/60 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        </button>
      </div>

      <RunOnSheet
        workspace={workspace}
        open={pickingDevice}
        onOpenChange={setPickingDevice}
        onPick={(deviceId) => {
          setPickingDevice(false);
          handleCreateExecution(deviceId);
        }}
      />
      {expanded && (
        <div className="pl-3 pr-1 pt-1 pb-2 space-y-1">
          {childSessions.length === 0 ? (
            <button
              type="button"
              onClick={() => handleCreateExecution()}
              disabled={creating}
              className="ml-9 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-primary active:bg-primary/10 transition-colors disabled:opacity-40"
            >
              <Plus size={13} /> New chat
            </button>
          ) : (
            <>
              {activeChildren.map((s) => <MobileSessionRow key={s.id} session={s} />)}
              <InactiveFold sectionId={`agent:${workspace.id}`} count={inactiveChildren.length} touch className="pl-10">
                {inactiveChildren.map((s) => <MobileSessionRow key={s.id} session={s} inactive />)}
              </InactiveFold>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Session row (mobile sized) ───────────────────────────────────

interface MobileSessionRowProps {
  session: ChatSessionWithExecution;
  /** When set, shown as a small chip after the label (e.g. workspace
   *  name in the Needs Review surface where we cross workspaces). */
  workspaceLabel?: string;
  /** Force the status pill to "needs_review" — used by the Needs Review
   *  block where we already filtered for that. */
  forceState?: 'needs_review';
  /** Idle past the inactive threshold: dimmed, with a moon before its age. */
  inactive?: boolean;
}

function MobileSessionRow({ session, workspaceLabel, forceState, inactive = false }: MobileSessionRowProps) {
  const { activeSessionId, activeExecutionId, setActiveView, streamingSessionIds, backgroundSessionIds, pendingInputSessionIds, setMobileTab } =
    useDashboard();
  const isPending = pendingInputSessionIds.has(session.id);
  // Pending wins over streaming: when the agent is blocked on user input
  // the process is still "running," but a green "working" pip would
  // mislead — nothing is happening until the user responds.
  const isStreaming = !isPending && streamingSessionIds.has(session.id);
  // Shared unread rule so the mobile pip matches the desktop rail — this
  // now also honors an explicit "Mark as unread" (unreadMarkerAt), which
  // the old outcome-only check silently ignored.
  const needsReview =
    forceState === 'needs_review'
      ? true
      : !isStreaming && !isPending && isSessionUnread(session);
  // The turn is over but something it started is still running. Not working.
  const isBackground = !isPending && !isStreaming && backgroundSessionIds.has(session.id);
  const timestamp = session.lastActivityAt ?? session.lastOutcomeEventAt ?? session.startedAt;
  // One row per execution: active when the open view is its primary chat
  // or any sibling chat of the same execution.
  const isActive =
    activeSessionId === session.id ||
    (!!session.executionId && activeExecutionId === session.executionId);

  // Title by the execution (stable across its chats); fall back to the
  // primary chat's label for legacy executions that were never named.
  const label = session.execution?.label ?? session.label ?? 'Untitled';
  const labelIsPlaceholder = !(session.execution?.label ?? session.label);

  const open = () => {
    // Stay on the agents tab — MobileLayout swaps the agents content for
    // ExecutionView when activeSessionId !== 'command'.
    setMobileTab('agents');
    setActiveView(executionView(session.id));
  };

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        'w-full flex items-center gap-2 pl-7 pr-2 py-2 rounded-lg text-left transition-[color,background-color,opacity]',
        isActive ? 'bg-secondary' : 'active:bg-muted/40',
        inactive && !isActive && 'opacity-60',
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
          {/* Work away from the home says where (P3.1). The home's own stays quiet. */}
          {session.location && !session.location.isHome && (
            <span className="text-[10px] text-muted-foreground/60 truncate">
              · {session.location.name}
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
        ) : isBackground ? (
          <>
            {needsReview && <span className="w-1.5 h-1.5 rounded-full border border-amber-500" />}
            <span className={cn('w-1.5 h-1.5', BACKGROUND_DOT)} />
            <Tip label={BACKGROUND_LABEL}>
              <span className="text-sky-500/90 font-medium">background</span>
            </Tip>
          </>
        ) : needsReview ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full border border-amber-500" />
            {inactive && <Moon size={10} className="text-muted-foreground/60" aria-label="Inactive" />}
            <span className="text-muted-foreground/70">{formatCompactRelative(timestamp)}</span>
          </>
        ) : (
          <>
            {inactive && <Moon size={10} className="text-muted-foreground/60" aria-label="Inactive" />}
            <span className="text-muted-foreground/60">{formatCompactRelative(timestamp)}</span>
          </>
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

function EmptyWorkspaces({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="px-6 py-10 text-center text-muted-foreground">
      <Bot className="w-8 h-8 mx-auto opacity-30 mb-3" />
      <p className="text-[13px] font-medium text-foreground">No agents yet</p>
      <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">
        Add one to get started.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-primary bg-primary/10 active:bg-primary/20 transition-colors"
      >
        <Plus size={13} />
        New agent
      </button>
    </div>
  );
}
