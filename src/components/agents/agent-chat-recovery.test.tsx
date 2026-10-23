/** Review 7 probe: real TeamChatDestination -> SelectedTeamChat/MemberAgentChat -> AgentView -> AgentChatPanel -> HarnessChat(Session). Leaves stubbed. */
import { act, createElement, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, onlineManager, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';


const h = vi.hoisted(() => ({
  url: new URL('http://team.test/'), listeners: new Set<() => void>(), calls: [] as string[],
  wsGet: null as null | ((id: string) => Promise<unknown>),
  main: null as null | (() => Promise<unknown>),
  sessionGet: null as null | ((id: string) => Promise<unknown>),
  composerMounts: 0, composerUnmounts: 0, drafts: new Map<string, string>(),
  newBodies: [] as unknown[],
}));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const sub = (f: () => void) => { h.listeners.add(f); return () => h.listeners.delete(f); };
  const go = (u: string) => { h.url = new URL(u, h.url); for (const f of h.listeners) f(); };
  return { usePathname: () => '/', useSearchParams: () => new URLSearchParams(useSyncExternalStore(sub, () => h.url.search)), useRouter: () => ({ push: go, replace: go }) };
});
const WS = { id: 'agent', name: 'Agent', status: 'active', cwd: '/tmp/x', isGit: false };
vi.mock('@/lib/trpc/client', async original => ({ ...await original<typeof import('@/lib/trpc/client')>(), trpcClient: {
  workspaces: {
    get: { query: async ({ params }: { params: { id: string } }) => { h.calls.push('wsGet'); return h.wsGet ? h.wsGet(params.id) : WS; } },
    list: { query: async () => { h.calls.push('wsList'); return [WS]; } },
    chatGet: { query: async () => { h.calls.push('chatGet'); return h.main ? h.main() : { session: { id: 'X', workspaceId: 'agent', executionId: null, status: 'active', type: 'orchestration' } }; } },
    chatHistoryGet: { query: async () => ({ sessions: [] }) },
    chatNewPost: { mutate: async (input: { body: unknown }) => { h.calls.push('chatNewPost'); h.newBodies.push(input.body); return { session: { id: 'C', workspaceId: 'agent', executionId: null, status: 'active', type: 'orchestration' } }; } },
  },
  sessions: { messagesPost: { mutate: async (input: { params: { id: string } }) => { h.calls.push('messagesPost:' + input.params.id); return {}; } } },
} }));
vi.mock('@/lib/api/sessions', async original => ({ ...await original<typeof import('@/lib/api/sessions')>(), sessionsApi: new Proxy({
  get: async (id: string) => { h.calls.push('sessionGet:' + id); return h.sessionGet ? h.sessionGet(id) : { id, workspaceId: 'agent', executionId: null, status: 'active', type: 'orchestration', permissionMode: 'ask' }; },
  sendMessage: async (id: string) => { h.calls.push('send:' + id); return { id: 'e1' }; },
} as Record<string, unknown>, { get: (t, k: string) => t[k] ?? (async () => []) }) }));
vi.mock('@/hooks/use-session-stream', () => ({ useSessionStream: () => {}, useGlobalSessionStream: () => {} }));
vi.mock('@/hooks/use-session-reconcile', () => ({ useSessionReconcile: () => ({ reconciling: false }) }));
vi.mock('@/hooks/use-devices', () => ({ useDevice: () => null, useDevices: () => ({ data: [] }), useRunsOnSeveralDevices: () => false }));
vi.mock('@/components/executions/execution-composer', async () => {
  const React = await import('react');
  return { ExecutionComposer: ({ sessionId, draftKey, onSend, onSwitchProvider, disabled }: { sessionId: string; draftKey?: string; onSend: (c: string) => Promise<void>; onSwitchProvider?: (n: unknown) => void; disabled?: boolean }) => {
    const key = draftKey ?? `exec:${sessionId}`;
    const [text, setText] = React.useState(() => h.drafts.get(key) ?? '');
    React.useEffect(() => { h.composerMounts++; return () => { h.composerUnmounts++; }; }, []);
    (globalThis as Record<string, unknown>).__type = (v: string) => setText(v);
    return React.createElement('div', { 'data-composer': key, 'data-text': text, 'data-disabled': String(!!disabled) },
      React.createElement('button', { 'data-send': '1', onClick: () => { const t = text; setText(''); void onSend(t || 'hello').catch(() => setText(t)); } }, 'Send'),
      onSwitchProvider ? React.createElement('button', { 'data-switch': '1', onClick: () => onSwitchProvider({ harness: 'codex', model: 'm' }) }, 'Switch') : null,
      `Composer ${key} [${text}]`);
  } };
});
vi.mock('@/components/agents/agent-header', () => ({ AgentHeader: () => 'Header' }));
vi.mock('@/components/agents/agent-tools', async () => {
  const React = await import('react');
  return { AgentTools: ({ tab, onSelectTab }: { tab: string; onSelectTab: (t: string) => void }) => React.createElement('button', { 'data-tab': '1', onClick: () => onSelectTab('files') }, `Tools ${tab}`) };
});
vi.mock('@/components/ui/resizable', async () => {
  const React = await import('react');
  const Pass = ({ children }: { children?: ReactNode }) => React.createElement('div', null, children);
  return { ResizablePanelGroup: Pass, ResizablePanel: Pass, ResizableHandle: () => null };
});
vi.mock('@/components/chat-ui/artifacts/artifact-preview-provider', () => ({ useBesidePreview: () => null, useBesideRegion: () => {}, useArtifactPreview: () => () => {}, useArtifactPreviewStore: () => ({}) }));
vi.mock('@/lib/file-icons', () => ({ fileIconFor: () => null, getFileIcon: () => null, default: {} }));
vi.mock('@/components/file-icon', () => ({ FileIcon: () => null, default: () => null }));
vi.mock('@/components/executions/execution-view', () => ({ ExecutionView: () => 'Execution' }));

