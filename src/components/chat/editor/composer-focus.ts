/**
 * Which chat composer ⌘I (`HOTKEYS.focusChatInput`) goes to when more than
 * one is on screen: an agent's main chat with a chat open beside it, Home's
 * chat with a task's chat in a slideout. It goes to the composer last
 * focused, while that one is still showing, otherwise to the first one on
 * screen. A composer behind another tab (`inert`), hidden, or unmounted is
 * never the target, so the key never lands somewhere you can't see.
 *
 * Browser-only module state: the composers on one page.
 */

export interface ComposerEntry {
  /** The editable element. */
  el: HTMLElement;
  focus: () => void;
  /** Add text at the end of what's typed, and focus it (the scratchpad's Chat action). */
  insert: (text: string) => void;
}

const entries = new Set<ComposerEntry>();
const listeners = new Set<() => void>();
let last: ComposerEntry | null = null;

function notify() {
  for (const listener of listeners) listener();
}

/** Whether the composer is on screen and can take focus. */
function showing(entry: ComposerEntry): boolean {
  const { el } = entry;
  return el.isConnected && el.getClientRects().length > 0 && !el.closest('[inert]');
}

/** Add a mounted composer. Returns its removal. */
export function registerComposer(entry: ComposerEntry): () => void {
  entries.add(entry);
  notify();
  return () => {
    entries.delete(entry);
    if (last === entry) last = null;
    notify();
  };
}

/** Remember the composer that just took focus. */
export function noteComposerFocus(entry: ComposerEntry): void {
  if (last === entry) return;
  last = entry;
  notify();
}

/** Whether an element is one of the composers (so ⌘I there isn't another editor's italic). */
export function isComposerElement(el: Element): boolean {
  for (const entry of entries) if (entry.el === el) return true;
  return false;
}

/** The composer ⌘I focuses now, or null when none is showing. */
export function composerTarget(): ComposerEntry | null {
  if (last && entries.has(last) && showing(last)) return last;
  for (const entry of entries) if (showing(entry)) return entry;
  return null;
}

/** Called when the composers or the last focused one change. */
export function subscribeComposers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
