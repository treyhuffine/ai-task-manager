/**
 * Ri's catalog of recommended apps (docs/personal-apps.md "The catalog", shared spec §2 "The
 * catalog"): first-party apps Ri offers the way it used to offer its bundled ones, without carrying
 * their code. Each entry pins one version of an app's own git repository and a checksum of that
 * version's files. The list ships in `catalog.json`. `RI_APP_CATALOG` names another file, for
 * development and tests.
 *
 * Add a real entry with `pnpm tsx scripts/app-catalog-entry.ts <git url> <version> ...`, which
 * computes the checksum.
 */
import fs from 'node:fs';
import { z } from 'zod/v4';
import bundled from './catalog.json';

/** Where an app's repository may be: on GitHub or another https host, or a folder on this computer (development). */
function allowedGitUrl(value: string): boolean {
  if (value.startsWith('/')) return !value.includes('\0');
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'file:') && !url.username && !url.password;
  } catch { return false; }
}

/** A tag or commit that is also a valid git ref name, so Ri can keep the fetched version under one. */
function allowedVersion(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(value) && !value.includes('..') && !value.includes('//')
    && !value.endsWith('/') && !value.endsWith('.') && !value.endsWith('.lock') && !value.includes('/.');
}

export const CatalogEntrySchema = z.object({
  /** Also the app's folder name in the apps folder. */
  id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(400),
  /** What the app can reach beyond its own data, in plain words. Empty when it reaches nothing else. */
  reaches: z.array(z.string().min(1).max(200)).max(12),
  /** Its own git repository. */
  git: z.string().min(1).max(1000).refine(allowedGitUrl, 'Use an https URL, or a full path to a folder on this computer.'),
  /** The pinned version: a tag or a commit. */
  version: z.string().refine(allowedVersion, 'Use a tag or commit name.'),
  /** sha256 of the version's files (catalog-checksum.ts). */
  checksum: z.string().regex(/^sha256-[0-9a-f]{64}$/),
}).strict();

export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const CatalogSchema = z.object({ apps: z.array(CatalogEntrySchema) }).strict()
  .refine((catalog) => new Set(catalog.apps.map((app) => app.id)).size === catalog.apps.length, 'Each app in the catalog needs its own ID.');

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

/** The catalog: the shipped list, or the file `RI_APP_CATALOG` names. */
export function loadCatalog(): CatalogEntry[] {
  const file = process.env.RI_APP_CATALOG;
  let raw: unknown = bundled;
  if (file) {
    try { raw = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8')); }
    catch (error) { throw new CatalogError(`Ri can’t read the app catalog at ${file}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const parsed = CatalogSchema.safeParse(raw);
  if (!parsed.success) throw new CatalogError(`The app catalog${file ? ` at ${file}` : ''} isn’t valid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join(', ')}`);
  return parsed.data.apps;
}

export function catalogEntry(id: string): CatalogEntry | null {
  return loadCatalog().find((entry) => entry.id === id) ?? null;
}

/** Where Ri keeps a fetched catalog version in an app's repository, so it can tell later whether a commit includes it. */
export function catalogRef(version: string): string {
  return `refs/ri-catalog/${version}`;
}
