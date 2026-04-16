/**
 * Onboarding-status predicate.
 *
 * Single source of truth for "has the user completed first-run setup?"
 * The predicate can evolve (add checks like "required API keys present")
 * without every caller knowing the details. Call sites ask
 * `getIsOnboarded()`; implementation details live here.
 */

import { readAuthConfig, writeAuthConfig } from '@/lib/auth/config-file';

export function getIsOnboarded(): boolean {
  const config = readAuthConfig();
  return !!config?.onboardedAt;
}

export function markOnboarded(): void {
  writeAuthConfig({ onboardedAt: new Date().toISOString() });
}

export function getOnboardedAt(): Date | null {
  const config = readAuthConfig();
  if (!config?.onboardedAt) return null;
  const d = new Date(config.onboardedAt);
  return Number.isNaN(d.getTime()) ? null : d;
}
