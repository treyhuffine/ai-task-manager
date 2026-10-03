import { legacySchema } from '@/lib/server/inputs';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/** A connected computer consumes only its own durable notification channel.
 * This route grants no native filesystem, OAuth or service capability. Native
 * presentation still requires consent in the trusted local companion. */
import { isHostKeyHash } from '@/lib/auth/host-key';
import { getRequestKey } from '@/lib/auth/request-key';
import { hashToken } from '@/lib/auth/tokens';
import { getApiKey, getDevice } from '@/lib/db/queries';
import { desktopNotificationActionResult, desktopNotificationActionSchema, desktopNotificationStatusResult } from '@/lib/notifications/desktop-api';

function channel(request: OperationContext): string | null {
  const caller = getRequestKey(request.headers);
  const authorization = request.headers.get('authorization');
  if (!caller || caller.scope !== 'viewer' || caller.location !== 'elsewhere' || !authorization?.startsWith('Bearer ')) return null;
  const key = getApiKey(caller.apiKeyId);
  if (!key || key.role !== 'sign_in' || !key.deviceId || key.revokedAt || (key.expiresAt && Date.parse(key.expiresAt) <= Date.now())) return null;
  // Recheck the credential as well as the proxy context. No forged device id,
  // expired/revoked key, or host token can select another computer's channel.
  if (hashToken(authorization.slice(7).trim()) !== key.hash || isHostKeyHash(key.hash)) return null;
  const device = getDevice(key.deviceId);
  if (!device || device.kind !== 'computer' || device.status !== 'active') return null;
  return `desktop:device:${device.id}`;
}
const denied = () => reply({ error: 'Use this connected computer’s sign-in key to manage its desktop notifications.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  const id = channel(request);
  return id ? desktopNotificationStatusResult(id) : denied();
}
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const id = channel(request);
  return id ? desktopNotificationActionResult(rpcInput.body, id, () => channel(request) === id) : denied();
}

export const GETInput = rpcZ.object({}).strict().default({});
export const POSTInput = rpcZ.object({ body: legacySchema(desktopNotificationActionSchema) }).strict();
