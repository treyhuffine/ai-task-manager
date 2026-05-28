'use client';

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi, type MergeRequestBody } from '@/lib/api/sessions';
import {
  useCommit,
  usePush,
  usePullBase,
  useRetrySetup,
  useSessionStatus,
} from '@/hooks/use-execution';
import type { ChatSessionWithExecution } from '@/db/types';

/** PR context that travels with worktree-state variants when present. */
export interface PrContext {
  prNumber: number;
  prUrl: string;
}

export type ActionState =
  | { kind: 'cleanNoBranch' }
  | { kind: 'dirty'; staged: number; unstaged: number; untracked: number; pr?: PrContext }
  /** Clean worktree, branch is behind base, no PR open yet. Surfaces a
   *  Pull button so the user can refresh from main before any branch
   *  divergence compounds. The original state machine only checked
   *  "behind" with a PR in flight, leaving pre-PR branches without an
   *  affordance to keep up with main. */
  | { kind: 'behindBase'; behind: number }
  | { kind: 'aheadNoPr'; ahead: number }
  | { kind: 'prOpenInSync'; prNumber: number; prUrl: string }
  | { kind: 'prOpenAhead'; prNumber: number; prUrl: string; ahead: number }
  | { kind: 'prOpenBehindBase'; prNumber: number; prUrl: string; behind: number }
  /** PR open and GitHub reports `mergeable: CONFLICTING` — base branch
   *  has moved in a way that doesn't merge cleanly. Resolution path:
   *  pull base into the local worktree, let the agent fix markers, push.
   *  `behind` is informational; conflict trumps "clean pull." */
  | { kind: 'prConflictingWithBase'; prNumber: number; prUrl: string; behind: number }
  /** Local branch has diverged from `origin/<branch>` — push was rejected
   *  non-fast-forward. Surfaces a Resolve Conflicts button that asks the
   *  agent to fetch origin, merge, fix markers, then push. Transient —
   *  once resolved the bar reverts to the underlying ahead/PR state. */
  | { kind: 'localDiverged' }
  | { kind: 'prMergeable'; prNumber: number; prUrl: string }
  | { kind: 'prClosed'; prNumber: number; prUrl: string }
  | { kind: 'prMerged'; prNumber: number; prUrl: string }
  | { kind: 'archived' }
  /** Worktree provisioning failed. The session row has `setupError` set
   *  and no `worktreePath`. UI exposes a Pull button that re-runs the
   *  fetch + create flow once the user fixes the underlying cause. */
  | { kind: 'setupFailed'; error: string; prNumber: number | null }
  | { kind: 'noWorktree' }
  /** User pulled this session locally via the takeover flow. The host's
   *  agent is paused; commit/push/PR actions are meaningless until the
   *  user runs `flow resume` or clicks Done in the takeover banner. */
  | { kind: 'takenOver'; takeoverToken: string; startedAt: string };

/**
 * GitHub PR for the session's branch. `null` when no PR exists yet
 * (or gh isn't installed / authenticated). Polled every 20s so the
 * action bar catches PRs created externally (via `gh pr create` in a
 * terminal, or someone opening one through the GitHub UI). Push
 * mutations also invalidate.
 */
export function useSessionPr(id: string | null) {
  return useQuery({
    queryKey: ['session', id, 'pr'],
    queryFn: () => sessionsApi.pr(id!),
    enabled: !!id,
    staleTime: 5_000,
    refetchInterval: 20_000,
  });
}

export function useOpenPr(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sessionsApi.openPr(id),
    onSuccess: () => {
      // The agent will start drafting + pushing; the PR appears on the
      // next refresh. Invalidate eagerly so the bar reflects the new
      // state once the agent finishes its turn.
      qc.invalidateQueries({ queryKey: ['session', id, 'pr'] });
      qc.invalidateQueries({ queryKey: ['session', id, 'status'] });
    },
  });
}

export function useMergePr(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: MergeRequestBody) => sessionsApi.mergePr(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session', id, 'pr'] });
      qc.invalidateQueries({ queryKey: ['session', id, 'status'] });
      qc.invalidateQueries({ queryKey: ['session', id] });
    },
  });
}

/**
 * "Resolve conflicts" action — injects a fetch/merge/resolve/push prompt
 * for the agent. Two scenarios share the endpoint, differing only in
 * which branch the agent is asked to merge in.
 */
export function useResolveConflicts(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scenario: 'pr_vs_base' | 'local_vs_remote') =>
      sessionsApi.resolveConflicts(id, scenario),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session', id, 'status'] });
      qc.invalidateQueries({ queryKey: ['session', id, 'pr'] });
    },
  });
}

/**
 * "Solve with agent" action — used by the error modal to forward a
 * failed action-bar operation into the chat for the agent to diagnose.
 */
export interface HelpWithErrorInput {
  action: string;
  error: string;
  context?: ReadonlyArray<{ label: string; value: string }>;
}

export function useHelpWithError(id: string) {
  return useMutation({
    mutationFn: (input: HelpWithErrorInput) => sessionsApi.helpWithError(id, input),
  });
}

