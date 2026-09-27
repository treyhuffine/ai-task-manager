import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  return {
    native: Object.assign(new EventEmitter(), { checkForUpdates: vi.fn() }),
    updater: Object.assign(new EventEmitter(), { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() }),
    dialog: { showMessageBox: vi.fn(), showErrorBox: vi.fn() },
    checkRelease: vi.fn(),
  };
});
vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '1.0.0' }, autoUpdater: mocks.native, dialog: mocks.dialog }));
vi.mock('electron-updater', () => ({ autoUpdater: mocks.updater }));
vi.mock('../src/lib/service/release-trust', () => ({ checkRelease: mocks.checkRelease, releasePolicy: () => ({}) }));
import { updateDesktop } from './shell-update';

const release = { version: '1.0.1', channel: 'stable', notes: 'Update', shell: { url: 'https://releases.example/Ri.zip', sha512: 'digest', size: 100 } };
const window = { setProgressBar: vi.fn(), isDestroyed: () => false, webContents: { send: vi.fn() } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('process', { ...process, platform: 'darwin' });
  mocks.native.removeAllListeners();
  mocks.updater.removeAllListeners();
  mocks.dialog.showMessageBox.mockResolvedValue({ response: 0 });
  mocks.checkRelease.mockResolvedValue(release);
  mocks.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: release.version, files: [release.shell] } });
  mocks.updater.downloadUpdate.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

it('does not resume editing or tear down the viewer during asynchronous native staging', async () => {
  const prepare = vi.fn().mockResolvedValue(true);
  const commit = vi.fn();
  const pending = updateDesktop(window as unknown as BrowserWindow, prepare, commit);
  await vi.waitFor(() => expect(mocks.native.checkForUpdates).toHaveBeenCalledOnce());
  expect(commit).not.toHaveBeenCalled();
  expect(window.webContents.send).not.toHaveBeenCalled();
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
  mocks.native.emit('update-downloaded');
  await vi.waitFor(() => expect(mocks.updater.quitAndInstall).toHaveBeenCalledOnce());
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(commit).not.toHaveBeenCalled();
  expect(window.webContents.send).not.toHaveBeenCalled();
  mocks.native.emit('before-quit-for-update');
  await pending;
  expect(commit).toHaveBeenCalledOnce();
  expect(window.webContents.send).not.toHaveBeenCalled();
});

it('resumes the intact viewer when Squirrel rejects the staged app', async () => {
  const commit = vi.fn();
  const pending = updateDesktop(window as unknown as BrowserWindow, async () => true, commit);
  await vi.waitFor(() => expect(mocks.native.checkForUpdates).toHaveBeenCalledOnce());
  mocks.native.emit('error', new Error('Code signature rejected'));
  await pending;
  expect(commit).not.toHaveBeenCalled();
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
  expect(mocks.dialog.showErrorBox).toHaveBeenCalledWith('Desktop update', 'Code signature rejected');
  expect(window.webContents.send).toHaveBeenCalledWith('desktop:resume');
  expect(mocks.native.listenerCount('update-downloaded')).toBe(0);
});

it('passes only the signed artifact into the downloader, removing unsigned selection metadata', async () => {
  const info = { version: release.version, files: [
    { ...release.shell, sha2: 'unsigned-secondary-hash' },
    { url: 'https://attacker.example/arm64.bin', sha512: 'unsigned', size: 50 },
  ], packages: { arm64: { path: 'https://attacker.example/package' } } };
  mocks.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: info });
  mocks.native.checkForUpdates.mockImplementationOnce(() => mocks.native.emit('update-downloaded'));
  mocks.updater.quitAndInstall.mockImplementationOnce(() => mocks.native.emit('before-quit-for-update'));
  await updateDesktop(window as unknown as BrowserWindow, async () => true, vi.fn());
  expect(info.files).toEqual([release.shell]);
  expect(info).not.toHaveProperty('packages');
  expect(mocks.updater.downloadUpdate).toHaveBeenCalledOnce();
});

it('does not reuse a previous download when the native updater rejects a downgrade', async () => {
  mocks.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false, updateInfo: { version: release.version, files: [release.shell] } });
  await updateDesktop(window as unknown as BrowserWindow, async () => true, vi.fn());
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled();
  expect(mocks.native.checkForUpdates).not.toHaveBeenCalled();
});

it.each(['withdrawn', 'expired'])('refreshes eligibility after downloading and refuses %s metadata before native staging', async reason => {
  mocks.checkRelease.mockResolvedValueOnce(release).mockRejectedValueOnce(new Error(`Release metadata ${reason}`));
  const commit = vi.fn();
  await updateDesktop(window as unknown as BrowserWindow, async () => true, commit);
  expect(mocks.updater.downloadUpdate).toHaveBeenCalledOnce();
  expect(mocks.checkRelease).toHaveBeenCalledTimes(2);
  expect(mocks.native.checkForUpdates).not.toHaveBeenCalled();
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(window.webContents.send).toHaveBeenCalledWith('desktop:resume');
});

it.each([
  { ...release, version: '1.0.2' },
  { ...release, shell: { ...release.shell, sha512: 'replacement-digest' } },
  { ...release, shell: { ...release.shell, url: 'https://releases.example/replaced.zip' } },
  { ...release, shell: { ...release.shell, size: 101 } },
])('refuses a changed publisher release after download', async current => {
  mocks.checkRelease.mockResolvedValueOnce(release).mockResolvedValueOnce(current);
  await updateDesktop(window as unknown as BrowserWindow, async () => true, vi.fn());
  expect(mocks.updater.downloadUpdate).toHaveBeenCalledOnce();
  expect(mocks.native.checkForUpdates).not.toHaveBeenCalled();
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
  expect(mocks.dialog.showErrorBox).toHaveBeenCalledWith('Desktop update', expect.stringContaining('publisher changed'));
});

it('refreshes eligibility again before an explicit native quit after staging', async () => {
  mocks.checkRelease.mockResolvedValueOnce(release).mockResolvedValueOnce(release).mockRejectedValueOnce(new Error('Release withdrawn after staging'));
  mocks.native.checkForUpdates.mockImplementationOnce(() => mocks.native.emit('update-downloaded'));
  const commit = vi.fn();
  await updateDesktop(window as unknown as BrowserWindow, async () => true, commit);
  expect(mocks.native.checkForUpdates).toHaveBeenCalledOnce();
  expect(mocks.checkRelease).toHaveBeenCalledTimes(3);
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(window.webContents.send).toHaveBeenCalledWith('desktop:resume');
});

it('also refreshes Linux eligibility after downloading and before AppImage installation', async () => {
  vi.stubGlobal('process', { ...process, platform: 'linux' });
  const linuxRelease = { ...release, shell: { ...release.shell, url: 'https://releases.example/Ri.AppImage' } };
  mocks.checkRelease.mockResolvedValueOnce(linuxRelease).mockRejectedValueOnce(new Error('Release expired during download'));
  mocks.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: release.version, files: [linuxRelease.shell] } });
  const commit = vi.fn();
  await updateDesktop(window as unknown as BrowserWindow, async () => true, commit);
  expect(mocks.updater.downloadUpdate).toHaveBeenCalledOnce();
  expect(mocks.checkRelease).toHaveBeenCalledTimes(2);
  expect(mocks.native.checkForUpdates).not.toHaveBeenCalled();
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});
