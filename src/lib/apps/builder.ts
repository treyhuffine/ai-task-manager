/**
 * New app and Change app (docs/personal-apps.md "Building and changing apps"; shared spec §2).
 *
 * New app runs the app kit's `create` into a new folder in the apps folder, as its own git
 * repository, and makes the first commit. The builder agent works there with the kit's build
 * skill. Install and connect runs the kit's `serve --install`, which installs a checked copy of a
 * commit as the person's own background service, then connects Ri to it with OAuth.
 *
 * Change app gives the builder a separate working copy on a branch. Apply runs the kit's
 * safe-change command (`change <commit>`), which checks the commit with disposable data and
 * fixture connectors, rehearses it on a copy of the live data, and only then switches over,
 * rolling back build and data together if the switch fails. Ri never starts an app itself, never
 * runs the folder being edited, and never opens an app's data directory.
 *
 * The kit's name isn't settled, so Ri never assumes it: New app runs the copy of the kit Ri carries
 * (toolchain.ts) by the command its package names, and inside an app Ri runs the kit's command the
 * way the app's own `start` script names it. Every command runs with Ri's own Node and pnpm, so the
 * person needs no developer tools (docs/personal-apps.md "What Ri brings").
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { readAuthConfig, writeAuthConfig } from '@/lib/auth/config-file';
import { getAppRoot, getWorkDir } from '@/lib/config/paths';
import { createAppSource, getAppSource, listAppSources, updateAppSource, type AppSourceRecord } from '@/lib/db/queries';
import { processState } from '@/lib/process-state';
import { untraced } from '@/lib/utils/untraced';
import { toSlug } from '@/lib/integrations/mcp-servers';
import { appToolchain, gitHelp, type AppToolchain } from './toolchain';
import { catalogEntry, catalogRef } from './catalog-entries';

const run = promisify(execFile);

export class AppBuildError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'conflict' | 'setup', message: string) {
    super(message);
    this.name = 'AppBuildError';
  }
}

// ─── Settings ───────────────────────────────────────────────────────────────

export interface AppBuildSettings {
  /** Where New app makes apps. */
  appsDir: string;
  /** The default, when the person hasn't chosen one. */
  defaultAppsDir: string;
  /**
   * A developer override: a command that runs a kit checkout's `create`, used instead of the kit Ri
   * carries. Null to use the carried kit.
   */
  appKitCommand: string | null;
  /** What Ri brings for apps on this computer (toolchain.ts). */
  tools: {
    node: string;
    pnpm: string | null;
    kit: { version: string; commit: string | null } | null;
    git: boolean;
    /** How to get git, when there's none. */
    gitHelp: string | null;
  };
}

export function appBuildSettings(): AppBuildSettings {
  const config = readAuthConfig();
  const defaultAppsDir = path.join(/* turbopackIgnore: true */ getAppRoot(), 'apps');
  const tools = appToolchain();
  return {
    appsDir: config?.appsDir || defaultAppsDir, defaultAppsDir, appKitCommand: config?.appKitCommand || null,
    tools: {
      node: process.version,
      pnpm: tools.pnpm?.version ?? null,
      kit: tools.kit ? { version: tools.kit.version, commit: tools.kit.commit } : null,
      git: !!tools.git,
      gitHelp: tools.git ? null : gitHelp(),
    },
  };
}

export function setAppBuildSettings(input: { appsDir?: string | null; appKitCommand?: string | null }): AppBuildSettings {
  const patch: { appsDir?: string | null; appKitCommand?: string | null } = {};
  if (input.appsDir !== undefined) {
    const dir = input.appsDir?.trim() || null;
    if (dir && !path.isAbsolute(dir)) throw new AppBuildError('invalid', 'Use a full path for the apps folder, like /Users/you/apps.');
    patch.appsDir = dir;
  }
  if (input.appKitCommand !== undefined) {
    const command = input.appKitCommand?.trim() || null;
    if (command && (command.length > 500 || /[\n\r]/.test(command))) throw new AppBuildError('invalid', 'Use one line for the app kit command.');
    patch.appKitCommand = command;
  }
  writeAuthConfig(patch);
  return appBuildSettings();
}

// ─── Running the kit ────────────────────────────────────────────────────────

