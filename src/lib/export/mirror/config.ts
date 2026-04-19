/**
 * Mirror config: path resolution, feature flag.
 *
 * The mirror is a live DB-to-markdown export. Every committed DB write also
 * writes a markdown mirror of the affected entities to disk. Enabled by
 * default; set the `*_MIRROR_DISABLED=1` env var to turn off. Env var names
 * are derived from `APP_SHORT_ID` so they rename with the product.
 */

import path from 'node:path';
import { getUserDataDir } from '@/lib/config/paths';
import { APP_SHORT_ID } from '@/constants/app';

const ENV_PREFIX = APP_SHORT_ID.toUpperCase();

export const MIRROR_PATH_ENV = `${ENV_PREFIX}_MIRROR_PATH`;
export const MIRROR_DISABLED_ENV = `${ENV_PREFIX}_MIRROR_DISABLED`;

export type EntityType = 'task' | 'note' | 'area' | 'stream';
export const ENTITY_TYPES: EntityType[] = ['task', 'note', 'area', 'stream'];

export function isMirrorEnabled(): boolean {
  return process.env[MIRROR_DISABLED_ENV] !== '1';
}

export function getMirrorRoot(): string {
  const override = process.env[MIRROR_PATH_ENV];
  if (override) return override;
  // Default: user data dir itself. Type folders (tasks/, notes/, areas/,
  // stream/) live alongside internal files (data.db, config.json). Users
  // who want a visible location override via the env var.
  return getUserDataDir();
}

/** Primary directory for a given entity type (plural form). */
export function typeDir(type: EntityType): string {
  return path.join(getMirrorRoot(), `${type}s`);
}

/** Tmp subdir (hidden from the primary glob pattern). */
export function tmpDir(type: EntityType): string {
  return path.join(typeDir(type), '.tmp');
}

/** Archive subdir for a given entity type. */
export function archiveDir(type: EntityType): string {
  return path.join(getMirrorRoot(), '.archive', `${type}s`);
}
