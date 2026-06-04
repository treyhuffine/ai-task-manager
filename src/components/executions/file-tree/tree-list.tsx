'use client';

import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TreeEntry } from '@/lib/api/sessions';
import {
  buildTree,
  flattenTree,
  ancestorsOfChanged,
  collectDirPaths,
  type TreeRenderNode,
} from './build-tree';
import { TreeDirRow, TreeFileRow, CollapsedDirRow } from './tree-entry-row';
import { TreeInputRow } from './tree-input-row';

export interface PendingCreate {
  /** Empty string for root. */
  parentPath: string;
  kind: 'file' | 'dir';
}

export interface PendingError {
  message: string;
}

interface TreeListProps {
  entries: readonly TreeEntry[];
  /** 'all' = full hierarchical tree; 'changed' = flat list of changed files. */
  mode: 'all' | 'changed';
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** Stable cross-render expand/collapse state for directories. */
  expanded: Set<string>;
  onToggleDir: (path: string) => void;

  /**
   * Case-insensitive substring filter. When non-empty, the tree is
   * filtered to entries whose path matches, every ancestor of a match
   * is force-expanded, and matches are highlighted in the rendered name.
   */
  filterQuery?: string;

  // CRUD orchestration — all owned by `file-tree.tsx`. The list is
  // pass-through; it just routes the per-row callbacks.
  onRename: (path: string, kind: 'file' | 'dir') => void;
  onDelete: (path: string, kind: 'file' | 'dir') => void;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onCopyRelativePath: (path: string) => void;
  /** Returns undefined when the worktree path is unknown (non-git ws). */
  onCopyAbsolutePath?: (path: string) => void;
  /** Wired to the chat composer's `insertTextAtCursor`. */
  onReferenceInChat?: (path: string) => void;

  pendingCreate: PendingCreate | null;
  pendingCreateBusy?: boolean;
  pendingCreateError?: PendingError | null;
  onSubmitCreate: (name: string) => void;
  onCancelCreate: () => void;

  renamingPath: string | null;
  pendingRenameBusy?: boolean;
  pendingRenameError?: PendingError | null;
  onSubmitRename: (newName: string) => void;
  onCancelRename: () => void;

  /** Paths with a write-file mutation in flight — drives the per-row
   *  spinner that appears when autosave fires from the viewer. */
  savingPaths?: ReadonlySet<string>;
}

const ROW_HEIGHT = 26; // px — must match what TreeFileRow/TreeDirRow render

// Synthetic row representing the inline create-input. Lives in the
// flattened list right under the parent dir (or at the top in root) so
// the virtualizer treats it like any other row.
type SyntheticInputNode = {
  kind: 'input';
  /** Stable key for the virtualizer. */
  path: '__create__';
  depth: number;
  inputKind: 'file' | 'dir';
};

type FlatNode = TreeRenderNode | SyntheticInputNode;

