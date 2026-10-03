'use client';

import { useState } from 'react';
import { ArrowUpToLine, ArrowDownToLine, ArrowUpRight, CheckCircle2, XCircle, Clock, AlertCircle, Archive, GitMerge, RotateCw } from 'lucide-react';
import { useExecutionActions, useHelpWithError, useSessionPr, type ActionState, type BaseInfo, type OpenablePr } from '@/hooks/use-execution-actions';
import type { PrChecks, PrReviewDecision } from '@/lib/github/pr-status-types';
import { useArchiveExecution } from '@/hooks/use-archive-execution';
import { useDashboard } from '@/contexts/dashboard-context';
import { ApiError } from '@/lib/api/client';
import { ActionButton } from './action-button';
import { CommitButton } from './commit-button';
import { OpenPrButton } from './open-pr-button';
import { MergeButton } from './merge-button';
import { ErrorModal } from '../error-modal';
import { narrativePr } from './narrative-pr';
import type { ChatSessionWithExecution, WorkspaceRecord } from '@/db/types';
import { HOME_VIEW } from '@/lib/client/active-view';
import { cn } from '@/lib/utils';

interface ExecutionActionBarProps {
  session: ChatSessionWithExecution;
  workspace: WorkspaceRecord | undefined | null;
  /**
   * Size the chip to its content instead of stretching to the row. The
   * desktop header sets this, since the chip sits at its far right next to
   * the layout toggles. The phone gives it a full-width row.
   */
  fit?: boolean;
}

/**
 * The git chip: one sentence describing where the branch stands, tinted by
 * state, with the one next step. Nothing renders for non-git workspaces and
 * not-yet-provisioned worktrees, apart from a linked PR's reference.
 */
