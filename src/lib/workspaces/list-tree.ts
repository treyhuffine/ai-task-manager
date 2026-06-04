/**
 * Enumerate every file the user might want to see in the execution view's
 * file tree. Returns a flat list of relative paths; the client builds the
 * folder shape for rendering.
 *
 * Source of truth:
 *   - Git workspaces: `git ls-files --cached --others --exclude-standard`
 *     gives us every tracked + untracked file while respecting `.gitignore`.
 *     We then layer `ws.git.status()` over that to attach M/A/D-style flags
 *     and stat the changed files for mtime + size.
 *   - Bare workspaces: walk `ws.tree()` recursively. No status flags.
 *
 * Deliberately keeps the response shape small — we don't return `mtime`
 * or `size` for *every* file (a 10k-file repo would be wasted bytes).
 * Only changed files get the extras, because only changed files render
 * a recency chip.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import type { Workspace, GitWorkspace, TreeNode } from '@agentex/workspace';
import type { TreeEntry, TreeEntryStatus } from '@/lib/api/sessions';
import { expandFilesToCopyPatterns } from './files-to-copy';

export type { TreeEntry, TreeEntryStatus };

/**
 * @param surfaceIgnored - workspace `filesToCopy` patterns. Files matching
 *   these are surfaced even though `.gitignore` would hide them, because the
 *   workspace copies them in on purpose (e.g. `.env*`) and the user wants to
 *   see/edit them. node_modules and other bulk-ignored dirs stay hidden.
 */
export async function listTree(ws: Workspace, surfaceIgnored: readonly string[] = []): Promise<TreeEntry[]> {
  if (ws.kind === 'git') return listTreeGit(ws, surfaceIgnored);
  return listTreeBare(ws);
}

async function listTreeGit(ws: GitWorkspace, surfaceIgnored: readonly string[]): Promise<TreeEntry[]> {
  // ls-files: tracked + untracked (respecting .gitignore). `-z` is required,
  // not just nice: without it git wraps any path containing "unusual" bytes
  // (non-ASCII — e.g. a U+202F in a filename) in `"…"` with octal escapes per
  // `core.quotePath`. Splitting that on `\n` leaks a literal leading `"` into
  // the tree (and a `"` sorts first, so it's *the first folder*). `-z`
  // null-delimits AND disables quoting, giving raw UTF-8 paths — which also
  // makes them match `git.status()`'s (unquoted) paths and handles the
  // newline-in-path case for free.
  const lsResult = await ws.git.raw([
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  const lines = lsResult.stdout.split('\0').filter(Boolean);

  // Dedup — `--cached --others` together can occasionally double-list edge cases.
  const seen = new Set<string>();
  const rels: string[] = [];
  for (const ln of lines) {
    if (seen.has(ln)) continue;
    seen.add(ln);
    rels.push(ln);
  }

  // Layer status on top.
  const status = await ws.git.status();
  const statusMap = new Map<string, TreeEntryStatus>();
  // Order matters: staged trumps modified; modified trumps untracked, in
  // the rare overlap. Keep the strongest signal.
  for (const p of status.untracked) statusMap.set(p, 'untracked');
  for (const p of status.modified) statusMap.set(p, 'modified');
  for (const p of status.staged) statusMap.set(p, 'staged');

  const entries: TreeEntry[] = [];
  for (const rel of rels) {
    const entry: TreeEntry = {
      path: rel,
      name: path.basename(rel),
      kind: 'file',
    };
    const s = statusMap.get(rel);
    if (s) {
      entry.status = s;
      // mtime + size only for changed files. Best-effort — if the file
      // vanished between ls-files and the stat, just leave the fields
      // undefined.
      try {
        const stat = await fs.stat(path.join(ws.path, rel));
        entry.mtime = stat.mtime.toISOString();
        entry.size = stat.size;
      } catch {
        /* file gone — skip the extras */
      }
    }
    entries.push(entry);
  }

  // Append explicitly-deleted tracked files. These don't show up in
  // ls-files (the working-tree path is gone), but git surfaces them via
  // `git diff --name-only --diff-filter=D HEAD`. We still want them in
  // the tree so the user can see what the agent removed.
  try {
    const deletedResult = await ws.git.raw([
      'diff',
      '-z',
      '--name-only',
      '--diff-filter=D',
      'HEAD',
    ]);
    const deletedLines = deletedResult.stdout.split('\0').filter(Boolean);
    for (const rel of deletedLines) {
      if (seen.has(rel)) continue;
      entries.push({
        path: rel,
        name: path.basename(rel),
        kind: 'file',
        status: 'deleted',
      });
    }
  } catch {
    /* ignore — deleted detection is best-effort */
  }

  // Surface the ignored files the workspace copies in on purpose (`.env*` etc.)
  // — `--exclude-standard` hides them, but the user put them there and wants to
  // see them. `--directory` collapses fully-ignored dirs (node_modules/, dist/)
  // to a single entry, so this is ~60ms and never floods with dependency files;
  // we keep only the entries matching the copy patterns.
  const patterns = expandFilesToCopyPatterns(surfaceIgnored);
  if (patterns.length > 0) {
    const matchers = patterns.map((p) => picomatch(p, { dot: true }));
    try {
      const ign = await ws.git.raw(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']);
      for (const rel of ign.stdout.split('\0').filter(Boolean)) {
        if (rel.endsWith('/')) {
          // A fully-ignored dir, collapsed to one entry by --directory. Surface
          // the *heavy* ones (node_modules, dist, …) as a NON-expandable folder
          // so the user can see it exists (e.g. deps installed) without us
          // listing thousands of files. Skip incidental ignored dirs.
          const dirRel = rel.replace(/\/+$/, '');
          const base = path.basename(dirRel);
          if (HEAVY_DIRS.has(base) && !seen.has(dirRel)) {
            seen.add(dirRel);
            entries.push({ path: dirRel, name: base, kind: 'dir', collapsed: true });
          }
          continue;
        }
        if (seen.has(rel)) continue;
        if (!matchers.some((m) => m(rel))) continue;
        seen.add(rel);
        entries.push({ path: rel, name: path.basename(rel), kind: 'file' });
      }
    } catch {
      /* best-effort — surfacing ignored copies is a nicety, not load-bearing */
    }
  }

  return entries;
}

async function listTreeBare(ws: Workspace): Promise<TreeEntry[]> {
  // Bare workspaces have no git status — we just enumerate files. The
  // library's `ws.tree()` already skips `.git/`. We additionally skip
  // common heavyweight directories that would dominate the tree.
  const tree = await ws.tree();
  const entries: TreeEntry[] = [];
  collect(tree, '', entries);
  return entries;
}

const HEAVY_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  '.cache',
  '.turbo',
  'coverage',
]);

function collect(node: TreeNode, relPath: string, out: TreeEntry[]): void {
  if (node.kind === 'file') {
    out.push({
      path: relPath,
      name: node.name,
      kind: 'file',
    });
    return;
  }
  if (!node.children) return;
  for (const child of node.children) {
    if (child.kind === 'dir' && HEAVY_DIRS.has(child.name)) continue;
    const next = relPath ? `${relPath}/${child.name}` : child.name;
    collect(child, next, out);
  }
}
