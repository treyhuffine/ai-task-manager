import { getIntegrationAdmin, invalidateIntegrationRuntime } from '@/lib/integrations/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { isIntegrationError } from '@integrations/engine';
import { z as rpcZ } from 'zod/v4';

/** Set which auth config is the default for a provider (blocked while legacy connections exist). */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const body = (rpcInput.body) as { providerId?: string; id?: string };
  if (!body.providerId || !body.id) {
    return reply({ error: 'providerId and id required' }, { status: 400 });
  }
  try {
    await (await getIntegrationAdmin()).setDefault(body.providerId, body.id);
    invalidateIntegrationRuntime();
    return reply({ ok: true });
  } catch (e) {
    const code = isIntegrationError(e) ? e.code : undefined;
    return reply({ error: code ?? (e instanceof Error ? e.message : String(e)) }, { status: code === 'conflict' ? 409 : 400 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "providerId": rpcZ.string().optional(), "id": rpcZ.string().optional() }).strict().default({}) }).strict();