export type KitStepStatus = 'started' | 'passed' | 'failed' | 'skipped';
export interface KitStep { step: string; status: KitStepStatus; detail?: string }
export type KitOutcome = 'switched' | 'unchanged' | 'checks_failed' | 'rolled_back' | 'rollback_failed' | 'refused'
  // start, stop and restart (status.ts)
  | 'started' | 'running' | 'stopped' | 'restarted' | 'failed';
export interface KitResult { outcome: KitOutcome; message: string; release?: string; previous?: string; log?: string }

export interface AppJob {
  id: string;
  sourceId: string;
  kind: 'create' | 'install' | 'change' | 'restart';
  state: 'running' | 'done' | 'failed';
  steps: KitStep[];
  result?: KitResult;
  /** A short reason when the job failed before the kit answered. */
  error?: string;
  /** After install: where the person allows Ri's connection on the app's consent screen. */
  authUrl?: string;
  startedAt: string;
  finishedAt?: string;
}

const jobs = () => processState('apps.builder.jobs', () => new Map<string, AppJob>());

export function getAppJob(id: string): AppJob | null {
  return jobs().get(id) ?? null;
}

export function latestAppJob(sourceId: string): AppJob | null {
  return [...jobs().values()].filter((job) => job.sourceId === sourceId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
}

export function newJob(sourceId: string, kind: AppJob['kind']): AppJob {
  if ([...jobs().values()].some((job) => job.sourceId === sourceId && job.state === 'running')) {
    throw new AppBuildError('conflict', 'Something is already running for this app. Wait for it to finish.');
  }
  const job: AppJob = { id: crypto.randomUUID(), sourceId, kind, state: 'running', steps: [], startedAt: new Date().toISOString() };
  jobs().set(job.id, job);
  return job;
}

/** One line of the kit's `--json` output, folded into the job. */
export function foldKitLine(job: Pick<AppJob, 'steps' | 'result'>, line: string): void {
  let event: { event?: string; step?: string; status?: string; detail?: string; outcome?: string; message?: string; release?: string; previous?: string; log?: string };
  try { event = JSON.parse(line); } catch { return; }
  if (event.event === 'step' && event.step && ['started', 'passed', 'failed', 'skipped'].includes(event.status ?? '')) {
    const existing = job.steps.find((step) => step.step === event.step);
    const next: KitStep = { step: event.step, status: event.status as KitStepStatus, ...(event.detail ? { detail: String(event.detail).slice(0, 500) } : {}) };
    if (existing) Object.assign(existing, next); else job.steps.push(next);
  } else if (event.event === 'result' && event.outcome) {
    job.result = {
      outcome: event.outcome as KitOutcome, message: String(event.message ?? '').slice(0, 1000),
      ...(event.release ? { release: String(event.release) } : {}), ...(event.previous ? { previous: String(event.previous) } : {}), ...(event.log ? { log: String(event.log) } : {}),
    };
  }
}

/** The kit's command inside an app, as its own `start` script names it (`<cli> serve`). */
export function kitCliFor(folder: string): string {
  let pkg: { scripts?: Record<string, string> };
  try { pkg = JSON.parse(fs.readFileSync(path.join(/* turbopackIgnore: true */ folder, 'package.json'), 'utf8')); }
  catch { throw new AppBuildError('setup', 'This folder has no package.json. Is it an app made with the app kit?'); }
  const cli = pkg.scripts?.start?.trim().split(/\s+/)[0];
  if (!cli || !/^[A-Za-z0-9@/._-]+$/.test(cli) || !/\bserve\b/.test(pkg.scripts?.start ?? '')) {
    throw new AppBuildError('setup', 'This app’s start script doesn’t run the app kit’s serve, so Ri can’t tell how to install it.');
  }
  return cli;
}

/** A free port on this computer for a new app to serve on. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No port')));
    });
  });
}

/**
 * Run a command in an app's folder with Ri's toolchain first on its PATH, feeding each output line to
 * `onLine`. Resolves with its exit code.
 */
export function runIn(tools: AppToolchain, folder: string, command: string, args: readonly string[], env: Record<string, string>, onLine: (line: string) => void): Promise<{ code: number; tail: string }> {
  return new Promise((resolve) => {
    const child = spawn(untraced(command), args, { cwd: folder, env: { ...process.env, ...tools.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '', tail = '';
    const take = (chunk: Buffer, lines: boolean) => {
      const text = chunk.toString('utf8');
      tail = (tail + text).slice(-4000);
      if (!lines) return;
      buffer += text;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) { onLine(buffer.slice(0, at).trim()); buffer = buffer.slice(at + 1); }
    };
    child.stdout.on('data', (chunk: Buffer) => take(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => take(chunk, false));
    child.on('error', (error) => resolve({ code: 127, tail: error.message }));
    child.on('close', (code) => { if (buffer.trim()) onLine(buffer.trim()); resolve({ code: code ?? 1, tail }); });
  });
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * The app's own dependencies, so its kit command can run. Only installs from its lockfile, and
 * runs nothing of the app. The kit installs a release's dependencies again in its own copy.
 */
async function prepare(tools: AppToolchain, job: AppJob, folder: string): Promise<boolean> {
  if (fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ folder, 'node_modules', '.bin'))) return true;
  const step: KitStep = { step: 'prepare', status: 'started' };
  job.steps.push(step);
  const { code, tail } = await runIn(tools, folder, pnpmCommand(tools), ['install', '--frozen-lockfile', '--prefer-offline'], {}, () => {});
  Object.assign(step, code === 0 ? { status: 'passed' } : { status: 'failed', detail: tail.slice(-500) });
  if (code !== 0) finish(job, 'failed', `Installing the app’s dependencies failed: ${tail.trim().split('\n').pop() ?? ''}`);
  return code === 0;
}

/** The carried pnpm, or the computer's when this copy of Ri carries none. */
export function pnpmCommand(tools: AppToolchain): string {
  return tools.pnpm?.command ?? 'pnpm';
}

/** Ri's toolchain, refusing up front when there's no git, which every app needs. */
export function toolsWithGit(): AppToolchain & { git: string } {
  const tools = appToolchain();
  if (!tools.git) throw new AppBuildError('setup', gitHelp());
  return tools as AppToolchain & { git: string };
}

export async function git(folder: string, args: string[], tools: AppToolchain & { git: string } = toolsWithGit()) {
  return run(untraced(tools.git), args, { cwd: folder, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...tools.env } });
}

/**
 * Commits need a name. When the computer has none set for git (someone without developer tools), the
 * app's repository gets its own, so the builder's commits work there.
 */
export async function ensureCommitIdentity(folder: string, tools: AppToolchain & { git: string }) {
  const set = async (key: string) => { try { return !!(await git(folder, ['config', '--get', key], tools)).stdout.trim(); } catch { return false; } };
  if (!await set('user.name')) await git(folder, ['config', 'user.name', 'Ri'], tools);
  if (!await set('user.email')) await git(folder, ['config', 'user.email', 'ri@localhost'], tools);
}

// ─── New app ────────────────────────────────────────────────────────────────

/** Run the kit's `create` into a new folder in the apps folder, as its own repository with a first commit. */
export async function createApp(input: { name: string }): Promise<AppSourceRecord> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  const slug = toSlug(name).replace(/_/g, '-');
  if (!name || !slug) throw new AppBuildError('invalid', 'Name the app with letters or numbers.');
  const settings = appBuildSettings();
  const tools = toolsWithGit();
  if (!settings.appKitCommand && !tools.kit) throw new AppBuildError('setup', 'This copy of Ri carries no app kit. Set the app kit command to a kit checkout’s create.');
  const folder = path.join(/* turbopackIgnore: true */ settings.appsDir, slug);
  if (fs.existsSync(/* turbopackIgnore: true */ folder)) throw new AppBuildError('conflict', `${folder} already exists. Choose another name.`);
  if (listAppSources().some((source) => source.folder === folder)) throw new AppBuildError('conflict', 'Ri already has an app there.');
  fs.mkdirSync(/* turbopackIgnore: true */ settings.appsDir, { recursive: true });
  const source = createAppSource({ name, folder, createdByRi: true });
  const job = newJob(source.id, 'create');
  job.steps.push({ step: 'create', status: 'started' });
  // The developer override runs a kit checkout through the shell. Otherwise Ri's Node runs the kit Ri carries.
  const created = settings.appKitCommand
    ? await runIn(tools, settings.appsDir, '/bin/sh', ['-c', `${settings.appKitCommand} ${quote(folder)}`], {}, () => {})
    : await runIn(tools, settings.appsDir, tools.node, [tools.kit!.bin, 'create', folder], {}, () => {});
  const step = job.steps[0]!;
  if (created.code !== 0 || !fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ folder, 'package.json'))) {
    Object.assign(step, { status: 'failed', detail: created.tail.slice(-500) });
    finish(job, 'failed', `The app kit’s create didn’t make the app: ${created.tail.trim().split('\n').pop() ?? 'no output'}`);
    throw new AppBuildError('setup', job.error!);
  }
  Object.assign(step, { status: 'passed' });
  // The kit's create makes a repository. Make sure, and commit what it wrote as the starting point.
  if (!fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ folder, '.git'))) await git(folder, ['init', '-q', '-b', 'main'], tools);
  await ensureCommitIdentity(folder, tools);
  await git(folder, ['add', '-A'], tools);
  const { stdout } = await git(folder, ['status', '--porcelain'], tools);
  if (stdout.trim()) await git(folder, ['-c', 'user.name=Ri', '-c', 'user.email=ri@localhost', 'commit', '-q', '-m', `Create ${name} from the app kit`], tools);
  finish(job, 'done');
  return source;
}

