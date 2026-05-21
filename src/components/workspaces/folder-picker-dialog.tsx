'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import {
  ChevronRight,
  FolderPlus,
  Home as HomeIcon,
  Loader2,
  X,
  Eye,
  EyeOff,
  ArrowLeft,
} from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { fsApi, type FsBrowseEntry, type FsBrowseResponse } from '@/lib/api/fs';
import { FileIcon, FolderIcon } from '@/components/file-icon';
import { cn } from '@/lib/utils';

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Path to start at when the dialog opens. Defaults to `~`. */
  initialPath?: string;
  /** Called with the chosen folder path when the user clicks Choose. */
  onChoose: (path: string) => void;
}

/**
 * In-app folder picker. Mirrors Finder's "Choose Folder" panel:
 *
 *   - Breadcrumb at the top, click any segment to jump there
 *   - Scrollable list — single-click selects, double-click drills in
 *   - "New Folder" creates a subdirectory in the current location
 *   - "Show hidden" toggles dotfiles
 *   - "Choose" returns the selected folder, or the current folder if none
 *
 * Works identically whether the server is on localhost or remote — the
 * browsing happens against the *host* filesystem in both cases, which is
 * what the workspace needs (the server has to read/write the folder).
 */
export function FolderPickerDialog({
  open,
  onOpenChange,
  initialPath,
  onChoose,
}: FolderPickerDialogProps) {
  const [cwd, setCwd] = useState(initialPath?.trim() || '~');
  const [browse, setBrowse] = useState<FsBrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [submittingNew, setSubmittingNew] = useState(false);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reqIdRef = useRef(0);

  // Reset to initialPath every time the dialog opens, so a previous
  // navigation doesn't bleed into the next pick.
  useEffect(() => {
    if (!open) return;
    setCwd(initialPath?.trim() || '~');
    setSelected(null);
    setError(null);
    setCreatingFolder(false);
    setNewFolderName('');
    setNewFolderError(null);
  }, [open, initialPath]);

  // Load directory listing whenever cwd or showHidden changes.
  useEffect(() => {
    if (!open) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    fsApi
      .browse(cwd, { showHidden, includeFiles: true })
      .then((res) => {
        if (reqId !== reqIdRef.current) return;
        setBrowse(res);
        // Scroll back to the top whenever we land in a new directory.
        if (listRef.current) listRef.current.scrollTop = 0;
      })
      .catch((err) => {
        if (reqId !== reqIdRef.current) return;
        if (err instanceof ApiError) {
          const body = err.body as { error?: string } | null;
          setError(body?.error ?? `Failed to load (${err.status})`);
        } else {
          setError(String(err));
        }
        setBrowse(null);
      })
      .finally(() => {
        if (reqId !== reqIdRef.current) return;
        setLoading(false);
      });
  }, [open, cwd, showHidden]);

  // Breadcrumb segments, derived from the resolved path the server gave us.
  // We split on the home boundary so the leading segment is "~" rather than
  // the full /Users/foo prefix.
  const breadcrumbs = useMemo(() => {
    if (!browse) return [] as Array<{ label: string; path: string }>;
    const home = browse.home;
    const here = browse.path;
    if (!home || (here !== home && !here.startsWith(home + '/'))) {
      // Outside home — shouldn't happen given the sandbox, but render
      // sensibly anyway.
      return [{ label: here, path: here }];
    }
    const rel = here === home ? '' : here.slice(home.length + 1);
    const parts = rel ? rel.split('/') : [];
    const crumbs: Array<{ label: string; path: string }> = [{ label: '~', path: home }];
    let acc = home;
    for (const part of parts) {
      acc = acc + '/' + part;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }, [browse]);

  const enterFolder = useCallback((entry: FsBrowseEntry) => {
    if (entry.kind !== 'dir') return;
    setCwd(entry.path);
    setSelected(null);
  }, []);

  const handleChoose = useCallback(() => {
    const chosen = selected ?? browse?.path;
    if (!chosen) return;
    onChoose(chosen);
    onOpenChange(false);
  }, [selected, browse, onChoose, onOpenChange]);

  const goUp = useCallback(() => {
    if (browse?.parent) {
      setCwd(browse.parent);
      setSelected(null);
    }
  }, [browse]);

  const goHome = useCallback(() => {
    setCwd('~');
    setSelected(null);
  }, []);

  const startCreateFolder = useCallback(() => {
    setCreatingFolder(true);
    setNewFolderName('');
    setNewFolderError(null);
    // Defer focus until the input has mounted.
    requestAnimationFrame(() => newFolderInputRef.current?.focus());
  }, []);

  const cancelCreateFolder = useCallback(() => {
    setCreatingFolder(false);
    setNewFolderName('');
    setNewFolderError(null);
  }, []);

  const submitCreateFolder = useCallback(async () => {
    if (!browse) return;
    const name = newFolderName.trim();
    if (!name) {
      setNewFolderError('Name is required');
      return;
    }
    setSubmittingNew(true);
    setNewFolderError(null);
    try {
      const res = await fsApi.mkdir(browse.path, name);
      // Refresh the listing so the new folder shows up, then enter it —
      // matches Finder's behavior after creating a new folder.
      setCreatingFolder(false);
      setNewFolderName('');
      setCwd(res.path);
      setSelected(null);
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string } | null;
        setNewFolderError(body?.error ?? `Failed (${err.status})`);
      } else {
        setNewFolderError(String(err));
      }
    } finally {
      setSubmittingNew(false);
    }
  }, [browse, newFolderName]);

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!browse) return;
      if (creatingFolder) return;
      const entries = browse.entries;
      if (entries.length === 0) return;

      const idx = selected ? entries.findIndex((e) => e.path === selected) : -1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = entries[Math.min(entries.length - 1, idx + 1)];
        if (next) setSelected(next.path);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = entries[Math.max(0, idx - 1)];
        if (next) setSelected(next.path);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const current = entries.find((x) => x.path === selected);
        if (current?.kind === 'dir') {
          enterFolder(current);
        } else {
          handleChoose();
        }
      } else if (e.key === 'Backspace' && browse.parent) {
        e.preventDefault();
        goUp();
      }
    },
    [browse, selected, creatingFolder, enterFolder, handleChoose, goUp],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[60] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => {
            // Don't auto-focus the close button; we want the list to be
            // keyboard-navigable as soon as the dialog opens.
            e.preventDefault();
            listRef.current?.focus();
          }}
        >
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Choose a folder</DialogPrimitive.Title>
            <DialogPrimitive.Description>
              Browse the filesystem and pick a folder for your workspace.
            </DialogPrimitive.Description>
          </VisuallyHidden.Root>
          <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col h-[640px] max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <span className="text-xs font-semibold tracking-wide text-foreground">
                Choose a folder
              </span>
              <DialogPrimitive.Close asChild>
                <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <X size={14} />
                </button>
              </DialogPrimitive.Close>
            </div>

            {/* Navigation row */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/20">
              <button
                type="button"
                onClick={goUp}
                disabled={!browse?.parent}
                title="Up one folder"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowLeft size={13} />
              </button>
              <button
                type="button"
                onClick={goHome}
                title="Home"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <HomeIcon size={13} />
              </button>

              <div className="flex items-center gap-0.5 overflow-x-auto whitespace-nowrap text-[11px] font-mono ml-1 flex-1 min-w-0">
                {breadcrumbs.length === 0 && loading && (
                  <span className="text-muted-foreground/60 italic">Loading…</span>
                )}
                {breadcrumbs.map((c, i) => (
                  <span key={c.path} className="flex items-center gap-0.5 shrink-0">
                    {i > 0 && (
                      <ChevronRight size={11} className="text-muted-foreground/50 shrink-0" />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setCwd(c.path);
                        setSelected(null);
                      }}
                      className={cn(
                        'px-1.5 py-0.5 rounded transition-colors',
                        i === breadcrumbs.length - 1
                          ? 'text-foreground font-semibold'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                      )}
                    >
                      {c.label}
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Listing */}
            <div
              ref={listRef}
              tabIndex={0}
              onKeyDown={handleListKeyDown}
              className="flex-1 overflow-y-auto focus:outline-none"
            >
              {loading && !browse && (
                <div className="flex items-center justify-center h-40 text-muted-foreground/60 text-[11px]">
                  <Loader2 size={13} className="animate-spin mr-2" /> Loading…
                </div>
              )}
              {error && !loading && (
                <div className="m-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                  {error}
                </div>
              )}
              {!loading && !error && browse?.entries.length === 0 && (
                <div className="flex items-center justify-center h-40 text-muted-foreground/60 text-[11px] italic">
                  Empty folder
                </div>
              )}
              {browse?.entries.map((entry) => {
                const isSelected = selected === entry.path;
                const isDir = entry.kind === 'dir';
                return (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => {
                      if (!isDir) return;
                      setSelected(entry.path);
                    }}
                    onDoubleClick={() => enterFolder(entry)}
                    disabled={!isDir}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left',
                      'border-b border-border/30 last:border-b-0',
                      isDir
                        ? 'hover:bg-muted/40 cursor-pointer'
                        : 'opacity-50 cursor-default',
                      isSelected && 'bg-primary/10 hover:bg-primary/15',
                    )}
                  >
                    {isDir ? (
                      <FolderIcon name={entry.name} opened={false} size={14} />
                    ) : (
                      <FileIcon name={entry.name} size={14} />
                    )}
                    <span
                      className={cn(
                        'truncate font-mono',
                        isSelected ? 'text-foreground font-medium' : 'text-foreground/90',
                      )}
                    >
                      {entry.name}
                    </span>
                    {isDir && (
                      <ChevronRight
                        size={11}
                        className="ml-auto shrink-0 text-muted-foreground/40"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* New folder input (slides in above the footer when active) */}
            {creatingFolder && (
              <div className="px-3 py-2 border-t border-border bg-muted/10 space-y-1.5">
                <div className="flex items-center gap-2">
                  <FolderIcon name="" opened={false} size={14} />
                  <input
                    ref={newFolderInputRef}
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void submitCreateFolder();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelCreateFolder();
                      }
                    }}
                    placeholder="New folder name"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    disabled={submittingNew}
                    className="flex-1 px-2 py-1 text-[12px] font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={cancelCreateFolder}
                    disabled={submittingNew}
                    className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitCreateFolder}
                    disabled={!newFolderName.trim() || submittingNew}
                    className="px-2 py-1 text-[11px] font-semibold bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    {submittingNew && <Loader2 size={11} className="animate-spin inline mr-1" />}
                    Create
                  </button>
                </div>
                {newFolderError && (
                  <p className="text-[10px] text-destructive">{newFolderError}</p>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border">
              <button
                type="button"
                onClick={startCreateFolder}
                disabled={creatingFolder || !browse}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <FolderPlus size={12} />
                New Folder
              </button>
              <button
                type="button"
                onClick={() => setShowHidden((v) => !v)}
                title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors"
              >
                {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                Hidden files
              </button>
              <div className="ml-auto flex items-center gap-2">
                <DialogPrimitive.Close asChild>
                  <button className="px-3 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors">
                    Cancel
                  </button>
                </DialogPrimitive.Close>
                <button
                  type="button"
                  onClick={handleChoose}
                  disabled={!browse}
                  className="px-3 py-1 text-[11px] font-semibold bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  Choose
                </button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
