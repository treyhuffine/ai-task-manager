"use client";

import { Mic, MicOff, Send, Square, X, Loader2 } from 'lucide-react';
import { useCallback } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import { useVoiceInput } from '@/hooks/use-voice-input';
import { useUserState } from '@/hooks/use-user-state';
import { LiveWaveform } from '@/components/ui/live-waveform';
import type { FormEvent, KeyboardEvent } from 'react';

interface CommandInputProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onSendMessage?: (text: string) => void;
  isStreaming: boolean;
  onStop: () => void;
}

export function CommandInput({ input, setInput, onSubmit, onSendMessage, isStreaming, onStop }: CommandInputProps) {
  const { theme, isFocusMode } = useDashboard();
  const isDark = theme === 'dark';
  const { data: userState } = useUserState();
  const voiceAutoSend = userState?.voiceAutoSend ?? true;

  const voice = useVoiceInput();

  // Send voice transcript
  const handleVoiceSend = useCallback(() => {
    const text = voice.transcript.trim();
    if (!text) return;
    if (onSendMessage) {
      onSendMessage(text);
    }
    voice.clearTranscript();
  }, [voice, onSendMessage]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        onStop();
      } else if (input.trim()) {
        onSubmit(e);
      }
    }
  };

  // Whether the voice transcript panel is showing
  const showVoicePanel = voice.isTranscribing || (!!voice.transcript && !voiceAutoSend);

  return (
    <div className={cn(
      'flex-shrink-0 w-full pt-4 pb-8 transition-all duration-500',
      isFocusMode ? 'max-w-2xl mx-auto' : 'px-8'
    )}>
      <div className="max-w-3xl mx-auto space-y-3">
        {/* Voice transcript / transcribing panel */}
        {showVoicePanel && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 space-y-2">
            {voice.isTranscribing && (
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="text-primary animate-spin" />
                <span className="text-sm text-primary font-medium">
                  Transcribing{voice.provider === 'local' ? ' via Parakeet' : ''}...
                </span>
              </div>
            )}

            {voice.transcript && !voiceAutoSend && (
              <div className="flex items-start gap-3">
                <p className="flex-1 text-base text-foreground leading-relaxed">{voice.transcript}</p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={voice.clearTranscript}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
                    title="Discard"
                  >
                    <X size={18} />
                  </button>
                  <button
                    onClick={handleVoiceSend}
                    className="w-9 h-9 rounded-lg flex items-center justify-center bg-primary text-primary-foreground shadow-lg active:scale-95 transition-all"
                    title="Send"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            )}

            {voice.error && (
              <p className="text-[11px] text-destructive">{voice.error}</p>
            )}
          </div>
        )}

        {/* Floating mic button + waveform */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={voice.toggleRecording}
            disabled={!voice.isSupported || voice.isTranscribing}
            className={cn(
              'relative w-12 h-12 rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-95 shrink-0 overflow-hidden',
              voice.isRecording
                ? 'bg-destructive text-destructive-foreground shadow-destructive/30'
                : 'bg-primary text-primary-foreground shadow-primary/30 hover:opacity-90 hover:scale-105 group/mic',
              (!voice.isSupported || voice.isTranscribing) && 'opacity-50 cursor-not-allowed'
            )}
            title={voice.isRecording ? 'Stop recording' : `Voice input${voice.provider === 'local' ? ' (Parakeet)' : ''}`}
          >
            {voice.isRecording ? (
              <Square size={20} className="relative z-10" />
            ) : (
              <>
                <Mic size={22} className="relative z-10" />
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover/mic:translate-y-0 transition-transform duration-300" />
                <div className="absolute inset-0 rounded-xl border border-white/20 animate-pulse" />
              </>
            )}
          </button>

          {/* Live waveform — visible when recording */}
          {voice.isRecording && (
            <div className="flex-1 min-w-0">
              <LiveWaveform
                active={voice.isRecording}
                height={48}
                barWidth={3}
                barGap={1}
                barRadius={1.5}
                sensitivity={1.2}
                mode="static"
                fadeEdges
                className="text-primary"
                stream={voice.stream}
              />
            </div>
          )}
        </div>

        {/* Text input */}
        <form onSubmit={onSubmit} className="relative group">
          {/* Glow effect on focus */}
          <div className="absolute -inset-1 bg-ring/20 rounded-2xl blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity" />

          <div className={cn(
            'relative bg-card border border-border rounded-2xl p-1.5 flex items-center gap-3',
            'shadow-[0_20px_50px_rgba(0,0,0,0.1)] focus-within:border-primary/30 transition-all'
          )}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tell Flow what's next..."
              className="flex-1 bg-transparent border-none outline-none text-base py-3 pl-3 placeholder:text-muted-foreground"
            />

            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="w-12 h-12 rounded-xl flex items-center justify-center bg-destructive text-destructive-foreground shadow-xl transition-all active:scale-95"
              >
                <Square size={18} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className={cn(
                  'w-12 h-12 rounded-xl flex items-center justify-center transition-all',
                  input.trim()
                    ? 'bg-primary text-primary-foreground shadow-xl active:scale-95'
                    : isDark ? 'bg-secondary text-muted-foreground' : 'bg-muted text-muted-foreground'
                )}
              >
                <Send size={20} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
