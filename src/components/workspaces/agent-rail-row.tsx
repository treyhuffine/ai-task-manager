'use client';

import { useMemo } from 'react';
import { ChevronsDownUp, ChevronsUpDown, MoreHorizontal, Plus, SlidersHorizontal } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions, useUpdateWorkspace } from '@/hooks/use-workspaces';
import { useAgentViewMode } from '@/lib/client/agent-view-mode';
import { isSessionUnread, sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import { agentSummary, pickRailThreads, type MainChatActivity, type SummaryTone } from '@/lib/utils/agent-rail';
import { AgentIcon } from '@/components/agents/agent-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { WorkspaceWithCounts } from '@/db/types';
import { SessionRow } from './session-row';

interface AgentRailRowProps {
  workspace: WorkspaceWithCounts;
  /** Open the agent's setup (its view, on the Setup tab). */
  onOpenSettings: (id: string) => void;
  /** Express lane: start right away on remembered settings (shift-click). */
  onCreateExecution: (id: string) => void;
  /** Open the launcher seeded with this agent. */
  onOpenLauncher: (id: string) => void;
}

const TONE: Record<SummaryTone, string> = {
  attention: 'text-amber-600 dark:text-amber-400',
  working: 'text-emerald-600 dark:text-emerald-400',
  muted: 'text-muted-foreground/70',
};

const PRESENCE: Record<Exclude<MainChatActivity, null>, { dot: string; label: string }> = {
  waiting: { dot: 'bg-amber-500 animate-pulse', label: 'Waiting on you' },
  thinking: { dot: 'bg-emerald-500 animate-pulse', label: 'Thinking' },
  replied: { dot: 'bg-amber-500', label: 'New reply' },
};

/**
 * One agent in the agents-first rail (docs/rail-agents-first.md). The agent
 * is someone you work with, so its row leads: its icon, a presence dot for
 * its main chat (thinking, waiting on you, a new reply), its name, and a line
 * in words about its work. Its executions hang off it as one-line threads:
 * the live ones always, the few most recent quiet ones, and a count for the
 * rest, which opens the agent's view.
 *
 * Clicking opens the agent's view (or folds, per `agent-view-mode.ts`). The
 * whole row still drags to reorder, since dnd-kit only starts a drag after
 * real movement. New execution and the menu appear on hover. Hiding the
 * threads is a quiet escape hatch in the menu, not a chevron on every row.
 */
export function AgentRailRow({ workspace, onOpenSettings, onCreateExecution, onOpenLauncher }: AgentRailRowProps) {
  const { streamingSessionIds, pendingInputSessionIds, activeView, activeSessionId, activeExecutionId, openAgent } =
    useDashboard();
  const { opensView } = useAgentViewMode();
  const { data: rail } = useRailSessions();
  const updateWs = useUpdateWorkspace();
  const isActive = activeView.kind === 'agent' && activeView.id === workspace.id;
  const expanded = !workspace.collapsed;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: workspace.id });

  const mainChat = rail?.mainChats?.find((c) => c.workspaceId === workspace.id) ?? null;
  const presence: MainChatActivity = !mainChat
    ? null
    : pendingInputSessionIds.has(mainChat.id)
      ? 'waiting'
      : streamingSessionIds.has(mainChat.id)
        ? 'thinking'
        : isSessionUnread(mainChat)
          ? 'replied'
          : null;

  const { threads, hidden, summary } = useMemo(() => {
    const sessions = sortSessionsHotnessDesc(
      (rail?.sessions ?? []).filter((s) => s.workspaceId === workspace.id && s.status === 'active'),
    );
    let working = 0;
    let needsYou = 0;
    for (const s of sessions) {
      // Same buckets as the rail's status view: pending wins over streaming.
      if (pendingInputSessionIds.has(s.id)) needsYou++;
      else if (streamingSessionIds.has(s.id)) working++;
      else if (isSessionUnread(s)) needsYou++;
    }
    const { shown, hidden: rest } = pickRailThreads(
      sessions,
      (s) =>
        pendingInputSessionIds.has(s.id) ||
        streamingSessionIds.has(s.id) ||
        isSessionUnread(s) ||
        !!s.execution?.pinnedAt ||
        activeSessionId === s.id ||
        (!!s.executionId && activeExecutionId === s.executionId),
    );
    return {
      threads: shown,
      hidden: rest,
      summary: agentSummary({ mainChat: presence, needsYou, working, total: sessions.length, purpose: workspace.purpose }),
    };
  }, [
    rail?.sessions,
    workspace.id,
    workspace.purpose,
    streamingSessionIds,
    pendingInputSessionIds,
    activeSessionId,
    activeExecutionId,
    presence,
  ]);

  const toggleThreads = () => updateWs.mutate({ id: workspace.id, collapsed: expanded });
  const open = () => (opensView ? openAgent(workspace.id) : toggleThreads());

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-60')}
    >
      <div
        {...attributes}
        {...listeners}
        className={cn(
          'group relative flex items-center gap-2 px-1.5 py-1.5 rounded-lg transition-colors cursor-grab active:cursor-grabbing select-none touch-none',
          isActive ? 'bg-secondary' : 'hover:bg-muted/40',
        )}
      >
        <button
          onClick={open}
          className="relative flex-shrink-0 rounded-md"
          aria-label={`Open ${workspace.name}`}
          title={presence ? `${workspace.name}: ${PRESENCE[presence].label}` : `Open ${workspace.name}`}
        >
          <AgentIcon workspace={workspace} size="md" />
          {presence && (
            <span
              aria-hidden
              className={cn(
                'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-background',
                PRESENCE[presence].dot,
              )}
            />
          )}
        </button>
        <button onClick={open} className="flex-1 min-w-0 text-left" title={opensView ? `Open ${workspace.name}` : undefined}>
          <span className="block truncate text-[12.5px] font-semibold leading-tight text-foreground">{workspace.name}</span>
          <span className="mt-0.5 block truncate text-[10.5px] leading-tight">
            {summary.map((segment, i) => (
              <span key={segment.text}>
                {i > 0 && <span className="text-muted-foreground/40"> · </span>}
                <span className={TONE[segment.tone]}>{segment.text}</span>
              </span>
            ))}
          </span>
        </button>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (e.shiftKey) onCreateExecution(workspace.id);
              else onOpenLauncher(workspace.id);
            }}
            className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
            aria-label="New execution"
            title="New execution (shift-click to start one right away on the last settings)"
          >
            <Plus size={13} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                aria-label={`${workspace.name} actions`}
                className={cn(
                  'p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-opacity',
                  // Opacity, not display:none, so Radix can anchor the menu to a real rect.
                  'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto',
                  'data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto',
                )}
              >
                <MoreHorizontal size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="text-[11px] min-w-[180px]"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem onSelect={() => onOpenLauncher(workspace.id)}>
                <Plus size={12} /> New execution
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggleThreads}>
                {expanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
                {expanded ? 'Hide executions in the rail' : 'Show executions in the rail'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onOpenSettings(workspace.id)}>
                <SlidersHorizontal size={12} /> Agent setup
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Threads hang off the icon: the guide sits under its center. */}
      {expanded && threads.length > 0 && (
        <div className="ml-5 mt-0.5 mb-1.5 border-l border-border/70 pl-1 space-y-px">
          {threads.map((s) => (
            <SessionRow key={s.id} session={s} density="compact" workspaceIsGit={workspace.isGit} />
          ))}
          {hidden > 0 && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => openAgent(workspace.id, 'overview')}
              className="w-full rounded-md py-[3px] pl-6 text-left text-[10px] text-muted-foreground/60 hover:bg-muted/40 hover:text-foreground transition-colors"
              title={`See all of ${workspace.name}'s work`}
            >
              {hidden} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
