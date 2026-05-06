'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, Square, Loader2 } from 'lucide-react';
import { useVoiceInput } from '@/hooks/use-voice-input';
import { useUserState } from '@/hooks/use-user-state';
import { cn } from '@/lib/utils';

interface ExecutionComposerProps {
  sessionId: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Helper copy under the composer, sets expectations. */
  helperText?: string;
  /** A turn is currently in flight — flips Send to Stop. */
  isRunning?: boolean;
  onSend: (message: string) => Promise<void> | void;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { data: userState } = useUserState();
  const voice = useVoiceInput();
  const autoSend = userState?.voice_auto_send ?? true;

  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
  }, []);

  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? value).trim();
      // Block sends while a turn is in flight — dispatch would throw
      // `already_running` and the user would just see a 500.
      if (!text || sending || disabled || isRunning) return;
      setSending(true);
      try {
        await onSend(text);
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
      handleSend(voice.transcript);
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

  return (
    <div className="flex-shrink-0 border-t border-border bg-background">
      <div className="px-5 py-3 max-w-3xl mx-auto">
        <div
          className={cn(
            'rounded-xl border border-border bg-card transition-colors',
            'focus-within:border-primary/50',
            // items-start anchors the buttons to the top — when the textarea
            // grows multi-line, the send arrow stays in the corner instead
            // of riding the bottom edge.
            'flex items-start gap-1 p-1.5',
            // Don't fade the whole composer while a turn is running — the
            // stop button needs to read as fully active.
            disabled && !showStopButton && 'opacity-60',
          )}
        >
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
              'flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/50',
              'focus:outline-none disabled:cursor-not-allowed',
              'px-2 py-1.5 leading-snug',
            )}
            style={{ minHeight: 32, maxHeight: MAX_HEIGHT }}
          />

          <div className="flex items-center gap-1 flex-shrink-0">
            {showVoiceButton && (
              <button
                type="button"
                onClick={voice.toggleRecording}
                disabled={voice.isTranscribing || disabled}
                className={cn(
                  'w-8 h-8 rounded-md flex items-center justify-center transition-colors',
                  voice.isRecording
                    ? 'text-destructive bg-destructive/10 hover:bg-destructive/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
                aria-label={voice.isRecording ? 'Stop recording' : 'Voice input'}
                title={voice.isRecording ? 'Stop recording' : 'Voice input'}
              >
                {voice.isTranscribing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : voice.isRecording ? (
                  <Square size={13} className="fill-current" />
                ) : (
                  <Mic size={14} />
                )}
              </button>
            )}

            {showStopButton ? (
              <button
                type="button"
                onClick={handleStop}
                disabled={stopping}
                className={cn(
                  'w-8 h-8 rounded-md flex items-center justify-center transition-colors',
                  'border border-border bg-background text-muted-foreground',
                  'hover:text-foreground hover:bg-muted/40 active:scale-95',
                  'disabled:opacity-60 disabled:cursor-not-allowed',
                )}
                aria-label="Stop agent"
                title="Stop agent"
              >
                {stopping ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Square size={11} className="fill-current" />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!canSend}
                className={cn(
                  'w-8 h-8 rounded-md flex items-center justify-center transition-colors',
                  canSend
                    ? 'bg-primary text-primary-foreground hover:opacity-90 active:scale-95'
                    : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
                )}
                aria-label="Send message"
                title="Send (Enter)"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
              </button>
            )}
          </div>
        </div>

        {/* Inline status / helper / error stack — below the composer so the
            input itself stays clean. Order is by importance. */}
        {(voice.isRecording || voice.isTranscribing) && (
          <p className="text-[10px] text-muted-foreground/70 mt-1.5 px-1">
            {voice.isRecording ? 'Recording — tap mic to stop' : 'Transcribing…'}
          </p>
        )}
        {voice.error && (
          <p className="text-[10px] text-destructive mt-1.5 px-1">{voice.error}</p>
        )}
        {voice.unsupportedReason && !voice.isSupported && (
          <p className="text-[10px] text-muted-foreground/60 mt-1.5 px-1">
            Voice unavailable — {voice.unsupportedReason}
          </p>
        )}
        {disabled && disabledReason && (
          <p className="text-[10px] text-muted-foreground/60 mt-1.5 px-1">{disabledReason}</p>
        )}
        {!disabled && helperText && !voice.error && !voice.isRecording && !voice.isTranscribing && (
          <p className="text-[10px] text-muted-foreground/60 mt-1.5 px-1">{helperText}</p>
        )}
      </div>
    </div>
  );
}
