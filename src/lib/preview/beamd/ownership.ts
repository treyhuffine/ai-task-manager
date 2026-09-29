import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { beamdList, beamdOpen, beamdClose, BeamdCliError } from './cli';

async function exclusive<T>(operation: () => Promise<T>) {
  const directory = path.join(os.tmpdir(), `ri-beamd-${process.getuid?.() ?? 'user'}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o077)) throw new Error('Unsafe tunnel coordination directory');
  const lock = new Database(path.join(directory, 'ownership.sqlite'), { timeout: 0 });
  try { lock.exec('BEGIN IMMEDIATE'); return await operation(); } finally { lock.close(); }
}
/** The account is shared by app homes and previews. A name alone does not
 * authorize retargeting or closing another backend's live tunnel. */
export async function openOwnedTunnel(port: number, name: string, cwd?: string) {
  return exclusive(async () => {
    const existing = (await beamdList({ cwd })).find(tunnel => tunnel.name === name);
    if (existing && existing.port !== port) throw new BeamdCliError('beamd_destination_conflict', 'This tunnel points to another local server. Choose a different name.', '', null);
    const opened = existing?.healthy ? existing : await beamdOpen(port, name, { cwd });
    if (opened.port !== port || opened.name !== name) throw new BeamdCliError('beamd_destination_conflict', 'The tunnel does not target the requested service.', '', null);
    return opened;
  });
}
export async function closeOwnedTunnel(port: number, name: string, cwd?: string) {
  return exclusive(async () => {
    const existing = (await beamdList({ cwd })).find(tunnel => tunnel.name === name);
    if (existing?.port === port) await beamdClose(name, { cwd });
  });
}
