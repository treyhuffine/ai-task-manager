import { documentSaves } from './document-saves';
import { flushCaptureDrafts, hasPendingCapture } from './capture-draft';
import { flushChatDrafts } from './chat-drafts';
import { hasActiveInput } from './active-input';

let preparedReload = false;
export function isPreparedVersionReload() { return preparedReload; }

export type UnloadBlocker = 'chat' | 'document' | 'input' | 'capture' | 'request';

/** The browser's leave dialog can't say why, so the view explains it. */
export const UNLOAD_BLOCKER_MESSAGES: Record<UnloadBlocker, string> = {
  chat: 'A chat draft isn\'t saved yet, usually because a file is still uploading.',
  document: 'Edits to a task, note or area haven\'t reached Ri yet.',
  input: 'Voice input is still recording or transcribing.',
  capture: 'A capture isn\'t saved on this device yet.',
  request: 'Something you typed is still on its way to Ri.',
};

/** Ordinary reloads have no asynchronous save handshake. Prove chat retention
 * synchronously and name the first thing a reload right now would lose. */
export function viewerUnloadBlocker(isMutating: () => number): UnloadBlocker | null {
  if (isPreparedVersionReload()) return null;
  try { flushChatDrafts(); } catch { return 'chat'; }
  if (documentSaves.has()) return 'document';
  if (hasActiveInput()) return 'input';
  if (hasPendingCapture()) return 'capture';
  if (isMutating() > 0) return 'request';
  return null;
}

export function shouldBlockViewerUnload(isMutating: () => number): boolean {
  return viewerUnloadBlocker(isMutating) !== null;
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
