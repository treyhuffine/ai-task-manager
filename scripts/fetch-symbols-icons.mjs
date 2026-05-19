#!/usr/bin/env node
// Pull the Symbols icon-theme (Miguel Solorio, MIT) from GitHub once and
// vendor the SVGs + manifest into public/symbols-icons. Skips the fetch
// if the destination is already populated so postinstall stays cheap.

import { mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const dest = resolve(repoRoot, 'public/symbols-icons');

// Pin to a known-good commit so the icon set doesn't drift under us.
const COMMIT = '66465133fff9acfcac18cfa5c02749dca243c62b';
const BASE = `https://raw.githubusercontent.com/miguelsolorio/vscode-symbols/${COMMIT}`;

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return await res.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function isFresh(file, maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  if (!existsSync(file)) return false;
  return stat(file).then((s) => Date.now() - s.mtimeMs < maxAgeMs).catch(() => false);
}

async function main() {
  await mkdir(join(dest, 'files'), { recursive: true });
  await mkdir(join(dest, 'folders'), { recursive: true });

  const manifestPath = join(dest, 'manifest.json');
  if (await isFresh(manifestPath)) {
    const filesEntries = await readdir(join(dest, 'files')).catch(() => []);
    if (filesEntries.length > 100) {
      console.log(`[symbols-icons] cached, skip (${filesEntries.length} files in public/symbols-icons/files/)`);
      return;
    }
  }

  console.log('[symbols-icons] fetching theme manifest…');
  const theme = await fetchJson(`${BASE}/src/symbol-icon-theme.json`);

  // iconDefinitions maps icon-name → { iconPath: "./icons/<bucket>/<name>.svg" }
  const defs = theme.iconDefinitions ?? {};
  const work = [];
  for (const [name, def] of Object.entries(defs)) {
    if (!def?.iconPath) continue;
    const rel = def.iconPath.replace(/^\.\//, '');
    const url = `${BASE}/src/${rel}`;
    const out = join(dest, rel.replace(/^icons\//, ''));
    work.push({ name, url, out });
  }

  console.log(`[symbols-icons] downloading ${work.length} svgs (commit ${COMMIT.slice(0, 7)})…`);
  let done = 0;
  // Modest concurrency — be polite to raw.githubusercontent.com.
  const CONC = 12;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (next < work.length) {
        const i = next++;
        const { url, out } = work[i];
        try {
          const svg = await fetchText(url);
          await mkdir(dirname(out), { recursive: true });
          await writeFile(out, svg, 'utf8');
          done += 1;
        } catch (err) {
          console.warn(`[symbols-icons] failed ${url}: ${err.message}`);
        }
      }
    }),
  );

  // Strip the `./icons/` prefix from iconPath in the persisted manifest so
  // the runtime resolver builds URLs against `/symbols-icons/<bucket>/<name>.svg`.
  const persisted = {
    file: theme.file ?? 'file',
    folder: theme.folder ?? 'folder',
    folderExpanded: theme.folderExpanded ?? null,
    rootFolder: theme.rootFolder ?? theme.folder ?? 'folder',
    rootFolderExpanded: theme.rootFolderExpanded ?? null,
    iconDefinitions: Object.fromEntries(
      Object.entries(defs).map(([name, def]) => [
        name,
        { iconPath: (def?.iconPath ?? '').replace(/^\.\/icons\//, '') },
      ]),
    ),
    fileNames: theme.fileNames ?? {},
    fileExtensions: theme.fileExtensions ?? {},
    languageIds: theme.languageIds ?? {},
    folderNames: theme.folderNames ?? {},
    folderNamesExpanded: theme.folderNamesExpanded ?? {},
  };
  await writeFile(manifestPath, JSON.stringify(persisted), 'utf8');

  console.log(`[symbols-icons] ${done}/${work.length} svgs → public/symbols-icons/`);
}

main().catch((err) => {
  console.error(`[symbols-icons] aborted: ${err.message}`);
  console.error('[symbols-icons] Symbols will be unavailable in the icon picker.');
  // Don't fail install — just leave Symbols out of the rotation.
  process.exit(0);
});
