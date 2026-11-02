/**
 * A chat being archived stays out of the active lists while the request
 * runs, even when they refetch: the server keeps it active until its
 * worktree is gone, which can take a while. Settling lets the server's
 * answer through again.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { useArchiveSession, useBulkArchiveSessions, useRailSessions, useWorkspaceSessions } from './use-workspaces';

const server = vi.hoisted(() => ({ active: [] as string[], archive: vi.fn() }));
const rows = () => server.active.map((id) => ({ id, workspaceId: 'agent', executionId: `${id}-execution`, status: 'active' }));
vi.mock('@/lib/api/sessions', () => ({
  sessionsApi: {
    rail: async () => ({ sessions: rows() }),
    needsReview: async () => [],
    archive: server.archive,
  },
}));
vi.mock('@/lib/api/workspaces', () => ({ workspacesApi: { sessions: async () => rows() } }));
vi.mock('@/lib/file-icons', () => ({ fileIconUrl: () => '', folderIconUrl: () => '', iconForFile: () => '', iconForFolder: () => '' }));

const RAIL_KEY = ['sessions', 'rail'];
const AGENT_KEY = ['workspaces', 'agent', 'sessions'];
let client: QueryClient;
let root: Root | undefined;
interface Rendered {
  rail: string[];
  agent: string[];
  archive: ReturnType<typeof useArchiveSession>;
  bulk: ReturnType<typeof useBulkArchiveSessions>;
}
const capture = vi.fn<(rendered: Rendered) => void>();
/** What the hooks gave on the latest render. */
const hooks = () => capture.mock.lastCall![0];

function Harness() {
  const rail = useRailSessions();
  const agent = useWorkspaceSessions('agent');
  capture({
    rail: (rail.data?.sessions ?? []).map((s) => s.id),
    agent: (agent.data ?? []).map((s) => s.id),
    archive: useArchiveSession(),
    bulk: useBulkArchiveSessions(),
  });
  return null;
}

beforeEach(async () => {
  // Renders follow cache changes within the act() that made them.
  notifyManager.setScheduler(queueMicrotask);
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  server.active = ['a', 'b'];
  server.archive.mockReset();
  capture.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } } });
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
  await vi.waitFor(() => expect(hooks().rail).toEqual(['a', 'b']));
  await vi.waitFor(() => expect(hooks().agent).toEqual(['a', 'b']));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  client.clear();
  notifyManager.setScheduler((cb) => setTimeout(cb, 0));
  vi.unstubAllGlobals();
});

/** Archive requests that answer only when the test says so. */
function held() {
  let finish!: () => void;
  let fail!: (err: unknown) => void;
  server.archive.mockReturnValueOnce(new Promise((resolve, reject) => { finish = () => resolve({}); fail = reject; }));
  return { finish, fail };
}
const refetch = () => act(async () => {
  await client.invalidateQueries({ queryKey: RAIL_KEY });
  await client.invalidateQueries({ queryKey: AGENT_KEY });
});
/** What every list renders from. */
const cached = () => ({
  rail: (client.getQueryData<{ sessions: { id: string }[] }>(RAIL_KEY)?.sessions ?? []).map((s) => s.id),
  agent: (client.getQueryData<{ id: string }[]>(AGENT_KEY) ?? []).map((s) => s.id),
});

it('keeps an archiving chat out of the lists through refetches, until the server has archived it', async () => {
  const request = held();
  let result!: Promise<unknown>;
  await act(async () => { result = hooks().archive.mutateAsync({ id: 'a' }); });
  await vi.waitFor(() => expect(server.archive).toHaveBeenCalled());
  await vi.waitFor(() => expect(hooks().rail).toEqual(['b']));
  // The server still lists it as active while its worktree goes.
  await refetch();
  expect(cached()).toEqual({ rail: ['b'], agent: ['b'] });
  expect(hooks().rail).toEqual(['b']);
  expect(hooks().agent).toEqual(['b']);

  server.active = ['b'];
  await act(async () => { request.finish(); await result; });
  await vi.waitFor(() => expect(hooks().rail).toEqual(['b']));
  expect(hooks().agent).toEqual(['b']);
});

it('brings the chat back once the archive is refused, and lists it from then on', async () => {
  const request = held();
  let result!: Promise<unknown>;
  await act(async () => { result = hooks().archive.mutateAsync({ id: 'a' }).catch(() => undefined); });
  await vi.waitFor(() => expect(server.archive).toHaveBeenCalled());
  await vi.waitFor(() => expect(hooks().rail).toEqual(['b']));
  await act(async () => {
    request.fail(new ApiError(409, { code: 'dirty_worktree', files: [], omitted: 0 }, '/api/sessions/a/archive'));
    await result;
  });
  await vi.waitFor(() => expect(hooks().rail).toEqual(['a', 'b']));
  await refetch();
  expect(cached()).toEqual({ rail: ['a', 'b'], agent: ['a', 'b'] });
});

it('bulk archive takes its rows away at once, keeps them away through refetches, and brings back the ones that stay', async () => {
  const first = held();
  const second = held();
  let result!: Promise<unknown>;
  await act(async () => { result = hooks().bulk.mutateAsync({ ids: ['a', 'b'] }); });
  await vi.waitFor(() => expect(server.archive).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(hooks().rail).toEqual([]));
  await refetch();
  expect(cached()).toEqual({ rail: [], agent: [] });

  // "a" is archived, "b" is refused for its uncommitted files.
  server.active = ['b'];
  await act(async () => {
    first.finish();
    second.fail(new ApiError(409, { code: 'dirty_worktree', files: [], omitted: 0 }, '/api/sessions/b/archive'));
    await result;
  });
  await vi.waitFor(() => expect(hooks().rail).toEqual(['b']));
  expect(cached()).toEqual({ rail: ['b'], agent: ['b'] });
  expect(await result).toMatchObject({ succeeded: ['a'], dirty: [{ id: 'b' }] });
});
