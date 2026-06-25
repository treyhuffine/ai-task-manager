/**
 * Per-provider "live checks" for the connectors test page — a few READ-ONLY actions that verify a
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

export const LIVE_CHECKS: Record<string, LiveCheck[]> = {
  twitter: [
    { id: 'me', label: 'Authenticated user (GET /2/users/me)', actionId: 'twitter.get_users_me', input: {} },
    {
      id: 'lookup',
      label: 'Lookup @TwitterDev',
      actionId: 'twitter.get_users_by_username',
      input: { username: 'TwitterDev', 'user.fields': ['description', 'public_metrics'] },
    },
    {
      id: 'search',
      label: 'Recent search ("hello")',
      actionId: 'twitter.search_posts_recent',
      input: { query: 'hello', max_results: 10 },
    },
  ],
};
