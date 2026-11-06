import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { CURRENT_COMPATIBILITY } from '@/lib/releases/compatibility';

/** A release's manifest: every file in `node/` and `server/` with its digest,
 * so a staged, downloaded or shared release can be proven unchanged. */
export interface RuntimeFile { name: string; sha256?: string; link?: string; executable: boolean }
export interface RuntimeManifest {
  format: 1; id: string; version: string; platform: string; arch: string; node: string; files: RuntimeFile[];
}

/** Package links can walk upward before naming a target. Parent components
 * after a named component depend on symlink expansion and must not be reduced
 * lexically before the archive has been safely extracted. */
export function validateRuntimeLink(name: string, link: string | undefined) {
  if (!link || link.length > 4096 || /[\\\x00-\x1f\x7f]/.test(link)) throw new Error(`Unsafe runtime symbolic link: ${name}`);
  if (path.posix.isAbsolute(link)) throw new Error(`Runtime link escapes its package: ${name}`);
  let named = false;
  for (const component of link.split('/')) {
    if (!component || component === '.') continue;
    if (component === '..') {
      if (named) throw new Error(`Unsafe runtime symbolic link: ${name}`);
    } else named = true;
  }
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), link));
  if (target === '..' || target.startsWith('../')) throw new Error(`Runtime link escapes its package: ${name}`);
}

export function digestFile(file: string) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(/* turbopackIgnore: true */ file, 'r');
  try {
    let count: number;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}

function inventory(root: string): RuntimeFile[] {
  const files: RuntimeFile[] = [];
  const physicalRoot = fs.realpathSync.native(root);
  function walk(relative: string) {
    // Next's image/data cache is writable state, kept outside release files.
    if (relative === 'server/.next-desktop/cache') return;
    const absolute = path.join(/* turbopackIgnore: true */ root, relative);
    const stat = fs.lstatSync(/* turbopackIgnore: true */ absolute);
    if (stat.isSymbolicLink()) {
      const link = fs.readlinkSync(/* turbopackIgnore: true */ absolute);
      validateRuntimeLink(relative, link);
      const target = fs.realpathSync.native(absolute);
      if (!target.startsWith(`${physicalRoot}${path.sep}`)) throw new Error(`Runtime link escapes its package: ${relative}`);
      files.push({ name: relative, link, executable: false });
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(/* turbopackIgnore: true */ absolute).sort()) walk(path.posix.join(relative, name));
    } else if (stat.isFile()) {
      files.push({ name: relative, sha256: digestFile(absolute), executable: !!(stat.mode & 0o111) });
    } else throw new Error(`Unsupported runtime entry: ${relative}`);
  }
  walk('node');
  walk('server');
  return files;
}

function manifestId(manifest: Omit<RuntimeManifest, 'id'>) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

export function createRuntimeManifest(resources: string): RuntimeManifest {
  const pkg = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ resources, 'server/package.json'), 'utf8'));
  // Keep release envelope 1 parseable by old updaters. This metadata is
  // authenticated transitively by the existing signed runtime inventory.
  atomicWriteFile(path.join(/* turbopackIgnore: true */ resources, 'server/ri-compatibility.json'), JSON.stringify(CURRENT_COMPATIBILITY));
  const content = { format: 1 as const, version: pkg.version as string, platform: process.platform, arch: process.arch,
    node: process.versions.node, files: inventory(resources) };
  const manifest = { ...content, id: manifestId(content) };
  atomicWriteFile(path.join(/* turbopackIgnore: true */ resources, 'runtime-manifest.json'), JSON.stringify(manifest));
  return manifest;
}

const REQUIRED = [process.platform === 'win32' ? 'node/node.exe' : 'node/bin/node', 'server/dist/service/main.cjs', 'server/dist/service/http-server.cjs', 'server/dist/service/handoff.cjs', 'server/dist/service/runtime-job.cjs', 'server/dist/cli/index.mjs'];

function readManifest(resources: string): RuntimeManifest {
  const manifest = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ resources, 'runtime-manifest.json'), 'utf8')) as RuntimeManifest;
  const { id, ...content } = manifest;
  if (manifest.format !== 1 || !/^[a-f0-9]{64}$/.test(id) || manifestId(content) !== id) throw new Error('Invalid runtime manifest');
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('Runtime does not match this device');
  for (const required of REQUIRED) {
    if (!manifest.files.some(file => file.name === required && file.sha256)) throw new Error(`Runtime missing ${required}`);
  }
  return manifest;
}

/** Hash every file against the manifest: about a minute for a whole release. */
export function verifyRuntime(resources: string): RuntimeManifest {
  const manifest = readManifest(resources);
  if (JSON.stringify(inventory(resources)) !== JSON.stringify(manifest.files)) throw new Error('Runtime files do not match the manifest');
  return manifest;
}

/**
 * The quick check for a release verified in full moments ago, or one that was
 * running: its manifest and the files a Home starts from, in milliseconds.
 * An update hashes the release once, before it stops anything, so the steps
 * while the Home is offline don't add a minute of downtime each.
 */
export function checkRuntime(resources: string): RuntimeManifest {
  const manifest = readManifest(resources);
  for (const required of REQUIRED) {
    if (!fs.statSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ resources, required), { throwIfNoEntry: false })?.isFile()) throw new Error(`Runtime missing ${required}`);
  }
  return manifest;
}