let root: Root, client: QueryClient, container: HTMLElement, win: Window & typeof globalThis;
beforeEach(async () => {
  notifyManager.setScheduler(queueMicrotask);
  const dom = parseHTML('<!doctype html><html><body></body></html>');
  win = dom.window as never;
  const store = new Map<string, string>();
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: () => null, length: 0 };
  Object.defineProperty(dom.window, 'localStorage', { value: ls, configurable: true });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0)); vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('EventSource', class { close() {} addEventListener() {} removeEventListener() {} });
  const { makeQueryClient } = await import('@/lib/query/client');
  client = makeQueryClient();
  container = dom.document.createElement('div'); root = createRoot(container);
  h.calls = []; h.wsGet = null; h.main = null; h.sessionGet = null; h.composerMounts = 0; h.composerUnmounts = 0; h.drafts.clear(); h.newBodies = [];
});
afterEach(async () => {
  onlineManager.setOnline(true);
  await act(async () => { root.unmount(); client.clear(); });
  notifyManager.setScheduler(cb => setTimeout(cb, 0));
  vi.unstubAllGlobals();
});

async function Nav({ children }: { children: ReactNode }) { return children; }
void Nav;
async function mount(what: 'destination' | 'agent-unpinned' = 'destination') {
  const { TeamChatDestination } = await import('@/components/team/team-chat-destination');
  const { AgentView } = await import('@/components/agents/agent-view');
  const { useTeamNav } = await import('@/components/team/team-context');
  const { WorkContext } = await import('@/contexts/work-context');
  function Boundary({ children }: { children: ReactNode }) {
    const nav = useTeamNav();
    const navigation = useMemo(() => ({ openAgent: nav.openAgent, openExecution: nav.openChat, openTask: nav.openTask, openNote: nav.openNote, goHome: () => nav.show('board') }), [nav]);
    const activity = useMemo(() => ({ activeSessionId: null, streamingSessionIds: new Set<string>(), backgroundSessionIds: new Set<string>(), pendingInputSessionIds: new Set<string>(), setActiveExecutionId: () => {}, setSessionStreaming: () => {} }), []);
    return createElement(WorkContext, { navigation, activity }, children);
  }
  const inner = what === 'destination' ? createElement(TeamChatDestination) : createElement(AgentView, { workspaceId: 'agent' });
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Boundary, null, inner))));
  await act(async () => { await new Promise(r => setTimeout(r, 50)); });
}
const text = () => container.textContent ?? '';
const settle = (ms = 300) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
async function until(check: () => boolean, ms = 30_000) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > ms) throw new Error('timeout: ' + text()); await settle(100); }
}
const click = async (sel: string) => { const el = container.querySelector(sel)!; expect(el).toBeTruthy(); await act(async () => { el.dispatchEvent(new win.Event('click', { bubbles: true })); }); };

