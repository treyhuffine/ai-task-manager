/**
 * The activation record a Home's launcher reads (docs/always-on-spec.md
 * section 7.4 step 5). Before a controller hands over to a new release it
 * records the candidate and the release to go back to. The candidate's
 * controller removes the record just before it starts work, the first moment
 * anything outside the database can happen. A candidate that exits or hangs
 * twice before that is put back by the launcher, which leaves `restore` for
 * the previous release's controller: restore the snapshot, then report.
 */
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { getRuntimeInstallDir } from './paths';

const RELEASE_ID = /^[a-f0-9]{64}$/;

export interface Activation { candidate: string | null; previous: string | null; restore: boolean }

export function activationDirectory(install = getRuntimeInstallDir()) {
  return path.join(/* turbopackIgnore: true */ install, 'activation');
}

function readId(file: string) {
  try {
    const id = fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8').trim();
    return RELEASE_ID.test(id) ? id : null;
  } catch { return null; }
}

export function readActivation(install = getRuntimeInstallDir()): Activation {
  const directory = activationDirectory(install);
  return {
    candidate: readId(path.join(/* turbopackIgnore: true */ directory, 'candidate')),
    previous: readId(path.join(/* turbopackIgnore: true */ directory, 'previous')),
    restore: fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, 'restore')),
  };
}

/** The candidate file is written last, since it is what the launcher acts on. */
export function beginActivation(candidate: string, previous: string, install = getRuntimeInstallDir()) {
  if (!RELEASE_ID.test(candidate) || !RELEASE_ID.test(previous)) throw new Error('Invalid release id');
  const directory = activationDirectory(install);
  fs.rmSync(/* turbopackIgnore: true */ directory, { recursive: true, force: true });
  fs.mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true, mode: 0o700 });
  atomicWriteFile(path.join(/* turbopackIgnore: true */ directory, 'previous'), `${previous}\n`);
  atomicWriteFile(path.join(/* turbopackIgnore: true */ directory, 'candidate'), `${candidate}\n`);
}

/** The candidate is about to start work. From here a failure is the
 * controller's to handle, and rollback is on request (section 7.6). */
export function clearActivation(install = getRuntimeInstallDir()) {
  fs.rmSync(/* turbopackIgnore: true */ activationDirectory(install), { recursive: true, force: true });
}

/** Whether this release is a candidate that hasn't started work yet. */
export function activationPending(release: string | undefined, install = getRuntimeInstallDir()) {
  const { candidate } = readActivation(install);
  return !!release && candidate === release;
}
