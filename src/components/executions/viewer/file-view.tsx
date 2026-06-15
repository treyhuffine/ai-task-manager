'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Loader2, FileX, Lock, FileWarning } from 'lucide-react';
import { useSessionFile, useSessionBaseFile } from '@/hooks/use-execution';
import { useDashboard } from '@/contexts/dashboard-context';
import type { TreeEntryStatus } from '@/lib/api/sessions';
import { languageFor } from './language-for';
import { cmTheme } from './cm-theme';
import { inlineDiffExtension } from './inline-diff';

interface FileViewProps {
  sessionId: string;
  path: string;
  /** When false, the editor is locked (matches the legacy read-only viewer). */
  editable?: boolean;
  /** Fires whenever the buffer diverges from the loaded content. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Fires when the user hits Cmd/Ctrl+S — parent owns the actual save. */
  onSaveRequest?: () => void;
  /** Git status from the tree entry — when set, drives the inline gutter
   *  bars (added/modified vs. the base SHA). Null / unchanged files
   *  render as a plain editor. */
  status?: TreeEntryStatus | null;
}

/**
 * Imperative surface so the FileViewer header can read the current
 * buffer when Save is clicked, and reset/refresh after a successful
 * write. Refs are intentionally narrow — no general "do anything"
 * passthrough to the underlying CodeMirror instance.
 */
export interface FileViewHandle {
  /** Returns the current buffer (what the user has typed). */
  getValue(): string;
  /** Drops local edits and rebases on the latest server content. */
  revertToServer(): void;
  /** Marks the current buffer as the new clean baseline (post-save). */
  markSaved(content: string): void;
}

/**
 * Editable file viewer backed by CodeMirror 6. Source of truth lives
 * in `useSessionFile`; we mirror it into a local buffer so the user can
 * type without each keystroke triggering a TanStack write. The buffer
 * resets when the file path changes, when the server content changes
 * AND the user has no unsaved edits (e.g. agent wrote the file), and
 * when the parent calls `markSaved` after a successful POST.
 *
 * Binary / oversize / missing files short-circuit to dedicated empty
 * states rather than rendering an editor against null content.
 */
