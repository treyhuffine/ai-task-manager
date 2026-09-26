import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';
import { getRuntimeInstallDir } from './paths';

interface RuntimeFile { name: string; sha256?: string; link?: string; executable: boolean }
export interface RuntimeManifest {
  format: 1; id: string; version: string; platform: string; arch: string; node: string; files: RuntimeFile[];
}

export { getRuntimeInstallDir } from './paths';

function digestFile(file: string) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let count: number;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}

function inventory(root: string): RuntimeFile[] {
  const files: RuntimeFile[] = [];
  const physicalRoot = fs.realpathSync(root);
  function walk(relative: string) {
    // Next's image/data cache is writable state, kept outside release files.
    if (relative === 'server/.next-desktop/cache') return;
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const link = fs.readlinkSync(absolute);
      const target = fs.realpathSync(absolute);
      if (path.isAbsolute(link) || !target.startsWith(`${physicalRoot}${path.sep}`)) throw new Error(`Runtime link escapes its package: ${relative}`);
      files.push({ name: relative, link, executable: false });
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) walk(path.join(relative, name));
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
  const pkg = JSON.parse(fs.readFileSync(path.join(resources, 'server/package.json'), 'utf8'));
  const content = { format: 1 as const, version: pkg.version as string, platform: process.platform, arch: process.arch,
    node: process.versions.node, files: inventory(resources) };
  const manifest = { ...content, id: manifestId(content) };
  atomicWriteFile(path.join(resources, 'runtime-manifest.json'), JSON.stringify(manifest));
  return manifest;
}

export function verifyRuntime(resources: string): RuntimeManifest {
  const manifest = JSON.parse(fs.readFileSync(path.join(resources, 'runtime-manifest.json'), 'utf8')) as RuntimeManifest;
  const { id, ...content } = manifest;
  if (manifest.format !== 1 || !/^[a-f0-9]{64}$/.test(id) || manifestId(content) !== id) throw new Error('Invalid runtime manifest');
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('Runtime does not match this computer');
  if (JSON.stringify(inventory(resources)) !== JSON.stringify(manifest.files)) throw new Error('Runtime files do not match the manifest');
  for (const required of ['node/bin/node', 'server/dist/service/main.cjs', 'server/dist/service/http-server.cjs', 'server/dist/service/handoff.cjs', 'server/dist/service/runtime-job.cjs', 'server/dist/cli/index.mjs']) {
    if (!manifest.files.some(file => file.name === required && file.sha256)) throw new Error(`Runtime missing ${required}`);
  }
  return manifest;
}

export function installedRuntime() {
  const install = getRuntimeInstallDir();
  const active = path.join(install, 'active-release');
  if (!fs.existsSync(active)) return null;
  const id = fs.readFileSync(active, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid active runtime selection');
  const directory = path.join(install, 'releases', id);
  return { id, directory, repo: path.join(directory, 'server'), node: path.join(directory, 'node/bin/node'), launcher: path.join(install, 'launch') };
}

/** A bundled runtime is trusted through the signed application distribution.
 * Downloaded runtimes additionally require publisher verification before this
 * step. Staging never replaces an already selected running runtime. */
export function stageRuntime(resources: string) {
  const manifest = verifyRuntime(resources);
  const install = getRuntimeInstallDir();
  fs.mkdirSync(path.join(install, 'releases'), { recursive: true, mode: 0o700 });
  return withFileLock(path.join(install, 'stage'), () => {
    const destination = path.join(install, 'releases', manifest.id);
    if (!fs.existsSync(destination)) {
      const temporary = path.join(install, 'releases', `.stage-${randomUUID()}`);
      fs.mkdirSync(temporary, { mode: 0o700 });
      try {
        for (const name of ['node', 'server', 'runtime-manifest.json']) {
          fs.cpSync(path.join(resources, name), path.join(temporary, name), { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
        }
        verifyRuntime(temporary);
        fs.renameSync(temporary, destination);
      } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    } else verifyRuntime(destination);
    const cache = path.join(install, 'cache', manifest.id);
    fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
    const cacheLink = path.join(destination, 'server/.next-desktop/cache');
    if (fs.existsSync(path.dirname(cacheLink)) && !fs.existsSync(cacheLink)) fs.symlinkSync(cache, cacheLink);
    const policy = path.join(resources, 'release-policy.json');
    const installedPolicy = path.join(install, 'release-policy.json');
    if (fs.existsSync(policy) && !fs.existsSync(installedPolicy)) atomicWriteFile(installedPolicy, fs.readFileSync(policy));
    if (!installedRuntime()) atomicWriteFile(path.join(install, 'active-release'), `${manifest.id}\n`);
    const launcher = path.join(install, 'launch');
    const quoted = `'${install.replaceAll("'", "'\\''")}'`;
    const installBase = `'${path.dirname(install).replaceAll("'", "'\\''")}'`;
    const script = `#!/bin/sh\n# Ri stable runtime launcher\nbase=${quoted}\nexport RI_INSTALL_ROOT=${installBase}\nIFS= read -r release < "$base/active-release" || exit 1\ncase "$release" in ''|*[!a-f0-9]*) exit 1;; esac\n[ "\${#release}" -eq 64 ] || exit 1\nruntime="$base/releases/$release"\nexport RI_RUNTIME_REPO="$runtime/server"\nexport RI_DESKTOP_REPO="$runtime/server"\nexport NEXT_DIST_DIR=.next-desktop\nunset NODE_OPTIONS ELECTRON_RUN_AS_NODE\nexport PATH="$runtime/node/bin:$PATH"\ncd "$runtime/server" || exit 1\nif [ "\${1:-}" = cli ]; then\n  shift\n  exec "$runtime/node/bin/node" dist/cli/index.mjs "$@"\nfi\nexec "$runtime/node/bin/node" dist/service/main.cjs\n`;
    if (fs.existsSync(launcher) && !fs.readFileSync(launcher, 'utf8').startsWith('#!/bin/sh\n# Ri stable runtime launcher\n')) throw new Error('The launcher path belongs to another program');
    atomicWriteFile(launcher, script);
    fs.chmodSync(launcher, 0o700);
    return installedRuntime()!;
  });
}
