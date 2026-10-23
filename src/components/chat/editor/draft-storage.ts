/**
 * Pure decision logic for chat-input draft persistence, factored out of
 * `chat-input-editor.tsx` so the one subtle invariant — "never delete a
 * saved draft before it's been restored" — is unit-testable without
 * standing up a live Tiptap editor in a DOM environment.
 */

import { homeDocumentKey } from '@/lib/home/document-scope';
import type { DocumentBinding } from '@/lib/home/document-binding';

export const DRAFT_STORAGE_PREFIX = 'ri:chat-draft:';
export const DRAFT_SAVE_DEBOUNCE_MS = 300;

export type DraftStorageAction = 'save' | 'remove' | 'skip';

export function draftIdentity(key: string): { base: string; scope: DocumentBinding | null } {
  const scoped = /^([^:]+):([^:]+):(.+)$/.exec(key);
  if (!scoped) return { base: key, scope: null };
  return { base: scoped[3], scope: { homeId: decodeURIComponent(scoped[1]), viewerId: decodeURIComponent(scoped[2]) } };
}

export function scopedDraftKey(key: string, scope: DocumentBinding | null): string {
  if (!scope) return key;
  const identity = draftIdentity(key);
  if (identity.scope) return key;
  const separator = key.indexOf(':');
  return homeDocumentKey(key.slice(0, separator), key.slice(separator + 1), scope);
}

export function encodeChatDraft(key: string, doc: unknown): string {
  const { scope } = draftIdentity(key);
  return JSON.stringify(scope ? { version: 2, author: scope, doc } : doc);
}

/** Check both the storage identity and any saved author before exposing text to an editor. */
export function decodeChatDraft(key: string, raw: string, expected: DocumentBinding | null): unknown | null {
  const { scope } = draftIdentity(key);
  if (expected && (!scope || scope.homeId !== expected.homeId || scope.viewerId !== expected.viewerId)) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.version === 2) {
      if (!scope || value.author?.homeId !== scope.homeId || value.author?.viewerId !== scope.viewerId) return null;
      return value.doc?.type === 'doc' ? value.doc : null;
    }
    // Earlier scoped Team drafts already have their author in the key.
    return value?.type === 'doc' ? value : null;
  } catch { return null; }
}

/** Only a personal Home may adopt a pre-scoping draft. A failed save keeps the original. */
export function restoreChatDraft(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string,
  expected: DocumentBinding | null, personal: boolean): unknown | null {
  const current = storage.getItem(DRAFT_STORAGE_PREFIX + key);
  if (current) return decodeChatDraft(key, current, expected);
  const { base, scope } = draftIdentity(key);
  if (!personal || !scope || scope.viewerId !== 'local') return null;
  const oldKey = DRAFT_STORAGE_PREFIX + base;
  const previous = storage.getItem(oldKey);
  if (!previous) return null;
  const doc = decodeChatDraft(base, previous, null);
  if (!doc) return null;
  const encoded = encodeChatDraft(key, doc);
  try {
    storage.setItem(DRAFT_STORAGE_PREFIX + key, encoded);
    if (storage.getItem(DRAFT_STORAGE_PREFIX + key) === encoded) storage.removeItem(oldKey);
  } catch { /* Keep the old draft until a durable scoped save succeeds. */ }
  return doc;
}

/**
 * Decide what a draft-persisting editor should do with `localStorage`
 * given its current state.
 *
 * The bug this guards against: on mount a freshly-created (empty) editor
 * fires a transient `onUpdate` *before* the restore effect has loaded the
 * draft. Acting on that update would `removeItem` the very draft we're
 * about to read back, so a page reload silently lost the draft. The
 * `hydrated` flag means "this editor has already loaded (or confirmed the
 * absence of) the stored draft for this key" — only then is an empty
 * editor a real signal that the user cleared their draft.
 *
 * - not hydrated         → 'skip'   (don't touch storage while populating)
 * - hydrated + empty      → 'remove' (user cleared it / message was sent)
 * - chip still uploading  → 'skip'   (a restored spinner would be stuck)
 * - otherwise             → 'save'
 */
export function draftStorageAction(state: {
  isEmpty: boolean;
  hasPendingChip: boolean;
  hydrated: boolean;
}): DraftStorageAction {
  if (!state.hydrated) return 'skip';
  if (state.isEmpty) return 'remove';
  if (state.hasPendingChip) return 'skip';
  return 'save';
}
