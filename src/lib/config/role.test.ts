import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectedInstallationError, getInstallationRole, RoleConflictError } from './role';

/**
 * A folder is a home (it holds a database), a connected computer (it holds
 * only a connection record), or fresh. A connected computer never gets a
 * database of its own, whoever asks (docs/homes-spec.md §3.1).
 */

const keys = ['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR'] as const;
let root: string;
let saved: [string, string | undefined][];

beforeEach(async () => {
  saved = keys.map((k) => [k, process.env[k]]);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-role-'));
  process.env.RI_ROOT = root;
  delete process.env.RI_DB_PATH;
  delete process.env.RI_CONFIG_DIR;
  delete process.env.RI_WORK_DIR;
  const { resetDb } = await import('@/lib/db');
  resetDb();
});

afterEach(async () => {
  const { resetDb } = await import('@/lib/db');
  resetDb();
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function connect() {
  fs.mkdirSync(path.join(root, '.config'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.config', 'connection.json'),
    JSON.stringify({ homeId: 'h', homeUrl: 'https://ri.example', credential: 'k' }),
  );
}

describe('getInstallationRole', () => {
  it('is fresh with neither a database nor a connection', () => {
    expect(getInstallationRole()).toBe('fresh');
  });

  it('is a home once a database exists', async () => {
    const { getDb } = await import('@/lib/db');
    getDb();
    expect(getInstallationRole()).toBe('home');
  });

  it('is connected with only a connection record', () => {
    connect();
    expect(getInstallationRole()).toBe('connected');
  });

  it('refuses a folder that holds both', async () => {
    const { getDb } = await import('@/lib/db');
    getDb();
    connect();
    expect(() => getInstallationRole()).toThrow(RoleConflictError);
  });
});

describe('getDb on a connected computer', () => {
  it('refuses, and creates nothing', async () => {
    connect();
    const { getDb } = await import('@/lib/db');
    expect(() => getDb()).toThrow(ConnectedInstallationError);
    expect(fs.existsSync(path.join(root, 'data.db'))).toBe(false);
  });

  it('still creates a database for a fresh folder, which first run relies on', async () => {
    const { getDb } = await import('@/lib/db');
    getDb();
    expect(fs.existsSync(path.join(root, 'data.db'))).toBe(true);
  });
});
