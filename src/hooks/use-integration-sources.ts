'use client';

/**
 * Managed connection sources on the client (Connectors → Sources, the application pages, the
 * chat card's managed sign-in). Server state lives in TanStack Query under the
 * `integrationSources` router's keys. Every change invalidates that router's queries, so the
 * overview, the account list and the method choices stay in step.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc, trpcClient } from '@/lib/trpc/client';
import type { ApplicationId, Capability } from '@/lib/integrations/sources/types';

export function useSourcesOverview(enabled = true) {
  return useQuery({ ...trpc.integrationSources.overview.queryOptions(), enabled, staleTime: 15_000 });
}

export function useManagedAccounts(enabled = true) {
  return useQuery({ ...trpc.integrationSources.accounts.queryOptions(), enabled, staleTime: 15_000 });
}

export function useConnectionMethod(applicationId: ApplicationId, capability: Capability = 'agent_tools', enabled = true) {
  return useQuery({ ...trpc.integrationSources.method.queryOptions({ applicationId, capability }), enabled, staleTime: 15_000 });
}

/** Composio accounts the source's own user already has, for "Add an existing account". */
export function useDiscoveredAccounts(sourceId: string | null, applicationId: ApplicationId, enabled: boolean) {
  return useQuery({
    ...trpc.integrationSources.discover.queryOptions({ sourceId: sourceId ?? 'cmpaaaa', applicationId }),
    enabled: enabled && Boolean(sourceId),
    staleTime: 10_000,
  });
}

/**
 * A sign-in in progress. Polls every two seconds while it's pending, which also finishes it when
 * the source's redirect couldn't reach this home (a phone, or a desktop on another network).
 */
export function useConnectAttempt(attemptId: string | null) {
  return useQuery({
    ...trpc.integrationSources.attempt.queryOptions({ attemptId: attemptId ?? `att_${'0'.repeat(32)}` }),
    enabled: Boolean(attemptId),
    refetchInterval: query => (query.state.data && query.state.data.status !== 'pending' ? false : 2_000),
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useSourceMutations() {
  const qc = useQueryClient();
  const settle = () => qc.invalidateQueries({ queryKey: trpc.integrationSources.pathKey() });
  const options = { onSettled: settle };
  return {
    addComposio: useMutation({ mutationFn: (input: { apiKey: string; label?: string }) => trpcClient.integrationSources.addComposio.mutate(input), ...options }),
    rotateKey: useMutation({ mutationFn: (input: { sourceId: string; apiKey: string }) => trpcClient.integrationSources.rotateKey.mutate(input), ...options }),
    setEnabled: useMutation({ mutationFn: (input: { sourceId: string; enabled: boolean }) => trpcClient.integrationSources.setEnabled.mutate(input), ...options }),
    remove: useMutation({ mutationFn: (input: { sourceId: string; revokeRemote: boolean }) => trpcClient.integrationSources.remove.mutate(input), ...options }),
    rename: useMutation({ mutationFn: (input: { sourceId: string; label: string }) => trpcClient.integrationSources.rename.mutate(input), ...options }),
    setPreferred: useMutation({ mutationFn: (input: { sourceId: string | null }) => trpcClient.integrationSources.setPreferred.mutate(input), ...options }),
    setApplicationMethod: useMutation({
      mutationFn: (input: Parameters<typeof trpcClient.integrationSources.setApplicationMethod.mutate>[0]) => trpcClient.integrationSources.setApplicationMethod.mutate(input), ...options,
    }),
    connect: useMutation({ mutationFn: (input: Parameters<typeof trpcClient.integrationSources.connect.mutate>[0]) => trpcClient.integrationSources.connect.mutate(input), ...options }),
    reconnect: useMutation({ mutationFn: (input: { connectionId: string; returnTo?: string }) => trpcClient.integrationSources.reconnect.mutate(input), ...options }),
    cancelAttempt: useMutation({ mutationFn: (input: { attemptId: string }) => trpcClient.integrationSources.cancelAttempt.mutate(input), ...options }),
    importAccount: useMutation({
      mutationFn: (input: Parameters<typeof trpcClient.integrationSources.importAccount.mutate>[0]) => trpcClient.integrationSources.importAccount.mutate(input), ...options,
    }),
    disconnect: useMutation({ mutationFn: (input: { connectionId: string }) => trpcClient.integrationSources.disconnect.mutate(input), ...options }),
    revoke: useMutation({ mutationFn: (input: { connectionId: string }) => trpcClient.integrationSources.revoke.mutate(input), ...options }),
    renameAccount: useMutation({ mutationFn: (input: { connectionId: string; label: string }) => trpcClient.integrationSources.renameAccount.mutate(input), ...options }),
    setCalendarUse: useMutation({ mutationFn: (input: { connectionId: string; enabled: boolean }) => trpcClient.integrationSources.setCalendarUse.mutate(input), ...options }),
  };
}

/** The message a failed source call should show: the server's own words. */
export function sourceErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message) return error.message;
  return String(error);
}