/** Record where an app Ri didn't make keeps its source, so Ri can fix it later. */
export function recordAppSource(input: { personalAppId: string; name: string; folder?: string | null; gitUrl?: string | null; notes?: string | null }): AppSourceRecord {
  const folder = input.folder?.trim() || null;
  if (folder && !path.isAbsolute(folder)) throw new AppBuildError('invalid', 'Use a full path for the folder.');
  if (!folder && !input.gitUrl?.trim()) throw new AppBuildError('invalid', 'Give its folder or its git URL.');
  return createAppSource({ name: input.name, folder, gitUrl: input.gitUrl?.trim() || null, notes: input.notes?.trim() || null, personalAppId: input.personalAppId, createdByRi: false });
}

// ─── Install and connect ────────────────────────────────────────────────────

type RequestLike = Pick<Request, 'headers' | 'url'>;

/**
 * Install the app as a background service with the kit's `serve --install`, on a port Ri picks,
 * then add it to Ri, which opens the app's consent screen for Ri's own connection.
 */
export async function installApp(sourceId: string, request?: RequestLike, returnTo?: string): Promise<AppJob> {
  const source = requireFolder(sourceId);
  const cli = kitCliFor(source.folder!);
  const tools = toolsWithGit();
  const job = newJob(source.id, 'install');
  void (async () => {
    try {
      if (!await prepare(tools, job, source.folder!)) return;
      const port = await freePort();
      const { code, tail } = await runIn(tools, source.folder!, pnpmCommand(tools), ['exec', cli, 'serve', '--install', 'HEAD', '--json'], { PORT: String(port), APP_HOST: '127.0.0.1' }, (line) => foldKitLine(job, line));
      if (code !== 0 || job.result?.outcome !== 'switched' && job.result?.outcome !== 'unchanged') {
        return finish(job, 'failed', job.result?.message || `The app kit’s install failed: ${tail.trim().split('\n').pop() ?? ''}`);
      }
      const url = `http://127.0.0.1:${port}/mcp`;
      updateAppSource(source.id, { url });
      const { addPersonalApp } = await import('@/lib/integrations/apps');
      const added = await addPersonalApp({ name: source.name, url, ...(returnTo ? { returnTo } : {}) }, request);
      updateAppSource(source.id, { personalAppId: added.app.id });
      if (added.requiresAuth) job.authUrl = added.authUrl;
      finish(job, 'done');
    } catch (error) {
      finish(job, 'failed', error instanceof Error ? error.message : String(error));
    }
  })();
  return job;
}

