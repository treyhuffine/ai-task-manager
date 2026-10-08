import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import type { UserStateRecord, UpdateUserStateInput } from '@/db/types';
import { useUserState, useUpdateUserState } from './use-user-state';

const fixtures = vi.hoisted(() => ({
  get: vi.fn<() => Promise<UserStateRecord>>(),
  update: vi.fn<(input: UpdateUserStateInput) => Promise<UserStateRecord>>(),
  error: vi.fn(),
}));

vi.mock('@/lib/api/user-state', () => ({ userStateApi: { get: fixtures.get, update: fixtures.update } }));
vi.mock('sonner', () => ({ toast: { error: fixtures.error } }));

function record(overrides: Partial<UserStateRecord> = {}): UserStateRecord {
  return {
    id: 1,
    createdAt: '2026-10-08 12:00:00',
    updatedAt: '2026-10-08 12:00:00',
    name: 'Original name',
    activeAreaId: null,
    activeParentTaskId: null,
    activeEnergy: null,
    availableMinutes: null,
    workdayStart: null,
    workdayEnd: null,
    timezone: null,
    description: 'Original profile',
    workResultGuidance: 'Original guidance',
    voiceAutoSend: false,
    voiceModel: null,
    defaultHarness: null,
    defaultModel: null,
    defaultEffort: null,
    orchestratorMode: null,
    monthlyBudgetUsd: null,
    streamAutonomy: null,
    executionInactiveAfterDays: null,
    orchestratorName: null,
    orchestratorEmoji: null,
    orchestratorColor: null,
    orchestratorImage: null,
    orchestratorIntroducedAt: null,
    onboarding: null,
    onboardedAt: null,
    ...overrides,
  };
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

type PendingRead = ReturnType<typeof deferred<UserStateRecord>>;
type SettingsMutation = ReturnType<typeof useUpdateUserState>;
const KEY = ['user-state'] as const;
let root: Root | undefined;
let client: QueryClient;
let reads: PendingRead[];
let first: SettingsMutation;
let second: SettingsMutation;

function Harness() {
  // A real observer ensures invalidations exercise the background GET.
  useUserState();
  const firstMutation = useUpdateUserState();
  const secondMutation = useUpdateUserState();
  useEffect(() => {
    first = firstMutation;
    second = secondMutation;
  }, [firstMutation, secondMutation]);
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
    const read = deferred<UserStateRecord>();
    reads.push(read);
    return read.promise;
  });
  fixtures.update.mockReset();
  fixtures.error.mockReset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(KEY, record());
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

function cached() {
  return client.getQueryData<UserStateRecord>(KEY)!;
}

async function start(mutation: SettingsMutation, input: UpdateUserStateInput) {
  let promise!: ReturnType<SettingsMutation['mutateAsync']>;
  await act(async () => {
    promise = mutation.mutateAsync(input);
    // A request may fail before the test awaits it. Keep the original promise
    // available for assertions while preventing an unhandled rejection.
    void promise.catch(() => {});
  });
  return { promise };
}

