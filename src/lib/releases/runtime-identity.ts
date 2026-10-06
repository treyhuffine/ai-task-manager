/** Installation identity, without opening Home data or trusting npm's environment. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import packageJson from '../../../package.json';
import { CURRENT_COMPATIBILITY, RuntimeCompatibilitySchema, type PeerRelease, type RuntimeCompatibility, localFormatReasons } from './compatibility';

export function runtimeRepository(): string {
  if (process.env.RI_RUNTIME_REPO) return process.env.RI_RUNTIME_REPO;
  // Installed entries sit in server/dist/<cli|service|desktop>. Source
  // invocations keep the project cwd. No home-path guessing or DB access.
  const entry = process.argv[1];
  if (entry && /[/\\]dist[/\\](?:cli|service|desktop)[/\\]/.test(entry)) return path.resolve(path.dirname(entry), '../..');
  return process.cwd();
}
export function readRuntimeCompatibility(repo: string): RuntimeCompatibility | null {
  const file = path.join(repo, 'ri-compatibility.json');
  if (!fs.existsSync(file)) return null;
  return RuntimeCompatibilitySchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}
declare global { var __riServedRelease: PeerRelease | undefined; }
/** The Home's server pins what it serves before Next loads. Next reads
 * BUILD_ID once at boot, but agents rebuild a source Home's checkout in place
 * while the old server keeps running. Read per request, one `pnpm build` would
 * announce two releases nothing serves (the missing-BUILD_ID fallback, then
 * the new id), and every open viewer would reload for each (ServiceConnection). */
export function pinServedRelease(repo = runtimeRepository()): PeerRelease {
  return globalThis.__riServedRelease ??= runtimePeerRelease(repo);
}
const identities = new Map<string, { stamp: string; release: PeerRelease['release'] }>();
/** Without a repo: this process's release, pinned in the Home's server. With
 * one: that installation as it is on disk now. */
export function runtimeReleaseIdentity(repo?: string): PeerRelease['release'] {
  if (repo === undefined && globalThis.__riServedRelease) return globalThis.__riServedRelease.release;
  repo ??= runtimeRepository();
  const file = path.join(repo, '..', 'runtime-manifest.json');
  if (fs.existsSync(file)) {
    const stat = fs.statSync(file);
    const stamp = `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
    const cached = identities.get(file);
    if (cached?.stamp === stamp) return cached.release;
    const { id, ...manifest } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest.format !== 1 || typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)
      || typeof manifest.version !== 'string' || createHash('sha256').update(JSON.stringify(manifest)).digest('hex') !== id) {
      throw new Error('The bundled runtime identity is invalid. Repair this installation.');
    }
    const release = { version: manifest.version as string, build: id as string, source: 'packaged' as const };
    identities.set(file, { stamp, release });
    return release;
  }
  const nextBuild = path.join(repo, process.env.NEXT_DIST_DIR ?? '.next', 'BUILD_ID');
  return { version: packageJson.version, build: fs.existsSync(nextBuild) ? `source:${fs.readFileSync(nextBuild, 'utf8').trim()}` : `source:${packageJson.version}`, source: 'source' };
}
export function runtimePeerRelease(repo?: string): PeerRelease {
  if (repo === undefined && globalThis.__riServedRelease) return globalThis.__riServedRelease;
  repo ??= runtimeRepository();
  return { release: runtimeReleaseIdentity(repo), compatibility: readRuntimeCompatibility(repo) ?? CURRENT_COMPATIBILITY };
}
export function workerUpdateCompatibility(repo: string): string[] {
  const candidate = readRuntimeCompatibility(repo);
  return candidate ? localFormatReasons(candidate) : ['This release has no worker compatibility metadata. Install a bridge release before updating this device.'];
}
