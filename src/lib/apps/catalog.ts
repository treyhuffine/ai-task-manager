/**
 * Adding and updating apps from Ri's catalog (docs/personal-apps.md "The catalog", shared spec §2
 * "The catalog").
 *
 * Add clones the app's repository into the apps folder as its own repository, with its source as
 * the `upstream` remote, checks out the pinned version only if its files match the entry's checksum,
 * then installs and connects it like an app made with New app.
 *
 * Update fetches the newer version and checks it the same way. If the person never changed the app,
 * the kit's safe-change command switches the running app straight to it. If they did, Ri opens a
 * change and the builder merges the update with their changes first. The person applies that change
 * as usual, and the switch records the new version once the running commit includes it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createAppSource, listAppSources, type AppSourceRecord } from '@/lib/db/queries';
import {
  AppBuildError, appBuildSettings, ensureCommitIdentity, git, installApp, recordCatalogVersion, requireFolder, startChange, switchTo, toolsWithGit,
  type AppJob,
} from './builder';
import { catalogEntry, catalogRef, CatalogError, loadCatalog, type CatalogEntry } from './catalog-entries';
import { treeChecksum } from './catalog-checksum';
import type { AppToolchain } from './toolchain';

type Tools = AppToolchain & { git: string };

export interface CatalogApp extends CatalogEntry {
  /** The app's source in Ri once added. */
  sourceId: string | null;
  personalAppId: string | null;
  /** The catalog version it includes. */
  installedVersion: string | null;
  /** Added, and the catalog has another version. */
  updateAvailable: boolean;
}

export function listCatalogApps(): { apps: CatalogApp[]; error: string | null } {
  let entries: CatalogEntry[];
  try { entries = loadCatalog(); }
  catch (error) { return { apps: [], error: error instanceof CatalogError ? error.message : String(error) }; }
  const sources = listAppSources();
  return {
    apps: entries.map((entry) => {
      const source = sources.find((candidate) => candidate.catalogId === entry.id);
      return {
        ...entry,
        sourceId: source?.id ?? null,
        personalAppId: source?.personalAppId ?? null,
        installedVersion: source?.catalogVersion ?? null,
        updateAvailable: !!source && source.catalogVersion !== entry.version,
      };
    }),
    error: null,
  };
}

function requireEntry(id: string): CatalogEntry {
  let entry: CatalogEntry | null;
  try { entry = catalogEntry(id); }
  catch (error) { throw new AppBuildError('setup', error instanceof Error ? error.message : String(error)); }
  if (!entry) throw new AppBuildError('not_found', 'That app isn’t in Ri’s catalog.');
  return entry;
}

/**
 * Fetch a catalog version from the app's `upstream` into Ri's ref for it, and check its files
 * against the entry's checksum. Returns the commit.
 */
async function fetchVersion(folder: string, entry: CatalogEntry, tools: Tools): Promise<string> {
  const ref = catalogRef(entry.version);
  try {
    await git(folder, ['fetch', '-q', '--no-tags', 'upstream', `+${entry.version}:${ref}`], tools);
  } catch {
    // A commit the server won't hand out by name: fetch everything and look for it.
    try {
      await git(folder, ['fetch', '-q', '--tags', 'upstream'], tools);
      const { stdout } = await git(folder, ['rev-parse', '--verify', `${entry.version}^{commit}`], tools);
      await git(folder, ['update-ref', ref, stdout.trim()], tools);
    } catch {
      throw new AppBuildError('setup', `Ri couldn’t get ${entry.name} ${entry.version} from ${entry.git}. Check your internet connection and try again.`);
    }
  }
  const commit = (await git(folder, ['rev-parse', '--verify', `${ref}^{commit}`], tools)).stdout.trim();
  const checksum = await treeChecksum(folder, commit, { git: tools.git, env: { ...process.env, ...tools.env } });
  if (checksum !== entry.checksum) {
    await git(folder, ['update-ref', '-d', ref], tools).catch(() => {});
    throw new AppBuildError('setup', `${entry.name} ${entry.version} doesn’t match what Ri’s catalog lists, so Ri didn’t use it. Nothing changed.`);
  }
  return commit;
}

type RequestLike = Pick<Request, 'headers' | 'url'>;

/**
 * Add an app from the catalog: clone its pinned version into the apps folder as its own repository
 * with an `upstream` remote, then install and connect it.
 */
