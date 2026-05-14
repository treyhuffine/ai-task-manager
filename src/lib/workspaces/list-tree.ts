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
import type { Workspace, GitWorkspace, TreeNode } from '@agentex/workspace';
import type { TreeEntry, TreeEntryStatus } from '@/lib/api/sessions';

export type { TreeEntry, TreeEntryStatus };

export async function listTree(ws: Workspace): Promise<TreeEntry[]> {
  if (ws.kind === 'git') return listTreeGit(ws);
  return listTreeBare(ws);
}

async function listTreeGit(ws: GitWorkspace): Promise<TreeEntry[]> {
  // ls-files: tracked + untracked (respecting .gitignore).
  // -z would null-delimit; \n is sufficient for normal repos and keeps
  // the parser simple. Paths with embedded newlines are pathological
  // enough that we accept the tradeoff.
  const lsResult = await ws.git.raw([
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  const lines = lsResult.stdout.split('\n').filter(Boolean);

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
      '--name-only',
      '--diff-filter=D',
      'HEAD',
    ]);
    const deletedLines = deletedResult.stdout.split('\n').filter(Boolean);
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
