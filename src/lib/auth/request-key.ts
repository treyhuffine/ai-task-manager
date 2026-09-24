/**
 * Which key made a request, as the proxy validated it.
 *
 * `src/proxy.ts` removes any inbound copy of these headers from every
 * request, then sets them for the key it accepted, so a handler can trust
 * them and a caller can't forge them. They are absent on public routes.
 */

import { APP_SHORT_ID } from '@/constants/app';

export const API_KEY_ID_HEADER = `x-${APP_SHORT_ID}-api-key-id`;
export const API_KEY_TYPE_HEADER = `x-${APP_SHORT_ID}-api-key-type`;

export const FORWARDED_KEY_HEADERS = [API_KEY_ID_HEADER, API_KEY_TYPE_HEADER] as const;

export interface RequestKey {
  apiKeyId: string;
  /** The key's device type. `host` is the home machine's own key. */
  deviceType: string;
}

export function getRequestKey(headers: Headers): RequestKey | null {
  const apiKeyId = headers.get(API_KEY_ID_HEADER);
  const deviceType = headers.get(API_KEY_TYPE_HEADER);
  if (!apiKeyId || !deviceType) return null;
  return { apiKeyId, deviceType };
}

/**
 * Whether the caller is on the home's own machine. Only the host key is:
 * sessions the home runs and the home's own CLI use it. Every other key
 * belongs to another computer, a phone, or a service.
 */
export function isOnHomeMachine(key: RequestKey | null): boolean {
  return key?.deviceType === 'host';
}
