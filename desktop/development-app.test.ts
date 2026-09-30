import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { developmentExecutable } from './development-app.mjs';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));

function fixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-desktop-name-'));
  directories.push(repo);
  const bundle = path.join(repo, 'node_modules/electron/dist/Electron.app');
  const electron = path.join(bundle, 'Contents/MacOS/Electron');
  fs.mkdirSync(path.dirname(electron), { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Contents/Resources'), { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Contents/Frameworks'), { recursive: true });
  fs.writeFileSync(electron, 'binary');
  fs.writeFileSync(path.join(bundle, 'Contents/Info.plist'), 'original plist');
  fs.writeFileSync(path.join(bundle, 'Contents/Resources/default_app.asar'), 'source Electron entrypoint');
  fs.writeFileSync(path.join(bundle, 'Contents/Resources/electron.icns'), 'original icon');
  fs.symlinkSync('../MacOS/Electron', path.join(bundle, 'Contents/Frameworks/link'));
  fs.mkdirSync(path.join(repo, 'assets/brand/icons'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'assets/brand/icons/icon.icns'), 'Ri icon');
  return { repo, electron, bundle };
}

it('uses the stock executable on other platforms without inspecting macOS files', () => {
  const run = vi.fn();
  expect(developmentExecutable({ electron: '/missing/electron', repo: '/missing/repo', platform: 'linux', run })).toBe('/missing/electron');
  expect(run).not.toHaveBeenCalled();
});

it('brands a separate source-mode macOS bundle and signs it after changing metadata', () => {
  const { repo, electron, bundle } = fixture();
  const run = vi.fn();
  const output = developmentExecutable({ electron, repo, platform: 'darwin', run });
  expect(output).toContain('/.electron-demo/development-shell/');
  expect(output).toMatch(/Ri Demo\.app\/Contents\/MacOS\/Electron$/);
  const copy = path.dirname(path.dirname(output));
  expect(fs.readFileSync(path.join(copy, 'Resources/default_app.asar'), 'utf8')).toBe('source Electron entrypoint');
  expect(fs.readFileSync(path.join(copy, 'Resources/electron.icns'), 'utf8')).toBe('Ri icon');
  expect(fs.readlinkSync(path.join(copy, 'Frameworks/link'))).toBe('../MacOS/Electron');
  expect(fs.readFileSync(path.join(bundle, 'Contents/Info.plist'), 'utf8')).toBe('original plist');
  expect(fs.readFileSync(path.join(bundle, 'Contents/Resources/electron.icns'), 'utf8')).toBe('original icon');
  expect(run.mock.calls.slice(0, 3).map(call => call[1].slice(0, 4))).toEqual([
    ['-replace', 'CFBundleName', '-string', 'Ri Demo'],
    ['-replace', 'CFBundleDisplayName', '-string', 'Ri Demo'],
    ['-replace', 'CFBundleIdentifier', '-string', expect.stringMatching(/^app\.ri\.desktop\.demo\.[a-f0-9]{16}$/)],
  ]);
  expect(run.mock.calls.slice(-2).map(call => [call[0], ...call[1].slice(0, -1)])).toEqual([
    ['/usr/bin/codesign', '--force', '--sign', '-'], ['/usr/bin/codesign', '--verify', '--strict'],
  ]);
  run.mockClear();
  expect(developmentExecutable({ electron, repo, platform: 'darwin', run })).toBe(output);
  expect(run).not.toHaveBeenCalled();
});

it('rebuilds the cached bundle when Electron or the Ri icon changes', () => {
  const { repo, electron, bundle } = fixture();
  const options = { electron, repo, platform: 'darwin' as const, run: vi.fn() };
  const first = developmentExecutable(options);
  fs.writeFileSync(path.join(bundle, 'Contents/Info.plist'), 'next Electron version');
  const second = developmentExecutable(options);
  fs.writeFileSync(path.join(repo, 'assets/brand/icons/icon.icns'), 'updated Ri icon');
  const third = developmentExecutable(options);
  expect(new Set([first, second, third]).size).toBe(3);
});

it('does not publish or keep an incompletely signed bundle after failure', () => {
  const { repo, electron } = fixture();
  const run = vi.fn((command: string) => { if (command.endsWith('codesign')) throw new Error('signing failed'); });
  expect(() => developmentExecutable({ electron, repo, platform: 'darwin', run })).toThrow('signing failed');
  expect(fs.readdirSync(path.join(repo, '.electron-demo/development-shell'))).toEqual([]);
});
