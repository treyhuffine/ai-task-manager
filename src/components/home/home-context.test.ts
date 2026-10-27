import { teamCapabilities } from '@/lib/team/capabilities';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';
import { readDocumentBinding } from '@/lib/home/document-binding';
import { HomeBoundary, useHomeContext } from './home-context';

let root: Root, cache: QueryClient, container: HTMLElement;
const mounted = vi.fn();
const identity = (viewer: string) => ({ home: { id: 'team', kind: 'team' as const, name: 'Team' }, viewer: { id: viewer, name: viewer, role: 'member' as const }, executionChoices: [], capabilities: { ...teamCapabilities({ role: 'member', status: 'active' }), privatePlanning: false, configureAgents: false, administerMembers: false, editContent: true, deletePermanently: false } });
function Editor() {
  const context = useHomeContext();
  useEffect(() => { mounted(readDocumentBinding()); }, []);
  return createElement('input', { 'aria-label': 'Shared editor', defaultValue: context.viewer.id });
}
beforeEach(() => {
  const { document, window } = parseHTML('<!doctype html><html data-ri-authority="team" data-ri-viewer="local"><body></body></html>');
  vi.stubGlobal('document', document); vi.stubGlobal('window', window); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); root = createRoot(container);
  cache = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, gcTime: Infinity } } });
  mounted.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); vi.unstubAllGlobals(); });

it('establishes the original document audience before mounting an editor and never adopts another member from a cache refresh', async () => {
  cache.setQueryData(trpc.homeContext.queryKey(), identity('original-member'));
  await act(async () => root.render(createElement(QueryClientProvider, { client: cache }, createElement(HomeBoundary, null, createElement(Editor)))));
  expect(mounted).toHaveBeenCalledExactlyOnceWith({ homeId: 'team', viewerId: 'original-member' });
  expect(container.querySelector('input')?.value).toBe('original-member');
  document.documentElement.dataset.riViewer = 'replacement-member';
  expect(readDocumentBinding()).toEqual({ homeId: 'team', viewerId: 'original-member' });
  await act(async () => { cache.setQueryData(trpc.homeContext.queryKey(), identity('replacement-member')); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(container.textContent).toContain('drafts are kept for their original author');
  expect(container.querySelector('input')).toBeNull();
  expect(readDocumentBinding()).toEqual({ homeId: 'team', viewerId: 'original-member' });
  expect(mounted).toHaveBeenCalledTimes(1);
});

it('refuses a sign-in swap between the initial member response and the Home context response', async () => {
  cache.setQueryData(trpc.homeContext.queryKey(), identity('replacement-member'));
  await act(async () => root.render(createElement(QueryClientProvider, { client: cache }, createElement(HomeBoundary, { expected: { homeId: 'team', viewerId: 'original-member' } }, createElement(Editor)))));
  expect(mounted).not.toHaveBeenCalled(); expect(container.textContent).toContain('sign-in changed');
});

it('keeps a mounted editor and unsent text when a background Home refetch fails', async () => {
  cache.setQueryData(trpc.homeContext.queryKey(), identity('original-member'));
  await act(async () => root.render(createElement(QueryClientProvider, { client: cache }, createElement(HomeBoundary, null, createElement(Editor)))));
  const input = container.querySelector('input')!;
  input.value = 'A draft typed before the network failed';
  await act(async () => {
    cache.getQueryCache().find({ queryKey: trpc.homeContext.queryKey() })!.setState({
      status: 'error', error: new Error('Temporary network failure'), fetchStatus: 'idle',
    });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(container.querySelector('input')).toBe(input);
  expect(input.value).toBe('A draft typed before the network failed');
  expect(container.textContent).toContain('Live updates are temporarily unavailable');
  expect(container.textContent).toContain('Retry');
  expect(mounted).toHaveBeenCalledTimes(1);
});


it('does not change a document’s Home kind to match an unexpected response', async () => {
  document.documentElement.dataset.riAuthority='personal';
  cache.setQueryData(trpc.homeContext.queryKey(),identity('member'));
  await act(async()=>root.render(createElement(QueryClientProvider,{client:cache},createElement(HomeBoundary,null,createElement(Editor)))));
  expect(mounted).not.toHaveBeenCalled();expect(container.querySelector('input')).toBeNull();
  expect(document.documentElement.dataset.riAuthority).toBe('personal');
  expect(container.textContent).toContain('sign-in changed');
});
