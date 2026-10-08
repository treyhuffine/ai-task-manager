import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { entityKeys } from '@/lib/query/entity-keys';
import type { WorkResultCompleteResponse } from '@/lib/api/results';
import { pendingResultCompletion } from '@/components/results/completion-retry';
import { useAcceptResultComplete } from './use-results';

const fixtures = vi.hoisted(() => ({ complete: vi.fn(), guard: vi.fn(), getTask: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api/results', () => ({ workResultsApi: { complete: fixtures.complete } }));
vi.mock('@/components/tasks/lifecycle-guard', () => ({ useLifecycleGuard: () => ({ resolve: fixtures.guard }) }));
vi.mock('sonner', () => ({ toast: { error: fixtures.error } }));

const TASK_KEY = entityKeys.tasks.detail('test-task');
const LIST_KEY = entityKeys.tasks.list({ status: 'todo' });
let root: Root | undefined;
let client: QueryClient;
let mutation: ReturnType<typeof useAcceptResultComplete>;

function Harness() {
  useQuery({ queryKey: TASK_KEY, queryFn: fixtures.getTask });
  const current = useAcceptResultComplete('test-result');
  useEffect(() => { mutation = current; }, [current]);
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const saved = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  fixtures.complete.mockReset();
  fixtures.error.mockReset();
  fixtures.getTask.mockReset().mockImplementation(() => new Promise(() => {}));
  fixtures.guard.mockReset().mockImplementation(async (_command, operation) => {
    await operation({ runtimeChoice: 'keep_running', acknowledgedChildIds: ['child'], acknowledgedExecutionIds: ['work'] });
    return true;
  });
  client = new QueryClient({ defaultOptions: {
    queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false },
  } });
  client.setQueryData<Record<string, unknown>>(TASK_KEY, { id: 'test-task', status: 'todo', statusChangedCount: 4 });
  client.setQueryData<Array<Record<string, unknown>>>(LIST_KEY, [{ id: 'test-task', status: 'todo' }]);
  client.setQueryData(['tasks', 'unrelated-legacy-key'], { old: true });
  client.setQueryData(['sessions', 'rail'], { sessions: [] });
  client.setQueryData(['executions', 'list'], []);
  client.setQueryData(['results', 'test-result'], { id: 'test-result' });
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

describe('saved handoff acceptance through the typed task cache', () => {
  it('preserves guard acknowledgments and refreshes canonical task caches without delaying save acknowledgment', async () => {
    const outcome = { review: { id: 'accepted-review' }, completion: null, taskId: 'test-task', replayed: false } as WorkResultCompleteResponse;
    fixtures.complete.mockResolvedValue(outcome);
    let response: WorkResultCompleteResponse | null = null;
    await act(async () => { response = await mutation.mutateAsync({ taskId: 'test-task', expectedStatusChangedCount: 4, note: 'Ready to ship' }); });
    expect(response).toBe(outcome);
    expect(fixtures.guard).toHaveBeenCalledWith({ taskId: 'test-task', command: 'complete' }, expect.any(Function));
    expect(fixtures.complete).toHaveBeenCalledWith('test-result', expect.objectContaining({
      taskId: 'test-task', expectedStatusChangedCount: 4, note: 'Ready to ship',
      requestId: expect.any(String), runtimeChoice: 'keep_running', acknowledgedChildIds: ['child'], acknowledgedExecutionIds: ['work'],
    }));
    expect(client.getQueryState(TASK_KEY)?.isInvalidated).toBe(true);
    expect(client.getQueryState(LIST_KEY)?.isInvalidated).toBe(true);
    expect(client.getQueryState(['tasks', 'unrelated-legacy-key'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['sessions', 'rail'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['executions', 'list'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['results', 'test-result'])?.isInvalidated).toBe(true);
    expect(fixtures.getTask).toHaveBeenCalledOnce();
    expect(client.isFetching({ queryKey: TASK_KEY })).toBe(1);
    expect(pendingResultCompletion('test-result')).toBeNull();
  });
});