export function TreeList({
  entries,
  mode,
  selectedPath,
  onSelect,
  expanded,
  onToggleDir,
  filterQuery,
  onRename,
  onDelete,
  onCreateFile,
  onCreateFolder,
  onCopyRelativePath,
  onCopyAbsolutePath,
  onReferenceInChat,
  pendingCreate,
  pendingCreateBusy,
  pendingCreateError,
  onSubmitCreate,
  onCancelCreate,
  renamingPath,
  pendingRenameBusy,
  pendingRenameError,
  onSubmitRename,
  onCancelRename,
  savingPaths,
}: TreeListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const trimmedQuery = (filterQuery ?? '').trim();
  const lowerQuery = trimmedQuery.toLowerCase();
  const isFiltering = lowerQuery.length > 0;

  // Apply the search filter at the entry level so the same `entries`
  // input drives both 'all' and 'changed' modes consistently. Match on
  // the full path, not just basename, so the user can scope by dir
  // segment ("components/ui").
  const filteredEntries = useMemo(() => {
    if (!isFiltering) return entries;
    return entries.filter((e) => e.path.toLowerCase().includes(lowerQuery));
  }, [entries, isFiltering, lowerQuery]);

  const tree = useMemo(() => buildTree(filteredEntries), [filteredEntries]);

  // Auto-expand every ancestor of a changed file so the user can see
  // their changes without having to drill in manually. Computed once
  // per entries snapshot and union'd with the user's manual expansions.
  const autoExpanded = useMemo(() => ancestorsOfChanged(filteredEntries), [filteredEntries]);
  // When filtering, expand every directory in the (already-pruned) tree.
  // Without this, the user would type a query and see a single closed
  // directory at the root with no visible matches inside.
  const filterExpanded = useMemo(() => {
    if (!isFiltering) return null;
    return new Set(collectDirPaths(tree));
  }, [isFiltering, tree]);
  const effectiveExpanded = useMemo(() => {
    const out = new Set(expanded);
    for (const p of autoExpanded) out.add(p);
    if (filterExpanded) for (const p of filterExpanded) out.add(p);
    return out;
  }, [expanded, autoExpanded, filterExpanded]);

  const flat: FlatNode[] = useMemo(() => {
    if (mode === 'changed') {
      // Flat list of changed files, alphabetical by full path.
      return filteredEntries
        .filter((e) => !!e.status)
        .slice()
        .sort((a, b) => a.path.localeCompare(b.path))
        .map<FlatNode>((entry) => ({
          kind: 'file',
          path: entry.path,
          name: entry.path, // show the full path in changed-only mode
          depth: 0,
          entry,
        }));
    }

    const base = flattenTree(tree, effectiveExpanded);
    if (!pendingCreate) return base;

    // Splice in the inline create-input row. Root inserts at the very
    // top; nested inserts immediately after the parent dir's render
    // node. Children of the parent (when expanded) follow naturally.
    const depth = pendingCreate.parentPath
      ? pendingCreate.parentPath.split('/').length
      : 0;
    const inputNode: SyntheticInputNode = {
      kind: 'input',
      path: '__create__',
      depth,
      inputKind: pendingCreate.kind,
    };
    if (!pendingCreate.parentPath) {
      return [inputNode, ...base];
    }
    const idx = base.findIndex(
      (n) => n.kind === 'dir' && n.path === pendingCreate.parentPath,
    );
    if (idx === -1) {
      // Parent isn't visible (collapsed). Drop to root insert as a
      // fallback so the user still sees the input — file-tree.tsx
      // also force-expands the parent before setting pendingCreate, so
      // this branch should be unreachable in practice.
      return [inputNode, ...base];
    }
    return [...base.slice(0, idx + 1), inputNode, ...base.slice(idx + 1)];
  }, [filteredEntries, mode, tree, effectiveExpanded, pendingCreate]);

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (i) => flat[i].path || `__index_${i}`,
  });

  if (flat.length === 0) {
    const empty = isFiltering
      ? 'No matches'
      : mode === 'changed'
        ? 'No changes yet'
        : 'No files';
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground/70">
        {empty}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto overflow-x-hidden text-[12px] [scrollbar-width:thin]"
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          const node = flat[vRow.index];
          return (
            <div
              key={vRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: ROW_HEIGHT,
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              {node.kind === 'input' ? (
                <TreeInputRow
                  depth={node.depth}
                  kind={node.inputKind}
                  isBusy={pendingCreateBusy}
                  errorMessage={pendingCreateError?.message}
                  onSubmit={onSubmitCreate}
                  onCancel={onCancelCreate}
                />
              ) : node.kind === 'dir' && node.collapsed ? (
                <CollapsedDirRow name={node.name} depth={node.depth} />
              ) : node.kind === 'dir' ? (
                renamingPath === node.path ? (
                  <TreeInputRow
                    depth={node.depth}
                    kind="dir"
                    initialValue={node.name}
                    isBusy={pendingRenameBusy}
                    errorMessage={pendingRenameError?.message}
                    onSubmit={onSubmitRename}
                    onCancel={onCancelRename}
                  />
                ) : (
                  <TreeDirRow
                    name={node.name}
                    depth={node.depth}
                    expanded={effectiveExpanded.has(node.path)}
                    onToggle={() => onToggleDir(node.path)}
                    highlightQuery={isFiltering ? trimmedQuery : null}
                    actions={{
                      onRename: () => onRename(node.path, 'dir'),
                      onDelete: () => onDelete(node.path, 'dir'),
                      onCreateFile: () => onCreateFile(node.path),
                      onCreateFolder: () => onCreateFolder(node.path),
                      onCopyRelativePath: () => onCopyRelativePath(node.path),
                      onCopyAbsolutePath: onCopyAbsolutePath
                        ? () => onCopyAbsolutePath(node.path)
                        : undefined,
                      onReferenceInChat: onReferenceInChat
                        ? () => onReferenceInChat(node.path)
                        : undefined,
                    }}
                  />
                )
              ) : renamingPath === node.path ? (
                <TreeInputRow
                  depth={mode === 'changed' ? 0 : node.depth}
                  kind="file"
                  initialValue={node.entry.name}
                  isBusy={pendingRenameBusy}
                  errorMessage={pendingRenameError?.message}
                  onSubmit={onSubmitRename}
                  onCancel={onCancelRename}
                />
              ) : (
                <TreeFileRow
                  entry={node.entry}
                  // 'changed' mode shows the full path so the user can
                  // see where each modified file lives at a glance —
                  // and the highlight wraps wherever the query lands in
                  // that path.
                  label={mode === 'changed' ? node.entry.path : undefined}
                  depth={mode === 'changed' ? 0 : node.depth}
                  selected={selectedPath === node.path}
                  saving={savingPaths?.has(node.path) ?? false}
                  onSelect={() => onSelect(node.path)}
                  highlightQuery={isFiltering ? trimmedQuery : null}
                  actions={{
                    onRename: () => onRename(node.path, 'file'),
                    onDelete: () => onDelete(node.path, 'file'),
                    onCopyRelativePath: () => onCopyRelativePath(node.path),
                    onCopyAbsolutePath: onCopyAbsolutePath
                      ? () => onCopyAbsolutePath(node.path)
                      : undefined,
                    onReferenceInChat: onReferenceInChat
                      ? () => onReferenceInChat(node.path)
                      : undefined,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
