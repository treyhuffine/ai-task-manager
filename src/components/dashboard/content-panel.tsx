"use client";

import {
  Layers, ChevronDown,
  Users, Gavel, Calendar, ArrowUp,
  Mic, Square, MessageSquare, Loader2, Pencil, X,
  Zap, Radar, Shuffle, Clock, AlertCircle, Battery, Trophy, TrendingDown, MoreHorizontal,
  Wrench, Check, XCircle, AudioLines,
} from 'lucide-react';
import { useState, useCallback, Fragment, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { isToolUIPart, getToolName, DefaultChatTransport } from 'ai';
import { getAuthToken } from '@/lib/api/client';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import type { PanelId, PanelTab, MorePanelTab } from '@/types/dashboard';
import { TaskList } from '@/components/tasks/task-list';
import { NoteList } from '@/components/notes/note-list';
import { StreamList } from '@/components/stream/stream-list';
import { DeckContainer } from '@/components/deck/deck-container';
import { usePendingStreamCount } from '@/hooks/use-stream';
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
import { EntityAwareText } from '@/components/ai-elements/entity-reference';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { APP_NAME } from '@/constants/app';
import { useVoiceInput } from '@/hooks/use-voice-input';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';
import { LiveWaveform } from '@/components/ui/live-waveform';

// ─── Chat transport (adds auth header) ─────────────────────────

const chatTransport = new DefaultChatTransport({
  headers: (): Record<string, string> => {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
});

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

// ─── Tool call indicators ─────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  listTasks: 'Listing tasks',
  getTask: 'Reading task',
  createTask: 'Creating task',
  updateTask: 'Updating task',
  deleteTask: 'Deleting task',
  completeTask: 'Completing task',
  listNotes: 'Listing notes',
  getNote: 'Reading note',
  createNote: 'Creating note',
  updateNote: 'Updating note',
  deleteNote: 'Deleting note',
  listAreas: 'Listing areas',
  getArea: 'Reading area',
  createArea: 'Creating area',
  updateArea: 'Updating area',
  getDeck: 'Reading deck',
  updateDeck: 'Updating deck',
  regenerateDeck: 'Regenerating deck',
  searchKnowledgeBase: 'Searching knowledge base',
  getUserState: 'Reading user state',
  updateUserState: 'Updating user state',
};

function ToolCallIndicator({ toolName, state }: { toolName: string; state?: string }) {
  const label = TOOL_LABELS[toolName] ?? toolName;
  const isDone = state === 'result' || state === 'output-available';
  const isError = state === 'output-error';
  const isRunning = !isDone && !isError;

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 py-0.5">
      {isError ? (
        <XCircle size={10} className="text-destructive/70" />
      ) : isDone ? (
        <Check size={10} className="text-primary/70" />
      ) : (
        <Wrench size={10} />
      )}
      {isRunning ? (
        <Shimmer as="span" className="text-[11px]" duration={1.5}>{label}</Shimmer>
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}

// ─── Voice message badge with popover toggle ─────────────────

function VoiceSentBadge({ voiceAutoSend, onToggleAutoSend }: { voiceAutoSend: boolean; onToggleAutoSend: () => void }) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="flex justify-end relative" ref={popoverRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40 rounded-full px-2 py-0.5 transition-all"
      >
        <AudioLines size={10} />
        <span>Sent with voice</span>
        <ChevronDown size={8} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-56 rounded-lg border border-border bg-card shadow-xl z-50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-foreground">Auto-send voice</span>
            <button
              type="button"
              role="switch"
              aria-checked={voiceAutoSend}
              onClick={onToggleAutoSend}
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${voiceAutoSend ? 'bg-primary' : 'bg-muted'
                }`}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${voiceAutoSend ? 'translate-x-4' : 'translate-x-0'
                }`} />
            </button>
          </div>
          <p className="text-[9px] text-muted-foreground leading-relaxed">
            {voiceAutoSend
              ? 'Voice input sends immediately.'
              : 'Voice input goes to the text box for editing.'}
            {' '}Also in profile settings.
          </p>
        </div>
      )}
    </div>
  );
}

