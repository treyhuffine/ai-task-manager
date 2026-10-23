import { homeSettingsAdmission } from '@/lib/home/settings-authority';
import { reply, type OperationContext } from '@/lib/server/operation';
import { checkGhStatus } from '@/lib/workspaces/gh';
import { z as rpcZ } from 'zod/v4';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const homeDenied = homeSettingsAdmission(_request.headers, 'read');
  if (homeDenied) return homeDenied;
  try {
    const status = await checkGhStatus();
    return reply(status);
  } catch (err) {
    console.error('[GET /api/gh/status]', err);
    return reply({ installed: false, authenticated: false });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
