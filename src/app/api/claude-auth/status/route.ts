import { getClaudeAuthStatus } from '@/lib/auth/claude';
import { withCompression } from '@/lib/api/compression';

/**
 * GET /api/claude-auth/status — wraps `claude auth status` JSON. Used by
 * the client poll loop after the user clicks "Log in" so we can flip the
 * banner to "Logged in" the moment the OAuth flow completes in their
 * browser.
 *
 * Cheap and side-effect free; safe to hit every ~750ms.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  const status = await getClaudeAuthStatus();
  return Response.json(status);
}
