import { createRequire } from 'node:module';
import type { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { gunzip } from 'node:zlib';

export interface ArchiveEntry { name: string; size: number; directory: boolean }
interface ZipEntry { fileName: string; uncompressedSize: number }
interface Zip extends EventEmitter { entryCount: number; readEntry(): void; close(): void; openReadStream(entry: ZipEntry, callback: (error: Error | null, stream: Readable) => void): void }

/** Lazy central-directory reads. Never unpacks files or follows archive paths. */
export async function zipEntries(bytes: Buffer, limit = 1000, verify = false): Promise<{ entries: ArchiveEntry[]; truncated: boolean }> {
  // yauzl is also used by the test fixture tooling. This is its small runtime surface.
  const yauzl = createRequire(import.meta.url)('yauzl') as { fromBuffer(bytes: Buffer, options: { lazyEntries: boolean }, callback: (error: Error | null, zip: Zip) => void): void };
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error) { reject(error); return; }
      const entries: ArchiveEntry[] = [];
      let done = false;
      let expanded = 0;
      let declared = 0;
      const finish = (truncated: boolean) => { if (!done) { done = true; zip.close(); resolve({ entries, truncated }); } };
      const fail = (cause: unknown) => { if (!done) { done = true; zip.close(); reject(cause); } };
      zip.on('error', fail);
      zip.on('end', () => finish(false));
      zip.on('entry', (entry: ZipEntry) => {
        if (entries.length >= limit) { finish(true); return; }
        entries.push({ name: entry.fileName, size: entry.uncompressedSize, directory: entry.fileName.endsWith('/') });
        if (!verify) { zip.readEntry(); return; }
        declared += entry.uncompressedSize;
        if (declared > 64 * 1024 * 1024) { fail(new Error('This document is too large to preview. Download it to open it.')); return; }
        zip.openReadStream(entry, (error, stream) => {
          if (error) { fail(error); return; }
          if (done) { stream.destroy(); return; }
          stream.on('error', fail);
          stream.on('data', (chunk: Buffer) => { expanded += chunk.length; if (expanded > 64 * 1024 * 1024) { stream.destroy(); fail(new Error('This document is too large to preview. Download it to open it.')); } });
          stream.on('end', () => { if (!done) zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

/** Validate expansion before Office libraries decompress their ZIP containers. */
export async function checkOfficeContainer(bytes: Buffer) {
  const { entries, truncated } = await zipEntries(bytes, 5000, true);
  if (truncated || entries.reduce((sum, entry) => sum + entry.size, 0) > 64 * 1024 * 1024) throw new Error('This document is too large to preview. Download it to open it.');
}

export async function archiveEntries(bytes: Buffer, name: string) {
  if (/\.zip$/i.test(name)) return zipEntries(bytes);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await new Promise<Buffer>((resolve, reject) => gunzip(bytes, { maxOutputLength: 64 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result)));
  const { Parser } = await import('tar');
  return new Promise<{ entries: ArchiveEntry[]; truncated: boolean }>((resolve, reject) => {
    const entries: ArchiveEntry[] = [];
    let expanded = 0;
    let done = false;
    const finish = (truncated: boolean) => { if (!done) { done = true; parser.abort(new Error('Listing limited')); resolve({ entries, truncated }); } };
    const parser = new Parser({ strict: true, onReadEntry: entry => {
      if (done) { entry.resume(); return; }
      if (entries.length === 1000) { finish(true); return; }
      entries.push({ name: entry.path, size: entry.size, directory: entry.type === 'Directory' });
      entry.on('data', (chunk: Buffer) => { expanded += chunk.length; if (expanded > 64 * 1024 * 1024) finish(true); });
      entry.resume();
    } });
    parser.on('error', error => { if (!done) { done = true; reject(error); } });
    parser.on('end', () => { if (!done) { done = true; resolve({ entries, truncated: false }); } });
    parser.end(bytes);
  });
}
