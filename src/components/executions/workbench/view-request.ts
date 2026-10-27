/**
 * Ask an execution to open one of its workbench views from outside it.
 * The archive dialog's Review opens the execution on Changes, so the
 * person lands on the very files archiving would delete. A file chip in a
 * chat open beside an agent's main chat opens the full view on Files, at
 * that file.
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

/** A view to open, and for Files, the file to show in it. */
export interface WorkbenchViewAsk {
  view: PanelView;
  path?: string;
}

let pending: { sessionId: string; ask: WorkbenchViewAsk; at: number } | null = null;

/** Ask the chat `sessionId`'s execution view to open `view`. Navigate there yourself. */
export function requestWorkbenchView(sessionId: string, view: PanelView, path?: string): void {
  pending = { sessionId, ask: path ? { view, path } : { view }, at: Date.now() };
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT_NAME));
}

function live(sessionId: string, now: number): boolean {
  if (!pending) return false;
  if (now - pending.at > TTL_MS) {
    pending = null;
    return false;
  }
  return pending.sessionId === sessionId;
}

/**
 * Whether the chat `sessionId` has an ask waiting, without taking it. A
 * surface that can show the chat but not its workbench (beside an agent's
 * main chat) sends the chat to its full view instead.
 */
export function hasWorkbenchView(sessionId: string, now = Date.now()): boolean {
  return live(sessionId, now);
}

/** The view asked for `sessionId`, if any. Taking it clears it. */
export function takeWorkbenchView(sessionId: string, now = Date.now()): WorkbenchViewAsk | null {
  if (!live(sessionId, now)) return null;
  const { ask } = pending!;
  pending = null;
  return ask;
}

/**
 * Open what's asked for this chat, when it mounts and on every ask after.
 * Pass null until the chat's own session has loaded: the workbench resets
 * to its execution's saved state then, and an ask taken before that would
 * be reset away.
 */
export function useWorkbenchViewRequests(sessionId: string | null, open: (ask: WorkbenchViewAsk) => void): void {
  useEffect(() => {
    if (!sessionId) return;
    const take = () => {
      const ask = takeWorkbenchView(sessionId);
      if (ask) open(ask);
    };
    take();
    window.addEventListener(EVENT_NAME, take);
    return () => window.removeEventListener(EVENT_NAME, take);
  }, [sessionId, open]);
}
