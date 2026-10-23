import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { trpc } from '@/lib/trpc/client';
import { useCreateWorkspace, useArchiveWorkspace, useReorderWorkspaces } from './use-workspaces';
import { useContinueSession, useUpdateSession } from './use-execution';

vi.mock('@/lib/api/workspaces', () => ({ workspacesApi: { create: vi.fn(async () => ({ id: 'agent' })), archive: vi.fn(async () => ({})), reorder: vi.fn(async () => ({})) } }));
vi.mock('@/lib/api/sessions', () => ({ sessionsApi: { continueWork: vi.fn(async () => ({ id: 'chat', worktreePath: '/fixture' })), update: vi.fn(async () => ({ id: 'chat' })) } }));
let root: Root, client: QueryClient;
let controls: { create: ReturnType<typeof useCreateWorkspace>; archive: ReturnType<typeof useArchiveWorkspace>; reorder: ReturnType<typeof useReorderWorkspaces>; resume: ReturnType<typeof useContinueSession>; update: ReturnType<typeof useUpdateSession> };
function Harness() {
  const create = useCreateWorkspace(), archive = useArchiveWorkspace(), reorder = useReorderWorkspaces(), resume = useContinueSession('chat'), update = useUpdateSession();
  useEffect(() => { controls = { create, archive, reorder, resume, update }; }, [create, archive, reorder, resume, update]);
  return null;
}
beforeEach(async () => {
  notifyManager.setScheduler(queueMicrotask);
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  client.setQueryData(['session', 'chat'], { id: 'chat', executionId: 'execution' });
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
});
afterEach(async () => {
  await act(async () => { root.unmount(); client.clear(); });
  notifyManager.setScheduler(callback => setTimeout(callback, 0));
  vi.unstubAllGlobals();
});

it.each(['create', 'archive', 'reorder'] as const)('%s refreshes the typed agent chips as well as existing workspace views', async operation => {
  const keys: QueryKey[] = [trpc.workspaces.list.queryKey({}), ['workspaces', { status: 'active' }]];
  for (const key of keys) client.setQueryData<unknown>(key, [{ id: 'agent' }]);
  await act(async () => {
    if (operation === 'create') await controls.create.mutateAsync({ name: 'Agent', cwd: '/fixture' });
    else if (operation === 'archive') await controls.archive.mutateAsync('agent');
    else await controls.reorder.mutateAsync(['agent']);
  });
  expect(keys.map(key => client.getQueryState(key)?.isInvalidated)).toEqual([true, true]);
});

it.each(['resume', 'update'] as const)('%s refreshes this chat runtime without invalidating another chat', async operation => {
  const own: QueryKey = trpc.sessions.runtimeStatusGet.queryKey({ params: { id: 'chat' } });
  const other: QueryKey = trpc.sessions.runtimeStatusGet.queryKey({ params: { id: 'other' } });
  for (const key of [own, other]) client.setQueryData<unknown>(key, { running: false });
  await act(async () => {
    if (operation === 'resume') await controls.resume.mutateAsync(undefined);
    else await controls.update.mutateAsync({ id: 'chat', permissionMode: 'ask' });
  });
  expect(client.getQueryState(own)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});
