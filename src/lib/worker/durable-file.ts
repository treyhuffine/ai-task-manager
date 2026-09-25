/**
 * Writing the worker's journals so they survive a crash (docs/homes-build.md,
 * P2.3): an appended line is flushed to disk before the call returns, a
 * rewrite is atomic, and reading ignores a last line a crash cut short.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Append one line and flush it to disk. */
export function appendLine(file: string, line: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeSync(fd, line.endsWith('\n') ? line : `${line}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Replace a file's contents atomically: a temp file, flushed, then renamed over it. */
export function writeFileAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/**
 * Every whole JSON line in a file. A line that doesn't parse can only be the
 * last one, cut short by a crash mid-write: it's dropped. One that doesn't
 * parse earlier means the file was damaged some other way, and that throws.
 */
export function readJsonLines<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out: T[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      const rest = lines.slice(i + 1).some((l) => l.trim());
      if (rest) throw new Error(`${file} is damaged at line ${i + 1}.`);
    }
  }
  return out;
}
