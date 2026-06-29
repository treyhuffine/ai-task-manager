'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * One entry in the per-session "recently opened files" list. `path` is
 * worktree-relative — the same shape the file tree / viewer selection
 * uses — and `openedAt` is epoch ms so the menu can render a relative
 * timestamp and order strictly by recency.
 */
export interface FileHistoryEntry {
  path: string;
  openedAt: number;
}

const STORAGE_KEY_PREFIX = 'flow.viewer.history.';
/** Bound the list so a long session can't grow localStorage unbounded. */
const MAX_ENTRIES = 40;

function storageKey(sessionId: string): string {
  return STORAGE_KEY_PREFIX + sessionId;
}

function readHistory(sessionId: string | null): FileHistoryEntry[] {
  if (!sessionId || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is FileHistoryEntry =>
        !!e &&
        typeof (e as FileHistoryEntry).path === 'string' &&
        typeof (e as FileHistoryEntry).openedAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeHistory(sessionId: string, entries: FileHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(entries));
  } catch {
    /* ignore quota / serialization errors */
  }
}

/**
 * Per-session LRU of files opened in the execution's viewer. Lifted into
 * `ExecutionView` — the single chokepoint every "open a file" path passes
 * through (tree click, rename/create, transcript chip) — and handed down
 * to `ViewerArea`, so the history menu and the recorder share one source
 * of truth. A second `useState` in the menu wouldn't see opens triggered
 * from the tree or chips.
 *
 * Persisted in localStorage keyed by session so the list survives reload
 * and never bleeds between executions.
 */
export function useFileHistory(sessionId: string | null) {
  const [history, setHistory] = useState<FileHistoryEntry[]>(() => readHistory(sessionId));

  // Reload when the viewed session changes. ExecutionView mounts once and
  // re-renders on sessionId change, so without this the previous session's
  // list would linger.
  useEffect(() => {
    setHistory(readHistory(sessionId));
  }, [sessionId]);

  const recordOpen = useCallback(
    (path: string) => {
      if (!sessionId || !path) return;
      setHistory((prev) => {
        // Move-to-front: drop any prior entry for this path, prepend fresh.
        const next: FileHistoryEntry[] = [
          { path, openedAt: Date.now() },
          ...prev.filter((e) => e.path !== path),
        ].slice(0, MAX_ENTRIES);
        writeHistory(sessionId, next);
        return next;
      });
    },
    [sessionId],
  );

  const clearHistory = useCallback(() => {
    if (!sessionId) return;
    setHistory([]);
    writeHistory(sessionId, []);
  }, [sessionId]);

  return { history, recordOpen, clearHistory };
}
