import { expect, it, vi } from 'vitest';
import type { DesktopDeviceSettingsStatus } from '../src/lib/client/desktop-device-settings';
import { deviceSettingsAction, deviceSettingsRequests } from './device-settings';

const state: DesktopDeviceSettingsStatus = {
  role: 'viewer', appVersion: '0.1.0', home: { name: 'My Ri', hostName: 'Mini' },
  serviceAvailable: true, startsAtLogin: false, preferences: null,
  update: { phase: 'idle', configured: false },
};
function fixture(local = false) {
  const deps = { local: () => local, status: vi.fn(async () => state), request: vi.fn(async () => ({})),
    openConnection: vi.fn(async () => {}), confirm: vi.fn(async () => true) };
  return { ...deps, run: deviceSettingsRequests(deps) };
}

it.each([null, [], 'status', {}, { type: 'create-home' }, { type: 'connect', pairingLink: 'secret' },
  { type: 'enable-worker', consent: true }, { type: 'preferences', value: { type: 'login', enabled: true, path: '/tmp' } },
  { type: 'login', enabled: 'yes' }, { type: 'update-apply', force: true }, { type: 'exec', command: 'anything' },
])('rejects requests outside the fixed local controls: %j', input => {
  expect(() => deviceSettingsAction(input)).toThrow('Invalid desktop');
});

it('reads status and checks updates without changing local consent', async () => {
  const f = fixture();
  expect(await f.run({ type: 'status' })).toEqual(state);
  expect(f.request).not.toHaveBeenCalled();
  await f.run({ type: 'update-check' });
  expect(f.request).toHaveBeenCalledExactlyOnceWith('update-check');
  expect(f.confirm).not.toHaveBeenCalled();
});

it.each([
  { type: 'resume-worker' }, { type: 'login', enabled: true }, { type: 'update-apply' },
  { type: 'preferences', value: { type: 'shortcut', enabled: true, accelerator: 'CommandOrControl+K' } },
])('a remote Home cannot authorize a local change: %j', async action => {
  const f = fixture();
  f.confirm.mockResolvedValue(false);
  expect(await f.run(action)).toEqual(state);
  expect(f.request).not.toHaveBeenCalled();
  f.confirm.mockResolvedValue(true);
  await f.run(action);
  expect(f.request).toHaveBeenCalledOnce();
});

it('reuses the existing local enrollment and stop actions, with their native dialogs', async () => {
  const f = fixture();
  await f.run({ type: 'enable-worker' });
  await f.run({ type: 'stop-worker' });
  expect(f.request.mock.calls).toEqual([['enable-worker'], ['stop-worker']]);
  expect(f.confirm).not.toHaveBeenCalled();
});

it('keeps preferences and connection routing distinct from arbitrary companion actions', async () => {
  const f = fixture(true);
  await f.run({ type: 'preferences', value: { type: 'login', enabled: false } });
  expect(f.request).toHaveBeenLastCalledWith('preferences', { type: 'login', enabled: false });
  await f.run({ type: 'login', enabled: true });
  expect(f.request).toHaveBeenLastCalledWith('login', { enabled: true });
  await f.run({ type: 'connection' });
  expect(f.openConnection).toHaveBeenCalledOnce();
  expect(f.confirm).not.toHaveBeenCalled();
});

it('allows status while a native decision is pending and refuses a second mutation', async () => {
  const f = fixture();
  let answer!: (value: boolean) => void;
  f.confirm.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  const pending = f.run({ type: 'resume-worker' });
  await expect(f.run({ type: 'login', enabled: true })).rejects.toThrow('Wait for');
  expect(await f.run({ type: 'status' })).toEqual(state);
  answer(false); await pending;
  await f.run({ type: 'update-check' });
  expect(f.request).toHaveBeenCalledExactlyOnceWith('update-check');
});
