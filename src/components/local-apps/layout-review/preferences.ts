'use client';

import { useSyncExternalStore } from 'react';
import { isLayoutChoice, type LayoutChoice } from './options';

export const REVIEW_PREFERENCES_KEY = 'ri.apps.layout-review.v1';
const EVENT = 'ri:apps-layout-review';
const EMPTY = '{}';

export interface ReviewPreferences { layout: LayoutChoice; pinned: string[]; recent: string[] }
export function parsePreferences(raw: string): ReviewPreferences {
  let value: Partial<ReviewPreferences> = {};
  try { const parsed: unknown = JSON.parse(raw); if (parsed && typeof parsed === 'object') value = parsed; } catch { /* A damaged preference never blocks Apps. */ }
  const ids = (list: unknown) => Array.isArray(list) ? [...new Set(list.filter((id): id is string => typeof id === 'string' && id.length < 1000))].slice(0, 100) : [];
  return { layout: isLayoutChoice(value.layout) ? value.layout : 'discover', pinned: ids(value.pinned), recent: ids(value.recent) };
}
function read() { try { return window.localStorage.getItem(REVIEW_PREFERENCES_KEY) ?? EMPTY; } catch { return EMPTY; } }
export function readReviewPreferences() { return parsePreferences(read()); }
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (!event.key || event.key === REVIEW_PREFERENCES_KEY) listener(); };
  window.addEventListener(EVENT, listener); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', storage); };
}
export function updateReviewPreferences(change: (previous: ReviewPreferences) => ReviewPreferences) {
  try { window.localStorage.setItem(REVIEW_PREFERENCES_KEY, JSON.stringify(change(parsePreferences(read())))); } catch { /* URL navigation still works with storage disabled. */ }
  window.dispatchEvent(new Event(EVENT));
}
export function useReviewPreferences() {
  const raw = useSyncExternalStore(subscribe, read, () => EMPTY);
  return parsePreferences(raw);
}
export function rememberItem(key: string) {
  updateReviewPreferences(previous => ({ ...previous, recent: [key, ...previous.recent.filter(id => id !== key)].slice(0, 100) }));
}
