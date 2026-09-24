/**
 * A fingerprint of the machine this process runs on, for telling "this
 * home's data on the computer it was set up on" from "a copy of it on
 * another computer" (docs/homes-spec.md §10.3). Migration Assistant, a disk
 * clone, or an rsync of the whole folder carry `machine.json` along, and
 * without this a copy on a new Mac would start as the home too.
 *
 * It is a sha256 of the OS's own machine id (IOPlatformUUID on macOS,
 * /etc/machine-id on Linux), never the id itself. It is not an identity or
 * a secret: it only detects that the folder is now on different hardware.
 * Null where the OS offers no id, which skips the check.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

let cached: string | null | undefined;
let override: string | null | undefined;

function readMachineId(): string | null {
  if (process.platform === 'darwin') {
    const out = spawnSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 3000 });
    const match = out.status === 0 ? /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out.stdout) : null;
    return match?.[1] ?? null;
  }
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const id = fs.readFileSync(file, 'utf8').trim();
      if (id) return id;
    } catch {
      /* try the next */
    }
  }
  return null;
}

export function machineFingerprint(): string | null {
  if (override !== undefined) return override;
  if (cached === undefined) {
    const id = readMachineId();
    cached = id ? crypto.createHash('sha256').update(`ri-machine:${id}`).digest('hex').slice(0, 32) : null;
  }
  return cached;
}

/** Tests only: pretend to be another machine, or `undefined` to stop pretending. */
export function _setMachineFingerprintForTests(value: string | null | undefined): void {
  override = value;
}
