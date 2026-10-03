/**
 * Which harness the first run can set up without asking, from a sign-in
 * check of each one. Pure, so the choice is tested apart from the network.
 *
 * Asking nothing is right only when it costs nothing and needs no choice:
 * Codex on a subscription, then Claude Code on a subscription (or Bedrock).
 * Everything else goes to the person: a key-only setup bills per call and
 * needs their agreement, and Cursor, OpenCode and Antigravity need a model
 * picked (none ships a bundled catalog).
 */

import { DEFAULT_HARNESS, HARNESS_IDS, type HarnessId } from '@/lib/harness/registry';
import type { HarnessAuthReport } from './harness-setup';

export type HarnessReports = Partial<Record<HarnessId, HarnessAuthReport | null>>;

/** Each harness needs an explicit assessment before setup can skip the picker. */
const AUTO_SETUP_AUTH: Record<HarnessId, 'subscription' | 'subscription_or_bedrock' | null> = {
  codex: 'subscription',
  claude: 'subscription_or_bedrock',
  cursor: null,
  opencode: null,
  antigravity: null,
};

/** The first eligible harness in registry order, or null when the person has to choose. */
export function autoHarness(reports: HarnessReports): HarnessId | null {
  return HARNESS_IDS.find((id) => {
    const report = reports[id];
    if (!report?.binary.installed) return false;
    const auth = AUTO_SETUP_AUTH[id];
    return auth !== null && (report.hasSubscription || (auth === 'subscription_or_bedrock' && report.hasBedrock));
  }) ?? null;
}

/**
 * Where the picker should start when the person has to choose: the first
 * enabled, installed harness in registry order, else the registry default.
 */
export function suggestedHarness(reports: HarnessReports): HarnessId {
  return HARNESS_IDS.find((id) => reports[id]?.binary.installed) ?? DEFAULT_HARNESS;
}