// ─── Change app ─────────────────────────────────────────────────────────────

/** A separate working copy on a new branch, where the builder makes a change. */
export async function startChange(sourceId: string): Promise<AppSourceRecord> {
  const source = requireFolder(sourceId);
  if (source.changeFolder && fs.existsSync(/* turbopackIgnore: true */ source.changeFolder)) return source;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  const branch = `change/${stamp}`;
  const changes = path.join(/* turbopackIgnore: true */ getWorkDir(), 'app-changes');
  fs.mkdirSync(/* turbopackIgnore: true */ changes, { recursive: true });
  const folder = path.join(/* turbopackIgnore: true */ changes, `${path.basename(source.folder!)}-${stamp}`);
  await git(source.folder!, ['worktree', 'add', '-q', '-b', branch, folder, 'HEAD']);
  return updateAppSource(source.id, { changeFolder: folder, changeBranch: branch })!;
}

/**
 * Switch the running app to the change's last commit with the kit's safe-change command. When it
 * switched, the app's folder moves to that commit and the working copy goes. When its checks
 * failed, nothing changed and the working copy stays for the builder to fix.
 */
export async function applyChange(sourceId: string): Promise<AppJob> {
  const source = requireFolder(sourceId);
  if (!source.changeBranch || !source.changeFolder) throw new AppBuildError('invalid', 'There’s no change to apply. Start one first.');
  const { stdout: dirty } = await git(source.changeFolder, ['status', '--porcelain']);
  if (dirty.trim()) throw new AppBuildError('invalid', 'The change has uncommitted edits. Ask the builder to commit them first.');
  const { stdout: head } = await git(source.folder!, ['rev-parse', source.changeBranch]);
  return switchTo(source, head.trim());
}

