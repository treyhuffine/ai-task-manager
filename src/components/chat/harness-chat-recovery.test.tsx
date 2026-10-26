/** Mounted recovery controls with real hooks and cache, synthetic data and composer leaves. The chat menu's popover renders inline, marked, so tests can tell it from the inline row. */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, onlineManager, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/components/executions/execution-transcript', async () => {
  const React = await import('react');
  const { useRetrySend, useClientEventStatus } = await import('@/hooks/use-execution');
  return { ExecutionTranscript: ({ session }: { session: { id: string } }) => {
    const retry = useRetrySend(session.id), status = useClientEventStatus(session.id);
    return React.createElement('div', null, Object.entries(status).filter(([, value]) => value.status === 'failed').map(([id]) =>
      React.createElement('button', { key: id, 'data-retry': id, onClick: () => retry.mutate({ eventId: id }) }, 'Retry message')),
      retry.isSuccess ? 'Retry succeeded' : '');
  } };
});
vi.mock('@/hooks/use-session-stream', () => ({ useSessionStream: () => {} }));
vi.mock('@/components/ui/popover', async () => {
  const React = await import('react');
  const Pass = ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  return { Popover: Pass, PopoverTrigger: Pass, PopoverContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-chat-menu': '' }, children) };
});

const h = vi.hoisted(() => ({
  url: new URL('http://team.test/'), listeners: new Set<() => void>(), calls: [] as string[], pointer: 'X' as string | null, running: false, closeUnconfirmed: false, failSend: false, failNew: false, failResume: false, restartError: false,
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
    chatResumePost: { mutate: async () => { h.closeUnconfirmed = true; throw new Error('Close failed'); } },
    chatHistoryGet: { query: async () => ({ sessions: [{ id: 'past', label: 'Past chat', startedAt: '2026-10-21T00:00:00Z' }] }) },
    chatNewPost: { mutate: async () => { h.calls.push('chatNewPost'); if (h.failNew) { h.closeUnconfirmed = true; throw new Error('Close failed'); } h.pointer = 'C'; return { session: { id: 'C', workspaceId: 'agent', executionId: null, status: 'active' } }; } },
  },
  coordination: { state: { query: async () => null } },
  sessions: { messagesPost: { mutate: async (input: { params: { id: string } }) => { h.calls.push('messagesPost:' + input.params.id); return {}; } } },
} }));
vi.mock('@/lib/api/sessions', async original => ({ ...await original<typeof import('@/lib/api/sessions')>(), sessionsApi: new Proxy({ sendMessage: async (id: string, content: string, options?: { eventId: string }) => { h.calls.push('send:' + id); if (h.failSend) throw new Error('Send failed'); return { id: options!.eventId, sessionId: id, source: 'user', role: 'user', content, attachments: [] }; }, runtimeStatus: async () => ({ running: h.running, backgroundTasks: false, backgroundTaskIds: [], closeUnconfirmed: h.closeUnconfirmed }), restart: async (id: string) => { h.calls.push('restart:' + id); if (h.restartError) throw new Error('Still closing old chat'); h.closeUnconfirmed = false; return {}; }, get: async (id: string) => { h.calls.push('sessionGet:' + id); return { id, workspaceId: 'agent', executionId: null, status: 'active', type: id.startsWith('content') ? 'content' : id.startsWith('skill') ? 'skill' : 'orchestration' }; } } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (async () => []) }) }));
vi.mock('@/hooks/use-workspaces', async original => ({ ...await original<typeof import('@/hooks/use-workspaces')>(), useWorkspaces: () => ({ data: [{ id: 'agent', name: 'Agent', status: 'active' }], isLoading: false }) }));
vi.mock('@/components/executions/execution-composer', async () => {
  const React = await import('react');
  return { ExecutionComposer: ({ draftKey, onSend, leadingActions }: { draftKey: string; onSend: (c: string) => Promise<void>; leadingActions?: React.ReactNode }) => React.createElement('div', null, leadingActions, React.createElement('button', { 'data-send': '1', onClick: () => void onSend('hello offline').catch(() => {}) }, `Composer ${draftKey}`)) };
});
vi.mock('@/hooks/use-devices', () => ({ useDevice: () => null }));
vi.mock('@/contexts/work-context', () => ({ useWorkNavigation: () => ({ openAgent: () => {}, openExecution: () => {} }) }));
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
  h.calls = []; h.pointer = 'X'; h.running = false; h.closeUnconfirmed = false; h.failSend = true; h.failNew = false; h.failResume = false; h.restartError = false;
});
afterEach(async () => {
  onlineManager.setOnline(true);
  await act(async () => { root.unmount(); client.clear(); });
  notifyManager.setScheduler(cb => setTimeout(cb, 0));
  vi.unstubAllGlobals();
});
const text = () => container.textContent ?? '';
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 300)); });


