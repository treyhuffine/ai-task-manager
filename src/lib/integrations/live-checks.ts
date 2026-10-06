/**
 * Per-provider "live checks" for the integrations test page — a few READ-ONLY actions that verify a
 * connected account against the vendor's real API (the contract the mock-based smoke test can't
 * prove). Safe to run on a real account: no writes, no side effects. Keyed by providerId; extend
 * as other providers want a one-click contract check.
 */
export interface LiveCheck {
  /** Stable key within the provider. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  /** The action to run. */
  actionId: string;
  /** Input payload (kept minimal + safe). */
  input: Record<string, unknown>;
}

// Hosted providers are tested through discovered connection health. Add a
// deterministic read probe here only after its tool input contract is verified.
export const LIVE_CHECKS: Record<string, LiveCheck[]> = {};
