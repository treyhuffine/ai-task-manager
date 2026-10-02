import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireServiceOwner, serviceOwnerHeld } from './owner';
import { servicePaths } from './paths';

let root: string;
const releases: Array<() => void> = [];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-service-owner-'));
  vi.stubEnv('RI_ROOT', root);
  vi.stubEnv('RI_DB_PATH', '');
  vi.stubEnv('RI_CONFIG_DIR', '');
  vi.stubEnv('RI_WORK_DIR', '');
});
afterEach(() => { for (const release of releases.splice(0)) release(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe('local service ownership', () => {
  it('tells whether another launcher holds the lock, without taking or creating it', () => {
    expect(serviceOwnerHeld()).toBe(false);
    expect(fs.existsSync(servicePaths().ownerLock)).toBe(false);
    const release = acquireServiceOwner();
    expect(serviceOwnerHeld()).toBe(true);
    release();
    expect(serviceOwnerHeld()).toBe(false);
    // Checking left it free to take.
    releases.push(acquireServiceOwner());
  });
  it('refuses a competing launcher and permits a clean handoff', () => {
    const release = acquireServiceOwner();
    releases.push(release);
    expect(() => acquireServiceOwner()).toThrow('Another Ri launcher');
    release();
    releases.push(acquireServiceOwner());
  });
  it('uses the same database lock through a symlinked data root', () => {
    releases.push(acquireServiceOwner());
    const original = servicePaths();
    fs.symlinkSync(root, path.join(root, 'alias'));
    vi.stubEnv('RI_ROOT', path.join(root, 'alias'));
    expect(servicePaths().id).toBe(original.id);
    expect(() => acquireServiceOwner()).toThrow('Another Ri launcher');
  });
  it('keeps separate roots independent and the control socket short', () => {
    releases.push(acquireServiceOwner());
    const first = servicePaths();
    vi.stubEnv('RI_ROOT', path.join(root, 'another-root'));
    releases.push(acquireServiceOwner());
    expect(servicePaths().id).not.toBe(first.id);
    expect(Buffer.byteLength(servicePaths().socket)).toBeLessThan(104);
  });
});
