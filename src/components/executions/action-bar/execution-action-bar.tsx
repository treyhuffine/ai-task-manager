'use client';

import { useState } from 'react';
import { Send, ArrowDownToLine, ArrowUpRight, CheckCircle2, XCircle, Clock, AlertCircle, Archive } from 'lucide-react';
import { useExecutionActions, useHelpWithError, useSessionPr, type ActionState } from '@/hooks/use-execution-actions';
import type { PrChecks, PrReviewDecision } from '@/lib/github/pr-status-types';
import { useArchiveSession } from '@/hooks/use-workspaces';
import { useDashboard } from '@/contexts/dashboard-context';
import { ApiError } from '@/lib/api/client';
import { ActionButton } from './action-button';
import { CommitButton } from './commit-button';
import { OpenPrButton } from './open-pr-button';
import { MergeButton } from './merge-button';
import { ErrorModal } from '../error-modal';
import type { ChatSessionWithExecution, WorkspaceRecord } from '@/db/types';

interface ExecutionActionBarProps {
  session: ChatSessionWithExecution;
  workspace: WorkspaceRecord | undefined | null;
  /**
   * Layout variant:
   *   - `row` (default): standalone strip with its own border + bg.
   *     Used on mobile where space allows a dedicated row.
   *   - `inline`: no wrapper — just the buttons. Used inside the
   *     desktop full-width header so the actions sit alongside the
   *     status pill and menu.
   *   - `narrative`: a single contained chip that reads as a sentence
   *     describing the current git state and the next action. Used
   *     by the desktop header's narrative layout variant.
   */
  variant?: 'row' | 'inline' | 'narrative';
}

/**
 * State-driven cluster of review-and-ship actions. Visibility-only —
 * missing actions don't render; the exception is `Merge`, which
 * renders greyed with a tooltip when a PR exists but isn't mergeable.
 *
 * For non-git workspaces and not-yet-provisioned worktrees the bar
 * collapses to nothing (handled at the call site).
 */
