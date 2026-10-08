import { readAuthConfig, writeAuthConfig } from '@/lib/auth/config-file';
import { ActionError } from '@/lib/orchestrator/types';

/** Gates admit new work only. Saved records and retention always remain available. */
export function getWorkResultCapabilities() {
  const config = readAuthConfig();
  const handoffsEnabled = config?.handoffsEnabled === true;
  return { handoffsEnabled, aiReviewEnabled: handoffsEnabled && config?.aiReviewEnabled === true };
}

export function handoffsEnabled(): boolean {
  return getWorkResultCapabilities().handoffsEnabled;
}

export function aiReviewEnabled(): boolean {
  return getWorkResultCapabilities().aiReviewEnabled;
}

export function assertHandoffsEnabled(): void {
  if (!handoffsEnabled()) throw new ActionError('unsupported', 'Handoffs are disabled. Saved results remain readable.');
}

export function assertAiReviewEnabled(): void {
  if (!aiReviewEnabled()) throw new ActionError('unsupported', 'AI review is disabled. Both handoffs and AI review must be enabled to start a review.');
}

export function setWorkResultCapabilities(input: { handoffsEnabled?: boolean; aiReviewEnabled?: boolean }) {
  writeAuthConfig(input);
  return getWorkResultCapabilities();
}
