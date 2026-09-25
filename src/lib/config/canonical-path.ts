/**
 * The real location of a path, following every symlink along it, including
 * links whose target doesn't exist yet. Two paths that reach the same place
 * compare equal, however they're spelled.
 *
 * Resolution walks the path one component at a time with `lstat`. A symlink
 * is replaced by its target (relative targets resolve from the link's own
 * folder) and resolution continues from there, so a dangling link to
 * `protected/not-yet-created.db` resolves to that protected location rather
 * than looking like a harmless new file. Components that don't exist are
 * kept as spelled, since nothing can redirect them.
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

export function canonicalPath(p: string): string {
  const absolute = path.resolve(p);
  let current = path.parse(absolute).root;
  let pending = absolute.slice(current.length).split(path.sep).filter(Boolean);
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
      const resolved = path.resolve(current, target);
      current = path.parse(resolved).root;
      pending = [...resolved.slice(current.length).split(path.sep).filter(Boolean), ...pending];
      continue;
    }
    current = next;
  }
  return current;
}
