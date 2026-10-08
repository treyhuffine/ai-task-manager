import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, resetDb } from '@/lib/db';
import { assertTestDatabasePath } from './pending-schema';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-pending-schema-guard-')); });
afterEach(() => { resetDb(); fs.rmSync(root, { recursive: true, force: true }); });

describe('pending schema test database guard', () => {
  it('accepts a new database beneath the temporary tree before its file exists', () => {
    expect(() => assertTestDatabasePath(path.join(root, 'nested', 'new.db'))).not.toThrow();
    expect(() => assertTestDatabasePath(':memory:')).not.toThrow();
  });

  it('rejects paths outside the temporary tree before bootstrap creates a database', () => {
    const forbidden = path.resolve(os.tmpdir(), '..', `ri-outside-temp-${process.pid}.db`);
    expect(fs.existsSync(forbidden)).toBe(false);
    expect(() => getDb(forbidden)).toThrow('inside the OS temporary directory');
    expect(fs.existsSync(forbidden)).toBe(false);
  });

  it('rejects a temporary symlink that resolves outside the temporary tree', () => {
    const link = path.join(root, 'outside');
    fs.symlinkSync(os.homedir(), link, 'dir');
    expect(() => assertTestDatabasePath(path.join(link, 'pending-fixture.db')))
      .toThrow('inside the OS temporary directory');
  });
});
