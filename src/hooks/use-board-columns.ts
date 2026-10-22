'use client';

import { useState, useSyncExternalStore } from 'react';

const CHANGE_EVENT = 'ri:board-columns';
/** Unknown/stale values are dropped. An explicit empty array stays empty. */
export function parseBoardColumns<T extends string>(raw: string | null, order: readonly T[], defaults: readonly T[]): T[] {
  try {
    const saved: unknown = raw === null ? null : JSON.parse(raw);
    if (Array.isArray(saved) && saved.every((value) => typeof value === 'string')) {
      return order.filter((value) => saved.includes(value));
    }
  } catch { /* Ignore a corrupt preference. */ }
  return [...defaults];
}
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function useBoardColumns<T extends string>(key: string, order: readonly T[], defaults: readonly T[]) {
  const [fallback, setFallback] = useState<string | null>(null);
  const raw = useSyncExternalStore(subscribe, () => {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }, () => null);
  const visible = parseBoardColumns(raw ?? fallback, order, defaults);
  const setVisible = (next: readonly T[]) => {
    try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { setFallback(JSON.stringify(next)); }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  return { visible, setVisible };
}

/** HUD focus is temporary: it never writes column preferences. */
export function revealedColumns<T extends string>(order: readonly T[], visible: readonly T[], focus: T | null): T[] {
  return order.filter((id) => visible.includes(id) || id === focus);
}
