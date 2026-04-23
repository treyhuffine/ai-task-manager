/**
 * Filesystem primitives for the mirror.
 *
 * Atomic writes via tmp + rename, ID-based globbing, archive moves.
 * All paths are absolute and derived from config.ts.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  archiveDir,
  ENTITY_TYPES,
  tmpDir,
  typeDir,
  type EntityType,
} from './config';
import { ensureBrainDir } from '@/lib/config/paths';
import { parseMirrorFilename } from './render';

/** Create all mirror directories (idempotent). */
export function ensureDirs(): void {
  ensureBrainDir();
  for (const t of ENTITY_TYPES) {
    fs.mkdirSync(typeDir(t), { recursive: true });
    fs.mkdirSync(tmpDir(t), { recursive: true });
    fs.mkdirSync(archiveDir(t), { recursive: true });
  }
}

/**
 * Find the primary-folder file(s) whose name ends with `--{id}.md` or is
 * exactly `{id}.md`. Usually returns 0 or 1 match — multiple means a prior
 * crash left debris that the caller should clean up.
 */
export async function findByIdInType(type: EntityType, id: string): Promise<string[]> {
  const dir = typeDir(type);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const matches: string[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    if (!name.endsWith('.md')) continue;
    const parsed = parseMirrorFilename(name);
    if (parsed?.id === id) matches.push(path.join(dir, name));
  }
  return matches;
}

/** Same as findByIdInType but searches .archive/<type>/. */
export async function findByIdInArchive(type: EntityType, id: string): Promise<string[]> {
  const dir = archiveDir(type);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const matches: string[] = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const parsed = parseMirrorFilename(name);
    if (parsed?.id === id) matches.push(path.join(dir, name));
  }
  return matches;
}

/**
 * Atomically write an entity's file to the mirror.
 *
 * Steps: write tmp → delete any existing match(es) for this ID in the
 * primary folder and archive → rename tmp to final.
 *
 * The primary-folder delete runs before the rename so the common
 * title-rename case (old-slug.md → new-slug.md) replaces cleanly. A crash
 * between delete and rename leaves a brief "no file" state that reconcile
 * fixes on the next pass.
 */
export async function writeEntityFile(
  type: EntityType,
  id: string,
  finalFilename: string,
  content: string,
): Promise<string> {
  const dir = typeDir(type);
  const tmp = path.join(tmpDir(type), `${id}.tmp`);
  const finalPath = path.join(dir, finalFilename);

  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(tmpDir(type), { recursive: true });

  // 1) Write tmp
  await fsp.writeFile(tmp, content, 'utf8');

  // 2) Remove any existing primary-folder match(es) for this ID
  const existing = await findByIdInType(type, id);
  for (const p of existing) {
    if (p === finalPath) continue; // keep so rename can overwrite
    await fsp.rm(p).catch(() => void 0);
  }

  // 3) Also clean up anything in .archive/ for this ID — coming out of archive,
  //    should only live in one place.
  const archived = await findByIdInArchive(type, id);
  for (const p of archived) {
    await fsp.rm(p).catch(() => void 0);
  }

  // 4) Rename tmp → final (overwrites if target exists)
  await fsp.rename(tmp, finalPath);

  return finalPath;
}

/**
 * Move an entity's file to .archive/<type>/. Used when status flips to
 * archived or the entity is merged away. Idempotent — missing source is fine.
 *
 * Dedupes in both folders: removes any primary-folder copies and any stale
 * archive copies for this ID before writing, so a second archive write for
 * the same entity doesn't leave two files.
 */
export async function archiveEntityFile(type: EntityType, id: string, filename: string, content: string): Promise<void> {
  for (const p of await findByIdInType(type, id)) {
    await fsp.rm(p).catch(() => void 0);
  }
  const dest = path.join(archiveDir(type), filename);
  for (const p of await findByIdInArchive(type, id)) {
    if (p === dest) continue; // let the write overwrite
    await fsp.rm(p).catch(() => void 0);
  }
  await fsp.mkdir(archiveDir(type), { recursive: true });
  await fsp.writeFile(dest, content, 'utf8');
}

/** Hard-delete all files for this entity (primary + archive). */
export async function deleteEntityFile(type: EntityType, id: string): Promise<void> {
  for (const p of await findByIdInType(type, id)) {
    await fsp.rm(p).catch(() => void 0);
  }
  for (const p of await findByIdInArchive(type, id)) {
    await fsp.rm(p).catch(() => void 0);
  }
}

/** List all primary-folder IDs for a given type. Used by reconcile. */
export async function listIdsInType(type: EntityType): Promise<string[]> {
  const dir = typeDir(type);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const ids: string[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    if (!name.endsWith('.md')) continue;
    const parsed = parseMirrorFilename(name);
    if (parsed) ids.push(parsed.id);
  }
  return ids;
}

/** Read the frontmatter `updated_at` from a file. Cheap heuristic — no full YAML parse. */
export async function readUpdatedAt(filePath: string): Promise<string | null> {
  try {
    const head = await fsp.readFile(filePath, 'utf8');
    // Look for `updated_at: <value>` in the first ~2KB
    const slice = head.slice(0, 2048);
    const match = slice.match(/^updated_at:\s*("?)([^"\n]+)\1/m);
    if (!match) return null;
    return match[2].trim();
  } catch {
    return null;
  }
}
