import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_COMPATIBILITY } from '@/lib/releases/compatibility';
import { homeCompatibilityReasons, recordWorkerCompatibility } from './update-compatibility';
const mocks = vi.hoisted(() => ({ ids: new Set(['laptop']), key: 'worker-key', commands: [] as object[], runs: [] as object[] }));
vi.mock('@/lib/db/queries', () => ({ listDevices: () => [{ id: 'laptop', name: 'MacBook', workerProtocol: 4 }], listEnrolledDeviceIds: () => mocks.ids,
  getWorkerKeyId: () => mocks.key, listWorkerCommands: () => mocks.commands, deliveredSendsWithOpenRuns: () => mocks.runs }));
beforeEach(() => { mocks.key = `key-${Math.random()}`; mocks.ids = new Set(['laptop']); mocks.commands = []; mocks.runs = []; });
const breaking = { ...CURRENT_COMPATIBILITY, workerProtocols: [5] };
const journal = { pendingEvents: 0, pendingCommands: 0, openTurns: 0, lastEvent: 12 };
it('allows compatible routine releases while a qualified laptop is offline', () => { recordWorkerCompatibility('laptop', mocks.key, {release:{version:'test',build:'test',source:'source'},compatibility:CURRENT_COMPATIBILITY}, journal, false); expect(homeCompatibilityReasons(CURRENT_COMPATIBILITY)).toEqual([]); });
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
  // The running release refuses it too, so this update strands nothing (below).
  expect(homeCompatibilityReasons(CURRENT_COMPATIBILITY, CURRENT_COMPATIBILITY)).toEqual([]);
});

describe('a computer the running release already refuses', () => {
  // Found live: an old desktop app on another Mac, missing a capability the
  // Home has required for weeks. Every request it made was refused and
  // recorded as not stopped, so it held every update waiting for a bridge.
  // Its report, as recorded on 2026-11-11.
  const old = { ...CURRENT_COMPATIBILITY, apiProtocols: [1], capabilities: ['worker.protocol4', 'durable-journals.v1', 'compatibility.v1', 'safe-update-pause.v1'], requiredCapabilities: ['worker.protocol4'] };
  beforeEach(() => recordWorkerCompatibility('laptop', mocks.key, { release: { version: '0.1.0', build: 'old', source: 'packaged' }, compatibility: old }, undefined, false, 4));

  it("doesn't hold an update that keeps everything the running release accepts", () => {
    expect(homeCompatibilityReasons(CURRENT_COMPATIBILITY, CURRENT_COMPATIBILITY)).toEqual([]);
  });

  it('still waits when work from this Home is out on it', () => {
    mocks.commands = [{}];
    expect(homeCompatibilityReasons(CURRENT_COMPATIBILITY, CURRENT_COMPATIBILITY)[0]).toMatch(/MacBook/);
    mocks.commands = []; mocks.runs = [{}];
    expect(homeCompatibilityReasons(CURRENT_COMPATIBILITY, CURRENT_COMPATIBILITY)[0]).toMatch(/MacBook/);
  });

  it('still waits when the update drops a protocol or journal format the running release accepts', () => {
    expect(homeCompatibilityReasons(breaking, CURRENT_COMPATIBILITY)[0]).toMatch(/MacBook/);
    const newerEvents = { ...CURRENT_COMPATIBILITY, journal: { ...CURRENT_COMPATIBILITY.journal, events: { read: [2], write: 2 } } };
    expect(homeCompatibilityReasons(newerEvents, CURRENT_COMPATIBILITY)[0]).toMatch(/MacBook/);
  });
});
