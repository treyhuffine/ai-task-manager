import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Publish a complete private file and sync its containing directory. */
export function atomicWriteFile(file: string, contents: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

/** The same durable publication without blocking the server on file bytes/fsync. */
export async function atomicWriteFileAsync(file: string, contents: string | Buffer): Promise<void> {
  const io = fs.promises;
  await io.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle: import('node:fs/promises').FileHandle | undefined;
  try {
    handle = await io.open(temporary, 'wx', 0o600);
    await handle.writeFile(contents); await handle.sync(); await handle.close(); handle = undefined;
    await io.rename(temporary, file);
    const directory = await io.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (handle) await handle.close();
    await io.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
