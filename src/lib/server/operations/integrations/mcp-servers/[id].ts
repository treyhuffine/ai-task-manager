import { INTEGRATION_LABELS } from '@/constants/integrations';
import { beginMcpAuthorization } from '@/lib/integrations/mcp-authorization';
import { removeMcpServer, updateMcpServerConfiguration } from '@/lib/integrations/mcp-lifecycle';
import type { McpServerAuth } from '@/lib/integrations/mcp-servers';
import { validateHeaderName, validateMcpUrl } from '@/lib/integrations/mcp-validate';
import {
  getIntegrationConnectionStore,
  getIntegrationOwnerId,
  getMcpServerStore,
  invalidateIntegrationRuntime,
} from '@/lib/integrations/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Edit (enable/disable, rename, change url/auth) or remove one MCP server. `slug` is immutable, so
 * it is never patchable. Any change invalidates the runtime so the next access re-ingests (or drops)
 * the server. Remove also deletes the derived engine connection so no `mcp_<slug>` row dangles.
 */
interface PatchBody {
  displayName?: string;
  url?: string;
  enabled?: boolean;
  auth?: McpServerAuth;
  toolOverrides?: Record<string, { enabled?: boolean; mutating?: boolean }>;
  secret?: string | null;
  reviewedRevision?: string;
}

export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const body = (rpcInput.body) as PatchBody;
  const entry = getMcpServerStore().get(id);
  if (!entry) return reply({ error: 'not_found' }, { status: 404 });
  if (body.reviewedRevision !== undefined) {
    if (typeof body.reviewedRevision !== 'string' || Object.keys(body).some(key => key !== 'reviewedRevision')) {
      return reply({ error: 'Review tool changes separately from connection settings.' }, { status: 400 });
    }
    try {
      const reviewed = await getMcpServerStore().acknowledgeCapabilities(id, body.reviewedRevision);
      return reviewed ? reply({ entry: reviewed }) : reply({ error: 'not_found' }, { status: 404 });
    } catch (error) {
      return reply({ error: error instanceof Error ? error.message : 'Tool changes could not be reviewed.' }, { status: 409 });
    }
  }
  if (entry?.providerId && (body.url !== undefined || body.auth !== undefined || body.secret !== undefined)) {
    return reply({ error: `Built-in ${INTEGRATION_LABELS.singular.toLowerCase()} services are managed by the app. Use Connect to sign in.` }, { status: 400 });
  }

  if (body.url !== undefined) {
    const check = validateMcpUrl(body.url);
    if (!check.ok) return reply({ error: check.error }, { status: 400 });
    body.url = check.url;
  }
  if (body.auth?.kind === 'header' && !validateHeaderName(body.auth.header)) {
    return reply({ error: 'That header name is not valid.' }, { status: 400 });
  }

  const updated = await updateMcpServerConfiguration(entry, getMcpServerStore(), getIntegrationConnectionStore(), getIntegrationOwnerId(), {
    ...(body.displayName !== undefined ? { displayName: body.displayName.trim() } : {}),
    ...(body.url !== undefined ? { url: body.url } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.auth !== undefined ? { auth: body.auth } : {}),
    ...(body.toolOverrides !== undefined ? { toolOverrides: body.toolOverrides } : {}),
    ...(body.secret !== undefined ? { secret: body.secret } : {}),
  });
  if (!updated) return reply({ error: 'not_found' }, { status: 404 });

  invalidateIntegrationRuntime();
  return reply({ entry: updated });
}

/**
 * (Re)start the OAuth flow for an existing OAuth server — used when a first attempt was abandoned,
 * or refresh failed and the user must re-consent. Returns the authorization URL for the browser.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  const entry = getMcpServerStore().get(id);
  if (!entry) return reply({ error: 'not_found' }, { status: 404 });
  if (entry.auth.kind !== 'oauth') {
    return reply({ error: 'not an OAuth server' }, { status: 400 });
  }
  try {
    return reply(await beginMcpAuthorization(entry, request));
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : 'Could not start authorization.' }, { status: 400 });
  }
}

export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const store = getMcpServerStore();
  const entry = store.get(id);
  if (!entry) return reply({ error: 'not_found' }, { status: 404 });

  if (!await removeMcpServer(entry, store, getIntegrationConnectionStore(), getIntegrationOwnerId())) {
    return reply({ error: 'not_found' }, { status: 404 });
  }
  invalidateIntegrationRuntime();
  return reply({ ok: true });
}

export const PATCHInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "displayName": rpcZ.string().optional(), "url": rpcZ.string().optional(), "enabled": rpcZ.boolean().optional(), "auth": rpcZ.union([rpcZ.object({ "kind": rpcZ.literal("none") }).strict(), rpcZ.object({ "kind": rpcZ.literal("bearer") }).strict(), rpcZ.object({ "kind": rpcZ.literal("header"), "header": rpcZ.string() }).strict(), rpcZ.object({ "kind": rpcZ.literal("oauth") }).strict()]).optional(), "toolOverrides": rpcZ.record(rpcZ.string(), rpcZ.object({ "enabled": rpcZ.boolean().optional(), "mutating": rpcZ.boolean().optional() }).strict()).optional(), "secret": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "reviewedRevision": rpcZ.string().optional() }).strict().default({}) }).strict();
export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
