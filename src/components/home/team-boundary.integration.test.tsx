/** Actual Home/Team/Results providers, authenticated tRPC and SQLite. DOM only,
 * fake harness discovery, no editor or native-provider qualification. */
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {} }), usePathname: () => '/results', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/harness/runtime', async original => {
  const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
  return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let root: import('react-dom/client').Root | undefined;
let client: QueryClient;
beforeAll(preloadTeamRoutes, 120_000);
afterEach(async () => {
  await act(async () => root?.unmount()); client?.clear();
  vi.unstubAllGlobals(); await fixture?.cleanup();
});

it('completes a Team task from the real Results layout while the real Team boundary uses shared API routes', async () => {
  fixture = await createTeamExecutionFixture();
  const task = q.createTask({ title: 'Accept this work' });
  const legacy = q.createChatSession({ type: 'orchestration', harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE });
  const requests: string[] = [];
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const storage = new Map([['ri.token', fixture.member.token.plaintext]]);
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  Object.defineProperty(window, 'location', { configurable: true, value: { origin: 'http://team.test', href: 'http://team.test/results', pathname: '/results', search: '', hash: '', protocol: 'http:', hostname: 'team.test' } });
  document.documentElement.dataset.riAuthority = 'team'; document.documentElement.dataset.riHome = q.getHome()!.id; document.documentElement.dataset.riViewer = fixture.member.member.id;
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('HTMLElement', window.HTMLElement); vi.stubGlobal('Node', window.Node);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('WebSocket', undefined);
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => { requests.push(input instanceof Request ? input.url : String(input)); return serveTeam(input instanceof Request ? input : new URL(String(input), 'http://team.test'), init); });
  const { setTransportMode } = await import('@/lib/trpc/transport-state'); setTransportMode('http');
  const { HomeBoundary } = await import('./home-context');
  const { TeamContext } = await import('@/components/team/team-context');
  const { TeamWorkBoundary } = await import('./team-work-boundary');
  const ResultsLayout = (await import('@/app/results/layout')).default;
  const { useLifecycleGuard } = await import('@/components/tasks/lifecycle-guard');
  const { trpcClient } = await import('@/lib/trpc/client');
  const { useSessionTree } = await import('@/hooks/use-execution');
  function Action() {
    useSessionTree(legacy.id);
    const guard = useLifecycleGuard(); const [result, setResult] = useState('Ready');
    return <button onClick={async () => {
      await trpcClient.workspaces.fileCreatePost.mutate({ params: { id: fixture.workspace.id }, body: { path: 'review.txt' } });
      setResult(await guard.resolve({ taskId: task.id, command: 'complete' }) ? 'Completed' : 'Refused');
    }}>{result}</button>;
  }
  const { createRoot } = await import('react-dom/client'); root = createRoot(document.getElementById('root')!);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root!.render(createElement(QueryClientProvider, { client }, createElement(TeamContext.Provider, { value: { team: { id: q.getHome()!.id, name: 'Team', members: 2, hostedOn: null }, member: { id: fixture.member.member.id, name: 'Maya', role: 'member' } } }, createElement(HomeBoundary, null, createElement(TeamWorkBoundary, null, createElement(ResultsLayout, null, createElement(Action))))))));
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); expect(document.querySelector('button')?.textContent).toBe('Ready'); });
  await act(async () => { document.querySelector('button')!.click(); await new Promise(resolve => setTimeout(resolve, 100)); });
  await vi.waitFor(() => expect(document.querySelector('button')?.textContent).toBe('Completed'));
  expect(q.getTask(task.id)?.status).toBe('done');
  expect(client.getQueryData(['session', legacy.id])).toMatchObject({ workspaceId: null });
  expect(requests.some(url => url.includes('sessions.treeGet'))).toBe(false);
  expect(q.listTeamActivity(fixture.workspace.id)).toEqual(expect.arrayContaining([expect.objectContaining({ memberId: fixture.member.member.id, operation: 'create_file' })]));
});
