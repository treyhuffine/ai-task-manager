import { INTEGRATION_LABELS } from '@/constants/integrations';
import { usesRegisteredOAuth } from '@/lib/integrations/hosted-oauth-config';
import { getIntegrationAdmin, getIntegrationOwnerId, getRegisteredMcpRedirectUrl, invalidateIntegrationRuntime } from '@/lib/integrations/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { isIntegrationError } from '@integrations/engine';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { z as rpcZ } from 'zod/v4';

/**
 * Manage BYO ("use your own OAuth app") auth configs for a provider. These persist in the home
 * store (`.config/integrations/auth-configs.json`, client secret sealed) — never repo env. The
 * admin service seals the secret and enforces the cross-store invariants (no delete while
 * connections use it; no default repoint while legacy connections exist).
 *
 *   GET    ?providerId=slack            → list this provider's BYO configs (secret-free summaries)
 *   POST   { providerId, label, oauth, clientSecret?, ... } → add one
 *   DELETE ?id=slack-xxxx               → remove (blocked while in use)
 *
 * SCOPE: local single-user only — `admin.list`/`removeConfig` are NOT owner/tenant-filtered, so a
 * hosted multi-user deployment MUST add owner-scoped listing + per-mutation ownership checks (the
 * §20 isolation contract) before exposing this. Today every config is owner `'local'`.
 */
function errorResponse(e: unknown) {
  const code = isIntegrationError(e) ? e.code : undefined;
  const status = code === 'conflict' ? 409 : code === 'invalid_input' ? 400 : 400;
  return reply({ error: code ?? (e instanceof Error ? e.message : String(e)) }, { status });
}

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  const providerId = new URL(request.url).searchParams.get('providerId');
  if (!providerId) return reply({ error: 'providerId required' }, { status: 400 });
  return reply({ configs: await (await getIntegrationAdmin()).list(providerId) });
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const body = (rpcInput.body) as {
    providerId?: string;
    scheme?: 'oauth2';
    label?: string;
    oauth?: { clientId: string; redirectUri: string };
    clientSecret?: string;
    defaultScopes?: string[];
    allowedScopes?: string[];
    baseUrl?: string;
  };
  if (!body.providerId) return reply({ error: 'providerId required' }, { status: 400 });
  try {
    const hosted = getHostedMcpProvider(body.providerId);
    if (usesRegisteredOAuth(hosted)) {
      if (!body.oauth?.clientId?.trim() || !body.clientSecret?.trim()) throw new Error('Client ID and client secret are required.');
      if (body.oauth.redirectUri !== getRegisteredMcpRedirectUrl(body.providerId)) throw new Error(`Use the callback address shown in ${INTEGRATION_LABELS.singular.toLowerCase()} setup.`);
      if (body.baseUrl || body.defaultScopes?.length || body.allowedScopes?.length) throw new Error(`This ${INTEGRATION_LABELS.singular.toLowerCase()} uses its official address and provider consent scopes.`);
    }
    const summary = await (await getIntegrationAdmin()).addConfig({
      providerId: body.providerId,
      scheme: body.scheme ?? 'oauth2',
      label: body.label ?? '',
      scope: 'owner',
      ownerId: getIntegrationOwnerId(),
      ...(body.oauth ? { oauth: body.oauth } : {}),
      ...(body.clientSecret ? { clientSecret: body.clientSecret } : {}),
      ...(body.defaultScopes ? { defaultScopes: body.defaultScopes } : {}),
      ...(body.allowedScopes ? { allowedScopes: body.allowedScopes } : {}),
      ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}),
    });
    invalidateIntegrationRuntime();
    return reply({ config: summary });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, request: OperationContext) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return reply({ error: 'id required' }, { status: 400 });
  try {
    await (await getIntegrationAdmin()).removeConfig(id);
    invalidateIntegrationRuntime();
    return reply({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "providerId": rpcZ.string().optional() }).strict().optional() }).strict().default({});
export const POSTInput = rpcZ.object({ body: rpcZ.object({ "providerId": rpcZ.string().optional(), "scheme": rpcZ.literal("oauth2").optional(), "label": rpcZ.string().optional(), "oauth": rpcZ.object({ "clientId": rpcZ.string(), "redirectUri": rpcZ.string() }).strict().optional(), "clientSecret": rpcZ.string().optional(), "defaultScopes": rpcZ.array(rpcZ.string()).optional(), "allowedScopes": rpcZ.array(rpcZ.string()).optional(), "baseUrl": rpcZ.string().optional() }).strict().default({}) }).strict();
export const DELETEInput = rpcZ.object({ query: rpcZ.object({ "id": rpcZ.string().optional() }).strict().optional(), body: rpcZ.object({}).strict().default({}) }).strict();
