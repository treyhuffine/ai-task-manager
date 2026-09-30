import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, type FetchQueryOptions } from '@tanstack/react-query';
import type { MessageDelivery } from '@/lib/workers/delivery';

type Cancel = {
  mutationFn(id: string): Promise<MessageDelivery>;
  onMutate(): { since: number };
  onSuccess(value: MessageDelivery, id: string, context: { since: number }): void;
};
const state = vi.hoisted(() => ({ query: null as unknown, mutation: null as unknown, client: null as unknown }));
vi.mock('@tanstack/react-query', async (original) => ({
  ...await original<typeof import('@tanstack/react-query')>(),
  useQuery: (options: unknown) => { state.query = options; return {}; },
  useMutation: (options: unknown) => { state.mutation = options; return {}; },
  useQueryClient: () => state.client,
}));
import { sessionsApi } from '@/lib/api/sessions';
import { useDeliveries, useCancelDelivery } from '@/hooks/use-execution';
import { _resetDeliveryFence } from '@/lib/query/delivery-fence';

afterEach(() => { vi.restoreAllMocks(); (state.client as QueryClient)?.clear(); _resetDeliveryFence(); });
it('does not restore Waiting from an old GET after Cancel succeeds while SSE reconnects', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.client = client;
  const waiting: MessageDelivery = { state: 'waiting', deviceId: 'worker', deviceName: 'Review worker', connected: false, runsAgents: true, reason: null, cancellable: true };
  const cancelled: MessageDelivery = { ...waiting, state: 'not_delivered', reason: 'It was withdrawn before it was delivered.', cancellable: false };
  let respond!: (value: Record<string, MessageDelivery>) => void;
  vi.spyOn(sessionsApi, 'deliveries').mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
  vi.spyOn(sessionsApi, 'cancelDelivery').mockResolvedValueOnce(cancelled);
  useDeliveries('chat'); useCancelDelivery('chat');
  const pendingGet = client.fetchQuery(state.query as FetchQueryOptions);
  const mutation = state.mutation as Cancel;
  const context = mutation.onMutate();
  mutation.onSuccess(await mutation.mutationFn('message'), 'message', context);
  expect(client.getQueryData(['session', 'chat', 'deliveries'])).toEqual({ message: cancelled });
  respond({ message: waiting });
  await pendingGet;
  expect(client.getQueryData(['session', 'chat', 'deliveries'])).toEqual({ message: cancelled });
});
