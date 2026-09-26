"use client";

import {
  Layers, ChevronDown, Users, Gavel, Calendar, Loader2, Plus,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import type { PanelId, PanelTab, MorePanelTab } from '@/types/dashboard';
import { TaskSurface } from '@/components/tasks/task-surface';
import { NoteList } from '@/components/notes/note-list';
import { StreamList } from '@/components/stream/stream-list';
import { DeckContainer } from '@/components/deck/deck-container';
import { CalendarPanel } from '@/components/calendar/calendar-panel';
import { useNeedsYourCall } from '@/hooks/use-stream';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';
import { HarnessChat } from '@/components/chat/harness-chat';
import { useNewOrchestratorChat } from '@/hooks/use-orchestrator-chat';
import { resolveOrchestratorMode, type OrchestratorChatMode } from '@/lib/orchestrator/mode';
import { MainChatHistoryMenu } from '@/components/chat/main-chat-history-menu';

// ─── Tab definitions ───────────────────────────────────────────

const CORE_TABS: { id: PanelTab; label: string }[] = [
  { id: 'deck', label: 'Deck' },
  { id: 'chat', label: 'Chat' },
  { id: 'stream', label: 'Stream' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'notes', label: 'Notes' },
];

const MORE_TABS: { id: MorePanelTab; label: string; icon: typeof Users }[] = [
  { id: 'areas', label: 'Areas', icon: Layers },
  { id: 'people', label: 'Contacts', icon: Users },
  { id: 'decisions', label: 'Decisions', icon: Gavel },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
];

const MORE_TAB_IDS = new Set<string>(MORE_TABS.map(t => t.id));

// ─── Chat mode switcher ────────────────────────────────────────
//
// Two orchestrator surfaces behind one tab (user_state.orchestratorMode):
//   skills — harness session in the data root, actions via CLI/skills
//   mcp    — harness session with the orchestrator MCP attached
// Unset and the retired 'legacy' resolve to mcp, the same rule the server
// uses (lib/orchestrator/mode.ts). Switching starts a fresh session: the
// mode's CLI flags (MCP attachment, write guards) are read at process spawn.

const CHAT_MODES: { id: OrchestratorChatMode; label: string; title: string }[] = [
  { id: 'harness_skills', label: 'Skills', title: 'Harness session: actions via CLI + skills' },
  { id: 'harness_mcp', label: 'MCP', title: 'Harness session: actions via MCP tools' },
];

function ChatModeBar({
  mode,
  onSwitch,
  onNewChat,
  newChatPending,
}: {
  mode: OrchestratorChatMode;
  onSwitch: (mode: OrchestratorChatMode) => void;
  onNewChat: () => void;
  newChatPending: boolean;
}) {
  return (
    <div className="shrink-0 flex items-center justify-end gap-1.5 px-2 py-1 border-b border-border/50">
      <div className="flex items-center rounded-md border border-border overflow-hidden">
        {CHAT_MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => onSwitch(m.id)}
            title={m.title}
            className={cn(
              'px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.06em] transition-all',
              mode === m.id
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <MainChatHistoryMenu scope={null} />
      <button
        onClick={onNewChat}
        disabled={newChatPending}
        title="Start a new chat (archives the current one)"
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all disabled:opacity-50"
      >
        {newChatPending ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
        New
      </button>
    </div>
  );
}

function ChatContent({ isMobile }: { isMobile: boolean }) {
  const { data: userState } = useUserState();
  const updateUserState = useUpdateUserState();
  const newChat = useNewOrchestratorChat();
  const mode = resolveOrchestratorMode(userState?.orchestratorMode);

  const handleSwitch = (next: OrchestratorChatMode) => {
    if (next === mode) return;
    updateUserState.mutate({ orchestratorMode: next });
    // Harness flags are spawn-time, so a switch always cuts over to a fresh
    // session and the new mode's surface applies cleanly.
    newChat.mutate();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <ChatModeBar
        mode={mode}
        onSwitch={handleSwitch}
        onNewChat={() => newChat.mutate()}
        newChatPending={newChat.isPending}
      />
      {/* Key on mode so a switch fully remounts against the new session. */}
      <HarnessChat key={mode} isMobile={isMobile} />
    </div>
  );
}

function MoreTabContent({ tab }: { tab: MorePanelTab }) {
  const tabInfo = MORE_TABS.find(t => t.id === tab);
  if (!tabInfo) return null;
  const Icon = tabInfo.icon;

  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
      <Icon size={24} className="opacity-30" />
      <p className="text-[11px]">{tabInfo.label}</p>
      <p className="text-[9px] text-muted-foreground/60">Coming soon</p>
    </div>
  );
}

// ─── Main panel component ──────────────────────────────────────

interface ContentPanelProps {
  panelId: PanelId;
  /** When set, skip the tab bar and render only this content (used by mobile layout) */
  mobileTab?: 'chat' | 'deck' | 'tasks' | 'notes' | 'stream';
}

export function ContentPanel({ panelId, mobileTab }: ContentPanelProps) {
  const {
    panelATab, panelBTab,
    setPanelTab, setFocusedPanel, theme,
    openAreasList,
  } = useDashboard();
  const isDark = theme === 'dark';

  const activeTab = mobileTab ?? (panelId === 'a' ? panelATab : panelBTab);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const isMoreTab = MORE_TAB_IDS.has(activeTab);
  const needsYourCall = useNeedsYourCall();

  // Close dropdown on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreOpen]);

  return (
    <div
      className="flex flex-col h-full min-w-0 bg-background"
      onMouseDown={() => setFocusedPanel(panelId)}
    >
      {/* Tab bar — hidden on mobile when mobileTab is set */}
      {!mobileTab && (
        <div className={cn(
          'flex items-center border-b border-border shrink-0',
          isDark ? 'bg-card/30' : 'bg-muted/30'
        )}>
          {CORE_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setPanelTab(panelId, tab.id)}
              className={cn(
                'px-3 py-2.5 text-[9.5px] font-bold uppercase tracking-[0.08em] transition-all border-b-2',
                activeTab === tab.id && !isMoreTab
                  ? 'text-primary border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              )}
            >
              {tab.label}
              {tab.id === 'stream' && needsYourCall && (
                <span
                  className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-primary/70 align-middle"
                  aria-label="Something needs your call"
                />
              )}
            </button>
          ))}

          <div className="flex-1" />

          {/* More button */}
          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              className={cn(
                'px-3 py-2.5 text-[9.5px] font-bold uppercase tracking-[0.08em] transition-all border-b-2 flex items-center gap-1',
                isMoreTab
                  ? 'text-primary border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              )}
            >
              More
              <ChevronDown size={10} className={cn('transition-transform', moreOpen && 'rotate-180')} />
            </button>

            {moreOpen && (
              <div className={cn(
                'absolute right-0 top-full mt-1 w-52 rounded-lg border border-border shadow-xl z-50 py-1',
                isDark ? 'bg-card' : 'bg-background'
              )}>
                {MORE_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      if (tab.id === 'areas') {
                        openAreasList();
                      } else {
                        setPanelTab(panelId, tab.id);
                      }
                      setMoreOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 text-[11px] transition-all',
                      activeTab === tab.id
                        ? 'text-primary bg-primary/5'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    <tab.icon size={14} />
                    <span className="font-medium">{tab.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'deck' && <DeckContainer />}
        {activeTab === 'chat' && <ChatContent isMobile={!!mobileTab} />}
        {activeTab === 'tasks' && <TaskSurface />}
        {activeTab === 'stream' && <StreamList />}
        {activeTab === 'notes' && <NoteList />}
        {activeTab === 'calendar' && <CalendarPanel />}
        {isMoreTab && activeTab !== 'calendar' && <MoreTabContent tab={activeTab as MorePanelTab} />}
      </div>

    </div>
  );
}
