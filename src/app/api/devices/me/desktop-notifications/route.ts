/** A connected computer consumes only its own durable notification channel.
 * This route grants no native filesystem, OAuth or service capability. Native
 * presentation still requires consent in the trusted local companion. */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getRequestKey } from '@/lib/auth/request-key';
import { hashToken } from '@/lib/auth/tokens';
import { isHostKeyHash } from '@/lib/auth/host-key';
import { getApiKey, getDevice } from '@/lib/db/queries';
import { desktopNotificationAction, desktopNotificationStatus } from '@/lib/notifications/desktop-api';

function channel(request: NextRequest): string | null {
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
const denied = () => NextResponse.json({ error: 'Use this connected computer’s sign-in key to manage its desktop notifications.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
export function GET(request: NextRequest) {
  const id = channel(request);
  return id ? desktopNotificationStatus(id) : denied();
}
export async function POST(request: NextRequest) {
  const id = channel(request);
  return id ? desktopNotificationAction(request, id, () => channel(request) === id) : denied();
}
