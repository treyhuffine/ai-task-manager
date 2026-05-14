'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  GitCompareArrows,
  FileCode,
  FolderOpen,
  SquareArrowOutUpRight,
  X,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSession, useSessionTree, useWriteFile } from '@/hooks/use-execution';
import { useClientLocation } from '@/hooks/use-client-location';
import { useEditorPreference, EDITOR_LABELS } from '@/lib/client/editor-preference';
import { openInEditorHref, revealLabel, detectClientPlatform } from '@/lib/client/deep-links';
import { fsApi } from '@/lib/api/fs';
import { cn } from '@/lib/utils';
import type { TreeEntry } from '@/lib/api/sessions';
import { FileView, type FileViewHandle } from './file-view';
import { DiffView } from './diff-view';

interface FileViewerProps {
  sessionId: string;
  selectedPath: string | null;
  /** Dismiss the open file — viewer returns to the empty "Select a file" state. */
  onClose?: () => void;
}

type Mode = 'diff' | 'current';

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
export function FileViewer({ sessionId, selectedPath, onClose }: FileViewerProps) {
  const { data: tree } = useSessionTree(sessionId);

  // Look up the selected entry — drives Diff/Current toggle availability.
  const entry: TreeEntry | undefined = useMemo(() => {
    if (!selectedPath || !tree) return undefined;
    return tree.entries.find((e) => e.path === selectedPath);
  }, [selectedPath, tree]);

  const isChanged = !!entry?.status;

  // Always land in Current when navigating to a new file. Sticky-on-Diff
  // turned out to be just as bad as auto-switch-to-diff: the user bounces
  // between changed files mid-edit and gets dropped in the read-only
  // diff every time. Per-file Diff is a click away when wanted.
  const [mode, setMode] = useState<Mode>('current');
  useEffect(() => {
    setMode('current');
  }, [selectedPath]);

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

  const effectiveMode: Mode = isChanged ? mode : 'current';
  const isDeleted = entry?.status === 'deleted';
  // Edit only makes sense in Current mode against a file that exists on
  // disk. Deleted-but-not-committed files have no working-tree copy to
  // edit; the user should restore via git first.
  const editable = effectiveMode === 'current' && !isDeleted;

  return (
    <div className="flex h-full w-full flex-col bg-background min-w-0">
      <FileViewerHeader
        sessionId={sessionId}
        path={selectedPath}
        isChanged={isChanged}
        mode={effectiveMode}
        onModeChange={setMode}
        onClose={onClose}
        dirty={dirty && editable}
        saving={writeFile.isPending}
        onDiscard={editable ? handleDiscard : undefined}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        {effectiveMode === 'diff' && entry?.status ? (
          <DiffView sessionId={sessionId} path={selectedPath} status={entry.status} />
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
  mode: Mode;
  onModeChange: (m: Mode) => void;
  onClose?: () => void;
  dirty: boolean;
  saving: boolean;
  onDiscard?: () => void;
}

function FileViewerHeader({
  sessionId,
  path,
  isChanged,
  mode,
  onModeChange,
  onClose,
  dirty,
  saving,
  onDiscard,
}: HeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 min-w-0">
      <FileCode size={13} className="shrink-0 text-muted-foreground/80" />
      <span className="truncate text-[11px] font-medium text-foreground/85 flex-1">
        {path}
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
      {isChanged && (
        <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5 text-[10px] font-medium shrink-0">
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
        </div>
      )}
      <RevealButton sessionId={sessionId} path={path} />
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
  const { editor } = useEditorPreference();
  const { data: session } = useSession(sessionId);
  const worktreePath = session?.worktree_path ?? null;
  const absolutePath = worktreePath ? `${worktreePath}/${path}` : null;
  const [revealing, setRevealing] = useState(false);

  const handleReveal = useCallback(async () => {
    if (!absolutePath || revealing) return;
    // Browsers block `file://` navigation from `http(s)://` origins, so
    // we route through the local fs API instead — same backend the
    // worktree open-button uses. Open the parent dir; on macOS this
    // brings Finder to the folder containing the file.
    const parent = absolutePath.replace(/[^/]*$/, '') || '/';
    setRevealing(true);
    try {
      const res = await fsApi.openIn(parent, 'finder');
      if (!res.ok) {
        toast.error(res.message ?? "Couldn't open in Finder");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open in Finder');
    } finally {
      setRevealing(false);
    }
  }, [absolutePath, revealing]);

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
      <a
        href={openInEditorHref(absolutePath, editor)}
        title={`Open in ${EDITOR_LABELS[editor]}`}
        className="inline-flex items-center justify-center p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0"
      >
        <SquareArrowOutUpRight size={12} />
      </a>
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
