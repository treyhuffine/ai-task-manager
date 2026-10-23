import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';
import { MainChatHistoryMenu } from './main-chat-history-menu';
import { mainChatKey } from '@/hooks/use-main-chat';
import { trpc } from '@/lib/trpc/client';

const state = vi.hoisted(() => ({ fail: true, error: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: state.error } }));
vi.mock('@/lib/trpc/client', async original => ({ ...await original<typeof import('@/lib/trpc/client')>(), trpcClient: { workspaces: {
  chatGet: { query: async () => ({ session: { id: 'current' } }) },
  chatHistoryGet: { query: async () => ({ sessions: [{ id: 'current', label: 'Current chat', startedAt: '2026-10-22T12:00:00Z' }, { id: 'older', label: 'Older chat', startedAt: '2026-10-21T12:00:00Z' }] }) },
  chatResumePost: { mutate: async () => { if (state.fail) throw new Error('The previous harness is still closing.'); return { session: { id: 'older' } }; } },
} } }));

it('failed Resume shows the server reason, keeps History open and leaves selection intact', async () => {
  notifyManager.setScheduler(queueMicrotask);
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const runtimeKey = trpc.sessions.runtimeStatusGet.queryKey({ params: { id: 'current' } });
  const otherRuntimeKey = trpc.sessions.runtimeStatusGet.queryKey({ params: { id: 'other' } });
  for (const key of [runtimeKey, otherRuntimeKey]) client.setQueryData(key, { running: false, backgroundTasks: false, backgroundTaskIds: [], canStop: true, canAnswer: true, canApprove: true, activeTurnId: null });
  const container = document.createElement('div'), root = createRoot(container);
  const tick = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const click = async (text: string) => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(text)); expect(button).toBeTruthy();
    await act(async () => { button!.dispatchEvent(new window.Event('click', { bubbles: true })); }); await tick();
  };
  try {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(MainChatHistoryMenu, { scope: 'agent' }))));
    await tick(); await click('History'); await click('Older chat');
    expect(state.error).toHaveBeenCalledWith('Could not resume this chat', { description: 'The previous harness is still closing.' });
    expect(client.getQueryData(mainChatKey('agent'))).toMatchObject({ session: { id: 'current' } });
    expect(container.textContent).toContain('Older chat');
    expect(client.getQueryState(runtimeKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherRuntimeKey)?.isInvalidated).toBe(false);
    state.fail = false; await click('Older chat');
    expect(client.getQueryData(mainChatKey('agent'))).toMatchObject({ session: { id: 'older' } });
    expect(container.textContent).not.toContain('Older chat');
  } finally {
    await act(async () => { root.unmount(); client.clear(); });
    notifyManager.setScheduler(callback => setTimeout(callback, 0)); vi.unstubAllGlobals();
  }
});
