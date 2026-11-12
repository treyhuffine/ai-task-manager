/**
 * The checksum of one version of an app (docs/personal-apps.md "The catalog"): sha256 over every
 * file's path, mode and contents at that commit, so it names exactly the code a catalog entry was
 * reviewed at, whatever the tag points at later and whoever made the commit. A symlink counts by
 * its target, and a submodule by the commit it pins.
 *
 *   sha256( for each entry, in path order: mode \0 type \0 sha256(contents) or commit \0 path \0 )
 *
 * Reads the repository with `git ls-tree` and one `git cat-file --batch`. No database, so the
 * entry script can use it too.
 */
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { untraced } from '@/lib/utils/untraced';

const run = promisify(execFile);

interface TreeEntry { mode: string; type: string; oid: string; path: string }

function parseTree(listing: string): TreeEntry[] {
  return listing.split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const [mode, type, oid] = line.slice(0, tab).split(' ');
    return { mode: mode!, type: type!, oid: oid!, path: line.slice(tab + 1) };
  });
}

/** sha256 of each blob's contents, read in one `git cat-file --batch`. */
function blobHashes(git: string, folder: string, oids: string[], env: NodeJS.ProcessEnv): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const child = spawn(untraced(git), ['cat-file', '--batch'], { cwd: folder, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const hashes = new Map<string, string>();
    let buffer = Buffer.alloc(0);
    let pending: { oid: string; size: number } | null = null;
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (!pending) {
          const newline = buffer.indexOf(10);
          if (newline < 0) return;
          const [oid, type, size] = buffer.subarray(0, newline).toString('utf8').split(' ');
          buffer = buffer.subarray(newline + 1);
          if (type === 'missing' || !size) { child.kill(); return reject(new Error(`git is missing ${oid}`)); }
          pending = { oid: oid!, size: Number(size) };
        }
        if (buffer.length < pending.size + 1) return;
        hashes.set(pending.oid, createHash('sha256').update(buffer.subarray(0, pending.size)).digest('hex'));
        buffer = buffer.subarray(pending.size + 1);
        pending = null;
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 && hashes.size === oids.length ? resolve(hashes) : reject(new Error(stderr.trim() || `git cat-file read ${hashes.size} of ${oids.length} files`)));
    child.stdin.end(oids.length ? oids.join('\n') + '\n' : '');
  });
}

/** The checksum of `commit`'s files in the repository at `folder`, as `sha256-<hex>`. */
export async function treeChecksum(folder: string, commit: string, options: { git?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const git = options.git ?? 'git';
  const env = options.env ?? process.env;
  const { stdout } = await run(untraced(git), ['ls-tree', '-r', '-z', '--full-tree', commit], { cwd: folder, env, maxBuffer: 64 * 1024 * 1024 });
  const entries = parseTree(stdout).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const blobs = [...new Set(entries.filter((entry) => entry.type === 'blob').map((entry) => entry.oid))];
  const hashes = await blobHashes(git, folder, blobs, env);
  const sum = createHash('sha256');
  for (const entry of entries) {
    sum.update(`${entry.mode}\0${entry.type}\0${entry.type === 'blob' ? hashes.get(entry.oid) : entry.oid}\0${entry.path}\0`);
  }
  return `sha256-${sum.digest('hex')}`;
}
