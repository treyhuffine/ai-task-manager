/**
 * Single source of truth for on-disk paths.
 *
 * Layout:
 *
 *   <app-root>/               (~/<APP_SHORT_ID>/ by default)
 *   ├── brain/                user content — db, markdown mirror, attachments
 *   │   ├── data.db           source of truth
 *   │   ├── tasks/ notes/ areas/ stream/
 *   │   ├── attachments/      binary files referenced by entities
 *   │   └── .archive/         archived entities + orphan attachments
 *   ├── config.json           app state (auth, settings)
 *   └── tmp/                  ephemeral (db dumps mid-backup, etc.)
 *
 * `brain/` is the unit users can git-track, sync, or point at a visible
 * location via `<APP>_BRAIN_PATH`. Config and tmp stay at the app root —
 * they're app-managed and shouldn't leave the machine.
 *
 * Env overrides:
 *   <APP>_ROOT         move the whole tree
 *   <APP>_BRAIN_PATH   move just brain/ (e.g. to a synced/tracked location)
 *   <APP>_DB_PATH      move just the db (advanced)
 *
 * Never write inside the install directory — it gets wiped on npm update.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_SHORT_ID } from '@/constants/app';
import { renderAppRootClaudeMd } from './claude-md-template';

const ENV_PREFIX = APP_SHORT_ID.toUpperCase();

export const APP_ROOT_ENV = `${ENV_PREFIX}_ROOT`;
export const BRAIN_PATH_ENV = `${ENV_PREFIX}_BRAIN_PATH`;
export const DB_PATH_ENV = `${ENV_PREFIX}_DB_PATH`;

function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
}

/** The app's root directory on disk. Contains brain/, config.json, tmp/. */
export function getAppRoot(): string {
  const override = process.env[APP_ROOT_ENV];
  if (override) return override;
  return path.join(homeDir(), APP_SHORT_ID);
}

/**
 * Dev-mode data root. Used by `<cli> start --dev` (and the `pnpm dev` script)
 * to isolate dev data from the production brain. Not automatic — callers
 * opt in by setting `process.env[APP_ROOT_ENV]` to this value before any
 * path helper runs.
 *
 * The root helpers above are unchanged; they still resolve via the standard
 * override-or-prod chain. This keeps `paths.ts` pure — no NODE_ENV coupling,
 * no mode detection — and puts the dev/prod decision in the caller's hands.
 */
export function getDevAppRoot(): string {
  return path.join(homeDir(), `${APP_SHORT_ID}-dev`);
}

/**
 * Test data root. Used by smoke test scripts to ensure each run starts from
 * a clean slate without touching the user's dev or prod data. Same opt-in
 * contract as `getDevAppRoot()`.
 */
export function getTestAppRoot(): string {
  return path.join(homeDir(), `${APP_SHORT_ID}-test`);
}

export function getBrainDir(): string {
  const override = process.env[BRAIN_PATH_ENV];
  if (override) return override;
  return path.join(getAppRoot(), 'brain');
}

export function getDbPath(): string {
  const override = process.env[DB_PATH_ENV];
  if (override) return override;
  return path.join(getBrainDir(), 'data.db');
}

export function getConfigPath(): string {
  return path.join(getAppRoot(), 'config.json');
}

export function getAttachmentsDir(): string {
  return path.join(getBrainDir(), 'attachments');
}

export function ensureAttachmentsDir(): string {
  const dir = getAttachmentsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

/**
 * Scratch directory for ephemeral files (e.g., the consistent DB dump
 * written by `backupDb()` before upload). Callers are responsible for
 * cleaning up files they create here — nothing sweeps it automatically.
 */
export function getTmpDir(): string {
  return path.join(getAppRoot(), 'tmp');
}

export function ensureTmpDir(): string {
  const dir = getTmpDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function ensureAppRoot(): string {
  const dir = getAppRoot();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Best-effort on platforms without POSIX permissions.
    }
  }

  // Drop a CLAUDE.md orienting any agent that opens a session here. Written
  // once — we never overwrite, so users can edit freely. An agent session
  // started in the data root auto-loads this and gets the orchestrator-vs-
  // contributor role right from the first message.
  const claudeMdPath = path.join(dir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, renderAppRootClaudeMd(), { mode: 0o600 });
  }

  return dir;
}

export function ensureBrainDir(): string {
  ensureAppRoot();
  const dir = getBrainDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

/**
 * One-shot migration from the pre-brain/ flat layout.
 *
 * Pre-brain: everything (data.db, tasks/, notes/, areas/, stream/,
 * attachments/, .archive/) lived directly under <app-root>.
 * Post-brain: those files move into <app-root>/brain/.
 *
 * Runs only when the legacy layout is detected and no brain/db overrides are
 * set — an override implies the user has intentionally split things and we
 * shouldn't touch them. Idempotent: once brain/ exists, this is a no-op.
 */
export function migrateLegacyLayoutToBrain(): { migrated: boolean; moved: string[] } {
  if (process.env[BRAIN_PATH_ENV] || process.env[DB_PATH_ENV]) {
    return { migrated: false, moved: [] };
  }

  const appRoot = getAppRoot();
  const brainDir = getBrainDir();

  // Only migrate if brain/ doesn't exist yet — its presence means we've
  // already migrated or the user is on a fresh install.
  if (fs.existsSync(brainDir)) {
    return { migrated: false, moved: [] };
  }

  const legacyDb = path.join(appRoot, 'data.db');
  if (!fs.existsSync(legacyDb)) {
    return { migrated: false, moved: [] };
  }

  fs.mkdirSync(brainDir, { recursive: true, mode: 0o700 });

  const moved: string[] = [];
  const candidates = [
    'data.db',
    'data.db-wal',
    'data.db-shm',
    'tasks',
    'notes',
    'areas',
    'stream',
    'attachments',
    '.archive',
    'README.md',
  ];

  for (const name of candidates) {
    const src = path.join(appRoot, name);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(brainDir, name);
    try {
      fs.renameSync(src, dest);
      moved.push(name);
    } catch (err) {
      console.warn(`[paths] migrateLegacyLayoutToBrain: failed to move ${name}:`, err);
    }
  }

  return { migrated: moved.length > 0, moved };
}
