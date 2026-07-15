'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi } from '@/lib/api/sessions';
import { worktreeScopeFromCache } from '@/hooks/use-execution';

/**
 * Mutations for the takeover lifecycle. The query side lives on the
 * session row itself (`takeoverStartedAt`/`takeoverToken`/etc.),
 * which `useSession` already streams. After any of these resolve, we
 * invalidate the session query so the action bar + banner re-derive.
 *
 * Takeover hands the worktree to the user and back, so git status can
 * move underneath us — hence the worktree scope alongside the row. That
 * scope is execution-keyed and does NOT sit under the `['session', id]`
 * prefix, so it needs its own line.
 */
export function useTakeover(sessionId: string) {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['session', sessionId] });
    qc.invalidateQueries({ queryKey: worktreeScopeFromCache(qc, sessionId) });
  };

  const start = useMutation({
    mutationFn: () => sessionsApi.takeover(sessionId),
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: () => sessionsApi.cancelTakeover(sessionId),
    onSuccess: invalidate,
  });

  /** Browser "Done — pull my changes" — same endpoint the CLI hits
   *  with `flow resume`. Caller must pass the token (read off the
   *  session row's `takeoverToken`). */
  const resume = useMutation({
    mutationFn: (token: string) => sessionsApi.resumeFromTakeover(token),
    // The `['session', id]` prefix covers `events` here — the agent
    // replays the user's work into the transcript on resume.
    onSuccess: invalidate,
  });

  return { start, cancel, resume };
}
