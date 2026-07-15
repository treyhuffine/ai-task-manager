'use client';

import { useState, useEffect, useRef } from 'react';
import { FileText, AppWindow } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePreviewState } from '@/hooks/use-preview';
import type { PreviewServerStatus } from '@/lib/api/preview';
import { FileViewer } from './viewer/file-viewer';
import { FileHistoryMenu } from './viewer/file-history-menu';
import { PreviewPane } from './preview/preview-pane';
import type { FileHistoryEntry } from '@/hooks/use-file-history';

interface ViewerAreaProps {
  sessionId: string;
  workspaceId: string | null;
  /** The execution whose worktree we preview (previews are per-worktree). */
  executionId: string | null;
  selectedPath: string | null;
  onCloseFile: () => void;
  onOpenWorkspaceSettings?: () => void;
  /** Tracks whether the wrapping panel has visible area. Drives expensive
   *  iframe / status polling when collapsed. */
  active: boolean;
  /**
   * Monotonic counter the parent bumps every time the user explicitly
   * picks a file (via the tree, rename, or create). When this changes,
   * we swap to the Files tab — clicking a file unambiguously means
   * "show me the file." Programmatic selection (e.g. `useInitialSelectedFile`'s
   * auto-seed on mount) doesn't bump the counter, so it doesn't yank the
   * user out of a Preview view they're still using.
   */
  filePickSignal?: number;
  /**
   * Per-session list of recently opened files (newest first), owned by
   * `ExecutionView` via `useFileHistory`. Powers the history menu in the
   * tab strip. Passed down rather than read locally so the menu reflects
   * opens triggered from the tree and transcript chips, not just here.
   */
  fileHistory?: FileHistoryEntry[];
  /**
   * Wired by `ExecutionView` so the file viewer's header kebab can
   * insert `@<path>` at the chat composer's cursor — same UX as the
   * file tree's "Reference in chat" affordance.
   */
  onReferenceInChat?: (relativePath: string) => void;
}

type Tab = 'files' | 'preview';

const TAB_STORAGE_KEY_PREFIX = 'flow.viewer.tab.';

/**
 * Top half of the right column. Tab-switch between the file viewer and
 * the workspace preview. The choice is per-execution in localStorage so
 * users who never use preview don't see it again on the next visit, and
 * users who do don't have to re-pick on every open. Per-execution rather
 * than per-chat because both tabs show the execution's worktree — sitting
 * on Preview and starting a new chat shouldn't bounce you back to Files.
 *
 * Status indicator on the Preview tab: a small coloured dot reflects
 * the supervised process's state — green/running, amber/starting,
 * red/crashed — so a user sitting on the Files tab knows whether
 * there's a live preview worth flipping over to (or one they should
 * stop). The underlying status query is shared with `<PreviewPane>`
 * via TanStack Query's cache key, so this doesn't add a second round
 * trip.
 */
export function ViewerArea({
  sessionId, workspaceId, executionId, selectedPath, onCloseFile, onOpenWorkspaceSettings, active,
  filePickSignal, fileHistory, onReferenceInChat,
}: ViewerAreaProps) {
  const worktreeId = executionId ?? sessionId;
  const [tab, setTab] = useState<Tab>(() => readPersistedTab(worktreeId));

  // Reset/load when the execution changes.
  useEffect(() => {
    setTab(readPersistedTab(worktreeId));
  }, [worktreeId]);

  const setTabAndPersist = (next: Tab) => {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY_PREFIX + worktreeId, next);
    } catch {
      /* ignore */
    }
  };

  // Swap to Files when the user picks a file. We skip the initial render
  // (no transition) so a fresh tab load doesn't yank the user off Preview.
  const lastSignalRef = useRef<number | undefined>(filePickSignal);
  useEffect(() => {
    if (filePickSignal === undefined) return;
    if (lastSignalRef.current === undefined) {
      lastSignalRef.current = filePickSignal;
      return;
    }
    if (filePickSignal !== lastSignalRef.current) {
      lastSignalRef.current = filePickSignal;
      setTabAndPersist('files');
    }
    // setTabAndPersist intentionally not in deps — it's a stable closure
    // over sessionId, which has its own effect for tab reset above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePickSignal]);

  // Status query is shared with PreviewPane via the same cache key.
  // Poll only while this viewer area is visible — no point pinging the
  // server when the user has the terminal expanded to full height. We
  // ignore "tab" in the gate so the indicator stays accurate even on
  // the Files tab (the whole point is to alert the user *to* preview).
  const statusQuery = usePreviewState(executionId, {
    enabled: !!executionId && active,
    refetchInterval: active ? 4_000 : false,
  });
  const previewState: PreviewServerStatus | undefined = statusQuery.data?.serverStatus;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-background px-1.5">
        <TabButton
          active={tab === 'files'}
          onClick={() => setTabAndPersist('files')}
          icon={<FileText size={12} />}
          label="Files"
        />
        <TabButton
          active={tab === 'preview'}
          onClick={() => setTabAndPersist('preview')}
          icon={<AppWindow size={12} />}
          label="Preview"
          indicator={previewState}
        />
        <div className="ml-auto flex items-center">
          <FileHistoryMenu
            sessionId={sessionId}
            history={fileHistory ?? []}
            selectedPath={selectedPath}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'files' ? (
          <FileViewer
            sessionId={sessionId}
            selectedPath={selectedPath}
            onClose={onCloseFile}
            onReferenceInChat={onReferenceInChat}
          />
        ) : (
          <PreviewPane
            executionId={executionId}
            workspaceId={workspaceId}
            active={active && tab === 'preview'}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active, onClick, icon, label, indicator,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  indicator?: PreviewServerStatus;
}) {
  const dot = renderStatusDot(indicator);
  return (
    <button
      type="button"
      onClick={onClick}
      title={dot?.title}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded px-2 text-[12px] font-medium transition-colors',
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      {icon}
      {label}
      {dot?.node}
    </button>
  );
}

function renderStatusDot(state: PreviewServerStatus | undefined): { node: React.ReactNode; title: string } | null {
  switch (state) {
    case 'running':
      return {
        title: 'Preview is running',
        node: (
          <span
            aria-label="Preview is running"
            className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
          />
        ),
      };
    case 'starting':
      return {
        title: 'Preview is starting',
        node: (
          <span
            aria-label="Preview is starting"
            className="ml-0.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500"
          />
        ),
      };
    case 'crashed':
      return {
        title: 'Preview crashed, open to see logs',
        node: (
          <span
            aria-label="Preview crashed"
            className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
          />
        ),
      };
    default:
      // idle / stopped / undefined → no dot. The user hasn't asked for
      // a preview, or it's already torn down; no signal to surface.
      return null;
  }
}

function readPersistedTab(worktreeId: string): Tab {
  if (typeof window === 'undefined') return 'files';
  try {
    const raw = window.localStorage.getItem(TAB_STORAGE_KEY_PREFIX + worktreeId);
    if (raw === 'preview') return 'preview';
  } catch {
    /* ignore */
  }
  return 'files';
}