/**
 * Switch the running app to `commit` with the kit's safe-change command, as a job. When it switched,
 * the app's folder moves to that commit and any change's working copy goes.
 */
export function switchTo(source: AppSourceRecord, commit: string): AppJob {
  const cli = kitCliFor(source.folder!);
  const tools = toolsWithGit();
  const job = newJob(source.id, 'change');
  void (async () => {
    try {
      if (!await prepare(tools, job, source.folder!)) return;
      const { code, tail } = await runIn(tools, source.folder!, pnpmCommand(tools), ['exec', cli, 'change', commit, '--json'], {}, (line) => foldKitLine(job, line));
      const outcome = job.result?.outcome;
      if (code === 0 && (outcome === 'switched' || outcome === 'unchanged')) {
        await settleChange(source, commit);
        return finish(job, 'done');
      }
      finish(job, 'failed', job.result?.message || `The app kit’s change failed: ${tail.trim().split('\n').pop() ?? ''}`);
    } catch (error) {
      finish(job, 'failed', error instanceof Error ? error.message : String(error));
    }
  })();
  return job;
}

/** After a switch: bring the app's folder to the running commit when it can, and drop the working copy. */
async function settleChange(source: AppSourceRecord, commit: string) {
  try {
    const { stdout } = await git(source.folder!, ['status', '--porcelain']);
    if (!stdout.trim()) await git(source.folder!, ['merge', '-q', '--ff-only', commit]);
  } catch { /* The folder moved on its own. The branch keeps the change. */ }
  if (source.changeFolder) { try { await git(source.folder!, ['worktree', 'remove', '--force', source.changeFolder]); } catch { /* Already gone. */ } }
  updateAppSource(source.id, { changeFolder: null, changeBranch: null });
  await recordCatalogVersion(source, commit);
}

/**
 * For an app from the catalog: once the running commit includes the catalog's current version (an
 * update switched over, or the builder merged it into a change), record that version.
 */
export async function recordCatalogVersion(source: AppSourceRecord, running: string): Promise<boolean> {
  if (!source.catalogId || !source.folder) return false;
  let entry;
  try { entry = catalogEntry(source.catalogId); } catch { return false; }
  if (!entry || entry.version === source.catalogVersion) return false;
  try {
    const { stdout } = await git(source.folder, ['rev-parse', '-q', '--verify', `${catalogRef(entry.version)}^{commit}`]);
    const target = stdout.trim();
    await git(source.folder, ['merge-base', '--is-ancestor', target, running]);
    updateAppSource(source.id, { catalogVersion: entry.version, catalogCommit: target });
    return true;
  } catch {
    // Not fetched here yet, or not included in what's running.
    return false;
  }
}

/** Drop a change without applying it. Its branch stays in the app's repository. */
export async function discardChange(sourceId: string): Promise<AppSourceRecord> {
  const source = requireFolder(sourceId);
  if (source.changeFolder) { try { await git(source.folder!, ['worktree', 'remove', '--force', source.changeFolder]); } catch { /* Already gone. */ } }
  return updateAppSource(source.id, { changeFolder: null, changeBranch: null })!;
}

export function requireFolder(sourceId: string): AppSourceRecord {
  const source = getAppSource(sourceId);
  if (!source) throw new AppBuildError('not_found', 'That app isn’t in Ri anymore.');
  if (!source.folder || !fs.existsSync(/* turbopackIgnore: true */ source.folder)) throw new AppBuildError('setup', `Ri can’t find ${source.name}’s folder${source.folder ? ` at ${source.folder}` : ''}.`);
  return source;
}

export function finish(job: AppJob, state: 'done' | 'failed', error?: string) {
  job.state = state;
  job.finishedAt = new Date().toISOString();
  if (error) job.error = error.slice(0, 1000);
}

export { builderFolder } from './folder';
