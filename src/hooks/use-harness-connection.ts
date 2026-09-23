import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { ProviderId } from '@/lib/harness/options';

/**
 * Shared "is this agent provider connected?" detection — the same
 * `/api/harness/auth` probe the onboarding wizard runs, lifted into a hook so
 * the settings selector and onboarding share one path. The server caches the
 * CLI auth read for ~60s; `recheck` forces a fresh read (after a `login`).
 */

/** Tolerant view of the `/api/harness/auth` response (a spread `AuthReport`). */
interface HarnessAuthApiResponse {
  binary?: { installed?: boolean; error?: string | null } | null;
  identity?: { email?: string | null; subscriptionType?: string | null } | null;
  hasSubscription?: boolean;
  hasApiKey?: boolean;
  hasBedrock?: boolean;
  apiKeyVar?: string | null;
  hasConfiguredUpstream?: boolean;
}

export type HarnessConnectionStatus =
  | 'not_installed'
  | 'subscription'
  | 'bedrock'
  | 'api_key'
  | 'configured'
  | 'none';

export interface HarnessConnection {
  installed: boolean;
  status: HarnessConnectionStatus;
  /** Billing-clean (subscription/bedrock) OR usable-but-metered (api_key). */
  connected: boolean;
  /** Connected via a metered API key rather than a subscription. */
  metered: boolean;
  email: string | null;
  subscriptionType: string | null;
  apiKeyVar: string | null;
  binaryError: string | null;
}

function deriveConnection(r: HarnessAuthApiResponse | undefined): HarnessConnection {
  const installed = r?.binary?.installed ?? false;
  let status: HarnessConnectionStatus;
  if (!installed) status = 'not_installed';
  else if (r?.hasSubscription) status = 'subscription';
  else if (r?.hasBedrock) status = 'bedrock';
  else if (r?.hasApiKey) status = 'api_key';
  else if (r?.hasConfiguredUpstream) status = 'configured';
  else status = 'none';
  return {
    installed,
    status,
    connected: installed && status !== 'none',
    metered: status === 'api_key',
    email: r?.identity?.email ?? null,
    subscriptionType: r?.identity?.subscriptionType ?? null,
    apiKeyVar: r?.apiKeyVar ?? null,
    binaryError: r?.binary?.error ?? null,
  };
}

const KEY = (harness: ProviderId) => ['agent-connection', harness] as const;

export function useHarnessConnection(harness: ProviderId, enabled = true) {
  const query = useQuery({
    queryKey: KEY(harness),
    queryFn: () => api.post<HarnessAuthApiResponse>('/harness/auth', { harness }),
    enabled,
    staleTime: 60_000,
  });
  const connection = useMemo(() => deriveConnection(query.data), [query.data]);
  return { ...query, connection };
}

/** Force-refresh a provider's auth read (after the user runs `<provider> login`). */
export function useRecheckHarnessConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (harness: ProviderId) =>
      api.post<HarnessAuthApiResponse>('/harness/auth', { harness, fresh: true }),
    onSuccess: (data, harness) => {
      qc.setQueryData(KEY(harness), data);
    },
  });
}