it('L1: pinned chat, session cached, agent row not cached, offline -> what AgentView shows', async () => {
  client.setQueryData(['session', 'X'], { id: 'X', workspaceId: 'agent', executionId: null, status: 'active', type: 'orchestration', permissionMode: 'ask' });
  onlineManager.setOnline(false);
  h.url = new URL('http://team.test/?view=chat&chat=X');
  await mount(); await settle();
  const offline = text();
  await act(async () => onlineManager.setOnline(true)); await settle(); await settle();
  expect(offline).toContain("You are offline");
  expect(offline).not.toContain("isn't here anymore");
}, 60_000);

it('L2: pinned chat, agent row GET 503 with no cache -> what AgentView shows', async () => {
  const { ApiError } = await import('@/lib/api/client');
  h.wsGet = async () => { throw new ApiError(503, { error: 'Team host busy' }, '/fixture'); };
  h.url = new URL('http://team.test/?view=chat&chat=X');
  await mount();
  await until(() => !text().includes('Opening chat') && (text().includes("isn't here") || text().includes('unavailable')), 30_000);
  const shown = text();
  const buttons = [...container.querySelectorAll('button')].map(b => b.textContent);
  expect(shown).not.toContain("isn't here anymore");
  expect(shown).toContain('This agent is unavailable');
  expect(buttons).toContain('Retry');
  h.wsGet = async () => WS;
  const retry = [...container.querySelectorAll('button')].find(b => b.textContent === 'Retry')!;
  await act(async () => retry.dispatchEvent(new win.Event('click', { bubbles: true })));
  await until(() => !!container.querySelector('[data-composer]'));
}, 60_000);

it('L3: personal-style unpinned agent view, offline with no agent cache', async () => {
  onlineManager.setOnline(false);
  await mount('agent-unpinned'); await settle();
  expect(text()).toContain("You are offline");
  expect(text()).not.toContain("isn't here anymore");
}, 30_000);

it('L4: confirmed-null member chat + failed refresh -> number of refresh notices', async () => {
  const { ApiError } = await import('@/lib/api/client');
  let fail = false;
  h.main = async () => { if (fail) throw new ApiError(503, { error: 'Temporary' }, '/fixture'); return { session: null }; };
  h.url = new URL('http://team.test/?view=chat');
  await mount();
  await until(() => text().includes('Start a conversation'));
  fail = true;
  await act(async () => { void client.invalidateQueries({ queryKey: ['agent-chat', 'agent'] }); });
  await until(() => text().includes('Could not refresh'), 30_000);
  const n = (text().match(/Could not refresh this chat/g) ?? []).length;
  expect(n).toBe(1);
}, 60_000);

