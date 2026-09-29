import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DESKTOP_PORTAL_ID, ensureDesktopPortalIdentity } from './portal';
import { loginExecArgument } from './login';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(name = 'Ri.AppImage') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-portal-')); roots.push(root);
  const executable = path.join(root, name); fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const dataHome = path.join(root, 'data');
  const file = path.join(dataHome, 'applications', DESKTOP_PORTAL_ID);
  const options = { executable, appImage: '', home: root, dataHome, dataDirs: [] as string[], pathEnv: root, platform: 'linux' as const, wayland: true };
  return { root, executable, dataHome, file, options };
}
function installed(file: string, executable: string, extra = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = `[Desktop Entry]\nType=Application\nName=Ri\nExec=${loginExecArgument(executable)} %U\n${extra}`;
  fs.writeFileSync(file, content);
  return content;
}

it('installs one private portal identity and performs no autostart integration', () => {
  const { options, file, root } = fixture();
  ensureDesktopPortalIdentity(options);
  const content = fs.readFileSync(file, 'utf8');
  expect(content).toContain('Name=Ri\n'); expect(content).toContain('NoDisplay=true\n');
  expect(content).toContain('--ri-use-saved-installation'); expect(content).not.toContain('--ri-background');
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  const modified = fs.statSync(file).mtimeMs;
  ensureDesktopPortalIdentity(options);
  expect(fs.readFileSync(file, 'utf8')).toBe(content); expect(fs.statSync(file).mtimeMs).toBe(modified);
  expect(fs.existsSync(path.join(root, '.config'))).toBe(false);
});

it('uses the stable AppImage path and handles spaces, quotes, shell characters and literal field codes', () => {
  const { options, executable, file } = fixture('Ri "quote" $`x` \\ %U.AppImage');
  const launch = { ...options, executable: '/tmp/.mount_Ri123/AppRun', appImage: executable };
  ensureDesktopPortalIdentity(launch);
  const content = fs.readFileSync(file, 'utf8');
  expect(content).toContain(`Exec=${loginExecArgument(executable)} --ri-use-saved-installation`);
  expect(content).not.toContain('.mount_');
  ensureDesktopPortalIdentity(launch);
  expect(fs.readFileSync(file, 'utf8')).toBe(content);
});

it('preserves a matching package-manager desktop entry verbatim without taking ownership', () => {
  const { options, executable, file } = fixture();
  const content = installed(file, executable, 'Icon=vendor-icon\nCategories=Office;\n');
  const modified = fs.statSync(file).mtimeMs;
  ensureDesktopPortalIdentity(options);
  expect(fs.readFileSync(file, 'utf8')).toBe(content); expect(fs.statSync(file).mtimeMs).toBe(modified);
});

it('uses a matching system entry and does not create a higher-priority private override', () => {
  const { options, root, executable, file } = fixture();
  const system = path.join(root, 'system'); const globalFile = path.join(system, 'applications', DESKTOP_PORTAL_ID);
  const content = installed(globalFile, executable);
  ensureDesktopPortalIdentity({ ...options, dataDirs: [system] });
  expect(fs.existsSync(file)).toBe(false); expect(fs.readFileSync(globalFile, 'utf8')).toBe(content);
});

it('resolves installed bare executable names through PATH and respects TryExec', () => {
  const { options, file } = fixture('ri');
  installed(file, 'ri', 'TryExec=ri\n');
  expect(() => ensureDesktopPortalIdentity(options)).not.toThrow();
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('TryExec=ri', 'TryExec=missing'));
  expect(() => ensureDesktopPortalIdentity(options)).toThrow('left unchanged');
});

it('does not overwrite a foreign private entry or shadow a different system installation', () => {
  const { options, root, executable, file } = fixture();
  const other = path.join(root, 'OtherRi'); fs.copyFileSync(executable, other);
  const foreign = installed(file, other);
  expect(() => ensureDesktopPortalIdentity(options)).toThrow('another installation');
  expect(fs.readFileSync(file, 'utf8')).toBe(foreign);
  fs.unlinkSync(file);
  const system = path.join(root, 'system'); const globalFile = path.join(system, 'applications', DESKTOP_PORTAL_ID);
  installed(globalFile, other);
  expect(() => ensureDesktopPortalIdentity({ ...options, dataDirs: [system] })).toThrow('another installation');
  expect(fs.existsSync(file)).toBe(false);
});

