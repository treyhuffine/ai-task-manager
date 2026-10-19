import { detectMcpAuth } from '@/lib/integrations/mcp-auth-detect';
import { MCP_LIMITS } from '@/lib/integrations/mcp-validate';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Work out how a custom MCP server authenticates before it is added
 * (`src/lib/integrations/mcp-auth-detect.ts`). The add form calls this as the
 * URL is typed. Nothing is saved, no credentials are sent, and an address that
 * can't be probed comes back as a plain verdict rather than a failure, so the
 * form can say so and let the person choose by hand.
 */
export async function POST(input: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  return reply({ detection: await detectMcpAuth(input.body.url, { signal: request.signal }) });
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ url: rpcZ.string().max(MCP_LIMITS.maxUrlLength) }).strict() }).strict();
