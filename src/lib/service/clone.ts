import fs from 'node:fs';

/** statfs f_type for APFS. */
const APFS = 26;

/**
 * Whether `cp -c` clones from `source` into `directory`: the same APFS volume.
 * Its own module, because the store is in the server's build and the snapshot
 * code isn't: importing that from here would pull its runtime paths into every
 * server trace ("Traced paths" in AGENTS.md).
 */
export function clonesOnMac(source: string, directory: string) {
  return process.platform === 'darwin' && fs.statSync(/* turbopackIgnore: true */ source).dev === fs.statSync(/* turbopackIgnore: true */ directory).dev
    && fs.statfsSync(/* turbopackIgnore: true */ directory).type === APFS;
}
