'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { integrationApprovalsApi, type IntegrationApprovalDecision } from '@/lib/api/integration-approvals';

export const integrationApprovalsKey = (sessionId: string | null) =>
  ['session', sessionId, 'integration-approvals'] as const;

/**
 * Ids of this chat's integration approvals still waiting on the user. Pushed by
 * `useSessionStream` whenever the in-memory approval store changes for the
 * session (register, resolve, settle), and replayed in full on every stream
 * connect. The snapshot fetch covers mount before the stream's first frame.
 * Pendings live in server memory: after a restart this is empty, and a card
 * whose request has no recorded decision reads as expired.
 */
export function useLiveIntegrationApprovals(sessionId: string | null) {
  return useQuery({
    queryKey: integrationApprovalsKey(sessionId),
    queryFn: () => integrationApprovalsApi.live(sessionId!),
    enabled: !!sessionId,
  });
}

/**
 * Answer integration approvals. The decision row and the refreshed live set
 * both arrive over the session stream, so success needs no invalidation. A
 * failure (typically 404: the approvals are gone) refetches the live set so
 * the card stops offering buttons for requests that no longer exist.
 */
export function useResolveIntegrationApprovals(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, decision }: { ids: string[]; decision: IntegrationApprovalDecision }) =>
      integrationApprovalsApi.resolve(ids, decision),
    onError: () => {
      qc.invalidateQueries({ queryKey: integrationApprovalsKey(sessionId) });
    },
  });
}