async function panel(pinned?: string) {
  const { AgentChatPanel } = await import('@/components/agents/agent-chat-panel');
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(AgentChatPanel, { workspace: { id: 'agent', name: 'Agent', status: 'active' } as never, sessionId: pinned }))));
  await settle(); await settle();
}
const buttons = (where: 'inline' | 'menu' | 'any') => {
  const menu = new Set([...container.querySelectorAll('[data-chat-menu] button')]);
  return [...container.querySelectorAll('button')].filter(b => where === 'any' || menu.has(b) === (where === 'menu'));
};
const restartIn = (where: 'inline' | 'menu') => buttons(where).find(b => b.textContent?.trim().startsWith('Restart chat'));
async function press(button: Element | undefined) {
  expect(button).toBeTruthy();
  await act(async () => button!.dispatchEvent(new win.Event('click', { bubbles: true })));
  await settle(); await settle();
}
const click = (label: string) => press(buttons('any').find(b => label === 'Past chat' ? b.textContent?.trim().startsWith(label) : b.textContent?.trim() === label));
async function send() {
  await act(async () => container.querySelector('[data-send]')!.dispatchEvent(new win.Event('click', { bubbles: true })));
  await settle();
}

it('a failed send offers Retry, not Restart, while the chat menu keeps Restart chat', async () => {
  await panel(); await send();
  expect(text()).toContain('Retry message');
  expect(restartIn('inline')).toBeUndefined(); expect(restartIn('menu')).toBeTruthy();
  expect(text()).not.toContain('has not confirmed');
});
it('a running chat keeps Restart in its menu, beside nothing inline', async () => {
  h.running = true; await panel();
  expect(restartIn('inline')).toBeUndefined();
  await press(restartIn('menu'));
  expect(h.calls).toContain('restart:X'); expect(text()).toContain('Restarted');
});
it.each(['new', 'resume', 'pinned-new'] as const)('%s close failure blocks the chat, shows inline Restart and the reason, and Restart clears it', async action => {
  h.failNew = true;
  await panel(action === 'pinned-new' ? 'pinned' : undefined);
  expect(restartIn('inline')).toBeUndefined();
  if (action === 'resume') { await click('History'); await click('Past chat'); }
  else await click('New');
  expect(h.closeUnconfirmed).toBe(true); expect(restartIn('inline')).toBeTruthy();
  expect(text()).toContain('The previous harness has not confirmed it stopped. Your next message checks again');
  await press(restartIn('inline'));
  expect(h.calls).toContain('restart:' + (action === 'pinned-new' ? 'pinned' : 'X'));
  expect(restartIn('inline')).toBeUndefined(); expect(text()).not.toContain('has not confirmed');
});
it('Restart errors and success feedback belong to their chat, including an in-place pointer switch', async () => {
  h.closeUnconfirmed = true; await panel(); h.restartError = true;
  await press(restartIn('inline')); expect(text()).toContain('Still closing old chat');
  const { mainChatKey } = await import('@/hooks/use-main-chat');
  await act(async () => client.setQueryData(mainChatKey('agent'), { session: { id: 'C', workspaceId: 'agent', executionId: null, status: 'active' } }));
  await settle(); expect(restartIn('inline')).toBeTruthy(); expect(text()).not.toContain('Still closing old chat');
  expect(h.calls).not.toContain('restart:C');
  h.restartError = false; await press(restartIn('inline')); expect(h.calls).toContain('restart:C');
});
it('successful Restart clears its error, keeps its success feedback and never erases a failed message', async () => {
  h.closeUnconfirmed = true; await panel(); await send();
  h.restartError = true; await press(restartIn('inline'));
  expect(text()).toContain('Still closing old chat');
  h.restartError = false; await press(restartIn('inline'));
  expect(text()).not.toContain('Still closing old chat'); expect(text()).not.toContain('has not confirmed'); expect(text()).toContain('Restarted');
  // Restart never erases a failed, unacknowledged message. Retry remains available.
  expect(container.querySelector('[data-retry]')).not.toBeNull();
});
it.each(['content-task', 'content-note', 'skill-build', 'skill-try'])('%s has Restart in its menu and the same inline recovery when blocked', async sessionId => {
  const { HarnessChatSession } = await import('@/components/chat/harness-chat');
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(HarnessChatSession, { sessionId }))));
  await settle(); await settle();
  expect(restartIn('menu')).toBeTruthy(); expect(restartIn('inline')).toBeUndefined();
  h.closeUnconfirmed = true;
  await act(async () => client.invalidateQueries()); await settle(); await settle();
  expect(text()).toContain('Your next message checks again'); await press(restartIn('inline'));
  expect(h.calls).toContain('restart:' + sessionId); expect(text()).toContain('Restarted');
  expect(text()).not.toContain('has not confirmed it stopped');
});