it('refuses a disabled or malformed installed entry instead of claiming portal readiness', () => {
  const { options, executable, file } = fixture();
  for (const extra of ['Hidden=true\n', 'DBusActivatable=true\n', 'Exec=/different\n']) {
    const content = installed(file, executable, extra);
    expect(() => ensureDesktopPortalIdentity(options)).toThrow('left unchanged');
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
  }
  for (const content of ['[Desktop Entry]\nExec=bad\n', '[Desktop Entry]\nType=Application\nName=Ri\nExec="unterminated\n']) {
    fs.writeFileSync(file, content);
    expect(() => ensureDesktopPortalIdentity(options)).toThrow('left unchanged');
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
  }
});

it('repairs its own moved AppImage but never takes over another live copy', () => {
  const { options, executable, root, file } = fixture(); ensureDesktopPortalIdentity(options);
  const original = fs.readFileSync(file, 'utf8');
  const moved = path.join(root, 'Moved Ri.AppImage'); fs.copyFileSync(executable, moved);
  expect(() => ensureDesktopPortalIdentity({ ...options, executable: moved })).toThrow('another installation');
  expect(fs.readFileSync(file, 'utf8')).toBe(original);
  fs.unlinkSync(executable);
  ensureDesktopPortalIdentity({ ...options, executable: moved });
  expect(fs.readFileSync(file, 'utf8')).toContain(`Exec=${loginExecArgument(moved)}`);
});

it('refuses repairing linked owned files and preserves all linked bytes', () => {
  const { options, executable, root, file } = fixture(); ensureDesktopPortalIdentity(options);
  const original = fs.readFileSync(file, 'utf8'); const moved = path.join(root, 'Moved'); fs.renameSync(executable, moved);
  const linked = path.join(root, 'linked.desktop'); fs.linkSync(file, linked);
  expect(() => ensureDesktopPortalIdentity({ ...options, executable: moved })).toThrow('left unchanged');
  expect(fs.readFileSync(linked, 'utf8')).toBe(original);
  fs.unlinkSync(file); fs.symlinkSync(linked, file);
  expect(() => ensureDesktopPortalIdentity({ ...options, executable: moved })).toThrow('left unchanged');
  expect(fs.lstatSync(file).isSymbolicLink()).toBe(true); expect(fs.readFileSync(linked, 'utf8')).toBe(original);
});

it('leaves dangling links and directories in place', () => {
  const { options, root, file } = fixture(); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(path.join(root, 'missing'), file);
  expect(() => ensureDesktopPortalIdentity(options)).toThrow('left unchanged'); expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
  fs.unlinkSync(file); fs.mkdirSync(file);
  expect(() => ensureDesktopPortalIdentity(options)).toThrow('left unchanged'); expect(fs.statSync(file).isDirectory()).toBe(true);
});

it('uses default data home for a relative XDG override and does nothing outside Linux Wayland', () => {
  const { options, root } = fixture();
  ensureDesktopPortalIdentity({ ...options, dataHome: 'relative', platform: 'darwin' });
  ensureDesktopPortalIdentity({ ...options, dataHome: 'relative', wayland: false });
  const file = path.join(root, '.local/share/applications', DESKTOP_PORTAL_ID);
  expect(fs.existsSync(file)).toBe(false);
  ensureDesktopPortalIdentity({ ...options, dataHome: 'relative' }); expect(fs.existsSync(file)).toBe(true);
});

it('refuses missing, non-executable, transient and unsafe launcher paths', () => {
  const { options, executable, root, file } = fixture();
  for (const target of ['relative', '/apps/Ri=name', '/apps/Ri\nExec=bad', '/tmp/.mount_Ri123/AppRun']) {
    expect(() => ensureDesktopPortalIdentity({ ...options, executable: target })).toThrow();
  }
  expect(() => ensureDesktopPortalIdentity({ ...options, executable: path.join(root, 'missing') })).toThrow('installed executable');
  fs.chmodSync(executable, 0o600); expect(() => ensureDesktopPortalIdentity(options)).toThrow('installed executable');
  expect(fs.existsSync(file)).toBe(false);
});
