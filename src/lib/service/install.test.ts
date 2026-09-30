import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { servicePaths } from './paths';
import { acquireServiceOwner } from './owner';
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
    expect(mocks.request).toHaveBeenCalledWith('/handoff', 'POST', 60_000);
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

  function previousContent(content: string) {
    return platform === 'darwin'
      ? content.replace('<key>ExitTimeOut</key><integer>60</integer>', '<key>ExitTimeOut</key><integer>30</integer>')
      : content.replace('TimeoutStopSec=60\n', 'TimeoutStopSec=30\n');
  }

  it('migrates only the known previous definition after a successful idle handoff', async () => {
    const job = await installService(); const previous = previousContent(job.content);
    write(job.file, previous); mocks.exec.mockClear(); mocks.request.mockClear();
    mocks.status.mockResolvedValueOnce({ phase: 'running' }).mockResolvedValue(null);
    const operations: string[] = [];
    mocks.request.mockImplementation(async () => { operations.push('handoff'); });
    mocks.exec.mockImplementation((command: string, args: string[]) => {
      const stopping = command === 'launchctl' ? args[0] === 'bootout' : args[1] === 'stop';
      const starting = command === 'launchctl' ? args[0] === 'bootstrap' : args[1] === 'enable';
      if (stopping) { operations.push('unload'); expect(fs.readFileSync(job.file, 'utf8')).toBe(previous); }
      if (starting) { operations.push('load'); expect(fs.readFileSync(job.file, 'utf8')).toBe(job.content); }
    });
    await installService();
    expect(operations).toEqual(['handoff', 'unload', 'load']);
    expect(fs.readFileSync(job.file, 'utf8')).toBe(job.content); expect(hasLoginSupervision()).toBe(true);
    if (platform === 'linux') expect(mocks.exec).toHaveBeenCalledWith('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
  });

  it('upgrades the known previous registration when starting the installed service', async () => {
    const job = await installService(); write(job.file, previousContent(job.content)); mocks.exec.mockClear();
    await expect(startInstalledService()).resolves.toBe(true);
    expect(fs.readFileSync(job.file, 'utf8')).toBe(job.content);
    if (platform === 'darwin') expect(mocks.exec).toHaveBeenLastCalledWith('launchctl', ['bootstrap', `gui/${process.getuid!()}`, job.file], { stdio: 'pipe' });
    else expect(mocks.exec).toHaveBeenLastCalledWith('systemctl', ['--user', 'enable', '--now', `${job.label}.service`], { stdio: 'pipe' });
  });

  it('preserves the previous definition and its live worker when handoff is busy', async () => {
    const job = await installService(); const previous = previousContent(job.content); write(job.file, previous);
    mocks.exec.mockClear(); mocks.status.mockResolvedValue({ phase: 'running' }); mocks.request.mockRejectedValue(new Error('Work is active'));
    await expect(installService()).rejects.toThrow('Work is active');
    await expect(startInstalledService()).rejects.toThrow('Work is active');
    expect(mocks.exec).not.toHaveBeenCalled(); expect(mocks.stop).not.toHaveBeenCalled();
    expect(fs.readFileSync(job.file, 'utf8')).toBe(previous); expect(hasLoginSupervision()).toBe(true);
  });

  it('refuses to unload an unreachable controller that still owns this root', async () => {
    const job = await installService(); const previous = previousContent(job.content); write(job.file, previous); mocks.exec.mockClear();
    const release = acquireServiceOwner();
    try {
      await expect(installService()).rejects.toThrow('Another Ri launcher owns');
      expect(mocks.exec).not.toHaveBeenCalled(); expect(fs.readFileSync(job.file, 'utf8')).toBe(previous);
    } finally { release(); }
  });

  it('does not treat a modified previous template as an owned migration', async () => {
    const job = await installService(); const modified = previousContent(job.content).replace('RI_DESKTOP', 'OTHER_DESKTOP'); write(job.file, modified);
    mocks.exec.mockClear(); mocks.status.mockClear(); mocks.request.mockClear();
    await expect(installService()).rejects.toThrow('different service definition');
    await expect(startInstalledService()).rejects.toThrow('modified or removed');
    await expect(uninstallService()).rejects.toThrow('modified');
    expect(mocks.exec).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.stop).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
    expect(fs.readFileSync(job.file, 'utf8')).toBe(modified);
  });

  it('leaves the previous template intact if the supervisor refuses to unload it', async () => {
    const job = await installService(); const previous = previousContent(job.content); write(job.file, previous); mocks.exec.mockClear();
    mocks.exec.mockImplementation((command: string, args: string[]) => {
      if (command === 'launchctl' ? args[0] === 'bootout' : args[1] === 'stop') throw new Error('Supervisor refused');
    });
    await expect(installService()).rejects.toThrow('Supervisor refused');
    expect(fs.readFileSync(job.file, 'utf8')).toBe(previous); expect(hasLoginSupervision()).toBe(true);
  });

  it('refuses a definition changed while the previous registration is unloading', async () => {
    const job = await installService(); write(job.file, previousContent(job.content)); mocks.exec.mockClear();
    mocks.exec.mockImplementation((command: string, args: string[]) => {
      if (command === 'launchctl' ? args[0] === 'bootout' : args[1] === 'stop') write(job.file, 'changed during unload');
    });
    await expect(installService()).rejects.toThrow('different service definition');
    expect(fs.readFileSync(job.file, 'utf8')).toBe('changed during unload');
    expect(mocks.exec.mock.calls.some(([command, args]) => command === 'launchctl' ? args[0] === 'bootstrap' : args[1] === 'enable')).toBe(false);
  });

  it('can remove the exact previous template without requiring a migration first', async () => {
    const job = await installService(); write(job.file, previousContent(job.content)); mocks.exec.mockClear();
    await uninstallService();
    expect(mocks.stop).toHaveBeenCalledTimes(1); expect(fs.existsSync(job.file)).toBe(false); expect(hasLoginSupervision()).toBe(false);
  });

  it('does not remove a job modified while its controller is stopping', async () => {
    const job = await installService(); mocks.exec.mockClear();
    mocks.stop.mockImplementation(async () => { write(job.file, 'changed during stop'); });
    await expect(uninstallService()).rejects.toThrow('modified');
    expect(mocks.exec).not.toHaveBeenCalled(); expect(fs.readFileSync(job.file, 'utf8')).toBe('changed during stop'); expect(hasLoginSupervision()).toBe(true);
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

it('migrates an unloaded previous macOS registration without booting out a different job', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  const job = await installService(); write(job.file, job.content.replace('<key>ExitTimeOut</key><integer>60</integer>', '<key>ExitTimeOut</key><integer>30</integer>')); mocks.exec.mockClear();
  mocks.exec.mockImplementation((_command, args: string[]) => { if (args[0] === 'print') throw new Error('Not loaded'); });
  await startInstalledService();
  expect(mocks.exec.mock.calls.some(([, args]) => args[0] === 'bootout')).toBe(false);
  expect(fs.readFileSync(job.file, 'utf8')).toBe(job.content);
  expect(mocks.exec).toHaveBeenLastCalledWith('launchctl', ['bootstrap', `gui/${process.getuid!()}`, job.file], { stdio: 'pipe' });
});
