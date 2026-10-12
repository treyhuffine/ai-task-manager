import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { getHome } from '@/lib/db/queries';
import { teamIntentPath } from '@/lib/home/team-intent';
import { getIsOnboarded } from '@/lib/config/onboarded';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  connect: vi.fn(),
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), message: vi.fn() },
  installSkills: vi.fn(),
  cleanSkills: vi.fn(),
  isServerRunning: vi.fn(),
  startServer: vi.fn(),
  wizard: vi.fn(),
  diagnostics: vi.fn(),
  connected: vi.fn(),
}));
vi.mock('@clack/prompts', async (original) => ({
  ...await original<typeof import('@clack/prompts')>(),
  select: mocks.select,
  isCancel: (value: unknown) => typeof value === 'symbol',
  intro: vi.fn(),
  outro: vi.fn(),
  log: mocks.log,
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock('@/lib/service/client', () => ({ serviceStatus: async () => null, serviceRequest: vi.fn() }));
vi.mock('../lib/server', () => ({
  isOurServerRunning: mocks.isServerRunning,
  startNextServer: mocks.startServer,
  waitForServer: async () => {},
}));
vi.mock('get-port', () => ({ default: async () => 43123 }));
vi.mock('./onboard', () => ({ runWizard: mocks.wizard }));
vi.mock('./doctor', () => ({ runDoctorChecks: mocks.diagnostics, printDoctorChecks: vi.fn() }));
vi.mock('./connected', () => ({ runConnected: mocks.connected }));
vi.mock('./connect', () => ({ runConnect: mocks.connect }));
vi.mock('@/lib/agent-skills/shipped', () => ({
  installAppRootSkills: mocks.installSkills,
  installGlobalSkills: mocks.installSkills,
  getGlobalSkillPreference: () => false,
}));
vi.mock('@/lib/agent-skills/project-cleanup', () => ({ cleanupKnownProjectSkillLinks: mocks.cleanSkills }));

import { startCommand } from './start';
import { registerTeamCommand } from './team';

let home: TestHome;
let previousExitCode: typeof process.exitCode;
let ttyDescriptor: PropertyDescriptor | undefined;
let signalListeners: Record<'SIGINT' | 'SIGTERM', NodeJS.SignalsListener[]>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv('RI_DESKTOP', undefined);
  vi.stubEnv('PORT', process.env.PORT);
  previousExitCode = process.exitCode;
  signalListeners = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
  home = await createTestHome({ prefix: 'ri-cli-team-start-', openDb: false });
  ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.select.mockResolvedValue(Symbol('cancel'));
  mocks.connect.mockResolvedValue(false);
  mocks.installSkills.mockResolvedValue({ installed: 0 });
  mocks.cleanSkills.mockResolvedValue({ removed: 0, errors: 0 });
  mocks.isServerRunning.mockResolvedValue(true);
  mocks.diagnostics.mockResolvedValue([]);
  mocks.startServer.mockImplementation(() => {
    const server = new EventEmitter();
    // Let the full launcher run, then close its synthetic child normally.
    server.on('newListener', (event) => {
      if (event === 'exit') queueMicrotask(() => server.emit('exit', 0));
    });
    return server;
  });
});

afterEach(async () => {
  process.exitCode = previousExitCode;
  if (ttyDescriptor) Object.defineProperty(process.stdin, 'isTTY', ttyDescriptor);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    for (const listener of process.listeners(signal)) {
      if (!signalListeners[signal].includes(listener)) process.removeListener(signal, listener);
    }
  }
  vi.restoreAllMocks();
  await home.cleanup();
  vi.unstubAllEnvs();
});

async function createTeam() {
  const program = new Command().exitOverride();
  registerTeamCommand(program);
  await program.parseAsync(['node', 'ri', 'team', 'create', '--root', home.root, '--name', 'Acme']);
  expect(fs.existsSync(home.dbPath)).toBe(false);
}

function start() {
  return startCommand({ open: false, pair: false, port: '9', http2: false, voice: false });
}

describe('CLI first start', () => {
  it('starts a declared team without offering personal setup or connection, including on retry', async () => {
    await createTeam();
    await start();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.cleanSkills).not.toHaveBeenCalled();
    expect(mocks.installSkills).not.toHaveBeenCalled();
    const team = getHome();
    expect(team).toMatchObject({ kind: 'team', name: 'Acme' });
    await start();
    expect(getHome()?.id).toBe(team?.id);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('does not describe a headless team start as creating a personal home', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    await createTeam();
    await start();
    expect(getHome()).toMatchObject({ kind: 'team', name: 'Acme' });
    expect(mocks.log.info).not.toHaveBeenCalledWith(expect.stringContaining('Starting a new home here'));
  });

  it('refuses an unreadable team declaration before personal setup or database creation', async () => {
    await createTeam();
    fs.writeFileSync(teamIntentPath(), '{broken');
    await start();
    expect(process.exitCode).toBe(1);
    expect(mocks.log.error).toHaveBeenCalledWith(expect.stringContaining("can't be read"));
    expect(mocks.select).not.toHaveBeenCalled();
    expect(fs.existsSync(home.dbPath)).toBe(false);
  });

  it('still offers setup for an unmarked fresh root and leaves cancellation empty', async () => {
    await start();
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(fs.existsSync(home.dbPath)).toBe(false);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('still lets an unmarked fresh root connect to an existing personal home', async () => {
    mocks.select.mockResolvedValue('connect');
    await start();
    expect(mocks.connect).toHaveBeenCalledWith(undefined, { open: false });
    expect(fs.existsSync(home.dbPath)).toBe(false);
  });

  it('still creates and onboards a personal home, then restarts it without repeating setup', async () => {
    mocks.select.mockResolvedValue('start');
    mocks.isServerRunning.mockResolvedValue(false);
    await start();
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(getHome()).toMatchObject({ kind: 'personal', name: 'My Ri' });
    const id = getHome()?.id;
    expect(mocks.wizard).toHaveBeenCalledOnce();
    expect(getIsOnboarded()).toBe(true);
    expect(mocks.installSkills).toHaveBeenCalledOnce();
    expect(mocks.diagnostics).toHaveBeenCalledOnce();
    expect(mocks.startServer).toHaveBeenCalledOnce();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(fs.existsSync(teamIntentPath())).toBe(false);

    await start();
    expect(getHome()?.id).toBe(id);
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.wizard).toHaveBeenCalledOnce();
    expect(mocks.startServer).toHaveBeenCalledTimes(2);
  });

  it('still starts a personal home without interactive onboarding in a headless terminal', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    mocks.isServerRunning.mockResolvedValue(false);
    await start();
    expect(getHome()).toMatchObject({ kind: 'personal', name: 'My Ri' });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.wizard).not.toHaveBeenCalled();
    expect(getIsOnboarded()).toBe(false);
    expect(mocks.diagnostics).toHaveBeenCalledOnce();
    expect(mocks.startServer).toHaveBeenCalledOnce();
  });

  it('still opens an already connected installation without creating a local home', async () => {
    fs.writeFileSync(path.join(home.configDir, 'connection.json'), '{}');
    await start();
    expect(mocks.connected).toHaveBeenCalledWith({ open: false });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.startServer).not.toHaveBeenCalled();
    expect(fs.existsSync(home.dbPath)).toBe(false);
  });
});
