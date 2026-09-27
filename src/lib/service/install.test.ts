import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { servicePaths } from './paths';
import { hasLoginSupervision, installService, startInstalledService, uninstallService } from './install';

const mocks = vi.hoisted(() => ({ exec: vi.fn(), status: vi.fn(), request: vi.fn(), stop: vi.fn(), runtime: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.exec }));
vi.mock('./runtime', () => ({ installedRuntime: mocks.runtime }));
vi.mock('./client', () => ({ serviceStatus: mocks.status, serviceRequest: mocks.request, stopService: mocks.stop }));

const originalPlatform = process.platform;
let temporary: string;
beforeEach(() => {
  vi.clearAllMocks();
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-service-install-test-'));
  vi.spyOn(os, 'homedir').mockReturnValue(path.join(temporary, 'user'));
  for (const [key, name] of Object.entries({ RI_ROOT: 'home', RI_DB_PATH: 'database.sqlite', RI_CONFIG_DIR: 'config', RI_WORK_DIR: 'work', RI_INSTALL_ROOT: 'installed' })) vi.stubEnv(key, path.join(temporary, name));
  mocks.status.mockResolvedValue(null);
  mocks.request.mockResolvedValue({});
  mocks.stop.mockResolvedValue(undefined);
  mocks.exec.mockImplementation(() => Buffer.alloc(0));
  mocks.runtime.mockReturnValue({ launcher: path.join(temporary, 'installed/launch') });
});
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  fs.rmSync(temporary, { recursive: true, force: true });
});
function write(file: string, content: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }

describe.each(['darwin', 'linux'] as const)('%s user service adapter', platform => {
  beforeEach(() => { Object.defineProperty(process, 'platform', { value: platform }); });

  it('renders a dry run without inspecting, stopping or installing any service', async () => {
    const job = await installService(true);
    expect(job.file.startsWith(`${temporary}${path.sep}`)).toBe(true);
    expect(fs.existsSync(job.file)).toBe(false);
    expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.exec).not.toHaveBeenCalled();
  });

  it('rejects another definition before draining a live service', async () => {
    const job = await installService(true);
    write(job.file, 'some other owner');
    mocks.status.mockResolvedValue({ phase: 'running' });
    await expect(installService()).rejects.toThrow('different service definition');
    expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.exec).not.toHaveBeenCalled();
    expect(fs.readFileSync(job.file, 'utf8')).toBe('some other owner');
  });

  it('leaves a busy backend and login configuration unchanged when handoff is refused', async () => {
    mocks.status.mockResolvedValue({ phase: 'running' });
    mocks.request.mockRejectedValue(new Error('Work is active'));
    const job = await installService(true);
    await expect(installService()).rejects.toThrow('Work is active');
    expect(mocks.request).toHaveBeenCalledWith('/handoff', 'POST', 10_000);
    expect(fs.existsSync(job.file)).toBe(false); expect(hasLoginSupervision()).toBe(false); expect(mocks.exec).not.toHaveBeenCalled();
  });

  it('rechecks the definition after an asynchronous handoff before writing it', async () => {
    const job = await installService(true);
    mocks.status.mockResolvedValueOnce({ phase: 'running' }).mockResolvedValue(null);
    mocks.request.mockImplementation(async () => { write(job.file, 'changed during handoff'); });
    await expect(installService()).rejects.toThrow('different service definition');
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(fs.readFileSync(job.file, 'utf8')).toBe('changed during handoff');
  });

  it('drains once, installs a private definition, and restarts idempotently without another handoff', async () => {
    mocks.status.mockResolvedValueOnce({ phase: 'running' }).mockResolvedValue(null);
    const job = await installService();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(job.file, 'utf8')).toBe(job.content);
    expect(fs.statSync(job.file).mode & 0o777).toBe(0o600);
    expect(hasLoginSupervision()).toBe(true);
    const record = path.join(servicePaths().identity.config, 'service-supervision.json');
    expect(JSON.parse(fs.readFileSync(record, 'utf8'))).toEqual({ version: 1, file: job.file, label: job.label });
    mocks.exec.mockClear(); mocks.request.mockClear(); mocks.status.mockClear();
    await installService();
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
    if (platform === 'darwin') expect(mocks.exec).toHaveBeenLastCalledWith('launchctl', ['kickstart', `gui/${process.getuid!()}/${job.label}`], { stdio: 'pipe' });
    else expect(mocks.exec).toHaveBeenCalledWith('systemctl', ['--user', 'start', `${job.label}.service`], { stdio: 'pipe' });
  });

  it('does not claim supervision after OS registration fails', async () => {
    mocks.exec.mockImplementation(() => { throw new Error('No user supervisor'); });
    await expect(installService()).rejects.toThrow('No user supervisor');
    expect(hasLoginSupervision()).toBe(false);
  });

  it('refuses to start or remove a definition changed after installation', async () => {
    const job = await installService(); write(job.file, 'edited'); mocks.exec.mockClear();
    await expect(startInstalledService()).rejects.toThrow('modified or removed');
    await expect(uninstallService()).rejects.toThrow('modified');
    expect(mocks.exec).not.toHaveBeenCalled(); expect(mocks.stop).not.toHaveBeenCalled();
    expect(fs.readFileSync(job.file, 'utf8')).toBe('edited'); expect(hasLoginSupervision()).toBe(true);
  });

  it('uninstalls only its job after stopping and retains data and the runtime', async () => {
    const job = await installService();
    const data = path.join(servicePaths().identity.root, 'keep.txt'); write(data, 'keep');
    const launcher = path.join(temporary, 'installed/launch'); write(launcher, 'keep runtime');
    mocks.exec.mockClear(); await uninstallService();
    expect(mocks.stop).toHaveBeenCalledTimes(1); expect(fs.existsSync(job.file)).toBe(false); expect(hasLoginSupervision()).toBe(false);
    expect(fs.readFileSync(data, 'utf8')).toBe('keep'); expect(fs.readFileSync(launcher, 'utf8')).toBe('keep runtime');
    if (platform === 'darwin') expect(mocks.exec).toHaveBeenCalledWith('launchctl', ['bootout', `gui/${process.getuid!()}`, job.file], { stdio: 'pipe' });
    else expect(mocks.exec).toHaveBeenCalledWith('systemctl', ['--user', 'disable', '--now', `${job.label}.service`], { stdio: 'pipe' });
  });
});

it('bootstraps an installed macOS job after its launch domain lost the registration', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  const job = await installService(); mocks.exec.mockClear();
  mocks.exec.mockImplementation((_command, args: string[]) => { if (args[0] === 'print') throw new Error('Not loaded'); });
  await expect(startInstalledService()).resolves.toBe(true);
  expect(mocks.exec).toHaveBeenLastCalledWith('launchctl', ['bootstrap', `gui/${process.getuid!()}`, job.file], { stdio: 'pipe' });
});
