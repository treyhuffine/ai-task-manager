'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { X, Loader2, ImagePlus, Trash2, SmilePlus } from 'lucide-react';
import { useCreateWorkspace } from '@/hooks/use-workspaces';
import { useAreas } from '@/hooks/use-areas';
import { ApiError } from '@/lib/api/client';
import { EmojiPicker } from '@/components/shared/emoji-picker';
import { uploadAttachment } from '@/lib/attachments/client';
import { fsApi } from '@/lib/api/fs';
import { cn } from '@/lib/utils';
import type { Attachment } from '@/db/types';
import { FolderPicker } from './folder-picker';
import { FilesToCopySection } from './files-to-copy-section';

const DEFAULT_FILES_TO_COPY = ['.env*'];

interface WorkspaceCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Strip trailing slash, take the last path segment as a default workspace name. */
function deriveNameFromCwd(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, '').trim();
  if (!trimmed) return '';
  const segments = trimmed.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

export function WorkspaceCreateModal({ open, onOpenChange }: WorkspaceCreateModalProps) {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [areaId, setAreaId] = useState<string | ''>('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [filesToCopy, setFilesToCopy] = useState<string[]>(DEFAULT_FILES_TO_COPY);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track manual edits to either the name or the cover image so a later
  // folder change doesn't clobber the user's choices.
  const nameUserEditedRef = useRef(false);
  const coverUserEditedRef = useRef(false);
  // Token guards out-of-order favicon responses when the user changes
  // folders quickly — only the latest request can apply.
  const faviconRequestRef = useRef(0);
  const faviconDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: areas } = useAreas();
  const createWs = useCreateWorkspace();

  const reset = useCallback(() => {
    setName('');
    setCwd('');
    setAreaId('');
    setEmoji(null);
    setAttachment(null);
    setFilesToCopy(DEFAULT_FILES_TO_COPY);
    setError(null);
    nameUserEditedRef.current = false;
    coverUserEditedRef.current = false;
    faviconRequestRef.current = 0;
  }, []);

  const handleImageSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file?.type.startsWith('image/')) return;
      setUploading(true);
      try {
        setAttachment(await uploadAttachment(file));
        coverUserEditedRef.current = true;
      } catch (err) {
        console.error('[workspace-create] image upload failed', err);
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const handleRemoveImage = useCallback(() => {
    setAttachment(null);
    coverUserEditedRef.current = true;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleEmojiSelect = useCallback((e: string) => {
    setEmoji(e);
    coverUserEditedRef.current = true;
  }, []);

  const handleClearEmoji = useCallback(() => {
    setEmoji(null);
    coverUserEditedRef.current = true;
  }, []);

  // Folder selection drives default name + auto-detected cover. The
  // favicon scan is debounced so a typed path doesn't burn a request per
  // keystroke; the request token then guards out-of-order responses.
  const handleCwdChange = useCallback((next: string) => {
    setCwd(next);
    if (!nameUserEditedRef.current) {
      setName(deriveNameFromCwd(next));
    }
    if (coverUserEditedRef.current) return;
    if (faviconDebounceRef.current) clearTimeout(faviconDebounceRef.current);
    const trimmed = next.replace(/\/+$/, '').trim();
    if (!trimmed) {
      setAttachment(null);
      return;
    }
    faviconDebounceRef.current = setTimeout(() => {
      const requestId = ++faviconRequestRef.current;
      fsApi
        .detectFavicon(trimmed)
        .then((res) => {
          if (requestId !== faviconRequestRef.current) return;
          if (coverUserEditedRef.current) return;
          // Reflect server truth: a non-match clears any prior auto-set
          // cover so changing folders doesn't leave a stale icon.
          setAttachment(res.kind === 'found' ? res.attachment : null);
        })
        .catch((err) => console.error('[workspace-create] favicon detect failed', err));
    }, 300);
  }, []);

  // Cleanup the debounce timer on unmount so a late firing doesn't run
  // setState on a torn-down component.
  useEffect(() => {
    return () => {
      if (faviconDebounceRef.current) clearTimeout(faviconDebounceRef.current);
    };
  }, []);

  const handleNameChange = useCallback((next: string) => {
    setName(next);
    nameUserEditedRef.current = true;
  }, []);

  // Reset transient refs when modal closes (handleOpenChange handles it),
  // and also when it re-opens fresh — guard against stale state if React
  // keeps the component mounted between opens.
  useEffect(() => {
    if (!open) return;
    nameUserEditedRef.current = false;
    coverUserEditedRef.current = false;
    faviconRequestRef.current = 0;
  }, [open]);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    const trimmedCwd = cwd.trim();
    if (!trimmed || !trimmedCwd || createWs.isPending) return;

    setError(null);
    createWs.mutate(
      {
        name: trimmed,
        cwd: trimmedCwd,
        area_id: areaId || null,
        emoji: emoji ?? null,
        attachments: attachment ? [attachment] : [],
        files_to_copy: filesToCopy,
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            const body = err.body as { error?: string } | null;
            setError(body?.error ?? `Request failed (${err.status})`);
          } else {
            setError(String(err));
          }
        },
      },
    );
  }, [name, cwd, areaId, emoji, attachment, filesToCopy, createWs, reset, onOpenChange]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>New Workspace</DialogPrimitive.Title>
            <DialogPrimitive.Description>Create a new workspace</DialogPrimitive.Description>
          </VisuallyHidden.Root>
          <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <span className="text-xs font-semibold tracking-wide text-foreground">
                New Workspace
              </span>
              <DialogPrimitive.Close asChild>
                <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <X size={16} />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="p-5 space-y-4">
              {/* Folder is the entry point — name + cover + area gate on
                  this. Auto-derived workspace name and best-effort favicon
                  follow whichever folder the user lands on. */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Folder
                </label>
                <FolderPicker
                  value={cwd}
                  onChange={handleCwdChange}
                  placeholder="~/code/my-project"
                />
                <p className="mt-1 text-[10px] text-muted-foreground/70">
                  Git is detected automatically. Non-git folders work too — they just don&apos;t get worktree isolation.
                </p>
              </div>

              {cwd.trim() && (
                <>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                      Name
                    </label>
                    <input
                      value={name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSubmit();
                        }
                      }}
                      placeholder="bounce-app"
                      className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                      autoFocus
                    />
                  </div>

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
                          alt="Workspace cover"
                          className="w-20 h-20 rounded-xl object-cover border border-border"
                        />
                        <button
                          onClick={handleRemoveImage}
                          type="button"
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <div className="relative group">
                          <EmojiPicker onSelect={handleEmojiSelect}>
                            <button
                              type="button"
                              className={cn(
                                'w-20 h-20 rounded-xl border border-border',
                                'flex flex-col items-center justify-center gap-1',
                                'transition-colors cursor-pointer',
                                emoji
                                  ? 'text-4xl bg-accent/30'
                                  : 'border-dashed border-2 text-muted-foreground hover:text-foreground hover:border-muted-foreground',
                              )}
                            >
                              {emoji ?? (
                                <>
                                  <SmilePlus size={20} />
                                  <span className="text-[9px] font-medium">Emoji</span>
                                </>
                              )}
                            </button>
                          </EmojiPicker>
                          {emoji && (
                            <button
                              onClick={handleClearEmoji}
                              type="button"
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          type="button"
                          disabled={uploading}
                          className={cn(
                            'w-20 h-20 rounded-xl border-2 border-dashed border-border',
                            'flex flex-col items-center justify-center gap-1',
                            'text-muted-foreground hover:text-foreground hover:border-muted-foreground',
                            'transition-colors cursor-pointer disabled:opacity-50',
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

                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                      Area (optional)
                    </label>
                    <select
                      value={areaId}
                      onChange={(e) => setAreaId(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">— None —</option>
                      {areas?.map((area) => (
                        <option key={area.id} value={area.id}>
                          {area.emoji ? `${area.emoji} ${area.name}` : area.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <FilesToCopySection
                    value={filesToCopy}
                    onChange={setFilesToCopy}
                    cwd={cwd}
                  />
                </>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <DialogPrimitive.Close asChild>
                <button className="px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors">
                  Cancel
                </button>
              </DialogPrimitive.Close>
              <button
                onClick={handleSubmit}
                disabled={!name.trim() || !cwd.trim() || createWs.isPending}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {createWs.isPending && <Loader2 size={14} className="animate-spin" />}
                Create workspace
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