interface UseExecutionActionsResult {
  state: ActionState;
  commit: ReturnType<typeof useCommit>;
  push: ReturnType<typeof usePush>;
  pullBase: ReturnType<typeof usePullBase>;
  retrySetup: ReturnType<typeof useRetrySetup>;
  openPr: ReturnType<typeof useOpenPr>;
  mergePr: ReturnType<typeof useMergePr>;
  resolveConflicts: ReturnType<typeof useResolveConflicts>;
}

/**
 * Composes the per-session state machine the action bar consumes. Derives
 * `ActionState` from worktree status + the PR query; exposes ready-to-fire
 * mutation handles for every action the bar might surface.
 */
export function useExecutionActions(
  session: ChatSessionWithExecution | undefined,
  workspaceIsGit: boolean | null | undefined,
): UseExecutionActionsResult {
  const id = session?.id ?? '';
  const { data: status } = useSessionStatus(id || null);
  const { data: prResp } = useSessionPr(id || null);
  const commit = useCommit(id);
  const push = usePush(id);
  const pullBase = usePullBase(id);
  const retrySetup = useRetrySetup(id);
  const openPr = useOpenPr(id);
  const mergePr = useMergePr(id);
  const resolveConflicts = useResolveConflicts(id);

  // A push that came back 409 / `non_fast_forward` means local and the
  // remote tracking branch diverged. Persist that into a transient state
  // override until the user clicks Resolve Conflicts (which clears the
  // error via `push.reset()`).
  const pushNonFastForward = useMemo(() => {
    const err = push.error;
    if (!err) return false;
    const body = (err as { body?: unknown }).body as { code?: string } | null | undefined;
    return body?.code === 'non_fast_forward';
  }, [push.error]);

  const state = useMemo<ActionState>(() => {
    if (!session) return { kind: 'noWorktree' };
    if (session.status === 'archived') return { kind: 'archived' };
    // Takeover supersedes every other state — while the user owns the
    // work locally, we don't want the action bar to suggest commits or
    // pushes that race with their laptop's branch.
    if (session.takeoverStartedAt && session.takeoverToken) {
      return {
        kind: 'takenOver',
        takeoverToken: session.takeoverToken,
        startedAt: session.takeoverStartedAt,
      };
    }
    // Failed-setup wins over noWorktree so the user gets the retry
    // affordance instead of an empty pill while sitting on a stuck row.
    if (!session.worktreePath && workspaceIsGit && session.setupError) {
      return {
        kind: 'setupFailed',
        error: session.setupError,
        prNumber: session.prNumber ?? null,
      };
    }
    if (!session.worktreePath || !workspaceIsGit) return { kind: 'noWorktree' };

    // Push rejection overrides every "normal" downstream state so the
    // user always sees the resolve affordance until they act on it.
    if (pushNonFastForward) {
      return { kind: 'localDiverged' };
    }

    const pr = prResp?.pr;

    if (status) {
      const stagedCount = status.staged.length;
      const unstagedCount = status.modified.length;
      const untrackedCount = status.untracked.length;
      const isDirty = stagedCount + unstagedCount + untrackedCount > 0;
      const ahead = status.ahead;
      const behind = status.behind;

      if (isDirty) {
        return {
          kind: 'dirty',
          staged: stagedCount,
          unstaged: unstagedCount,
          untracked: untrackedCount,
          // Carry PR context through so the narrative chip can still
          // show the link even when dirty — losing the PR identity to
          // a transient uncommitted state was too jarring.
          pr: pr
            ? (pr.state === 'OPEN'
              ? { prNumber: pr.number, prUrl: pr.url }
              : undefined)
            : undefined,
        };
      }

      if (pr) {
        if (pr.state === 'MERGED') {
          return { kind: 'prMerged', prNumber: pr.number, prUrl: pr.url };
        }
        if (pr.state === 'CLOSED') {
          return { kind: 'prClosed', prNumber: pr.number, prUrl: pr.url };
        }
        // GitHub says the PR can't merge cleanly into its base. Override
        // the behind/ahead branches below — the next step here is "ask
        // the agent to resolve" (pull base, fix markers, push), not
        // "merge" or "push more commits."
        if (pr.mergeable === 'CONFLICTING') {
          return {
            kind: 'prConflictingWithBase',
            prNumber: pr.number,
            prUrl: pr.url,
            behind,
          };
        }
        if (behind > 0) {
          return {
            kind: 'prOpenBehindBase',
            prNumber: pr.number,
            prUrl: pr.url,
            behind,
          };
        }
        if (ahead > 0) {
          return {
            kind: 'prOpenAhead',
            prNumber: pr.number,
            prUrl: pr.url,
            ahead,
          };
        }
        // Open and in sync — show Merge.
        return { kind: 'prOpenInSync', prNumber: pr.number, prUrl: pr.url };
      }

      // Clean, no PR — pick the next-step affordance based on
      // ahead/behind. Pre-PR `behindBase` is a recent addition; the
      // original machine left clean-but-behind branches with no button.
      if (behind > 0) {
        return { kind: 'behindBase', behind };
      }
      if (ahead > 0) {
        return { kind: 'aheadNoPr', ahead };
      }
    }

    return { kind: 'cleanNoBranch' };
  }, [session, workspaceIsGit, prResp, status, pushNonFastForward]);

  return { state, commit, push, pullBase, retrySetup, openPr, mergePr, resolveConflicts };
}
