'use client';

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi, type MergeRequestBody, type AutoMergeRequestBody, type PrInfo, type WorktreeStatus } from '@/lib/api/sessions';
import {
  useCommit,
  usePush,
  usePullBase,
  useRetrySetup,
  useSessionStatus,
  useTransfer,
  useWorktreeScope,
  worktreeScopeFromCache,
} from '@/hooks/use-execution';
import type { ChatSessionWithExecution } from '@/db/types';
import type { TransferView } from '@/lib/transfer/view';
import { preparedFolder } from '@/lib/executions/location';

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
  /** Moving to another device, which doesn't have it yet (P4.5). The
   *  move's progress replaces the bar: a commit, push or merge would race
   *  the save, and the server refuses them until it arrives. */
  | { kind: 'moving'; to: string };

/**
 * GitHub PR for the session's branch. `null` when no PR exists yet
 * (or gh isn't installed / authenticated). Polled every 20s so the
 * action bar catches PRs created externally (via `gh pr create` in a
 * terminal, or someone opening one through the GitHub UI). Push
 * mutations also invalidate.
 */
export function useSessionPr(id: string | null) {
  // The PR tracks the execution's branch, so sibling chats share one entry.
  const scope = useWorktreeScope(id);
  return useQuery({
    queryKey: [...(scope ?? ['session', id ?? '__none__']), 'pr'],
    queryFn: () => sessionsApi.pr(id!),
    enabled: !!id && !!scope,
    staleTime: 5_000,
    refetchInterval: 20_000,
  });
}

/**
 * The linked PR's address from the repo remote, never from GitHub. Only
 * fetched when a PR number is linked, and keyed on it, so linking or
 * unlinking a PR refetches. See `GET /sessions/:id/pr-link`.
 */
export function useSessionPrLink(session: Pick<ChatSessionWithExecution, 'id' | 'prNumber'> | undefined) {
  const id = session?.id ?? null;
  const prNumber = session?.prNumber ?? null;
  return useQuery({
    queryKey: ['session', id ?? '__none__', 'pr-link', prNumber],
    queryFn: () => sessionsApi.prLink(id!),
    enabled: !!id && prNumber != null,
    // The remote behind an address rarely changes. The number is in the key.
    staleTime: 5 * 60_000,
  });
}

/** A PR the user can open: its number, address, and whether it was closed unmerged. */
export interface OpenablePr {
  number: number;
  url: string;
  closed: boolean;
}

/**
 * The session's PR as a link, whatever state git is in: the live lookup's PR
 * when GitHub answered, else the linked number with an address built from the
 * repo remote. Null only when no PR is known at all.
 */
export function useOpenablePr(session: ChatSessionWithExecution | undefined): OpenablePr | null {
  const { data: prResp } = useSessionPr(session?.id ?? null);
  const { data: prLink } = useSessionPrLink(session);
  return useMemo(() => {
    const pr = prResp?.pr;
    if (pr) return { number: pr.number, url: pr.url, closed: pr.state === 'CLOSED' };
    const linked = prLink?.linked;
    return linked ? { number: linked.number, url: linked.url, closed: false } : null;
  }, [prResp, prLink]);
}

export function useOpenPr(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sessionsApi.openPr(id),
    onSuccess: () => {
      // The agent will start drafting + pushing; the PR appears on the
      // next refresh. Invalidate eagerly so the bar reflects the new
      // state once the agent finishes its turn. `pr` and `status` both
      // sit under the worktree scope, so one prefix covers them.
      qc.invalidateQueries({ queryKey: worktreeScopeFromCache(qc, id) });
    },
  });
}

export function useMergePr(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: MergeRequestBody) => sessionsApi.mergePr(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worktreeScopeFromCache(qc, id) });
      qc.invalidateQueries({ queryKey: ['session', id] });
    },
  });
}

/**
 * Enable/disable GitHub auto-merge ("merge when ready") for the session's
 * PR. Invalidates the PR query so the action bar reflects the new state.
 */
export function useSetAutoMerge(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AutoMergeRequestBody) => sessionsApi.setAutoMerge(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...worktreeScopeFromCache(qc, id), 'pr'] });
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
      qc.invalidateQueries({ queryKey: worktreeScopeFromCache(qc, id) });
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
  /** The session's PR to link to in every state (see `useOpenablePr`). */
  openablePr: OpenablePr | null;
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
  const { data: transfer } = useTransfer(id || null);
  const openablePr = useOpenablePr(session);
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

  const state = useMemo<ActionState>(
    () => deriveActionState({ session, workspaceIsGit, transfer, pushNonFastForward, status, pr: prResp?.pr }),
    [session, workspaceIsGit, prResp, status, pushNonFastForward, transfer],
  );

  return { state, openablePr, commit, push, pullBase, retrySetup, openPr, mergePr, resolveConflicts };
}

export interface ActionStateInput {
  session: ChatSessionWithExecution | undefined;
  workspaceIsGit: boolean | null | undefined;
  /** The execution's move, if any (P4.2). */
  transfer: Pick<TransferView, 'state' | 'ownershipChanged' | 'to'> | null | undefined;
  pushNonFastForward: boolean;
  status: WorktreeStatus | null | undefined;
  pr: PrInfo | null | undefined;
}

/** The action bar's state, from the session, its worktree status and its PR. Pure, for tests. */
export function deriveActionState({ session, workspaceIsGit, transfer, pushNonFastForward, status, pr }: ActionStateInput): ActionState {
  if (!session) return { kind: 'noWorktree' };
  if (session.status === 'archived') return { kind: 'archived' };
  // A move supersedes every other state until the destination has the
  // work: its source is being stopped and saved.
  if (transfer?.state === 'active' && !transfer.ownershipChanged) {
    return { kind: 'moving', to: transfer.to.name };
  }
  // Its worktree wherever it runs (P3.3, P4.5): the home's own path, or
  // the folder on the device it runs on. Every control on the bar goes
  // to that device.
  const folder = preparedFolder(session);
  // Failed-setup wins over noWorktree so the user gets the retry
  // affordance instead of an empty pill while sitting on a stuck row.
  if (!folder && workspaceIsGit && session.setupError) {
    return {
      kind: 'setupFailed',
      error: session.setupError,
      prNumber: session.prNumber ?? null,
    };
  }
  if (!folder || !workspaceIsGit) return { kind: 'noWorktree' };

  // Push rejection overrides every "normal" downstream state so the
  // user always sees the resolve affordance until they act on it.
  if (pushNonFastForward) {
    return { kind: 'localDiverged' };
  }

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
}