export function ExecutionActionBar({ session, workspace, fit = false }: ExecutionActionBarProps) {
  const { state, base, openablePr, push, pullBase, pullUpstream, retrySetup, resolveConflicts } = useExecutionActions(
    session,
    workspace?.isGit ?? false,
  );
  const { archive, isPending: archivePending } = useArchiveExecution();
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
    void archive({
      id: session.id,
      label: session.execution?.label ?? session.label,
      onArchived: () => setActiveView(HOME_VIEW),
    });
  };

  // No ship actions for non-git, no-worktree, or archived sessions.
  // `setupFailed` is rendered so the user can retry the fetch.
  // `moving` is shown as the move's progress above the composer (see
  // TransferProgress). The ship actions wait until it arrives. A linked PR
  // still gets its link.
  if (
    state.kind === 'noWorktree' ||
    state.kind === 'archived' ||
    state.kind === 'cleanNoBranch' ||
    state.kind === 'moving'
  ) {
    return openablePr ? (
      <PrChip sessionId={session.id} prNumber={openablePr.number} prUrl={openablePr.url} closed={openablePr.closed} />
    ) : null;
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

  /** Bring in what was pushed to the branch elsewhere. A conflict goes to the agent. */
  const handlePullUpstream = () => {
    pullUpstream.mutate(undefined, {
      // The branch now has what its remote had, so a refused push is settled.
      onSuccess: () => push.reset(),
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          const body = err.body as { code?: string } | null;
          if (body?.code === 'merge_conflict') {
            handleResolveConflicts('local_vs_remote');
            return;
          }
        }
        setActionError({
          title: 'Pull failed',
          action: 'Pull the branch',
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

  return (
    <>
      <Narrative
        state={state}
        base={base}
        openablePr={openablePr}
        fit={fit}
        sessionId={session.id}
        push={{ pending: push.isPending, onClick: handlePush }}
        pullBase={{ pending: pullBase.isPending, onClick: handlePull }}
        pullUpstream={{ pending: pullUpstream.isPending, onClick: handlePullUpstream }}
        retrySetup={{ pending: retrySetup.isPending, onClick: handleRetrySetup }}
        archive={{ pending: archivePending, onClick: handleArchive }}
        resolveConflicts={resolveAction}
      />
      {errorModal}
    </>
  );
}

interface ResolveAction {
  pending: boolean;
  onClick: (scenario: 'pr_vs_base' | 'local_vs_remote') => void;
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
      <PrRef pr={{ number: prNumber, url: prUrl, closed: !!closed }} />
      {!closed && <PrBadges sessionId={sessionId} />}
    </span>
  );
}

/**
 * The PR as a reference, not a button: a squared, outlined `#402 ↗` that
 * opens it on GitHub. Readable at a glance, but with no fill, so the git
 * chip's one action stays the only thing that reads as work to do.
 */
function PrRef({ pr }: { pr: OpenablePr }) {
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      title={pr.closed ? `Closed PR #${pr.number}. Open on GitHub` : `Open PR #${pr.number} on GitHub`}
      aria-label={`${pr.closed ? 'Closed pull request' : 'Pull request'} #${pr.number} on GitHub`}
      className={cn(
        'inline-flex h-6 flex-shrink-0 items-center gap-1 rounded-[4px] border pl-1.5 pr-1 font-mono text-[12px] font-medium leading-none tabular-nums transition-colors',
        pr.closed
          ? 'border-rose-500/45 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400'
          : 'border-foreground/25 text-foreground/85 hover:border-foreground/40 hover:bg-muted/40 hover:text-foreground',
      )}
    >
      #{pr.number}
      <ArrowUpRight size={12} className="opacity-60" />
    </a>
  );
}

/** CI + review badges for an open PR, folded away when the header runs out of room. */
function PrBadges({ sessionId }: { sessionId: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 empty:hidden @max-[1120px]/exec:hidden">
      <PrStatusBadges sessionId={sessionId} />
    </span>
  );
}

/**
 * CI + review badges shown next to an open PR. Reads the same cached
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
  /** The base's name and how far behind it the branch is, when known. */
  base: BaseInfo | null;
  /** The PR to link to. States that don't carry one render it from here. */
  openablePr: OpenablePr | null;
  fit?: boolean;
  sessionId: string;
  push: { pending: boolean; onClick: () => void };
  pullBase: { pending: boolean; onClick: () => void };
  pullUpstream: { pending: boolean; onClick: () => void };
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
  // The bar short-circuits before reaching this map while it moves (the
  // move's progress replaces it), but exhaustiveness still needs the entry.
  moving: null,
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
  behindRemote: {
    chip: 'border-orange-500/40 bg-orange-500/10',
    text: 'text-orange-700 dark:text-orange-300',
  },
  aheadNoPr: {
    chip: 'border-blue-500/40 bg-blue-500/10',
    text: 'text-blue-700 dark:text-blue-300',
  },
  branchNoPr: {
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
 * Sentence-form expression of the git action state. The PR it concerns sits
 * outside on the left as a plain reference, the chip holds the status with
 * the one next action floated right (via `justify-between`), and the chip is
 * tinted by state so the user can recognize the situation at a glance.
 */
function Narrative({ state, base, openablePr, fit, sessionId, push, pullBase, pullUpstream, retrySetup, archive, resolveConflicts }: NarrativeProps) {
  const theme = THEME_BY_STATE[state.kind];
  if (!theme) return null;
  const pr = narrativePr(state, openablePr);

  return (
    <div className={`inline-flex ${fit ? 'w-auto' : 'w-full'} max-w-full min-w-0 items-center gap-2`}>
      {pr && <PrRef pr={pr} />}
      <div
        className={`inline-flex ${fit ? '' : 'flex-1'} min-w-0 items-center justify-between gap-3 rounded-lg border pl-1 pr-1 py-1 text-[11px] overflow-hidden ${theme.chip}`}
      >
        <NarrativeBody
          state={state}
          base={base}
          hasPr={pr != null}
          badges={pr && !pr.closed ? <PrBadges sessionId={sessionId} /> : null}
          theme={theme}
          sessionId={sessionId}
          push={push}
          pullBase={pullBase}
          pullUpstream={pullUpstream}
          retrySetup={retrySetup}
          archive={archive}
          resolveConflicts={resolveConflicts}
        />
      </div>
    </div>
  );
}

interface NarrativeBodyProps extends Omit<NarrativeProps, 'openablePr' | 'fit'> {
  theme: ChipTheme;
  /** A PR is named beside the chip (see `narrativePr`). */
  hasPr: boolean;
  /** The PR's CI + review badges, leading the status text. */
  badges: React.ReactNode;
}

function NarrativeBody({ state, base, hasPr, badges, theme, sessionId, push, pullBase, pullUpstream, retrySetup, archive, resolveConflicts }: NarrativeBodyProps) {
  const baseName = base?.name ?? 'base';
  // How far behind the base, beside a step it doesn't block.
  const behindNote = <BehindBaseNote base={base} />;
  switch (state.kind) {
    case 'setupFailed':
      return (
        <>
          <NarrativeLeft>
            {badges}
            <span className={`inline-flex items-center gap-1 font-medium px-1 ${theme.text}`}>
              <AlertCircle size={11} />
              {state.prNumber != null
                ? hasPr ? "Couldn't fetch its branch" : `Couldn't fetch PR #${state.prNumber}`
                : "Couldn't create worktree"}
            </span>
          </NarrativeLeft>
          <ActionButton
            icon={<RotateCw size={11} />}
            label="Try again"
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
            {badges}
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
            {badges}
            <NarrativeText themed={theme.text}>
              <span className="font-semibold tabular-nums">{state.behind}</span> behind {baseName}
            </NarrativeText>
          </NarrativeLeft>
          <ActionButton
            icon={<ArrowDownToLine size={11} />}
            label="Pull"
            onClick={pullBase.onClick}
            pending={pullBase.pending}
            variant="primary"
            title={`Bring in ${baseName}'s new commits`}
          />
        </>
      );

    case 'behindRemote':
      return (
        <>
          <NarrativeLeft>
            {badges}
            <NarrativeText themed={theme.text}>
              <span className="font-semibold tabular-nums">{state.behind}</span> new on {state.remote}
            </NarrativeText>
          </NarrativeLeft>
          <ActionButton
            icon={<ArrowDownToLine size={11} />}
            label="Pull"
            onClick={pullUpstream.onClick}
            pending={pullUpstream.pending}
            variant="primary"
            title={`Bring in ${state.behind === 1 ? 'a commit' : 'commits'} pushed to this branch from elsewhere`}
          />
        </>
      );

    case 'aheadNoPr':
      return (
        <>
          <NarrativeLeft>
            {badges}
            <NarrativeText themed={theme.text}>
              <span className="font-semibold tabular-nums">{state.ahead}</span>{' '}
              {state.ahead === 1 ? 'commit ahead' : 'commits ahead'}
            </NarrativeText>
            {behindNote}
          </NarrativeLeft>
          {/* One step at a time: once pushed, the chip moves to
              `branchNoPr` and offers Open PR. */}
          <ActionButton
            icon={<ArrowUpToLine size={11} />}
            label="Push"
            onClick={push.onClick}
            pending={push.pending}
            variant="primary"
            title="Push branch to origin"
          />
        </>
      );

    case 'branchNoPr':
      return (
        <>
          <NarrativeLeft>
            {badges}
            <NarrativeText themed={theme.text}>
              <span className="font-semibold tabular-nums">{state.files}</span>{' '}
              {state.files === 1 ? 'file changed' : 'files changed'}
            </NarrativeText>
            {behindNote}
          </NarrativeLeft>
          {/* A PR is already linked (GitHub just didn't confirm it), so
              don't offer to open a second one. */}
          {!hasPr && <OpenPrButton sessionId={sessionId} />}
        </>
      );

    case 'prOpenInSync':
    case 'prMergeable':
      return (
        <>
          <NarrativeLeft>
            {badges}
            <NarrativeText themed={theme.text}>Ready to merge</NarrativeText>
            {behindNote}
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
            {badges}
            <NarrativeText themed={theme.text}>
              <span className="font-semibold tabular-nums">{state.ahead}</span> unpushed
            </NarrativeText>
            {behindNote}
          </NarrativeLeft>
          <ActionButton
            icon={<ArrowUpToLine size={11} />}
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
            {badges}
            <NarrativeText themed={theme.text}>
              {state.behind > 0 ? (
                <><span className="font-semibold tabular-nums">{state.behind}</span> behind {baseName}</>
              ) : (
                <>Behind {baseName}</>
              )}
            </NarrativeText>
          </NarrativeLeft>
          <ActionButton
            icon={<ArrowDownToLine size={11} />}
            label="Pull"
            onClick={pullBase.onClick}
            pending={pullBase.pending}
            variant="primary"
            title={`GitHub won't merge it until it has ${baseName}'s latest commits. Bring them in, then push.`}
          />
        </>
      );

    case 'prConflictingWithBase':
      return (
        <>
          <NarrativeLeft>
            {badges}
            <span className={`inline-flex items-center gap-1 font-medium px-1 ${theme.text}`}>
              <AlertCircle size={11} />
              Conflicts with base
            </span>
          </NarrativeLeft>
          <ActionButton
            icon={<GitMerge size={11} />}
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
            {badges}
            <span className={`inline-flex items-center gap-1 font-medium px-1 ${theme.text}`}>
              <AlertCircle size={11} />
              Diverged from origin
            </span>
          </NarrativeLeft>
          {/* The push was refused because the remote has commits this side
              lacks. Pull merges them, and only a conflict goes to the agent. */}
          <ActionButton
            icon={<ArrowDownToLine size={11} />}
            label="Pull"
            onClick={pullUpstream.onClick}
            pending={pullUpstream.pending || resolveConflicts.pending}
            variant="primary"
            title="Bring in what was pushed to this branch elsewhere, then push. A conflict goes to the agent."
          />
        </>
      );

    case 'prMerged':
      return (
        <>
          <NarrativeLeft>
            {badges}
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
          <NarrativeText themed={theme.text}>Closed</NarrativeText>
        </NarrativeLeft>
      );

    default:
      return null;
  }
}

/**
 * How far behind its base the branch is, muted, beside a step it doesn't
 * block: GitHub merges a branch that's behind unless the base requires it up
 * to date (then the state is `prOpenBehindBase`). Folds away when the header
 * runs out of room.
 */
function BehindBaseNote({ base }: { base: BaseInfo | null }) {
  if (!base || base.behind <= 0) return null;
  return (
    <span
      className="whitespace-nowrap text-muted-foreground @max-[1120px]/exec:hidden"
      title={`${base.name} has ${base.behind} ${base.behind === 1 ? 'commit' : 'commits'} this branch doesn't. It can still merge.`}
    >
      · {base.behind} behind {base.name}
    </span>
  );
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
    <span className={`whitespace-nowrap font-medium ${themed}`}>
      {children}
    </span>
  );
}
