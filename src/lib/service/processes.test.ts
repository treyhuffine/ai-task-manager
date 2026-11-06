import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { assertNoLegacyWriters } from './processes';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-processes-test-'));
  vi.stubEnv('RI_ROOT', root);
  vi.stubEnv('RI_DB_PATH', path.join(root, 'data.db'));
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it('finds nothing to hold a database that a restore has moved aside', async () => {
  await expect(assertNoLegacyWriters()).resolves.toBeUndefined();
});

it('still sees a closed database as closed, and an open one as open', async () => {
  const database = path.join(root, 'data.db');
  fs.writeFileSync(database, '');
  await expect(assertNoLegacyWriters()).resolves.toBeUndefined();
  const held = fs.openSync(database, 'r');
  try { await expect(assertNoLegacyWriters()).rejects.toThrow('Another process still has this database open'); }
  finally { fs.closeSync(held); }
});
