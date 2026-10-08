import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import type { UpdateWorkspaceInput } from '@/db/types';
import type { workspacesApi } from '@/lib/api/workspaces';
import type { WorkResultDetailResponse } from '@/lib/api/results';
import { useUpdateWorkspace, useWorkspace } from './use-workspaces';

type Workspace = Awaited<ReturnType<typeof workspacesApi.get>>;
const fixtures = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api/workspaces', () => ({ workspacesApi: { get: fixtures.get, update: fixtures.update } }));
vi.mock('@/lib/api/sessions', () => ({ sessionsApi: {} }));
vi.mock('@/hooks/use-execution', () => ({ worktreeScopeFor: vi.fn() }));
vi.mock('@/hooks/use-reference-folders', () => ({ invalidateReferencePickers: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: fixtures.error } }));

const ID = 'test-agent';
const KEY = ['workspaces', ID] as const;
const LIST_KEY = ['workspaces', { status: 'active' }] as const;
const RESULT_KEY = ['results', 'test-result'] as const;
type Mutation = ReturnType<typeof useUpdateWorkspace>;
let first: Mutation;
let second: Mutation;
let client: QueryClient;
let root: Root | undefined;
let reads: ReturnType<typeof deferred<Workspace>>[];

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return { id: ID, name: 'Test agent', instructions: 'General instructions',
    workResultGuidance: 'Original guidance', reviewBeforeHandoff: null, reviewDefaults: null,
    ...overrides } as Workspace;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function Harness() {
  useWorkspace(ID);
  const one = useUpdateWorkspace();
  const two = useUpdateWorkspace();
  useEffect(() => { first = one; second = two; }, [one, two]);
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  reads = [];
  fixtures.get.mockReset().mockImplementation(() => {
    const read = deferred<Workspace>();
    reads.push(read);
    return read.promise;
  });
  fixtures.update.mockReset();
  fixtures.error.mockReset();
  client = new QueryClient({ defaultOptions: {
    queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    mutations: { retry: false },
  } });
  client.setQueryData(KEY, workspace());
  client.setQueryData(LIST_KEY, [workspace()]);
  client.setQueryData(RESULT_KEY, { associatedWorkspace: {
    id: ID, name: 'Test agent', reviewBeforeHandoff: null, reviewDefaults: null,
  } });
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
});

