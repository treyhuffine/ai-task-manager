'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, Square, Loader2, Paperclip, Sparkles, Check, Zap, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LiveWaveform } from '@/components/ui/live-waveform';
import { useVoiceInput } from '@/hooks/use-voice-input';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';
import { useUpdateSession, useSessionMeta } from '@/hooks/use-execution';
import { cn } from '@/lib/utils';
import { PERMISSION_MODE_META, nextPermissionMode } from '@/lib/permission-modes';
import { PERMISSION_MODES, type PermissionMode, type EffortLevel } from '@/db/types';
import {
  MODEL_OPTIONS, EFFORT_OPTIONS, findModelOption, harnessSupportsEffort,
} from '@/lib/agent-options';

interface ExecutionComposerProps {
  sessionId: string;
  /** Current permission mode for the session. Drives the mode picker. */
  permissionMode: PermissionMode;
  /** Per-session model id (null = harness default). */
  model: string | null;
  /** Per-session effort level (null = harness default; ignored on non-Claude). */
  effort: EffortLevel | null;
  /** Agent harness — drives which model catalog + whether effort is shown. */
  harness: string | null;
  disabled?: boolean;
  disabledReason?: string;
  /** Helper copy under the composer, sets expectations. */
  helperText?: string;
  /** A turn is currently in flight — flips Send to Stop. */
  isRunning?: boolean;
  /**
   * Send the message. `opts.viaVoice` is true when the text came from a
   * voice transcript (auto-send path) — the parent uses this to mark
   * the resulting event id as voice-sent so the transcript can render
   * the VoiceSentBadge.
   */
  onSend: (message: string, opts?: { viaVoice?: boolean }) => Promise<void> | void;
  /** Required when `isRunning` can be true. Cancels the agent turn. */
  onStop?: () => Promise<void> | void;
}

const MAX_HEIGHT = 200;

/**
 * Composer for executions. Adopts the same vertical-stack layout as
 * `ai-elements/slideout-chat.tsx` — textarea on top, action row below
 * — so the placeholder centers naturally and the buttons get their own
 * baseline. Enter submits; Shift+Enter (or Alt/Option+Enter) inserts a
 * newline.
 *
 * Voice input goes through the project's `useVoiceInput` hook, which
 * already handles the parakeet local STT, groq/openai cloud, and the
 * Web Speech API fallback. Transcripts append to the current input;
 * we honor the user's `voice_auto_send` preference for whether to fire
 * immediately.
 */
