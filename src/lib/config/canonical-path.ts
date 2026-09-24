/**
 * The real location of a path: symlinks followed through its nearest
 * existing ancestor, with any not-yet-created remainder appended. Two paths
 * that reach the same folder compare equal, however they're spelled.
 */

import fs from 'node:fs';
import path from 'node:path';

export function canonicalPath(p: string): string {
  let existing = path.resolve(p);
  const rest: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  let real = existing;
  try {
    real = fs.realpathSync.native(existing);
  } catch {
    /* unreadable: compare as spelled */
  }
  return path.join(real, ...rest);
}
