'use client';

import { useSyncExternalStore } from 'react';

interface FeedbackModalState {
  open: boolean;
  returnFocus: HTMLElement | null;
}
let state: FeedbackModalState = { open: false, returnFocus: null };
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
export function openFeedback(): void {
  const active = document.activeElement;
  state = {
    open: true,
    returnFocus: active instanceof HTMLElement && active !== document.body ? active : null,
  };
  emit();
}
export function setFeedbackOpen(open: boolean): void {
  if (state.open === open) return;
  state = { ...state, open };
  emit();
}
export function closeFeedback(): void {
  setFeedbackOpen(false);
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function getSnapshot(): FeedbackModalState {
  return state;
}
export function useFeedbackStore(): FeedbackModalState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