export function ExecutionComposer({
  sessionId,
  permissionMode,
  model,
  effort,
  harness,
  disabled,
  disabledReason,
  helperText,
  isRunning,
  onSend,
  onStop,
}: ExecutionComposerProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { data: userState } = useUserState();
  const updateUserState = useUpdateUserState();
  const voice = useVoiceInput();
  const autoSend = userState?.voice_auto_send ?? true;
  const updateSession = useUpdateSession();

  const toggleAutoSend = useCallback(() => {
    updateUserState.mutate({ voice_auto_send: !autoSend });
  }, [autoSend, updateUserState]);
  const modeMeta = PERMISSION_MODE_META[permissionMode];
  const sessionMeta = useSessionMeta(sessionId);

  // Resolve current model/effort displays. The pinned `model` (when set)
  // wins over the model id derived from the live system event — once the
  // user picks a model, that's the truth even if the session hasn't
  // dispatched yet. The system-event derivation is the fallback for
  // sessions that haven't been pinned (null model = harness default,
  // which we only know after the first turn).
  const harnessModels = harness ? MODEL_OPTIONS[harness as keyof typeof MODEL_OPTIONS] ?? [] : [];
  const pinnedModelOption = harness && model ? findModelOption(harness, model) : null;
  const displayModelLabel = pinnedModelOption?.label ?? sessionMeta.model?.label ?? null;
  const showEffort = harness ? harnessSupportsEffort(harness) : false;
  const effortOption = effort ? EFFORT_OPTIONS.find((o) => o.id === effort) ?? null : null;

  const setPermissionMode = useCallback(
    (next: PermissionMode) => {
      if (next === permissionMode) return;
      updateSession.mutate({ id: sessionId, permission_mode: next });
    },
    [permissionMode, sessionId, updateSession],
  );

  const cycleMode = useCallback(() => {
    setPermissionMode(nextPermissionMode(permissionMode));
  }, [permissionMode, setPermissionMode]);

  const setModel = (id: string | null) => {
    setModelMenuOpen(false);
    if (id === model) return;
    updateSession.mutate({ id: sessionId, model: id });
  };

  const setEffort = (level: EffortLevel | null) => {
    setEffortMenuOpen(false);
    if (level === effort) return;
    updateSession.mutate({ id: sessionId, effort: level });
  };

  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
  }, []);

  const handleSend = useCallback(
    async (overrideText?: string, opts?: { viaVoice?: boolean }) => {
      const text = (overrideText ?? value).trim();
      // Block sends while a turn is in flight — dispatch would throw
      // `already_running` and the user would just see a 500.
      if (!text || sending || disabled || isRunning) return;
      setSending(true);
      try {
        await onSend(text, opts);
        setValue('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      } finally {
        setSending(false);
      }
    },
    [value, sending, disabled, isRunning, onSend],
  );

  // Voice transcript → composer. Auto-send when the user prefers it
  // (matches the orchestrator pattern); otherwise drop the text in and
  // let them review before pressing Enter.
  const lastTranscriptRef = useRef('');
  useEffect(() => {
    if (!voice.transcript || voice.isRecording) return;
    if (voice.transcript === lastTranscriptRef.current) return;

    lastTranscriptRef.current = voice.transcript;
    if (autoSend) {
      handleSend(voice.transcript, { viaVoice: true });
      voice.clearTranscript();
    } else {
      setValue((prev) => (prev ? `${prev} ${voice.transcript}` : voice.transcript));
      voice.clearTranscript();
      // Let the just-set value flush, then resize.
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          autoResize(textareaRef.current);
          textareaRef.current.focus();
        }
      });
    }
  }, [voice, autoSend, handleSend, autoResize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits. Shift+Enter and Alt/Option+Enter insert newlines.
    // ⌘+Enter / Ctrl+Enter also submit (legacy muscle memory) but only
    // when neither modifier is on.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    // Shift+Tab cycles permission mode. Match Claude Code's keybinding —
    // muscle memory transfers cleanly. Only fires when the textarea is
    // focused so it doesn't fight the browser's tab navigation elsewhere.
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      cycleMode();
    }
  };

  const handleStop = useCallback(async () => {
    if (!onStop || stopping) return;
    setStopping(true);
    try {
      await onStop();
    } finally {
      setStopping(false);
    }
  }, [onStop, stopping]);

  const canSend = !!value.trim() && !sending && !disabled;
  const showVoiceButton = voice.isSupported;
  // Show the stop button when a turn is in flight AND the caller wired
  // up an onStop handler. The stop button takes the send slot — never
  // both at once.
  const showStopButton = !!isRunning && !!onStop;

  const setMode = (next: PermissionMode) => {
    setModeMenuOpen(false);
    setPermissionMode(next);
  };

  // Status line below the composer — voice / error / disabled / helper.
  const statusLine = voice.isRecording
    ? 'Recording — tap mic to stop'
    : voice.isTranscribing
      ? 'Transcribing…'
      : voice.error
        ? voice.error
        : voice.unsupportedReason && !voice.isSupported
          ? `Voice unavailable — ${voice.unsupportedReason}`
          : disabled && disabledReason
            ? disabledReason
            : !disabled && helperText
              ? helperText
              : null;
  const statusIsError = !!voice.error;

  return (
    <div className="flex-shrink-0">
      <div className="px-5 py-3 max-w-3xl mx-auto">
        <div
          className={cn(
            'rounded-xl border border-border bg-card transition-colors flex flex-col',
            'focus-within:border-primary/50',
            disabled && !showStopButton && 'opacity-60',
          )}
        >
          {/* Top: textarea — or live waveform while recording. Swapping
              keeps the composer's vertical footprint constant (waveform
              matches the textarea's minHeight) and gives the user clear
              visual feedback that audio is flowing. The textarea's value
              is preserved across the swap so any typed prefix sticks
              around when transcription appends to it. */}
          {voice.isRecording ? (
            <div
              className="px-3 pt-2.5 pb-1 flex items-center"
              style={{ minHeight: 36 }}
            >
              <LiveWaveform
                active={voice.isRecording}
                height={24}
                barWidth={2}
                barGap={1}
                barRadius={1}
                sensitivity={1.2}
                mode="static"
                fadeEdges
                className="text-destructive flex-1"
                stream={voice.stream}
              />
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                autoResize(e.target);
              }}
              onKeyDown={handleKeyDown}
              placeholder={disabled ? disabledReason ?? 'Composer is disabled' : 'Message the agent…'}
              disabled={disabled || sending}
              rows={1}
              className={cn(
                'resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/50',
                'focus:outline-none disabled:cursor-not-allowed',
                'px-3 pt-2.5 pb-1 leading-snug',
              )}
              style={{ minHeight: 36, maxHeight: MAX_HEIGHT }}
            />
          )}

          {/* Bottom toolbar. Two layouts behind the same flex row so
              vertical height stays steady:
                · idle  : [📎][mode]  ………  [model][effort][context][mic][send]
                · record: [auto-send labeled toggle]  …  [X cancel][stop]
              While recording the pre-send controls are out of context
              (you can't change model mid-record meaningfully), so we
              hide them and surface auto-send labeled clearly so the
              user knows what hitting Stop will do. */}
          <div className="flex items-center gap-1 px-1.5 pb-1.5 flex-wrap">
            {voice.isRecording ? (
              // Push everything to the right so the recording cluster
              // (Auto-send + X + stop) reads as one unit. Auto-send sits
              // immediately next to the cancel/stop pair so it's
              // obviously part of the recording controls.
              <div className="flex-1" />
            ) : (
              <>
                {/* ─── Left: attach · mode ─────────────────── */}
                <button
                  type="button"
                  disabled
                  title="Attachments — coming soon"
                  className={cn(
                    'w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground/50',
                    'cursor-not-allowed',
                  )}
                  aria-label="Attach file (coming soon)"
                >
                  <Paperclip size={13} />
                </button>

                <ModePicker
                  open={modeMenuOpen}
                  onOpenChange={setModeMenuOpen}
                  current={permissionMode}
                  onSelect={setMode}
                  disabled={updateSession.isPending}
                />

                <div className="flex-1" />

                {/* ─── Right: model · effort · context ─────── */}
                {harnessModels.length > 0 && (
                  <ModelPicker
                    open={modelMenuOpen}
                    onOpenChange={setModelMenuOpen}
                    options={harnessModels}
                    pinnedId={model}
                    fallbackLabel={displayModelLabel ?? 'Default'}
                    onSelect={setModel}
                    disabled={updateSession.isPending}
                  />
                )}

                {showEffort && (
                  <EffortPicker
                    open={effortMenuOpen}
                    onOpenChange={setEffortMenuOpen}
                    current={effort}
                    onSelect={setEffort}
                    disabled={updateSession.isPending}
                  />
                )}

                {sessionMeta.contextUsedFraction != null && (
                  <ContextRing fraction={sessionMeta.contextUsedFraction} />
                )}
              </>
            )}

            {voice.isRecording && (
              <AutoSendSwitch
                on={autoSend}
                onToggle={toggleAutoSend}
                disabled={updateUserState.isPending}
              />
            )}

            {showVoiceButton && voice.isRecording && (
              <button
                type="button"
                onClick={voice.cancelRecording}
                className={cn(
                  'w-7 h-7 rounded-md flex items-center justify-center transition-colors',
                  'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
                aria-label="Cancel recording"
                title="Cancel recording (discard)"
              >
                <X size={13} />
              </button>
            )}

            {showVoiceButton && (
              <button
                type="button"
                onClick={voice.toggleRecording}
                disabled={voice.isTranscribing || disabled}
                className={cn(
                  'w-7 h-7 rounded-md flex items-center justify-center transition-colors',
                  voice.isRecording
                    ? 'text-destructive bg-destructive/10 hover:bg-destructive/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
                aria-label={voice.isRecording ? 'Stop recording' : 'Voice input'}
                title={voice.isRecording ? 'Stop recording (transcribe)' : `Voice input${voice.provider === 'local' ? ' (Parakeet)' : ''}`}
              >
                {voice.isTranscribing ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : voice.isRecording ? (
                  <Square size={11} className="fill-current" />
                ) : (
                  <Mic size={13} />
                )}
              </button>
            )}

            {/* Send hides while recording — nothing to send until
                transcription completes. Stop owns the slot during a
                turn-in-flight via showStopButton (unchanged). */}
            {showStopButton ? (
              <button
                type="button"
                onClick={handleStop}
                disabled={stopping}
                className={cn(
                  'w-7 h-7 rounded-md flex items-center justify-center transition-colors',
                  'border border-border bg-background text-muted-foreground',
                  'hover:text-foreground hover:bg-muted/40 active:scale-95',
                  'disabled:opacity-60 disabled:cursor-not-allowed',
                )}
                aria-label="Stop agent"
                title="Stop agent"
              >
                {stopping ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Square size={10} className="fill-current" />
                )}
              </button>
            ) : !voice.isRecording ? (
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!canSend}
                className={cn(
                  'w-7 h-7 rounded-md flex items-center justify-center transition-colors',
                  canSend
                    ? 'bg-primary text-primary-foreground hover:opacity-90 active:scale-95'
                    : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
                )}
                aria-label="Send message"
                title="Send (Enter)"
              >
                {sending ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
              </button>
            ) : null}
          </div>
        </div>

        {/* Status line + Shift+Tab hint. One row below the composer so
            the layout doesn't bounce when status text appears/disappears. */}
        <div className="flex items-center justify-between gap-2 mt-1 px-1 min-h-[14px]">
          <span className="text-[10px] text-muted-foreground/60 hidden sm:inline">
            ⇧⇥ to cycle modes
          </span>
          {statusLine && (
            <span
              className={cn(
                'text-[10px]',
                statusIsError ? 'text-destructive' : 'text-muted-foreground/70',
              )}
            >
              {statusLine}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ModePicker ───────────────────────────────────────────────

interface ModePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: PermissionMode;
  onSelect: (mode: PermissionMode) => void;
  disabled?: boolean;
}

function ModePicker({ open, onOpenChange, current, onSelect, disabled }: ModePickerProps) {
  const meta = PERMISSION_MODE_META[current];
  const Icon = meta.Icon;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`${meta.title} — ${meta.description}\nShift+Tab to cycle`}
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] font-medium rounded-md px-2 py-1 border transition-colors',
            meta.classes.text,
            meta.classes.border,
            meta.classes.bg,
            'hover:brightness-110 disabled:opacity-50',
          )}
        >
          <Icon size={11} />
          <span>{meta.shortTitle}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 p-1">
        <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
          Permission mode
        </div>
        {PERMISSION_MODES.map((m) => {
          const mm = PERMISSION_MODE_META[m];
          const ItemIcon = mm.Icon;
          const active = m === current;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onSelect(m)}
              className={cn(
                'w-full flex items-start gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors',
                active ? 'bg-primary/10' : 'hover:bg-muted/50',
              )}
            >
              <div className="w-4 h-4 mt-0.5 flex items-center justify-center shrink-0">
                {active ? (
                  <Check size={12} className="text-primary" strokeWidth={3} />
                ) : (
                  <ItemIcon size={12} className={mm.classes.text} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className={cn('text-[12px] font-medium', mm.classes.text)}>{mm.title}</div>
                <div className="text-[10.5px] text-muted-foreground/80 mt-0.5 leading-snug">
                  {mm.description}
                </div>
              </div>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// ─── ModelPicker ───────────────────────────────────────────────

interface ModelPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ReadonlyArray<{ id: string; label: string; hint?: string }>;
  pinnedId: string | null;
  fallbackLabel: string;
  onSelect: (id: string | null) => void;
  disabled?: boolean;
}

function ModelPicker({
  open, onOpenChange, options, pinnedId, fallbackLabel, onSelect, disabled,
}: ModelPickerProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={pinnedId ? `Model pinned: ${pinnedId}` : 'Use harness default'}
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] font-medium rounded-md px-2 py-1 border transition-colors',
            'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50',
            'disabled:opacity-50',
          )}
        >
          <Sparkles size={11} className="text-primary/70" />
          <span>{fallbackLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-72 p-1">
        <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
          Model
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            'w-full flex items-start gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors',
            pinnedId === null ? 'bg-primary/10' : 'hover:bg-muted/50',
          )}
        >
          <div className="w-4 h-4 mt-0.5 flex items-center justify-center shrink-0">
            {pinnedId === null && <Check size={12} className="text-primary" strokeWidth={3} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-foreground">Default</div>
            <div className="text-[10.5px] text-muted-foreground/80 mt-0.5 leading-snug">
              Use whatever the harness picks.
            </div>
          </div>
        </button>
        {options.map((opt) => {
          const active = opt.id === pinnedId;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={cn(
                'w-full flex items-start gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors',
                active ? 'bg-primary/10' : 'hover:bg-muted/50',
              )}
            >
              <div className="w-4 h-4 mt-0.5 flex items-center justify-center shrink-0">
                {active && <Check size={12} className="text-primary" strokeWidth={3} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-foreground">{opt.label}</div>
                {opt.hint && (
                  <div className="text-[10.5px] text-muted-foreground/80 mt-0.5 leading-snug">
                    {opt.hint}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// ─── EffortPicker ──────────────────────────────────────────────

interface EffortPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: EffortLevel | null;
  onSelect: (level: EffortLevel | null) => void;
  disabled?: boolean;
}

function EffortPicker({ open, onOpenChange, current, onSelect, disabled }: EffortPickerProps) {
  const opt = current ? EFFORT_OPTIONS.find((o) => o.id === current) : null;
  const label = opt?.shortLabel ?? 'Effort';
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={current ? `Effort: ${label}` : 'Use harness default thinking budget'}
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] font-medium rounded-md px-2 py-1 border transition-colors',
            'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50',
            'disabled:opacity-50',
          )}
        >
          <Zap size={10} className={cn(current ? 'text-amber-500' : 'text-muted-foreground/60')} />
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 p-1">
        <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
          Reasoning effort
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            'w-full flex items-start gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors',
            current === null ? 'bg-primary/10' : 'hover:bg-muted/50',
          )}
        >
          <div className="w-4 h-4 mt-0.5 flex items-center justify-center shrink-0">
            {current === null && <Check size={12} className="text-primary" strokeWidth={3} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-foreground">Default</div>
            <div className="text-[10.5px] text-muted-foreground/80 mt-0.5 leading-snug">
              Use the harness default thinking budget.
            </div>
          </div>
        </button>
        {EFFORT_OPTIONS.map((opt) => {
          const active = opt.id === current;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={cn(
                'w-full flex items-start gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors',
                active ? 'bg-primary/10' : 'hover:bg-muted/50',
              )}
            >
              <div className="w-4 h-4 mt-0.5 flex items-center justify-center shrink-0">
                {active && <Check size={12} className="text-primary" strokeWidth={3} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-foreground">{opt.label}</div>
                <div className="text-[10.5px] text-muted-foreground/80 mt-0.5 leading-snug">
                  {opt.hint}
                </div>
              </div>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// ─── AutoSendSwitch ──────────────────────────────────────────
//
// Labeled iOS-style switch. Lives in the toolbar's left slot while
// recording so it's clearly voice-related and easy to flip without
// breaking the recording state. Mirrors the orchestrator chat's
// VoiceSentBadge popover toggle.

function AutoSendSwitch({
  on, onToggle, disabled,
}: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      disabled={disabled}
      title={on
        ? 'Auto-send voice transcripts (click to turn off)'
        : 'Hold transcripts in the textarea (click to auto-send)'}
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium',
        'text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors',
        'disabled:opacity-50',
      )}
    >
      <span
        className={cn(
          'relative inline-flex h-4 w-7 shrink-0 rounded-full border-2 border-transparent transition-colors',
          on ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-3 w-3 rounded-full bg-background shadow-sm transition-transform',
            on ? 'translate-x-3' : 'translate-x-0',
          )}
        />
      </span>
      <span>Auto-send</span>
    </button>
  );
}

// ─── ContextRing ───────────────────────────────────────────────
//
// Small SVG ring that fills clockwise as the latest turn's input
// tokens approach the model's context cap. Tints amber > 70%, red > 90%.

function ContextRing({ fraction }: { fraction: number }) {
  const pct = Math.round(fraction * 100);
  const r = 5;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - fraction);
  const tone =
    fraction > 0.9 ? 'text-destructive' : fraction > 0.7 ? 'text-amber-500' : 'text-primary/70';

  return (
    <span
      className="inline-flex items-center gap-1"
      title={`Context: ${pct}% of last turn's input vs. model cap`}
    >
      <svg width={14} height={14} viewBox="0 0 14 14" className={tone}>
        <circle cx={7} cy={7} r={r} className="stroke-muted-foreground/25" strokeWidth={2} fill="none" />
        <circle
          cx={7}
          cy={7}
          r={r}
          stroke="currentColor"
          strokeWidth={2}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 7 7)"
        />
      </svg>
      <span className="tabular-nums">{pct}%</span>
    </span>
  );
}
