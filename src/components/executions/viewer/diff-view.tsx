'use client';

import { useEffect, useMemo, useRef } from 'react';
import { MergeView } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { Loader2, FileX, Lock, FileWarning } from 'lucide-react';
import { useSessionFile, useSessionBaseFile } from '@/hooks/use-execution';
import { useDashboard } from '@/contexts/dashboard-context';
import type { TreeEntryStatus } from '@/lib/api/sessions';
import { languageFor } from './language-for';
import { cmTheme } from './cm-theme';

interface DiffViewProps {
  sessionId: string;
  path: string;
  /** From the tree entry — drives whether old/new might be empty. A
   *  'conflict' file normally routes to the conflict resolver, not here;
   *  if it ever reaches the diff it's treated like 'modified' (base vs
   *  current), which is a sane fallback. */
  status: TreeEntryStatus;
}

/**
 * Side-by-side diff view backed by `@codemirror/merge`'s `MergeView`.
 * Old content is read from `base:<path>` (the worktree's base commit);
 * new content is the working-tree file. Both sides are read-only.
 *
 * On mount and on file change, scrolls to the first hunk so the user
 * lands on the actual change rather than at the top of an unchanged
 * preamble — matches GitHub PR review behavior.
 */
export function DiffView({ sessionId, path, status }: DiffViewProps) {
  const { theme } = useDashboard();
  const isDark = theme === 'dark';

  // For deleted files we don't read the working-tree file (it's gone) —
  // we only need the base. For added/untracked files there's no base.
  const needsBase = status !== 'added' && status !== 'untracked';
  const needsCurrent = status !== 'deleted';

  const currentQuery = useSessionFile(sessionId, needsCurrent ? path : null);
  const baseQuery = useSessionBaseFile(sessionId, needsBase ? path : null);

  // Strings we'll feed into the MergeView. Defaults handle the
  // added/deleted edges cleanly: added file → empty base, deleted →
  // empty current.
  const baseContent = useMemo(() => {
    if (!needsBase) return '';
    return baseQuery.data?.content ?? '';
  }, [needsBase, baseQuery.data?.content]);

  const currentContent = useMemo(() => {
    if (!needsCurrent) return '';
    return currentQuery.data?.content ?? '';
  }, [needsCurrent, currentQuery.data?.content]);

  // Surface error / oversize / binary states like FileView does.
  const isLoading =
    (needsCurrent && currentQuery.isLoading) ||
    (needsBase && baseQuery.isLoading);
  const error = currentQuery.error || baseQuery.error;
  const tooLarge = currentQuery.data?.tooLarge || baseQuery.data?.tooLarge;
  const isBinary = currentQuery.data?.isBinary || baseQuery.data?.isBinary;

  const hostRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);

  const extensions = useMemo(
    () => [
      languageFor(path),
      cmTheme(isDark ? 'dark' : 'light'),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
    ],
    [path, isDark],
  );

  // Construct / recreate the MergeView whenever the file or its
  // contents change. The library's `reconfigure` API doesn't cover
  // doc changes, so a tear-down/rebuild is the cleanest path.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (isLoading || error || tooLarge || isBinary) return;

    mergeViewRef.current?.destroy();
    const view = new MergeView({
      a: {
        doc: baseContent,
        extensions,
      },
      b: {
        doc: currentContent,
        extensions,
      },
      parent: host,
      orientation: 'a-b',
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    mergeViewRef.current = view;

    // Scroll the first changed chunk into view (left side; the views
    // are synchronized so scrolling one moves the other).
    const firstChunk = view.chunks[0];
    if (firstChunk) {
      const line = view.b.state.doc.lineAt(Math.min(firstChunk.fromB, view.b.state.doc.length));
      view.b.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }),
      });
    }

    return () => {
      view.destroy();
      if (mergeViewRef.current === view) mergeViewRef.current = null;
    };
  }, [baseContent, currentContent, extensions, isLoading, error, tooLarge, isBinary]);

  if (isLoading) {
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
        title="Couldn't load diff"
        detail={error instanceof Error ? error.message : 'Unknown error'}
      />
    );
  }

  if (tooLarge) {
    return (
      <EmptyState
        icon={<FileWarning size={18} className="text-amber-500" />}
        title="File too large to diff"
        detail="Diff view is disabled for files over 1 MiB."
      />
    );
  }

  if (isBinary) {
    return (
      <EmptyState
        icon={<Lock size={18} className="text-muted-foreground/70" />}
        title="Binary file"
        detail="No diff available."
      />
    );
  }

  return (
    <div
      ref={hostRef}
      className="diff-view-host h-full w-full overflow-auto"
    />
  );
}

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
