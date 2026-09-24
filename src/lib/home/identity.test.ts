import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import {
  claimHome,
  ensureHomeIdentity,
  HomeIdentityError,
  isHomeActive,
  readMachineIdentity,
  resetHomeIdentityCache,
  resolveHomeIdentity,
  writeMachineIdentity,
} from './identity';

/**
 * A home keeps one stable id, and a root only acts as the home on the
 * computer its data names as host (docs/homes-spec.md §2.2, §10.3).
 */

let home: TestHome;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-identity-' });
  resetHomeIdentityCache();
});

afterEach(async () => {
  resetHomeIdentityCache();
  await home.cleanup();
});

const machineFile = () => path.join(home.configDir, 'machine.json');

describe('first boot', () => {
  it('makes the home and this computer, and records the ids on the machine first', async () => {
    const status = resolveHomeIdentity({ name: 'Trey' });
    expect(status.state).toBe('active');
    if (status.state !== 'active') return;
    expect(status.created).toBe(true);
    expect(status.home).toMatchObject({ kind: 'personal', name: 'Trey', hostComputerId: status.computer.id });
    expect(status.computer).toMatchObject({ status: 'active', platform: process.platform });
    expect(status.computer.name.length).toBeGreaterThan(0);
    expect(readMachineIdentity()).toMatchObject({ homeId: status.home.id, computerId: status.computer.id });
    expect(fs.statSync(machineFile()).mode & 0o777).toBe(0o600);
  });

  it('keeps the same identity on every later boot', () => {
    const first = resolveHomeIdentity();
    const again = resolveHomeIdentity();
    expect(again.state).toBe('active');
    expect(again.home.id).toBe(first.home.id);
    if (again.state === 'active') expect(again.created).toBe(false);
  });

  it('reuses ids a crashed boot already wrote to the machine', () => {
    writeMachineIdentity({ homeId: 'home-from-crash', computerId: 'computer-from-crash', createdAt: '2026-09-24' });
    const status = resolveHomeIdentity();
    expect(status.home.id).toBe('home-from-crash');
    expect(status.home.hostComputerId).toBe('computer-from-crash');
  });
});

describe('a root whose data came from elsewhere', () => {
  it('is not the home when it has no machine identity, as after a restore', () => {
    resolveHomeIdentity();
    fs.rmSync(machineFile());
    resetHomeIdentityCache();
    const status = resolveHomeIdentity();
    expect(status).toMatchObject({ state: 'needs_claim', reason: 'no_machine_identity' });
    expect(() => ensureHomeIdentity()).toThrow(HomeIdentityError);
    expect(isHomeActive()).toBe(false);
  });

  it('is not the home when this machine belongs to another home', () => {
    const made = resolveHomeIdentity();
    writeMachineIdentity({ homeId: 'someone-else', computerId: made.home.hostComputerId, createdAt: 'x' });
    expect(resolveHomeIdentity()).toMatchObject({ state: 'needs_claim', reason: 'other_home' });
  });

  it('is not the home when another computer hosts it', () => {
    const made = resolveHomeIdentity();
    writeMachineIdentity({ homeId: made.home.id, computerId: 'the-laptop', createdAt: 'x' });
    expect(resolveHomeIdentity()).toMatchObject({ state: 'needs_claim', reason: 'other_host' });
  });
});

describe('a whole-folder copy, machine.json included', () => {
  it('needs claiming in another folder on this computer', async () => {
    resolveHomeIdentity();
    const { resetDb } = await import('@/lib/db');
    resetDb();
    const copy = `${home.root}-copy`;
    fs.cpSync(home.root, copy, { recursive: true });
    const saved = { root: process.env.RI_ROOT, db: process.env.RI_DB_PATH, config: process.env.RI_CONFIG_DIR };
    try {
      process.env.RI_ROOT = copy;
      process.env.RI_DB_PATH = path.join(copy, 'data.db');
      process.env.RI_CONFIG_DIR = path.join(copy, '.config');
      resetHomeIdentityCache();
      expect(resolveHomeIdentity()).toMatchObject({ state: 'needs_claim', reason: 'moved_or_copied' });
      // Claiming it here keeps the same computer: the hardware didn't change.
      const before = resolveHomeIdentity().home.hostComputerId;
      expect(claimHome().computer.id).toBe(before);
    } finally {
      resetDb();
      resetHomeIdentityCache();
      process.env.RI_ROOT = saved.root;
      process.env.RI_DB_PATH = saved.db;
      process.env.RI_CONFIG_DIR = saved.config;
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  it('needs claiming on another computer, which becomes a new computer of the home', async () => {
    const made = resolveHomeIdentity();
    const { _setMachineFingerprintForTests } = await import('./machine-fingerprint');
    _setMachineFingerprintForTests('another-mac');
    try {
      resetHomeIdentityCache();
      expect(resolveHomeIdentity()).toMatchObject({ state: 'needs_claim', reason: 'other_machine' });
      const claimed = claimHome();
      expect(claimed.computer.id).not.toBe(made.home.hostComputerId);
      expect(readMachineIdentity()).toMatchObject({ machine: 'another-mac' });
    } finally {
      _setMachineFingerprintForTests(undefined);
    }
  });

  it('binds an older identity file to this machine and folder the first time it matches', () => {
    const made = resolveHomeIdentity();
    fs.writeFileSync(
      machineFile(),
      JSON.stringify({ version: 1, homeId: made.home.id, computerId: made.home.hostComputerId, createdAt: 'x' }),
    );
    resetHomeIdentityCache();
    expect(resolveHomeIdentity().state).toBe('active');
    const bound = readMachineIdentity();
    expect(bound?.root).toBe(fs.realpathSync(home.root));
    expect(bound).toHaveProperty('machine');
  });
});

describe('claimHome', () => {
  it('makes this machine the host of a restored home, keeping the home id', async () => {
    const made = resolveHomeIdentity();
    const originalHost = made.home.hostComputerId;
    fs.rmSync(machineFile());
    resetHomeIdentityCache();

    const claimed = claimHome();
    expect(claimed.home.id).toBe(made.home.id);
    expect(claimed.computer.id).not.toBe(originalHost);
    expect(readMachineIdentity()).toMatchObject({ homeId: made.home.id, computerId: claimed.computer.id });
    expect(isHomeActive()).toBe(true);

    // The original host stays a computer of the home, ready to reconnect as a worker.
    const { getComputer } = await import('@/lib/db/queries');
    expect(getComputer(originalHost)?.status).toBe('active');
  });

  it("reuses this machine's computer row when the home already knows it", async () => {
    const made = resolveHomeIdentity();
    const { createComputer, setHomeHost } = await import('@/lib/db/queries');
    const laptop = createComputer({ name: 'MacBook' });
    setHomeHost(laptop.id);
    resetHomeIdentityCache();
    expect(resolveHomeIdentity()).toMatchObject({ state: 'needs_claim', reason: 'other_host' });

    const claimed = claimHome();
    expect(claimed.computer.id).toBe(made.home.hostComputerId);
  });

  it('does nothing to a home that is already active here', () => {
    const made = resolveHomeIdentity();
    const claimed = claimHome();
    expect(claimed.computer.id).toBe(made.home.hostComputerId);
  });
});
