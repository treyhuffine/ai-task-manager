"use client";

import {
  Sparkles, Target, ChevronDown, ChevronRight, History,
  Send, Zap, Filter, ArrowDownAz, Users, Gavel, Calendar,
  Settings, Mic, Square, HelpCircle, MessageSquare,
  FileText, Plus, Clock, Loader2,
} from 'lucide-react';
import { useState, useCallback, Fragment, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useTasks } from '@/hooks/use-tasks';
import { useNotes } from '@/hooks/use-notes';
import { cn } from '@/lib/utils';
import type { PanelId, PanelTab, MorePanelTab } from '@/types/dashboard';
import type { TaskRecord, NoteRecord } from '@/db/types';
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
  { id: 'people', label: 'People & Contacts', icon: Users },
  { id: 'decisions', label: 'Decisions Log', icon: Gavel },
  { id: 'calendar', label: 'Calendar View', icon: Calendar },
  { id: 'integrations', label: 'Integration Center', icon: Sparkles },
  { id: 'settings', label: 'Conductor Settings', icon: Settings },
];

const MORE_TAB_IDS = new Set<string>(MORE_TABS.map(t => t.id));

// ─── Tab content components ────────────────────────────────────

function DeckContent() {
  const { theme, toggleFocusMode, tasks, workMode, setWorkMode, selectedProject } = useDashboard();
  const isDark = theme === 'dark';
  const focusTask = tasks[0];
  const remaining = tasks.slice(1);
  const [expandedRationale, setExpandedRationale] = useState<number | null>(null);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Conductor row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-0.5 bg-card rounded-lg border border-border">
            <button
              onClick={() => setWorkMode(workMode === 'light' ? null : 'light')}
              className={cn(
                'px-3 py-1 rounded text-[9px] font-bold transition-all',
                workMode === 'light'
                  ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >LIGHT</button>
            <button
              onClick={() => setWorkMode(workMode === 'deep' ? null : 'deep')}
              className={cn(
                'px-3 py-1 rounded text-[9px] font-bold transition-all',
                workMode === 'deep'
                  ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >DEEP</button>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-card border border-border rounded-lg cursor-pointer hover:border-muted-foreground transition-all">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">{selectedProject}</span>
            <ChevronDown size={10} className="text-muted-foreground" />
          </div>
        </div>
        <button className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-[10px] font-bold text-muted-foreground hover:text-foreground transition-all group">
          <History size={12} className="group-hover:rotate-[-45deg] transition-transform" />
          CATCH UP
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* #1 — Focus card with rationale */}
        <div className="p-5 rounded-2xl bg-card border border-border shadow-sm transition-all">
          <div className="flex items-start gap-4">
            <div className="w-2.5 h-2.5 rounded-full bg-orange-500 mt-1.5 shadow-[0_0_10px_rgba(249,115,22,0.4)]" />
            <div className="flex-1">
              <h2 className="text-xl font-medium tracking-tight text-foreground mb-1.5">
                {focusTask.text}
              </h2>
              <div className="flex items-center gap-3 text-[10.5px] font-bold text-muted-foreground">
                <span className="uppercase tracking-[0.1em]">{focusTask.project}</span>
                <span>{"\u00B7"}</span>
                <span>{focusTask.due}</span>
                {focusTask.status === 'ready' && (
                  <span className="text-orange-500/90 italic tracking-tight flex items-center gap-1">
                    <Sparkles size={10} /> Agent unblocked
                  </span>
                )}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">
                <span className="text-primary font-bold text-[9px] uppercase tracking-widest">Why this is #1</span>
                <br />
                Bounce agent just completed the onboarding component — reviewing now keeps the build moving. Blocking other tasks downstream.
              </p>
            </div>
          </div>
          <div className={cn(
            'mt-4 flex items-center gap-2 pt-4 border-t',
            isDark ? 'border-secondary' : 'border-muted'
          )}>
            <button className="px-4 py-2 bg-orange-500 text-white text-[11px] font-bold rounded-lg shadow-lg shadow-orange-500/20 hover:bg-orange-600 transition-all active:scale-95">
              Complete
            </button>
            <button className={cn(
              'px-4 py-2 text-[11px] font-bold rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all',
              isDark ? 'bg-secondary' : 'bg-muted'
            )}>
              Defer
            </button>
            <div className="flex-1" />
            <button
              onClick={toggleFocusMode}
              className="px-4 py-2 flex items-center gap-2 text-[11px] font-bold rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all"
            >
              <Target size={14} /> Focus Mode
            </button>
          </div>
        </div>

        {/* #2-N — Remaining sorted items */}
        <div className="space-y-0.5">
          <div className="px-2 mb-2 flex items-center justify-between">
            <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Up Next</span>
            <span className="text-[8.5px] font-bold text-muted-foreground">{remaining.length} MORE</span>
          </div>
          {remaining.map((task, i) => (
            <div key={task.id}>
              <div className="group flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-card transition-all cursor-pointer border border-transparent hover:border-border">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[10px] font-mono text-muted-foreground w-4 text-right">{i + 2}</span>
                  <div className={cn('w-1.5 h-1.5 rounded-full', task.color)} />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium leading-tight truncate">{task.text}</p>
                    <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">{task.project}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{task.due}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpandedRationale(expandedRationale === task.id ? null : task.id); }}
                    className="p-1 text-muted-foreground/50 hover:text-primary transition-colors"
                    title="Why this?"
                  >
                    <HelpCircle size={12} />
                  </button>
                </div>
              </div>
              {expandedRationale === task.id && (
                <div className="ml-10 mr-4 mb-2 px-3 py-2 rounded-lg bg-card border border-border text-[10.5px] text-muted-foreground leading-relaxed">
                  <span className="text-primary font-bold text-[8.5px] uppercase tracking-widest">Why this?</span>
                  <br />
                  Placed here based on project priority and deadline proximity. Tap to adjust.
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChatContent() {
  const { theme } = useDashboard();
  const isDark = theme === 'dark';
  const [input, setInput] = useState('');
  const { messages, sendMessage, status, stop } = useChat();
  const isStreaming = status === 'streaming';

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput('');
  }, [input, sendMessage]);

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

      {/* Input */}
      <div className="flex-shrink-0 p-3 border-t border-border">
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

const ENERGY_COLORS: Record<string, string> = {
  deep: 'bg-orange-500',
  light: 'bg-sky-400',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  done: 'Done',
  archived: 'Archived',
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 0 && days <= 7) return `In ${days}d`;
  if (days < 0 && days >= -7) return `${Math.abs(days)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function TasksContent() {
  const { theme } = useDashboard();
  const isDark = theme === 'dark';
  const { data: tasks, isLoading, error } = useTasks();

  return (
    <div className="flex flex-col h-full">
      <div className={cn(
        'px-3 py-2 border-b border-border flex items-center justify-between flex-shrink-0',
        isDark ? 'bg-card/50' : 'bg-muted'
      )}>
        <div className="flex gap-1">
          <button className="p-1.5 text-muted-foreground hover:text-foreground bg-card rounded border border-border">
            <Filter size={11} />
          </button>
          <button className="p-1.5 text-muted-foreground hover:text-foreground bg-card rounded border border-border">
            <ArrowDownAz size={11} />
          </button>
        </div>
        <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-widest">
          {tasks ? `${tasks.length} tasks` : 'Loading...'}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-32 text-destructive text-[11px]">
            Failed to load tasks
          </div>
        )}
        {tasks && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
            <Target size={20} className="opacity-30" />
            <p className="text-[11px]">No active tasks</p>
          </div>
        )}
        {tasks && tasks.length > 0 && (
          <div className="space-y-0.5">
            {tasks.map((task: TaskRecord) => {
              const deadline = formatDate(task.hard_deadline);
              const energyColor = task.energy ? ENERGY_COLORS[task.energy] : 'bg-muted-foreground';
              return (
                <div key={task.id} className="p-2.5 rounded-lg hover:bg-card cursor-pointer group flex items-start gap-2.5 border border-transparent hover:border-border transition-all">
                  <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 opacity-60', energyColor)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium leading-tight line-clamp-2">{task.title}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-tighter">
                        {STATUS_LABELS[task.status] ?? task.status}
                      </span>
                      {task.energy && (
                        <>
                          <span className="text-[8.5px] text-muted-foreground">{"\u00B7"}</span>
                          <span className="text-[8.5px] text-muted-foreground capitalize">{task.energy}</span>
                        </>
                      )}
                      {task.effort && (
                        <>
                          <span className="text-[8.5px] text-muted-foreground">{"\u00B7"}</span>
                          <span className="text-[8.5px] text-muted-foreground capitalize">{task.effort}</span>
                        </>
                      )}
                      {deadline && (
                        <>
                          <span className="text-[8.5px] text-muted-foreground">{"\u00B7"}</span>
                          <span className="text-[8.5px] text-muted-foreground flex items-center gap-0.5">
                            <Clock size={8} /> {deadline}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StreamContent() {
  const { streamEvents } = useDashboard();

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-5 relative px-2 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-border">
        {streamEvents.map((event, i) => (
          <div key={i} className="pl-6 relative">
            <div className={cn(
              'absolute left-[5px] top-1.5 w-2 h-2 rounded-full z-10 ring-2 ring-background opacity-60',
              event.color
            )} />
            <p className="text-[11.5px] text-muted-foreground leading-snug">{event.text}</p>
            <p className="text-[8.5px] text-muted-foreground font-mono mt-0.5 uppercase">{event.time}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotesContent() {
  const { data: notes, isLoading, error } = useNotes();

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-32 text-destructive text-[11px]">
            Failed to load notes
          </div>
        )}
        {notes && notes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
            <FileText size={20} className="opacity-30" />
            <p className="text-[11px]">No notes yet</p>
          </div>
        )}
        {notes && notes.length > 0 && (
          <div className="space-y-2">
            {notes.map((note: NoteRecord) => (
              <div key={note.id} className="p-3 rounded-lg bg-card border border-border hover:border-muted-foreground cursor-pointer transition-all">
                {note.title && (
                  <p className="text-[12px] font-medium leading-tight mb-1">{note.title}</p>
                )}
                <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">{note.body}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[8.5px] text-muted-foreground">
                    {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  {note.context_tags && note.context_tags.length > 0 && note.context_tags.map((tag: string) => (
                    <span key={tag} className="text-[8px] font-bold text-primary/70 bg-primary/5 px-1.5 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
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
                  onClick={() => { setPanelTab(panelId, tab.id); setMoreOpen(false); }}
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
        {activeTab === 'deck' && <DeckContent />}
        {activeTab === 'chat' && <ChatContent />}
        {activeTab === 'tasks' && <TasksContent />}
        {activeTab === 'stream' && <StreamContent />}
        {activeTab === 'notes' && <NotesContent />}
        {isMoreTab && <MoreTabContent tab={activeTab as MorePanelTab} />}
      </div>
    </div>
  );
}
