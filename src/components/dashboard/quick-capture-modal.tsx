"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog as DialogPrimitive, VisuallyHidden } from "radix-ui";
import { X, Mic, Square, Send, Loader2, Zap } from "lucide-react";
import { useCreateStream } from "@/hooks/use-stream";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { LiveWaveform } from "@/components/ui/live-waveform";
import { cn } from "@/lib/utils";

interface QuickCaptureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickCaptureModal({ open, onOpenChange }: QuickCaptureModalProps) {
  const [text, setText] = useState("");
  const [usedVoice, setUsedVoice] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createStream = useCreateStream();
  const voice = useVoiceInput();

  // Append voice transcript to textarea when recording finishes
  useEffect(() => {
    if (!voice.transcript) return;
    setText((prev) => {
      const sep = prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
      return prev + sep + voice.transcript;
    });
    setUsedVoice(true);
    voice.clearTranscript();
    // Refocus textarea so user can keep editing/typing after voice
    queueMicrotask(() => textareaRef.current?.focus());
  }, [voice.transcript, voice]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
  }, [text]);

  const resetForm = useCallback(() => {
    setText("");
    setUsedVoice(false);
    voice.clearTranscript();
    if (voice.isRecording) voice.cancelRecording();
  }, [voice]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || createStream.isPending) return;

    createStream.mutate(
      { raw_text: trimmed, source: "capture", media: usedVoice ? "voice" : "text" },
      {
        onSuccess: () => {
          resetForm();
          onOpenChange(false);
        },
      }
    );
  }, [text, usedVoice, createStream, onOpenChange, resetForm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) resetForm();
      onOpenChange(next);
    },
    [onOpenChange, resetForm]
  );

  const handleMicClick = useCallback(() => {
    if (voice.captureMode === null) return;
    voice.toggleRecording();
  }, [voice]);

  const canSubmit = text.trim().length > 0 && !createStream.isPending;
  const showWaveform = voice.isRecording && voice.stream;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[20%] md:top-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 md:-translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Quick Capture</DialogPrimitive.Title>
            <DialogPrimitive.Description>
              Quickly capture a thought into your Stream inbox. Type or dictate.
            </DialogPrimitive.Description>
          </VisuallyHidden.Root>

          <div className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center">
                  <Zap size={14} className="text-primary" />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-xs font-semibold text-foreground">Quick Capture</span>
                  <span className="text-[10px] text-muted-foreground">Lands in Stream for later triage</span>
                </div>
              </div>
              <DialogPrimitive.Close asChild>
                <button
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </DialogPrimitive.Close>
            </div>

            {/* Body */}
            <div className="px-5 pt-4 pb-2">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  voice.isRecording
                    ? "Listening…"
                    : "What's on your mind? Just capture it — triage later."
                }
                disabled={createStream.isPending}
                rows={3}
                className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none leading-relaxed min-h-[72px] max-h-[400px] disabled:opacity-50"
                autoFocus
              />

              {/* Live waveform while recording */}
              {showWaveform && (
                <div className="mt-2 rounded-lg bg-muted/40 px-3 py-2 flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                  <LiveWaveform
                    stream={voice.stream}
                    active
                    height={28}
                    barColor="currentColor"
                    className="flex-1 text-red-500/70"
                  />
                  <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                    REC
                  </span>
                </div>
              )}

              {voice.isTranscribing && (
                <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" />
                  Transcribing…
                </div>
              )}

              {voice.error && (
                <div className="mt-2 text-[11px] text-destructive">{voice.error}</div>
              )}

              {voice.captureMode === null && voice.unsupportedReason && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {voice.unsupportedReason}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/20">
              <button
                onClick={handleMicClick}
                disabled={voice.captureMode === null || voice.isTranscribing || createStream.isPending}
                aria-label={voice.isRecording ? "Stop recording" : "Start voice capture"}
                className={cn(
                  "relative flex items-center justify-center w-9 h-9 rounded-lg border transition-all",
                  voice.isRecording
                    ? "border-red-500/40 bg-red-500/10 text-red-500"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
                  "disabled:opacity-40 disabled:cursor-not-allowed"
                )}
              >
                {voice.isRecording ? <Square size={14} className="fill-current" /> : <Mic size={16} />}
                {voice.isRecording && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                )}
              </button>

              <div className="flex items-center gap-3">
                <span className="hidden sm:inline text-[10px] text-muted-foreground/60">
                  Enter to send · Shift+Enter new line
                </span>
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="flex items-center gap-1.5 px-4 h-9 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {createStream.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  Capture
                </button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
