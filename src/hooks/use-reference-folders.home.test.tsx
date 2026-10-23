import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ personal: false, list: vi.fn(async () => []) }));
vi.mock('@/components/home/execution-runtime-context', () => ({ useExecutionRuntimeScope: () => ({ personalControls: state.personal }) }));
vi.mock('@/lib/api/reference-folders', () => ({ referenceFoldersApi: { list: state.list } }));
import { trpc } from '@/lib/trpc/client';
import { invalidateReferenceCatalogs, useReferenceFolders } from './use-reference-folders';
let root: Root;
let client: QueryClient;
beforeEach(() => {
  state.list.mockClear();
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); vi.unstubAllGlobals(); });
function Picker() { const result = useReferenceFolders(null); return createElement('span', null, result.data?.length); }
async function mount() { await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(Picker))); await new Promise(resolve => setTimeout(resolve, 20)); }); }
it('reads only the current Home reference catalog when the launcher belongs to a Team', async () => {
  state.personal = false; await mount(); expect(state.list).toHaveBeenCalledExactlyOnceWith(null);
});
it('retains the ordinary personal reference picker', async () => {
  state.personal = true; await mount(); expect(state.list).toHaveBeenCalledExactlyOnceWith(null);
});


it('refreshes every typed catalog and picker affected by a folder edit without invalidating unrelated workspace data', async () => {
  const keys = [
    trpc.referenceFolders.list.queryKey({query:undefined}),
    trpc.referenceFolders.list.queryKey({query:{workspaceId:'agent'}}),
    trpc.referenceFolders.treeGet.queryKey({params:{id:'reference'}}),
    trpc.workspaces.referencedByGet.queryKey({params:{id:'agent'}}),
    trpc.sessions.referenceFoldersGet.queryKey({params:{id:'chat'}}),
  ];
  for (const key of keys) client.setQueryData(key, []);
  const untouched: readonly unknown[] = trpc.workspaces.get.queryKey({params:{id:'agent'}});
  client.setQueryData(untouched,{id:'agent'});
  await invalidateReferenceCatalogs(client);
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(untouched)?.isInvalidated).toBe(false);
});
