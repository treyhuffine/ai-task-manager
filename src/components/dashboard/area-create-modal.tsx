"use client";

import { useState, useCallback, useRef, type FormEvent } from "react";
import { Dialog as DialogPrimitive, VisuallyHidden } from "radix-ui";
import { X, Loader2, ImagePlus, Trash2, SmilePlus } from "lucide-react";
import { useCreateArea } from "@/hooks/use-areas";
import { EmojiPicker } from "@/components/shared/emoji-picker";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/db/types";
import { uploadAttachment } from "@/lib/attachments/client";

interface AreaCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AreaCreateModal({ open, onOpenChange }: AreaCreateModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createArea = useCreateArea();

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setEmoji(null);
    setAttachment(null);
  }, []);

  const handleImageSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) return;

      setUploading(true);
      try {
        const uploaded = await uploadAttachment(file);
        setAttachment(uploaded);
      } catch (err) {
        console.error("[area-create] image upload failed", err);
      } finally {
        setUploading(false);
      }
    },
    []
  );

  const handleRemoveImage = useCallback(() => {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName || createArea.isPending) return;

    createArea.mutate(
      {
        name: trimmedName,
        description: description.trim() || undefined,
        emoji: emoji ?? undefined,
        attachments: attachment ? [attachment] : [],
      },
      {
        onSuccess: () => {
          resetForm();
          onOpenChange(false);
        },
      }
    );
  }, [name, description, attachment, emoji, createArea, onOpenChange, resetForm]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleNameInput = useCallback(
    (e: FormEvent<HTMLTextAreaElement>) => {
      const target = e.currentTarget;
      setName(target.value);
      target.style.height = "auto";
      target.style.height = target.scrollHeight + "px";
    },
    []
  );

  const handleDescriptionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) resetForm();
      onOpenChange(open);
    },
    [onOpenChange, resetForm]
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] duration-200">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>New Area</DialogPrimitive.Title>
            <DialogPrimitive.Description>Create a new area</DialogPrimitive.Description>
          </VisuallyHidden.Root>
          <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <span className="text-xs font-semibold tracking-wide text-foreground">
                New Area
              </span>
              <DialogPrimitive.Close asChild>
                <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <X size={16} />
                </button>
              </DialogPrimitive.Close>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {/* Emoji / Image upload */}
              <div className="flex justify-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
                {attachment ? (
                  <div className="relative group">
                    <img
                      src={`/api/attachments/${attachment.file_name}`}
                      alt="Area image"
                      className="w-20 h-20 rounded-xl object-cover border border-border"
                    />
                    <button
                      onClick={handleRemoveImage}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <div className="relative group">
                      <EmojiPicker onSelect={(e) => setEmoji(e)}>
                        <button
                          className={cn(
                            "w-20 h-20 rounded-xl border border-border",
                            "flex flex-col items-center justify-center gap-1",
                            "transition-colors cursor-pointer",
                            emoji
                              ? "text-4xl bg-accent/30"
                              : "border-dashed border-2 text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                          )}
                        >
                          {emoji ? (
                            emoji
                          ) : (
                            <>
                              <SmilePlus size={20} />
                              <span className="text-[9px] font-medium">Emoji</span>
                            </>
                          )}
                        </button>
                      </EmojiPicker>
                      {emoji && (
                        <button
                          onClick={() => setEmoji(null)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className={cn(
                        "w-20 h-20 rounded-xl border-2 border-dashed border-border",
                        "flex flex-col items-center justify-center gap-1",
                        "text-muted-foreground hover:text-foreground hover:border-muted-foreground",
                        "transition-colors cursor-pointer disabled:opacity-50"
                      )}
                    >
                      {uploading ? (
                        <Loader2 size={20} className="animate-spin" />
                      ) : (
                        <>
                          <ImagePlus size={20} />
                          <span className="text-[9px] font-medium">Image</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Name */}
              <div>
                <textarea
                  value={name}
                  onInput={handleNameInput}
                  onKeyDown={handleNameKeyDown}
                  placeholder="Area name"
                  className="w-full text-lg font-semibold bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:outline-none border-b border-border pb-2 text-center resize-none overflow-hidden"
                  autoFocus
                  rows={1}
                />
              </div>

              {/* Description */}
              <div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={handleDescriptionKeyDown}
                  placeholder="Description (optional)"
                  className="w-full h-16 resize-none bg-transparent text-xs text-muted-foreground placeholder:text-muted-foreground/40 focus:outline-none leading-relaxed"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <DialogPrimitive.Close asChild>
                <button className="px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors">
                  Cancel
                </button>
              </DialogPrimitive.Close>
              <button
                onClick={handleSubmit}
                disabled={!name.trim() || createArea.isPending}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {createArea.isPending && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                Create area
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
