/** Connected-device updates preserve local journals and credentials, never
 * open a Home database or restore older journal positions over new results. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { canonical, serviceIdentity } from './paths';
import { fileDigest, requireDiskSpace } from './checkpoint';

interface Entry { source: string; saved: string; size?: number; sha256?: string; link?: string }
interface WorkerCheckpoint { format: 1; kind: 'worker'; identity: ReturnType<typeof serviceIdentity>; entries: Entry[] }
export function assertWorkerStorage() {
  if (fs.existsSync(serviceIdentity().database)) throw new Error('A database appeared in this connected-device installation. Resolve its role before updating.');
}
export function createWorkerCheckpoint(directory: string): string {
  assertWorkerStorage();
  const identity = serviceIdentity();
  directory = canonical(directory);
  const roots = [...new Set([identity.root, identity.config, identity.work])].sort((a, b) => a.length - b.length)
    .filter((root, index, all) => !all.slice(0, index).some(parent => root.startsWith(`${parent}${path.sep}`)));
  if (roots.some(root => directory === root || directory.startsWith(`${root}${path.sep}`))) throw new Error('Recovery storage must be outside the device data/config/work roots');
  const entries: Entry[] = [];
  const walk = (source: string, saved: string) => {
    if (source === path.join(identity.config, 'electron-demo') || source === path.join(identity.work, 'speech') || /\.(?:owner|activity|access|lock)\.sqlite(?:-journal|-wal|-shm)?$/.test(source) || source.endsWith('.maintenance.json')) return;
    const stat = fs.lstatSync(source);
    if (stat.isDirectory()) for (const name of fs.readdirSync(source)) walk(path.join(source, name), path.join(saved, name));
    else if (stat.isFile()) entries.push({ source, saved, size: stat.size });
    else if (stat.isSymbolicLink()) entries.push({ source, saved, link: fs.readlinkSync(source) });
  };
  roots.forEach((root, i) => { if (fs.existsSync(root)) walk(root, `files/${i}`); });
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  requireDiskSpace(path.dirname(directory), entries.reduce((size, entry) => size + (entry.size ?? 0), 0) + 32 * 1024 * 1024);
  const temp = `${directory}.partial-${randomUUID()}`;
  fs.mkdirSync(temp, { mode: 0o700 });
  try {
    for (const entry of entries) {
      const target = path.join(temp, entry.saved);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      if (entry.link !== undefined) fs.symlinkSync(entry.link, target);
      else {
        fs.copyFileSync(entry.source, target); fs.chmodSync(target, 0o600);
        entry.sha256 = fileDigest(target);
        if (entry.sha256 !== fileDigest(entry.source)) throw new Error('A worker file changed while checkpointing. Retry after local work stops.');
        const fd = fs.openSync(target, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
    }
    atomicWriteFile(path.join(temp, 'checkpoint.json'), JSON.stringify({ format: 1, kind: 'worker', identity, entries } satisfies WorkerCheckpoint));
    fs.renameSync(temp, directory);
    const fd = fs.openSync(path.dirname(directory), 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return directory;
  } catch (error) { fs.rmSync(temp, { recursive: true, force: true }); throw error; }
}
/** Candidate validation is read-only for workers. Retain the original journals
 * on failure or interruption. A checkpoint remains for explicit recovery. */
export function verifyWorkerCheckpoint(directory: string) {
  assertWorkerStorage();
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'checkpoint.json'), 'utf8')) as WorkerCheckpoint;
  if (manifest.format !== 1 || manifest.kind !== 'worker' || JSON.stringify(manifest.identity) !== JSON.stringify(serviceIdentity()) || !Array.isArray(manifest.entries)) throw new Error('Worker checkpoint belongs to another installation');
  for (const entry of manifest.entries) {
    const file = path.resolve(directory, entry.saved);
    if (!file.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error('Invalid worker checkpoint path');
    if (entry.link !== undefined ? fs.readlinkSync(file) !== entry.link : fileDigest(file) !== entry.sha256) throw new Error('Worker checkpoint checksum mismatch');
  }
  return manifest;
}
