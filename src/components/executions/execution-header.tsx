'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, MoreHorizontal, X, Archive, FolderOpen, SquareArrowOutUpRight, Zap } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useDashboard } from '@/contexts/dashboard-context';
import { useArchiveSession } from '@/hooks/use-workspaces';
import { useUpdateSession } from '@/hooks/use-execution';
import { useClientLocation } from '@/hooks/use-client-location';
import { useEditorPreference, EDITOR_LABELS } from '@/lib/client/editor-preference';
import { revealInFinderHref, openInEditorHref, revealLabel, detectClientPlatform } from '@/lib/client/deep-links';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { ChatSessionRecord, WorkspaceRecord } from '@/db/types';
import { ExecutionActionBar } from './action-bar/execution-action-bar';
import { TakeoverButton } from './takeover/takeover-button';

type HeaderLayout = 'right' | 'inline' | 'center';

const HEADER_LAYOUT_KEY = 'flow.execution.header.layout';
const DEFAULT_HEADER_LAYOUT: HeaderLayout = 'right';

function readPersistedLayout(): HeaderLayout {
  if (typeof window === 'undefined') return DEFAULT_HEADER_LAYOUT;
  try {
    const raw = window.localStorage.getItem(HEADER_LAYOUT_KEY);
    if (raw === 'right' || raw === 'inline' || raw === 'center') return raw;
    // Migrate the old `narrative` value (which was center+narrative) to `center`.
    if (raw === 'narrative') return 'center';
  } catch {
    /* ignore */
  }
  return DEFAULT_HEADER_LAYOUT;
}

interface ExecutionHeaderProps {
  session: ChatSessionRecord;
  workspace: WorkspaceRecord | undefined;
  onClose: () => void;
}

/**
 * Top strip of the execution view: workspace + label, branch + base sha,
 * status pill, action affordances. Status comes from the runtime
 * streaming map (live), the session's archived state, or just "idle"
 * when neither.
 */
