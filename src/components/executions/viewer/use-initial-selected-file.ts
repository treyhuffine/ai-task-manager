'use client';

import { useEffect, useRef } from 'react';
import { useSessionEvents, useSessionTree } from '@/hooks/use-execution';

/**
 * Pick a sensible default file to focus when the user opens an
 * execution view. Strategy:
 *
 *   1. Most recent `tool_use` whose input names a file inside the
 *      worktree (Edit/Write/MultiEdit + Bash with a file arg).
 *   2. Fall back to the most-recently-changed file from the tree
 *      (`status` is set, sort by `mtime`).
 *   3. Otherwise leave `selectedPath` unset.
 *
 * Runs once per session open — once the user clicks something we stop
 * overwriting their selection.
 */
export function useInitialSelectedFile(
  sessionId: string | null,
  selectedPath: string | null,
  onSelect: (path: string) => void,
): void {
  const { data: events } = useSessionEvents(sessionId);
  const { data: tree } = useSessionTree(sessionId);
  const appliedRef = useRef(false);
  const lastSessionRef = useRef<string | null>(null);

  // Reset the applied flag when navigating between sessions.
  if (lastSessionRef.current !== sessionId) {
    lastSessionRef.current = sessionId;
    appliedRef.current = false;
  }

  useEffect(() => {
    if (!sessionId) return;
    if (appliedRef.current) return;
    if (selectedPath) {
      appliedRef.current = true;
      return;
    }

    // Need either the tree or the events to be loaded — but not both.
    if (!events && !tree) return;

    // 1) Walk events newest-first for a file-ish tool_use.
    if (events && events.length > 0) {
      const treePaths = tree ? new Set(tree.entries.map((e) => e.path)) : null;
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.source !== 'tool_call') continue;
        const candidate = extractFilePath(ev.tool_name, ev.tool_input);
        if (!candidate) continue;
        // Tool inputs sometimes carry absolute paths; tree entries are
        // worktree-relative. Match against the longest entry suffix
        // that fits the candidate.
        const matched = treePaths
          ? findRelativeMatch(candidate, treePaths)
          : candidate;
        if (matched) {
          onSelect(matched);
          appliedRef.current = true;
          return;
        }
      }
    }

    // 2) Fall back to most recent changed file by mtime.
    if (tree && tree.entries.length > 0) {
      const changed = tree.entries.filter((e) => !!e.status && !!e.mtime);
      if (changed.length > 0) {
        changed.sort((a, b) =>
          (a.mtime ?? '') < (b.mtime ?? '') ? 1 : -1,
        );
        onSelect(changed[0].path);
        appliedRef.current = true;
        return;
      }
    }
  }, [sessionId, selectedPath, events, tree, onSelect]);
}

function extractFilePath(
  toolName: string | null,
  toolInput: unknown,
): string | null {
  if (!toolName || !toolInput || typeof toolInput !== 'object') return null;
  const input = toolInput as Record<string, unknown>;

  // Claude tool conventions:
  //   Edit / Write / MultiEdit / NotebookEdit → file_path | notebook_path
  if (typeof input.file_path === 'string') return normalize(input.file_path);
  if (typeof input.notebook_path === 'string') return normalize(input.notebook_path);
  if (typeof input.path === 'string') return normalize(input.path);

  return null;
}

function normalize(p: string): string | null {
  if (!p) return null;
  return p.trim() || null;
}

/**
 * Map a candidate (possibly absolute) path against the set of
 * worktree-relative paths. Returns the matching entry on hit, or null.
 *
 * Strategy: try the candidate verbatim, then progressively trim leading
 * segments until we either find a match or run out. So
 * `/Users/foo/worktree/src/bar.ts` reduces to `Users/foo/worktree/src/bar.ts`
 * → `foo/worktree/src/bar.ts` → … → `src/bar.ts` → match.
 */
function findRelativeMatch(candidate: string, paths: ReadonlySet<string>): string | null {
  if (paths.has(candidate)) return candidate;
  let cur = candidate.replace(/^\/+/, '');
  while (cur.includes('/')) {
    if (paths.has(cur)) return cur;
    const idx = cur.indexOf('/');
    cur = cur.slice(idx + 1);
  }
  if (paths.has(cur)) return cur;
  return null;
}
