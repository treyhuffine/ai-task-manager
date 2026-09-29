import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ModelFile } from './model';

export async function verifyModelFile(file: string, spec: ModelFile): Promise<boolean> {
  try {
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile() || stat.size !== spec.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === spec.sha256;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** HTTPS-only redirects, bounded bytes and exact Range semantics. Partial files are
 * untrusted until the complete app-pinned hash matches and activation renames them. */
export async function downloadModelFile(options: {
  directory: string; spec: ModelFile; url: string; signal: AbortSignal;
  progress: (bytes: number) => void; fetcher?: typeof fetch;
}) {
  const { directory, spec, signal, progress } = options;
  signal.throwIfAborted();
  const target = path.join(directory, spec.name);
  if (await verifyModelFile(target, spec)) { progress(spec.size); return; }
  const partial = `${target}.partial`;
  let offset = 0;
  try {
    const stat = await fs.promises.lstat(partial);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid partial model file');
    offset = stat.size;
    if (offset > spec.size) { await fs.promises.unlink(partial); offset = 0; }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (offset !== spec.size) {
    let url = options.url;
    let response: Response | undefined;
    for (let redirect = 0; redirect < 6; redirect++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Model downloads require HTTPS');
      signal.throwIfAborted();
      response = await (options.fetcher ?? fetch)(url, { signal, redirect: 'manual', headers: offset ? { Range: `bytes=${offset}-` } : {} });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      url = new URL(response.headers.get('location') ?? '', url).href;
      response = undefined;
    }
    if (!response?.ok || !response.body) throw new Error(`Model download failed (${response?.status ?? 'redirect limit'})`);
    if (response.status === 206) {
      if (response.headers.get('content-range') !== `bytes ${offset}-${spec.size - 1}/${spec.size}`) {
        await response.body.cancel(); throw new Error('Invalid model download range');
      }
    } else if (response.status === 200) { offset = 0; }
    else { await response.body.cancel(); throw new Error('Unexpected model download status'); }
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) !== spec.size - offset) {
      await response.body.cancel(); throw new Error('Unexpected model download size');
    }
    const handle = await fs.promises.open(partial, fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW | (offset ? fs.constants.O_APPEND : fs.constants.O_TRUNC), 0o600);
    try {
      progress(offset);
      for await (const chunk of Readable.fromWeb(response.body as never)) {
        signal.throwIfAborted();
        offset += chunk.length;
        if (offset > spec.size) throw new Error('Model download exceeds pinned size');
        await handle.writeFile(chunk);
        progress(offset);
      }
      await handle.sync();
    } finally { await handle.close(); }
  }
  if (!(await verifyModelFile(partial, spec))) {
    await fs.promises.rm(partial, { force: true });
    throw new Error(`Model checksum verification failed: ${spec.name}`);
  }
  await fs.promises.rename(partial, target);
}
