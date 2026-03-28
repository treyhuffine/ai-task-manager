"use client";

import { useState, useRef, useCallback } from "react";
import { Dialog as DialogPrimitive, VisuallyHidden } from "radix-ui";
import { X, Mic, MicOff, Send, Loader2 } from "lucide-react";
import { useCreateStream } from "@/hooks/use-stream";
import { cn } from "@/lib/utils";

interface BrainDumpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BrainDumpModal({ open, onOpenChange }: BrainDumpModalProps) {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [mode, setMode] = useState<"text" | "voice">("text");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createStream = useCreateStream();

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || createStream.isPending) return;

    createStream.mutate(
      { raw_text: trimmed, source: "brain_dump" },
      {
        onSuccess: () => {
          setText("");
          onOpenChange(false);
        },
      }
    );
  }, [text, createStream, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      setIsRecording(false);
      setMode("text");
    } else {
      setIsRecording(true);
      setMode("voice");
      // Voice recording will be wired up later
    }
  }, [isRecording]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setText("");
        setIsRecording(false);
        setMode("text");
      }
      onOpenChange(open);
    },
    [onOpenChange]
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] duration-200">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Brain Dump</DialogPrimitive.Title>
            <DialogPrimitive.Description>Capture your thoughts</DialogPrimitive.Description>
          </VisuallyHidden.Root>
          <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs font-semibold tracking-wide text-foreground">
                  Brain Dump
                </span>
              </div>
              <DialogPrimitive.Close asChild>
                <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <X size={16} />
                </button>
              </DialogPrimitive.Close>
            </div>

            {/* Body */}
            <div className="p-5">
              {mode === "text" ? (
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="What's on your mind? Just dump it here..."
                  className="w-full h-40 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none leading-relaxed"
                  autoFocus
                />
              ) : (
                <div className="h-40 flex flex-col items-center justify-center gap-3">
                  <div
                    className={cn(
                      "w-16 h-16 rounded-full flex items-center justify-center transition-all",
                      isRecording
                        ? "bg-red-500/20 text-red-500 animate-pulse"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Mic size={28} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isRecording
                      ? "Listening..."
                      : "Click the mic to start recording"}
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-border">
              <button
                onClick={toggleRecording}
                className={cn(
                  "p-2 rounded-lg border transition-all",
                  isRecording
                    ? "border-red-500/30 bg-red-500/10 text-red-500"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
              </button>

              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground/50">
                  {mode === "text" ? "Enter to send, Shift+Enter for new line" : ""}
                </span>
                <button
                  onClick={handleSubmit}
                  disabled={!text.trim() || createStream.isPending}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {createStream.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  Send
                </button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
