/**
 * A stop survives restarts (docs/always-on-spec.md section 6.4). `ri stop`
 * records it in the Home's folder, and a controller the OS starts at the next
 * login or boot sees the record and exits successfully, so the OS doesn't
 * restart it. Every explicit start clears the record first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { getRuntimeInstallDir } from './paths';

export function stoppedRecord(install = getRuntimeInstallDir()) {
  return path.join(/* turbopackIgnore: true */ install, 'stopped.json');
}

export function readStopped(install = getRuntimeInstallDir()): { at: string } | null {
  try {
    const record = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ stoppedRecord(install), 'utf8')) as { at?: string };
    return typeof record.at === 'string' ? { at: record.at } : null;
  } catch { return null; }
}

export function markStopped(install = getRuntimeInstallDir(), now = new Date()) {
  fs.mkdirSync(/* turbopackIgnore: true */ install, { recursive: true, mode: 0o700 });
  atomicWriteFile(stoppedRecord(install), JSON.stringify({ at: now.toISOString() }));
}

export function clearStopped(install = getRuntimeInstallDir()) {
  fs.rmSync(/* turbopackIgnore: true */ stoppedRecord(install), { force: true });
}
