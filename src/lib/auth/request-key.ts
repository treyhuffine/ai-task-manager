/**
 * Which key made a request, and whether it is the home's own key, as the
 * proxy validated them.
 *
 * `src/proxy.ts` removes any inbound copy of these headers from every
 * request, then sets them for the key it accepted, so a handler can trust
 * them and a caller can't forge them. They are absent on public routes.
 *
 * Location comes from the credential, never from the key's editable
 * `deviceType` label: only the home's own key (src/lib/auth/host-key.ts)
 * counts as the home machine. Scope comes from the key's enrollment: only a
 * key issued by redeeming an enroll grant is a worker key
 * (docs/homes-build.md, P2.2), and it carries its computer.
 */

import { APP_SHORT_ID } from '@/constants/app';

export const API_KEY_ID_HEADER = `x-${APP_SHORT_ID}-api-key-id`;
export const API_KEY_TYPE_HEADER = `x-${APP_SHORT_ID}-api-key-type`;
export const CALLER_LOCATION_HEADER = `x-${APP_SHORT_ID}-caller-location`;
export const API_KEY_SCOPE_HEADER = `x-${APP_SHORT_ID}-api-key-scope`;
export const WORKER_COMPUTER_HEADER = `x-${APP_SHORT_ID}-worker-computer-id`;
/** The chat a session token speaks for (docs/homes-build.md, P2.7). */
export const SESSION_CHAT_HEADER = `x-${APP_SHORT_ID}-session-chat-id`;

export const FORWARDED_KEY_HEADERS = [
  API_KEY_ID_HEADER,
  API_KEY_TYPE_HEADER,
  CALLER_LOCATION_HEADER,
  API_KEY_SCOPE_HEADER,
  WORKER_COMPUTER_HEADER,
  SESSION_CHAT_HEADER,
] as const;

export type CallerLocation = 'home' | 'elsewhere';

/**
 * A viewing key reads and acts as the owner. A worker key only reaches the
 * worker routes. A session token only reaches its session's servers, as that
 * session.
 */
export type KeyScope = 'viewer' | 'worker' | 'session';

export interface RequestKey {
  apiKeyId: string;
  /** The key's device type label. Informational only: it grants nothing. */
  deviceType: string;
  /** `home` only for the home's own key. */
  location: CallerLocation;
  scope: KeyScope;
  /** The worker's computer, for a worker key or a session token. */
  workerComputerId: string | null;
  /** The chat a session token speaks for. */
  sessionChatId: string | null;
}

export function getRequestKey(headers: Headers): RequestKey | null {
  const apiKeyId = headers.get(API_KEY_ID_HEADER);
  const deviceType = headers.get(API_KEY_TYPE_HEADER);
  if (!apiKeyId || !deviceType) return null;
  const declared = headers.get(API_KEY_SCOPE_HEADER);
  const scope: KeyScope = declared === 'worker' || declared === 'session' ? declared : 'viewer';
  return {
    apiKeyId,
    deviceType,
    location: headers.get(CALLER_LOCATION_HEADER) === 'home' ? 'home' : 'elsewhere',
    scope,
    workerComputerId: scope === 'viewer' ? null : headers.get(WORKER_COMPUTER_HEADER),
    sessionChatId: scope === 'session' ? headers.get(SESSION_CHAT_HEADER) : null,
  };
}

/**
 * Whether the caller holds the home's own key: the home's CLI and the
 * sessions it runs. This is permission to act on the home's folders, not
 * proof of where the caller physically is.
 */
export function isOnHomeMachine(key: RequestKey | null): boolean {
  return key?.location === 'home';
}
