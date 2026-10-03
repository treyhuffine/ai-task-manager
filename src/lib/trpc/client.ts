import { api, ApiError, type ApiClient } from '@/lib/api/client';
import { getQueryClient } from '@/lib/query/client';
import { createTRPCClient, httpBatchLink, httpLink, splitLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from './router';
import { createTransportLink } from './transport-link';
import type { TransportMode } from './transport-state';

export function createAppTRPCClient({ url = '/api/trpc', transport = api, getMode, WebSocket }: { url?: string; transport?: ApiClient; getMode?: () => TransportMode; WebSocket?: typeof globalThis.WebSocket } = {}) {
  const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const response = await transport.raw(String(url), init as RequestInit);
    // Auth, protocol and maintenance refusals can happen before the adapter.
    // Preserve their status and recovery message while leaving tRPC envelopes
    // to the link's normal error handling.
    if (!response.ok) {
      const body: unknown = await response.clone().json().catch(() => null);
      const isTRPCEnvelope = Array.isArray(body)
        || (body && typeof body === 'object' && 'error' in body && typeof body.error === 'object');
      if (!isTRPCEnvelope) throw new ApiError(response.status, body, String(url));
    }
    return response;
  };
  const http = splitLink<AppRouter>({
    condition: op => op.context.headers !== undefined,
    true: httpLink({
      url,
      headers: ({ op }) => Object.fromEntries(new Headers(op.context.headers as HeadersInit)),
      fetch,
    }),
    false: httpBatchLink({
      url,
      maxURLLength: 16_000,
      // Share pairing, cookie/Bearer auth, protocol negotiation and Home
      // connectivity with uploads and the remaining HTTP API.
      fetch,
    }),
  });
  const trial = createTransportLink({ url, transport, http, getMode, WebSocket });
  const client = createTRPCClient<AppRouter>({ links: [trial.link] });
  return new Proxy(client, { get: (target, key) => key === 'closeTransport' ? trial.close : Reflect.get(target, key) }) as typeof client & { closeTransport(): Promise<void> };
}
export const trpcClient = createAppTRPCClient();
export const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient: getQueryClient });
