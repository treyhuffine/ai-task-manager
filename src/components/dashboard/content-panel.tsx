"use client";

import {
  Layers, ChevronDown,
  Send, Users, Gavel, Calendar,
  Mic, Square, MessageSquare,
  Zap, Radar, Shuffle, Clock, AlertCircle, Battery, Trophy, TrendingDown, MoreHorizontal,
} from 'lucide-react';
import { useState, useCallback, Fragment, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import type { PanelId, PanelTab, MorePanelTab } from '@/types/dashboard';
import { TaskList } from '@/components/tasks/task-list';
import { NoteList } from '@/components/notes/note-list';
import { StreamList } from '@/components/stream/stream-list';
import { DeckContainer } from '@/components/deck/deck-container';
import { usePendingStreamCount } from '@/hooks/use-stream';
import { AreasSheet } from '@/components/dashboard/areas-sheet';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';

// ─── Tab definitions ───────────────────────────────────────────

const CORE_TABS: { id: PanelTab; label: string }[] = [
  { id: 'deck', label: 'Deck' },
  { id: 'chat', label: 'Chat' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'stream', label: 'Stream' },
  { id: 'notes', label: 'Notes' },
];

const MORE_TABS: { id: MorePanelTab; label: string; icon: typeof Users }[] = [
  { id: 'areas', label: 'Areas', icon: Layers },
  { id: 'people', label: 'Contacts', icon: Users },
  { id: 'decisions', label: 'Decisions', icon: Gavel },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
];

const MORE_TAB_IDS = new Set<string>(MORE_TABS.map(t => t.id));

// ─── Tab content components ────────────────────────────────────

const QUICK_ACTIONS = [
  { label: "What's next?", icon: Zap, message: "What's next?" },
  { label: "What's on my radar?", icon: Radar, message: "What's on my radar?" },
] as const;

const MORE_QUICK_ACTIONS = [
  { label: 'Reshuffle my deck', icon: Shuffle, message: 'Reshuffle my deck' },
  { label: 'I have 15 minutes', icon: Clock, message: 'I have 15 minutes' },
  { label: 'I have 30 minutes', icon: Clock, message: 'I have 30 minutes' },
  { label: 'I have 60 minutes', icon: Clock, message: 'I have 60 minutes' },
  { label: "I'm stuck", icon: AlertCircle, message: "I'm stuck" },
  { label: "I'm low energy", icon: Battery, message: "I'm low energy" },
  { label: 'What did I accomplish today?', icon: Trophy, message: 'What did I accomplish today?' },
  { label: "What's falling behind?", icon: TrendingDown, message: "What's falling behind?" },
] as const;

function ChatContent() {
  const { theme } = useDashboard();
  const isDark = theme === 'dark';
  const [input, setInput] = useState('');
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const moreActionsRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, stop } = useChat();
  const isStreaming = status === 'streaming';

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput('');
  }, [input, sendMessage]);

  const handleQuickAction = useCallback((message: string) => {
    sendMessage({ text: message });
    setMoreActionsOpen(false);
  }, [sendMessage]);

  // Close more actions on outside click
  useEffect(() => {
    if (!moreActionsOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (moreActionsRef.current && !moreActionsRef.current.contains(e.target as Node)) {
        setMoreActionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreActionsOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        stop();
      } else if (input.trim()) {
        handleSubmit(e);
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <MessageSquare size={24} className="opacity-30" />
            <p className="text-[11px]">Start a conversation with Eon</p>
          </div>
        ) : (
          <Conversation className="h-full">
            <ConversationContent className="gap-4">
              {messages.map((message) => (
                <Fragment key={message.id}>
                  {message.parts.map((part, i) => {
                    if (part.type === 'text') {
                      return (
                        <Message from={message.role} key={`${message.id}-${i}`}>
                          <MessageContent>
                            <MessageResponse>{part.text}</MessageResponse>
                          </MessageContent>
                        </Message>
                      );
                    }
                    return null;
                  })}
                </Fragment>
              ))}
              {isStreaming && messages.at(-1)?.role !== 'assistant' && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="text-[11px]">Eon is thinking...</span>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        )}
      </div>

      {/* Quick actions + Input */}
      <div className="flex-shrink-0 p-3 border-t border-border space-y-2">
        {/* Quick action buttons */}
        <div className="flex items-center gap-1.5">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => handleQuickAction(action.message)}
              disabled={isStreaming}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all border',
                isStreaming
                  ? 'opacity-50 cursor-not-allowed border-border text-muted-foreground'
                  : 'border-border hover:border-primary/30 hover:bg-primary/5 text-muted-foreground hover:text-foreground'
              )}
            >
              <action.icon size={12} />
              {action.label}
            </button>
          ))}

          {/* More actions */}
          <div className="relative" ref={moreActionsRef}>
            <button
              onClick={() => setMoreActionsOpen(!moreActionsOpen)}
              disabled={isStreaming}
              className={cn(
                'flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all border',
                moreActionsOpen
                  ? 'border-primary/30 bg-primary/5 text-foreground'
                  : isStreaming
                    ? 'opacity-50 cursor-not-allowed border-border text-muted-foreground'
                    : 'border-border hover:border-primary/30 hover:bg-primary/5 text-muted-foreground hover:text-foreground'
              )}
            >
              <MoreHorizontal size={12} />
              More
            </button>

            {moreActionsOpen && (
              <div className={cn(
                'absolute left-0 bottom-full mb-1 w-56 rounded-lg border border-border shadow-xl z-50 py-1',
                isDark ? 'bg-card' : 'bg-background'
              )}>
                {MORE_QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => handleQuickAction(action.message)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
                  >
                    <action.icon size={13} />
                    <span className="font-medium">{action.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <form onSubmit={handleSubmit} className="relative group">
          <div className="absolute -inset-0.5 bg-primary/15 rounded-xl blur-lg opacity-0 group-focus-within:opacity-100 transition-opacity" />
          <div className="relative bg-card border border-border rounded-xl p-1 flex items-center gap-2 focus-within:border-primary/30 transition-all">
            <button
              type="button"
              className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center text-primary-foreground shadow-sm hover:opacity-90 active:scale-95 transition-all"
            >
              <Mic size={16} />
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tell Eon what's next..."
              className="flex-1 bg-transparent border-none outline-none text-sm py-2 placeholder:text-muted-foreground"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={stop}
                className="w-9 h-9 rounded-lg flex items-center justify-center bg-destructive text-destructive-foreground transition-all active:scale-95"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className={cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                  input.trim()
                    ? 'bg-primary text-primary-foreground active:scale-95'
                    : isDark ? 'bg-secondary text-muted-foreground' : 'bg-muted text-muted-foreground'
                )}
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </form>
      </div>
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
}

export function ContentPanel({ panelId }: ContentPanelProps) {
  const {
    panelATab, panelBTab, focusedPanel,
    setPanelTab, setFocusedPanel, theme,
  } = useDashboard();
  const isDark = theme === 'dark';

  const activeTab = panelId === 'a' ? panelATab : panelBTab;
  const isFocused = focusedPanel === panelId;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const isMoreTab = MORE_TAB_IDS.has(activeTab);
  const pendingStreamCount = usePendingStreamCount();
  const [areasSheetOpen, setAreasSheetOpen] = useState(false);

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
      className="flex flex-col h-full bg-background"
      onMouseDown={() => setFocusedPanel(panelId)}
    >
      {/* Tab bar */}
      <div className={cn(
        'flex items-center border-b border-border flex-shrink-0',
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
            {tab.id === 'stream' && pendingStreamCount >= 3 && (
              <span className="ml-1.5 text-[8.5px] text-muted-foreground/60 font-mono">
                {pendingStreamCount}
              </span>
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
                      setAreasSheetOpen(true);
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

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'deck' && <DeckContainer />}
        {activeTab === 'chat' && <ChatContent />}
        {activeTab === 'tasks' && <TaskList />}
        {activeTab === 'stream' && <StreamList />}
        {activeTab === 'notes' && <NoteList />}
        {isMoreTab && <MoreTabContent tab={activeTab as MorePanelTab} />}
      </div>

      <AreasSheet open={areasSheetOpen} onOpenChange={setAreasSheetOpen} />
    </div>
  );
}