export function ExecutionActionBar({ session, workspace, variant = 'row' }: ExecutionActionBarProps) {
  const { state, push, pullBase, retrySetup, openPr, mergePr, resolveConflicts } = useExecutionActions(
    session,
    workspace?.isGit ?? false,
  );
  const archive = useArchiveSession();
  const helpWithError = useHelpWithError(session.id);
  const { setActiveView } = useDashboard();

  /**
   * Lifted error-modal state — set by any handler whose mutation failed
   * with a non-actionable error. The modal renders below the bar and
   * exposes a "Solve with agent" CTA that forwards the failure into the
   * chat as a prompt. The optional `action` field labels what the user
   * was trying to do, used both in the prompt and in modal copy.
   */
  const [actionError, setActionError] = useState<{
    title: string;
    /** Short verb-phrase of what the user clicked — "Pull base", "Push", etc. */
    action: string;
    message: string;
    context?: ReadonlyArray<{ label: string; value: string }>;
  } | null>(null);

  /** Pulls the most useful free-text out of either an ApiError body or a generic Error. */
  const errorText = (err: unknown): string => {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string; error?: string } | null;
      const msg = body?.message ?? body?.error;
      return msg ?? `HTTP ${err.status}`;
    }
    if (err instanceof Error) return err.message;
    return String(err);
  };

  const baseContext = (): { label: string; value: string }[] => {
    const entries: { label: string; value: string }[] = [];
    if (session.branchName) entries.push({ label: 'Branch', value: session.branchName });
    if (workspace?.baseBranch) entries.push({ label: 'Base', value: workspace.baseBranch });
    return entries;
  };

  const handleArchive = () => {
    if (!confirm(`Archive "${session.execution?.label ?? session.label ?? 'this execution'}"?`)) return;
    archive.mutate(
      { id: session.id, force: false },
      {
        onSuccess: () => setActiveView('command'),
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
          setActionError({
            title: "Couldn't archive",
            action: 'Archive',
            message: errorText(err),
            context: baseContext(),
          });
        },
      },
    );
  };

  // Hide entirely for non-git, no-worktree, or archived sessions.
  // `setupFailed` is rendered so the user can retry the fetch.
  // `takenOver` is rendered as a separate banner above the transcript
  // (see TakeoverBanner) — the regular ship actions don't apply while
  // the user's laptop owns the work.
  if (
    state.kind === 'noWorktree' ||
    state.kind === 'archived' ||
    state.kind === 'cleanNoBranch' ||
    state.kind === 'takenOver'
  ) {
    return null;
  }

  const handlePush = () => {
    push.mutate(undefined, {
      onError: (err) => {
        // 409 + `non_fast_forward` is the divergence case — the state
        // machine reads `push.error` directly and flips to
        // `localDiverged`. No modal needed; the user gets a Resolve
        // Conflicts button on the bar itself.
        if (err instanceof ApiError && err.status === 409) {
          const body = err.body as { code?: string } | null;
          if (body?.code === 'non_fast_forward') return;
        }
        setActionError({
          title: 'Push failed',
          action: 'Push',
          message: errorText(err),
          context: baseContext(),
        });
      },
    });
  };

  const handlePull = () => {
    pullBase.mutate(undefined, {
      onError: (err) => {
        // 409 + `merge_conflict` is the expected conflict path —
        // auto-dispatch resolve-conflicts and skip the modal.
        if (err instanceof ApiError && err.status === 409) {
          const body = err.body as { code?: string } | null;
          if (body?.code === 'merge_conflict') {
            resolveConflicts.mutate('pr_vs_base');
            return;
          }
        }
        setActionError({
          title: 'Pull failed',
          action: 'Pull base',
          message: errorText(err),
          context: baseContext(),
        });
      },
    });
  };

  const handleResolveConflicts = (scenario: 'pr_vs_base' | 'local_vs_remote') => {
    resolveConflicts.mutate(scenario, {
      onSuccess: () => {
        // Clear the push-rejected error so the state machine drops out
        // of `localDiverged` once the agent's turn lands the resolution.
        if (scenario === 'local_vs_remote') push.reset();
      },
      onError: (err) => {
        setActionError({
          title: "Couldn't start conflict resolution",
          action: 'Resolve conflicts',
          message: errorText(err),
          context: baseContext(),
        });
      },
    });
  };

  const handleRetrySetup = () => {
    retrySetup.mutate(undefined, {
      onError: (err) => {
        // The server also persists this to setupError, but surface
        // the immediate message too so the user sees something change.
        setActionError({
          title: 'Retry setup failed',
          action: 'Retry worktree setup',
          message: errorText(err),
          context: baseContext(),
        });
      },
    });
  };

  /**
   * "Solve with agent" — forwards the captured error into the chat as a
   * prompt. The agent investigates and either fixes it or explains what
   * the user needs to do. Modal closes immediately so the user can
   * watch the turn stream in.
   */
  const handleSolveWithAgent = () => {
    if (!actionError) return;
    helpWithError.mutate(
      {
        action: actionError.action,
        error: actionError.message,
        context: actionError.context,
      },
      {
        onSuccess: () => setActionError(null),
      },
    );
  };

  const resolveAction = {
    pending: resolveConflicts.isPending,
    onClick: handleResolveConflicts,
  };

  const errorModal = (
    <ErrorModal
      open={actionError != null}
      onClose={() => setActionError(null)}
      title={actionError?.title ?? 'Error'}
      message={actionError?.message ?? ''}
      action={{
        label: 'Solve with agent',
        onClick: handleSolveWithAgent,
        pending: helpWithError.isPending,
        hint: 'Forwards the error to the chat. The agent will investigate and fix or explain.',
      }}
    />
  );

  if (variant === 'narrative') {
    return (
      <>
        <Narrative
          state={state}
          sessionId={session.id}
          push={{ pending: push.isPending, onClick: handlePush }}
          pullBase={{ pending: pullBase.isPending, onClick: handlePull }}
          retrySetup={{ pending: retrySetup.isPending, onClick: handleRetrySetup }}
          archive={{ pending: archive.isPending, onClick: handleArchive }}
          resolveConflicts={resolveAction}
        />
        {errorModal}
      </>
    );
  }

  const buttons = (
    <Buttons
      state={state}
      sessionId={session.id}
      push={{ pending: push.isPending, onClick: handlePush }}
      pullBase={{ pending: pullBase.isPending, onClick: handlePull }}
      retrySetup={{ pending: retrySetup.isPending, onClick: handleRetrySetup }}
      archive={{ pending: archive.isPending, onClick: handleArchive }}
      resolveConflicts={resolveAction}
      openPrPending={openPr.isPending}
      mergePending={mergePr.isPending}
    />
  );

  if (variant === 'inline') {
    return (
      <>
        <div className="flex items-center gap-1.5 min-w-0">{buttons}</div>
        {errorModal}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-1.5 border-b border-border bg-background/95 px-3 py-1.5 overflow-x-auto">
        {buttons}
      </div>
      {errorModal}
    </>
  );
}

