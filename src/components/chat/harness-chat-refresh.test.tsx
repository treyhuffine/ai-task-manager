/** Review 6 probe: offline (paused queries) through the real TeamChatDestination, useMainChat and HarnessChat/NewAgentConversation. */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, onlineManager, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-session-stream', () => ({ useSessionStream: () => {} }));

const h = vi.hoisted(() => ({
  url: new URL('http://team.test/'), listeners: new Set<() => void>(), calls: [] as string[], pointer: 'X' as string | null, fail: false, mounts: 0, unmounts: 0,
}));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const sub = (f: () => void) => { h.listeners.add(f); return () => h.listeners.delete(f); };
  const go = (u: string) => { h.url = new URL(u, h.url); for (const f of h.listeners) f(); };
  return { usePathname: () => '/', useSearchParams: () => new URLSearchParams(useSyncExternalStore(sub, () => h.url.search)), useRouter: () => ({ push: go, replace: go }) };
});
vi.mock('@/lib/trpc/client', async original => ({ ...await original<typeof import('@/lib/trpc/client')>(), trpcClient: {
  orchestratorChat: { list: { query: async () => { h.calls.push('orchGet'); if (h.fail) { const { ApiError } = await import('@/lib/api/client'); throw new ApiError(503, { error: 'Temporary network failure' }, '/fixture'); } return { session: { id: 'X', workspaceId: null, executionId: null, status: 'active' } }; } } },
  workspaces: {
    chatGet: { query: async () => { h.calls.push('chatGet'); if (h.fail) { const { ApiError } = await import('@/lib/api/client'); throw new ApiError(503, { error: 'Temporary network failure' }, '/fixture'); } return { session: h.pointer ? { id: h.pointer, workspaceId: 'agent', executionId: null, status: 'active' } : null }; } },
    chatNewPost: { mutate: async () => { h.calls.push('chatNewPost'); h.pointer = 'C'; return { session: { id: 'C', workspaceId: 'agent', executionId: null, status: 'active' } }; } },
  },
  sessions: { messagesPost: { mutate: async (input: { params: { id: string } }) => { h.calls.push('messagesPost:' + input.params.id); return {}; } } },
} }));
vi.mock('@/lib/api/sessions', async original => ({ ...await original<typeof import('@/lib/api/sessions')>(), sessionsApi: new Proxy({ restart: async (id: string) => { h.calls.push('restart:' + id); return {}; }, get: async (id: string) => { h.calls.push('sessionGet:' + id); return { id, workspaceId: 'agent', executionId: null, status: 'active', type: 'orchestration' }; } } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (async () => []) }) }));
vi.mock('@/hooks/use-workspaces', async original => ({ ...await original<typeof import('@/hooks/use-workspaces')>(), useWorkspaces: () => ({ data: [{ id: 'agent', name: 'Agent', status: 'active' }], isLoading: false }) }));
vi.mock('@/components/executions/execution-composer', async () => {
  const React = await import('react');
  return { ExecutionComposer: ({ draftKey, onSend }: { draftKey: string; onSend: (c: string) => Promise<void> }) => React.createElement('button', { 'data-send': '1', onClick: () => void onSend('hello offline') }, `Composer ${draftKey}`) };
});
vi.mock('@/components/agents/agent-view', async () => {
  const React = await import('react');
  const { HarnessChat } = await import('@/components/chat/harness-chat');
  return { AgentView: ({ workspaceId, chatSessionId }: { workspaceId: string; chatSessionId?: string }) => chatSessionId ? React.createElement('div', null, `Pinned conversation ${chatSessionId}`) : React.createElement(HarnessChat, { scope: workspaceId }) };
});
vi.mock('@/lib/file-icons', () => ({ fileIconFor: () => null, getFileIcon: () => null, default: {} }));
vi.mock('@/components/file-icon', () => ({ FileIcon: () => null, default: () => null }));
vi.mock('@/components/executions/execution-view', () => ({ ExecutionView: () => 'Execution' }));
vi.mock('@/components/team/team-chat', () => ({ TeamChat: () => 'Choose an agent (TeamChat)', LegacyTeamChatAgentChoice: () => null }));


let root: Root, client: QueryClient, container: HTMLElement, win: Window & typeof globalThis;
beforeEach(async () => {
  notifyManager.setScheduler(queueMicrotask);
  const dom = parseHTML('<!doctype html><html><body></body></html>');
  win = dom.window as never;
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  const { makeQueryClient } = await import('@/lib/query/client');
  client = makeQueryClient();
  container = dom.document.createElement('div'); root = createRoot(container);
  h.calls = []; h.pointer = 'X'; h.fail = false;
});
afterEach(async () => {
  onlineManager.setOnline(true);
  await act(async () => { root.unmount(); client.clear(); });
  notifyManager.setScheduler(cb => setTimeout(cb, 0));
  vi.unstubAllGlobals();
});
const text = () => container.textContent ?? '';
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });

it.each([null, 'agent'] as const)('personal HarnessChat scope=%s keeps the loaded chat mounted on a failed background refresh', async scope => {
  const { HarnessChat } = await import('@/components/chat/harness-chat');
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(HarnessChat, { scope }))));
  await settle(); await settle();
  const before = container.querySelector("[data-send]"); expect(before).toBeTruthy(); expect(text()).not.toContain("Restart chat");
  h.fail = true;
  const { mainChatKey } = await import('@/hooks/use-main-chat');
  await act(async () => { void client.invalidateQueries({ queryKey: mainChatKey(scope) }); });
  await settle(); await settle(); await settle();
  expect(text()).toContain('Could not refresh this chat');
  expect(text()).not.toContain('This chat is unavailable');
  expect(container.querySelector('[data-send]')).toBe(before);
  h.fail = false;
  const retry = [...container.querySelectorAll('button')].find(b => b.textContent === 'Retry')!;
  await act(async () => { retry.dispatchEvent(new win.Event('click', { bubbles: true })); });
  await settle(); await settle();
  expect(text()).not.toContain('Could not refresh this chat');
  expect(container.querySelector('[data-send]')).toBe(before);
}, 30_000);
