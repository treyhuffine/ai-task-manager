/**
 * Isolated homes and computer roots for tests.
 *
 * `createTestHome()` points every path helper at a fresh temp root, writes a
 * config with a known host token, and opens the database through the app, so
 * migrations, FTS and seed rows are real. `cleanup()` closes the database,
 * restores the environment, and deletes the root.
 *
 * `createTestComputer()` makes a second root that stands in for another
 * computer: its own config, work dir and folders, with no database and
 * without touching the process environment. Code under test that acts for a
 * specific computer takes these paths explicitly.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PATH_ENV = ['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR'] as const;

export interface TestHome {
  root: string;
  dbPath: string;
  configDir: string;
  workDir: string;
  /** The host token written to config.json. */
  token: string;
  cleanup(): Promise<void>;
}

export interface TestHomeOptions {
  /** Temp dir prefix, to find a leaked root by the test that made it. */
  prefix?: string;
  token?: string;
  /** Open the database now. Default true. */
  openDb?: boolean;
}

export async function createTestHome(opts: TestHomeOptions = {}): Promise<TestHome> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), opts.prefix ?? 'ri-test-home-'));
  const dbPath = path.join(root, 'data.db');
  const configDir = path.join(root, '.config');
  const workDir = path.join(root, '.work');
  const token = opts.token ?? `ri_test_${Math.random().toString(36).slice(2, 14)}`;
  const saved = PATH_ENV.map((k) => [k, process.env[k]] as const);

  process.env.RI_ROOT = root;
  process.env.RI_DB_PATH = dbPath;
  process.env.RI_CONFIG_DIR = configDir;
  process.env.RI_WORK_DIR = workDir;
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ version: 1, localToken: token, globalSkillEnabled: false }),
    { mode: 0o600 },
  );

  const { getDb, resetDb } = await import('@/lib/db');
  // Drop any connection a previous test left open on another path.
  resetDb();
  if (opts.openDb ?? true) getDb();

  return {
    root,
    dbPath,
    configDir,
    workDir,
    token,
    async cleanup() {
      resetDb();
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export interface TestComputer {
  name: string;
  root: string;
  configDir: string;
  workDir: string;
  /** Stands in for this computer's home directory, where its projects live. */
  userDir: string;
  cleanup(): void;
}

export function createTestComputer(name: string): TestComputer {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ri-test-computer-${name}-`));
  const configDir = path.join(root, 'ri', '.config');
  const workDir = path.join(root, 'ri', '.work');
  const userDir = path.join(root, 'home');
  for (const d of [configDir, workDir, userDir]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return {
    name,
    root,
    configDir,
    workDir,
    userDir,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