interface ResolveAction {
  pending: boolean;
  onClick: (scenario: 'pr_vs_base' | 'local_vs_remote') => void;
}

interface ButtonsProps {
  state: ActionState;
  sessionId: string;
  push: { pending: boolean; onClick: () => void };
  pullBase: { pending: boolean; onClick: () => void };
  retrySetup: { pending: boolean; onClick: () => void };
  archive: { pending: boolean; onClick: () => void };
  resolveConflicts: ResolveAction;
  openPrPending: boolean;
  mergePending: boolean;
}

function Buttons({ state, sessionId, push, pullBase, retrySetup, archive, resolveConflicts, openPrPending: _openPrPending, mergePending: _mergePending }: ButtonsProps) {
  switch (state.kind) {
    case 'setupFailed':
      return (
        <ActionButton
          icon={<ArrowDownToLine size={11} />}
          label="Pull"
          onClick={retrySetup.onClick}
          pending={retrySetup.pending}
          variant="primary"
          title={`Worktree setup failed: ${state.error}\nClick to fetch and retry.`}
        />
      );

    case 'dirty':
      return (
        <CommitButton
          sessionId={sessionId}
          variant="primary"
          andPush
          pendingCount={state.staged + state.unstaged + state.untracked}
        />
      );

    case 'behindBase':
      return (
        <ActionButton
          icon={<ArrowDownToLine size={11} />}
          label="Pull"
          count={state.behind}
          onClick={pullBase.onClick}
          pending={pullBase.pending}
          variant="primary"
          title="Pull and merge updates from the base branch"
        />
      );

    case 'aheadNoPr':
      return (
        <>
          <ActionButton
            icon={<Send size={11} />}
            label="Push"
            count={state.ahead}
            onClick={push.onClick}
            pending={push.pending}
            variant="secondary"
            title="Push branch to origin"
          />
          <OpenPrButton sessionId={sessionId} />
        </>
      );

    case 'prOpenInSync':
      return (
        <>
          <PrChip sessionId={sessionId} prNumber={state.prNumber} prUrl={state.prUrl} />
          <MergeButton
            sessionId={sessionId}
            prNumber={state.prNumber}
            prUrl={state.prUrl}
            enabled={true}
            variant="primary"
          />
        </>
      );

    case 'prOpenAhead':
      return (
        <>
          <PrChip sessionId={sessionId} prNumber={state.prNumber} prUrl={state.prUrl} />
          <ActionButton
            icon={<Send size={11} />}
            label="Push"
            count={state.ahead}
            onClick={push.onClick}
            pending={push.pending}
            variant="primary"
            title="Push new commits to update the PR"
          />
          <MergeButton
            sessionId={sessionId}
            prNumber={state.prNumber}
            prUrl={state.prUrl}
            enabled={false}
            reason="Local has unpushed commits. Push first, then merge."
          />
        </>
      );

    case 'prOpenBehindBase':
      return (
        <>
          <PrChip sessionId={sessionId} prNumber={state.prNumber} prUrl={state.prUrl} />
          <ActionButton
            icon={<ArrowDownToLine size={11} />}
            label="Pull"
            count={state.behind}
            onClick={pullBase.onClick}
            pending={pullBase.pending}
            variant="primary"
            title="Pull and merge updates from the base branch"
          />
          <MergeButton
            sessionId={sessionId}
            prNumber={state.prNumber}
            prUrl={state.prUrl}
            enabled={false}
            reason="Base branch has moved. Pull base first to resolve."
          />
        </>
      );

    case 'prConflictingWithBase':
      return (
        <>
          <PrChip sessionId={sessionId} prNumber={state.prNumber} prUrl={state.prUrl} />
          <ActionButton
            icon={<AlertCircle size={11} />}
            label="Resolve conflicts"
            onClick={() => resolveConflicts.onClick('pr_vs_base')}
            pending={resolveConflicts.pending}
            variant="primary"
            title="GitHub reports this PR can't merge cleanly. Ask the agent to pull base, resolve, and push."
          />
          <MergeButton
            sessionId={sessionId}
            prNumber={state.prNumber}
            prUrl={state.prUrl}
            enabled={false}
            reason="PR has conflicts with base. Resolve first."
          />
        </>
      );

    case 'localDiverged':
      return (
        <ActionButton
          icon={<AlertCircle size={11} />}
          label="Resolve conflicts"
          onClick={() => resolveConflicts.onClick('local_vs_remote')}
          pending={resolveConflicts.pending}
          variant="primary"
          title="Local has diverged from origin. Ask the agent to fetch, merge, resolve, and push."
        />
      );

    case 'prMergeable':
      return (
        <>
          <PrChip sessionId={sessionId} prNumber={state.prNumber} prUrl={state.prUrl} />
          <MergeButton
            sessionId={sessionId}
            prNumber={state.prNumber}
            prUrl={state.prUrl}
            enabled={true}
            variant="primary"
          />
        </>
      );

    case 'prMerged':
      return (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
            <CheckCircle2 size={11} />
            <a
              href={state.prUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              PR #{state.prNumber} merged
            </a>
          </span>
          <ActionButton
            icon={<Archive size={11} />}
            label="Archive"
            onClick={archive.onClick}
            pending={archive.pending}
            variant="primary"
            title="Archive this execution"
          />
        </>
      );

    case 'prClosed':
      return (
        <PrChip sessionId={sessionId} prNumber={state.prNumber} prUrl={state.prUrl} closed />
      );

    default:
      return null;
  }
}

interface PrChipProps {
  sessionId: string;
  prNumber: number;
  prUrl: string;
  closed?: boolean;
}

function PrChip({ sessionId, prNumber, prUrl, closed }: PrChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <a
        href={prUrl}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
          closed
            ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/15'
            : 'border-border bg-muted/30 text-foreground/80 hover:bg-muted/50'
        }`}
        title={closed ? `Closed PR #${prNumber}` : `Open PR #${prNumber}`}
      >
        <span>PR #{prNumber}</span>
        <ArrowUpRight size={11} className="opacity-70" />
      </a>
      {!closed && <PrStatusBadges sessionId={sessionId} />}
    </span>
  );
}

