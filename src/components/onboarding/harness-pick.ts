/**
 * Which harness the first run can set up without asking, from a sign-in
 * check of each one. Pure, so the choice is tested apart from the network.
 *
 * Asking nothing is right only when it costs nothing and needs no choice:
 * Claude Code on a subscription (or Bedrock), else Codex on a subscription.
 * Everything else goes to the person: a key-only setup bills per call and
 * needs their agreement, and Cursor and OpenCode need a model picked.
 */

import type { HarnessId } from '@/lib/harness/registry';
import type { HarnessAuthReport } from './harness-setup';

export type HarnessReports = Partial<Record<HarnessId, HarnessAuthReport | null>>;

const PREFERENCE: readonly HarnessId[] = ['claude', 'codex', 'cursor', 'opencode'];

/** The harness to set up on its own, or null when the person has to choose. */
export function autoHarness(reports: HarnessReports): HarnessId | null {
  const claude = reports.claude;
  if (claude?.binary.installed && (claude.hasSubscription || claude.hasBedrock)) return 'claude';
  const codex = reports.codex;
  if (codex?.binary.installed && codex.hasSubscription) return 'codex';
  return null;
}

/** Where the picker should start when the person has to choose: the first one installed. */
export function suggestedHarness(reports: HarnessReports): HarnessId {
  return PREFERENCE.find((id) => reports[id]?.binary.installed) ?? 'claude';
}
