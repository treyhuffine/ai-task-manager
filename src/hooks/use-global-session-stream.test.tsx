import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGlobalSessionStream } from './use-global-session-stream';

const stream = vi.hoisted(() => ({ listener: null as null | ((event: string, data: unknown) => void) }));
vi.mock('@/lib/realtime/page-stream', () => ({ pageStream: () => ({ subscribeGlobal: (listener: (event: string, data: unknown) => void) => { stream.listener = listener; return () => { stream.listener = null; }; } }) }));

let client: QueryClient;
beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  client = new QueryClient();
});
afterEach(() => { client.clear(); vi.unstubAllGlobals(); });

function Listens() { useGlobalSessionStream(); return null; }

it('refreshes the rows of chats archived or reopened anywhere, siblings included, and not their transcripts', async () => {
  const root = createRoot(document.createElement('div'));
  client.setQueryData(['session', 'archived-chat'], { id: 'archived-chat', executionId: 'execution-1' });
  client.setQueryData(['session', 'sibling-chat'], { id: 'sibling-chat', executionId: 'execution-1' });
  client.setQueryData(['session', 'other-chat'], { id: 'other-chat', executionId: 'execution-2' });
  client.setQueryData(['session', 'archived-chat', 'events'], []);
  try {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Listens))));
    act(() => stream.listener!('session_updated', { sessionId: 'archived-chat', executionId: 'execution-1', reason: 'lifecycle' }));
    const invalidated = (key: unknown[]) => client.getQueryState(key)?.isInvalidated;
    expect(invalidated(['session', 'archived-chat'])).toBe(true);
    expect(invalidated(['session', 'sibling-chat'])).toBe(true);
    expect(invalidated(['session', 'other-chat'])).toBe(false);
    expect(invalidated(['session', 'archived-chat', 'events'])).toBe(false);
  } finally { await act(async () => root.unmount()); }
});
