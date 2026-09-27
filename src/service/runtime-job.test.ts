import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Release } from '@/lib/service/release';
import type { RuntimeJobOwner } from '@/lib/service/runtime-job-owner';

const mocks = vi.hoisted(() => ({ download: vi.fn(), lease: vi.fn(), release: vi.fn() }));
vi.mock('@/lib/service/release', () => ({ downloadRelease: mocks.download }));
vi.mock('@/lib/service/runtime', () => ({ verifyRuntime: vi.fn() }));
vi.mock('@/lib/service/checkpoint', () => ({ createCheckpoint: vi.fn(), restoreCheckpointDatabase: vi.fn(), validateDatabase: vi.fn() }));
vi.mock('@/lib/service/runtime-job-owner', () => ({ acquireRuntimeJobLease: mocks.lease }));

let receive!: (message: { action: string; value: unknown; owner: RuntimeJobOwner }) => void;
const originalSend = process.send;
const send = vi.fn((_message: unknown, callback?: () => void) => { callback?.(); return true; });

beforeAll(async () => {
  vi.spyOn(process, 'once').mockImplementation((event, listener) => {
    if (event === 'message') receive = listener;
    return process;
  });
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  process.send = send as typeof process.send;
  mocks.lease.mockReturnValue(mocks.release);
  await import('./runtime-job');
});
afterAll(() => { process.send = originalSend; vi.restoreAllMocks(); });

it('forwards completed download bytes before archive validation even inside the throttle window', async () => {
  let finishValidation!: () => void;
  const validation = new Promise<void>(resolve => { finishValidation = resolve; });
  const requested = { runtime: { size: 468_000_000 } } as Release;
  let now = 10_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mocks.download.mockImplementation(async (_release: Release, progress: (bytes: number) => void) => {
    progress(16_246);
    now += 50;
    progress(200_000_000);
    now += 50;
    progress(requested.runtime.size);
    // downloadRelease continues verifying/unpacking the archive after the
    // network finishes. The controller must show full bytes during this wait.
    await validation;
  });
  const owner = { pid: 123, nonce: 'fixture' };
  receive({ action: 'download', value: requested, owner });
  expect(mocks.lease).toHaveBeenCalledExactlyOnceWith(owner);
  expect(send.mock.calls.map(([message]) => message)).toEqual([
    { type: 'progress', bytes: 16_246 },
    { type: 'progress', bytes: requested.runtime.size },
  ]);
  expect(mocks.release).not.toHaveBeenCalled();
  finishValidation();
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'result', value: null }, expect.any(Function)));
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(process.exit).toHaveBeenCalledExactlyOnceWith(0);
});