function ChatContent({ panelId }: { panelId: PanelId }) {
  const { theme, voiceChatPanelTarget, clearVoiceChatTrigger } = useDashboard();
  const isDark = theme === 'dark';
  const [input, setInput] = useState('');
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const moreActionsRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, stop } = useChat({ transport: chatTransport });
  const isStreaming = status === 'streaming';
  const { data: userState } = useUserState();
  const updateUserState = useUpdateUserState();
  const voiceAutoSend = userState?.voice_auto_send ?? true;

  // Track which message IDs were sent via voice
  const [voiceSentIds, setVoiceSentIds] = useState<Set<string>>(new Set());
  const pendingVoiceSendRef = useRef(false);

  const voice = useVoiceInput();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const [showUnsupportedHint, setShowUnsupportedHint] = useState(false);

  // Keep a ref to voice so the hotkey effect can read latest values
  // without depending on toggleRecording identity (which changes on every
  // isRecording flip and would re-trigger the effect).
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  // Escape cancels recording
  useEffect(() => {
    if (!voice.isRecording) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        voiceRef.current.cancelRecording();
      }
    };
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [voice.isRecording]);

  // Respond to global voice chat hotkey trigger
  useEffect(() => {
    if (voiceChatPanelTarget !== panelId) return;
    const v = voiceRef.current;
    clearVoiceChatTrigger();
    // Hotkey only supports the live-mic paths — file-capture needs a user gesture
    // on the <input>, which a synthetic keypress can't deliver on mobile anyway.
    if (v.captureMode !== 'media-recorder' && v.captureMode !== 'web-speech') return;
    v.toggleRecording();
    // Focus the mic button so space bar can stop recording
    requestAnimationFrame(() => micButtonRef.current?.focus());
  }, [voiceChatPanelTarget, panelId, clearVoiceChatTrigger]);

  const handleSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  }, [input, sendMessage]);

  const handleQuickAction = useCallback((message: string) => {
    sendMessage({ text: message });
    setMoreActionsOpen(false);
  }, [sendMessage]);

  // Send voice transcript
  const handleVoiceSend = useCallback(() => {
    const text = voice.transcript.trim();
    if (!text) return;
    pendingVoiceSendRef.current = true;
    sendMessage({ text });
    voice.clearTranscript();
  }, [voice.transcript, voice.clearTranscript, sendMessage]);

  // Mark the latest user message as voice-sent when pending
  const voiceSentIdsRef = useRef(voiceSentIds);
  voiceSentIdsRef.current = voiceSentIds;
  useEffect(() => {
    if (pendingVoiceSendRef.current && messages.length > 0) {
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg && !voiceSentIdsRef.current.has(lastUserMsg.id)) {
        setVoiceSentIds(prev => new Set(prev).add(lastUserMsg.id));
      }
      pendingVoiceSendRef.current = false;
    }
  }, [messages]);

  // Auto-send: when voice_auto_send is on and transcript arrives, send immediately
  useEffect(() => {
    if (voiceAutoSend && voice.transcript.trim() && !voice.isRecording && !voice.isTranscribing) {
      handleVoiceSend();
    }
  }, [voiceAutoSend, voice.transcript, voice.isRecording, voice.isTranscribing, handleVoiceSend]);

  // Move transcript to text box for editing
  const handleVoiceEdit = useCallback(() => {
    setInput(prev => prev ? `${prev} ${voice.transcript.trim()}` : voice.transcript.trim());
    voice.clearTranscript();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [voice]);

  const handleToggleAutoSend = useCallback(() => {
    updateUserState.mutate({ voice_auto_send: !voiceAutoSend });
  }, [updateUserState, voiceAutoSend]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits. Shift+Enter and Alt/Option+Enter insert newlines so
    // users can compose multi-line prompts without losing what they typed.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (isStreaming) {
        stop();
      } else if (input.trim()) {
        sendMessage({ text: input.trim() });
        setInput('');
        if (inputRef.current) inputRef.current.style.height = 'auto';
      }
    }
  };

  // Show voice panel when transcribing or when there's a transcript to review (non-auto-send)
  const hasTranscriptToReview = !voiceAutoSend && !!voice.transcript.trim() && !voice.isRecording && !voice.isTranscribing;
  const showVoicePanel = voice.isTranscribing || hasTranscriptToReview;

  return (
    <div className="flex flex-col h-full">
      {/* Messages area + floating mic overlay */}
      <div className="flex-1 min-h-0 relative">
        <div className="h-full overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-6 max-w-md mx-auto text-center">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                <Zap size={20} className="text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">Talk. {APP_NAME} handles the rest.</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                Delegate tasks to agents, brain dump and let AI sort it into tasks and notes, set up your deck, or get briefed on what needs your attention.
              </p>
              <div className="flex flex-wrap justify-center gap-1.5 mt-4 text-[10px] text-muted-foreground/60">
                <span className="px-2 py-1 rounded-md bg-muted/50">"Set up my day"</span>
                <span className="px-2 py-1 rounded-md bg-muted/50">"Here's everything on my mind..."</span>
                <span className="px-2 py-1 rounded-md bg-muted/50">"Brief me on the launch"</span>
                <span className="px-2 py-1 rounded-md bg-muted/50">"What should I delegate?"</span>
              </div>
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
                              <EntityAwareText
                                text={part.text}
                                renderMarkdown={(text, key) => (
                                  <MessageResponse key={key}>{text}</MessageResponse>
                                )}
                              />
                            </MessageContent>
                            {message.role === 'user' && voiceSentIds.has(message.id) && i === 0 && (
                              <VoiceSentBadge voiceAutoSend={voiceAutoSend} onToggleAutoSend={handleToggleAutoSend} />
                            )}
                          </Message>
                        );
                      }
                      if (isToolUIPart(part)) {
                        return (
                          <ToolCallIndicator
                            key={`${message.id}-${i}`}
                            toolName={getToolName(part)}
                            state={part.state}
                          />
                        );
                      }
                      return null;
                    })}
                  </Fragment>
                ))}
                {(status === 'submitted' || (isStreaming && messages.at(-1)?.role !== 'assistant')) && (
                  <Shimmer as="span" className="text-[11px]" duration={1.5}>
                    {`${APP_NAME} is thinking...`}
                  </Shimmer>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          )}
        </div>

        {/* ── Floating mic button + waveform overlay ── */}
        {!voice.isTranscribing && (
          <div className="absolute bottom-3 left-0 right-0 z-10 flex justify-center pointer-events-none">
            {/* Layout: waveform above, buttons below — change to "behind" layout by
                swapping this to absolute positioning (see git history) */}
            <div className="flex flex-col items-center gap-1.5">
              {/* Waveform bar above the button */}
              {voice.isRecording && (
                <div className="w-72 px-2 opacity-70">
                  <LiveWaveform
                    active={voice.isRecording}
                    stream={voice.stream}
                    height={32}
                    barWidth={2}
                    barGap={1}
                    barRadius={1}
                    sensitivity={1.2}
                    mode="static"
                    fadeEdges
                    className="text-foreground"
                  />
                </div>
              )}

              {/* Inline "why is this disabled" bubble when nothing works */}
              {showUnsupportedHint && voice.captureMode === null && voice.unsupportedReason && (
                <div
                  className="pointer-events-auto max-w-[18rem] rounded-lg border border-border bg-card/95 backdrop-blur-sm px-3 py-2 shadow-lg text-[11px] text-muted-foreground leading-snug"
                  role="status"
                >
                  {voice.unsupportedReason}
                </div>
              )}

              <div className="pointer-events-auto flex items-center gap-1.5 group">
                <button
                  ref={micButtonRef}
                  type="button"
                  onClick={() => {
                    if (voice.captureMode === null) {
                      // Tapping a disabled mic surfaces the reason — tap again to dismiss
                      setShowUnsupportedHint((v) => !v);
                    } else {
                      voice.toggleRecording();
                    }
                  }}
                  disabled={voice.isTranscribing}
                  className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-95',
                    'bg-primary text-primary-foreground shadow-primary/30',
                    !voice.isRecording && voice.captureMode !== null && 'hover:opacity-90 hover:scale-105',
                    voice.isTranscribing && 'opacity-50 cursor-not-allowed',
                    voice.captureMode === null && 'opacity-50',
                  )}
                  title={
                    voice.captureMode === null
                      ? voice.unsupportedReason ?? 'Voice unavailable'
                      : voice.isRecording
                        ? 'Stop recording'
                        : 'Voice input'
                  }
                  aria-label={voice.isRecording ? 'Stop recording' : 'Voice input'}
                >
                  {voice.isRecording ? <Square size={16} /> : <Mic size={18} />}
                </button>
                {voice.isRecording && (
                  <button
                    type="button"
                    onClick={voice.cancelRecording}
                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-card/80 backdrop-blur-sm border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95"
                    title="Cancel (Esc)"
                  >
                    <X size={14} />
                  </button>
                )}
                {!voice.isRecording && voice.captureMode === 'media-recorder' && (
                  <kbd className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-muted rounded text-[8px] text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    {'\u2318'}J
                  </kbd>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Voice panel: transcribing spinner or transcript bar */}
      {showVoicePanel && (
        <div className="shrink-0 px-3 py-2">
          {voice.isTranscribing && (
            <div className="flex items-center justify-center gap-2 py-1.5 px-4 rounded-full bg-muted/60 mx-auto w-fit">
              <Loader2 size={12} className="text-muted-foreground animate-spin" />
              <span className="text-[11px] text-muted-foreground">
                Transcribing...
              </span>
            </div>
          )}

          {hasTranscriptToReview && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 flex items-center gap-2">
              <AudioLines size={12} className="text-primary shrink-0" />
              <p className="flex-1 text-sm text-foreground truncate">{voice.transcript}</p>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={voice.clearTranscript}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
                  title="Discard"
                >
                  <X size={14} />
                </button>
                <button
                  onClick={handleVoiceEdit}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
                  title="Edit in text box"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={handleVoiceSend}
                  className="w-7 h-7 rounded-md flex items-center justify-center bg-primary text-primary-foreground active:scale-95 transition-all"
                  title="Send"
                >
                  <ArrowUp size={14} />
                </button>
              </div>
            </div>
          )}

          {voice.error && (
            <p className="text-[10px] text-destructive mt-1">{voice.error}</p>
          )}
        </div>
      )}

      {/* Quick actions + Input */}
      <div className="shrink-0 p-3 border-t border-border space-y-2">
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

        {/* Text input */}
        <form onSubmit={handleSubmit} className="relative group">
          <div className="pointer-events-none absolute -inset-0.5 bg-primary/15 rounded-xl blur-lg opacity-0 group-focus-within:opacity-100 transition-opacity" />
          <div className="relative bg-card border border-border rounded-xl p-1 flex items-start gap-2 focus-within:border-primary/30 transition-all">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onInput={(e) => {
                // Auto-resize: shrink to content, capped at ~6 lines (160px).
                const t = e.currentTarget;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 160) + 'px';
              }}
              onKeyDown={handleKeyDown}
              placeholder="Execute your plan..."
              className="flex-1 bg-transparent border-none outline-none text-base md:text-sm py-2 pl-2 placeholder:text-muted-foreground resize-none leading-snug"
              style={{ minHeight: 36, maxHeight: 160 }}
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={stop}
                className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center bg-destructive text-destructive-foreground transition-all active:scale-95"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className={cn(
                  'w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center transition-all',
                  input.trim()
                    ? 'bg-primary text-primary-foreground active:scale-95'
                    : isDark ? 'bg-secondary text-muted-foreground' : 'bg-muted text-muted-foreground'
                )}
              >
                <ArrowUp size={16} />
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
  const pendingStreamCount = usePendingStreamCount();

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
        {activeTab === 'chat' && <ChatContent panelId={panelId} />}
        {activeTab === 'tasks' && <TaskList />}
        {activeTab === 'stream' && <StreamList />}
        {activeTab === 'notes' && <NoteList />}
        {isMoreTab && <MoreTabContent tab={activeTab as MorePanelTab} />}
      </div>

    </div>
  );
}