export const FileView = forwardRef<FileViewHandle, FileViewProps>(function FileView(
  { sessionId, path, editable = true, onDirtyChange, onSaveRequest, status },
  ref,
) {
  const { theme } = useDashboard();
  const { data, isLoading, error } = useSessionFile(sessionId, path);

  // Inline gutter bars (VS Code-style). Fetch the base-commit version
  // when the tree marks the file as changed; for added/untracked files
  // the base is empty by definition (every line is new). Deleted files
  // never reach this branch — FileViewer routes them to DiffView.
  const needsBaseFetch = status === 'modified' || status === 'staged';
  const { data: baseData } = useSessionBaseFile(sessionId, needsBaseFetch ? path : null);
  const baseContent: string | null = useMemo(() => {
    if (!status) return null;
    if (status === 'added' || status === 'untracked') return '';
    if (!needsBaseFetch) return null;
    return baseData?.content ?? null;
  }, [status, needsBaseFetch, baseData?.content]);

  // Local edit buffer. Distinguishes loaded-but-empty (`""`) from
  // not-yet-loaded (`null`) so we don't flash an empty editor over a
  // file that's still streaming in.
  const [buffer, setBuffer] = useState<string | null>(null);
  // The clean baseline — what the buffer was when last loaded or saved.
  // Drives the dirty calculation without us having to thread separate
  // "savedContent" plumbing through the component tree.
  const baselineRef = useRef<string | null>(null);

  // Render-time path-change reset. Without this, navigating from file X
  // to file Y leaves the buffer holding X's content for one frame
  // (until the load-effect below fires for Y), which would render
  // X's text under Y's path. Setting state during render is allowed
  // when guarded by an equality check — React reschedules the render
  // with the new state instead of looping.
  const lastPathRef = useRef<string | null>(null);
  if (lastPathRef.current !== path) {
    lastPathRef.current = path;
    if (buffer !== null) setBuffer(null);
    baselineRef.current = null;
  }

  // Hook the buffer up to the freshly-loaded server content. Three cases:
  //   1. Buffer is null (just navigated to this path) → adopt server.
  //   2. Same path, agent wrote it (server changed) AND user has no
  //      pending edits → silently rebase. The user's selection moves to
  //      the doc start, but they hadn't been typing, so it's fine.
  //   3. Same path, server changed BUT user has pending edits → leave
  //      buffer alone, leave baseline alone (so dirty stays true). The
  //      Save click will overwrite whatever the agent wrote; we accept
  //      that — the user's edit wins. Adding a "file changed on disk"
  //      banner is a future polish.
  useEffect(() => {
    if (!data) return;
    const incoming = data.content ?? '';
    const isInitial = baselineRef.current === null;
    const dirty = !isInitial && buffer !== baselineRef.current;
    if (isInitial || !dirty) {
      setBuffer(incoming);
      baselineRef.current = incoming;
    }
  }, [data, buffer]);

  // Notify parent on any dirty-state transition. Tracked off the
  // current render's buffer/baseline pair so the header pill stays in
  // sync without parent-side polling.
  const dirty = baselineRef.current !== null && buffer !== null && buffer !== baselineRef.current;
  const lastDirtyRef = useRef(false);
  useEffect(() => {
    if (lastDirtyRef.current === dirty) return;
    lastDirtyRef.current = dirty;
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Reset the dirty signal when navigating to a new file so a stale
  // "● unsaved" pill doesn't leak across files. The baseline reset in
  // the load-effect above covers the buffer side; this covers the parent.
  useEffect(() => {
    return () => {
      if (lastDirtyRef.current) {
        lastDirtyRef.current = false;
        onDirtyChange?.(false);
      }
    };
  }, [path, onDirtyChange]);

  const cmRef = useRef<ReactCodeMirrorRef | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => buffer ?? '',
      revertToServer: () => {
        const baseline = baselineRef.current ?? '';
        setBuffer(baseline);
      },
      markSaved: (content: string) => {
        // Only update the baseline (the "what's on disk" reference).
        // Calling setBuffer here would clobber any keystrokes the user
        // typed while the save was in flight — autosave + fast typing
        // races would silently revert their last few characters.
        baselineRef.current = content;
      },
    }),
    [buffer],
  );

  // Cmd/Ctrl+S → request save. We swallow the default (browser save
  // dialog) and let the parent call back into `markSaved` once the
  // network round-trip resolves. Always installed when editable so the
  // shortcut works even before the user makes any change (no-op then).
  const saveKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            onSaveRequest?.();
            return true;
          },
        },
      ]),
    [onSaveRequest],
  );

  // Autosave on blur. The extension is built once and reads the latest
  // dirty + onSaveRequest values from refs so it doesn't churn on every
  // render. `data-skip-autosave` on the new focus target opts an element
  // out — Discard uses it so clicking Discard doesn't race the save.
  const onSaveRequestRef = useRef(onSaveRequest);
  useEffect(() => {
    onSaveRequestRef.current = onSaveRequest;
  }, [onSaveRequest]);
  const blurAutosave = useMemo(
    () =>
      EditorView.domEventHandlers({
        blur(event) {
          if (!lastDirtyRef.current) return;
          const next = (event as FocusEvent).relatedTarget as HTMLElement | null;
          if (next && next.closest('[data-skip-autosave]')) return;
          onSaveRequestRef.current?.();
        },
      }),
    [],
  );

  // Built once per (path, baseContent) pair. We hold off rendering the
  // gutter until base content has resolved so it doesn't appear and
  // then re-flow as the fetch lands.
  const diffGutter = useMemo(() => {
    if (baseContent === null) return null;
    return inlineDiffExtension(baseContent);
  }, [baseContent]);

  const extensions = useMemo(
    () => [
      languageFor(path),
      cmTheme(theme === 'dark' ? 'dark' : 'light'),
      EditorView.editable.of(editable),
      EditorView.lineWrapping,
      saveKeymap,
      blurAutosave,
      ...(diffGutter ? [diffGutter] : []),
    ],
    [path, theme, editable, saveKeymap, blurAutosave, diffGutter],
  );

  if (isLoading && buffer === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<FileX size={18} className="text-muted-foreground/70" />}
        title="Couldn't load this file"
        detail={error instanceof Error ? error.message : 'Unknown error'}
      />
    );
  }

  if (!data) return null;

  if (data.tooLarge) {
    return (
      <EmptyState
        icon={<FileWarning size={18} className="text-amber-500" />}
        title="File too large to preview"
        detail={`${formatBytes(data.size)} exceeds the 1 MiB preview cap.`}
      />
    );
  }

  // Images render as an actual preview rather than dead-ending at the
  // binary card. The file API already hands us base64 (raster, sniffed as
  // binary) or utf-8 text (svg) plus the mime, so no extra route needed.
  if (typeof data.mime === 'string' && data.mime.startsWith('image/') && data.content != null) {
    const src = data.isBinary
      ? `data:${data.mime};base64,${data.content}`
      : `data:${data.mime};charset=utf-8,${encodeURIComponent(data.content)}`;
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={path} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  if (data.isBinary) {
    return (
      <EmptyState
        icon={<Lock size={18} className="text-muted-foreground/70" />}
        title="Binary file"
        detail={`${data.mime} · ${formatBytes(data.size)}`}
      />
    );
  }

  return (
    <CodeMirror
      ref={cmRef}
      value={buffer ?? ''}
      onChange={(v) => setBuffer(v)}
      extensions={extensions}
      theme={theme === 'dark' ? 'dark' : 'light'}
      editable={editable}
      readOnly={!editable}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: editable,
        highlightActiveLineGutter: editable,
        autocompletion: editable,
        bracketMatching: true,
        closeBrackets: editable,
        history: editable,
        dropCursor: editable,
        searchKeymap: true,
      }}
      className="h-full text-foreground"
      height="100%"
    />
  );
});

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center text-[11px] text-muted-foreground/80">
      {icon}
      <span className="text-foreground/85 text-[12px] font-medium">{title}</span>
      {detail && <span className="text-muted-foreground/70">{detail}</span>}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}
