'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { useHomeStorageScope } from '@/components/home/home-context';
import { homeStorageIdentity } from '@/lib/home/document-scope';
const subscribe = (changed: () => void) => {
  window.addEventListener('storage', changed);
  window.addEventListener('ri:rail-preference', changed);
  return () => { window.removeEventListener('storage', changed); window.removeEventListener('ri:rail-preference', changed); };
};
export function useRailCollapse() {
  const key = homeStorageIdentity('ri.rail.collapsed', useHomeStorageScope());
  const read = useCallback(() => { try { return window.localStorage.getItem(key) === '1'; } catch { return false; } }, [key]);
  const collapsed = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => { try { window.localStorage.setItem(key, next ? '1' : '0'); window.dispatchEvent(new Event('ri:rail-preference')); } catch { /* Unavailable browser storage leaves navigation usable. */ } }, [key]);
  const toggle = useCallback(() => set(!read()), [set, read]);
  return { collapsed, set, toggle };
}
