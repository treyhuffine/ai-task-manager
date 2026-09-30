import { beforeEach, expect, it, vi } from 'vitest';
import { CURRENT_COMPATIBILITY } from '@/lib/releases/compatibility';
import { homeCompatibilityReasons, recordWorkerCompatibility } from './update-compatibility';
const mocks = vi.hoisted(() => ({ ids: new Set(['laptop']), key: 'worker-key', commands: [] as object[], runs: [] as object[] }));
vi.mock('@/lib/db/queries', () => ({ listDevices: () => [{ id: 'laptop', name: 'MacBook', workerProtocol: 4 }], listEnrolledDeviceIds: () => mocks.ids,
  getWorkerKeyId: () => mocks.key, listWorkerCommands: () => mocks.commands, deliveredSendsWithOpenRuns: () => mocks.runs }));
beforeEach(() => { mocks.key = `key-${Math.random()}`; mocks.ids = new Set(['laptop']); mocks.commands = []; mocks.runs = []; });
const breaking = { ...CURRENT_COMPATIBILITY, workerProtocols: [5] };
const journal = { pendingEvents: 0, pendingCommands: 0, openTurns: 0, lastEvent: 12 };
it('allows compatible routine releases while the laptop is offline', () => { expect(homeCompatibilityReasons(CURRENT_COMPATIBILITY)).toEqual([]); });
it('requires bridge metadata only when the Home has enrolled workers', () => {
  expect(homeCompatibilityReasons(null)[0]).toMatch(/bridge/);
  mocks.ids.clear(); expect(homeCompatibilityReasons(null)).toEqual([]);
});
it('keeps unknown/offline work blocked for an incompatible Home release', () => { expect(homeCompatibilityReasons(breaking)[0]).toMatch(/MacBook/); });
it('permits a proven stopped, empty worker to return update-required later', () => {
  recordWorkerCompatibility('laptop', mocks.key, undefined, journal, true);
  expect(homeCompatibilityReasons(breaking)).toEqual([]);
  mocks.runs = [{}]; expect(homeCompatibilityReasons(breaking)[0]).toMatch(/MacBook/);
});
it('does not forget pending journals or trust a prior enrollment after restart', () => {
  recordWorkerCompatibility('laptop', mocks.key, undefined, { ...journal, pendingEvents: 2 }, true);
  expect(homeCompatibilityReasons(breaking)).toHaveLength(1);
  recordWorkerCompatibility('laptop', mocks.key, undefined, journal, true);
  mocks.key = 're-enrolled'; expect(homeCompatibilityReasons(breaking)).toHaveLength(1);
});

it('retains an incompatible legacy protocol report instead of showing its prior version as compatible', async () => {
  const { workerCompatibilityView } = await import('./update-compatibility');
  recordWorkerCompatibility('laptop', mocks.key, undefined, undefined, false, 99);
  expect(workerCompatibilityView('laptop', 'MacBook', 4)).toMatchObject({ state: 'update-required', update: 'home' });
  expect(homeCompatibilityReasons(CURRENT_COMPATIBILITY)).toHaveLength(1);
});
