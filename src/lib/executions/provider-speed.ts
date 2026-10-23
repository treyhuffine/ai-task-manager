import type { ServiceTier } from '@/db/types';
import { homeStorageIdentity } from '@/lib/home/document-scope';
type HomeScope = Parameters<typeof homeStorageIdentity>[1];

const KEY = 'ri.agent.speed.v1';

/** Last explicit choice per harness. Catalog validation always happens before reuse. */
export function readProviderSpeed(harness: string, scope?: HomeScope): ServiceTier | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(localStorage.getItem(homeStorageIdentity(KEY, scope)) ?? '{}')?.[harness];
    return typeof value === 'string' && /^[a-z][a-z0-9_-]*$/.test(value) ? value : null;
  } catch { return null; }
}

export function writeProviderSpeed(harness: string, speed: ServiceTier, scope?: HomeScope): void {
  if (typeof window === 'undefined' || !/^[a-z][a-z0-9_-]*$/.test(speed)) return;
  try {
    const key = homeStorageIdentity(KEY, scope);
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    const choices = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    localStorage.setItem(key, JSON.stringify({ ...choices, [harness]: speed }));
  } catch { /* A browser preference must not prevent an explicit selection. */ }
}
