'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { connectionRequestsApi, type ConnectionCardBody } from '@/lib/api/connection-requests';

export const integrationStatusKey = ['integrations', 'status'] as const;

/**
 * Per-provider connect readiness (can it sign in with one click, or does it need a one-time app
 * setup, or a pasted key). Read live by Connect cards, since setup can happen after the card
 * appeared, in Settings or in the card itself.
 */
export function useIntegrationStatus(enabled = true) {
  return useQuery({
    queryKey: integrationStatusKey,
    queryFn: connectionRequestsApi.status,
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Answer a Connect card. The recorded answer arrives over the session stream as a
 * `connection_response` row, so success needs no invalidation here.
 */
export function useConnectionCardAction(eventId: string) {
  return useMutation({
    mutationFn: (body: ConnectionCardBody) =>
      connectionRequestsApi.act(eventId, body),
  });
}

export function useSaveSignInApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: connectionRequestsApi.addSignInApp,
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationStatusKey }),
  });
}
