"use client";

import {
  Layers, ChevronDown, Users, Gavel, Loader2, Plus, SquareTerminal,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import type { PanelId, PanelTab, MorePanelTab } from '@/types/dashboard';
import { TaskSurface } from '@/components/tasks/task-surface';
import { NoteList } from '@/components/notes/note-list';
import { StreamList } from '@/components/stream/stream-list';
import { DeckContainer } from '@/components/deck/deck-container';
import { useNeedsYourCall } from '@/hooks/use-stream';
import { useUserState, useOrchestratorName } from '@/hooks/use-user-state';
import { OrchestratorAvatar } from '@/components/shared/orchestrator-mark';
import { HarnessChat } from '@/components/chat/harness-chat';
import { appMainChatIntro } from '@/components/chat/main-chat-intro';
import { useNewOrchestratorChat } from '@/hooks/use-orchestrator-chat';
import { MainChatHistoryMenu } from '@/components/chat/main-chat-history-menu';
import { MainChatOnboarding } from '@/components/chat/onboarding/main-chat-onboarding';
import { HomeTerminal } from '@/components/dashboard/home-terminal';

// ─── Tab definitions ───────────────────────────────────────────

// Chat leads: it's the orchestrator, the front door to everything else. The
// home opens with it on the left and the deck on the right (dashboard-context
// DEFAULT_PANEL_*_TAB).
const CORE_TABS: { id: PanelTab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'deck', label: 'Deck' },
  { id: 'stream', label: 'Stream' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'notes', label: 'Notes' },
];

const MORE_TABS: { id: MorePanelTab; label: string; icon: typeof Users }[] = [
  { id: 'areas', label: 'Areas', icon: Layers },
  { id: 'people', label: 'Contacts', icon: Users },
  { id: 'decisions', label: 'Decisions', icon: Gavel },
  // Shells on the box the home runs on, opening in its home folder.
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
];

const MORE_TAB_IDS = new Set<string>(MORE_TABS.map(t => t.id));

// ─── Chat header ───────────────────────────────────────────────
//
// Who you're talking to, past chats, and New. The main chat acts through
// MCP only: the Skills / MCP switch that sat here was retired on 2026-10-05.

function ChatHeaderBar({
  name,
  onNewChat,
  newChatPending,
}: {
  name: string;
  onNewChat: () => void;
  newChatPending: boolean;
}) {
  return (
    <div className="shrink-0 flex items-center justify-end gap-1.5 px-2 py-1 border-b border-border/50">
      {/* Who you're talking to, the same name the rail's home row shows. */}
      <span className="mr-auto flex min-w-0 items-center gap-1.5 pl-0.5">
        <OrchestratorAvatar size="xs" />
        <span className="truncate text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          {name}
        </span>
      </span>
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
  const newChat = useNewOrchestratorChat();
  const name = useOrchestratorName();
  // The first-run conversation, for a home that hasn't had it. Latched for
  // this mount, so finishing it (which records `orchestratorIntroducedAt`)
  // leaves the conversation and its starters up until the chat is used.
  // Skipping drops it at once.
  const [onboarding, setOnboarding] = useState(false);
  const [onboardingDecided, setOnboardingDecided] = useState(false);
  if (userState && !onboardingDecided) {
    setOnboardingDecided(true);
    setOnboarding(!userState.orchestratorIntroducedAt);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <ChatHeaderBar name={name} onNewChat={() => newChat.mutate()} newChatPending={newChat.isPending} />
      <HarnessChat
        isMobile={isMobile}
        intro={appMainChatIntro(name)}
        emptyState={onboarding ? <MainChatOnboarding onSkip={() => setOnboarding(false)} /> : undefined}
      />
    </div>
  );
}

function MoreTabContent({ tab }: { tab: MorePanelTab }) {
  if (tab === 'terminal') return <HomeTerminal />;
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
        {isMoreTab && <MoreTabContent tab={activeTab as MorePanelTab} />}
      </div>

    </div>
  );
}
