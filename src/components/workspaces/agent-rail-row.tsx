'use client';

import { useMemo, useRef } from 'react';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Eye, EyeOff, MoreHorizontal, Plus, SlidersHorizontal } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDashboard } from '@/contexts/dashboard-context';
import { useMarkSessionRead, useMarkSessionUnread, useRailSessions, useUpdateWorkspace } from '@/hooks/use-workspaces';
import { useAgentViewMode } from '@/lib/client/agent-view-mode';
import { useRailStyle } from '@/lib/client/rail-style';
import { isSessionUnread, sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import {
  agentVoice,
  mainChatActivity,
  threadSummary,
  type AgentActivity,
  type VoiceTone,
} from '@/lib/utils/agent-rail';
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
import { InactiveFold } from './inactive-fold';
import { useInactivity } from '@/hooks/use-inactivity';
import { useOpenChatAgentId } from '@/hooks/use-open-chat-agent';
import { Tip } from '@/components/ui/tip';
import { AgentChatsFlyout } from './agent-chats-flyout';
import { useWorkspaceSelection } from './workspace-selection-context';

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

/** The inactive toggle under an agent matches its 32px threads. */
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
 * reply, or what it last said (its purpose until it has spoken, and no line
 * at all when it has neither). Executions carry their own state on their own
 * rows, so nothing here is counted twice.
 *
 * Its executions sit under it on one 32px line each, inset so their dots sit
 * under its icon: every one with activity in the last week (the inactive
 * threshold, src/lib/sessions/inactive.ts), however many. Inactive ones,
 * pinned included, fold behind "N inactive hidden" · Show, the same toggle as
 * every other list, and the counts leave them out. The execution open right
 * now always stays. That is the only rule for what hides: no cap on how many
 * recent ones show. Hiding the executions is one click on hover, and hidden
 * executions fold into a line that still says what wants you, so hiding
 * never hides that. The whole row drags.
 *
 * In the agents-only rail (`agentsOnly`) the executions have no rows. The
 * agent's dot, bold name and line stay its own (its main chat), and its
 * chats get counts at the row's end instead: amber for the ones that need
 * you (waiting on you or unread, pulsing while one is blocked), green for the
 * ones working. The header counts every chat, these say which agent's. They
 * give way to the actions on hover, and open no tooltip. Inactive chats don't
 * count. Resting on the agent peeks at the chats themselves.
 *
 * The agent you're in is marked: selected, as when its own page is open,
 * while one of its chats is on screen and that chat's row isn't showing (it
 * never does in agents only, nor while its chats are hidden or the chat is
 * archived). Its open buttons say so with `aria-current`, `page` for its own
 * page and `true` for one of its chats. Where the chat's row shows, that row
 * is the selection, so two rows never look selected at once.
 *
 * Its menu marks the agent read or unread, which is its main chat's read
 * state, so an agent you've opened can be put back to come back to.
 *
 * The agent itself opens no tooltip on hover: one on every agent the pointer
 * crosses was distracting. The icon's label still says its presence to a
 * screen reader. The hover actions keep theirs.
 */
export function AgentRailRow({ workspace, onOpenSettings, onCreateExecution, onOpenLauncher }: AgentRailRowProps) {
  const { streamingSessionIds, pendingInputSessionIds, activeView, activeSessionId, activeExecutionId, openAgent } =
    useDashboard();
  const { opensView } = useAgentViewMode();
  const agentsOnly = useRailStyle().style === 'agentsOnly';
  const { data: rail } = useRailSessions();
  const updateWs = useUpdateWorkspace();
  const markRead = useMarkSessionRead();
  const markUnread = useMarkSessionUnread();
  const { isInactive } = useInactivity();
  const isActive = activeView.kind === 'agent' && activeView.id === workspace.id;
  // Agents only: there's no list to fold, so the agent never shows one.
  const expanded = !agentsOnly && !workspace.collapsed;
  const header = useRef<HTMLDivElement>(null);
  const selecting = useWorkspaceSelection()?.selecting ?? false;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: workspace.id });

  const chat = rail?.mainChats?.find((c) => c.workspaceId === workspace.id) ?? null;
  const activity = mainChatActivity(chat, pendingInputSessionIds, streamingSessionIds);
  const wantsYou = activity === 'waiting' || activity === 'replied';
  const unread = !!chat && isSessionUnread(chat);
  const voice = agentVoice({
    activity,
    waitingOn: chat?.waitingOn ?? null,
    preview: chat?.preview ?? null,
    purpose: workspace.purpose,
  });

  const { sessions, inactive, total, summary, listsOpen, counts } = useMemo(() => {
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
    let blocked = 0;
    for (const s of kept) {
      if (isInactive(s)) continue;
      // The rail's buckets: pending wins over streaming, unread needs you too.
      if (pendingInputSessionIds.has(s.id)) {
        needsYou++;
        blocked++;
      } else if (streamingSessionIds.has(s.id)) working++;
      else if (isSessionUnread(s)) needsYou++;
    }
    return {
      sessions: kept,
      inactive: folded,
      total: all.length,
      summary: threadSummary({ total: all.length, needsYou, working }),
      listsOpen: all.some(isOpen),
      counts: { needsYou, working, blocked },
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

  const hasThreads = total > 0;
  // Which agent you're in: its own page, or one of its chats with no row
  // showing (always so in agents only, and while its chats are hidden).
  const holdsOpenChat = useOpenChatAgentId() === workspace.id;
  const current = isActive ? 'page' : holdsOpenChat && !(expanded && listsOpen) ? 'true' : undefined;
  const toggleThreads = () => updateWs.mutate({ id: workspace.id, collapsed: expanded });
  // With no list to fold, the agent always opens.
  const open = () => (opensView || agentsOnly ? openAgent(workspace.id) : toggleThreads());
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  const threads = (
    <div className="space-y-px">
      {sessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          density="compact"
          workspaceIsGit={workspace.isGit}
          onOpenWorkspaceSettings={onOpenSettings}
          onOpenLauncher={onOpenLauncher}
          inactive={isInactive(s)}
        />
      ))}
      <InactiveFold
        sectionId={`agent:${workspace.id}`}
        count={inactive.length}
        className="pl-[28px]"
        rowClassName={THREAD_FOLD_ROW}
      >
        {inactive.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            density="compact"
            workspaceIsGit={workspace.isGit}
            onOpenWorkspaceSettings={onOpenSettings}
            onOpenLauncher={onOpenLauncher}
            inactive
          />
        ))}
      </InactiveFold>
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      data-agent-id={workspace.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-60')}
    >
      <div
        ref={header}
        {...attributes}
        {...listeners}
        className={cn(
          'group relative flex items-center gap-2 px-1.5 py-1.5 rounded-lg transition-colors cursor-grab active:cursor-grabbing select-none touch-none',
          // One look for both: the page says whether it's the agent or its chat.
          current ? 'bg-secondary' : 'hover:bg-muted/40',
        )}
      >
        <button
          onClick={open}
          className="relative flex-shrink-0 rounded-md"
          aria-label={activity ? `${workspace.name}: ${PRESENCE[activity].label}` : `Open ${workspace.name}`}
          aria-current={current}
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
        <AgentChatsFlyout
          name={workspace.name}
          enabled={hasThreads && !expanded && !isDragging && !selecting}
          hoverTarget={header}
          onClick={open}
          onNewChat={() => onOpenLauncher(workspace.id)}
          trigger={({ ref, onClick }) => (
            <button
              ref={ref}
              onClick={onClick}
              className="flex-1 min-w-0 text-left"
              aria-current={current}
            >
              <span
                className={cn(
                  'block truncate text-[12.5px] leading-tight',
                  wantsYou ? 'font-semibold text-foreground' : 'font-medium text-foreground/85',
                )}
              >
                {workspace.name}
              </span>
              {voice && (
                <span className={cn('mt-0.5 block truncate text-[10.5px] leading-tight', VOICE_TONE[voice.tone])}>
                  {voice.text}
                </span>
              )}
            </button>
          )}
        >
          {threads}
        </AgentChatsFlyout>

        {agentsOnly && <ChatCounts {...counts} />}

        {/* Takes no room until you hover, so at rest the name and its line
            get the full width. Stays while its menu is open. */}
        <div className="hidden group-hover:flex group-focus-within:flex has-[[data-state=open]]:flex items-center gap-0.5 flex-shrink-0">
          {hasThreads && !agentsOnly && (
            <Tip label={expanded ? 'Hide chats' : 'Show chats'}>
              <button
                onPointerDown={stop}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleThreads();
                }}
                className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/50"
                aria-label={expanded ? 'Hide chats' : 'Show chats'}
              >
                {expanded ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
              </button>
            </Tip>
          )}
          <Tip label="New chat (shift-click to start one right away on the last settings)">
            <button
              onPointerDown={stop}
              onClick={(e) => {
                e.stopPropagation();
                if (e.shiftKey) onCreateExecution(workspace.id);
                else onOpenLauncher(workspace.id);
              }}
              className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/50"
              aria-label="New chat"
            >
              <Plus size={13} />
            </button>
          </Tip>
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
              {chat && (
                <>
                  {unread ? (
                    <DropdownMenuItem onSelect={() => markRead.mutate(chat.id)}>
                      <Eye size={12} /> Mark as read
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => markUnread.mutate(chat.id)}>
                      <EyeOff size={12} /> Mark as unread
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onSelect={() => onOpenLauncher(workspace.id)}>
                <Plus size={12} /> New chat
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
          {threads}
        </div>
      )}

      {hasThreads && !expanded && !agentsOnly && (
        <Tip label="Show chats">
          <button
            onPointerDown={stop}
            onClick={toggleThreads}
            className="mb-1.5 flex h-8 w-full items-center gap-1.5 rounded-md pl-4 pr-1.5 text-left text-[10.5px] hover:bg-muted/40 transition-colors"
            aria-label={`Show ${workspace.name}'s chats`}
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
        </Tip>
      )}
    </div>
  );
}

