import { isDesktopRequest } from '@/lib/integrations/desktop-oauth';
import { getIntegrationRedirectUri, getProviderStatuses } from '@/lib/integrations/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** Per-provider connect readiness + how each connects (drives the test page UI). */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  return reply({
    redirectUri: getIntegrationRedirectUri(),
    providers: await getProviderStatuses(isDesktopRequest(request)),
  });
}

export const GETInput = rpcZ.object({}).strict().default({});
