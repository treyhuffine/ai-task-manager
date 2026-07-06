'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  GitCompareArrows,
  GitMerge,
  BookOpen,
  FolderOpen,
  SquareArrowOutUpRight,
  X,
  RotateCcw,
  Loader2,
  MoreHorizontal,
  Copy,
  AtSign,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSession, useSessionTree, useWriteFile } from '@/hooks/use-execution';
import { useClientLocation } from '@/hooks/use-client-location';
import { useOpenInPreferredEditor } from '@/lib/client/editor-preference';
import { revealLabel, detectClientPlatform } from '@/lib/client/deep-links';
import { fsApi } from '@/lib/api/fs';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import { FileIcon } from '@/components/file-icon';
import type { TreeEntry } from '@/lib/api/sessions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileView, type FileViewHandle } from './file-view';
import { DiffView } from './diff-view';
import { ConflictView } from './conflict-view';
import { MarkdownView } from './markdown-view';

interface FileViewerProps {
  sessionId: string;
  selectedPath: string | null;
  /** Dismiss the open file — viewer returns to the empty "Select a file" state. */
  onClose?: () => void;
  /**
   * Insert `@<relative-path>` at the chat composer's cursor. Wired by
   * `ExecutionView` so the header kebab can route a reference into the
   * composer the same way the file tree does. Omitted from non-execution
   * surfaces.
   */
  onReferenceInChat?: (relativePath: string) => void;
}

type Mode = 'conflict' | 'diff' | 'current' | 'render';

/**
 * Whether the file should expose the Render toggle. Markdown is the
 * only format we route through Streamdown for now; keep the matcher
 * narrow so unknown extensions don't accidentally render as markdown
 * (and lose meaningful whitespace).
 */
function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path);
}

/**
 * The right-side file viewer that routes the selected path into either
 * a diff (when the file is changed) or an editable plain viewer
 * (unchanged file, or no diff possible). Header strip carries the
 * selected path, a `Diff | Current` toggle when both are available,
 * Save/Discard for unsaved edits, and a "Reveal in app" affordance
 * that hands the file off to the user's editor of choice.
 *
 * Diff mode is read-only by design — editing two side-by-side panes
 * gets confusing fast. Save/Discard and editing only happen in Current
 * mode; the toggle is the user's "I want to edit this" gesture.
 */
