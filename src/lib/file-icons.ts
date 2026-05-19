// Resolves filenames and folder names to SVG URLs from the Symbols
// icon theme by Miguel Solorio (https://github.com/miguelsolorio/vscode-symbols).
// SVGs + manifest are vendored into public/symbols-icons/ at install time
// by scripts/fetch-symbols-icons.mjs and pinned to a known-good commit.

import manifest from '../../public/symbols-icons/manifest.json';

const BASE = '/symbols-icons';

interface IconDef {
  iconPath: string;
}
interface SymbolsManifest {
  file: string;
  folder: string;
  folderExpanded: string | null;
  iconDefinitions: Record<string, IconDef>;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
}

const m = manifest as unknown as SymbolsManifest;

function urlFor(iconName: string, fallback: string): string {
  const def = m.iconDefinitions[iconName] ?? m.iconDefinitions[fallback];
  return `${BASE}/${def.iconPath}`;
}

// VS Code icon themes resolve files in this order:
//   1. exact filename match (fileNames)
//   2. extension match, longest first (foo.spec.ts → spec.ts → ts)
//   3. theme.file fallback
function resolveFileIconName(name: string): string {
  const lower = name.toLowerCase();
  if (m.fileNames[lower]) return m.fileNames[lower];

  let dot = lower.indexOf('.');
  while (dot !== -1) {
    const ext = lower.slice(dot + 1);
    if (m.fileExtensions[ext]) return m.fileExtensions[ext];
    dot = lower.indexOf('.', dot + 1);
  }
  return m.file;
}

function resolveFolderIconName(name: string, opened: boolean): string {
  const lower = name.toLowerCase();
  if (opened && m.folderNamesExpanded[lower]) return m.folderNamesExpanded[lower];
  if (m.folderNames[lower]) return m.folderNames[lower];
  if (opened && m.folderExpanded) return m.folderExpanded;
  return m.folder;
}

export function fileIconUrl(name: string): string {
  return urlFor(resolveFileIconName(name), m.file);
}

export function folderIconUrl(name: string, opened: boolean): string {
  return urlFor(resolveFolderIconName(name, opened), m.folder);
}
