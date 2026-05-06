'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { X, Loader2, Archive, ImagePlus, Trash2, SmilePlus } from 'lucide-react';
import { useWorkspace, useUpdateWorkspace, useArchiveWorkspace } from '@/hooks/use-workspaces';
import { useAreas } from '@/hooks/use-areas';
import { api } from '@/lib/api/client';
import { EmojiPicker } from '@/components/shared/emoji-picker';
import { uploadAttachment } from '@/lib/attachments/client';
import type { GhStatus } from '@/lib/workspaces/gh';
import type { Attachment } from '@/db/types';
import { cn } from '@/lib/utils';

interface WorkspaceSettingsSheetProps {
  workspaceId: string | null;
  onClose: () => void;
}

export function WorkspaceSettingsSheet({ workspaceId, onClose }: WorkspaceSettingsSheetProps) {
  const { data: ws } = useWorkspace(workspaceId);
  const { data: areas } = useAreas();
  const update = useUpdateWorkspace();
  const archive = useArchiveWorkspace();

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [areaId, setAreaId] = useState<string | ''>('');
  const [baseBranch, setBaseBranch] = useState('');
  const [worktreeRoot, setWorktreeRoot] = useState('');
  const [gh, setGh] = useState<GhStatus | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ws) return;
    setName(ws.name);
    setEmoji(ws.emoji ?? null);
    setAttachment(ws.attachments?.[0] ?? null);
    setAreaId(ws.area_id ?? '');
    setBaseBranch(ws.base_branch ?? '');
    setWorktreeRoot(ws.worktree_root ?? '');
  }, [ws]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file?.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const uploaded = await uploadAttachment(file);
      setAttachment(uploaded);
      setEmoji(null);
    } catch (err) {
      console.error('[workspace-settings] image upload failed', err);
    } finally {
      setUploading(false);
    }
  };

  // Detect gh on open. The endpoint doesn't exist yet — defer the fetch
  // behind a feature check so the page doesn't error pre-implementation.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    api.get<GhStatus>('/gh/status').then(
      (res) => { if (!cancelled) setGh(res); },
      () => { if (!cancelled) setGh(null); },
    );
    return () => { cancelled = true; };
  }, [workspaceId]);

  const handleSave = () => {
    if (!ws) return;
    update.mutate({
      id: ws.id,
      name: name.trim() || ws.name,
      emoji: emoji || null,
      attachments: attachment ? [attachment] : [],
      area_id: areaId || null,
      base_branch: baseBranch || null,
      worktree_root: worktreeRoot || null,
    });
  };

  const handleArchive = () => {
    if (!ws) return;
    if (!confirm(`Archive "${ws.name}"? Sessions stay; the workspace leaves the active list.`)) return;
    archive.mutate(ws.id, { onSuccess: onClose });
  };

  return (
    <DialogPrimitive.Root open={!!workspaceId} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-50 h-full w-full max-w-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Workspace settings</DialogPrimitive.Title>
            <DialogPrimitive.Description>Edit workspace settings</DialogPrimitive.Description>
          </VisuallyHidden.Root>
          <div className="h-full bg-card border-l border-border flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Workspace settings</h2>
                {ws && (
                  <p className="text-[10px] text-muted-foreground/70 font-mono mt-0.5">
                    {ws.slug}
                  </p>
                )}
              </div>
              <DialogPrimitive.Close asChild>
                <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <X size={16} />
                </button>
              </DialogPrimitive.Close>
            </div>

            {!ws ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                <FieldGroup label="Name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </FieldGroup>

                <FieldGroup label="Icon">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                  {attachment ? (
                    <div className="relative group inline-block">
                      <img
                        src={`/api/attachments/${attachment.file_name}`}
                        alt="Workspace cover"
                        className="w-20 h-20 rounded-xl object-cover border border-border"
                      />
                      <button
                        type="button"
                        onClick={() => setAttachment(null)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <div className="relative group">
                        <EmojiPicker onSelect={(e) => { setEmoji(e); setAttachment(null); }}>
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
                            onClick={() => setEmoji(null)}
                            type="button"
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
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
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    If empty and linked to an area, the area&apos;s icon shows in the rail.
                  </p>
                </FieldGroup>

                <FieldGroup label="Folder">
                  <div className="px-3 py-2 text-xs font-mono bg-muted/40 border border-border rounded-md text-muted-foreground">
                    {ws.cwd}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    Path is fixed at creation. Move the folder to relink.
                  </p>
                </FieldGroup>

                <FieldGroup label="Area">
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
                </FieldGroup>

                {ws.is_git && (
                  <>
                    <FieldGroup label="Base branch">
                      <input
                        value={baseBranch}
                        onChange={(e) => setBaseBranch(e.target.value)}
                        placeholder="main"
                        className="w-full px-3 py-2 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </FieldGroup>

                    <FieldGroup label="Worktree root">
                      <input
                        value={worktreeRoot}
                        onChange={(e) => setWorktreeRoot(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </FieldGroup>
                  </>
                )}

                <div>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Git
                  </h3>
                  <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5 text-[11px]">
                    <Row label="Repo" value={ws.is_git ? 'yes' : 'no (non-git workspace)'} />
                    {ws.is_git && (
                      <Row label="Remote" value={ws.remote_name ?? '—'} mono />
                    )}
                    <GhRow gh={gh} />
                  </div>
                </div>

                <div className="pt-2 border-t border-border/60">
                  <button
                    onClick={handleArchive}
                    className="flex items-center gap-1.5 text-[11px] text-destructive hover:underline"
                  >
                    <Archive size={11} />
                    Archive workspace
                  </button>
                </div>
              </div>
            )}

            {ws && (
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
                <DialogPrimitive.Close asChild>
                  <button className="px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors">
                    Cancel
                  </button>
                </DialogPrimitive.Close>
                <button
                  onClick={handleSave}
                  disabled={update.isPending}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all disabled:opacity-40"
                >
                  {update.isPending && <Loader2 size={14} className="animate-spin" />}
                  Save
                </button>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground/80">{label}</span>
      <span className={cn('text-foreground truncate', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

function GhRow({ gh }: { gh: GhStatus | null }) {
  if (gh === null) return null;
  if (!gh.installed) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 mt-1">
        <p className="text-amber-500 font-medium">gh not found</p>
        <p className="text-muted-foreground mt-0.5">
          Install with <code className="font-mono">brew install gh</code> to enable PR creation.
        </p>
      </div>
    );
  }
  if (!gh.authenticated) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 mt-1">
        <p className="text-amber-500 font-medium">gh installed but not signed in</p>
        <p className="text-muted-foreground mt-0.5">
          Run <code className="font-mono">gh auth login</code> to enable GitHub features.
        </p>
      </div>
    );
  }
  return (
    <>
      <Row label="gh" value={gh.version ?? 'installed'} mono />
      <Row label="user" value={gh.user ?? '—'} mono />
    </>
  );
}
