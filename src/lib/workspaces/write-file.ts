/**
 * Worktree mutations behind the `/api/sessions/:id/file` and `.../dir`
 * surfaces. Read-only siblings live in `read-file.ts`; the path-traversal
 * helper is shared so the security boundary is the same on both sides.
 *
 * Cap on writes: 5 MiB. Bigger than the 1 MiB read cap because users
 * occasionally drop in fixtures / large data files; the read cap is
 * purely about CodeMirror's render budget. We still reject anything that
 * looks like an attempt to write a multi-gigabyte blob through the API.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Workspace } from '@agentex/workspace';
import { FileReadError } from './read-file';

export const MAX_WRITE_BYTES = 5 * 1024 * 1024; // 5 MiB

export class FileWriteError extends Error {
  constructor(
    public readonly code:
      | 'not_found'
      | 'invalid_path'
      | 'is_directory'
      | 'is_file'
      | 'exists'
      | 'too_large'
      | 'io_error',
    message: string,
  ) {
    super(message);
    this.name = 'FileWriteError';
  }
}

/**
 * Same sanitizer used by `read-file.ts`. Duplicated (rather than exported)
 * to keep that file's surface tight; the implementation is small and
 * the rules are the security boundary itself.
 */
function sanitizeRelPath(rel: string): string | null {
  if (!rel || typeof rel !== 'string') return null;
  if (path.isAbsolute(rel)) return null;
  if (rel.includes('\0')) return null;
  const normalized = path.normalize(rel).replace(/\\/g, '/');
  if (normalized.startsWith('..') || normalized.includes('/../') || normalized === '.') {
    return null;
  }
  return normalized;
}

async function pathKind(absolute: string): Promise<'file' | 'dir' | 'missing'> {
  try {
    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) return 'dir';
    return 'file';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  }
}

/**
 * Write `content` to `relPath`, creating parent directories as needed.
 * Idempotent — overwrites existing content. Refuses to overwrite a
 * directory with a file (returns `is_directory`).
 */
export async function writeWorkspaceFile(
  ws: Workspace,
  relPath: string,
  content: string,
): Promise<{ path: string; size: number }> {
  const safe = sanitizeRelPath(relPath);
  if (!safe) throw new FileWriteError('invalid_path', `Invalid path: ${relPath}`);

  // Encoded byte length is what the FS actually writes — `content.length`
  // counts UTF-16 code units in the JS string and would underreport
  // multi-byte chars.
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) {
    throw new FileWriteError(
      'too_large',
      `File exceeds the ${MAX_WRITE_BYTES} byte write cap (${bytes} bytes)`,
    );
  }

  const absolute = path.join(ws.path, safe);

  const kind = await pathKind(absolute);
  if (kind === 'dir') {
    throw new FileWriteError('is_directory', `${relPath} is a directory`);
  }

  // Best-effort mkdir -p — fs.writeFile won't create missing parents.
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  try {
    await fs.writeFile(absolute, content, 'utf8');
  } catch (err) {
    throw new FileWriteError('io_error', `Failed to write: ${(err as Error).message}`);
  }
  return { path: safe, size: bytes };
}

/**
 * Write the conflict-resolved `content` for `relPath`, then mark the file
 * resolved in git (`git add`). The write clears the on-disk conflict
 * markers; the `git add` clears the unmerged index entry — so both the
 * marker scan and the `--diff-filter=U` signal in `list-tree.ts` stop
 * reporting the file as a conflict and it drops into the "Clean" section.
 *
 * Callers must only pass fully-resolved content (no remaining markers);
 * staging a file that still has markers would lie to git about the merge
 * being done. The UI enforces "every block resolved" before calling this.
 */
export async function resolveWorkspaceConflict(
  ws: Workspace,
  relPath: string,
  content: string,
): Promise<{ path: string; size: number }> {
  const result = await writeWorkspaceFile(ws, relPath, content);
  if (ws.kind === 'git') {
    try {
      await ws.git.raw(['add', '--', result.path]);
    } catch (err) {
      throw new FileWriteError(
        'io_error',
        `Wrote the resolution but failed to stage it: ${(err as Error).message}`,
      );
    }
  }
  return result;
}

/**
 * Delete `relPath`. Files are unlinked; directories are removed
 * recursively (so the caller doesn't have to crawl the tree first).
 * Returns the kind that was removed so the client can refresh the right
 * caches.
 */