/**
 * CI + review badges shown next to an open PR chip. Reads the same cached
 * PR query the state machine uses (React Query dedupes the key), so it adds
 * no fetch. Renders nothing until the PR resolves to OPEN with real signal.
 */
function PrStatusBadges({ sessionId }: { sessionId: string }) {
  const { data } = useSessionPr(sessionId);
  const pr = data?.pr;
  if (!pr || pr.state !== 'OPEN') return null;
  return (
    <>
      {pr.checks && <ChecksBadge checks={pr.checks} />}
      {pr.reviewDecision && <ReviewBadge decision={pr.reviewDecision} />}
    </>
  );
}

function ChecksBadge({ checks }: { checks: PrChecks }) {
  const cfg = {
    passing: {
      icon: <CheckCircle2 size={12} />,
      cls: 'text-emerald-600 dark:text-emerald-400',
      label: `CI: ${checks.passed}/${checks.total} checks passed`,
    },
    failing: {
      icon: <XCircle size={12} />,
      cls: 'text-rose-600 dark:text-rose-400',
      label: `CI: ${checks.failed} of ${checks.total} checks failing`,
    },
    pending: {
      icon: <Clock size={12} />,
      cls: 'text-amber-600 dark:text-amber-400',
      label: `CI: ${checks.pending} of ${checks.total} checks running`,
    },
  }[checks.state];
  return (
    <span className={`inline-flex items-center ${cfg.cls}`} title={cfg.label} aria-label={cfg.label}>
      {cfg.icon}
    </span>
  );
}

