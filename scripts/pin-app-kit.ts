/**
 * Pin the app kit Ri carries (docs/personal-apps.md "What Ri brings").
 *
 *   pnpm tsx scripts/pin-app-kit.ts <kit checkout> [<ref>]
 *
 * Builds the kit's core package from one commit of a kit checkout, in a copy of that commit (the
 * checkout itself is never touched), packs it, and puts the tarball in
 * `packages/app-toolchain/kit/`. It also pins the pnpm that Ri carries to the version the kit
 * writes into every app it creates, then refreshes Ri's lockfile.
 *
 * The kit's public name isn't settled, so nothing here names it: the tarball is `kit-<version>-<commit>.tgz`
 * and Ri installs it under the alias `kit`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [checkout, ref = 'main'] = process.argv.slice(2);
if (!checkout) {
  console.error('Usage: pnpm tsx scripts/pin-app-kit.ts <kit checkout> [<ref>]');
  process.exit(64);
}
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolchain = path.join(repo, 'packages/app-toolchain');
const run = (program: string, args: string[], cwd: string) => execFileSync(program, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
const read = (program: string, args: string[], cwd: string) => execFileSync(program, args, { cwd, encoding: 'utf8' }).trim();

const commit = read('git', ['rev-parse', '--verify', `${ref}^{commit}`], path.resolve(checkout));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-pin-kit-'));
try {
  console.log(`Building the kit at ${commit.slice(0, 12)} in ${work}`);
  const archive = path.join(work, 'source.tar');
  run('git', ['archive', '--format=tar', '-o', archive, commit], path.resolve(checkout));
  const source = path.join(work, 'source');
  fs.mkdirSync(source);
  run('tar', ['-xf', archive, '-C', source], work);
  run('pnpm', ['install', '--frozen-lockfile'], source);
  const core = path.join(source, 'packages/core');
  run('pnpm', ['run', 'build'], core);
  const packed = path.join(work, 'packed');
  fs.mkdirSync(packed);
  run('pnpm', ['pack', '--pack-destination', packed], core);
  const [tarball] = fs.readdirSync(packed).filter((name) => name.endsWith('.tgz'));
  if (!tarball) throw new Error('The kit didn’t pack.');

  const version = JSON.parse(fs.readFileSync(path.join(core, 'package.json'), 'utf8')).version as string;
  // The pnpm the kit writes into every app's packageManager, so the one Ri carries matches it.
  const cli = fs.readFileSync(path.join(core, 'dist/cli.js'), 'utf8');
  const pnpm = /packageManager\s*=\s*["']pnpm@([0-9][0-9A-Za-z.+-]*)["']/.exec(cli)?.[1];
  if (!pnpm) throw new Error('Couldn’t find the pnpm version the kit pins for apps.');

  const kitDir = path.join(toolchain, 'kit');
  fs.mkdirSync(kitDir, { recursive: true });
  for (const old of fs.readdirSync(kitDir).filter((name) => name.endsWith('.tgz'))) fs.rmSync(path.join(kitDir, old));
  const name = `kit-${version}-${commit.slice(0, 12)}.tgz`;
  fs.copyFileSync(path.join(packed, tarball), path.join(kitDir, name));
  fs.writeFileSync(path.join(kitDir, 'source.json'), JSON.stringify({ version, commit, pnpm }, null, 2) + '\n');

  const manifestPath = path.join(toolchain, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const previousPnpm = manifest.dependencies.pnpm;
  manifest.dependencies.kit = `file:kit/${name}`;
  manifest.dependencies.pnpm = pnpm;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  run('pnpm', ['install', '--no-frozen-lockfile'], repo);
  console.log(`Pinned the kit ${version} at ${commit.slice(0, 12)} (${name}).`);
  if (previousPnpm !== pnpm) console.log(`The pnpm Ri carries moved from ${previousPnpm} to ${pnpm}, the version the kit pins for apps.`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