export async function deleteWorkspacePath(
  ws: Workspace,
  relPath: string,
): Promise<{ path: string; kind: 'file' | 'dir' }> {
  const safe = sanitizeRelPath(relPath);
  if (!safe) throw new FileWriteError('invalid_path', `Invalid path: ${relPath}`);

  const absolute = path.join(ws.path, safe);
  const kind = await pathKind(absolute);
  if (kind === 'missing') {
    throw new FileReadError('not_found', `Path not found: ${relPath}`);
  }
  try {
    if (kind === 'dir') {
      await fs.rm(absolute, { recursive: true, force: true });
    } else {
      await fs.unlink(absolute);
    }
  } catch (err) {
    throw new FileWriteError('io_error', `Failed to delete: ${(err as Error).message}`);
  }
  return { path: safe, kind };
}

/**
 * Move/rename `from` → `to`. Refuses to overwrite an existing path so
 * the user can't accidentally clobber another file by typing its name
 * into the rename input. Caller can offer "rename anyway" if needed by
 * deleting first.
 */
export async function renameWorkspacePath(
  ws: Workspace,
  from: string,
  to: string,
): Promise<{ from: string; to: string; kind: 'file' | 'dir' }> {
  const safeFrom = sanitizeRelPath(from);
  if (!safeFrom) throw new FileWriteError('invalid_path', `Invalid source: ${from}`);
  const safeTo = sanitizeRelPath(to);
  if (!safeTo) throw new FileWriteError('invalid_path', `Invalid target: ${to}`);
  if (safeFrom === safeTo) {
    return { from: safeFrom, to: safeTo, kind: 'file' };
  }

  const fromAbs = path.join(ws.path, safeFrom);
  const toAbs = path.join(ws.path, safeTo);

  const fromKind = await pathKind(fromAbs);
  if (fromKind === 'missing') {
    throw new FileReadError('not_found', `Source not found: ${from}`);
  }
  const toKind = await pathKind(toAbs);
  if (toKind !== 'missing') {
    throw new FileWriteError('exists', `Target already exists: ${to}`);
  }

  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  try {
    await fs.rename(fromAbs, toAbs);
  } catch (err) {
    throw new FileWriteError('io_error', `Failed to rename: ${(err as Error).message}`);
  }
  return { from: safeFrom, to: safeTo, kind: fromKind };
}

/**
 * Create a directory at `relPath` (recursive). Throws `exists` if the
 * path already exists as a file; idempotent vs an existing directory.
 */
export async function createWorkspaceDir(
  ws: Workspace,
  relPath: string,
): Promise<{ path: string }> {
  const safe = sanitizeRelPath(relPath);
  if (!safe) throw new FileWriteError('invalid_path', `Invalid path: ${relPath}`);

  const absolute = path.join(ws.path, safe);
  const kind = await pathKind(absolute);
  if (kind === 'file') {
    throw new FileWriteError('is_file', `${relPath} already exists as a file`);
  }
  try {
    await fs.mkdir(absolute, { recursive: true });
  } catch (err) {
    throw new FileWriteError('io_error', `Failed to mkdir: ${(err as Error).message}`);
  }
  return { path: safe };
}

/**
 * Create an empty file at `relPath`. Throws `exists` if anything is
 * there already — the create flow shouldn't silently overwrite.
 */
export async function createWorkspaceFile(
  ws: Workspace,
  relPath: string,
): Promise<{ path: string }> {
  const safe = sanitizeRelPath(relPath);
  if (!safe) throw new FileWriteError('invalid_path', `Invalid path: ${relPath}`);

  const absolute = path.join(ws.path, safe);
  const kind = await pathKind(absolute);
  if (kind !== 'missing') {
    throw new FileWriteError('exists', `${relPath} already exists`);
  }

  await fs.mkdir(path.dirname(absolute), { recursive: true });
  try {
    // O_EXCL guard against TOCTOU between the stat above and the open
    // (another agent action might race in). `wx` flag throws EEXIST if
    // the file appeared between the check and the open.
    const handle = await fs.open(absolute, 'wx');
    await handle.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new FileWriteError('exists', `${relPath} already exists`);
    }
    throw new FileWriteError('io_error', `Failed to create: ${(err as Error).message}`);
  }
  return { path: safe };
}
