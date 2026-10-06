#!/usr/bin/env tsx
/**
 * `pnpm release [<commit>]`: build a production release of Ri, without
 * touching the production that's running.
 *
 * Production runs from a release build, never from this checkout, so
 * editing, building and installing here (by you or any agent) can't change
 * what production serves or which migrations reach its database. This:
 *
 * 1. Resolves the commit (default: `main`). Only committed work ships.
 * 2. Checks it out as its own detached worktree in
 *    `~/ri-release/builds/<sha>` (or reuses a finished build of it).
 * 3. Installs dependencies from the lockfile and builds the CLI and Next,
 *    against a throwaway build home, so nothing at build time can open the
 *    production database.
 * 4. Points `~/ri-release/next` at it, installs `ri-prod`, and prints what
 *    changed since the live release, including database migrations.
 *
 * Going live is a separate step you run where production runs: stop it, then
 * `ri-prod start`. See docs/environments.md.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pc from 'picocolors';

const RELEASE_DIR = path.resolve(process.env.RI_RELEASE_DIR ?? path.join(os.homedir(), 'ri-release'));
const BUILDS = path.join(RELEASE_DIR, 'builds');
const KEEP_OTHER_BUILDS = 2;

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fail(message: string): never {
  console.error(pc.red(`release: ${message}`));
  process.exit(1);
}

/** The real folder a release link points at, or null. */
function linkTarget(name: string): string | null {
  try {
    return fs.realpathSync(path.join(RELEASE_DIR, name));
  } catch {
    return null;
  }
}

/** Replace a release link in one step. */
function setLink(name: string, target: string): void {
  const tmp = path.join(RELEASE_DIR, `.${name}.tmp.${process.pid}`);
  fs.rmSync(tmp, { force: true });
  fs.symlinkSync(target, tmp);
  fs.renameSync(tmp, path.join(RELEASE_DIR, name));
}

interface ReleaseInfo {
  sha: string;
  short: string;
  subject: string;
  committedAt: string;
  builtAt: string;
  node: string;
  migrations: string[];
}

function readInfo(dir: string | null): ReleaseInfo | null {
  if (!dir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, '.ri-release.json'), 'utf8')) as ReleaseInfo;
  } catch {
    return null;
  }
}

function journalTags(dir: string): string[] {
  const journal = JSON.parse(fs.readFileSync(path.join(dir, 'drizzle/meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
  return journal.entries.map((e) => e.tag);
}

/** Run a build step in the release folder, streaming its output. */
function step(label: string, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  console.log(pc.dim(`→ ${label}`));
  const res = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (res.status !== 0) fail(`${label} failed (exit ${res.status ?? res.signal}). The release folder is left for inspection: ${cwd}`);
}

const repo = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return fail('run this from the Ri checkout.');
  }
})();

const ref = process.argv[2] ?? 'main';
let sha: string;
try {
  sha = git(['rev-parse', '--verify', `${ref}^{commit}`]);
} catch {
  fail(`no commit named ${ref}.`);
}
const short = sha.slice(0, 12);
const buildDir = path.join(BUILDS, short);
try {
  git(['merge-base', '--is-ancestor', sha, 'main']);
} catch {
  console.log(pc.yellow(`Note: ${short} is not on main. Releasing it anyway.`));
}

fs.mkdirSync(BUILDS, { recursive: true });
const current = linkTarget('current');
const currentInfo = readInfo(current);

