import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, type FetchQueryOptions } from '@tanstack/react-query';

const state = vi.hoisted(() => ({ options: null as unknown, client: null as unknown, effects: [] as Array<() => void> }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: (options: unknown) => { state.options = options; return {}; },
  useQueryClient: () => state.client,
}));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (fn: () => void | (() => void)) => { const cleanup = fn(); if (cleanup) state.effects.push(cleanup); },
}));

class FakeEventSource extends EventTarget { close() {} }
const opened: FakeEventSource[] = [];
vi.stubGlobal('EventSource', class extends FakeEventSource { constructor() { super(); opened.push(this); } });
import { sessionsApi } from '@/lib/api/sessions';
import { useDeliveries } from '@/hooks/use-execution';
import { useSessionStream } from '@/hooks/use-session-stream';
import { _resetPageStream } from '@/lib/realtime/page-stream';

// Adapted to the page stream (P3 review, finding 1): a chat's frames arrive
// on the page's one EventSource as `session` envelopes, opened a moment after
// the first subscription. The race under test is the same.
afterEach(() => { state.effects.splice(0).forEach((f) => f()); vi.restoreAllMocks(); (state.client as QueryClient)?.clear(); _resetPageStream(); });

it('does not let an older HTTP delivery snapshot overwrite a newer stream acknowledgement', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.client = client;
  let respond!: (x: unknown) => void;
  vi.spyOn(sessionsApi, 'deliveries').mockImplementationOnce(() => new Promise((r) => { respond = r as never; }));
  useDeliveries('chat');
  useSessionStream('chat');
  await new Promise((r) => setTimeout(r, 50));
  const request = client.fetchQuery(state.options as FetchQueryOptions);
  const delivered = { state: 'delivered', computerName: 'Laptop', connected: true, cancellable: false };
  const update = new Event('session') as Event & { data: string };
  update.data = JSON.stringify({ s: 'chat', e: 'delivery', d: { eventId: 'message', delivery: delivered } });
  opened.at(-1)!.dispatchEvent(update);
  expect(client.getQueryData(['session', 'chat', 'deliveries'])).toEqual({ message: delivered });
  // The GET was captured before the worker connected and acknowledged.
  respond({ message: { state: 'waiting', computerName: 'Laptop', connected: false, cancellable: true } });
  await request;
  expect(client.getQueryData(['session', 'chat', 'deliveries'])).toEqual({ message: delivered });
});
