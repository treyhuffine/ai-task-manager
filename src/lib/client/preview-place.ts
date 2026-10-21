'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Where a file opened from a chat shows (`artifact-preview-provider.tsx`):
 *
 *   - `beside` (default): as a tab in the panel beside the chat, so the file
 *     and the conversation are both on screen.
 *   - `large`: the large dialog over the page.
 *
 * Learned, not configured: the switch in either view moves the open file and
 * makes that place the one the next file opens in, the way a Notion peek
 * remembers side or center. A chat with no panel beside it always opens the
 * large view. Per browser in localStorage, read through
 * `useSyncExternalStore` so server render and hydration agree on the default.
 */

export type PreviewPlace = 'beside' | 'large';

export const PREVIEW_PLACE_KEY = 'ri.client.previewPlace';
export const DEFAULT_PREVIEW_PLACE: PreviewPlace = 'beside';

const CHANGE_EVENT = 'ri:preview-place-changed';

export function parsePreviewPlace(raw: unknown): PreviewPlace {
  return raw === 'beside' || raw === 'large' ? raw : DEFAULT_PREVIEW_PLACE;
}

export function readPreviewPlace(): PreviewPlace {
  if (typeof window === 'undefined') return DEFAULT_PREVIEW_PLACE;
  try {
    return parsePreviewPlace(window.localStorage.getItem(PREVIEW_PLACE_KEY));
  } catch {
    return DEFAULT_PREVIEW_PLACE;
  }
}

export function writePreviewPlace(next: PreviewPlace): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREVIEW_PLACE_KEY, next);
  } catch {
    /* localStorage can throw in private mode: the choice lasts this page */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREVIEW_PLACE_KEY || event.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const serverSnapshot = (): PreviewPlace => DEFAULT_PREVIEW_PLACE;

export function usePreviewPlace(): [PreviewPlace, (next: PreviewPlace) => void] {
  const place = useSyncExternalStore(subscribe, readPreviewPlace, serverSnapshot);
  return [place, useCallback((next: PreviewPlace) => writePreviewPlace(next), [])];
}