it('L5: refresh failure while composing in a pinned Team chat keeps the composer + draft', async () => {
  const { ApiError } = await import('@/lib/api/client');
  let fail = false;
  h.sessionGet = async id => { if (fail) throw new ApiError(503, { error: 'Temporary' }, '/fixture'); return { id, workspaceId: 'agent', executionId: null, status: 'active', type: 'orchestration', permissionMode: 'ask' }; };
  h.url = new URL('http://team.test/?view=chat&chat=X');
  await mount();
  await until(() => !!container.querySelector('[data-composer]'));
  await act(async () => { ((globalThis as Record<string, unknown>).__type as (v: string) => void)('half typed'); });
  fail = true;
  await act(async () => { void client.invalidateQueries({ queryKey: ['session', 'X'] }); });
  await until(() => text().includes('Could not refresh'), 30_000);
  const draft = container.querySelector('[data-composer]')?.getAttribute('data-text');
  expect(draft).toBe('half typed'); expect(h.composerUnmounts).toBe(0);
  // Send during the failure goes to the viewed chat.
  expect((text().match(/Could not refresh this chat/g) ?? []).length).toBe(1);
  await click('[data-send]'); await settle();
  expect(h.calls.some(call => call === 'send:X' || call === 'messagesPost:X')).toBe(true);
}, 60_000);

it('L6: refresh failure while composing in an unpinned main chat (HarnessChat) keeps composer + draft', async () => {
  const { ApiError } = await import('@/lib/api/client');
  let fail = false;
  h.main = async () => { if (fail) throw new ApiError(500, { error: 'boom' }, '/fixture'); return { session: { id: 'X', workspaceId: 'agent', executionId: null, status: 'active', type: 'orchestration' } }; };
  await mount('agent-unpinned');
  await until(() => !!container.querySelector('[data-composer]'));
  await act(async () => { ((globalThis as Record<string, unknown>).__type as (v: string) => void)('main draft'); });
  fail = true;
  await act(async () => { void client.invalidateQueries({ queryKey: ['agent-chat', 'agent'] }); });
  await until(() => text().includes('Could not refresh'), 30_000);
  const draft = container.querySelector('[data-composer]')?.getAttribute('data-text');
  expect(draft).toBe('main draft'); expect(h.composerUnmounts).toBe(0);
}, 60_000);

it('L12: unpinned main chat resolves, its session row GET fails (no cache): what HarnessChatSession shows', async () => {
  const { ApiError } = await import('@/lib/api/client');
  h.sessionGet = async () => { throw new ApiError(503, { error: 'Session read failed' }, '/fixture'); };
  await mount('agent-unpinned');
  await settle(); await settle();
  // useSession retries 3x with 1s/2s/4s backoff before erroring.
  await until(() => text().includes('This chat is unavailable'), 15_000);
  expect(container.querySelector('[data-composer]')).toBeNull();
  expect(text()).toContain(onlineManager.isOnline() ? 'This chat is unavailable' : 'You are offline');
  expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Retry')).toBe(true);
  h.sessionGet = async id => ({ id, workspaceId: 'agent', executionId: null, status: 'active', type: 'orchestration', permissionMode: 'ask' });
  const retry = [...container.querySelectorAll('button')].find(b => b.textContent === 'Retry')!;
  await act(async () => retry.dispatchEvent(new win.Event('click', { bubbles: true })));
  await until(() => !!container.querySelector('[data-composer]'));
}, 60_000);

it('L12b: main chat cached, offline, session row not cached', async () => {
  client.setQueryData(['workspaces', 'agent'], WS);
  client.setQueryData(['agent-chat', 'agent'], { session: { id: 'X', workspaceId: 'agent', executionId: null, status: 'active', type: 'orchestration' } });
  onlineManager.setOnline(false);
  await mount('agent-unpinned'); await settle();
  expect(container.querySelector('[data-composer]')).toBeNull();
  expect(text()).toContain(onlineManager.isOnline() ? 'This chat is unavailable' : 'You are offline');
  expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Retry')).toBe(true);
}, 30_000);


it('a confirmed missing agent retains the deleted-agent state', async () => {
  const { ApiError } = await import('@/lib/api/client');
  h.wsGet = async () => { throw new ApiError(404, { error: 'Not found' }, '/fixture'); };
  h.url = new URL('http://team.test/?view=chat&chat=X');
  await mount();
  await until(() => text().includes("isn't here anymore"), 15_000);
  expect(text()).toContain('Back to Home');
  expect(text()).not.toContain('This agent is unavailable');
  expect(container.querySelector('[data-composer]')).toBeNull();
}, 30_000);
