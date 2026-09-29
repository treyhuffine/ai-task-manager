import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopLogin, loginExecArgument } from './login';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function application() {
  const settings = { openAtLogin: false, wasOpenedAtLogin: false, status: 'not-registered' as 'enabled' | 'not-registered' | 'requires-approval' | 'not-found' };
  const app = {
    isPackaged: true,
    getLoginItemSettings: vi.fn(() => ({ ...settings })),
    setLoginItemSettings: vi.fn(({ openAtLogin }: { openAtLogin?: boolean }) => { settings.openAtLogin = !!openAtLogin; settings.status = openAtLogin ? 'enabled' : 'not-registered'; }),
  };
  return { app, settings };
}
function linux(name = 'Ri.AppImage') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-desktop-login-')); dirs.push(dir);
  const executable = path.join(dir, name); fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const configHome = path.join(dir, 'xdg');
  const file = path.join(configHome, 'autostart/app.ri.desktop.autostart.desktop');
  const { app } = application();
  const options = { app, platform: 'linux' as const, executable, appImage: '', home: dir, configHome };
  return { dir, file, executable, app, options, login: createDesktopLogin(options) };
}

describe('macOS desktop login', () => {
  it('uses the main application login service and reads actual state after each change', () => {
    const { app, settings } = application(); const login = createDesktopLogin({ app, platform: 'darwin' });
    expect(login.status()).toMatchObject({ supported: true, enabled: false, state: 'disabled' });
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
    expect(login.setEnabled(true)).toEqual({ supported: true, enabled: true, state: 'enabled' });
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true, type: 'mainAppService' });
    settings.openAtLogin = false; settings.status = 'not-registered';
    expect(login.status().enabled).toBe(false);
    expect(app.setLoginItemSettings).toHaveBeenCalledTimes(1);
    expect(login.setEnabled(false).state).toBe('disabled');
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false, type: 'mainAppService' });
    expect(app.getLoginItemSettings).toHaveBeenLastCalledWith({ type: 'mainAppService' });
  });

  it('reports required OS approval without claiming the application will launch', () => {
    const { app, settings } = application();
    app.setLoginItemSettings.mockImplementation(() => { settings.openAtLogin = true; settings.status = 'requires-approval'; });
    const login = createDesktopLogin({ app, platform: 'darwin' });
    expect(login.setEnabled(true)).toMatchObject({ supported: true, enabled: false, state: 'requires-approval', detail: expect.stringContaining('System Settings') });
  });

  it('reports silent registration failure and missing packages with the signing limitation', () => {
    const { app, settings } = application(); app.setLoginItemSettings.mockImplementation(() => {});
    const login = createDesktopLogin({ app, platform: 'darwin' });
    expect(login.setEnabled(true)).toMatchObject({ enabled: false, state: 'error', detail: expect.stringContaining('signed, and notarized') });
    settings.status = 'not-found';
    expect(login.status()).toMatchObject({ enabled: false, state: 'unavailable', detail: expect.stringContaining('could not locate') });
  });

  it('does not report disabled when macOS rejects removal', () => {
    const { app, settings } = application(); settings.status = 'enabled'; settings.openAtLogin = true;
    app.setLoginItemSettings.mockImplementation(() => {});
    const login = createDesktopLogin({ app, platform: 'darwin' });
    expect(login.setEnabled(false)).toMatchObject({ enabled: true, state: 'error', detail: expect.stringContaining('did not remove') });
  });

  it('refuses development registration and reports API errors without throwing into the UI', () => {
    const { app } = application(); app.isPackaged = false;
    const login = createDesktopLogin({ app, platform: 'darwin' });
    expect(login.setEnabled(true)).toMatchObject({ supported: false, enabled: false, state: 'unavailable' });
    expect(app.setLoginItemSettings).not.toHaveBeenCalled(); expect(app.getLoginItemSettings).not.toHaveBeenCalled();
    app.isPackaged = true; app.getLoginItemSettings.mockImplementation(() => { throw new Error('OS unavailable'); });
    expect(login.status()).toMatchObject({ state: 'error', detail: expect.stringContaining('OS unavailable') });
    app.setLoginItemSettings.mockImplementation(() => { throw new Error('Permission denied'); });
    expect(login.setEnabled(true)).toMatchObject({ state: 'error', detail: expect.stringContaining('Permission denied') });
  });
});

