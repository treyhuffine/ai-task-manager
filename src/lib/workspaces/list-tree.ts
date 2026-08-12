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
  // `-t` prefixes each path with its source: `H ` for a cached (tracked) file,
  // `? ` for an untracked one. That distinction is the only reason this used
  // to run a *second* `ls-files --others` below — the untracked set was needed
  // separately to badge those rows, and the combined listing couldn't tell
  // them apart. Tagging gets both sets out of one subprocess.
  //
  // Worth the tiny parsing cost: each git invocation on this route measured
  // ~83ms warm, and the route runs several of them back to back, so deleting
  // one is a real fraction of the time to open an execution.
  const lsResult = await ws.git.raw([
    'ls-files',
    '-z',
    '-t',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  const lines = lsResult.stdout.split('\0').filter(Boolean);

  // Dedup — `--cached --others` together can occasionally double-list edge
  // cases. A path listed both ways keeps its first tag, which is `H`; that
  // matches the old behaviour, where the separate `--others` call was the
  // only thing that could mark a path untracked and a tracked path never
  // appeared in it.
  const seen = new Set<string>();
  const rels: string[] = [];
  const untracked: string[] = [];
  for (const ln of lines) {
    // `<tag><space><path>` — tag is a single character, so the path starts at
    // index 2. Paths are raw UTF-8 (see the `-z` note above), so a leading
    // space in a filename survives this slice intact.
    const tag = ln[0];
    const rel = ln.slice(2);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    rels.push(rel);
    if (tag === '?') untracked.push(rel);
  }

  // Status is computed against the diff base (`ws.git.baseSha`), NOT the
  // working-tree index, so the tree's "Changed" set is exactly the file set the
  // diff view renders — the two can never disagree. In particular, once an
  // agent commits mid-session, those committed files still show as "changed"
  // here (a HEAD/index-relative `git status` would drop them the moment they
  // were committed, leaving the tree empty while the diff showed everything).
  // Two sources, unioned:
  //
  //   1. `git diff --name-status <base>` — every TRACKED change since the base
  //      (committed + staged + unstaged) in one shot.
  //   2. The `?`-tagged entries from the `ls-files` call above — untracked
  //      (not-yet-tracked) files. The diff view renders these as synthetic
  //      "added"; we badge them 'untracked'. Getting them from ls-files (full
  //      per-file paths, honoring `.gitignore`) also dodges `git status`'s
  //      new-directory collapse, which otherwise drops a new file inside a new
  //      folder from the tree.
  const baseSha = ws.git.baseSha;

  const nameStatusResult = await ws.git.raw([
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    baseSha,
  ]);
  const nsTokens = nameStatusResult.stdout.split('\0').filter(Boolean);

  const statusMap = new Map<string, TreeEntryStatus>();
  const deletedPaths: string[] = [];
  for (const p of untracked) statusMap.set(p, 'untracked');
  // Walk the `--name-status -z` token stream: [code, path] per change, except
  // renames/copies which are [code, oldPath, newPath]. Codes: A added, M/T
  // modified, D deleted, R renamed, C copied.
  for (let i = 0; i < nsTokens.length; ) {
    const code = nsTokens[i] ?? '';
    const letter = code[0];
    if (letter === 'R' || letter === 'C') {
      const newPath = nsTokens[i + 2];
      if (newPath) statusMap.set(newPath, 'modified');
      i += 3;
      continue;
    }
    const p = nsTokens[i + 1];
    i += 2;
    if (!p) continue;
    if (letter === 'D') {
      statusMap.set(p, 'deleted');
      deletedPaths.push(p);
    } else if (letter === 'A') {
      statusMap.set(p, 'added');
    } else {
      statusMap.set(p, 'modified');
    }
  }

  // Overlay conflicts from git's unmerged index — `git diff --diff-filter=U`
  // lists every path with stage>0 entries (mid-merge/rebase/pull/stash). This
  // is exactly how editors decide a file is "in conflict": VS Code's "Merge
  // Changes" group and JetBrains' conflict list both read git's index state,
  // never the file contents. 'conflict' wins over the M/A/D status the file
  // also carries vs. base. The resolver (ConflictView) parses the on-disk
  // markers when the file is opened — the content-level check lives there,
  // per-file and lazy, mirroring VS Code's inline merge-conflict decorations.
  try {
    const unmerged = await ws.git.raw(['diff', '--name-only', '--diff-filter=U', '-z']);
    for (const p of unmerged.stdout.split('\0').filter(Boolean)) statusMap.set(p, 'conflict');
  } catch {
    /* best-effort — if git can't report unmerged, conflicts just render as
       their plain M/A/D status until the next successful read. */
  }

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

  // Append files deleted since the base (collected from the `--name-status`
  // walk above). Their working-tree path is gone, so they never appear in
  // `ls-files`/`rels` — surface them so the user can see what was removed.
  for (const rel of deletedPaths) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    entries.push({
      path: rel,
      name: path.basename(rel),
      kind: 'file',
      status: 'deleted',
    });
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
