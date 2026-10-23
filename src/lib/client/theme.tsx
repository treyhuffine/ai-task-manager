'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Theme } from '@/types/dashboard';

export const CLIENT_THEME_KEY = 'ri.client.theme';
const CHANGE_EVENT = 'ri:client-theme';
let fallback: Theme = 'dark';

function read(): Theme {
  try {
    const value = window.localStorage.getItem(CLIENT_THEME_KEY);
    return value === 'light' || value === 'dark' ? value : fallback;
  } catch { return fallback; }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === CLIENT_THEME_KEY || event.key === null) listener(); };
  window.addEventListener('storage', storage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(CHANGE_EVENT, listener); };
}
function setTheme(theme: Theme) {
  fallback = theme;
  try { window.localStorage.setItem(CLIENT_THEME_KEY, theme); } catch { /* Browser preferences still work without storage. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
const serverTheme = (): Theme => 'dark';

/** A browser preference shared by personal, embedded and standalone Home documents. */
export function useClientTheme() {
  const theme = useSyncExternalStore(subscribe, read, serverTheme);
  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme]);
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);
  return { theme, setTheme, toggleTheme };
}

export function ClientAppearance() { useClientTheme(); return null; }
