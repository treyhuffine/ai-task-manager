/**
 * Cross-component channel for "open this worktree file in the viewer."
 * Mirrors `open-event.ts` (entity reference chips) but for plain file
 * paths: transcript file chips fire `dispatchOpenFile`, ExecutionView
 * listens via `useOpenFileListener` and routes it to the file
 * tree/viewer pair. A window CustomEvent avoids drilling a setter down
 * through the transcript tree.
 *
 * The path may be absolute (tool inputs give absolute paths) or
 * worktree-relative; the listener normalizes against the session's
 * `worktreePath` before selecting.
 */
import { useEffect } from 'react';

const EVENT_NAME = 'flow:open-file';

export interface OpenFileDetail {
  /** Absolute or worktree-relative path. */
  path: string;
}

export function dispatchOpenFile(path: string): void {
  if (typeof window === 'undefined' || !path) return;
  window.dispatchEvent(new CustomEvent<OpenFileDetail>(EVENT_NAME, { detail: { path } }));
}

export function useOpenFileListener(handler: (detail: OpenFileDetail) => void): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onEvent = (e: Event) => {
      const ce = e as CustomEvent<OpenFileDetail>;
      if (ce.detail) handler(ce.detail);
    };
    window.addEventListener(EVENT_NAME, onEvent);
    return () => window.removeEventListener(EVENT_NAME, onEvent);
  }, [handler]);
}

/**
 * Normalize a possibly-absolute path to worktree-relative. Returns the
 * input unchanged when it doesn't sit under `worktreePath` (already
 * relative, or outside the worktree).
 */
export function toWorktreeRelative(path: string, worktreePath: string | null | undefined): string {
  if (!worktreePath) return path.replace(/^\/+/, '');
  const root = worktreePath.replace(/\/+$/, '');
  if (path === root) return '';
  if (path.startsWith(root + '/')) return path.slice(root.length + 1);
  return path;
}
