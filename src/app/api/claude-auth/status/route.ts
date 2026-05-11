import { getClaudeAuthStatus } from '@/lib/auth/claude';

/**
 * GET /api/claude-auth/status — wraps `claude auth status` JSON. Used by
 * the client poll loop after the user clicks "Log in" so we can flip the
 * banner to "Logged in" the moment the OAuth flow completes in their
 * browser.
 *
 * Cheap and side-effect free; safe to hit every ~750ms.
 */
export async function GET() {
  const status = await getClaudeAuthStatus();
  return Response.json(status);
}
