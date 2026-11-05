/**
 * List the files in a folder git can't list for us, without knowing how big
 * it is. An agent's folder or a reference folder can be anything the person
 * chose, and on a real home folder (6.4M items) a full walk took minutes and
 * held gigabytes, so a few open tabs ran the server out of memory. This one
 * stops at a fixed number of files and never enters a heavyweight directory,
 * so its cost doesn't depend on the folder's size.
 *
 * It goes breadth first: when the limit cuts a listing short, what's left out
 * is the deepest files, not every folder after the first big one.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Directories no listing enters, or shows the contents of. */
export const HEAVY_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  '.cache',
  '.turbo',
  'coverage',
]);

/**
 * The most files one listing returns. The whole list goes to the browser for
 * it to filter, so this is also what keeps that response small.
 */
export const FOLDER_LIST_LIMIT = 20_000;

export interface FolderWalk {
  /** Relative to the folder, with `/` separators, shallowest first. */
  paths: string[];
  /** The folder has more files than these. */
  truncated: boolean;
}

export async function walkFolder(
  root: string,
  opts: {
    /** List a symlink as a file, without following it. Off, it's skipped. */
    symlinks?: boolean;
    limit?: number;
  } = {},
): Promise<FolderWalk> {
  const limit = opts.limit ?? FOLDER_LIST_LIMIT;
  const paths: string[] = [];
  const folders = [''];
  // `folders` grows as the loop reads it, which is what makes it breadth first.
  for (const rel of folders) {
    let dirents;
    try {
      dirents = await fs.readdir(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ root, rel), { withFileTypes: true });
    } catch {
      continue; // An unreadable subtree (permissions, gone since) is not fatal.
    }
    for (const dirent of dirents) {
      const child = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (!HEAVY_DIRS.has(dirent.name)) folders.push(child);
      } else if (dirent.isFile() || (opts.symlinks && dirent.isSymbolicLink())) {
        // Stops on the file past the limit, so a folder holding exactly the
        // limit doesn't report itself cut short.
        if (paths.length === limit) return { paths, truncated: true };
        paths.push(child);
      }
    }
  }
  return { paths, truncated: false };
}