describe('useUpdateUserState', () => {
  it('merges unrelated concurrent changes and waits for both writes before refreshing', async () => {
    const instructionsWrite = deferred<UserStateRecord>();
    const nameWrite = deferred<UserStateRecord>();
    fixtures.update.mockReturnValueOnce(instructionsWrite.promise).mockReturnValueOnce(nameWrite.promise);
    const instructions = await start(first, { workResultGuidance: 'Include finished-work links.' });
    const name = await start(second, { name: 'New name' });
    expect(cached()).toMatchObject({
      workResultGuidance: 'Include finished-work links.',
      name: 'New name',
      description: 'Original profile',
    });

    await act(async () => {
      // The first response still contains the original name because the second
      // write has not reached the server. It cannot replace the newer choice.
      instructionsWrite.resolve(record({ workResultGuidance: 'Include finished-work links.' }));
      await instructions.promise;
    });
    expect(cached().name).toBe('New name');
    expect(fixtures.get).not.toHaveBeenCalled();

    const settled = record({ workResultGuidance: 'Include finished-work links.', name: 'New name' });
    await act(async () => { nameWrite.resolve(settled); await name.promise; });
    expect(fixtures.get).toHaveBeenCalledOnce();
    await act(async () => { reads[0].resolve(settled); });
    expect(cached()).toEqual(settled);
  });

  it('restores failed fields while retaining a later unrelated successful choice', async () => {
    const instructionsWrite = deferred<UserStateRecord>();
    const nameWrite = deferred<UserStateRecord>();
    fixtures.update.mockReturnValueOnce(instructionsWrite.promise).mockReturnValueOnce(nameWrite.promise);
    const instructions = await start(first, { workResultGuidance: 'This save will fail.', description: 'New profile' });
    const name = await start(second, { name: 'Later name' });
    await act(async () => { nameWrite.resolve(record({ name: 'Later name' })); await name.promise; });
    const failure = new Error('Offline');
    await act(async () => {
      instructionsWrite.reject(failure);
      await expect(instructions.promise).rejects.toBe(failure);
    });
    expect(cached()).toMatchObject({
      workResultGuidance: 'Original guidance',
      description: 'Original profile',
      name: 'Later name',
    });
    expect(fixtures.error).toHaveBeenCalledExactlyOnceWith('Could not save settings. Try again.');
  });

  it('preserves a newer same-field choice when the older request fails', async () => {
    const earlierWrite = deferred<UserStateRecord>();
    const laterWrite = deferred<UserStateRecord>();
    fixtures.update.mockReturnValueOnce(earlierWrite.promise).mockReturnValueOnce(laterWrite.promise);
    const earlier = await start(first, { name: 'Intermediate name' });
    const later = await start(second, { name: 'Final name' });
    const failure = new Error('First write failed');
    await act(async () => { earlierWrite.reject(failure); await expect(earlier.promise).rejects.toBe(failure); });
    expect(cached().name).toBe('Final name');
    expect(fixtures.get).not.toHaveBeenCalled();
    await act(async () => { laterWrite.resolve(record({ name: 'Final name' })); await later.promise; });
    expect(cached().name).toBe('Final name');
  });

  it('preserves a newer successful choice even when it repeats the failed write value', async () => {
    const earlierWrite = deferred<UserStateRecord>();
    const laterWrite = deferred<UserStateRecord>();
    fixtures.update.mockReturnValueOnce(earlierWrite.promise).mockReturnValueOnce(laterWrite.promise);
    const earlier = await start(first, { voiceAutoSend: true });
    const later = await start(second, { voiceAutoSend: true });
    await act(async () => { laterWrite.resolve(record({ voiceAutoSend: true })); await later.promise; });
    const failure = new Error('Earlier write failed');
    await act(async () => { earlierWrite.reject(failure); await expect(earlier.promise).rejects.toBe(failure); });
    expect(cached().voiceAutoSend).toBe(true);
  });

  it('resolves mutateAsync while the background settings refresh remains pending', async () => {
    const write = deferred<UserStateRecord>();
    fixtures.update.mockReturnValueOnce(write.promise);
    const save = await start(first, { workResultGuidance: null });
    const saved = record({ workResultGuidance: null });
    let acknowledged: UserStateRecord | undefined;
    await act(async () => {
      write.resolve(saved);
      acknowledged = await save.promise;
    });
    expect(acknowledged).toEqual(saved);
    expect(fixtures.get).toHaveBeenCalledOnce();
    expect(client.isFetching({ queryKey: KEY })).toBe(1);
    expect(cached().workResultGuidance).toBeNull();
    await act(async () => { reads[0].resolve(saved); });
    expect(client.isFetching({ queryKey: KEY })).toBe(0);
  });
});