export function ExecutionHeader({ session, workspace, onClose }: ExecutionHeaderProps) {
  const { streamingSessionIds, setActiveView } = useDashboard();
  const archive = useArchiveSession();
  const updateSession = useUpdateSession();

  // Header layout variant — three arrangements the user can flip between
  // to compare. Persisted in localStorage. Default `right` (actions
  // adjacent to the right cluster).
  const [headerLayout, setHeaderLayoutState] = useState<HeaderLayout>(() => readPersistedLayout());
  const setHeaderLayout = useCallback((next: HeaderLayout) => {
    setHeaderLayoutState(next);
    try {
      window.localStorage.setItem(HEADER_LAYOUT_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  // Inline rename: click the label → swap to input. Enter / blur saves
  // via PATCH /api/sessions/:id; Escape cancels. The local draft holds
  // the in-progress text so React Query repaints from server data don't
  // clobber the user's edit while they're typing.
  //
  // Reset on session change. ExecutionView doesn't remount on
  // navigation, so without this an in-flight rename would carry the
  // old draft text into the new session — pressing Enter would rename
  // the wrong execution.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRenameSessionRef = useRef(session.id);
  if (lastRenameSessionRef.current !== session.id) {
    lastRenameSessionRef.current = session.id;
    setEditing(false);
    setDraft('');
  }

  useEffect(() => {
    if (editing) {
      setDraft(session.label ?? '');
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, session.label]);

  const commitRename = () => {
    const next = draft.trim();
    setEditing(false);
    if (next === (session.label ?? '')) return; // no-op
    updateSession.mutate({ id: session.id, label: next || null });
  };

  const cancelRename = () => {
    setEditing(false);
    setDraft(session.label ?? '');
  };

  const isStreaming = streamingSessionIds.has(session.id);
  const isArchived = session.status === 'archived';

  // "Needs response" = the agent has produced an outcome the user
  // hasn't seen since their last view. Distinguishing this from plain
  // "idle" (which is "agent finished, user already saw it") makes the
  // pill actionable rather than ambient.
  const needsResponse =
    !isStreaming &&
    !isArchived &&
    !!session.last_outcome_event_at &&
    session.last_outcome_event_at > (session.last_viewed_at ?? '1970-01-01');

  const statusLabel = isStreaming
    ? 'working'
    : isArchived
      ? 'archived'
      : needsResponse
        ? 'respond'
        : session.last_outcome_event_at
          ? 'idle'
          : 'ready';

  const statusColor = isStreaming
    ? 'bg-emerald-500'
    : isArchived
      ? 'bg-zinc-400'
      : needsResponse
        ? 'bg-amber-500'
        : session.last_outcome_event_at
          ? 'bg-zinc-400'
          : 'bg-blue-500';

  // Pill text colour mirrors the dot for working / respond so the
  // call-to-action reads cleanly; ambient states stay muted.
  const statusTextClass = isStreaming
    ? 'text-emerald-500/90'
    : needsResponse
      ? 'text-amber-500/90'
      : 'text-muted-foreground/80';

  const handleArchive = () => {
    if (!confirm(`Archive "${session.label ?? 'this execution'}"?`)) return;
    archive.mutate(
      { id: session.id, force: false },
      {
        onSuccess: () => {
          setActiveView('command');
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            const body = err.body as { code?: string } | null;
            if (body?.code === 'dirty_worktree') {
              const force = confirm(
                'Worktree has uncommitted or unpushed changes. Archive anyway? Local changes will be lost.',
              );
              if (force) {
                archive.mutate(
                  { id: session.id, force: true },
                  { onSuccess: () => setActiveView('command') },
                );
              }
              return;
            }
          }
          alert(`Couldn't archive: ${err instanceof Error ? err.message : String(err)}`);
        },
      },
    );
  };

  // Shared elements between layouts. Defined once so mobile + desktop
  // pick the same code paths for rename, archive, status, etc.
  const labelElement = editing ? (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitRename}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitRename();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelRename();
        }
      }}
      placeholder="Untitled"
      maxLength={120}
      className="flex-1 min-w-0 bg-background border border-primary/40 rounded px-1.5 py-0.5 text-[13px] lg:text-[11px] font-semibold text-foreground focus:outline-none"
      spellCheck={false}
    />
  ) : null;

  const statusDot = (
    <span className={cn('w-1.5 h-1.5 rounded-full', statusColor, isStreaming && 'animate-pulse')} />
  );

  const archiveMenuItem = !isArchived && (
    <button
      onClick={handleArchive}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-destructive hover:bg-destructive/10 transition-colors"
    >
      <Archive size={11} />
      Archive execution
    </button>
  );

  const worktreeLinks = session.worktree_path ? (
    <WorktreeDeepLinks worktreePath={session.worktree_path} />
  ) : null;

  const takeoverMenuItem = <TakeoverButton session={session} workspace={workspace} />;

  // Detect Live mode: git workspace whose session points at the
  // workspace's own cwd instead of a per-session worktree. Non-git
  // workspaces also run in cwd by default but that's not "Live mode"
  // — the badge is specifically for "you opted into shared state on a
  // git workspace."
  const isLive =
    !!workspace?.is_git && !!session.worktree_path && session.worktree_path === workspace.cwd;
  const liveBadge = isLive ? <LiveBadge branch={session.branch_name} /> : null;

  return (
    <div className="flex-shrink-0 border-b border-border bg-background">
      {/* ─── Mobile header (under lg) ────────────────────────── */}
      <div className="lg:hidden flex items-center gap-1 px-2 py-2">
        <button
          onClick={onClose}
          aria-label="Back"
          className="p-2 -ml-1 rounded-md text-muted-foreground active:bg-muted/40"
        >
          <ChevronLeft size={20} />
        </button>

        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {workspace?.emoji && <span className="text-base flex-shrink-0">{workspace.emoji}</span>}
          {labelElement ?? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Rename"
              className={cn(
                'truncate text-left rounded px-1 -mx-1 py-0.5',
                'active:bg-muted/40 transition-colors cursor-text',
                session.label
                  ? 'text-foreground font-semibold text-[14px]'
                  : 'text-muted-foreground/70 italic font-normal text-[14px]',
              )}
            >
              {session.label ?? 'Untitled'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {liveBadge}
          <span
            aria-label={`Status: ${statusLabel}`}
            className={cn(
              'flex items-center gap-1 px-1.5 text-[11px] font-medium',
              statusTextClass,
            )}
          >
            {statusDot}
            <span className="capitalize">{statusLabel}</span>
          </span>

          {/* Consolidated session menu — details on top, archive below
              the divider. Same shape as desktop. */}
          <PopoverPrimitive.Root>
            <PopoverPrimitive.Trigger asChild>
              <button
                type="button"
                aria-label="Session menu"
                className="p-2 rounded-md text-muted-foreground active:bg-muted/40"
              >
                <MoreHorizontal size={16} />
              </button>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
              <PopoverPrimitive.Content
                side="bottom"
                align="end"
                sideOffset={6}
                collisionPadding={12}
                className="z-50 w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-popover shadow-xl pointer-events-auto outline-none"
              >
                <div className="p-3 space-y-2.5 text-[12px]">
                  <DetailRow
                    label="Workspace"
                    value={workspace?.name ?? '—'}
                    valueClass="font-medium text-foreground"
                  />
                  {session.branch_name && (
                    <DetailRow
                      label="Branch"
                      value={session.branch_name}
                      valueClass="font-mono text-foreground break-all"
                    />
                  )}
                  {session.base_sha && (
                    <DetailRow
                      label="Base"
                      value={`@${session.base_sha.slice(0, 7)}`}
                      valueClass="font-mono text-foreground"
                    />
                  )}
                  <DetailRow
                    label="Status"
                    value={statusLabel}
                    valueClass="text-foreground capitalize"
                  />
                  {session.worktree_path && (
                    <DetailRow
                      label="Path"
                      value={session.worktree_path}
                      valueClass="font-mono text-[11px] text-foreground/80 break-all"
                    />
                  )}
                </div>
                {worktreeLinks && (
                  <>
                    <div className="h-px bg-border" />
                    <div className="p-1.5">{worktreeLinks}</div>
                  </>
                )}
                <div className="h-px bg-border" />
                <div className="p-1">{takeoverMenuItem}</div>
                {archiveMenuItem && (
                  <>
                    <div className="h-px bg-border" />
                    <div className="p-1">{archiveMenuItem}</div>
                  </>
                )}
              </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
          </PopoverPrimitive.Root>
        </div>
      </div>

      {/* ─── Desktop header (lg+) ────────────────────────────── */}
      <div className="hidden lg:flex items-center gap-2 px-2 py-1 min-w-0">
        {/* Left cluster: close + workspace/label + consolidated menu.
            The ⋯ menu is the one passive-info-and-archive surface for
            this session — replaces the separate ⓘ and ⋯ buttons that
            used to sit on the right edge. */}
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex-shrink-0"
          aria-label="Close execution"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>

        <div
          className={cn(
            'flex items-center gap-1.5 text-[11px] text-muted-foreground/80 min-w-0',
            // The label shrinks when the narrative chip sits adjacent to
            // it (`inline`); otherwise the label gets more room.
            headerLayout === 'inline' ? 'max-w-[25%]' : 'max-w-[45%]',
          )}
        >
          {workspace?.emoji && <span className="flex-shrink-0">{workspace.emoji}</span>}
          <span className="font-medium truncate">{workspace?.name ?? 'Workspace'}</span>
          <span className="text-muted-foreground/40 flex-shrink-0">/</span>
          {labelElement ?? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Rename"
              className={cn(
                'truncate text-left rounded px-0.5 -mx-0.5 min-w-0',
                'hover:bg-muted/50 transition-colors cursor-text',
                session.label
                  ? 'text-foreground font-semibold'
                  : 'text-muted-foreground/60 italic font-normal',
              )}
            >
              {session.label ?? 'Untitled'}
            </button>
          )}
        </div>

        {/* Session menu — sits adjacent to the label so all the
            "passive info + meta actions" live in one spot. Details
            section (read-only) on top, actions below the divider. */}
        <PopoverPrimitive.Root>
          <PopoverPrimitive.Trigger asChild>
            <button
              type="button"
              aria-label="Session menu"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex-shrink-0"
              title="Session details"
            >
              <MoreHorizontal size={14} />
            </button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="bottom"
              align="start"
              sideOffset={6}
              collisionPadding={12}
              className="z-50 w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-popover shadow-xl pointer-events-auto outline-none"
            >
              <div className="p-3 space-y-2.5 text-[12px]">
                <DetailRow
                  label="Workspace"
                  value={workspace?.name ?? '—'}
                  valueClass="font-medium text-foreground"
                />
                {workspace?.base_branch && (
                  <DetailRow
                    label="Base branch"
                    value={workspace.base_branch}
                    valueClass="font-mono text-foreground"
                  />
                )}
                {session.branch_name && (
                  <DetailRow
                    label="Branch"
                    value={session.branch_name}
                    valueClass="font-mono text-foreground break-all"
                  />
                )}
                {session.base_sha && (
                  <DetailRow
                    label="Base sha"
                    value={`@${session.base_sha.slice(0, 7)}`}
                    valueClass="font-mono text-foreground"
                  />
                )}
                <DetailRow
                  label="Status"
                  value={statusLabel}
                  valueClass="text-foreground capitalize"
                />
                {session.worktree_path && (
                  <DetailRow
                    label="Path"
                    value={session.worktree_path}
                    valueClass="font-mono text-[11px] text-foreground/80 break-all"
                  />
                )}
                {session.started_at && (
                  <DetailRow
                    label="Started"
                    value={new Date(session.started_at).toLocaleString()}
                    valueClass="text-foreground/85"
                  />
                )}
                {session.pr_number != null && (
                  <DetailRow
                    label="Linked PR"
                    value={`#${session.pr_number}`}
                    valueClass="font-mono text-foreground"
                  />
                )}
              </div>

              {/* Link / unlink a PR explicitly. Useful when the PR's
                  head ref doesn't match the session's branch name
                  (e.g. someone opened the PR from a fork or renamed
                  the branch). The PR route prefers this when set. */}
              <div className="h-px bg-border" />
              <div className="p-2">
                <LinkPrSection
                  sessionId={session.id}
                  linkedNumber={session.pr_number ?? null}
                />
              </div>

              {worktreeLinks && (
                <>
                  <div className="h-px bg-border" />
                  <div className="p-1.5">{worktreeLinks}</div>
                </>
              )}

              <div className="h-px bg-border" />
              <div className="p-1">{takeoverMenuItem}</div>

              {archiveMenuItem && (
                <>
                  <div className="h-px bg-border" />
                  <div className="p-1">{archiveMenuItem}</div>
                </>
              )}
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>

        {/* All three layouts now use the narrative chip — only its
            position differs. `inline` sits adjacent to the label;
            `center` floats in the middle spacer; `right` lives in the
            right cluster just before state + editor. */}
        {headerLayout === 'inline' && workspace?.is_git && (!!session.worktree_path || !!session.setup_error) && (
          <ExecutionActionBar session={session} workspace={workspace} variant="narrative" />
        )}

        <div
          className={cn(
            'flex-1 flex items-center min-w-0 overflow-hidden px-2',
            headerLayout === 'center' ? 'justify-center' : '',
          )}
        >
          {headerLayout === 'center' && workspace?.is_git && (!!session.worktree_path || !!session.setup_error) && (
            <ExecutionActionBar session={session} workspace={workspace} variant="narrative" />
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {liveBadge}
          <span
            className={cn(
              'flex items-center gap-1.5 text-[10px] font-medium capitalize',
              statusTextClass,
            )}
          >
            {statusDot}
            {statusLabel}
          </span>
          {headerLayout === 'right' && workspace?.is_git && (!!session.worktree_path || !!session.setup_error) && (
            <ExecutionActionBar session={session} workspace={workspace} variant="narrative" />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Amber "LIVE" pill — surfaces "this session is running in the
 * workspace folder on the current branch, no worktree isolation." Same
 * detection logic as the dispatcher's `liveMode` flag: git workspace
 * whose session.worktree_path matches workspace.cwd. Tooltip explains
 * the consequences for users who land on a Live session without
 * remembering they started one.
 */
function LiveBadge({ branch }: { branch: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5',
            'bg-amber-500/15 text-amber-600 dark:text-amber-400',
            'text-[10px] font-semibold tracking-wide uppercase cursor-default',
          )}
        >
          <Zap size={9} />
          Live
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        <div className="space-y-1 max-w-[260px]">
          <div className="font-semibold">Live session</div>
          <div className="text-[11px] opacity-90 leading-snug">
            Agent is editing the workspace folder directly on{' '}
            {branch ? (
              <span className="font-mono">{branch}</span>
            ) : (
              'the current branch'
            )}
            . No worktree isolation — commits land on that branch.
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * "Reveal in Finder" / "Open in editor" links scoped to the worktree
 * root. Both hide when the browser is on a remote client because the
 * worktree path doesn't exist on the user's laptop. Cross-machine work
 * goes through the takeover flow (separate UI surface).
 */
function WorktreeDeepLinks({ worktreePath }: { worktreePath: string }) {
  const location = useClientLocation();
  const { editor } = useEditorPreference();
  if (location.kind !== 'host') return null;

  const platform = detectClientPlatform();

  return (
    <div className="space-y-0.5">
      <a
        href={revealInFinderHref(worktreePath)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-foreground hover:bg-muted/60 transition-colors"
      >
        <FolderOpen size={12} />
        {revealLabel(platform)}
      </a>
      <a
        href={openInEditorHref(worktreePath, editor)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] text-foreground hover:bg-muted/60 transition-colors"
      >
        <SquareArrowOutUpRight size={12} />
        Open in {EDITOR_LABELS[editor]}
      </a>
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 w-16 flex-shrink-0">
        {label}
      </span>
      <span className={cn('flex-1 min-w-0 text-[12px]', valueClass)}>{value}</span>
    </div>
  );
}

interface LinkPrSectionProps {
  sessionId: string;
  linkedNumber: number | null;
}

/**
 * "Link this session to a PR by number/URL." Used when the PR's head
 * branch doesn't match the session's `branch_name` — e.g. the PR was
 * opened from a fork, or the branch was renamed. The route prefers
 * the explicit link when set; clearing it falls back to branch match.
 */
function LinkPrSection({ sessionId, linkedNumber }: LinkPrSectionProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateSession();

  const handleLink = () => {
    const parsed = parsePrInput(input);
    if (!parsed) {
      setError('Paste a PR number or URL (e.g. 402 or https://github.com/owner/repo/pull/402).');
      return;
    }
    setError(null);
    update.mutate(
      { id: sessionId, pr_number: parsed },
      {
        onSuccess: () => setInput(''),
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const handleUnlink = () => {
    setError(null);
    update.mutate({ id: sessionId, pr_number: null });
  };

  return (
    <div className="space-y-1.5">
      <div className="px-1 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
        Link PR
      </div>
      {linkedNumber != null ? (
        <div className="flex items-center justify-between gap-2 px-1 text-[12px]">
          <span className="text-foreground">
            Linked to <span className="font-mono">#{linkedNumber}</span>
          </span>
          <button
            type="button"
            onClick={handleUnlink}
            disabled={update.isPending}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Unlink
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleLink();
              }
            }}
            placeholder="PR number or URL"
            className="flex-1 min-w-0 px-2 py-1 text-[12px] bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={handleLink}
            disabled={!input.trim() || update.isPending}
            className="px-2 py-1 text-[11px] font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Link
          </button>
        </div>
      )}
      {error && (
        <div className="px-1 text-[10.5px] text-destructive">{error}</div>
      )}
    </div>
  );
}

function parsePrInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  // Strip a leading `#` so "#402" works.
  const cleaned = s.replace(/^#/, '');
  // Plain integer.
  if (/^\d+$/.test(cleaned)) {
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  // URL form: github.com/owner/repo/pull/<number>
  const m = s.match(/\/pull\/(\d+)(?:[/?#]|$)/);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}
