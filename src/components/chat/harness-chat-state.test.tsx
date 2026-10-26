/** Review 6 probe: offline (paused queries) through the real TeamChatDestination, useMainChat and HarnessChat/NewAgentConversation. */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, onlineManager, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-session-stream', () => ({ useSessionStream: () => {} }));

const h = vi.hoisted(() => ({
  url: new URL('http://team.test/'), listeners: new Set<() => void>(), calls: [] as string[], pointer: 'X' as string | null, running: false, closeUnconfirmed: false,
}));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const sub = (f: () => void) => { h.listeners.add(f); return () => h.listeners.delete(f); };
  const go = (u: string) => { h.url = new URL(u, h.url); for (const f of h.listeners) f(); };
  return { usePathname: () => '/', useSearchParams: () => new URLSearchParams(useSyncExternalStore(sub, () => h.url.search)), useRouter: () => ({ push: go, replace: go }) };
});
vi.mock('@/lib/trpc/client', async original => ({ ...await original<typeof import('@/lib/trpc/client')>(), trpcClient: {
  workspaces: {
    chatGet: { query: async () => { h.calls.push('chatGet'); return { session: h.pointer ? { id: h.pointer, workspaceId: 'agent', executionId: null, status: 'active' } : null }; } },
    chatNewPost: { mutate: async () => { h.calls.push('chatNewPost'); h.pointer = 'C'; return { session: { id: 'C', workspaceId: 'agent', executionId: null, status: 'active' } }; } },
  },
  sessions: { messagesPost: { mutate: async (input: { params: { id: string } }) => { h.calls.push('messagesPost:' + input.params.id); return {}; } } },
} }));
vi.mock('@/lib/api/sessions', async original => ({ ...await original<typeof import('@/lib/api/sessions')>(), sessionsApi: new Proxy({ runtimeStatus: async () => ({ running: h.running, backgroundTasks: false, backgroundTaskIds: [], closeUnconfirmed: h.closeUnconfirmed }), restart: async (id: string) => { h.calls.push('restart:' + id); return {}; }, get: async (id: string) => { h.calls.push('sessionGet:' + id); return { id, workspaceId: 'agent', executionId: null, status: 'active', type: 'orchestration' }; } } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (async () => []) }) }));
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
  h.calls = []; h.pointer = 'X'; h.running = false; h.closeUnconfirmed = false;
});
afterEach(async () => {
  onlineManager.setOnline(true);
  await act(async () => { root.unmount(); client.clear(); });
  notifyManager.setScheduler(cb => setTimeout(cb, 0));
  vi.unstubAllGlobals();
});
async function mount() {
  const { TeamChatDestination } = await import('@/components/team/team-chat-destination');
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TeamChatDestination))));
  await act(async () => { await new Promise(r => setTimeout(r, 50)); });
}
const text = () => container.textContent ?? '';
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });

it.each(['personal', 'team', 'pinned'] as const)('%s offline opening never offers New or starts another chat', async kind => {
  onlineManager.setOnline(false);
  h.url = new URL(kind === 'pinned' ? 'http://team.test/?view=chat&chat=X' : 'http://team.test/?view=chat');
  if (kind === 'personal') {
    const { HarnessChat } = await import('@/components/chat/harness-chat');
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(HarnessChat, { scope: 'agent' }))));
  } else await mount();
  expect(text()).toContain('You are offline');
  expect(container.querySelector('[data-send]')).toBeNull();
  expect(h.calls).toEqual([]);
  await act(async () => onlineManager.setOnline(true));
  await settle(); await settle();
  expect(h.calls).not.toContain('chatNewPost');
  expect(h.calls).not.toContain('messagesPost:C');
  expect(text()).not.toContain('Start a conversation');
}, 30_000);

it('only an explicit empty server response offers New and sends once to the returned chat', async () => {
  h.url = new URL('http://team.test/?view=chat'); h.pointer = null;
  await mount(); await settle();
  expect(text()).toContain('Start a conversation');
  expect(text()).not.toContain('Restart chat');
  const send = container.querySelector('[data-send]')!; expect(send).toBeTruthy();
  await act(async () => { send.dispatchEvent(new win.Event('click', { bubbles: true })); });
  await settle(); await settle();
  expect(h.calls.filter(call => call === 'chatNewPost')).toHaveLength(1);
  expect(h.calls.filter(call => call === 'messagesPost:C')).toHaveLength(1);
});

it.each([['healthy idle', false], ['running', true]] as const)('a %s main chat has no inline Restart row', async (_, running) => {
  h.running = running;
  const { HarnessChat } = await import('@/components/chat/harness-chat');
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(HarnessChat, { scope: 'agent' }))));
  await settle(); await settle();
  expect(text()).not.toContain('Restart chat');
});
it('an unconfirmed close exposes Restart chat even when idle, and it calls the actual hook', async () => {
  h.closeUnconfirmed = true;
  const { HarnessChat } = await import('@/components/chat/harness-chat');
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(HarnessChat, { scope: 'agent' }))));
  await settle(); await settle();
  expect(text()).toContain('Your next message checks again');
  const restart = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Restart chat'));
  expect(restart).toBeTruthy();
  await act(async () => { restart!.dispatchEvent(new win.Event('click', { bubbles: true })); });
  await settle();
  expect(h.calls.filter(call => call === 'restart:X')).toHaveLength(1);
  expect(text()).toContain('Restarted');
});
