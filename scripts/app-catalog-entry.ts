/**
 * Make an entry for Ri's catalog of recommended apps (docs/personal-apps.md "The catalog").
 *
 *   pnpm tsx scripts/app-catalog-entry.ts <git url or folder> <tag or commit> \
 *     --id people --name People --description "..." [--reaches "..."]... [--write [<catalog file>]]
 *
 * Reads the app's repository at that version (a folder in place, read-only, or a temporary clone of a
 * URL), computes the checksum of its files the way Ri checks it on Add and Update, and prints the
 * entry. `--write` adds it to `src/lib/apps/catalog.json` (or the file given), replacing an entry with
 * the same ID.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CatalogEntrySchema, CatalogSchema } from '../src/lib/apps/catalog-entries';
import { treeChecksum } from '../src/lib/apps/catalog-checksum';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
    reaches: { type: 'string', multiple: true }, write: { type: 'boolean' },
  },
});
const [git, version, catalogArg] = positionals;
if (!git || !version || !values.id || !values.name || !values.description) {
  console.error('Usage: pnpm tsx scripts/app-catalog-entry.ts <git url or folder> <tag or commit> --id <id> --name <name> --description <text> [--reaches <text>]... [--write [<catalog file>]]');
  process.exit(64);
}

async function main(git: string, version: string) {
  const local = git.startsWith('/') && fs.existsSync(git);
  let repo = git;
  let temporary: string | null = null;
  try {
    if (!local) {
      temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-catalog-entry-'));
      repo = path.join(temporary, 'repo.git');
      execFileSync('git', ['clone', '-q', '--bare', '--', git, repo], { stdio: 'inherit' });
    }
    const commit = execFileSync('git', ['rev-parse', '--verify', `${version}^{commit}`], { cwd: repo, encoding: 'utf8' }).trim();
    // A tag or a commit stays put. Anything else (HEAD, a branch) is pinned as the commit it is now.
    let tag = false;
    try { execFileSync('git', ['rev-parse', '--verify', '-q', `refs/tags/${version}`], { cwd: repo, stdio: 'ignore' }); tag = true; } catch { /* Not a tag. */ }
    const pinned = tag || commit.startsWith(version) ? version : commit;
    const entry = CatalogEntrySchema.parse({
      id: values.id, name: values.name, description: values.description, reaches: values.reaches ?? [],
      git, version: pinned, checksum: await treeChecksum(repo, commit),
    });
    console.log(JSON.stringify(entry, null, 2));
    console.error(`${entry.name} ${pinned} is commit ${commit}.${pinned !== version ? ` ${version} can move, so the entry pins the commit.` : ''}`);
    if (values.write) {
      const file = catalogArg ? path.resolve(catalogArg) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/apps/catalog.json');
      const catalog = CatalogSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
      const apps = [...catalog.apps.filter((app) => app.id !== entry.id), entry].sort((a, b) => a.name.localeCompare(b.name));
      fs.writeFileSync(file, JSON.stringify({ apps }, null, 2) + '\n');
      console.error(`Wrote it to ${file}.`);
    }
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

void main(git, version).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
