/**
 * Package an included Node app from its workspace source (apps/<name>) into a
 * portable, reviewed catalog artifact. The portable copy depends on a packed
 * app-kit tarball and its own lockfile, never on this repository's workspace
 * links, so the installed app can be rebuilt by Ri's builder on its own.
 *
 * Release-time only. Opening the catalog never runs package code.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod/v4';
import { NativeNodeDriver, runtimeEnvironment } from '@ri/app-kit/runtime';
import { appKitToolchain, buildPackage, exportPackage } from '@ri/app-kit/build';
import { archiveDigest, catalogEntrySchema } from '../src/lib/local-apps/catalog';

const exec = promisify(execFile);

/** The included Node apps and the workspace folder each is built from. */
export const INCLUDED_NODE_APPS: Record<string, string> = {
  'ri-people': 'apps/people',
  'ri-travel': 'apps/travel',
  'ri-job-search': 'apps/job-search',
};

/**
 * Catalog presentation kept beside each app's source. Digests are computed here.
 * The entry keeps the existing strict shape: a Home still running older code
 * reads this folder live, so a new field would hide its whole catalog.
 */
const catalogSource = catalogEntrySchema.pick({ name: true, description: true, source: true, license: true, capabilities: true, demo: true });

/** Files that belong in the portable source. Tests, fixtures for tests, build output and local state stay behind. */
async function copySource(from: string, to: string) {
  const skip = (relative: string) =>
    /(^|\/)(node_modules|dist|artifacts|release|\.ri-build|coverage)(\/|$)/.test(relative) ||
    /\.test\.tsx?$/.test(relative) || /(^|\/)test(\/|$)/.test(relative) ||
    /(^|\/)\.[^/]+$/.test(relative) || relative === 'catalog.json' || relative === 'vitest.config.ts';
  // tsconfig.json travels with the source: the build adapter reads its JSX runtime.
  const walk = async (relative: string) => {
    for (const entry of await fs.readdir(path.join(from, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (skip(name)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Included app source contains a symbolic link: ${name}`);
      if (entry.isDirectory()) { await fs.mkdir(path.join(to, name), { recursive: true }); await walk(name); }
      else if (entry.isFile()) await fs.copyFile(path.join(from, name), path.join(to, name));
    }
  };
  await fs.mkdir(to, { recursive: true });
  await walk('');
}

export async function packageIncludedApp(packageId: string, repository: string, catalogDir: string) {
  const relative = INCLUDED_NODE_APPS[packageId];
  if (!relative) throw new Error(`${packageId} is not an included Node app`);
  const source = path.join(repository, relative);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), `${packageId}-package-`));
  try {
    const dir = path.join(temporary, 'package');
    await copySource(source, dir);
    const manifest = JSON.parse(await fs.readFile(path.join(dir, 'plugin.json'), 'utf8'));
    if (manifest.name !== packageId) throw new Error(`${relative}/plugin.json names ${manifest.name}, expected ${packageId}`);
    const presentation = catalogSource.parse(JSON.parse(await fs.readFile(path.join(source, 'catalog.json'), 'utf8')));

    // Pin the kit as a tarball and resolve an independent lockfile, as the app template does.
    const { packageDir: kit, pnpm } = appKitToolchain();
    const vendor = path.join(dir, 'vendor');
    await fs.mkdir(vendor, { recursive: true });
    /** Pack one workspace package into vendor/ and return its tarball name. */
    const pack = async (packageDir: string) => {
      const before = new Set(await fs.readdir(vendor));
      await exec(process.execPath, [pnpm, 'pack', '--pack-destination', vendor], { cwd: packageDir, env: runtimeEnvironment(process.execPath, dir), maxBuffer: 1024 * 1024 });
      const created = (await fs.readdir(vendor)).find((file) => file.endsWith('.tgz') && !before.has(file));
      if (!created) throw new Error(`${path.basename(packageDir)} could not be packed`);
      return created;
    };
    const tarball = await pack(kit);
    // The kit's own workspace dependencies have no registry release. Pack them too
    // and pin them by override so the portable install never asks the registry.
    const kitManifest = JSON.parse(await fs.readFile(path.join(kit, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    const overrides: Record<string, string> = {};
    for (const [name, version] of Object.entries(kitManifest.dependencies ?? {})) {
      if (!version.startsWith('workspace:')) continue;
      const local = path.join(repository, 'packages', name.replace(/^@ri\//, ''));
      const declared = JSON.parse(await fs.readFile(path.join(local, 'package.json'), 'utf8')).name;
      if (declared !== name) throw new Error(`Cannot find the workspace package ${name} for the portable kit`);
      overrides[name] = `file:vendor/${await pack(local)}`;
    }
    const workspace = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    const portable = {
      name: workspace.name,
      version: workspace.version,
      private: true,
      type: 'module',
      packageManager: 'pnpm@10.33.0',
      dependencies: { ...workspace.dependencies, '@ri/app-kit': `file:vendor/${tarball}` },
      ...(Object.keys(overrides).length ? { pnpm: { overrides } } : {}),
    };
    if (portable.version !== manifest.version) throw new Error(`${relative} package.json and plugin.json versions differ`);
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(portable, null, 2) + '\n');
    await exec(process.execPath, [pnpm, 'install', '--lockfile-only', '--ignore-scripts'], { cwd: dir, env: runtimeEnvironment(process.execPath, dir), timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });

    const workflows = await bundledWorkflows(dir);
    const artifact = await buildPackage({ packageDir: dir, driver: new NativeNodeDriver(process.execPath), workflows, onOutput: (text) => process.stdout.write(text) });
    await fs.mkdir(catalogDir, { recursive: true });
    const archive = path.join(catalogDir, `${packageId}.tar.gz`);
    await exportPackage(artifact, archive);
    // Keep the generated contract beside the source so reviews see contract changes.
    await fs.copyFile(path.join(dir, 'contract.json'), path.join(source, 'contract.json'));
    const entry = catalogEntrySchema.parse({
      formatVersion: 1, packageId, version: manifest.version, ...presentation, hostApi: 1, runtime: 'ri-ipc-v1', target: null,
      artifactDigest: artifact.digest, archiveDigest: await archiveDigest(archive),
    });
    await fs.writeFile(path.join(catalogDir, `${packageId}.json`), JSON.stringify(entry, null, 2));
    return { entry, archive };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

/** Bundled workflow skills: skills/<name>/SKILL.md with name and description front matter. */
async function bundledWorkflows(dir: string) {
  const root = path.join(dir, 'skills');
  const names = await fs.readdir(root).catch(() => [] as string[]);
  const workflows: { name: string; description: string; file: string }[] = [];
  for (const name of names.sort()) {
    const file = `skills/${name}/SKILL.md`;
    const text = await fs.readFile(path.join(dir, file), 'utf8').catch(() => null);
    if (!text) continue;
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim().replace(/^["']|["']$/g, '');
    const declared = /^name:\s*(.+)$/m.exec(front)?.[1]?.trim();
    const parsed = z.object({ name: z.string().regex(/^[a-z][a-z0-9-]*$/), description: z.string().min(1).max(2000) }).parse({ name: declared ?? name, description });
    workflows.push({ ...parsed, file });
  }
  return workflows;
}