describe('Linux desktop autostart', () => {
  it('creates a separate quiet GUI entry with saved installation, then disables it without touching backend services', () => {
    const { login, file, app } = linux("Ri's cozy app.AppImage");
    expect(login.status()).toEqual({ supported: true, enabled: false, state: 'disabled' }); expect(fs.existsSync(file)).toBe(false);
    expect(login.setEnabled(true)).toEqual({ supported: true, enabled: true, state: 'enabled' });
    const contents = fs.readFileSync(file, 'utf8');
    expect(contents).toContain('--ri-background --ri-use-saved-installation');
    expect(contents).toContain('Hidden=false'); expect(contents).toContain('X-GNOME-Autostart-enabled=true');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(login.setEnabled(true).state).toBe('enabled'); expect(fs.readFileSync(file, 'utf8')).toBe(contents);
    expect(login.setEnabled(false)).toEqual({ supported: true, enabled: false, state: 'disabled' });
    expect(fs.readFileSync(file, 'utf8')).toContain('Hidden=true');
    expect(fs.readFileSync(file, 'utf8')).toContain('X-GNOME-Autostart-enabled=false');
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it('respects an OS-side Hidden or GNOME opt-out until explicitly enabled again', () => {
    const { login, file } = linux(); login.setEnabled(true);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Hidden=false', 'Hidden=true'));
    expect(login.status().state).toBe('disabled');
    expect(login.setEnabled(true).state).toBe('enabled');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('X-GNOME-Autostart-enabled=true', 'X-GNOME-Autostart-enabled=false'));
    expect(login.status().state).toBe('disabled');
    expect(login.setEnabled(true).state).toBe('enabled');
  });

  it('uses the durable AppImage instead of its transient mount executable', () => {
    const { options, executable, file } = linux();
    const login = createDesktopLogin({ ...options, executable: '/tmp/.mount_Ri123/usr/bin/ri', appImage: executable });
    expect(login.setEnabled(true).state).toBe('enabled');
    expect(fs.readFileSync(file, 'utf8')).toContain(`Exec="${executable}"`);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('.mount_');
    expect(createDesktopLogin({ ...options, executable: '/tmp/.mount_Ri123/usr/bin/ri' }).setEnabled(true)).toMatchObject({ supported: false, state: 'unavailable' });
  });

  it('refuses foreign, edited and symlink entries and leaves them byte-for-byte intact', () => {
    const { login, file, dir } = linux(); fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const contents of ['[Desktop Entry]\nExec=unrelated\n', 'malformed contents']) {
      fs.writeFileSync(file, contents);
      expect(login.status().state).toBe('conflict'); expect(login.setEnabled(true).state).toBe('conflict'); expect(login.setEnabled(false).state).toBe('conflict');
      expect(fs.readFileSync(file, 'utf8')).toBe(contents);
    }
    fs.unlinkSync(file); const target = path.join(dir, 'foreign'); fs.writeFileSync(target, 'other'); fs.symlinkSync(target, file);
    expect(login.setEnabled(true).state).toBe('conflict'); expect(login.setEnabled(false).state).toBe('conflict');
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(true); expect(fs.readFileSync(target, 'utf8')).toBe('other');
  });

  it('protects a different live installation but lets the user explicitly repair a moved package', () => {
    const { login, options, file, dir, executable } = linux(); login.setEnabled(true);
    const newExecutable = path.join(dir, 'New Ri.AppImage'); fs.copyFileSync(executable, newExecutable);
    const other = createDesktopLogin({ ...options, executable: newExecutable });
    const initial = fs.readFileSync(file, 'utf8');
    expect(other.status().state).toBe('conflict'); expect(other.setEnabled(true).state).toBe('conflict'); expect(other.setEnabled(false).state).toBe('conflict');
    expect(fs.readFileSync(file, 'utf8')).toBe(initial);
    fs.unlinkSync(executable);
    expect(other.status().state).toBe('moved'); expect(fs.readFileSync(file, 'utf8')).toBe(initial);
    expect(other.setEnabled(true).state).toBe('enabled'); expect(fs.readFileSync(file, 'utf8')).toContain(`Exec="${newExecutable}"`);
  });

  it('never rewrites a hard-linked entry and detects a launcher that lost executable permission', () => {
    const { login, executable, file, dir } = linux(); login.setEnabled(true);
    fs.chmodSync(executable, 0o600); expect(login.status()).toMatchObject({ enabled: false, state: 'error' });
    fs.chmodSync(executable, 0o700);
    fs.linkSync(file, path.join(dir, 'shared.desktop'));
    const contents = fs.readFileSync(file, 'utf8');
    expect(login.setEnabled(false).state).toBe('conflict'); expect(fs.readFileSync(file, 'utf8')).toBe(contents);
  });

  it('never claims success for a missing or non-executable app and refuses development registration', () => {
    const { login, executable, options, file } = linux(); fs.chmodSync(executable, 0o600);
    expect(login.setEnabled(true).state).toBe('error'); expect(fs.existsSync(file)).toBe(false);
    fs.unlinkSync(executable); expect(login.setEnabled(true).state).toBe('error'); expect(fs.existsSync(file)).toBe(false);
    options.app.isPackaged = false; expect(login.setEnabled(true).state).toBe('unavailable'); expect(fs.existsSync(file)).toBe(false);
  });

  it('ignores relative XDG_CONFIG_HOME and rejects unsafe launcher paths', () => {
    const { options, dir } = linux();
    const login = createDesktopLogin({ ...options, configHome: 'relative' });
    expect(login.setEnabled(true).state).toBe('enabled');
    expect(fs.existsSync(path.join(dir, '.config/autostart/app.ri.desktop.autostart.desktop'))).toBe(true);
    for (const executable of ['relative/path', '/apps/Ri=name', '/apps/Ri\nExec=bad']) {
      expect(createDesktopLogin({ ...options, executable }).setEnabled(true)).toMatchObject({ supported: false, state: 'unavailable' });
    }
  });

  it('quotes desktop Exec literals without shell expansion or extra arguments', () => {
    expect(loginExecArgument('/apps/Ri spaced %U.AppImage')).toBe('"/apps/Ri spaced %%U.AppImage"');
    for (const special of ['"', '$', '`']) expect([...loginExecArgument(special)]).toEqual(['"', '\\', '\\', special, '"']);
    expect([...loginExecArgument('\\')]).toEqual(['"', '\\', '\\', '\\', '\\', '"']);
    expect(() => loginExecArgument('/apps/Ri\nBad')).toThrow('control character');
  });
});

it('identifies explicit quiet and macOS login launches, but keeps ordinary launches visible', () => {
  const { app, settings } = application(); const login = createDesktopLogin({ app, platform: 'darwin' });
  expect(login.launchedInBackground(['ri'])).toBe(false);
  settings.wasOpenedAtLogin = true; expect(login.launchedInBackground(['ri'])).toBe(true);
  expect(login.launchedInBackground(['ri', '--ri-background'])).toBe(true);
  app.getLoginItemSettings.mockImplementation(() => { throw new Error('OS unavailable'); });
  expect(login.launchedInBackground(['ri'])).toBe(false);
  const linuxLogin = createDesktopLogin({ app, platform: 'linux' });
  expect(linuxLogin.launchedInBackground(['ri'])).toBe(false); expect(linuxLogin.launchedInBackground(['ri', '--ri-background'])).toBe(true);
  expect(createDesktopLogin({ app, platform: 'win32' }).setEnabled(true).supported).toBe(false);
});
