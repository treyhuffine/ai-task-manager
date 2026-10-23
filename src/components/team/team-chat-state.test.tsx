/** Review 6 probe: real TeamChatDestination + useTeamNav + useSession (use-execution) in linkedom. */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  url: new URL('http://team.test/'), listeners: new Set<() => void>(), pushes: [] as string[],
  get: null as null | ((id: string) => Promise<unknown>), main: null as null | (() => Promise<unknown>),
  mounts: 0, unmounts: 0,
}));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const sub = (f: () => void) => { h.listeners.add(f); return () => h.listeners.delete(f); };
  const go = (u: string) => { h.pushes.push(u); h.url = new URL(u, h.url); for (const f of h.listeners) f(); };
  return { usePathname: () => '/', useSearchParams: () => new URLSearchParams(useSyncExternalStore(sub, () => h.url.search)), useRouter: () => ({ push: go, replace: go }) };
});
vi.mock('@/lib/api/sessions', async original => ({ ...await original<typeof import('@/lib/api/sessions')>(), sessionsApi: { get: (id: string) => h.get!(id) } }));
vi.mock('@/hooks/use-workspaces', async original => ({ ...await original<typeof import('@/hooks/use-workspaces')>(), useWorkspaces: () => ({ data: [{ id: 'agent', name: 'Agent', status: 'active' }], isLoading: false }) }));
vi.mock('@/hooks/use-main-chat', () => ({ useMainChat: (scope: string) => useQuery({ queryKey: ['agent-chat', scope], queryFn: () => h.main!(), retry: false }) }));
vi.mock('@/components/agents/agent-view', async () => {
  const React = await import('react');
  return { AgentView: ({ chatSessionId }: { chatSessionId?: string }) => { React.useEffect(() => { h.mounts++; return () => { h.unmounts++; }; }, []); return React.createElement('div', { 'data-view': 'agent' }, `Agent chat ${chatSessionId}`); } };
});
vi.mock('@/components/executions/execution-view', async () => {
  const React = await import('react');
  return { ExecutionView: ({ sessionId }: { sessionId: string }) => { React.useEffect(() => { h.mounts++; return () => { h.unmounts++; }; }, []); return React.createElement('div', { 'data-view': 'execution' }, `Execution ${sessionId}`); } };
});
vi.mock('@/components/team/team-chat', () => ({ TeamChat: () => 'Choose an agent', LegacyTeamChatAgentChoice: () => null }));

let root: Root, client: QueryClient, window: Window & typeof globalThis, container: HTMLElement;
beforeEach(async () => {
  notifyManager.setScheduler(queueMicrotask);
  const dom = parseHTML('<!doctype html><html><body></body></html>');
  window = dom.window as never;
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { makeQueryClient } = await import('@/lib/query/client');
  client = makeQueryClient();
  container = dom.document.createElement('div'); root = createRoot(container);
  h.mounts = 0; h.unmounts = 0; h.pushes = [];
});
afterEach(async () => {
  await act(async () => { root.unmount(); client.clear(); });
  notifyManager.setScheduler(cb => setTimeout(cb, 0));
  vi.unstubAllGlobals();
});
async function mount() {
  const { TeamChatDestination } = await import('@/components/team/team-chat-destination');
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TeamChatDestination))));
}
const text = () => container.textContent ?? '';
async function until(check: () => boolean, ms = 30_000) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > ms) throw new Error('timeout: ' + text()); await act(async () => { await new Promise(r => setTimeout(r, 100)); }); }
}

it.each(['orchestration', 'execution'])('a failed %s refresh keeps the loaded view mounted and Retry recovers', async type => {
  const { ApiError } = await import('@/lib/api/client');
  h.url = new URL('http://team.test/?view=chat&chat=X'); let fail = false;
  h.get = async id => {
    if (fail) throw new ApiError(503, { error: 'Temporary network failure' }, '/fixture');
    return { id, workspaceId: 'agent', executionId: type === 'execution' ? 'execution' : null, status: 'active', type };
  };
  await mount(); await until(() => text().includes(type === 'execution' ? 'Execution X' : 'Agent chat X'));
  fail = true;
  await act(async () => { void client.invalidateQueries({ queryKey: ['session', 'X'] }); });
  await until(() => text().includes('Could not refresh this chat'));
  expect(h.unmounts).toBe(0); expect(h.mounts).toBe(1);
  expect(container.querySelector('[data-view]')).toBeTruthy();
  fail = false;
  await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry')!.dispatchEvent(new window.Event('click', { bubbles: true })); });
  await until(() => !text().includes('Could not refresh this chat'));
  expect(h.unmounts).toBe(0); expect(h.mounts).toBe(1);
}, 45_000);

it('Choose a chat exits a failed single-agent lookup and opens Agents', async () => {
  h.url = new URL('http://team.test/?view=chat');
  h.main = async () => { throw new Error('Fixture lookup failed'); };
  await mount(); await until(() => text().includes('This chat is unavailable'));
  await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Choose a chat')!.dispatchEvent(new window.Event('click', { bubbles: true })); });
  expect(h.url.searchParams.get('view')).toBe('agents');
});
