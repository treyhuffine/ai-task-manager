/**
 * Ask an execution to open one of its workbench views from outside it.
 * The archive dialog's Review opens the execution on Changes, so the
 * person lands on the very files archiving would delete.
 *
 * The ask is held until the execution's view takes it, because it's made
 * just before navigating: the view may not be mounted yet, or may still be
 * showing another execution. One ask at a time, taken once, and dropped if
 * nobody takes it soon, so an old one can't open a panel days later.
 */
import { useEffect } from 'react';
import type { PanelView } from './workbench-state';

const EVENT_NAME = 'ri:workbench-view';
const TTL_MS = 15_000;

let pending: { sessionId: string; view: PanelView; at: number } | null = null;

/** Ask the chat `sessionId`'s execution view to open `view`. Navigate there yourself. */
export function requestWorkbenchView(sessionId: string, view: PanelView): void {
  pending = { sessionId, view, at: Date.now() };
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT_NAME));
}

/** The view asked for `sessionId`, if any. Taking it clears it. */
export function takeWorkbenchView(sessionId: string, now = Date.now()): PanelView | null {
  if (!pending) return null;
  if (now - pending.at > TTL_MS) {
    pending = null;
    return null;
  }
  if (pending.sessionId !== sessionId) return null;
  const { view } = pending;
  pending = null;
  return view;
}

/**
 * Open what's asked for this chat, when it mounts and on every ask after.
 * Pass null until the chat's own session has loaded: the workbench resets
 * to its execution's saved state then, and an ask taken before that would
 * be reset away.
 */
export function useWorkbenchViewRequests(sessionId: string | null, open: (view: PanelView) => void): void {
  useEffect(() => {
    if (!sessionId) return;
    const take = () => {
      const view = takeWorkbenchView(sessionId);
      if (view) open(view);
    };
    take();
    window.addEventListener(EVENT_NAME, take);
    return () => window.removeEventListener(EVENT_NAME, take);
  }, [sessionId, open]);
}