/**
 * The agents-only row's end: how many of the agent's chats need you (amber,
 * pulsing while one is blocked on you) and how many are working (green), in
 * the header's colors. Nothing when neither. Gives way to the row's actions
 * on hover, focus or an open menu, the way a chat row's time does.
 */
function ChatCounts({ needsYou, working, blocked }: { needsYou: number; working: number; blocked: number }) {
  if (needsYou === 0 && working === 0) return null;
  const said = [
    needsYou > 0 && `${needsYou} chat${needsYou === 1 ? '' : 's'} need${needsYou === 1 ? 's' : ''} you`,
    working > 0 && `${working} working`,
  ].filter(Boolean).join(', ');
  return (
    <span className="flex flex-shrink-0 items-center gap-1 group-hover:hidden group-focus-within:hidden group-has-[[data-state=open]]:hidden">
      <span className="sr-only">{said}</span>
      {needsYou > 0 && (
        <span
          aria-hidden
          data-count="needs-you"
          className={cn(COUNT, 'bg-amber-500/15 text-amber-600 dark:text-amber-400', blocked > 0 && 'animate-pulse')}
        >
          {needsYou}
        </span>
      )}
      {working > 0 && (
        <span aria-hidden data-count="working" className={cn(COUNT, 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400')}>
          {working}
        </span>
      )}
    </span>
  );
}

const COUNT = 'min-w-[18px] h-[16px] rounded-full px-1 text-center text-[10px] font-semibold leading-[16px] tabular-nums';
