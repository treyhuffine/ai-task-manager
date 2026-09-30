/** Stable browser/CLI API contract, independent of release/build identity. */
export const API_PROTOCOL = 1;
export const API_PROTOCOL_HEADER = 'x-ri-api-protocol';
export interface ApiCompatibilityIssue { error: 'api_protocol'; code: 'api_protocol'; update: 'client' | 'home'; protocol: number | null; supported: number[]; message: string }
export function apiCompatibilityIssue(header: string | null, supported: readonly number[] = [API_PROTOCOL]): ApiCompatibilityIssue | null {
  // Existing browsers and CLI installations are explicitly the baseline.
  // Missing metadata must not become a wildcard when a later release retires it.
  const protocol = header === null ? 1 : /^\d+$/.test(header) ? Number(header) : null;
  if (protocol !== null && Number.isSafeInteger(protocol) && supported.includes(protocol)) return null;
  const update = protocol !== null && protocol > Math.max(...supported) ? 'home' : 'client';
  return { error: 'api_protocol', code: 'api_protocol', update, protocol, supported: [...supported], message: update === 'home'
    ? 'Update Ri on your Home to use this newer view. Your drafts are retained on this device.'
    : 'Reload this view to use the updated Home. Your drafts are retained on this device.' };
}
/** These authenticated transports negotiate their own protocol. This does
 * not bypass authentication or the scope checks that protect those routes. */
export function hasIndependentProtocol(pathname: string): boolean {
  return /^\/api\/(?:orchestrator\/(?:browser\/)?|connectors\/)?(?:mcp|sse|message|messages)$/.test(pathname);
}
