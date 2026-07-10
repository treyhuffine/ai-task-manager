'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutationState } from '@tanstack/react-query';
import { Loader2, Plus, FilePlus, FolderPlus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/client';
import { copyText } from '@/lib/clipboard';
import {
  useSessionTree,
  useCreateFile,
  useCreateDir,
  useDeletePath,
  useDeleteDir,
  useRenamePath,
  WRITE_FILE_MUTATION_KEY,
} from '@/hooks/use-execution';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ancestorsOfChanged } from './build-tree';
import {
  type ExpandOverrides,
  resolveExpanded,
  setOverride,
  toggleOverride,
  forceOpenAncestors,
  parseOverrides,
  serializeOverrides,
} from './expand-state';
import { TreeList, type PendingCreate, type PendingError } from './tree-list';
import { TreeViewToggle, type TreeViewMode } from './tree-view-toggle';
import { TreeSearchBar } from './tree-search-bar';
import { OpenWorktreeButton } from '../open-worktree-button';

interface FileTreeProps {
  sessionId: string;
  selectedPath: string | null;
  /**
   * `null` clears the viewer's selection (used after deleting the file
   * the user was looking at). Tree row clicks always pass a string.
   */
  onSelect: (path: string | null) => void;
  /**
   * Absolute path of the session's worktree. Lifts the "open in editor"
   * affordance into the tree footer so it lives next to the files
   * instead of stealing space in the global top bar.
   */
  worktreePath: string | null;
  /**
   * Insert `@<relative-path>` at the chat composer's cursor. Wired by
   * `ExecutionView` to the composer's imperative handle. When omitted
   * (e.g., outside the execution view), the "Reference in chat" kebab
   * entry doesn't render.
   */
  onReferenceInChat?: (relativePath: string) => void;
}

const VIEW_MODE_KEY = (id: string) => `flow.execution.tree-view.${id}`;
const EXPANDED_KEY = (id: string) => `flow.execution.tree-expanded.${id}`;

function readPersistedMode(id: string): TreeViewMode {
  // Default to 'all' so the tree doesn't auto-filter to changed files
  // the moment the user's first edit lands. The previous default
  // ('changed') was hidden by the no-changes guard until something
  // changed, then snapped the user into a filtered view they hadn't
  // asked for. 'all' is sticky once chosen via the toggle.
  if (typeof window === 'undefined') return 'all';
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY(id));
    if (raw === 'all' || raw === 'changed') return raw;
  } catch {
    /* ignore */
  }
  return 'all';
}

/**
 * Read the persisted directory expand/collapse overrides for a session.
 * The tri-state model + format details live in `./expand-state`.
 */
function readPersistedOverrides(id: string): ExpandOverrides {
  if (typeof window === 'undefined') return new Map();
  try {
    return parseOverrides(window.localStorage.getItem(EXPANDED_KEY(id)));
  } catch {
    return new Map();
  }
}

interface DeleteTarget {
  path: string;
  kind: 'file' | 'dir';
}

/**
 * The file tree column of the execution view. Owns:
 *
 *   - View mode (`changed` vs `all`), persisted per-session.
 *   - Directory expand/collapse state, persisted per-session.
 *   - CRUD orchestration: in-flight create / rename, delete confirm,
 *     mutation hooks. The actual tree rows + virtualization live in
 *     `TreeList`; row click / kebab actions bubble back up here.
 *
 * Selected-path state is lifted to `ExecutionView` so the viewer in the
 * sibling column can render the chosen file without prop drilling
 * through unrelated panels.
 */
