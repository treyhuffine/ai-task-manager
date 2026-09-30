'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { connectorApprovalsApi, type ConnectorApprovalDecision } from '@/lib/api/connector-approvals';

export const connectorApprovalsKey = (sessionId: string | null) =>
  ['session', sessionId, 'connector-approvals'] as const;

/**
 * Ids of this chat's connector approvals still waiting on the user. Pushed by
 * `useSessionStream` whenever the in-memory approval store changes for the
 * session (register, resolve, settle), and replayed in full on every stream
 * connect. The snapshot fetch covers mount before the stream's first frame.
 * Pendings live in server memory: after a restart this is empty, and a card
 * whose request has no recorded decision reads as expired.
 */
export function useLiveConnectorApprovals(sessionId: string | null) {
  return useQuery({
    queryKey: connectorApprovalsKey(sessionId),
    queryFn: () => connectorApprovalsApi.live(sessionId!),
    enabled: !!sessionId,
  });
}

/**
 * Answer connector approvals. The decision row and the refreshed live set
 * both arrive over the session stream, so success needs no invalidation. A
 * failure (typically 404: the approvals are gone) refetches the live set so
 * the card stops offering buttons for requests that no longer exist.
 */
export function useResolveConnectorApprovals(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, decision }: { ids: string[]; decision: ConnectorApprovalDecision }) =>
      connectorApprovalsApi.resolve(ids, decision),
    onError: () => {
      qc.invalidateQueries({ queryKey: connectorApprovalsKey(sessionId) });
    },
  });
}
