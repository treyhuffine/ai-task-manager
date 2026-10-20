import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Opening, creating and replacing files at a real path without following a
 * symlink anywhere in it (docs/connected-mcp-apps.md, "Files"). Every path
 * given here is already a real path (from `realpath`, then checked one
 * component at a time), so a symlink found on the way means something was
 * swapped in after the check, and the operation is refused rather than
 * redirected.
 *
 * - macOS: `O_NOFOLLOW_ANY` has the kernel refuse a symlink in any component.
 * - Linux: the path is walked one folder descriptor at a time, each opened
 *   with `O_NOFOLLOW`, and every name is looked up through that folder's
 *   `/proc/self/fd/<fd>/<name>`, so no lookup goes through a path again.
 * - Elsewhere: only the last component is protected (`O_NOFOLLOW`), and the
 *   caller checks the opened inode against the one the path names.
 */

/** `<sys/fcntl.h>` on macOS 11 and later: no symlinks allowed anywhere in the path. */
export const O_NOFOLLOW_ANY = 0x20000000;
/** How strictly this platform keeps symlinks out of a path: by the kernel, by anchored folder descriptors, or only at the last component. */
export const noFollow: 'kernel' | 'anchored' | 'last' = process.platform === 'darwin' ? 'kernel' : process.platform === 'linux' ? 'anchored' : 'last';

const O_DIRECTORY = (fsConstants as Record<string, number>).O_DIRECTORY ?? 0;

/** A real folder opened one component at a time from `/`, never through a symlink (Linux). */
async function anchoredFolder(folder: string): Promise<fsp.FileHandle> {
  let current = await fsp.open('/', fsConstants.O_RDONLY | O_DIRECTORY);
  try {
    for (const part of folder.split('/').filter(Boolean)) {
      const at = `/proc/self/fd/${current.fd}/${part}`;
      const next = await fsp.open(at, fsConstants.O_RDONLY | O_DIRECTORY | fsConstants.O_NOFOLLOW).catch(async (error: NodeJS.ErrnoException) => {
        // Linux reports a symlink opened as a folder without following as "not a folder". Say what it is, as macOS does.
        if (error.code === 'ENOTDIR' && (await fsp.lstat(at).catch(() => null))?.isSymbolicLink()) throw Object.assign(new Error('ELOOP: a symlink in the path'), {code: 'ELOOP'});
        throw error;
      });
      await current.close();
      current = next;
    }
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}

/**
 * Run `work` with names inside `folder` turned into paths that cannot be
 * redirected: on Linux through the folder's anchored descriptor, elsewhere
 * the plain path, which the open flags then protect.
 */
async function inFolder<T>(folder: string, work: (at: (name: string) => string) => Promise<T>): Promise<T> {
  if (noFollow !== 'anchored') return work(name => path.join(folder, name));
  const handle = await anchoredFolder(folder);
  try { return await work(name => `/proc/self/fd/${handle.fd}/${name}`); }
  finally { await handle.close(); }
}

/** The open flags that refuse a symlink: in any component on macOS, at the last one elsewhere (Linux anchors the folders instead). */
const noFollowFlags = () => noFollow === 'kernel' ? O_NOFOLLOW_ANY : fsConstants.O_NOFOLLOW;

/**
 * Open a regular file at a real path without following any symlink in it.
 * `O_NONBLOCK` keeps a pipe swapped in from blocking the open, and no flag
 * here creates or truncates, so a refused open changes nothing.
 */
export async function openNoFollow(absolute: string, flags: number): Promise<fsp.FileHandle> {
  return inFolder(path.dirname(absolute), async at => fsp.open(at(path.basename(absolute)), flags | noFollowFlags() | fsConstants.O_NONBLOCK));
}

/** The inode a real path names now, looked up without following any symlink in it. */
export async function statNoFollow(absolute: string): Promise<{ ino: number; dev: number }> {
  if (noFollow === 'last') return fsp.lstat(absolute);
  const handle = await openNoFollow(absolute, fsConstants.O_RDONLY);
  try { return await handle.stat(); }
  finally { await handle.close(); }
}

/** The name a save writes before it replaces the file, beside it in the same folder. */
export const SAVE_SUFFIX = '.ri-save';

/** A save that landed somewhere other than the file it was for. Nothing is undone, so the person is told. */
export class SaveRedirected extends Error {}

/**
 * Replace the regular file at a real path with `bytes`, atomically: a new
 * file beside it (created exclusively, without following any symlink),
 * given `mode`, written and synced, then renamed over the original. A
 * reader sees the old file or the new one, never part of either, a failed
 * write leaves the original untouched, and another name for the old file
 * (a hard link) keeps the old content.
 *
 * On Linux the rename goes through the anchored folder descriptor, so it
 * cannot be redirected. On macOS the rename takes paths: a folder swapped
 * for a symlink makes its first lookup miss the new file and fail, and the
 * only window left is a swap between its two lookups inside the one rename
 * call. Afterwards the file the path names must be the new one, or the save
 * is reported as redirected.
 */
export async function replaceFile(absolute: string, bytes: Buffer, mode: number): Promise<void> {
  const folder = path.dirname(absolute), name = path.basename(absolute);
  const temporary = `.${randomUUID()}${SAVE_SUFFIX}`;
  const written = await inFolder(folder, async at => {
    const handle = await fsp.open(at(temporary), fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | noFollowFlags(), 0o600);
    let renamed = false;
    try {
      await handle.chmod(mode & 0o7777);
      for (let offset = 0; offset < bytes.length;) offset += (await handle.write(bytes, offset, bytes.length - offset, offset)).bytesWritten;
      await handle.sync();
      const stat = await handle.stat();
      await handle.close();
      await fsp.rename(at(temporary), at(name));
      renamed = true;
      return stat;
    } finally {
      if (!renamed) {
        await handle.close().catch(() => {});
        await fsp.unlink(at(temporary)).catch(() => {});
      }
    }
  });
  const now = await statNoFollow(absolute).catch(() => null);
  if (!now || now.ino !== written.ino || now.dev !== written.dev) throw new SaveRedirected('This file changed while it was being saved. Check it, then save again.');
}