export function FileTree({
  sessionId,
  selectedPath,
  onSelect,
  worktreePath,
  onReferenceInChat,
}: FileTreeProps) {
  const { data: tree, isFetching } = useSessionTree(sessionId);
  const entries = useMemo(() => tree?.entries ?? [], [tree?.entries]);

  const [mode, setModeState] = useState<TreeViewMode>(() => readPersistedMode(sessionId));
  // Explicit user expand/collapse intent per dir. See `./expand-state`.
  const [overrides, setOverridesState] = useState<ExpandOverrides>(() =>
    readPersistedOverrides(sessionId),
  );
  // Search query is intentionally ephemeral — not persisted. Different
  // sessions are different mental contexts; carrying a stale filter
  // across them would mostly confuse rather than help.
  const [query, setQuery] = useState('');

  // Re-read persisted state when navigating between sessions.
  useEffect(() => {
    setModeState(readPersistedMode(sessionId));
    setOverridesState(readPersistedOverrides(sessionId));
    setQuery('');
  }, [sessionId]);

  const setMode = useCallback(
    (next: TreeViewMode) => {
      setModeState(next);
      try {
        window.localStorage.setItem(VIEW_MODE_KEY(sessionId), next);
      } catch {
        /* ignore */
      }
    },
    [sessionId],
  );

  const writeExpandedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setOverrides = useCallback(
    (updater: (prev: ExpandOverrides) => ExpandOverrides) => {
      setOverridesState((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        if (writeExpandedTimer.current) clearTimeout(writeExpandedTimer.current);
        writeExpandedTimer.current = setTimeout(() => {
          try {
            window.localStorage.setItem(EXPANDED_KEY(sessionId), serializeOverrides(next));
          } catch {
            /* ignore */
          }
        }, 200);
        return next;
      });
    },
    [sessionId],
  );

  // Ancestors of every changed file default to expanded so the user sees
  // their changes without drilling in. Computed from the full entries
  // (unfiltered) so search pruning never collapses a change out of view.
  const autoExpanded = useMemo(() => ancestorsOfChanged(entries), [entries]);

  // The effective expand set the tree renders: the auto-expand defaults
  // with the user's explicit overrides applied on top. This is the single
  // source of truth for both display and toggle direction, so a manual
  // collapse of an auto-expanded folder actually takes effect.
  const effectiveExpanded = useMemo(
    () => resolveExpanded(autoExpanded, overrides),
    [autoExpanded, overrides],
  );

  const toggleDir = useCallback(
    (path: string) => {
      const currentlyOpen = effectiveExpanded.has(path);
      setOverrides((prev) => toggleOverride(prev, autoExpanded, path, currentlyOpen));
    },
    [effectiveExpanded, autoExpanded, setOverrides],
  );

  const ensureExpanded = useCallback(
    (path: string) => {
      if (!path) return;
      setOverrides((prev) => setOverride(prev, autoExpanded, path, true));
    },
    [autoExpanded, setOverrides],
  );

  /** Walk every ancestor of a path and force them open so the user can
   * see a freshly-created file at depth without manual drilling. */
  const expandAncestors = useCallback(
    (path: string) => {
      if (!path) return;
      setOverrides((prev) => forceOpenAncestors(prev, autoExpanded, path));
    },
    [autoExpanded, setOverrides],
  );

  const changedEntries = useMemo(
    () => entries.filter((e) => !!e.status),
    [entries],
  );
  const changedCount = changedEntries.length;
  const totalCount = entries.length;
  // Always honor the user's chosen mode — including when it's 'changed'
  // with zero matches, which renders an empty list and is a valid "no
  // changes yet" signal next to the toggle's `(0)`.
  const effectiveMode: TreeViewMode = mode;

  // Match count drives the small "n/m" pill in the search bar — same
  // filter the TreeList applies, so the user trusts that the count
  // matches what's visible. Computed against the current effectiveMode
  // so 'changed' mode counts only changed matches.
  const trimmedQuery = query.trim();
  const matchCount = useMemo(() => {
    if (!trimmedQuery) return undefined;
    const q = trimmedQuery.toLowerCase();
    const pool = effectiveMode === 'changed' ? changedEntries : entries;
    let n = 0;
    for (const e of pool) if (e.path.toLowerCase().includes(q)) n++;
    return n;
  }, [trimmedQuery, effectiveMode, entries, changedEntries]);
  const searchTotal = effectiveMode === 'changed' ? changedCount : totalCount;

  // ─── CRUD state ─────────────────────────────────────────────

  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [pendingCreateError, setPendingCreateError] = useState<PendingError | null>(null);

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pendingRenameError, setPendingRenameError] = useState<PendingError | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const createFile = useCreateFile(sessionId);
  const createDir = useCreateDir(sessionId);
  const deleteFile = useDeletePath(sessionId);
  const deleteDir = useDeleteDir(sessionId);
  const renamePath = useRenamePath(sessionId);

  // Subscribe to in-flight write-file mutations so we can show a
  // per-row spinner while a file is being saved (autosave-on-blur fires
  // these from the file viewer).
  const savingPathList = useMutationState({
    filters: { mutationKey: WRITE_FILE_MUTATION_KEY(sessionId), status: 'pending' },
    select: (mutation) =>
      (mutation.state.variables as { path?: string } | undefined)?.path ?? null,
  });
  const savingPaths = useMemo(
    () => new Set(savingPathList.filter((p): p is string => !!p)),
    [savingPathList],
  );

  const beginCreate = useCallback(
    (parentPath: string, kind: 'file' | 'dir') => {
      // Force the parent open so the input row is visible.
      if (parentPath) ensureExpanded(parentPath);
      setRenamingPath(null);
      setPendingCreateError(null);
      setPendingCreate({ parentPath, kind });
      // Make sure we're in 'all' mode — 'changed' filters out everything
      // unmodified, including the new file we're about to create.
      if (mode !== 'all') setMode('all');
    },
    [ensureExpanded, mode, setMode],
  );

  const cancelCreate = useCallback(() => {
    setPendingCreate(null);
    setPendingCreateError(null);
  }, []);

  const submitCreate = useCallback(
    async (name: string) => {
      if (!pendingCreate) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      // Accept slashes — the user typed `folder/sub/file.ts` to create
      // intermediate dirs. The server's mkdir -p handles the chain.
      const fullPath = pendingCreate.parentPath
        ? `${pendingCreate.parentPath}/${trimmed}`
        : trimmed;
      setPendingCreateError(null);
      try {
        if (pendingCreate.kind === 'file') {
          await createFile.mutateAsync(fullPath);
          // After the cache invalidation lands, expand parent dirs and
          // open the new file in the viewer.
          expandAncestors(fullPath);
          onSelect(fullPath);
        } else {
          await createDir.mutateAsync(fullPath);
          expandAncestors(fullPath);
          ensureExpanded(fullPath);
        }
        setPendingCreate(null);
      } catch (err) {
        setPendingCreateError({ message: errorMessage(err) });
      }
    },
    [pendingCreate, createFile, createDir, expandAncestors, ensureExpanded, onSelect],
  );

  const beginRename = useCallback((path: string, _kind: 'file' | 'dir') => {
    setPendingCreate(null);
    setPendingRenameError(null);
    setRenamingPath(path);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingPath(null);
    setPendingRenameError(null);
  }, []);

  const submitRename = useCallback(
    async (newName: string) => {
      if (!renamingPath) return;
      const trimmed = newName.trim();
      if (!trimmed) return;
      // The user types just the new basename (Finder-style rename); we
      // re-attach the parent dir. If they typed slashes we accept that
      // as a "move into subdir" gesture — server uses mkdir -p.
      const slash = renamingPath.lastIndexOf('/');
      const parent = slash === -1 ? '' : renamingPath.slice(0, slash);
      const newPath = parent ? `${parent}/${trimmed}` : trimmed;
      if (newPath === renamingPath) {
        setRenamingPath(null);
        return;
      }
      setPendingRenameError(null);
      try {
        await renamePath.mutateAsync({ from: renamingPath, to: newPath });
        // If the renamed path was the user's current selection, keep
        // them on it under the new name so the viewer follows the file.
        if (selectedPath === renamingPath) {
          onSelect(newPath);
        }
        // Same-prefix selection (e.g. renamed the parent dir of the
        // current file) → rebase the prefix.
        else if (selectedPath?.startsWith(renamingPath + '/')) {
          onSelect(newPath + selectedPath.slice(renamingPath.length));
        }
        setRenamingPath(null);
      } catch (err) {
        setPendingRenameError({ message: errorMessage(err) });
      }
    },
    [renamingPath, renamePath, selectedPath, onSelect],
  );

  const requestDelete = useCallback((path: string, kind: 'file' | 'dir') => {
    setDeleteTarget({ path, kind });
  }, []);

  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  const isDeleting = deleteFile.isPending || deleteDir.isPending;

  const copyRelativePath = useCallback((path: string) => {
    void copyText(path, 'Relative path copied');
  }, []);

  const copyAbsolutePath = useCallback(
    (path: string) => {
      if (!worktreePath) return;
      const full = `${worktreePath.replace(/\/$/, '')}/${path}`;
      void copyText(full, 'Absolute path copied');
    },
    [worktreePath],
  );

  const referenceInChat = useCallback(
    (path: string) => {
      onReferenceInChat?.(path);
    },
    [onReferenceInChat],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === 'file') {
        await deleteFile.mutateAsync(deleteTarget.path);
      } else {
        await deleteDir.mutateAsync(deleteTarget.path);
      }
      // Clear selection if the user just removed the file they were
      // viewing (or any descendant of a deleted dir).
      if (
        selectedPath &&
        (selectedPath === deleteTarget.path ||
          selectedPath.startsWith(deleteTarget.path + '/'))
      ) {
        onSelect(null);
      }
      setDeleteTarget(null);
    } catch (err) {
      toast.error(`Delete failed: ${errorMessage(err)}`);
    }
  }, [deleteTarget, deleteFile, deleteDir, selectedPath, onSelect]);

  return (
    <div className="flex h-full w-full flex-col border-r border-border bg-background min-w-0">
      {/* Title row — "Files" + create-new sit together on the left,
          "Open in editor" anchors the right. The Diff/All toggle lives
          on its own row below this so it can take the full column
          width even on narrow tree columns. */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70 px-1">
            Files
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Create new"
              title="Create new file or folder"
            >
              <Plus size={13} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4} className="min-w-40">
              <DropdownMenuItem onClick={() => beginCreate('', 'file')}>
                <FilePlus size={14} />
                New file
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => beginCreate('', 'dir')}>
                <FolderPlus size={14} />
                New folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {worktreePath && (
          <div className="min-w-0 flex-shrink-0">
            <OpenWorktreeButton path={worktreePath} />
          </div>
        )}
      </div>

      <div className="border-b border-border px-2 py-1 min-w-0">
        <TreeViewToggle
          mode={effectiveMode}
          onChange={setMode}
          changedCount={changedCount}
        />
      </div>

      <TreeSearchBar
        query={query}
        onChange={setQuery}
        matchCount={matchCount}
        totalCount={searchTotal}
      />

      {/* Body */}
      <div className="flex-1 min-h-0">
        {entries.length === 0 && (isFetching || !worktreePath) ? (
          // Worktree still provisioning, or a (re)fetch in flight with nothing
          // cached yet → show the spinner, never a misleading "No files".
          <div className="flex h-full items-center justify-center">
            <Loader2 size={14} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <TreeList
            entries={entries}
            mode={effectiveMode}
            selectedPath={selectedPath}
            onSelect={onSelect}
            expanded={effectiveExpanded}
            onToggleDir={toggleDir}
            filterQuery={trimmedQuery}
            savingPaths={savingPaths}
            onRename={beginRename}
            onDelete={requestDelete}
            onCreateFile={(p) => beginCreate(p, 'file')}
            onCreateFolder={(p) => beginCreate(p, 'dir')}
            onCopyRelativePath={copyRelativePath}
            onCopyAbsolutePath={worktreePath ? copyAbsolutePath : undefined}
            onReferenceInChat={onReferenceInChat ? referenceInChat : undefined}
            pendingCreate={pendingCreate}
            pendingCreateBusy={createFile.isPending || createDir.isPending}
            pendingCreateError={pendingCreateError}
            onSubmitCreate={submitCreate}
            onCancelCreate={cancelCreate}
            renamingPath={renamingPath}
            pendingRenameBusy={renamePath.isPending}
            pendingRenameError={pendingRenameError}
            onSubmitRename={submitRename}
            onCancelRename={cancelRename}
          />
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && cancelDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.kind === 'dir' ? 'folder' : 'file'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono text-xs break-all">{deleteTarget?.path}</span>
              <br />
              {deleteTarget?.kind === 'dir'
                ? 'The folder and everything inside it will be removed from the worktree. You can still recover with git if it was tracked.'
                : 'The file will be removed from the worktree. You can still recover with git if it was tracked.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; code?: string } | null;
    if (body?.error) return body.error;
    if (body?.code === 'exists') return 'Already exists';
    return `HTTP ${err.status}`;
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}
