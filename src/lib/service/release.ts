import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { getRuntimeInstallDir, stageRuntime, validateRuntimeLink, verifyRuntime } from './runtime';
import { requireDiskSpace } from './checkpoint';
import { secureFetch, type Release } from './release-trust';
export { ReleaseSchema, releasePolicy, verifyRelease, checkRelease, type Release, type ReleasePolicy } from './release-trust';

export async function downloadRelease(release: Release, progress: (bytes: number) => void = () => {}) {
  const install = getRuntimeInstallDir();
  const cache = path.join(install, 'downloads');
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
  requireDiskSpace(cache, release.runtime.size + release.runtime.unpackedSize * 2 + 128 * 1024 ** 2);
  const archive = path.join(cache, `${release.runtime.id}.tar.gz.partial`);
  const extracted = path.join(cache, `${release.runtime.id}.unpacked`);
  fs.rmSync(extracted, { recursive: true, force: true });
  try {
    const response = await secureFetch(release.runtime.url);
    const hash = createHash('sha256');
    let size = 0;
    async function* bounded(source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > release.runtime.size) throw new Error('Release exceeded its signed download size');
        hash.update(chunk); progress(size); yield chunk;
      }
    }
    await pipeline(Readable.fromWeb(response.body as never), bounded, fs.createWriteStream(archive, { mode: 0o600 }));
    if (size !== release.runtime.size || hash.digest('hex') !== release.runtime.sha256) throw new Error('Release download checksum or size mismatch');
    fs.mkdirSync(extracted, { mode: 0o700 });
    await validateRuntimeArchive(archive, release.runtime.unpackedSize);
    await tar.x({ file: archive, cwd: extracted, strict: true, preservePaths: false, noChmod: true, noMtime: true });
    const runtime = verifyRuntime(extracted);
    if (runtime.id !== release.runtime.id || runtime.version !== release.version) throw new Error('Runtime does not match its signed release');
    const journal = fs.readFileSync(path.join(extracted, 'server/drizzle/meta/_journal.json'));
    if (createHash('sha256').update(journal).digest('hex') !== release.migrationHistory) throw new Error('Runtime migration history does not match its signed release');
    stageRuntime(extracted);
    return runtime;
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(extracted, { recursive: true, force: true });
  }
}

export async function validateRuntimeArchive(archive: string, maximumSize: number) {
  let unpacked = 0;
  const entries = new Set<string>();
    // Inspect the authenticated archive BEFORE extraction. Reject duplicate
    // paths, special files, hard links and escaping symbolic links.
  let invalid: Error | undefined;
  await tar.t({ file: archive, strict: true, onReadEntry(entry) {
    if (invalid) return;
    try {
      if (entries.size >= 200_000) throw new Error('Runtime archive has too many entries');
      const name = entry.path.replace(/\/$/, '');
      if (!name || path.posix.isAbsolute(name) || name.split('/').includes('..') || name.includes('\\') || !/^(node|server|runtime-manifest\.json|release-policy\.json)(\/|$)/.test(name)) throw new Error('Unsafe runtime archive path');
      if (entries.has(name)) throw new Error('Duplicate runtime archive path');
      entries.add(name);
      if (!['File', 'Directory', 'SymbolicLink'].includes(entry.type)) throw new Error('Unsupported runtime archive entry');
      if (entry.type === 'SymbolicLink') {
        validateRuntimeLink(name, entry.linkpath);
      }
      unpacked += entry.size;
      if (unpacked > maximumSize) throw new Error('Runtime archive exceeds its signed unpacked size');
    } catch (error) { invalid = error instanceof Error ? error : new Error('Invalid runtime archive'); }
  } });
  if (invalid) throw invalid;
}
