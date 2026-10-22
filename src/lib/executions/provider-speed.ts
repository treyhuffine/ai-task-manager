import type { ServiceTier } from '@/db/types';

const KEY = 'ri.agent.speed.v1';

/** Last explicit choice per harness. Catalog validation always happens before reuse. */
export function readProviderSpeed(harness: string): ServiceTier | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}')?.[harness];
    return typeof value === 'string' && /^[a-z][a-z0-9_-]*$/.test(value) ? value : null;
  } catch { return null; }
}

export function writeProviderSpeed(harness: string, speed: ServiceTier): void {
  if (typeof window === 'undefined' || !/^[a-z][a-z0-9_-]*$/.test(speed)) return;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const choices = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    localStorage.setItem(KEY, JSON.stringify({ ...choices, [harness]: speed }));
  } catch { /* A browser preference must not prevent an explicit selection. */ }
}
