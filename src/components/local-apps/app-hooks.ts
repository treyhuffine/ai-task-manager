'use client';

import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/lib/trpc/client';

export const KEY = ['local-apps'] as const;

export type LocalAppsList = Awaited<ReturnType<typeof trpcClient.localApps.list.query>>;
export type LocalAppInstance = LocalAppsList['instances'][number];
export type LocalAppDraft = LocalAppsList['drafts'][number];
export type LocalAppApproval = LocalAppsList['approvals'][number];
export type LocalAppGrant = LocalAppsList['grants'][number];

export function useAppAccess(id: string | undefined, chatId: string | null | undefined, revision: number | undefined) {
  return useQuery({
    queryKey: [...KEY, 'access', id, chatId, revision],
    queryFn: () => trpcClient.localApps.access.query({ id: id!, chatId: chatId! }),
    enabled: !!id && !!chatId && revision !== undefined,
  });
}

/**
 * The local apps registry: instances, drafts, grants, approvals and panels.
 * `enabled` is the feature flag on this Home, read once a minute.
 *
 * An app surface (the library, an open app, a companion) keeps the registry
 * live, since approvals and build states change under it. The rail only
 * needs the list of apps, so it asks for the quiet rate: with both mounted
 * the live rate wins, with only the rail mounted the server is left alone.
 */
export function useLocalApps({ live = true }: { live?: boolean } = {}) {
  const enabled = useQuery({
    queryKey: ['local-apps-enabled'],
    queryFn: () => trpcClient.localApps.enabled.query(),
    staleTime: 60_000,
  });
  const apps = useQuery({
    queryKey: KEY,
    queryFn: () => trpcClient.localApps.list.query(),
    enabled: enabled.data?.enabled === true,
    refetchInterval: live ? 2000 : 30_000,
  });
  return {
    ...apps,
    error: enabled.error ?? apps.error,
    checking: enabled.isPending,
    enabled: enabled.data?.enabled === true,
  };
}
