import { trpc } from '@/lib/trpc/client';
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PendingInputArea } from './pending-input-area';
import { CHAT_ID, pendingInput } from './gallery/fixtures';

it.each([true, false])('keeps the common permission card visible with canStop=%s and enforces contextual controls', canStop => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  cache.setQueryData(['session', CHAT_ID, 'pending-input'], pendingInput('permissions', 'ready'));
  cache.setQueryData(trpc.sessions.runtimeStatusGet.queryKey({ params: { id: CHAT_ID } }), { running: true, backgroundTasks: false, backgroundTaskIds: [], canStop, canAnswer: true, canApprove: true, activeTurnId: null });
  const html = renderToStaticMarkup(<QueryClientProvider client={cache}><PendingInputArea sessionId={CHAT_ID} /></QueryClientProvider>);
  expect(html).toContain('Run the calendar tests');
  expect(html).not.toMatch(/<fieldset[^>]*disabled/);
  expect(html).not.toContain('Waiting for the member');
  cache.clear();
});

it('disables approval only when the server-derived approval capability refuses it', () => {
  const cache = new QueryClient();
  cache.setQueryData(['session', CHAT_ID, 'pending-input'], pendingInput('permissions', 'ready'));
  cache.setQueryData(trpc.sessions.runtimeStatusGet.queryKey({ params: { id: CHAT_ID } }), { running: true, backgroundTasks: false, backgroundTaskIds: [], canStop: true, canAnswer: true, canApprove: false, activeTurnId: null });
  const html = renderToStaticMarkup(<QueryClientProvider client={cache}><PendingInputArea sessionId={CHAT_ID} /></QueryClientProvider>);
  expect(html).toMatch(/<fieldset[^>]*disabled/);
  cache.clear();
});
