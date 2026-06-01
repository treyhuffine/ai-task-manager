/**
 * Pure decision logic for chat-input draft persistence, factored out of
 * `chat-input-editor.tsx` so the one subtle invariant — "never delete a
 * saved draft before it's been restored" — is unit-testable without
 * standing up a live Tiptap editor in a DOM environment.
 */

export const DRAFT_STORAGE_PREFIX = 'flow:chat-draft:';
export const DRAFT_SAVE_DEBOUNCE_MS = 300;

export type DraftStorageAction = 'save' | 'remove' | 'skip';

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
