/**
 * Single source of truth for user data locations.
 *
 * All persistent files (DB, config, future caches) live under one user data
 * directory: `~/.<APP_SHORT_ID>/`. Override paths via env vars prefixed with
 * the upper-cased short ID (e.g. `FLOW_DATA_DIR`, `FLOW_DB_PATH`).
 *
 * Never write inside the install directory — it gets wiped on npm update.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_SHORT_ID } from '@/constants/app';

const ENV_PREFIX = APP_SHORT_ID.toUpperCase();

function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
}

export function getUserDataDir(): string {
  const override = process.env[`${ENV_PREFIX}_DATA_DIR`];
  if (override) return override;
  return path.join(homeDir(), `.${APP_SHORT_ID}`);
}

export function getDbPath(): string {
  const override = process.env[`${ENV_PREFIX}_DB_PATH`];
  if (override) return override;
  return path.join(getUserDataDir(), 'data.db');
}

export function getConfigPath(): string {
  return path.join(getUserDataDir(), 'config.json');
}

export function ensureUserDataDir(): string {
  const dir = getUserDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Best-effort on platforms without POSIX permissions.
    }
  }
  return dir;
}
