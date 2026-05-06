/**
 * Thin composition over `@agentex/github`. The library exposes the gh-CLI
 * wrappers; we just bundle the two preflight checks the workspace settings
 * sheet needs into one round-trip.
 *
 * Lazy-imported for the same ESM-only-exports reason the workspace lib is —
 * the orchestrator CLI dispatches through tsx, which can't statically
 * resolve packages with no `"require"` exports condition.
 */

export interface GhStatus {
  installed: boolean;
  version?: string;
  authenticated: boolean;
  user?: string;
  host?: string;
}

/**
 * Detect `gh` install + auth state. Never throws — if the CLI isn't
 * available we just report `installed: false` so the UI can show the
 * non-blocking install banner without breaking the rest of the page.
 */
export async function checkGhStatus(): Promise<GhStatus> {
  try {
    const { github } = await import('@agentex/github');
    const installed = await github.checkInstalled();
    if (!installed.installed) {
      return { installed: false, authenticated: false };
    }
    const auth = await github.checkAuthenticated();
    return {
      installed: true,
      version: installed.version,
      authenticated: auth.authenticated,
      user: auth.user,
      host: auth.host,
    };
  } catch {
    return { installed: false, authenticated: false };
  }
}
