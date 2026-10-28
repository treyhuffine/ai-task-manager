import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';
import { getRuntimeInstallDir } from './paths';
import { CURRENT_COMPATIBILITY } from '@/lib/releases/compatibility';

interface RuntimeFile { name: string; sha256?: string; link?: string; executable: boolean }
export interface RuntimeManifest {
  format: 1; id: string; version: string; platform: string; arch: string; node: string; files: RuntimeFile[];
}

export { getRuntimeInstallDir } from './paths';

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

function digestFile(file: string) {
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
      for (const name of fs.readdirSync(/* turbopackIgnore: true */ absolute).sort()) walk(path.join(/* turbopackIgnore: true */ relative, name));
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

export function verifyRuntime(resources: string): RuntimeManifest {
  const manifest = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ resources, 'runtime-manifest.json'), 'utf8')) as RuntimeManifest;
  const { id, ...content } = manifest;
  if (manifest.format !== 1 || !/^[a-f0-9]{64}$/.test(id) || manifestId(content) !== id) throw new Error('Invalid runtime manifest');
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('Runtime does not match this device');
  if (JSON.stringify(inventory(resources)) !== JSON.stringify(manifest.files)) throw new Error('Runtime files do not match the manifest');
  for (const required of ['node/bin/node', 'server/dist/service/main.cjs', 'server/dist/service/http-server.cjs', 'server/dist/service/handoff.cjs', 'server/dist/service/runtime-job.cjs', 'server/dist/cli/index.mjs']) {
    if (!manifest.files.some(file => file.name === required && file.sha256)) throw new Error(`Runtime missing ${required}`);
  }
  return manifest;
}

export function installedRuntime() {
  const install = getRuntimeInstallDir();
  const active = path.join(/* turbopackIgnore: true */ install, 'active-release');
  if (!fs.existsSync(/* turbopackIgnore: true */ active)) return null;
  const id = fs.readFileSync(/* turbopackIgnore: true */ active, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid active runtime selection');
  const directory = path.join(/* turbopackIgnore: true */ install, 'releases', id);
  return { id, directory, repo: path.join(/* turbopackIgnore: true */ directory, 'server'), node: path.join(/* turbopackIgnore: true */ directory, 'node/bin/node'), launcher: path.join(/* turbopackIgnore: true */ install, 'launch') };
}

/** A bundled runtime is trusted through the signed application distribution.
 * Downloaded runtimes additionally require publisher verification before this
 * step. Staging never replaces an already selected running runtime. */
export function stageRuntime(resources: string) {
  const manifest = verifyRuntime(resources);
  const install = getRuntimeInstallDir();
  fs.mkdirSync(path.join(/* turbopackIgnore: true */ install, 'releases'), { recursive: true, mode: 0o700 });
  return withFileLock(path.join(/* turbopackIgnore: true */ install, 'stage'), () => {
    const destination = path.join(/* turbopackIgnore: true */ install, 'releases', manifest.id);
    if (!fs.existsSync(/* turbopackIgnore: true */ destination)) {
      const temporary = path.join(/* turbopackIgnore: true */ install, 'releases', `.stage-${randomUUID()}`);
      fs.mkdirSync(temporary, { mode: 0o700 });
      try {
        for (const name of ['node', 'server', 'runtime-manifest.json']) {
          fs.cpSync(path.join(/* turbopackIgnore: true */ resources, name), path.join(/* turbopackIgnore: true */ temporary, name), { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
        }
        verifyRuntime(temporary);
        fs.renameSync(temporary, destination);
      } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    } else verifyRuntime(destination);
    const cache = path.join(/* turbopackIgnore: true */ install, 'cache', manifest.id);
    fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
    const cacheLink = path.join(/* turbopackIgnore: true */ destination, 'server/.next-desktop/cache');
    if (fs.existsSync(/* turbopackIgnore: true */ path.dirname(cacheLink)) && !fs.existsSync(/* turbopackIgnore: true */ cacheLink)) fs.symlinkSync(cache, cacheLink);
    const policy = path.join(/* turbopackIgnore: true */ resources, 'release-policy.json');
    const installedPolicy = path.join(/* turbopackIgnore: true */ install, 'release-policy.json');
    if (fs.existsSync(/* turbopackIgnore: true */ policy) && !fs.existsSync(/* turbopackIgnore: true */ installedPolicy)) atomicWriteFile(installedPolicy, fs.readFileSync(/* turbopackIgnore: true */ policy));
    if (!installedRuntime()) atomicWriteFile(path.join(/* turbopackIgnore: true */ install, 'active-release'), `${manifest.id}\n`);
    const launcher = path.join(/* turbopackIgnore: true */ install, 'launch');
    const quoted = `'${install.replaceAll("'", "'\\''")}'`;
    const installBase = `'${path.dirname(install).replaceAll("'", "'\\''")}'`;
    const script = `#!/bin/sh\n# Ri stable runtime launcher\nbase=${quoted}\nexport RI_INSTALL_ROOT=${installBase}\nIFS= read -r release < "$base/active-release" || exit 1\ncase "$release" in ''|*[!a-f0-9]*) exit 1;; esac\n[ "\${#release}" -eq 64 ] || exit 1\nruntime="$base/releases/$release"\nexport RI_RUNTIME_REPO="$runtime/server"\nexport RI_DESKTOP_REPO="$runtime/server"\nexport NEXT_DIST_DIR=.next-desktop\nunset NODE_OPTIONS ELECTRON_RUN_AS_NODE\nexport PATH="$runtime/node/bin:$PATH"\ncd "$runtime/server" || exit 1\nif [ "\${1:-}" = cli ]; then\n  shift\n  exec "$runtime/node/bin/node" dist/cli/index.mjs "$@"\nfi\nexec "$runtime/node/bin/node" dist/service/main.cjs\n`;
    if (fs.existsSync(/* turbopackIgnore: true */ launcher) && !fs.readFileSync(/* turbopackIgnore: true */ launcher, 'utf8').startsWith('#!/bin/sh\n# Ri stable runtime launcher\n')) throw new Error('The launcher path belongs to another program');
    atomicWriteFile(launcher, script);
    fs.chmodSync(launcher, 0o700);
    return installedRuntime()!;
  });
}
