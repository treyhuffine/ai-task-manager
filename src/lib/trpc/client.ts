import { api, ApiError, type ApiClient } from '@/lib/api/client';
import { getQueryClient } from '@/lib/query/client';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from './router';
import { createTransportLink } from './transport-link';
import type { TransportMode } from './transport-state';

export function createAppTRPCClient({ url = '/api/trpc', transport = api, getMode, WebSocket, websocketOnly }: { url?: string; transport?: ApiClient; getMode?: () => TransportMode; WebSocket?: typeof globalThis.WebSocket; websocketOnly?: boolean } = {}) {
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
  // One HTTP request per procedure, as the REST API was: a slow procedure
  // never holds another's response, each call is its own row and timing in
  // the network tab, and an update drain admits a save on its own (it admits
  // a batch only when every procedure in it is a save). HTTP/2 to the public
  // edge already multiplexes the requests.
  //
  // If request count ever matters more than that, httpBatchStreamLink keeps
  // batching but streams each result as it finishes. Before switching, check
  // that the edge passes a streamed body through unbuffered (otherwise it
  // behaves like httpBatchLink, every result waiting for the slowest), keep
  // mutations on httpLink so a save never shares a drain-gated batch, and
  // accept that streamed bodies skip the app-side gzip (lib/api/compression).
  const http = httpLink<AppRouter>({
    url,
    // A call with its own authorization or device headers sends them. Each
    // call is its own request, so they can't reach any other call.
    headers: ({ op }) => (op.context.headers ? Object.fromEntries(new Headers(op.context.headers as HeadersInit)) : {}),
    // Share pairing, cookie/Bearer auth, protocol negotiation and Home
    // connectivity with uploads and the remaining HTTP API.
    fetch,
  });
  const trial = createTransportLink({ url, transport, http, getMode, WebSocket, websocketOnly });
  const client = createTRPCClient<AppRouter>({ links: [trial.link] });
  return new Proxy(client, { get: (target, key) => key === 'closeTransport' ? trial.close : Reflect.get(target, key) }) as typeof client & { closeTransport(): Promise<void> };
}
export const trpcClient = createAppTRPCClient();
/** Terminal traffic remains bidirectional even when ordinary API calls use HTTP. */
export const terminalTRPCClient = createAppTRPCClient({ websocketOnly: true });
export const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient: getQueryClient });