function ReviewBadge({ decision }: { decision: PrReviewDecision }) {
  const cfg = {
    approved: {
      cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      label: 'Approved',
    },
    changes_requested: {
      cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      label: 'Changes requested',
    },
    review_required: {
      cls: 'border-border bg-muted/40 text-muted-foreground',
      label: 'Review required',
    },
  }[decision];
  return (
    <span
      className={`inline-flex items-center rounded border px-1 py-0.5 text-[10px] font-medium leading-none ${cfg.cls}`}
      title={`Review: ${cfg.label}`}
    >
      {cfg.label}
    </span>
  );
}

interface NarrativeProps {
  state: ActionState;
  sessionId: string;
  push: { pending: boolean; onClick: () => void };
  pullBase: { pending: boolean; onClick: () => void };
  retrySetup: { pending: boolean; onClick: () => void };
  archive: { pending: boolean; onClick: () => void };
  resolveConflicts: ResolveAction;
}

/**
 * Per-state theme. Determines the chip's border + background tint so
 * the user can recognize "where am I in git" without reading the text.
 * Order roughly matches a happy-path progression — dirty → ahead →
 * PR-in-flight → mergeable → merged.
 */
type ChipTheme = {
  /** Chip wrapper classes (border + bg). */
  chip: string;
  /** Status text color (the "Ready to merge", "unpushed", etc. middle). */
  text: string;
};

