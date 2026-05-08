import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import picomatch from 'picomatch';

/**
 * `@agentex/workspace.copyFromSource` matches against the *full* POSIX
 * relative path. So bare patterns like `.env*` only match files at the
 * root. Conductor's UX is more forgiving — `.env*` also picks up
 * `discord/.env`. Mirror that: any pattern without a `/` also gets a
 * `**​/<pattern>` sibling so it matches at any depth.
 *
 * The original pattern is kept too, so authored `.env.*` still matches
 * root-level `.env.local` exactly the same way it always did.
 */
export function expandFilesToCopyPatterns(patterns: readonly string[]): string[] {
  const expanded = new Set<string>();
  for (const raw of patterns) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    expanded.add(trimmed);
    if (!trimmed.includes('/') && !trimmed.startsWith('**')) {
      expanded.add(`**/${trimmed}`);
    }
  }
  return Array.from(expanded);
}

/** Mirrors `@agentex/workspace`'s walker: skips `.git/` at every depth. */
const ALWAYS_SKIP = new Set(['.git']);

const DEFAULT_MAX_FILES = 1000;

async function* walkFiles(root: string, relPrefix: string): AsyncGenerator<string> {
  const here = path.join(root, relPrefix);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(here, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (ALWAYS_SKIP.has(entry.name)) continue;
    const rel = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walkFiles(root, rel);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      yield rel;
    }
  }
}

export interface PreviewFilesToCopyResult {
  files: string[];
  /** True when the walker hit the cap before exhausting matches. */
  truncated: boolean;
}

/**
 * Walk `cwd` and return relative POSIX paths matching any of `patterns`
 * (after expansion). Designed for UI preview — capped at 1000 hits.
 *
 * Result is the same set `copyFromSource` will copy at worktree-create
 * time, so the user sees exactly what will land in the new workspace.
 */
export async function previewFilesToCopy(
  cwd: string,
  patterns: readonly string[],
  opts: { maxFiles?: number } = {},
): Promise<PreviewFilesToCopyResult> {
  const expanded = expandFilesToCopyPatterns(patterns);
  if (expanded.length === 0) return { files: [], truncated: false };

  const matchers = expanded.map((p) => picomatch(p, { dot: true }));
  const results = new Set<string>();
  const cap = opts.maxFiles ?? DEFAULT_MAX_FILES;
  let truncated = false;

  for await (const rel of walkFiles(cwd, '')) {
    for (const m of matchers) {
      if (m(rel)) {
        results.add(rel);
        break;
      }
    }
    if (results.size >= cap) {
      truncated = true;
      break;
    }
  }

  return { files: Array.from(results).sort(), truncated };
}
