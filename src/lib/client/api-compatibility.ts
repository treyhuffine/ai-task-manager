import type { ApiCompatibilityIssue } from '@/lib/releases/api-contract';
let issue: ApiCompatibilityIssue | null = null;
const listeners = new Set<() => void>();
export function getApiCompatibilityIssue() { return issue; }
export function subscribeApiCompatibility(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function reportApiCompatibility(value: unknown) {
  const next = value as ApiCompatibilityIssue | null;
  if (next && (next.error !== 'api_protocol' || !['home', 'client'].includes(next.update) || typeof next.message !== 'string')) return;
  if (JSON.stringify(next) === JSON.stringify(issue)) return;
  issue = next;
  for (const listener of listeners) listener();
}
