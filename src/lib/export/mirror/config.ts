/**
 * Mirror config: feature flag + entity path helpers.
 *
 * The mirror is a live DB-to-markdown export. Every committed DB write also
 * writes a markdown mirror of the affected entities to disk under the brain
 * directory. Enabled by default; set `*_MIRROR_DISABLED=1` to turn off.
 *
 * Path resolution (brain dir, overrides) lives in `@/lib/config/paths`.
 * Env var names are derived from `APP_SHORT_ID` so they rename with the
 * product.
 */

import path from 'node:path';
import { getBrainDir } from '@/lib/config/paths';
import { APP_SHORT_ID } from '@/constants/app';

const ENV_PREFIX = APP_SHORT_ID.toUpperCase();

export const MIRROR_DISABLED_ENV = `${ENV_PREFIX}_MIRROR_DISABLED`;

export type EntityType = 'task' | 'note' | 'area' | 'stream';
export const ENTITY_TYPES: EntityType[] = ['task', 'note', 'area', 'stream'];

export function isMirrorEnabled(): boolean {
  return process.env[MIRROR_DISABLED_ENV] !== '1';
}

/** Primary directory for a given entity type (plural form). */
export function typeDir(type: EntityType): string {
  return path.join(getBrainDir(), `${type}s`);
}

/** Tmp subdir (hidden from the primary glob pattern). */
export function tmpDir(type: EntityType): string {
  return path.join(typeDir(type), '.tmp');
}

/** Archive subdir for a given entity type. */
export function archiveDir(type: EntityType): string {
  return path.join(getBrainDir(), '.archive', `${type}s`);
}
