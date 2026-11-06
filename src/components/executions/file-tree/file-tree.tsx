'use client';

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
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	useCreateDir,
	useCreateFile,
	useDeleteDir,
	useDeletePath,
	useFolderTree,
	useRenamePath,
	useUploadFile,
	writeFileMutationKey,
} from '@/hooks/use-folder';
import { apiErrorBody, apiErrorStatus, apiErrorText } from '@/lib/api/client';
import { copyText } from '@/lib/clipboard';
import { folderIsWritable, type FolderSource } from '@/lib/folders/source';
import { useMutationState } from '@tanstack/react-query';
import { FilePlus, FolderPlus, Loader2, Plus, Upload } from 'lucide-react';
import { useCallback, useImperativeHandle, useMemo, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { OpenWorktreeButton } from '../open-worktree-button';
import { TreeRowsSkeleton } from '../skeletons';
import { ancestorsOfChanged, expandableDirPaths } from './build-tree';
import {
	anyFolderOpen,
	collapseAll,
	collapseEvery,
	defaultOpen,
	expandAll,
	forceOpenAncestors,
	parseExpandState,
	resolveExpanded,
	serializeExpandState,
	setOverride,
	toggleOverride,
	type ExpandOverrides,
	type ExpandState,
} from './expand-state';
import { TreeCollapseAllButton } from './tree-collapse-all-button';
import { TreeList, type PendingCreate, type PendingError } from './tree-list';
import { TreeSearchBar } from './tree-search-bar';
import { TreeViewToggle, type TreeViewMode } from './tree-view-toggle';
import { Tip } from '@/components/ui/tip';

interface FileTreeProps {
  /**
   * The folder to list: an execution's worktree (through a session, which
   * also addresses the file mutations) or an agent's own folder. Archived
   * agents are read-only, so their write controls are hidden.
   */
  source: FolderSource;
  /**
   * Identity of the worktree being browsed — the execution id, or the
   * chat's own id when it has no execution. Persisted view mode and
   * expand/collapse state key off this, not `sessionId`: the tree shows
   * the execution's files, so starting a new chat on the same worktree
   * must not collapse everything the user had opened.
   */
  worktreeId: string;
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
  /**
   * Render the tree's own title row (FILES, New, open-in-app). The
   * execution workbench turns it off and puts those controls in the Files
   * view's full-width top bar instead, where they have room.
   */
  titleRow?: boolean;
  /** Lets a host's own toolbar create or upload files in the tree. */
  controlRef?: React.Ref<FileTreeHandle>;
  /** A shortcut hint shown in the empty search field, e.g. "⌘P". */
  searchShortcut?: string;
}

/** What a host toolbar can ask the tree to do. */
export interface FileTreeHandle {
  /** Start creating a file or folder at the root, as the tree's own New menu does. */
  beginCreate: (kind: 'file' | 'dir') => void;
  uploadFiles: () => void;
}

const VIEW_MODE_KEY = (id: string) => `ri.execution.tree-view.${id}`;
const EXPANDED_KEY = (id: string) => `ri.execution.tree-expanded.${id}`;

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
 * Read the persisted directory expand/collapse state for a session.
 * The model + format details live in `./expand-state`.
 */
function readPersistedExpand(id: string): ExpandState {
  if (typeof window === 'undefined') return parseExpandState(null);
  try {
    return parseExpandState(window.localStorage.getItem(EXPANDED_KEY(id)));
  } catch {
    return parseExpandState(null);
  }
}

/** Folders opened or closed during one search, kept with the search they belong to. */
interface SearchExpand {
  query: string;
  overrides: ExpandOverrides;
}

const NO_SEARCH_EXPAND: SearchExpand = { query: '', overrides: new Map() };

interface DeleteTarget {
  path: string;
  kind: 'file' | 'dir';
}

/**
 * The file tree in the execution workbench's Files view (and the Agents
 * view's Files tool). Owns:
 *
 *   - View mode (`changed` vs `all`), persisted per-session.
 *   - Directory expand/collapse state, persisted per-session, with
 *     Collapse / Expand all. Search keeps its own, unpersisted.
 *   - CRUD orchestration: in-flight create / rename, delete confirm,
 *     mutation hooks. The actual tree rows + virtualization live in
 *     `TreeList`; row click / kebab actions bubble back up here.
 *
 * Selected-path state is lifted to `ExecutionView` so the viewer in the
 * sibling column can render the chosen file without prop drilling
 * through unrelated panels.
 */
export function FileTree({
  source,
  worktreeId,
  selectedPath,
  onSelect,
  worktreePath,
  onReferenceInChat,
  titleRow = true,
  controlRef,
  searchShortcut,
}: FileTreeProps) {
  const writable = folderIsWritable(source);
  const { data: tree, isFetching, error, refetch } = useFolderTree(source);
  const entries = useMemo(() => tree?.entries ?? [], [tree?.entries]);

  const [mode, setModeState] = useState<TreeViewMode>(() => readPersistedMode(worktreeId));
  // Explicit user expand/collapse intent per dir. See `./expand-state`.
  const [expand, setExpandState] = useState<ExpandState>(() => readPersistedExpand(worktreeId));
  // Search query is intentionally ephemeral — not persisted. Different
  // worktrees are different mental contexts; carrying a stale filter
  // across them would mostly confuse rather than help.
  const [query, setQuery] = useState('');
  // Search opens every folder in its results so the matches show. Folders
  // the user opens or closes on top of that live here, tagged with their
  // query: a new search starts with everything open again, and none of it
  // touches the persisted state the tree returns to when search clears.
  const [searchExpand, setSearchExpand] = useState<SearchExpand>(NO_SEARCH_EXPAND);

  // Re-read persisted state when navigating between worktrees, during
  // render rather than in an effect, so the old worktree's state never
  // paints against the new one's files.
  const [stateFor, setStateFor] = useState(worktreeId);
  if (stateFor !== worktreeId) {
    setStateFor(worktreeId);
    setModeState(readPersistedMode(worktreeId));
    setExpandState(readPersistedExpand(worktreeId));
    setQuery('');
    setSearchExpand(NO_SEARCH_EXPAND);
  }

  const setMode = useCallback(
    (next: TreeViewMode) => {
      setModeState(next);
      try {
        window.localStorage.setItem(VIEW_MODE_KEY(worktreeId), next);
      } catch {
        /* ignore */
      }
    },
    [worktreeId],
  );

  const writeExpandedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setExpand = useCallback(
    (updater: (prev: ExpandState) => ExpandState) => {
      setExpandState((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        if (writeExpandedTimer.current) clearTimeout(writeExpandedTimer.current);
        writeExpandedTimer.current = setTimeout(() => {
          try {
            window.localStorage.setItem(EXPANDED_KEY(worktreeId), serializeExpandState(next));
          } catch {
            /* ignore */
          }
        }, 200);
        return next;
      });
    },
    [worktreeId],
  );

  // Ancestors of every changed file default to expanded so the user sees
  // their changes without drilling in. Computed from the full entries
  // (unfiltered) so search pruning never collapses a change out of view.
  const autoExpanded = useMemo(() => ancestorsOfChanged(entries), [entries]);
  // Every folder that can open: what Expand all opens.
  const allDirs = useMemo(() => expandableDirPaths(entries), [entries]);

  // Search narrows the entries here, once, for the list, the match count
  // and the folders search opens. It matches the full path, not just the
  // basename, so the user can scope by dir segment ("components/ui").
  const trimmedQuery = query.trim();
  const filtering = trimmedQuery.length > 0;
  const filteredEntries = useMemo(() => {
    if (!trimmedQuery) return entries;
    const q = trimmedQuery.toLowerCase();
    return entries.filter((e) => e.path.toLowerCase().includes(q));
  }, [entries, trimmedQuery]);
  // The folders on screen to open or close: the whole tree's, or the
  // search results'. Search opens all of them by default.
  const visibleDirs = useMemo(
    () => (filtering ? expandableDirPaths(filteredEntries) : allDirs),
    [filtering, filteredEntries, allDirs],
  );
  const searchOverrides =
    searchExpand.query === trimmedQuery ? searchExpand.overrides : NO_SEARCH_EXPAND.overrides;

  // The effective expand set the tree renders: the defaults (auto-expand,
  // or every folder after Expand all, or every result while searching)
  // with the user's explicit overrides applied on top. This is the single
  // source of truth for both display and toggle direction, so a manual
  // collapse of an auto-expanded folder actually takes effect.
  const effectiveExpanded = useMemo(
    () =>
      filtering
        ? resolveExpanded(visibleDirs, searchOverrides)
        : resolveExpanded(defaultOpen(expand.base, autoExpanded, allDirs), expand.overrides),
    [filtering, visibleDirs, searchOverrides, expand, autoExpanded, allDirs],
  );

  const toggleDir = useCallback(
    (path: string) => {
      const currentlyOpen = effectiveExpanded.has(path);
      if (filtering) {
        setSearchExpand({
          query: trimmedQuery,
          overrides: toggleOverride(searchOverrides, visibleDirs, path, currentlyOpen),
        });
        return;
      }
      setExpand((prev) => ({
        ...prev,
        overrides: toggleOverride(prev.overrides, defaultOpen(prev.base, autoExpanded, allDirs), path, currentlyOpen),
      }));
    },
    [effectiveExpanded, filtering, trimmedQuery, searchOverrides, visibleDirs, autoExpanded, allDirs, setExpand],
  );

  /**
   * Open folders for a create: in the persisted state, so they stay open
   * after search clears, and in the current search's, so the new-name
   * field and the new entry show now.
   */
  const openFolders = useCallback(
    (update: (overrides: ExpandOverrides, defaults: ReadonlySet<string>) => ExpandOverrides) => {
      setExpand((prev) => ({
        ...prev,
        overrides: update(prev.overrides, defaultOpen(prev.base, autoExpanded, allDirs)),
      }));
      if (filtering) {
        setSearchExpand({ query: trimmedQuery, overrides: update(searchOverrides, visibleDirs) });
      }
    },
    [autoExpanded, allDirs, filtering, trimmedQuery, searchOverrides, visibleDirs, setExpand],
  );

  const ensureExpanded = useCallback(
    (path: string) => {
      if (!path) return;
      openFolders((overrides, defaults) => setOverride(overrides, defaults, path, true));
    },
    [openFolders],
  );

  /** Walk every ancestor of a path and force them open so the user can
   * see a freshly-created file at depth without manual drilling. */
  const expandAncestors = useCallback(
    (path: string) => {
      if (!path) return;
      openFolders((overrides, defaults) => forceOpenAncestors(overrides, defaults, path));
    },
    [openFolders],
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

  // Match count drives the small "n/m" pill in the search bar — the same
  // entries the TreeList renders, so the user trusts that the count
  // matches what's visible. Computed against the current effectiveMode
  // so 'changed' mode counts only changed matches.
  const matchCount = useMemo(() => {
    if (!filtering) return undefined;
    if (effectiveMode !== 'changed') return filteredEntries.length;
    let n = 0;
    for (const e of filteredEntries) if (e.status) n++;
    return n;
  }, [filtering, effectiveMode, filteredEntries]);
  const searchTotal = effectiveMode === 'changed' ? changedCount : totalCount;

  // Collapse / Expand all. Collapses while any folder shows open, else
  // opens every one. Acts on what's on screen: the search's own folders
  // while searching, the persisted state otherwise.
  const anyOpen = anyFolderOpen(visibleDirs, effectiveExpanded);
  const toggleAllFolders = useCallback(() => {
    if (filtering) {
      setSearchExpand({ query: trimmedQuery, overrides: anyOpen ? collapseEvery(visibleDirs) : new Map() });
      return;
    }
    setExpand(() => (anyOpen ? collapseAll(autoExpanded) : expandAll()));
  }, [filtering, trimmedQuery, anyOpen, visibleDirs, autoExpanded, setExpand]);
  const collapseDisabledReason =
    effectiveMode === 'changed'
      ? 'Changes lists files without folders'
      : visibleDirs.size === 0
        ? filtering
          ? 'No folders in these results'
          : 'No folders here'
        : undefined;

  // ─── CRUD state ─────────────────────────────────────────────

  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [pendingCreateError, setPendingCreateError] = useState<PendingError | null>(null);

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pendingRenameError, setPendingRenameError] = useState<PendingError | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const createFile = useCreateFile(source);
  const createDir = useCreateDir(source);
  const deleteFile = useDeletePath(source);
  const deleteDir = useDeleteDir(source);
  const renamePath = useRenamePath(source);
  const uploadFile = useUploadFile(source);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadBusy = useRef(false);
  const dragDepth = useRef(0);
  const [dropDirectory, setDropDirectory] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  const pickFiles = useCallback(() => {
    if (writable && worktreePath && !uploadBusy.current) fileInput.current?.click();
  }, [writable, worktreePath]);

  const uploadFiles = useCallback(async (files: File[], parentPath: string) => {
    if (!writable || !worktreePath || files.length === 0 || uploadBusy.current) return;
    uploadBusy.current = true;
    setQuery('');
    setMode('all');
    let uploaded = 0;
    let firstPath: string | null = null;
    try {
      for (const [index, file] of files.entries()) {
        setUploadProgress({ current: index + 1, total: files.length });
        const path = parentPath ? `${parentPath}/${file.name}` : file.name;
        try {
          if (file.size > 50 * 1024 * 1024) throw new Error('This file is larger than the 50 MiB limit.');
          await uploadFile.mutateAsync({ path, file });
          uploaded++;
          firstPath ??= path;
          expandAncestors(path);
        } catch (err) {
          toast.error(`${file.name}: ${errorMessage(err)}`);
        }
      }
      if (firstPath) onSelect(firstPath);
      if (uploaded) toast.success(uploaded === 1 ? 'File uploaded' : `${uploaded} files uploaded`);
    } finally {
      uploadBusy.current = false;
      setUploadProgress(null);
    }
  }, [writable, worktreePath, setMode, uploadFile, expandAncestors, onSelect]);

  const dragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    const allowed = writable && !!worktreePath && !uploadBusy.current;
    event.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
    if (allowed) {
      const row = (event.target as Element).closest<HTMLElement>('[data-file-drop-directory]');
      setDropDirectory(row?.dataset.fileDropDirectory ?? '');
    }
  };

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDropDirectory(null);
    const row = (event.target as Element).closest<HTMLElement>('[data-file-drop-directory]');
    const parentPath = row?.dataset.fileDropDirectory ?? '';
    // Folder import needs a different picker and traversal. Say so instead of
    // creating an empty file with the dropped folder's name.
    const items = Array.from(event.dataTransfer.items);
    const directories = items.filter((item) => item.webkitGetAsEntry?.()?.isDirectory);
    if (directories.length) toast.error('Choose files inside the folder to upload them.');
    const files = items.length
      ? items.filter((item) => item.kind === 'file' && !item.webkitGetAsEntry?.()?.isDirectory)
        .map((item) => item.getAsFile()).filter((file): file is File => file !== null)
      : Array.from(event.dataTransfer.files);
    void uploadFiles(files, parentPath);
  };

  // Subscribe to in-flight write-file mutations so we can show a
  // per-row spinner while a file is being saved (autosave-on-blur fires
  // these from the file viewer).
  const savingPathList = useMutationState({
    filters: { mutationKey: writeFileMutationKey(source), status: 'pending' },
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

  useImperativeHandle(controlRef, () => ({ beginCreate: (kind) => beginCreate('', kind), uploadFiles: pickFiles }), [beginCreate, pickFiles]);

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
    <div
      className="relative flex h-full w-full flex-col border-r border-border bg-background min-w-0"
      onDragOverCapture={dragOver}
      onDragEnterCapture={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        dragOver(event);
      }}
      onDragLeaveCapture={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDropDirectory(null);
        }
      }}
      onDropCapture={dropFiles}
    >
      {writable && <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        aria-label="Upload files"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void uploadFiles(files, '');
        }}
      />}
      {dropDirectory !== null && (
        <div className="pointer-events-none absolute inset-0 z-20 rounded border-2 border-primary">
          <div className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground shadow">
            <Upload size={14} className="shrink-0" />
            <span className="truncate">Upload to {dropDirectory || 'root folder'}</span>
          </div>
        </div>
      )}
      {/* Title row — "Files" + create-new sit together on the left,
          "Open in editor" anchors the right. Hosts with their own toolbar
          (the execution workbench's Files view) turn it off. */}
      {titleRow && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5 min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70 px-1">
              Files
            </span>
            {writable && (
            // Non-modal so the new-name field can take focus as it closes.
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Tip label="Create or upload files">
                  <button
                    className="inline-flex items-center justify-center p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    aria-label="Create new"
                  >
                    <Plus size={13} />
                  </button>
                </Tip>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                sideOffset={4}
                className="min-w-40"
                // The inline name field focuses itself. Don't hand focus back
                // to this trigger on close, or it steals it from the field.
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <DropdownMenuItem onClick={() => beginCreate('', 'file')}>
                  <FilePlus size={14} />
                  New file
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => beginCreate('', 'dir')}>
                  <FolderPlus size={14} />
                  New folder
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!worktreePath || !!uploadProgress} onClick={pickFiles}>
                  <Upload size={14} />
                  Upload files
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            )}
          </div>
          {worktreePath && (
            <div className="min-w-0 flex-shrink-0">
              <OpenWorktreeButton path={worktreePath} source={source} />
            </div>
          )}
        </div>
      )}

      {/* Find first, then narrow: search on top with Collapse / Expand
          all beside it, the full-width All / Changes switch under it. */}
      <div className="flex flex-col gap-1.5 border-b border-border p-2 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <div className="flex-1 min-w-0">
            <TreeSearchBar
              query={query}
              onChange={setQuery}
              matchCount={matchCount}
              totalCount={searchTotal}
              shortcut={searchShortcut}
            />
          </div>
          <TreeCollapseAllButton
            anyOpen={anyOpen}
            onClick={toggleAllFolders}
            disabledReason={collapseDisabledReason}
          />
        </div>
        <TreeViewToggle
          mode={effectiveMode}
          onChange={setMode}
          changedCount={changedCount}
        />
      </div>

      {tree?.truncated && (
        <p className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          Showing the first {entries.length.toLocaleString()} files, and search only covers these. This folder has more.
        </p>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0">
        {entries.length === 0 && error && !isFetching ? (
          // The read failed with nothing cached to show. Loading rows here
          // would never end, so say what happened. With a list on screen, the
          // list stays and the next read can replace it.
          <div className="flex flex-col items-start gap-2 p-3 text-[12px] min-w-0">
            <p className="font-medium text-foreground">Couldn&apos;t list these files</p>
            <p className="break-words text-muted-foreground min-w-0 max-w-full">{errorMessage(error)}</p>
            <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : entries.length === 0 && (isFetching || !worktreePath) ? (
          // Worktree still provisioning, or a (re)fetch in flight with nothing
          // cached yet → skeleton rows, never a misleading "No files". Rows
          // rather than a spinner because the tree read is the slow one
          // (several sequential git subprocesses, ~1s), so this is on screen
          // long enough to be worth showing the shape of what's coming.
          <TreeRowsSkeleton />
        ) : (
          <TreeList
            entries={filteredEntries}
            mode={effectiveMode}
            selectedPath={selectedPath}
            onSelect={onSelect}
            expanded={effectiveExpanded}
            onToggleDir={toggleDir}
            dropDirectory={dropDirectory}
            filterQuery={trimmedQuery}
            savingPaths={savingPaths}
            onRename={writable ? beginRename : undefined}
            onDelete={writable ? requestDelete : undefined}
            onCreateFile={writable ? (p) => beginCreate(p, 'file') : undefined}
            onCreateFolder={writable ? (p) => beginCreate(p, 'dir') : undefined}
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

      {uploadProgress && (
        <div role="status" className="flex items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />
          Uploading file {uploadProgress.current} of {uploadProgress.total}...
        </div>
      )}

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
  if (apiErrorStatus(err) !== undefined) {
    // `message` first: a change refused on another device says why there
    // (not connected, unconfirmed) and keeps a code in `error`.
    const body = apiErrorBody(err) as { error?: string; message?: string; code?: string } | null;
    if (body?.message) return body.message;
    if (body?.error) return body.error;
    if (body?.code === 'exists') return 'Already exists';
    return `HTTP ${apiErrorStatus(err)}`;
  }
  if (err instanceof Error) return apiErrorText(err);
  return 'Unknown error';
}
