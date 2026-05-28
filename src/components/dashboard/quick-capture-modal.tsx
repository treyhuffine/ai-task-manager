"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog as DialogPrimitive, VisuallyHidden } from "radix-ui";
import { X, Mic, Square, Send, Loader2, Zap, ImagePlus, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { useCreateStream } from "@/hooks/use-stream";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { LiveWaveform } from "@/components/ui/live-waveform";
import { api, ApiError } from "@/lib/api/client";
import type { StreamRecord } from "@/db/types";
import { cn } from "@/lib/utils";

// Toggle to A/B the attach-image flow:
//   false → stage image in composer, send with text via Capture button
//   true  → send image immediately on pick (previous behavior)
const IMAGE_SENDS_IMMEDIATELY = false;

interface QuickCaptureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= n ? clean : clean.slice(0, n).trimEnd() + "…";
}

function toastCaptured(item: StreamRecord, extra?: { extracted?: string }) {
  const mediaLabel =
    item.media === "voice"
      ? "Voice"
      : item.media === "image"
      ? "Image"
      : "Note";
  const preview = truncate(extra?.extracted || item.rawText || "", 80);
  toast.success(`${mediaLabel} captured`, {
    description: preview || undefined,
  });
}

export function QuickCaptureModal({ open, onOpenChange }: QuickCaptureModalProps) {
  const [text, setText] = useState("");
  const [usedVoice, setUsedVoice] = useState(false);
  const [stagedImages, setStagedImages] = useState<{ file: File; url: string }[]>([]);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
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
    queueMicrotask(() => textareaRef.current?.focus());
  }, [voice.transcript, voice]);

  // Lock the UI into the active omnibox state once any interaction happens
  useEffect(() => {
    if (text.trim() !== "" || stagedImages.length > 0 || voice.isRecording || voice.isTranscribing) {
      setHasInteracted(true);
    }
  }, [text, stagedImages, voice.isRecording, voice.isTranscribing]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
  }, [text]);

  // Revoke object URLs we create for the staged-image preview
  useEffect(() => {
    return () => {
      stagedImages.forEach(img => URL.revokeObjectURL(img.url));
    };
  }, [stagedImages]);

  const clearStagedImage = useCallback((index?: number) => {
    setStagedImages((prev) => {
      if (index === undefined) {
        prev.forEach(img => URL.revokeObjectURL(img.url));
        return [];
      }
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].url);
      newImages.splice(index, 1);
      return newImages;
    });
    if (imageInputRef.current) imageInputRef.current.value = "";
  }, []);

  const resetForm = useCallback(() => {
    setText("");
    setHasInteracted(false);
    setUsedVoice(false);
    setImageError(null);
    setImageUploading(false);
    clearStagedImage();
    voice.clearTranscript();
    if (voice.isRecording) voice.cancelRecording();
  }, [voice, clearStagedImage]);

  const uploadImages = useCallback(
    async (files: File[], caption: string | null) => {
      setImageError(null);
      setImageUploading(true);
      try {
        const form = new FormData();
        files.forEach(file => form.append("file", file));
        if (caption && caption.trim()) form.append("text", caption.trim());
        const res = await api.upload<{ item: StreamRecord; extracted?: string }>(
          "/capture",
          form,
        );
        toastCaptured(res.item, { extracted: res.extracted });
        resetForm();
        onOpenChange(false);
      } catch (err) {
        if (err instanceof ApiError) {
          const body = err.body as { error?: string } | null;
          setImageError(body?.error ?? `Upload failed (${err.status})`);
        } else {
          setImageError(err instanceof Error ? err.message : "Upload failed");
        }
      } finally {
        setImageUploading(false);
      }
    },
    [onOpenChange, resetForm],
  );

  const handleSubmit = useCallback(() => {
    if (createStream.isPending || imageUploading) return;

    if (stagedImages.length > 0) {
      void uploadImages(stagedImages.map(s => s.file), text);
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    createStream.mutate(
      { rawText: trimmed, source: "capture", media: usedVoice ? "voice" : "text" },
      {
        onSuccess: (item) => {
          toastCaptured(item);
          resetForm();
          onOpenChange(false);
        },
      },
    );
  }, [text, usedVoice, stagedImages, createStream, imageUploading, uploadImages, onOpenChange, resetForm]);

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
    [handleSubmit],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) resetForm();
      onOpenChange(next);
    },
    [onOpenChange, resetForm],
  );

  const handleMicClick = useCallback(() => {
    if (voice.captureMode === null) return;
    voice.toggleRecording();
  }, [voice]);

  const handleImageClick = useCallback(() => {
    setImageError(null);
    imageInputRef.current?.click();
  }, []);

  const handleImageChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      setImageError(null);

      if (IMAGE_SENDS_IMMEDIATELY) {
        void uploadImages(files, text);
        if (imageInputRef.current) imageInputRef.current.value = "";
        return;
      }

      // Stage in composer
      const newStaged = files.map(file => ({ file, url: URL.createObjectURL(file) }));
      setStagedImages(prev => [...prev, ...newStaged]);
      // Don't clear the input value here — clearing it *before* React commits the
      // staged-image state fires another 'change' in some browsers. We clear on
      // remove/reset instead.
      queueMicrotask(() => textareaRef.current?.focus());
    },
    [text, uploadImages],
  );

  const hasInput = text.trim().length > 0 || stagedImages.length > 0;
  const canSubmit = hasInput && !createStream.isPending && !imageUploading;
  const hasContent = hasInput || voice.isRecording || voice.isTranscribing;
  const isPristine = !hasInteracted && !hasContent;
  const showWaveform = voice.isRecording && voice.stream;

  const placeholder = voice.isRecording
    ? "Listening…"
    : stagedImages.length > 0
    ? "Add a note for these images (optional)"
    : "What's on your mind?";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[20%] md:top-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 md:-translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Quick Capture</DialogPrimitive.Title>
            <DialogPrimitive.Description>
              Quickly capture a thought into your Stream inbox. Type, speak, or attach an image.
            </DialogPrimitive.Description>
          </VisuallyHidden.Root>

          <div className="rounded-3xl border border-border/80 bg-card shadow-2xl overflow-hidden sm:max-w-[560px] mx-auto w-full flex flex-col">
            
            {/* Extremely Subtle Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <div className="flex items-center gap-2 text-muted-foreground/80">
                <Zap size={14} className="text-primary/80" />
                <span className="text-sm font-medium tracking-tight">Quick capture</span>
              </div>
              <DialogPrimitive.Close asChild>
                <button
                  className="p-1.5 rounded-full bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="px-5 pb-5 pt-2">
              <div className="flex flex-col gap-3">
                <div
                  className={cn(
                    "relative flex flex-col rounded-[20px] transition-all duration-300 bg-background",
                    !isPristine 
                      ? "border border-primary/30 shadow-sm ring-[3px] ring-primary/10" 
                      : "border border-input shadow-sm focus-within:border-primary/40 focus-within:ring-[3px] focus-within:ring-primary/15"
                  )}
                >
                  {/* 1. Top Section: Media Previews (Image) */}
                  {stagedImages.length > 0 && (
                    <div className="px-3 pt-3 pb-1 flex items-start gap-3 overflow-x-auto select-none" style={{ scrollbarWidth: 'none' }}>
                      {stagedImages.map((stage, idx) => (
                        <div key={stage.url} className="relative group shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={stage.url}
                            alt={stage.file.name ?? "Staged image"}
                            className="h-24 w-24 rounded-xl object-cover border border-border shadow-md"
                          />
                          <button
                            onClick={() => clearStagedImage(idx)}
                            aria-label="Remove image"
                            className="absolute -top-2.5 -right-2.5 w-7 h-7 rounded-full bg-background border border-border text-foreground hover:bg-accent flex items-center justify-center shadow-sm transition-transform hover:scale-110"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 2. Middle Section: Dynamic Text Area */}
                  <div className={cn("flex flex-col", isPristine ? "px-1" : "pt-1 px-1")}>
                    <textarea
                      ref={textareaRef}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={placeholder}
                      disabled={createStream.isPending || imageUploading}
                      className={cn(
                        "w-full resize-none bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-50 transition-all duration-300",
                        isPristine 
                          ? "text-xl sm:text-2xl font-light px-4 pt-[20px] pb-[16px] h-[72px]" 
                          : "text-[15px] leading-relaxed px-4 py-3 min-h-[80px] max-h-[400px]"
                      )}
                      rows={isPristine ? 1 : 3}
                      autoFocus
                    />
                    
                    {/* Status indicators */}
                    {(voice.isTranscribing || imageUploading || voice.error || (voice.captureMode === null && voice.unsupportedReason) || imageError) && (
                      <div className="px-4 pb-3 flex flex-col gap-1.5">
                        {voice.isTranscribing && (
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <Loader2 size={14} className="animate-spin text-primary" />
                            Transcribing voice capture...
                          </div>
                        )}
                        {imageUploading && (
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <Loader2 size={14} className="animate-spin text-primary" />
                            Uploading {stagedImages.length > 1 ? "images" : "image"}...
                          </div>
                        )}
                        {voice.error && <div className="text-xs font-medium text-destructive">{voice.error}</div>}
                        {voice.captureMode === null && voice.unsupportedReason && (
                          <div className="text-xs font-medium text-muted-foreground">{voice.unsupportedReason}</div>
                        )}
                        {imageError && <div className="text-xs font-medium text-amber-600 dark:text-amber-500">{imageError}</div>}
                      </div>
                    )}
                  </div>

                  {/* Live waveform while recording (Moved near bottom toolbar) */}
                  {showWaveform && (
                    <div className="mx-2 mb-2 rounded-xl bg-red-400/5 px-4 py-3 flex items-center gap-4 border border-red-500/10">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                      <LiveWaveform
                        stream={voice.stream}
                        active
                        height={28}
                        barColor="currentColor"
                        className="flex-1 text-foreground opacity-80"
                      />
                      <button
                        onClick={handleMicClick}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-600 dark:text-red-500 hover:bg-red-500/20 rounded-[8px] text-xs font-semibold transition-colors shrink-0 outline-none focus:ring-2 focus:ring-red-500/40"
                      >
                        <Square size={12} className="fill-current" />
                        Stop
                      </button>
                    </div>
                  )}

                  {/* 3. Bottom Section: Toolbar (Only shown when NOT pristine) */}
                  {!isPristine && (
                    <div className="flex items-center justify-between p-2 mt-2 border-t border-border/40 bg-muted/10 rounded-b-[20px] animate-in fade-in duration-200">
                      <div className="flex items-center gap-1 focus-within:ring-0 px-1">
                        {!voice.isRecording && (
                          <button
                            onClick={handleMicClick}
                            disabled={voice.captureMode === null || voice.isTranscribing || createStream.isPending || imageUploading}
                            aria-label="Voice capture"
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-muted-foreground hover:bg-background hover:text-foreground hover:shadow-sm border border-transparent disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Mic size={15} />
                            <span className="hidden sm:inline-block">Speak</span>
                          </button>
                        )}

                        <button
                          onClick={handleImageClick}
                          disabled={imageUploading || createStream.isPending || (stagedImages.length > 0 && !IMAGE_SENDS_IMMEDIATELY)}
                          aria-label="Attach image"
                          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-background hover:text-foreground hover:shadow-sm border border-transparent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <ImagePlus size={15} />
                          <span className="hidden sm:inline-block">Image</span>
                        </button>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={handleImageChange}
                        />
                      </div>

                      <div className="flex items-center gap-3 pr-2">
                        <span className="text-[11px] font-medium text-muted-foreground/60 hidden sm:inline-block mr-1">
                          <kbd className="font-sans px-1.5 py-0.5 rounded-md bg-background border border-border shadow-sm">Enter</kbd> to save
                        </span>
                        <button
                          onClick={handleSubmit}
                          disabled={!canSubmit}
                          className={cn(
                            "flex items-center justify-center gap-1.5 px-4 h-9 rounded-lg transition-all font-semibold text-sm",
                            canSubmit 
                              ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/95 hover:shadow-lg active:scale-95" 
                              : "bg-muted text-muted-foreground opacity-50 cursor-not-allowed"
                          )}
                          aria-label="Capture"
                        >
                          {createStream.isPending || imageUploading ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <>
                              <ArrowUp size={16} className="stroke-[2.5px]" />
                              Capture
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* The Pristine Action Cards decoupled from text input */}
                {isPristine && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="grid grid-cols-2 gap-3 h-[110px]">
                      <button 
                        onClick={handleMicClick}
                        disabled={voice.captureMode === null}
                        className="relative flex flex-col items-center justify-center bg-muted/20 border border-border/50 hover:bg-red-500/5 hover:border-red-500/30 transition-all rounded-[14px] group shadow-sm disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden h-full"
                      >
                        <div className="absolute inset-0 bg-gradient-to-t from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="flex flex-col items-center justify-center gap-2 w-full px-4">
                          <div className="w-10 h-10 bg-background shadow-sm border border-border/50 text-red-500 rounded-full flex items-center justify-center group-hover:scale-110 group-hover:border-red-500/40 transition-all shrink-0">
                            <Mic size={18} className="stroke-[2px] opacity-80 group-hover:opacity-100 transition-opacity" />
                          </div>
                          <div className="flex flex-col items-center leading-tight">
                            <span className="font-semibold text-[15px] tracking-tight text-foreground/90">Speak</span>
                            <span className="text-[11px] text-muted-foreground opacity-80">Voice memo</span>
                          </div>
                        </div>
                      </button>

                      <button 
                        onClick={handleImageClick}
                        className="relative flex flex-col items-center justify-center bg-muted/20 border border-border/50 hover:bg-blue-500/5 hover:border-blue-500/30 transition-all rounded-[14px] group shadow-sm overflow-hidden h-full"
                      >
                        <div className="absolute inset-0 bg-gradient-to-t from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="flex flex-col items-center justify-center gap-2 w-full px-4">
                          <div className="w-10 h-10 bg-background shadow-sm border border-border/50 text-blue-500 rounded-full flex items-center justify-center group-hover:scale-110 group-hover:border-blue-500/40 transition-all shrink-0">
                            <ImagePlus size={18} className="stroke-[2px] opacity-80 group-hover:opacity-100 transition-opacity" />
                          </div>
                          <div className="flex flex-col items-center leading-tight">
                            <span className="font-semibold text-[15px] tracking-tight text-foreground/90">Upload</span>
                            <span className="text-[11px] text-muted-foreground opacity-80">Image file</span>
                          </div>
                        </div>
                      </button>
                      
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleImageChange}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
