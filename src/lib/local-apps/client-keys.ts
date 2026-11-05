/**
 * Keys for a local app's outside clients, such as a browser extension. The
 * app's Connect screen manages them through these capabilities. A key reaches
 * only the actions the package declared in `requests.clientActions`
 * (src/lib/local-apps/client-policy.ts and the client route enforce that).
 */
import { z } from 'zod/v4';
import { AppError } from '@ri/app-kit/contract';
import type { CapabilityCall } from '@ri/app-kit/runtime';
import { getLocalBaseUrl, getRemoteBaseUrl } from '@/lib/auth/bootstrap';
import { createAppClientKey, listAppClientKeys, revokeAppClientKeys } from '@/lib/db/queries';
import type { ApiKeyRecord } from '@/db/types';

const CAPABILITIES = ['create_client_key', 'list_client_keys', 'revoke_client_key'] as const;
export function isClientKeyCapability(name: string): boolean {
  return (CAPABILITIES as readonly string[]).includes(name);
}

const view = (key: ApiKeyRecord) => ({ id: key.id, name: key.name, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt });

/** Where this Home and this app can be reached from another computer, or this one when it has no public address. */
function address(slug: string) {
  const homeUrl = (getRemoteBaseUrl() ?? getLocalBaseUrl()).replace(/\/+$/, '');
  return { homeUrl, appUrl: `${homeUrl}/apps/${slug}` };
}

export function callClientKeyCapability(instance: { id: string; slug: string }, call: CapabilityCall) {
  if (call.name === 'list_client_keys') return { keys: listAppClientKeys(instance.id).map(view), ...address(instance.slug) };
  if (call.name === 'create_client_key') {
    const { name } = z.object({ name: z.string().min(1).max(80) }).strict().parse(call.input);
    const { key, token } = createAppClientKey(instance.id, name);
    return { key: view(key), token: token.plaintext, ...address(instance.slug) };
  }
  if (call.name === 'revoke_client_key') {
    const { id } = z.object({ id: z.string().min(1).max(64) }).strict().parse(call.input);
    revokeAppClientKeys(instance.id, id);
    return { revoked: true };
  }
  throw new AppError('unsupported', 'That capability is not available');
}
