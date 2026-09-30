import { documentSaves } from './document-saves';
import { flushCaptureDrafts, hasPendingCapture } from './capture-draft';
import { flushChatDrafts } from './chat-drafts';
import { hasActiveInput } from './active-input';

let preparedReload = false;
export function isPreparedVersionReload() { return preparedReload; }

/** Ordinary reloads have no asynchronous save handshake. Prove chat retention
 * synchronously and let beforeunload block anything still unsafe. */
export function shouldBlockViewerUnload(isMutating: () => number): boolean {
  if (isPreparedVersionReload()) return false;
  try { flushChatDrafts(); } catch { return true; }
  return documentSaves.has() || isMutating() > 0 || hasActiveInput() || hasPendingCapture();
}

/** Authorize only the immediate reload whose drafts were just proven safe.
 * The next event-loop turn restores the ordinary unload guard if navigation
 * was cancelled. Pending drafts stay in storage for the new client's review. */
export async function reloadVersion(isMutating: () => number, retainUnsaved = false, reload: () => void = () => window.location.reload()) {
  await prepareVersionReload(isMutating, retainUnsaved);
  preparedReload = true;
  try { reload(); }
  finally { setTimeout(() => { preparedReload = false; }, 0); }
}

/** A new API contract can reject old saves. Only an explicit refresh may
 * carry those retained patches into the new client for its recovery UI. */
export async function prepareVersionReload(isMutating: () => number, retainUnsaved = false): Promise<void> {
  if (hasActiveInput() || isMutating()) throw new Error('Waiting for active input or a request to finish.');
  try { await documentSaves.flushAll(); }
  catch (error) { if (!retainUnsaved) throw error; documentSaves.retainAll(); }
  await flushCaptureDrafts();
  flushChatDrafts();
  if (hasActiveInput() || hasPendingCapture() || isMutating()) throw new Error('Waiting for active input or a request to finish.');
  if (documentSaves.has()) {
    if (!retainUnsaved) throw new Error('Waiting for changes to save.');
    documentSaves.retainAll();
  }
}
