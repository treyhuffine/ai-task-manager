import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { acquireDatabaseAccess, exclusiveDatabaseAccess, beginActivity, exclusiveActivity, writeMaintenance, clearMaintenance } from './maintenance';
let root: string;
const releases: (() => void)[] = [];
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-maintenance-')); vi.stubEnv('RI_ROOT', root); });
afterEach(() => { for (const release of releases.splice(0)) release(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it('blocks exclusive migration while any cooperating database opener remains', () => {
  const close = acquireDatabaseAccess(path.join(root, 'data.db'));
  expect(() => exclusiveDatabaseAccess()).toThrow();
  close(); releases.push(exclusiveDatabaseAccess());
  expect(() => acquireDatabaseAccess(path.join(root, 'data.db'))).toThrow('update');
});
it('closes new-work admission while admitted activity drains', () => {
  const finish = beginActivity();
  writeMaintenance({ phase: 'draining', token: 'secret', startedAt: new Date().toISOString() });
  expect(() => beginActivity()).toThrow('update');
  expect(() => exclusiveActivity()).toThrow();
  const save = beginActivity(undefined, true); save();
  finish(); releases.push(exclusiveActivity());
  expect(() => beginActivity(undefined, true)).toThrow('update');
});
it('only the validation child can open an offline database', () => {
  writeMaintenance({ phase: 'offline', token: 'secret', startedAt: new Date().toISOString() });
  releases.push(exclusiveDatabaseAccess());
  expect(() => acquireDatabaseAccess(path.join(root, 'data.db'))).toThrow('update');
  vi.stubEnv('RI_MAINTENANCE_TOKEN', 'secret');
  acquireDatabaseAccess(path.join(root, 'data.db'))();
});
it('uses the same locks through a symlinked root', () => {
  const alias = `${root}-alias`; fs.symlinkSync(root, alias);
  try {
    const close = acquireDatabaseAccess(path.join(alias, 'data.db'));
    expect(() => exclusiveDatabaseAccess()).toThrow(); close();
    clearMaintenance(); releases.push(exclusiveDatabaseAccess());
  } finally { fs.unlinkSync(alias); }
});