export async function addCatalogApp(id: string, request?: RequestLike, returnTo?: string): Promise<{ source: AppSourceRecord; job: AppJob }> {
  const entry = requireEntry(id);
  if (listAppSources().some((source) => source.catalogId === entry.id)) throw new AppBuildError('conflict', `${entry.name} is already added.`);
  const settings = appBuildSettings();
  const tools = toolsWithGit();
  const folder = path.join(/* turbopackIgnore: true */ settings.appsDir, entry.id);
  if (fs.existsSync(/* turbopackIgnore: true */ folder)) throw new AppBuildError('conflict', `${folder} already exists. Move it, or add ${entry.name} by hand.`);
  fs.mkdirSync(/* turbopackIgnore: true */ settings.appsDir, { recursive: true });
  let commit: string;
  try {
    await git(settings.appsDir, ['clone', '-q', '--no-checkout', '--origin', 'upstream', '--', entry.git, folder], tools)
      .catch(() => { throw new AppBuildError('setup', `Ri couldn’t get ${entry.name} from ${entry.git}. Check your internet connection and try again.`); });
    commit = await fetchVersion(folder, entry, tools);
    // The person's own copy, on their own branch, at the pinned version.
    const branch = (await git(folder, ['symbolic-ref', '--short', 'HEAD'], tools).catch(() => ({ stdout: 'main' }))).stdout.trim() || 'main';
    await git(folder, ['checkout', '-q', '-B', branch, commit], tools);
    await git(folder, ['branch', '--unset-upstream'], tools).catch(() => {});
    await ensureCommitIdentity(folder, tools);
  } catch (error) {
    fs.rmSync(/* turbopackIgnore: true */ folder, { recursive: true, force: true });
    throw error;
  }
  const source = createAppSource({ name: entry.name, folder, gitUrl: entry.git, createdByRi: true, catalogId: entry.id, catalogVersion: entry.version, catalogCommit: commit });
  const job = await installApp(source.id, request, returnTo);
  return { source, job };
}

export type CatalogUpdate =
  /** Already at the catalog's version, or the running app already includes it. */
  | { mode: 'current'; version: string }
  /** The person never changed the app: the kit switches straight to the new version. */
  | { mode: 'switch'; version: string; job: AppJob }
  /** The person changed it: a change is open, and the builder merges the update there first. */
  | { mode: 'merge'; version: string; commit: string; source: AppSourceRecord; message: string };

/** What the builder is asked to do when the person changed an app the catalog updated. */
export function mergeRequest(entry: Pick<CatalogEntry, 'name' | 'version'>, commit: string, previous: string | null): string {
  return [
    `${entry.name} has an update in Ri's catalog: ${entry.version}${previous ? `, after ${previous}` : ''}. This app has changes of the person's own, so merge the update into this change first.`,
    `It's already fetched. Run git merge ${commit} here. Keep both the person's changes and the update. Where they conflict, keep what the person meant and take everything else from the update.`,
    'Then run the checks, commit the merge, and tell me what changed and anything you had to decide. The person applies the change when they are ready.',
  ].join('\n\n');
}

/** Update an app added from the catalog to the catalog's version. */
export async function updateCatalogApp(sourceId: string): Promise<CatalogUpdate> {
  const source = requireFolder(sourceId);
  if (!source.catalogId) throw new AppBuildError('invalid', `${source.name} wasn’t added from Ri’s catalog.`);
  const entry = requireEntry(source.catalogId);
  if (entry.version === source.catalogVersion) return { mode: 'current', version: entry.version };
  if (source.changeFolder) throw new AppBuildError('conflict', 'A change is open. Apply or discard it first, then update.');
  const tools = toolsWithGit();
  const commit = await fetchVersion(source.folder!, entry, tools);
  const head = (await git(source.folder!, ['rev-parse', 'HEAD'], tools)).stdout.trim();
  // Already in what's running (the builder merged it before): just record it.
  if (await recordCatalogVersion(source, head)) return { mode: 'current', version: entry.version };
  const dirty = (await git(source.folder!, ['status', '--porcelain'], tools)).stdout.trim();
  if (!dirty && head === source.catalogCommit) return { mode: 'switch', version: entry.version, job: switchTo(source, commit) };
  const changing = await startChange(source.id);
  return { mode: 'merge', version: entry.version, commit, source: changing, message: mergeRequest(entry, commit, source.catalogVersion) };
}

