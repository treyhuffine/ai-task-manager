import { expect, it } from 'vitest';
import { eligibleShellFile } from './shell-trust';
import type { Release } from '../src/lib/service/release-trust';
import { findFile, resolveFiles } from 'electron-updater/out/providers/Provider';
import { AppUpdater } from 'electron-updater/out/AppUpdater';
const filename = process.platform === 'darwin' ? 'Ri.zip' : 'Ri.AppImage';
const release = { shell: { url: `https://releases.example/${filename}`, sha512: 'signed-digest', size: 100 } } as Release;
it('accepts exactly the desktop artifact authenticated by the publisher', () => {
  expect(() => eligibleShellFile(release, [{ url: filename, sha512: 'signed-digest', size: 100 }])).not.toThrow();
});
it.each([
  [{ url: `https://another.example/${filename}`, sha512: 'signed-digest', size: 100 }],
  [{ url: filename, sha512: 'attacker-digest', size: 100 }],
  [{ url: filename, sha512: 'signed-digest', size: 101 }],
  [{ url: filename, sha512: 'signed-digest', size: 100 }, { url: `other-${filename}`, sha512: 'other', size: 100 }],
])('rejects substituted or ambiguous desktop artifacts %j', (...files) => {
  expect(() => eligibleShellFile(release, files)).toThrow();
});
it('rejects case-variant artifacts that the native updater also considers eligible', () => {
  for (const [platform, extension] of [['darwin', 'zip'], ['linux', 'AppImage']] as const) {
    const signed = { shell: { url: `https://releases.example/Ri.${extension}`, sha512: 'signed-digest', size: 100 } } as Release;
    expect(() => eligibleShellFile(signed, [signed.shell!, { url: `Ri-${process.arch}.${extension.toUpperCase()}`, sha512: 'unsigned-digest', size: 50 }], platform)).toThrow('Unexpected');
  }
});

it('blocks the pinned Linux resolver from preferring an unsigned case-variant file', () => {
  const signed = { shell: { url: 'https://releases.example/Ri.AppImage', sha512: 'signed-digest', size: 100 } } as Release;
  const attack = { url: `https://attacker.example/Ri-${process.arch}.appimage`, sha512: 'unsigned-digest', size: 50 };
  const info = { version: '1.0.1', releaseDate: new Date().toISOString(), path: signed.shell!.url, sha512: signed.shell!.sha512, files: [signed.shell!, attack] };
  expect(findFile(resolveFiles(info, new URL('https://releases.example/')), 'AppImage')?.url.href).toBe(attack.url);
  expect(() => eligibleShellFile(signed, info.files, 'linux')).toThrow('Unexpected');
});

it('pins the updater contract that returned metadata is the downloader retained object', async () => {
  // Exercise the installed implementation without creating an Electron app or
  // using a network provider. A future updater change must preserve this
  // identity or the authenticated file replacement must move to its new API.
  const info = { version: '1.0.1', releaseDate: new Date().toISOString(), files: [release.shell!] };
  const instance = Object.assign(Object.create(AppUpdater.prototype), {
    emit: () => {}, getUpdateInfoAndProvider: async () => ({ info, provider: {} }),
    isUpdateAvailable: async () => true, onUpdateAvailable: () => {}, autoDownload: false,
  }) as { doCheckForUpdates(): Promise<{ updateInfo: typeof info }>; updateInfoAndProvider: { info: typeof info } };
  const result = await instance.doCheckForUpdates();
  expect(result.updateInfo).toBe(instance.updateInfoAndProvider.info);
  result.updateInfo.files = [eligibleShellFile(release, result.updateInfo.files)];
  expect(instance.updateInfoAndProvider.info.files).toEqual([release.shell]);
});
