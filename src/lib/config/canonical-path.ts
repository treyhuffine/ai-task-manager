/**
 * The real location of a path, following every symlink along it, including
 * links whose target doesn't exist yet. Two paths that reach the same place
 * compare equal, however they're spelled.
 *
 * Resolution walks the path one component at a time with `lstat`, the way
 * the kernel does. A symlink is replaced by its target (relative targets
 * resolve from the link's own folder) and resolution continues from there,
 * so a dangling link to `protected/not-yet-created.db` resolves to that
 * protected location rather than looking like a harmless new file. Nothing
 * is normalized ahead of the walk: `link/..` is the parent of wherever the
 * link leads, not the folder holding the link, so `..` is applied only once
 * everything before it is resolved. Components that don't exist are kept as
 * spelled, since nothing can redirect them.
 *
 * Throws when the destination can't be established (a symlink loop, or a
 * link that can't be read), so callers that guard paths fail closed.
 */

import fs from 'node:fs';
import path from 'node:path';

const MAX_LINK_HOPS = 40;

export class UnresolvablePathError extends Error {
  constructor(p: string, reason: string) {
    super(`Can't tell where ${p} leads: ${reason}`);
    this.name = 'UnresolvablePathError';
  }
}

/** A path's components, as spelled: `.` and `..` are kept for the walk. */
function components(p: string): string[] {
  return p.split(path.sep).filter(Boolean);
}

export function canonicalPath(p: string): string {
  // Absolute, but not normalized, which would collapse `link/..` too early.
  const absolute = path.isAbsolute(p) ? p : `${process.cwd()}${path.sep}${p}`;
  let current = path.parse(absolute).root;
  let pending = components(absolute.slice(current.length));
  let hops = 0;

  while (pending.length > 0) {
    const part = pending.shift()!;
    if (part === '.') continue;
    if (part === '..') {
      current = path.dirname(current);
      continue;
    }
    const next = path.join(current, part);
    let stat: fs.Stats | null;
    try {
      stat = fs.lstatSync(next);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw new UnresolvablePathError(p, `${next} (${code})`);
      stat = null;
    }
    if (stat?.isSymbolicLink()) {
      if (++hops > MAX_LINK_HOPS) throw new UnresolvablePathError(p, 'too many symlinks, or a loop');
      let target: string;
      try {
        target = fs.readlinkSync(next);
      } catch (err) {
        throw new UnresolvablePathError(p, `${next} is a link that can't be read (${(err as NodeJS.ErrnoException).code})`);
      }
      // A relative target continues from the link's folder, which is
      // `current`. An absolute one starts again from its root.
      if (path.isAbsolute(target)) {
        current = path.parse(target).root;
        pending = [...components(target.slice(current.length)), ...pending];
      } else {
        pending = [...components(target), ...pending];
      }
      continue;
    }
    current = next;
  }
  return current;
}