if (readInfo(buildDir)?.sha === sha) {
  console.log(pc.green(`${short} is already built. Reusing ${buildDir}`));
} else {
  // A half-made folder from an earlier attempt goes first.
  if (fs.existsSync(buildDir)) {
    if (buildDir === current) fail(`${buildDir} is the live release but looks incomplete. Inspect it before releasing over it.`);
    try { git(['worktree', 'remove', '--force', buildDir]); } catch { /* not a worktree any more */ }
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  console.log(pc.bold(`Building ${short} (${git(['log', '-1', '--format=%s', sha])})`));
  git(['worktree', 'add', '--detach', buildDir, sha]);

  // A clean environment: no data-root overrides, no harness session identity,
  // and a throwaway home for anything the build opens.
  const buildHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-release-build-'));
  const env: NodeJS.ProcessEnv = { ...process.env, RI_ROOT: buildHome, NODE_ENV: 'production', CI: '1' };
  for (const name of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR', 'RI_SESSION_CREDENTIAL', 'RI_SESSION_CLI', 'RI_RUNTIME_REPO', 'PORT', 'NEXT_DIST_DIR']) delete env[name];
  try {
    step('Install dependencies (lockfile)', 'pnpm', ['install', '--frozen-lockfile', '--prod=false'], buildDir, { ...env, NODE_ENV: 'development' });
    // Next directly, not through pnpm: pnpm's binary has crashed mid-build
    // before and left a half-written .next behind.
    step('Build the app', path.join(buildDir, 'node_modules/.bin/next'), ['build'], buildDir, env);
  } finally {
    fs.rmSync(buildHome, { recursive: true, force: true });
  }
  for (const required of ['dist/cli/index.mjs', 'dist/service/http-server.cjs', '.next/BUILD_ID']) {
    if (!fs.existsSync(path.join(buildDir, required))) fail(`the build has no ${required}. Left for inspection: ${buildDir}`);
  }
  const info: ReleaseInfo = {
    sha,
    short,
    subject: git(['log', '-1', '--format=%s', sha]),
    committedAt: git(['log', '-1', '--format=%cI', sha]),
    builtAt: new Date().toISOString(),
    node: process.version,
    migrations: journalTags(buildDir),
  };
  fs.writeFileSync(path.join(buildDir, '.ri-release.json'), JSON.stringify(info, null, 2) + '\n');
}

// ── Ready it ──────────────────────────────────────────────────────────
const info = readInfo(buildDir)!;
if (buildDir === current) {
  fs.rmSync(path.join(RELEASE_DIR, 'next'), { force: true });
} else {
  setLink('next', buildDir);
}

// ri-prod, from this release, in the release folder and on PATH.
fs.mkdirSync(path.join(RELEASE_DIR, 'bin'), { recursive: true });
for (const name of ['ri-prod', 'ri']) {
  const dest = path.join(RELEASE_DIR, 'bin', name);
  // The release's own copy, or this checkout's for a commit from before them.
  const own = path.join(buildDir, 'scripts/release', `${name}.sh`);
  fs.copyFileSync(fs.existsSync(own) ? own : path.join(repo, 'scripts/release', `${name}.sh`), dest);
  fs.chmodSync(dest, 0o755);
}
const bin = path.resolve(process.env.RI_BIN_DIR ?? path.join(os.homedir(), '.local/bin'));
const prodLink = path.join(bin, 'ri-prod');
fs.mkdirSync(bin, { recursive: true });
let linked = false;
try {
  const existing = fs.lstatSync(prodLink);
  linked = existing.isSymbolicLink() && fs.readlinkSync(prodLink) === path.join(RELEASE_DIR, 'bin', 'ri-prod');
  if (!linked && fs.readFileSync(prodLink, 'utf8').includes('ri-managed: release-prod')) {
    fs.rmSync(prodLink);
    throw Object.assign(new Error('replace'), { code: 'ENOENT' });
  }
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  fs.symlinkSync(path.join(RELEASE_DIR, 'bin', 'ri-prod'), prodLink);
  linked = true;
}

// Old builds go, except the ones a link names and the newest few.
const keep = new Set([current, linkTarget('previous'), buildDir].filter(Boolean) as string[]);
const others = fs.readdirSync(BUILDS)
  .map((name) => path.join(BUILDS, name))
  .filter((dir) => !keep.has(dir) && fs.statSync(dir).isDirectory())
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
for (const dir of others.slice(KEEP_OTHER_BUILDS)) {
  try { git(['worktree', 'remove', '--force', dir]); } catch { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(pc.dim(`  removed old build ${path.basename(dir)}`));
}

// ── Report ────────────────────────────────────────────────────────────
console.log();
if (buildDir === current) {
  console.log(pc.green(`${short} is already live.`));
  process.exit(0);
}
console.log(pc.green(pc.bold(`Ready: ${short}  ${info.subject}`)));
if (currentInfo) {
  const log = git(['log', '--oneline', '--no-decorate', `${currentInfo.sha}..${sha}`]);
  const count = log ? log.split('\n').length : 0;
  console.log(pc.dim(`Live is ${currentInfo.short}. ${count} commit(s) since:`));
  if (log) console.log(log.split('\n').slice(0, 25).map((l) => `  ${l}`).join('\n') + (count > 25 ? `\n  …and ${count - 25} more` : ''));
  const added = info.migrations.filter((tag) => !currentInfo.migrations.includes(tag));
  if (added.length) console.log(pc.yellow(`Database migrations: ${added.join(', ')}. ri-prod backs up the database before applying them.`));
} else {
  console.log(pc.dim('This is the first release. Production still runs from a checkout until you switch.'));
}
console.log();
console.log(`Go live where production runs: stop it (Ctrl-C in its terminal), then ${pc.bold('ri-prod start')}`);
if (!linked) console.log(pc.dim(`(${prodLink} exists and isn't ours, so run ${path.join(RELEASE_DIR, 'bin', 'ri-prod')} instead.)`));
