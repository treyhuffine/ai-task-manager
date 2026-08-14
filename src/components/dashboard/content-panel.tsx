"use client";

import {
  Layers, ChevronDown,
  Users, Gavel, Calendar, ArrowUp,
  Mic, Square, MessageSquare, Loader2, Pencil, X,
  Zap, Radar, Shuffle, Clock, AlertCircle, Battery, Trophy, TrendingDown, MoreHorizontal,
  Wrench, Check, XCircle, AudioLines, Plus, History,
} from 'lucide-react';
import { useState, useCallback, Fragment, useRef, useEffect, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { isFileUIPart, isToolUIPart, getToolName, DefaultChatTransport } from 'ai';
import { getAuthToken } from '@/lib/api/client';
import { MessageFileChip } from '@/components/chat/message-file-chip';
import { fileUIPartToAttachment } from '@/lib/chat/file-ui-part';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import type { PanelId, PanelTab, MorePanelTab } from '@/types/dashboard';
import { TaskList } from '@/components/tasks/task-list';
import { NoteList } from '@/components/notes/note-list';
import { StreamList } from '@/components/stream/stream-list';
import { DeckContainer } from '@/components/deck/deck-container';
import { CalendarPanel } from '@/components/calendar/calendar-panel';
import { useNeedsYourCall } from '@/hooks/use-stream';
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
import { CopyMessageButton } from '@/components/chat/copy-message-button';
import {
  ChatInputEditor, type ChatInputEditorHandle,
} from '@/components/chat/editor/chat-input-editor';
import { buildRecallHistory } from '@/components/chat/editor/history-recall';
import { AttachButton } from '@/components/chat/editor/attach-button';
import { ChatDropZone } from '@/components/chat/editor/chat-drop-zone';
import { APP_NAME } from '@/constants/app';
import { HOTKEYS } from '@/constants/commands';
import { useVoiceInput } from '@/hooks/use-voice-input';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';
import { LiveWaveform } from '@/components/ui/live-waveform';
import { HarnessChat } from '@/components/chat/harness-chat';
import {
  useNewOrchestratorChat,
  useOrchestratorChat,
  useOrchestratorChatHistory,
  useResumeOrchestratorChat,
  type OrchestratorMode,
} from '@/hooks/use-orchestrator-chat';
import { formatCompactRelative } from '@/lib/utils/relative-time';

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

// ─── Chat mode switcher ────────────────────────────────────────
//
// Three orchestrator brains behind one tab (user_state.orchestratorMode):
//   classic — the hand-rolled streamText agent (ephemeral, in-process)
//   skills  — harness session in the data root, actions via CLI/skills
//   mcp     — harness session with the orchestrator MCP attached
// Switching into a harness mode starts a fresh session: the mode's CLI
// flags (MCP attachment, write guards) are read at process spawn.

const CHAT_MODES: { id: OrchestratorMode; label: string; title: string }[] = [
  { id: 'legacy', label: 'Classic', title: 'Built-in chat agent (no harness)' },
  { id: 'harness_skills', label: 'Skills', title: 'Harness session: actions via CLI + skills' },
  { id: 'harness_mcp', label: 'MCP', title: 'Harness session: actions via MCP tools' },
];

/**
 * History popover for harness chats. Self-contained: reads the list +
 * current session from the orchestrator-chat hooks (cache shared with
 * HarnessChat — no duplicate fetches) and resumes on click. Labels come
 * from the same haiku-via-harness derivation executions use; a chat that
 * hasn't had its first send yet shows as "New chat".
 */
function ChatHistoryMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { data: current } = useOrchestratorChat();
  const { data: history, isLoading } = useOrchestratorChatHistory(open);
  const resume = useResumeOrchestratorChat();

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const currentId = current?.session.id ?? null;
  const sessions = history?.sessions ?? [];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Chat history"
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-[0.06em] transition-all',
          open
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
        )}
      >
        <History size={10} />
        History
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 max-h-72 overflow-y-auto rounded-lg border border-border bg-card shadow-xl z-50 py-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={12} className="animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="px-3 py-3 text-[10.5px] text-muted-foreground/70 text-center">
              No chats yet
            </p>
          ) : (
            sessions.map((s) => {
              const isCurrent = s.id === currentId;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    if (!isCurrent) resume.mutate(s.id);
                    setOpen(false);
                  }}
                  disabled={resume.isPending}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all disabled:opacity-50',
                    isCurrent ? 'bg-primary/5' : 'hover:bg-muted/50',
                  )}
                >
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full shrink-0',
                      isCurrent ? 'bg-primary' : 'bg-transparent',
                    )}
                  />
                  {/* Label chain: retrospective summary (archived) → last
                      user message snippet (live) → placeholder (no sends yet). */}
                  <span
                    className={cn(
                      'flex-1 truncate text-[11px]',
                      isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground',
                      !s.label && !s.snippet && 'italic',
                    )}
                  >
                    {s.label ?? s.snippet ?? 'New chat'}
                  </span>
                  <span className="shrink-0 text-[9.5px] text-muted-foreground/60 font-mono">
                    {formatCompactRelative(s.lastActivityAt ?? s.lastOutcomeEventAt ?? s.startedAt)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function ChatModeBar({
  mode,
  onSwitch,
  onNewChat,
  newChatPending,
}: {
  mode: OrchestratorMode;
  onSwitch: (mode: OrchestratorMode) => void;
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
      {mode !== 'legacy' && (
        <>
          <ChatHistoryMenu />
          <button
            onClick={onNewChat}
            disabled={newChatPending}
            title="Start a new chat (archives the current one)"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all disabled:opacity-50"
          >
            {newChatPending ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
            New
          </button>
        </>
      )}
    </div>
  );
}

function ChatContent({ panelId, isMobile }: { panelId: PanelId; isMobile: boolean }) {
  const { data: userState } = useUserState();
  const updateUserState = useUpdateUserState();
  const newChat = useNewOrchestratorChat();
  const mode: OrchestratorMode = userState?.orchestratorMode ?? 'legacy';

  const handleSwitch = (next: OrchestratorMode) => {
    if (next === mode) return;
    updateUserState.mutate({ orchestratorMode: next });
    // Harness flags are spawn-time — entering a harness mode always cuts
    // over to a fresh session so the new mode's surface applies cleanly.
    if (next !== 'legacy') newChat.mutate();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <ChatModeBar
        mode={mode}
        onSwitch={handleSwitch}
        onNewChat={() => newChat.mutate()}
        newChatPending={newChat.isPending}
      />
      {mode === 'legacy' ? (
        <LegacyChatContent panelId={panelId} />
      ) : (
        // Key on mode so a switch fully remounts against the new session.
        <HarnessChat key={mode} isMobile={isMobile} />
      )}
    </div>
  );
}

function LegacyChatContent({ panelId }: { panelId: PanelId }) {
  const { theme, voiceChatPanelTarget, clearVoiceChatTrigger } = useDashboard();
  const isDark = theme === 'dark';
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const moreActionsRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, stop } = useChat({ transport: chatTransport });
  const isStreaming = status === 'streaming';

  // Sent-message recall (ArrowUp in the composer). The classic chat keeps
  // messages in memory (ai-sdk `useChat`), so recall history lives and dies
  // with the session — no persistence, unlike the harness chats. We flatten
  // each user turn's text parts into one recall entry.
  const messageHistory = useMemo(
    () =>
      buildRecallHistory(
        messages
          .filter((m) => m.role === 'user')
          .map((m) => ({
            role: 'user',
            source: 'user',
            content: m.parts
              .map((p) => (p.type === 'text' ? p.text : ''))
              .join('')
              .trim(),
          })),
      ),
    [messages],
  );
  const { data: userState } = useUserState();
  const updateUserState = useUpdateUserState();
  const voiceAutoSend = userState?.voiceAutoSend ?? true;

  // Track which message IDs were sent via voice
  const [voiceSentIds, setVoiceSentIds] = useState<Set<string>>(new Set());
  const pendingVoiceSendRef = useRef(false);

  // ai-sdk's UIMessage doesn't carry a server timestamp. Stamp each
  // message id the first time we see it so the copy/timestamp row can
  // surface "Apr 23, 9:40 AM" on hover. Lost on reload — same model as
  // voiceSentIds. The map only grows; old ids stay (keys are messages,
  // not memory pressure).
  const [messageTimes, setMessageTimes] = useState<Record<string, number>>({});
  useEffect(() => {
    if (messages.length === 0) return;
    setMessageTimes((prev) => {
      let changed = false;
      const next = prev;
      const now = Date.now();
      const updated: Record<string, number> = { ...prev };
      for (const m of messages) {
        if (!(m.id in updated)) {
          updated[m.id] = now;
          changed = true;
        }
      }
      return changed ? updated : next;
    });
  }, [messages]);

  const voice = useVoiceInput();
  const editorRef = useRef<ChatInputEditorHandle | null>(null);
  const [editorHasContent, setEditorHasContent] = useState(false);
  const [hasPendingUploads, setHasPendingUploads] = useState(false);
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

  const handleSubmit = useCallback((e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    const editor = editorRef.current;
    if (!editor) return;
    // Block while any attached file is still uploading. getUiMessageParts
    // skips pending chips, so sending now would silently drop the file —
    // wait for the upload to resolve. Attaching more files stays allowed.
    if (editor.hasPendingUploads()) return;
    const { parts } = editor.getUiMessageParts();
    if (parts.length === 0) return;
    // sendMessage accepts `parts` directly so chips and text run in
    // their authored positions all the way through to the model. The
    // existing render still groups by part type (text bubble vs file
    // chip block) — true inline-in-bubble rendering is a follow-up.
    sendMessage({ parts });
    editor.clear();
    setEditorHasContent(false);
  }, [sendMessage]);

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

  // Auto-send: when voiceAutoSend is on and transcript arrives, send immediately
  useEffect(() => {
    if (voiceAutoSend && voice.transcript.trim() && !voice.isRecording && !voice.isTranscribing) {
      handleVoiceSend();
    }
  }, [voiceAutoSend, voice.transcript, voice.isRecording, voice.isTranscribing, handleVoiceSend]);

  // Move transcript to editor for editing
  const handleVoiceEdit = useCallback(() => {
    const t = voice.transcript.trim();
    if (!t) return;
    const editor = editorRef.current;
    if (editor) {
      const prefix = editor.textLength() > 0 ? ' ' : '';
      editor.insertTextAtCursor(`${prefix}${t}`);
      editor.focus();
    }
    voice.clearTranscript();
  }, [voice]);

  const handleToggleAutoSend = useCallback(() => {
    updateUserState.mutate({ voiceAutoSend: !voiceAutoSend });
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

  // Enter / Shift+Enter handling lives inside ChatInputEditor's keymap
  // now. The editor calls onSubmit when the user hits Enter; that
  // routes through handleSubmit above (which handles isStreaming).

  // Show voice panel when transcribing or when there's a transcript to review (non-auto-send)
  const hasTranscriptToReview = !voiceAutoSend && !!voice.transcript.trim() && !voice.isRecording && !voice.isTranscribing;
  const showVoicePanel = voice.isTranscribing || hasTranscriptToReview;

  return (
    <ChatDropZone
      className="flex flex-col h-full"
      onFiles={(files) => {
        for (const f of files) void editorRef.current?.uploadFile(f);
        editorRef.current?.focus({ end: true });
      }}
    >
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
                          <div key={`${message.id}-${i}`} className="group flex flex-col">
                            <Message from={message.role}>
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
                            {part.text && (
                              <CopyMessageButton
                                text={part.text}
                                align={message.role === 'user' ? 'right' : 'left'}
                                alwaysVisible={message.role === 'assistant'}
                                timestamp={messageTimes[message.id] ?? null}
                              />
                            )}
                          </div>
                        );
                      }
                      if (isFileUIPart(part)) {
                        const att = fileUIPartToAttachment(part);
                        if (!att) return null;
                        return (
                          <div
                            key={`${message.id}-${i}`}
                            className={cn(
                              'flex w-full',
                              message.role === 'user' ? 'justify-end' : 'justify-start',
                            )}
                          >
                            <MessageFileChip attachment={att} variant="block" />
                          </div>
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

          <span className="ml-auto pr-3 hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground/60">
            <kbd className="px-1 py-0.5 bg-muted rounded text-[9px] font-sans">{HOTKEYS.focusChatInput.label}</kbd>
            <span>to focus</span>
          </span>
        </div>

        {/* Text input */}
        <form onSubmit={handleSubmit} className="relative group">
          <div className="pointer-events-none absolute -inset-0.5 bg-primary/15 rounded-xl blur-lg opacity-0 group-focus-within:opacity-100 transition-opacity" />
          <div className="relative bg-card border border-border rounded-xl p-1 flex flex-col gap-1 focus-within:border-primary/30 transition-all">
            <div className="flex items-start gap-2">
              <ChatInputEditor
                ref={editorRef}
                placeholder="Execute your plan..."
                onContentChange={setEditorHasContent}
                onPendingUploadsChange={setHasPendingUploads}
                onSubmit={() => (isStreaming ? stop() : handleSubmit())}
                history={messageHistory}
                className="pl-1"
              />
              <AttachButton
                onPick={(file) => { void editorRef.current?.uploadFile(file); }}
                title="Attach file"
                className="mt-1 mr-0.5"
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
                  disabled={!editorHasContent || hasPendingUploads}
                  title={hasPendingUploads ? 'Waiting for upload to finish…' : undefined}
                  className={cn(
                    'w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center transition-all',
                    editorHasContent && !hasPendingUploads
                      ? 'bg-primary text-primary-foreground active:scale-95'
                      : isDark ? 'bg-secondary text-muted-foreground' : 'bg-muted text-muted-foreground'
                  )}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </ChatDropZone>
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
        {activeTab === 'chat' && <ChatContent panelId={panelId} isMobile={!!mobileTab} />}
        {activeTab === 'tasks' && <TaskList />}
        {activeTab === 'stream' && <StreamList />}
        {activeTab === 'notes' && <NoteList />}
        {activeTab === 'calendar' && <CalendarPanel />}
        {isMoreTab && activeTab !== 'calendar' && <MoreTabContent tab={activeTab as MorePanelTab} />}
      </div>

    </div>
  );
}