const THEME_BY_STATE: Record<ActionState['kind'], ChipTheme | null> = {
  noWorktree: null,
  cleanNoBranch: null,
  archived: null,
  // The action bar short-circuits before reaching this map when the
  // session is in takeover (banner replaces the bar entirely), but
  // TypeScript's exhaustiveness check still needs the entry.
  takenOver: null,
  setupFailed: {
    chip: 'border-rose-500/40 bg-rose-500/10',
    text: 'text-rose-700 dark:text-rose-300',
  },
  dirty: {
    chip: 'border-amber-500/40 bg-amber-500/10',
    text: 'text-amber-700 dark:text-amber-300',
  },
  behindBase: {
    chip: 'border-orange-500/40 bg-orange-500/10',
    text: 'text-orange-700 dark:text-orange-300',
  },
  aheadNoPr: {
    chip: 'border-blue-500/40 bg-blue-500/10',
    text: 'text-blue-700 dark:text-blue-300',
  },
  prOpenInSync: {
    chip: 'border-emerald-500/40 bg-emerald-500/10',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  prMergeable: {
    chip: 'border-emerald-500/40 bg-emerald-500/10',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  prOpenAhead: {
    chip: 'border-amber-500/40 bg-amber-500/10',
    text: 'text-amber-700 dark:text-amber-300',
  },
  prOpenBehindBase: {
    chip: 'border-orange-500/40 bg-orange-500/10',
    text: 'text-orange-700 dark:text-orange-300',
  },
  prConflictingWithBase: {
    chip: 'border-rose-500/40 bg-rose-500/10',
    text: 'text-rose-700 dark:text-rose-300',
  },
  localDiverged: {
    chip: 'border-rose-500/40 bg-rose-500/10',
    text: 'text-rose-700 dark:text-rose-300',
  },
  prMerged: {
    chip: 'border-border bg-muted/40',
    text: 'text-muted-foreground',
  },
  prClosed: {
    chip: 'border-rose-500/40 bg-rose-500/10',
    text: 'text-rose-700 dark:text-rose-300',
  },
};

/**
 * Sentence-form expression of the git action state. The PR identity
 * and status sit on the left, the primary action floats to the right
 * (via `justify-between`), and the chip itself is tinted by state so
 * the user can recognize the situation at a glance.
 */
function Narrative({ state, sessionId, push, pullBase, retrySetup, archive, resolveConflicts }: NarrativeProps) {
  const theme = THEME_BY_STATE[state.kind];
  if (!theme) return null;

  return (
    <div
      className={`inline-flex w-full items-center justify-between gap-3 rounded-lg border pl-1 pr-1 py-1 text-[11px] max-w-full overflow-hidden ${theme.chip}`}
    >
      <NarrativeBody
        state={state}
        theme={theme}
        sessionId={sessionId}
        push={push}
        pullBase={pullBase}
        retrySetup={retrySetup}
        archive={archive}
        resolveConflicts={resolveConflicts}
      />
    </div>
  );
}

interface NarrativeBodyProps extends NarrativeProps {
  theme: ChipTheme;
}

function NarrativeBody({ state, theme, sessionId, push, pullBase, retrySetup, archive, resolveConflicts }: NarrativeBodyProps) {
  switch (state.kind) {
    case 'setupFailed':
      return (
        <>
          <NarrativeLeft>
            <span className={`inline-flex items-center gap-1 font-medium px-1 ${theme.text}`}>
              <AlertCircle size={11} />
              {state.prNumber != null
                ? `Couldn't fetch PR #${state.prNumber}`
                : "Couldn't create worktree"}
            </span>
          </NarrativeLeft>
          <ActionButton
            icon={<ArrowDownToLine size={11} />}
            label="Pull"
            onClick={retrySetup.onClick}
            pending={retrySetup.pending}
            variant="primary"
            title={`${state.error}\nClick to fetch and retry.`}
          />
        </>
      );

    case 'dirty':
      return (
        <>
          <NarrativeLeft>
            {state.pr && (
              <PrChip sessionId={sessionId} prNumber={state.pr.prNumber} prUrl={state.pr.prUrl} />
            )}
            <NarrativeText themed={theme.text}>
              <span className="font-semibold tabular-nums">
                {state.staged + state.unstaged + state.untracked}
              </span>{' '}
              uncommitted
            </NarrativeText>
          </NarrativeLeft>
          <CommitButton sessionId={sessionId} variant="primary" andPush />
        </>
      );

    case 'behindBase':
      return (
        <>
          <NarrativeLeft>
            <NarrativeText themed={theme.text}>
              <span className="font-semibold tabular-nums">{state.behind}</span> behind base
            </NarrativeText>
          </NarrativeLeft>
          <ActionButton
            icon={<ArrowDownToLine size={11} />}
            label="Pull"
            onClick={pullBase.onClick}
            pending={pullBase.pending}
            variant="primary"
            title="Pull and merge updates from the base branch"
          />
        </>
      );

    case 'aheadNoPr':
      return (
        <>
          <NarrativeLeft>
            <NarrativeText themed={theme.text}>
              <span className="font-semibold tabular-nums">{state.ahead}</span>{' '}
              {state.ahead === 1 ? 'commit ahead' : 'commits ahead'}
            </NarrativeText>
          </NarrativeLeft>
          <div className="flex items-center gap-1.5">
            <ActionButton
              icon={<Send size={11} />}
              label="Push"
              onClick={push.onClick}
              pending={push.pending}
              variant="secondary"
              title="Push branch to origin"
            />
            <OpenPrButton sessionId={sessionId} />
          </div>
        </>
      );

    case 'prOpenInSync':
    case 'prMergeable':
      return (
        <>
          <NarrativeLeft>
            <PrChip sessionId={sessionId} prNumber={state.prNumber} prUrl={state.prUrl} />
            <NarrativeText themed={theme.text}>Ready to merge</NarrativeText>
          </NarrativeLeft>
          <MergeButton
            sessionId={sessionId}
            prNumber={state.prNumber}
            prUrl={state.prUrl}
            enabled={true}
            variant="primary"
          />
        </>
      );

    case 'prOpenAhead':
      return (
        <>
          <NarrativeLeft>
            <PrChip sessionId={sessionId} prNumber={state.prNumber} prUrl={state.prUrl} />
            <NarrativeText themed={theme.text}>
              <span className="font-semibold tabular-nums">{state.ahead}</span> unpushed
            </NarrativeText>
          </NarrativeLeft>
          <ActionButton
            icon={<Send size={11} />}
            label="Push"
            onClick={push.onClick}
            pending={push.pending}
            variant="primary"
            title="Push new commits to update the PR"
          />
        </>
      );

    case 'prOpenBehindBase':
      return (
        <>
          <NarrativeLeft>
            <PrChip sessionId={sessionId} prNumber={state.prNumber} prUrl={state.prUrl} />
            <NarrativeText themed={theme.text}>
              <span className="font-semibold tabular-nums">{state.behind}</span> behind base
            </NarrativeText>
          </NarrativeLeft>
          <ActionButton
            icon={<ArrowDownToLine size={11} />}
            label="Pull"
            onClick={pullBase.onClick}
            pending={pullBase.pending}
            variant="primary"
            title="Pull and merge updates from the base branch"
          />
        </>
      );

    case 'prConflictingWithBase':
      return (
        <>
          <NarrativeLeft>
            <PrChip sessionId={sessionId} prNumber={state.prNumber} prUrl={state.prUrl} />
            <span className={`inline-flex items-center gap-1 font-medium px-1 ${theme.text}`}>
              <AlertCircle size={11} />
              Conflicts with base
            </span>
          </NarrativeLeft>
          <ActionButton
            icon={<AlertCircle size={11} />}
            label="Resolve conflicts"
            onClick={() => resolveConflicts.onClick('pr_vs_base')}
            pending={resolveConflicts.pending}
            variant="primary"
            title="Ask the agent to pull base, resolve, and push"
          />
        </>
      );

    case 'localDiverged':
      return (
        <>
          <NarrativeLeft>
            <span className={`inline-flex items-center gap-1 font-medium px-1 ${theme.text}`}>
              <AlertCircle size={11} />
              Diverged from origin
            </span>
          </NarrativeLeft>
          <ActionButton
            icon={<AlertCircle size={11} />}
            label="Resolve conflicts"
            onClick={() => resolveConflicts.onClick('local_vs_remote')}
            pending={resolveConflicts.pending}
            variant="primary"
            title="Ask the agent to fetch, merge, resolve, and push"
          />
        </>
      );

    case 'prMerged':
      return (
        <>
          <NarrativeLeft>
            <PrChip sessionId={sessionId} prNumber={state.prNumber} prUrl={state.prUrl} />
            <span className={`inline-flex items-center gap-1 font-medium px-1 ${theme.text}`}>
              <CheckCircle2 size={11} />
              Merged
            </span>
          </NarrativeLeft>
          <ActionButton
            icon={<Archive size={11} />}
            label="Archive"
            onClick={archive.onClick}
            pending={archive.pending}
            variant="primary"
            title="Archive this execution"
          />
        </>
      );

    case 'prClosed':
      return (
        <NarrativeLeft>
          <PrChip sessionId={sessionId} prNumber={state.prNumber} prUrl={state.prUrl} closed />
          <NarrativeText themed={theme.text}>Closed</NarrativeText>
        </NarrativeLeft>
      );

    default:
      return null;
  }
}

function NarrativeLeft({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 min-w-0 overflow-hidden pl-1">
      {children}
    </div>
  );
}

function NarrativeText({ children, themed }: { children: React.ReactNode; themed: string }) {
  return (
    <span className={`truncate font-medium ${themed}`}>
      {children}
    </span>
  );
}
