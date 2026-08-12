import { checkGhStatus } from '@/lib/workspaces/gh';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  try {
    const status = await checkGhStatus();
    return Response.json(status);
  } catch (err) {
    console.error('[GET /api/gh/status]', err);
    return Response.json({ installed: false, authenticated: false });
  }
}