export function FileViewer({
  sessionId,
  selectedPath,
  onClose,
  onReferenceInChat,
}: FileViewerProps) {
  const { data: tree } = useSessionTree(sessionId);

  // Look up the selected entry — drives Diff/Current toggle availability.
  const entry: TreeEntry | undefined = useMemo(() => {
    if (!selectedPath || !tree) return undefined;
    return tree.entries.find((e) => e.path === selectedPath);
  }, [selectedPath, tree]);

  const isChanged = !!entry?.status;
  const isConflict = entry?.status === 'conflict';
  const isMarkdown = !!selectedPath && isMarkdownPath(selectedPath);

  // Always land in Current when navigating to a new file. Sticky-on-Diff
  // turned out to be just as bad as auto-switch-to-diff: the user bounces
  // between changed files mid-edit and gets dropped in the read-only
  // diff every time. Per-file Diff is a click away when wanted. Same
  // logic for Render — landing in source keeps editing as the default
  // gesture for any file the user opens.
  //
  // Conflicts are the exception: they need action, so we auto-open the
  // resolver once the tree entry for this path resolves. `autoModePathRef`
  // makes that a one-shot per file so it never fights a manual toggle.
  const [mode, setMode] = useState<Mode>('current');
  const autoModePathRef = useRef<string | null>(null);
  useEffect(() => {
    setMode('current');
    autoModePathRef.current = null;
  }, [selectedPath]);
  useEffect(() => {
    if (!selectedPath || !entry) return;
    if (autoModePathRef.current === selectedPath) return;
    autoModePathRef.current = selectedPath;
    if (entry.status === 'conflict') setMode('conflict');
  }, [selectedPath, entry]);

  // Dirty / save plumbing. The FileView owns the buffer; we just hold
  // a ref to its imperative surface so the header buttons can read the
  // current value, revert, or stamp a new clean baseline.
  const fileViewRef = useRef<FileViewHandle | null>(null);
  const [dirty, setDirty] = useState(false);

  const writeFile = useWriteFile(sessionId);

  // Snapshot path at call time. With autosave-on-blur the user can
  // navigate to a different file mid-flight; stamping the buffer clean
  // afterward must only happen if we're still viewing that same path.
  const selectedPathRef = useRef(selectedPath);
  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  const handleSave = useCallback(async () => {
    if (!selectedPath) return;
    const view = fileViewRef.current;
    if (!view) return;
    const content = view.getValue();
    const pathAtCall = selectedPath;
    try {
      await writeFile.mutateAsync({ path: pathAtCall, content });
      if (selectedPathRef.current === pathAtCall) {
        view.markSaved(content);
        setDirty(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(`Save failed: ${msg}`);
    }
  }, [selectedPath, writeFile]);

  const handleDiscard = useCallback(() => {
    const view = fileViewRef.current;
    if (!view) return;
    view.revertToServer();
    setDirty(false);
  }, []);

  // Reset dirty when the user navigates away from the file (FileView
  // also fires this on unmount, but resetting eagerly keeps the header
  // pill from blinking during the cross-fade).
  useEffect(() => {
    setDirty(false);
  }, [selectedPath]);

  if (!selectedPath) {
    return (
      <EmptyShell
        icon={<FileText size={20} className="opacity-60" />}
        title="Select a file to preview"
        detail="Pick something from the tree on the left."
      />
    );
  }

  // Fall back to Current when the selected mode doesn't apply to this
  // file — Conflicts only when unmerged, Diff only when there's a git
  // status, Render only for markdown. Keeps the toggle "sticky" across
  // file navigation without showing a dead button or rendering the wrong
  // view. (After a conflict is resolved, `isConflict` flips false and the
  // resolver falls back to Current, showing the resolved file.)
  const effectiveMode: Mode =
    (mode === 'conflict' && !isConflict) ||
    (mode === 'diff' && !isChanged) ||
    (mode === 'render' && !isMarkdown)
      ? 'current'
      : mode;
  const isDeleted = entry?.status === 'deleted';
  // Edit only makes sense in Current mode against a file that exists on
  // disk. Deleted-but-not-committed files have no working-tree copy to
  // edit; the user should restore via git first. Render is read-only.
  const editable = effectiveMode === 'current' && !isDeleted;

  return (
    <div className="flex h-full w-full flex-col bg-background min-w-0">
      <FileViewerHeader
        sessionId={sessionId}
        path={selectedPath}
        isChanged={isChanged}
        isConflict={isConflict}
        isMarkdown={isMarkdown}
        mode={effectiveMode}
        onModeChange={setMode}
        onClose={onClose}
        dirty={dirty && editable}
        saving={writeFile.isPending}
        onDiscard={editable ? handleDiscard : undefined}
        onReferenceInChat={onReferenceInChat}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        {effectiveMode === 'conflict' && isConflict ? (
          <ConflictView sessionId={sessionId} path={selectedPath} />
        ) : effectiveMode === 'diff' && entry?.status ? (
          <DiffView sessionId={sessionId} path={selectedPath} status={entry.status} />
        ) : effectiveMode === 'render' ? (
          <MarkdownView sessionId={sessionId} path={selectedPath} />
        ) : (
          <FileView
            ref={fileViewRef}
            sessionId={sessionId}
            path={selectedPath}
            editable={editable}
            status={entry?.status ?? null}
            onDirtyChange={setDirty}
            onSaveRequest={handleSave}
          />
        )}
      </div>
    </div>
  );
}

interface HeaderProps {
  sessionId: string;
  path: string;
  isChanged: boolean;
  isConflict: boolean;
  isMarkdown: boolean;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  onClose?: () => void;
  dirty: boolean;
  saving: boolean;
  onDiscard?: () => void;
  /** When wired, the kebab surfaces a "Reference in chat" entry. */
  onReferenceInChat?: (relativePath: string) => void;
}

function FileViewerHeader({
  sessionId,
  path,
  isChanged,
  isConflict,
  isMarkdown,
  mode,
  onModeChange,
  onClose,
  dirty,
  saving,
  onDiscard,
  onReferenceInChat,
}: HeaderProps) {
  // Header should always show the worktree-relative path. selectedPath
  // is normally already relative, but as a defensive measure we strip
  // the worktree prefix if it's somehow absolute — keeps the header
  // honest even if a legacy state, race, or new code path slips an
  // absolute path through to the viewer.
  const { data: session } = useSession(sessionId);
  const displayPath = toRelativePath(path, session?.worktreePath ?? null);
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 min-w-0">
      <FileIcon name={displayPath} />
      <span
        className="truncate text-[11px] font-medium text-foreground/85 flex-1"
        title={displayPath}
      >
        {displayPath}
      </span>
      {saving ? (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-normal text-muted-foreground/70 shrink-0"
          aria-live="polite"
        >
          <Loader2 size={10} className="animate-spin" />
          Saving…
        </span>
      ) : (
        dirty && onDiscard && (
          <button
            type="button"
            onClick={onDiscard}
            data-skip-autosave
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
            title="Discard unsaved changes"
          >
            <RotateCcw size={10} />
            Discard
          </button>
        )
      )}
      {(isChanged || isMarkdown) && (
        <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5 text-[10px] font-medium shrink-0">
          {isConflict ? (
            <button
              type="button"
              onClick={() => onModeChange('conflict')}
              className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
                mode === 'conflict'
                  ? 'bg-background text-orange-600 dark:text-orange-400 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <GitMerge size={10} />
              Conflicts
            </button>
          ) : (
            isChanged && (
              <button
                type="button"
                onClick={() => onModeChange('diff')}
                className={cn(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
                  mode === 'diff'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <GitCompareArrows size={10} />
                Diff
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => onModeChange('current')}
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
              mode === 'current'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FileText size={10} />
            Current
          </button>
          {isMarkdown && (
            <button
              type="button"
              onClick={() => onModeChange('render')}
              className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
                mode === 'render'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <BookOpen size={10} />
              Render
            </button>
          )}
        </div>
      )}
      <RevealButton sessionId={sessionId} path={path} />
      <FileHeaderMoreMenu
        relativePath={displayPath}
        worktreePath={session?.worktreePath ?? null}
        onReferenceInChat={onReferenceInChat}
      />
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0"
          title="Close file"
          aria-label="Close file"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

interface FileHeaderMoreMenuProps {
  /** Worktree-relative path. */
  relativePath: string;
  /** Used to compute absolute path. Null for non-git workspaces. */
  worktreePath: string | null;
  onReferenceInChat?: (relativePath: string) => void;
}

/**
 * The viewer's overflow menu — mirrors the file tree kebab so the user
 * has the same path-affordances regardless of which surface they're on.
 * Copy actions are always available; "Reference in chat" only when the
 * parent wires up `onReferenceInChat` (i.e. when there's a composer to
 * route into).
 */
function FileHeaderMoreMenu({
  relativePath,
  worktreePath,
  onReferenceInChat,
}: FileHeaderMoreMenuProps) {
  const absolutePath = worktreePath
    ? `${worktreePath.replace(/\/$/, '')}/${relativePath}`
    : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center justify-center p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0"
        aria-label="File actions"
        title="More actions"
      >
        <MoreHorizontal size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="min-w-44">
        {onReferenceInChat && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onReferenceInChat(relativePath);
            }}
          >
            <AtSign size={14} />
            Reference in chat
          </DropdownMenuItem>
        )}
        {onReferenceInChat && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            void copyText(relativePath, 'Relative path copied');
          }}
        >
          <Copy size={14} />
          Copy relative path
        </DropdownMenuItem>
        {absolutePath && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              void copyText(absolutePath, 'Absolute path copied');
            }}
          >
            <Copy size={14} />
            Copy absolute path
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface RevealButtonProps {
  sessionId: string;
  path: string;
}

/**
 * Two browser deep links — Reveal in the platform file manager, and
 * Open in the user's editor of choice. Both hide when the browser is
 * on a remote client because the path in the URL doesn't exist on the
 * user's laptop.
 */
function RevealButton({ sessionId, path }: RevealButtonProps) {
  const location = useClientLocation();
  const { label, openInEditor } = useOpenInPreferredEditor();
  const { data: session } = useSession(sessionId);
  const worktreePath = session?.worktreePath ?? null;
  const absolutePath = worktreePath ? `${worktreePath}/${path}` : null;
  const [revealing, setRevealing] = useState(false);
  const [opening, setOpening] = useState(false);

  const handleReveal = useCallback(async () => {
    if (!absolutePath || revealing) return;
    // Browsers block `file://` navigation from `http(s)://` origins, so we
    // route through the local fs API. `reveal` selects the file in its
    // folder (open -R / explorer /select,) rather than launching it.
    setRevealing(true);
    try {
      const res = await fsApi.openIn(absolutePath, 'finder', { reveal: true });
      if (!res.ok) {
        toast.error(res.message ?? "Couldn't reveal the file");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reveal the file');
    } finally {
      setRevealing(false);
    }
  }, [absolutePath, revealing]);

  const handleOpenInEditor = useCallback(async () => {
    if (!absolutePath || opening) return;
    setOpening(true);
    try {
      // Pass the worktree root so the editor loads the project tree.
      const res = await openInEditor(absolutePath, { projectDir: worktreePath ?? undefined });
      if (!res.ok) {
        toast.error(
          res.reason === 'not_installed'
            ? `${label} isn't installed or its CLI isn't on PATH`
            : (res.message ?? `Couldn't open in ${label}`),
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to open in ${label}`);
    } finally {
      setOpening(false);
    }
  }, [absolutePath, opening, openInEditor, worktreePath, label]);

  if (!absolutePath) return null;
  if (location.kind !== 'host') return null;

  const platform = detectClientPlatform();

  return (
    <>
      <button
        type="button"
        onClick={handleReveal}
        disabled={revealing}
        title={revealLabel(platform)}
        className="inline-flex items-center justify-center p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0 disabled:opacity-50"
      >
        {revealing ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
      </button>
      <button
        type="button"
        onClick={handleOpenInEditor}
        disabled={opening}
        title={`Open in ${label}`}
        className="inline-flex items-center justify-center p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0 disabled:opacity-50"
      >
        {opening ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <SquareArrowOutUpRight size={12} />
        )}
      </button>
    </>
  );
}

function EmptyShell({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-background px-6 text-center text-[11px] text-muted-foreground/80">
      {icon}
      <span className="text-foreground/85 text-[12px] font-medium">{title}</span>
      {detail && <span className="text-muted-foreground/70">{detail}</span>}
    </div>
  );
}

/**
 * Best-effort reduction of `path` to a worktree-relative form for
 * display. If `path` is already relative (no leading `/`), returned
 * verbatim. If it starts with `worktreePath/`, that prefix is stripped.
 * Anything else passes through unchanged — better to render the raw
 * value than silently mangle a path we don't fully understand.
 */
function toRelativePath(path: string, worktreePath: string | null): string {
  if (!path.startsWith('/')) return path;
  if (!worktreePath) return path;
  const prefix = worktreePath.endsWith('/') ? worktreePath : worktreePath + '/';
  if (path.startsWith(prefix)) return path.slice(prefix.length);
  if (path === worktreePath) return '';
  return path;
}
