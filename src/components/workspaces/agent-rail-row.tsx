'use client';

import { useMemo } from 'react';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, MoreHorizontal, Plus, SlidersHorizontal } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions, useUpdateWorkspace } from '@/hooks/use-workspaces';
import { useAgentViewMode } from '@/lib/client/agent-view-mode';
import { isSessionUnread, sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import {
  agentVoice,
  mainChatActivity,
  pickRailThreads,
  threadSummary,
  type AgentActivity,
  type VoiceTone,
} from '@/lib/utils/agent-rail';
import { AgentIcon } from '@/components/agents/agent-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { WorkspaceWithCounts } from '@/db/types';
import { SessionRow } from './session-row';
import { FoldRow } from './fold-row';
import { InactiveFold } from './inactive-fold';
import { useInactivity } from '@/hooks/use-inactivity';
import { useFoldShown } from '@/lib/client/rail-fold';

interface AgentRailRowProps {
  workspace: WorkspaceWithCounts;
  /** Open the agent's setup (its view, on the Setup tab). */
  onOpenSettings: (id: string) => void;
  /** Express lane: start right away on remembered settings (shift-click). */
  onCreateExecution: (id: string) => void;
  /** Open the launcher seeded with this agent. */
  onOpenLauncher: (id: string) => void;
}

const VOICE_TONE: Record<VoiceTone, string> = {
  attention: 'text-amber-600 dark:text-amber-400',
  working: 'text-emerald-600 dark:text-emerald-400',
  strong: 'text-foreground/90',
  muted: 'text-muted-foreground/65',
};

const SUMMARY_TONE = {
  attention: 'text-amber-600 dark:text-amber-400',
  working: 'text-emerald-600 dark:text-emerald-400',
  muted: 'text-muted-foreground/65',
} as const;

/** The fold toggles under an agent match its 32px threads. */
const THREAD_FOLD_ROW = 'h-8 py-0 text-[10.5px]';

const PRESENCE: Record<Exclude<AgentActivity, null>, { dot: string; label: string }> = {
  waiting: { dot: 'bg-amber-500 animate-pulse', label: 'Waiting on you' },
  thinking: { dot: 'bg-emerald-500 animate-pulse', label: 'Thinking' },
  replied: { dot: 'bg-amber-500', label: 'New reply' },
};

/**
 * One agent in the agents-first rail (docs/rail-agents-first.md).
 *
 * The row is the agent itself, which is its main chat: clicking opens it.
 * So the row carries only the agent's own state. A dot on its icon (thinking,
 * waiting on you, a new reply), its name in bold when it wants you, and a
 * second line in its voice: the question it's waiting on, "Thinking…", its
 * reply, or what it last said. Executions carry their own state on their own
 * rows, so nothing here is counted twice.
 *
 * Its executions sit under it on one 32px line each, inset so their dots sit
 * under its icon: every live one and the three most recent quiet ones, with
 * "N more hidden · Show" to show the rest in place (remembered per agent).
 * Hiding them is one click on hover, and hidden executions fold into a line
 * that still says what wants you, so hiding never hides that. The whole row
 * drags.
 *
 * Inactive executions (src/lib/sessions/inactive.ts), pinned ones included,
 * leave the threads for an "N inactive hidden · Show" toggle at the foot, and
 * the counts leave them out. Only the execution open right now stays.
 */
export function AgentRailRow({ workspace, onOpenSettings, onCreateExecution, onOpenLauncher }: AgentRailRowProps) {
  const { streamingSessionIds, pendingInputSessionIds, activeView, activeSessionId, activeExecutionId, openAgent } =
    useDashboard();
  const { opensView } = useAgentViewMode();
  const { data: rail } = useRailSessions();
  const updateWs = useUpdateWorkspace();
  const { isInactive } = useInactivity();
  const [showAll, setShowAll] = useFoldShown(`more:agent:${workspace.id}`);
  const isActive = activeView.kind === 'agent' && activeView.id === workspace.id;
  const expanded = !workspace.collapsed;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: workspace.id });

  const chat = rail?.mainChats?.find((c) => c.workspaceId === workspace.id) ?? null;
  const activity = mainChatActivity(chat, pendingInputSessionIds, streamingSessionIds);
  const wantsYou = activity === 'waiting' || activity === 'replied';
  const voice = agentVoice({
    activity,
    waitingOn: chat?.waitingOn ?? null,
    preview: chat?.preview ?? null,
    purpose: workspace.purpose,
  });

  const { sessions, inactive, total, capped, summary } = useMemo(() => {
    const all = sortSessionsHotnessDesc(
      (rail?.sessions ?? []).filter((s) => s.workspaceId === workspace.id && s.status === 'active'),
    );
    const isOpen = (s: (typeof all)[number]) =>
      activeSessionId === s.id || (!!s.executionId && activeExecutionId === s.executionId);
    // Inactive work folds away, pins included. The one open right now stays.
    const kept: typeof all = [];
    const folded: typeof all = [];
    for (const s of all) (isInactive(s) && !isOpen(s) ? folded : kept).push(s);
    let working = 0;
    let needsYou = 0;
    for (const s of kept) {
      if (isInactive(s)) continue;
      // The rail's buckets: pending wins over streaming, unread needs you too.
      if (pendingInputSessionIds.has(s.id)) needsYou++;
      else if (streamingSessionIds.has(s.id)) working++;
      else if (isSessionUnread(s)) needsYou++;
    }
    return {
      sessions: kept,
      inactive: folded,
      total: all.length,
      capped: pickRailThreads(
        kept,
        (s) =>
          pendingInputSessionIds.has(s.id) ||
          streamingSessionIds.has(s.id) ||
          isSessionUnread(s) ||
          !!s.execution?.pinnedAt ||
          isOpen(s),
      ),
      summary: threadSummary({ total: all.length, needsYou, working }),
    };
  }, [
    rail?.sessions,
    workspace.id,
    streamingSessionIds,
    pendingInputSessionIds,
    activeSessionId,
    activeExecutionId,
    isInactive,
  ]);

  const threads = showAll ? sessions : capped.shown;
  const hasThreads = total > 0;
  const toggleThreads = () => updateWs.mutate({ id: workspace.id, collapsed: expanded });
  const open = () => (opensView ? openAgent(workspace.id) : toggleThreads());
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

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
          aria-label={activity ? `${workspace.name}: ${PRESENCE[activity].label}` : `Open ${workspace.name}`}
          title={activity ? PRESENCE[activity].label : `Open ${workspace.name}`}
        >
          <AgentIcon workspace={workspace} size="md" />
          {activity && (
            <span
              aria-hidden
              className={cn(
                'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-background',
                PRESENCE[activity].dot,
              )}
            />
          )}
        </button>
        <button onClick={open} className="flex-1 min-w-0 text-left" title={`${workspace.name}: ${voice.text}`}>
          <span
            className={cn(
              'block truncate text-[12.5px] leading-tight',
              wantsYou ? 'font-semibold text-foreground' : 'font-medium text-foreground/85',
            )}
          >
            {workspace.name}
          </span>
          <span className={cn('mt-0.5 block truncate text-[10.5px] leading-tight', VOICE_TONE[voice.tone])}>
            {voice.text}
          </span>
        </button>

        {/* Takes no room until you hover, so at rest the name and its line
            get the full width. Stays while its menu is open. */}
        <div className="hidden group-hover:flex has-[[data-state=open]]:flex items-center gap-0.5 flex-shrink-0">
          {hasThreads && (
            <button
              onPointerDown={stop}
              onClick={(e) => {
                e.stopPropagation();
                toggleThreads();
              }}
              className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/50"
              aria-label={expanded ? 'Hide executions' : 'Show executions'}
              title={expanded ? 'Hide executions' : 'Show executions'}
            >
              {expanded ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
            </button>
          )}
          <button
            onPointerDown={stop}
            onClick={(e) => {
              e.stopPropagation();
              if (e.shiftKey) onCreateExecution(workspace.id);
              else onOpenLauncher(workspace.id);
            }}
            className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/50"
            aria-label="New execution"
            title="New execution (shift-click to start one right away on the last settings)"
          >
            <Plus size={13} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onPointerDown={stop}
                onClick={stop}
                aria-label={`${workspace.name} actions`}
                className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/50"
              >
                <MoreHorizontal size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-[11px] min-w-[170px]" onPointerDown={stop} onClick={stop}>
              <DropdownMenuItem onSelect={() => onOpenLauncher(workspace.id)}>
                <Plus size={12} /> New execution
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onOpenSettings(workspace.id)}>
                <SlidersHorizontal size={12} /> Agent setup
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {hasThreads && expanded && (
        // Inset a little, no guide line: each dot sits under the agent's icon,
        // and size and weight carry the rest of the hierarchy.
        <div className="mt-0.5 mb-1.5 space-y-px">
          {threads.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              density="compact"
              workspaceIsGit={workspace.isGit}
              inactive={isInactive(s)}
            />
          ))}
          {/* Both folds are thread-height and indent to the thread labels. */}
          {capped.hidden > 0 && (
            <FoldRow
              count={capped.hidden}
              noun="more"
              shown={showAll}
              onToggle={() => setShowAll(!showAll)}
              className="pl-[28px]"
              rowClassName={THREAD_FOLD_ROW}
            />
          )}
          <InactiveFold sectionId={`agent:${workspace.id}`} count={inactive.length} className="pl-[28px]" rowClassName={THREAD_FOLD_ROW}>
            {inactive.map((s) => (
              <SessionRow key={s.id} session={s} density="compact" workspaceIsGit={workspace.isGit} inactive />
            ))}
          </InactiveFold>
        </div>
      )}

      {hasThreads && !expanded && (
        <button
          onPointerDown={stop}
          onClick={toggleThreads}
          className="mb-1.5 flex h-8 w-full items-center gap-1.5 rounded-md pl-4 pr-1.5 text-left text-[10.5px] hover:bg-muted/40 transition-colors"
          aria-label={`Show ${workspace.name}'s executions`}
          title="Show executions"
        >
          <ChevronRight size={11} className="flex-shrink-0 text-muted-foreground/60" />
          <span className="min-w-0 truncate">
            {summary.map((segment, i) => (
              <span key={segment.text}>
                {i > 0 && <span className="text-muted-foreground/40"> · </span>}
                <span className={SUMMARY_TONE[segment.tone]}>{segment.text}</span>
              </span>
            ))}
          </span>
        </button>
      )}
    </div>
  );
}