afterEach(async () => {
  await act(async () => { await vi.runAllTimersAsync(); });
  await act(async () => root?.unmount());
  client.clear();
  await act(async () => { await vi.runAllTimersAsync(); });
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function cached() { return client.getQueryData<Workspace>(KEY)!; }
function associated() { return client.getQueryData<WorkResultDetailResponse>(RESULT_KEY)!.associatedWorkspace!; }

async function start(mutation: Mutation, patch: UpdateWorkspaceInput) {
  let promise!: ReturnType<Mutation['mutateAsync']>;
  await act(async () => {
    promise = mutation.mutateAsync({ id: ID, ...patch });
    void promise.catch(() => {});
  });
  return { promise };
}

describe('optimistic agent settings saves', () => {
  it('merges overlapping partial choices across detail, list and result caches without an early refresh', async () => {
    const guidanceWrite = deferred<Workspace>();
    const reviewerWrite = deferred<Workspace>();
    fixtures.update.mockReturnValueOnce(guidanceWrite.promise).mockReturnValueOnce(reviewerWrite.promise);
    const guidance = await start(first, { workResultGuidance: 'Include the final link.' });
    const reviewer = await start(second, { reviewBeforeHandoff: true });
    expect(cached()).toMatchObject({ workResultGuidance: 'Include the final link.', reviewBeforeHandoff: true, instructions: 'General instructions' });
    expect(client.getQueryData<Workspace[]>(LIST_KEY)![0]).toMatchObject({ workResultGuidance: 'Include the final link.', reviewBeforeHandoff: true });
    expect(associated().reviewBeforeHandoff).toBe(true);

    await act(async () => { guidanceWrite.resolve(workspace({ workResultGuidance: 'Include the final link.' })); await guidance.promise; });
    expect(fixtures.get).not.toHaveBeenCalled();
    expect(cached().reviewBeforeHandoff).toBe(true);
    const saved = workspace({ workResultGuidance: 'Include the final link.', reviewBeforeHandoff: true });
    await act(async () => { reviewerWrite.resolve(saved); await reviewer.promise; });
    expect(fixtures.get).toHaveBeenCalledOnce();
    expect(client.getQueryState(RESULT_KEY)?.isInvalidated).toBe(true);
    expect(client.isFetching({ queryKey: KEY })).toBe(1);
    await act(async () => { reads[0].resolve(saved); });
    expect(cached()).toEqual(saved);
    expect(fixtures.update.mock.calls[0]).toEqual([ID, { workResultGuidance: 'Include the final link.' }]);
  });

  it('restores failed fields without undoing a later successful setting', async () => {
    const guidanceWrite = deferred<Workspace>();
    const reviewerWrite = deferred<Workspace>();
    fixtures.update.mockReturnValueOnce(guidanceWrite.promise).mockReturnValueOnce(reviewerWrite.promise);
    const guidance = await start(first, { workResultGuidance: 'Failed guidance' });
    const reviewer = await start(second, { reviewBeforeHandoff: true });
    await act(async () => { reviewerWrite.resolve(workspace({ reviewBeforeHandoff: true })); await reviewer.promise; });
    const failure = new Error('Offline');
    await act(async () => { guidanceWrite.reject(failure); await expect(guidance.promise).rejects.toBe(failure); });
    expect(cached()).toMatchObject({ workResultGuidance: 'Original guidance', reviewBeforeHandoff: true });
    expect(client.getQueryData<Workspace[]>(LIST_KEY)![0]).toMatchObject({ workResultGuidance: 'Original guidance', reviewBeforeHandoff: true });
    expect(associated().reviewBeforeHandoff).toBe(true);
    expect(fixtures.error).toHaveBeenCalledOnce();
  });

  it('retains a newer successful same-value reviewer choice after an older failure', async () => {
    const earlierWrite = deferred<Workspace>();
    const laterWrite = deferred<Workspace>();
    fixtures.update.mockReturnValueOnce(earlierWrite.promise).mockReturnValueOnce(laterWrite.promise);
    const earlier = await start(first, { reviewBeforeHandoff: true });
    const later = await start(second, { reviewBeforeHandoff: true });
    await act(async () => { laterWrite.resolve(workspace({ reviewBeforeHandoff: true })); await later.promise; });
    const failure = new Error('Older save failed');
    await act(async () => { earlierWrite.reject(failure); await expect(earlier.promise).rejects.toBe(failure); });
    expect(cached().reviewBeforeHandoff).toBe(true);
    expect(associated().reviewBeforeHandoff).toBe(true);
  });

  it('rolls back only its review preference in an associated handoff', async () => {
    const toggleWrite = deferred<Workspace>();
    const defaultsWrite = deferred<Workspace>();
    fixtures.update.mockReturnValueOnce(toggleWrite.promise).mockReturnValueOnce(defaultsWrite.promise);
    const toggle = await start(first, { reviewBeforeHandoff: true });
    const reviewDefaults = { harness: 'codex' as const, model: 'test-model', effort: null, variant: null };
    const defaults = await start(second, { reviewDefaults });
    const failure = new Error('Toggle save failed');
    await act(async () => { toggleWrite.reject(failure); await expect(toggle.promise).rejects.toBe(failure); });
    expect(associated()).toMatchObject({ reviewBeforeHandoff: null, reviewDefaults });
    expect(cached()).toMatchObject({ reviewBeforeHandoff: null, reviewDefaults });
    expect(fixtures.get).not.toHaveBeenCalled();
    await act(async () => { defaultsWrite.resolve(workspace({ reviewDefaults })); await defaults.promise; });
  });

  it('keeps folder and conversation caches outside the agent record patch', async () => {
    const foldersKey = ['workspaces', ID, 'folders'] as const;
    const sessionsKey = ['workspaces', ID, 'sessions'] as const;
    const folders = { devices: [{ id: ID, folder: '/test/path' }] };
    const sessions = [{ id: ID, label: 'Conversation', workResultGuidance: 'Do not rewrite this row' }];
    client.setQueryData(foldersKey, folders);
    client.setQueryData(sessionsKey, sessions);
    const write = deferred<Workspace>();
    fixtures.update.mockReturnValueOnce(write.promise);
    const save = await start(first, { workResultGuidance: null });
    expect(client.getQueryData(foldersKey)).toBe(folders);
    expect(client.getQueryData(sessionsKey)).toBe(sessions);
    await act(async () => { write.resolve(workspace({ workResultGuidance: null })); await save.promise; });
    expect(cached().workResultGuidance).toBeNull();
    expect(client.isFetching({ queryKey: KEY })).toBe(1);
  });
});
