'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi } from '@/lib/api/sessions';

/**
 * Mutations for the takeover lifecycle. The query side lives on the
 * session row itself (`takeoverStartedAt`/`takeoverToken`/etc.),
 * which `useSession` already streams. After any of these resolve, we
 * invalidate the session query so the action bar + banner re-derive.
 */
export function useTakeover(sessionId: string) {
  const qc = useQueryClient();

  const start = useMutation({
    mutationFn: () => sessionsApi.takeover(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'status'] });
    },
  });

  const cancel = useMutation({
    mutationFn: () => sessionsApi.cancelTakeover(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'status'] });
    },
  });

  /** Browser "Done — pull my changes" — same endpoint the CLI hits
   *  with `flow resume`. Caller must pass the token (read off the
   *  session row's `takeoverToken`). */
  const resume = useMutation({
    mutationFn: (token: string) => sessionsApi.resumeFromTakeover(token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'status'] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'events'] });
    },
  });

  return { start, cancel, resume };
}
