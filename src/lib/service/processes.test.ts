import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { assertNoLegacyWriters, lsof, LsofTimeout } from './processes';

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

/** Puts a stand-in lsof first on PATH, running `script`. */
function fakeLsof(script: string) {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'lsof'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
  fs.writeFileSync(path.join(root, 'data.db'), '');
}

it('stops waiting for an lsof that never answers, and says what to do', async () => {
  // A drive that stops answering leaves every lsof stuck. An update that waits
  // on it held three Homes offline on 2026-11-10.
  fakeLsof('exec sleep 30');
  const started = Date.now();
  const check = assertNoLegacyWriters(300);
  await expect(check).rejects.toThrow("Ri couldn't check whether another program has this database open, because lsof didn't answer within 0.3 seconds");
  await expect(check).rejects.toThrow('Eject or unplug it');
  expect(Date.now() - started).toBeLessThan(5_000);
});

it('reads what a quick lsof says, whatever the wait', async () => {
  fakeLsof('echo 4242');
  await expect(assertNoLegacyWriters(5_000)).rejects.toThrow('Another process still has this database open');
  fakeLsof('exit 1');
  await expect(assertNoLegacyWriters(5_000)).resolves.toBeUndefined();
  fakeLsof('echo "lsof: unsupported" >&2; exit 1');
  await expect(assertNoLegacyWriters(5_000)).rejects.toThrow('Cannot prove that the database is closed');
});

it('gives the raw lsof output and exit code to other callers', async () => {
  fakeLsof('echo p123; echo cnode');
  await expect(lsof(['-Fpc'], 5_000)).resolves.toBe('p123\ncnode\n');
  fakeLsof('exit 1');
  await expect(lsof(['-t'], 5_000)).rejects.toMatchObject({ code: 1, stdout: '', stderr: '' });
  fakeLsof('exec sleep 30');
  await expect(lsof(['-t'], 200)).rejects.toBeInstanceOf(LsofTimeout);
});
